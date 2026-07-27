import * as vscode from 'vscode';
import { debounce } from '../std/timing.js';

// ============================================
// Types
// ============================================

/**
 * A single glob pattern entry: a plain glob string, or a pre-built
 * `vscode.RelativePattern` that carries its own base folder.
 */
export type WatchPattern = string | vscode.RelativePattern;

/**
 * Options for creating a file watcher.
 */
export interface FileWatcherOptions {
  /**
   * Glob pattern(s) to watch. An entry may be a plain glob string or a
   * pre-built `vscode.RelativePattern`, so a single watcher can span
   * multiple workspace folders with different base folders by mixing
   * `RelativePattern` entries in the array.
   */
  patterns: WatchPattern | WatchPattern[];
  /**
   * Workspace folder used as the base for any *string* pattern (via
   * `RelativePattern`, for better performance). Ignored for entries that
   * are already a `RelativePattern` — those carry their own base.
   */
  workspaceFolder?: vscode.WorkspaceFolder;
  /** Patterns to ignore */
  ignorePatterns?: string[];
  /** Debounce delay in milliseconds (default: 100) */
  debounceDelay?: number;
  /**
   * Events to watch (default: all). This also determines which native
   * `ignore*Events` flags are passed to `createFileSystemWatcher`, so event
   * kinds nobody asked for never enter the batching pipeline in the first
   * place (as opposed to being filtered out after the fact).
   */
  events?: ('create' | 'change' | 'delete')[];
  /**
   * Once the number of distinct pending files reaches this count, flush
   * immediately instead of waiting for `debounceDelay`. Bounds memory
   * during large bursts (e.g. `git checkout`, `npm install`, build output
   * being rewritten) where events keep arriving faster than the debounce
   * window ever gets a chance to elapse. Default: unbounded.
   */
  maxBatchSize?: number;
}

/**
 * A file watcher event.
 */
export interface FileWatcherEvent {
  /** Event type */
  type: 'create' | 'change' | 'delete';
  /** File URI */
  uri: vscode.Uri;
  /** Event timestamp */
  timestamp: number;
}

/**
 * A managed file watcher with debouncing support.
 */
export interface ManagedFileWatcher extends vscode.Disposable {
  /**
   * Register a listener for file changes.
   * Events are debounced and batched.
   *
   * @param listener - Callback receiving batched events
   * @returns Disposable to unregister the listener
   */
  onDidChange(listener: (events: FileWatcherEvent[]) => void): vscode.Disposable;

  /**
   * Pauses event delivery and discards any events currently pending in the
   * debounce window. Native watchers stay registered in the background,
   * but the batch that was building up is dropped — resuming does not
   * replay it. If you need to react to changes made while paused, dispose
   * and recreate the watcher instead of relying on `resume()` to flush.
   */
  pause(): void;

  /** Resume the file watcher. */
  resume(): void;

  /** Whether the watcher is currently active. */
  readonly isWatching: boolean;
}

// ============================================
// createFileWatcher
// ============================================

/**
 * Creates a managed file watcher with debouncing and event batching.
 *
 * @param options - File watcher options
 * @returns A managed file watcher
 *
 * @example
 * ```typescript
 * const watcher = createFileWatcher({
 *   patterns: ['**\/*.ts', '**\/*.tsx'],
 *   ignorePatterns: ['**\/node_modules/**'],
 *   debounceDelay: 300,
 *   events: ['change', 'create'],
 *   maxBatchSize: 500, // flush immediately during large bursts
 * });
 *
 * watcher.onDidChange((events) => {
 *   console.log(`${events.length} files changed`);
 *   for (const event of events) {
 *     console.log(`${event.type}: ${event.uri.fsPath}`);
 *   }
 * });
 *
 * context.subscriptions.push(watcher);
 *
 * // Multi-root workspace: mix RelativePattern entries with their own base
 * const perFolder = createFileWatcher({
 *   patterns: [
 *     new vscode.RelativePattern(folderA, '**\/*.ts'),
 *     new vscode.RelativePattern(folderB, '**\/*.md'),
 *   ],
 * });
 * ```
 */
