/**
 * Managed file-watcher behavior above the minimal platform watcher port.
 *
 * Public surface: {@link createManagedFileWatcher} accepts one or more host
 * patterns and returns pause/resume, batched events, and deterministic
 * disposal. `module.fileWatchers.add` uses the same engine for declarative,
 * operation-backed handlers; {@link FileWatcherService} exposes it for patterns
 * discovered at runtime.
 *
 * Managed state: one native handle is created per pattern. Events are filtered,
 * deduplicated by URI, and delivered in bounded batches to a listener snapshot.
 * `debounceDelay` controls quiet-time delivery; `maxWait` and `maxBatchSize`
 * provide independent liveness and memory bounds.
 *
 * Ownership: construction is transactional. If any handle or subscription
 * fails, every handle already created is disposed before the error escapes.
 * After success, the returned watcher owns all native handles and timers; its
 * caller (or the declaring module/service) must dispose it.
 */
import type {
  FileWatcherCapability,
  FileWatcherHandle,
  RelativePatternLike,
  ResourceUri,
  WatchedUri,
} from '../../foundation/platform/ports.js';
import { debounce } from '../std/timing.js';
import { compileGlobMatcher } from './glob.js';

/**
 * A single pattern entry: a plain glob string, or a relative pattern carrying
 * its own base folder (a real `vscode.RelativePattern` satisfies the shape), so
 * one watcher can span multiple workspace folders.
 */
export type WatchPattern = string | RelativePatternLike;

/** Options for creating a file watcher. */
export interface FileWatcherOptions {
  /** Glob pattern(s) to watch. */
  readonly patterns: WatchPattern | readonly WatchPattern[];
  /**
   * Base folder for any *string* pattern (combined into a relative pattern for
   * better performance). Entries that already carry a base are unaffected.
   */
  readonly workspaceFolder?: { readonly uri: ResourceUri };
  /** Patterns to ignore. */
  readonly ignorePatterns?: readonly string[];
  /**
   * Debounce delay in milliseconds.
   *
   * @defaultValue 100
   */
  readonly debounceDelay?: number;
  /**
   * Events to watch. Also decides the native `ignore*Events` flags, so unwanted
   * event kinds never enter the pipeline at all.
   *
   * @defaultValue all three
   */
  readonly events?: readonly ('create' | 'change' | 'delete')[];
  /**
   * Once this many distinct files are pending, flush immediately instead of
   * waiting for the debounce window — bounds memory during bursts
   * (`git checkout`, `npm install`) where events outpace the window.
   *
   * Unbounded by default, and worth knowing what that means: the
   * debounce only fires once the stream goes quiet, so while events keep
   * arriving closer together than `debounceDelay` nothing is delivered and the
   * pending map keeps one entry per distinct path. A long enough burst
   * therefore delays every listener and holds memory proportional to the number
   * of paths touched. Set this, or {@link FileWatcherOptions.maxWait}, whenever
   * the watched glob can see a burst you do not control.
   *
   * @defaultValue unbounded
   */
  readonly maxBatchSize?: number;
  /**
   * Longest a pending batch may wait, in milliseconds, however busy the stream
   * stays. This is the liveness bound `debounceDelay` alone cannot give: with it
   * set, a burst that never pauses still delivers every `maxWait`.
   *
   * @defaultValue unbounded — the batch waits for the stream to go quiet
   */
  readonly maxWait?: number;
}

/** A file watcher event. */
export interface FileWatcherEvent {
  /** Native event kind after the caller's event filter. */
  readonly type: 'create' | 'change' | 'delete';
  /** URI reported by the host; do not assume a local `file:` scheme. */
  readonly uri: WatchedUri;
  /** Epoch milliseconds when this managed watcher accepted the event. */
  readonly timestamp: number;
}

/** A managed file watcher with debouncing and batching. */
export interface ManagedFileWatcher {
  /**
   * Registers a listener for debounced, batched events. Listener failures are
   * isolated and swallowed so the remaining listeners still receive the
   * batch; handle/report expected failures inside the listener.
   */
  onDidChange(listener: (events: FileWatcherEvent[]) => void): { dispose(): void };
  /**
   * Pauses delivery and discards the batch building up in the debounce window.
   * Native watchers stay registered; resuming does **not** replay dropped
   * events — dispose and recreate the watcher to catch up instead.
   */
  pause(): void;
  /** Resumes delivery. */
  resume(): void;
  /** Whether the watcher is currently active. */
  readonly isWatching: boolean;
  /** Disposes every native watcher and pending timer. */
  dispose(): void;
}

// The matcher lives in ./glob.js so the fake watcher routes events through the
// exact rules the engine ignores by — see that module's header.

/**
 * Creates a managed file watcher over a capability.
 *
 * Free of any `vscode` import, so tests drive it with a fake capability and
 * `module.fileWatchers.add` builds on the same engine.
 *
 * What it guarantees: per-file dedupe keeping the latest event type; debounced
 * batch delivery to a **snapshot** of the listeners, so one that unsubscribes
 * while the batch is being delivered cannot make the next one be skipped; one
 * listener throwing does not stop the others; an immediate flush once
 * `maxBatchSize` distinct paths are pending; and `pause()` discarding whatever
 * had accumulated rather than replaying it later.
 *
 * @example
 * ```ts
 * const watcher = createManagedFileWatcher(capability, {
 *   patterns: ['**\/*.ts'],
 *   ignorePatterns: ['**\/node_modules/**'],
 *   debounceDelay: 300,
 * });
 * watcher.onDidChange((events) => index.apply(events));
 * ```
 */
