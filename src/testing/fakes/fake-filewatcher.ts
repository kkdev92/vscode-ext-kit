/**
 * Port-level file-watcher fake. Tests emit synthetic URIs; no file system is
 * watched or mutated. It applies the framework's deterministic glob subset and
 * the requested event-kind ignore flags. This is enough to test managed event
 * routing, but it is not an emulator for VS Code's full glob grammar or host
 * file-system semantics.
 */
import { compileFullPathGlobMatcher } from '../../capabilities/workspace/glob.js';
import { createEmitter } from '../../foundation/internal/emitter.js';
import type { Emitter } from '../../foundation/internal/emitter.js';
import type {
  FileWatcherCapability,
  FileWatcherHandle,
  RelativePatternLike,
  WatchedUri,
} from '../../foundation/platform/ports.js';

/**
 * Builds a simple `file` {@link WatchedUri} for tests.
 * Use a custom structural URI when scheme, authority or URI encoding matters;
 * this helper intentionally treats the input as already-normalized path text.
 */
export function fakeUri(path: string): WatchedUri {
  return {
    scheme: 'file',
    path,
    fsPath: path,
    toString: () => `file://${path}`,
  };
}

/**
 * Drops trailing separators from a base path.
 *
 * A scan rather than `/\/+$/`, which is quadratic: the engine retries the greedy
 * `\/+` from every position before `$` rejects it, so a base of many separators
 * costs time in the square of its length. Nothing here is attacker-reachable — a
 * base uri comes from the test that built it — but a fake is published code, and
 * counting backwards is both linear and easier to read than the regex was.
 */
function withoutTrailingSlashes(path: string): string {
  let end = path.length;
  while (end > 0 && path[end - 1] === '/') {
    end -= 1;
  }
  return path.slice(0, end);
}

/**
 * Routes an emitted uri the way a native watcher would: a relative pattern only
 * sees files under its base folder, and the glob then decides.
 *
 * Uses the same deliberately limited translator as the managed engine's ignore
 * list. Native VS Code still owns the production watch-pattern interpretation.
 * The base check compares path text with separators normalized—enough for the
 * in-memory URIs tests build, and deliberately not an implementation of URI
 * equality, case-sensitivity rules or filesystem symlink resolution.
 */
function compileWatchMatcher(pattern: string | RelativePatternLike): (uri: WatchedUri) => boolean {
  const normalize = (path: string): string => path.replace(/\\/g, '/');
  if (typeof pattern === 'string') {
    // A bare string pattern is matched against the absolute path, so only a
    // leading globstar segment reaches files in subdirectories.
    const matches = compileFullPathGlobMatcher(pattern);
    return (uri) => matches(uri.fsPath);
  }
  const base = withoutTrailingSlashes(normalize(pattern.baseUri.path));
  const matches = compileFullPathGlobMatcher(pattern.pattern);
  return (uri) => {
    const path = normalize(uri.fsPath);
    if (base !== '' && !path.startsWith(`${base}/`)) {
      return false;
    }
    return matches(path.slice(base.length + 1));
  };
}

interface Registered {
  readonly pattern: string | RelativePatternLike;
  readonly matches: (uri: WatchedUri) => boolean;
  readonly create: Emitter<WatchedUri>;
  readonly change: Emitter<WatchedUri>;
  readonly delete: Emitter<WatchedUri>;
  readonly options: {
    readonly ignoreCreateEvents: boolean;
    readonly ignoreChangeEvents: boolean;
    readonly ignoreDeleteEvents: boolean;
  };
  disposed: boolean;
}

/** In-memory file-watching capability for tests. */
export interface FakeFileWatchers extends FileWatcherCapability {
  /** Patterns currently watched (undisposed), as display strings. */
  _watchedPatterns(): readonly string[];
  /**
   * Emits a native event to the live watchers whose pattern matches.
   *
   * Like the real API, a watcher only hears about a path its pattern selects,
   * and never an event kind it opted out of through the native ignore flags. A
   * watcher registered for `'**\/*.ts'` therefore stays silent for `a.md` — the
   * fake would otherwise let a test pass while production filtered the event
   * out.
   */
  _emit(type: 'create' | 'change' | 'delete', uri: WatchedUri | string): void;
}

/**
 * Creates a fake file-watching capability.
 *
 * @example
 * ```ts
 * const watchers = createFakeFileWatchers();
 * const watcher = watchers.watch('**\/*.ts', {
 *   ignoreCreateEvents: false,
 *   ignoreChangeEvents: false,
 *   ignoreDeleteEvents: true,
 * });
 * const changed: string[] = [];
 * watcher.onDidChange((uri) => changed.push(uri.path));
 * watchers._emit('change', '/src/a.ts');
 * expect(changed).toEqual(['/src/a.ts']);
 * ```
 */
export function createFakeFileWatchers(): FakeFileWatchers {
  const registered: Registered[] = [];

  return {
    watch(pattern, options): FileWatcherHandle {
      const entry: Registered = {
        pattern,
        matches: compileWatchMatcher(pattern),
        create: createEmitter<WatchedUri>(),
        change: createEmitter<WatchedUri>(),
        delete: createEmitter<WatchedUri>(),
        options,
        disposed: false,
      };
      registered.push(entry);

      return {
        onDidCreate: (listener) => entry.create.event(listener),
        onDidChange: (listener) => entry.change.event(listener),
        onDidDelete: (listener) => entry.delete.event(listener),
        dispose: () => {
          entry.disposed = true;
          entry.create.dispose();
          entry.change.dispose();
          entry.delete.dispose();
        },
      };
    },

    _watchedPatterns(): readonly string[] {
      return registered
        .filter((entry) => !entry.disposed)
        .map((entry) =>
          typeof entry.pattern === 'string'
            ? entry.pattern
            : `${entry.pattern.baseUri.toString()}/${entry.pattern.pattern}`
        );
    },

    _emit(type, uri): void {
      const resolved = typeof uri === 'string' ? fakeUri(uri) : uri;
      for (const entry of registered) {
        if (entry.disposed || !entry.matches(resolved)) {
          continue;
        }
        if (type === 'create' && !entry.options.ignoreCreateEvents) {
          entry.create.fire(resolved);
        } else if (type === 'change' && !entry.options.ignoreChangeEvents) {
          entry.change.fire(resolved);
        } else if (type === 'delete' && !entry.options.ignoreDeleteEvents) {
          entry.delete.fire(resolved);
        }
      }
    },
  };
}