export function createFileWatcher(options: FileWatcherOptions): ManagedFileWatcher {
  const {
    patterns,
    workspaceFolder,
    ignorePatterns = [],
    debounceDelay = 100,
    events = ['create', 'change', 'delete'],
    maxBatchSize,
  } = options;

  const patternList = Array.isArray(patterns) ? patterns : [patterns];
  const watchers: vscode.FileSystemWatcher[] = [];
  const listeners: ((events: FileWatcherEvent[]) => void)[] = [];
  // Keyed by uri.toString() so repeated events for the same file are O(1) to
  // dedupe (a linear `find` per event is O(n), i.e. O(n^2) over a burst) and
  // so that, at flush time, each file is reported with its latest event type.
  const pendingEvents = new Map<string, FileWatcherEvent>();
  let isPaused = false;
  let isDisposed = false;

  function flushNow(): void {
    if (pendingEvents.size === 0 || isPaused) {
      return;
    }
    const batch = [...pendingEvents.values()];
    pendingEvents.clear();
    for (const listener of listeners) {
      try {
        listener(batch);
      } catch {
        // Isolate listener failures: one bad listener must not prevent the
        // rest from being notified (mirrors registerCommands' safeExecute
        // wrapping in commands.ts).
      }
    }
  }

  // Create debounced flush function
  const flushEvents = debounce(flushNow, debounceDelay);

  // Compile ignore patterns once at creation — building a RegExp per pattern
  // on every event is wasteful, and regex metacharacters in patterns
  // (e.g. the dot in `*.log`) must be matched literally.
  const ignoreMatchers: ((filePath: string) => boolean)[] = ignorePatterns.map((pattern) => {
    // Simple glob matching for common patterns
    if (pattern.includes('*')) {
      // Use placeholder to avoid replacing * inside .* from ** conversion
      const PLACEHOLDER = '<<<GLOBSTAR>>>';
      // Order matters: separators must be rewritten before single * expands
      // to a character class containing `/`, or that class gets corrupted.
      const regex = new RegExp(
        pattern
          .replace(/[.+^${}()|[\]\\?]/g, '\\$&') // Escape regex specials (not * and /)
          .replace(/\*\*/g, PLACEHOLDER) // Protect ** with placeholder
          .replace(/\//g, '[/\\\\]') // Match both separator styles
          .replace(/\*/g, '[^/\\\\]*') // Replace single *
          .replace(new RegExp(PLACEHOLDER, 'g'), '.*') // Restore ** as .*
      );
      return (filePath) => regex.test(filePath);
    }
    return (filePath) => filePath.includes(pattern);
  });

  // Check if a path should be ignored
  function shouldIgnore(uri: vscode.Uri): boolean {
    const filePath = uri.fsPath;
    return ignoreMatchers.some((matches) => matches(filePath));
  }

  // Add event to pending queue
  function addEvent(type: 'create' | 'change' | 'delete', uri: vscode.Uri): void {
    if (isPaused || isDisposed || shouldIgnore(uri)) {
      return;
    }

    pendingEvents.set(uri.toString(), { type, uri, timestamp: Date.now() });

    if (maxBatchSize !== undefined && pendingEvents.size >= maxBatchSize) {
      // Bypass the debounce window entirely once the batch is large enough
      // that waiting longer only risks unbounded memory growth.
      flushEvents.cancel();
      flushNow();
    } else {
      flushEvents();
    }
  }

  // Derive the native ignore flags from `events` once, and reuse them both
  // for the watcher constructor call and for deciding which listeners to
  // attach at all.
  const ignoreCreateEvents = !events.includes('create');
  const ignoreChangeEvents = !events.includes('change');
  const ignoreDeleteEvents = !events.includes('delete');

  // Create watchers for each pattern
  for (const pattern of patternList) {
    // A pattern that's already a RelativePattern carries its own base
    // folder; only plain string patterns get wrapped with `workspaceFolder`.
    const watchPattern: vscode.GlobPattern =
      typeof pattern === 'string' && workspaceFolder
        ? new vscode.RelativePattern(workspaceFolder, pattern)
        : pattern;

    // Pass ignore*Events to the native watcher instead of only filtering
    // after the fact, so event kinds nobody asked for are never subscribed
    // to (and, per VS Code's own docs for these flags, never generated for
    // this watcher in the first place).
    const watcher = vscode.workspace.createFileSystemWatcher(
      watchPattern,
      ignoreCreateEvents,
      ignoreChangeEvents,
      ignoreDeleteEvents
    );

    if (!ignoreCreateEvents) {
      watcher.onDidCreate((uri) => addEvent('create', uri));
    }
    if (!ignoreChangeEvents) {
      watcher.onDidChange((uri) => addEvent('change', uri));
    }
    if (!ignoreDeleteEvents) {
      watcher.onDidDelete((uri) => addEvent('delete', uri));
    }

    watchers.push(watcher);
  }

  return {
    onDidChange(listener: (events: FileWatcherEvent[]) => void): vscode.Disposable {
      listeners.push(listener);
      return new vscode.Disposable(() => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      });
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
      flushEvents.cancel();
      pendingEvents.clear();
      listeners.length = 0;
      for (const watcher of watchers) {
        watcher.dispose();
      }
      watchers.length = 0;
    },
  };
}

// ============================================
// watchFile
// ============================================

/**
 * Watches a single file for changes.
 *
 * @param uri - URI of the file to watch
 * @param onChange - Callback when file changes
 * @param debounceDelay - Debounce delay in milliseconds (default: 100)
 * @returns Disposable to stop watching
 *
 * @example
 * ```typescript
 * const disposable = watchFile(configUri, () => {
 *   reloadConfig();
 * }, 500);
 *
 * // Later...
 * disposable.dispose();
 * ```
 */
export function watchFile(
  uri: vscode.Uri,
  onChange: () => void,
  debounceDelay: number = 100
): vscode.Disposable {
  // Built on top of createFileWatcher so a single-file watch gets the same
  // engine (native ignore flags, Map-based dedup, etc.) instead of a second,
  // hand-rolled debounce+watch pipeline.
  const pattern = new vscode.RelativePattern(
    vscode.Uri.joinPath(uri, '..'),
    uri.path.split('/').pop() || ''
  );

  const watcher = createFileWatcher({ patterns: pattern, debounceDelay });
  const subscription = watcher.onDidChange(() => onChange());

  return new vscode.Disposable(() => {
    subscription.dispose();
    watcher.dispose();
  });
}