export function createManagedFileWatcher(
  capability: FileWatcherCapability,
  options: FileWatcherOptions
): ManagedFileWatcher {
  const {
    patterns,
    workspaceFolder,
    ignorePatterns = [],
    debounceDelay = 100,
    events = ['create', 'change', 'delete'],
    maxBatchSize,
    maxWait,
  } = options;

  const patternList = Array.isArray(patterns)
    ? (patterns as readonly WatchPattern[])
    : [patterns as WatchPattern];
  const handles: FileWatcherHandle[] = [];
  const listeners: ((events: FileWatcherEvent[]) => void)[] = [];
  // Keyed by uri.toString(): repeated events for one file dedupe in O(1), and
  // each file flushes with its latest event type.
  const pendingEvents = new Map<string, FileWatcherEvent>();
  let isPaused = false;
  let isDisposed = false;

  function flushNow(): void {
    if (pendingEvents.size === 0 || isPaused) {
      return;
    }
    const batch = [...pendingEvents.values()];
    pendingEvents.clear();
    // Iterate a copy: a listener that unsubscribes during delivery would
    // otherwise shift the live array under this loop and skip its neighbour.
    for (const listener of [...listeners]) {
      try {
        listener(batch);
      } catch {
        // One bad listener must not prevent the rest from being notified.
      }
    }
  }

  const flushEvents = debounce(flushNow, debounceDelay, maxWait === undefined ? {} : { maxWait });

  // Compiled once: a RegExp per pattern per event would be wasteful, and the
  // dot in `*.log` must match literally.
  const ignoreMatchers = ignorePatterns.map(compileGlobMatcher);

  function shouldIgnore(uri: WatchedUri): boolean {
    const filePath = uri.fsPath;
    return ignoreMatchers.some((matches) => matches(filePath));
  }

  function addEvent(type: FileWatcherEvent['type'], uri: WatchedUri): void {
    if (isPaused || isDisposed || shouldIgnore(uri)) {
      return;
    }

    pendingEvents.set(uri.toString(), { type, uri, timestamp: Date.now() });

    if (maxBatchSize !== undefined && pendingEvents.size >= maxBatchSize) {
      // Waiting longer only risks unbounded memory growth.
      flushEvents.cancel();
      flushNow();
    } else {
      flushEvents();
    }
  }

  const ignoreCreateEvents = !events.includes('create');
  const ignoreChangeEvents = !events.includes('change');
  const ignoreDeleteEvents = !events.includes('delete');

  // Construction is a transaction. If `watch()` or `onDid*()` throws, the
  // factory never returns an owner to the caller; this block therefore has to
  // unwind every native handle it created and cancel its timer itself.
  try {
    for (const pattern of patternList) {
      // A relative pattern carries its own base; only plain strings get wrapped
      // with the given workspace folder.
      const watchPattern: string | RelativePatternLike =
        typeof pattern === 'string' && workspaceFolder !== undefined
          ? { baseUri: workspaceFolder.uri, pattern }
          : pattern;

      const handle = capability.watch(watchPattern, {
        ignoreCreateEvents,
        ignoreChangeEvents,
        ignoreDeleteEvents,
      });
      // Tracked before its subscriptions are attached: a throwing `onDid*` must
      // still leave the handle disposable.
      handles.push(handle);

      if (!ignoreCreateEvents) {
        handle.onDidCreate((uri) => {
          addEvent('create', uri);
        });
      }
      if (!ignoreChangeEvents) {
        handle.onDidChange((uri) => {
          addEvent('change', uri);
        });
      }
      if (!ignoreDeleteEvents) {
        handle.onDidDelete((uri) => {
          addEvent('delete', uri);
        });
      }
    }
  } catch (error) {
    isDisposed = true;
    flushEvents.cancel();
    pendingEvents.clear();
    // Reverse order, mirroring how a scope would have unwound them.
    for (let index = handles.length - 1; index >= 0; index -= 1) {
      try {
        handles[index]?.dispose();
      } catch {
        // Already-failing construction: one bad dispose must not hide the cause.
      }
    }
    handles.length = 0;
    throw error;
  }

  return {
    onDidChange(listener: (events: FileWatcherEvent[]) => void): { dispose(): void } {
      listeners.push(listener);
      return {
        dispose(): void {
          const index = listeners.indexOf(listener);
          if (index >= 0) {
            listeners.splice(index, 1);
          }
        },
      };
    },

    pause(): void {
      isPaused = true;
      flushEvents.cancel();
      pendingEvents.clear();
    },

    resume(): void {
      isPaused = false;
    },

    get isWatching(): boolean {
      return !isPaused && !isDisposed;
    },

    dispose(): void {
      isDisposed = true;
      // Nothing may fire after this point: an armed timer would deliver a
      // batch to listeners that have already been torn down.
      flushEvents.cancel();
      pendingEvents.clear();
      listeners.length = 0;
      for (const handle of handles) {
        handle.dispose();
      }
      handles.length = 0;
    },
  };
}
