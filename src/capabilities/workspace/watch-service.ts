import type { FileWatcherCapability } from '../../foundation/platform/ports.js';
import { serviceToken } from '../../foundation/services/token.js';
import type { ServiceToken } from '../../foundation/services/token.js';
import { createManagedFileWatcher } from './filewatcher.js';
import type { FileWatcherOptions, ManagedFileWatcher } from './filewatcher.js';

/**
 * Watching a path chosen while the extension is running.
 *
 * Distinct from `module.fileWatchers.add`, which declares the globs an
 * extension *always* watches — those are bound at activation, run their handler
 * in an operation, and are torn down with the module. This is the other case:
 * the user picks a log file or types a glob, and the watcher exists only for as
 * long as that choice does. Declaring it is impossible, because the pattern is
 * not known until the user says so.
 *
 * Prefer the declaration whenever the pattern is known up front — it comes with
 * the operation context, the diagnostics and the ownership for free.
 *
 * @example
 * ```ts
 * module.commands.handle(Tail, {
 *   inject: { watchers: FileWatchers },
 *   execute: async (context, [pattern], { watchers }) => {
 *     const watcher = watchers.watch({ patterns: pattern, debounceDelay: 500 });
 *     // Released when the command's scope unwinds; the service would release
 *     // it at shutdown regardless.
 *     context.resources.own(watcher);
 *     watcher.onDidChange((events) => view.refresh(events));
 *   },
 * });
 * ```
 */
export interface FileWatcherService {
  /**
   * Starts watching. The caller owns the result and should dispose it when the
   * reason for watching goes away.
   *
   * Watchers still running when the application stops are disposed with it, so
   * a forgotten one leaks for the session rather than past it.
   * Listener callbacks are not wrapped in an `OperationContext`; use the
   * declarative module watcher when operation logging/error classification is
   * required.
   */
  watch(options: FileWatcherOptions): ManagedFileWatcher;
}

/** Injects the application's {@link FileWatcherService}. */
export const FileWatchers: ServiceToken<FileWatcherService> =
  serviceToken<FileWatcherService>('framework.fileWatchers');

/**
 * Builds the ad-hoc watcher service over a capability.
 *
 * The service tracks what it hands out so shutdown can close the native
 * watchers, and stops tracking one that the caller disposed — otherwise a
 * long-running session that watches a different file every few minutes would
 * accumulate dead entries.
 *
 * @example
 * ```ts
 * const watchers = createFileWatcherService(capability);
 * const watcher = watchers.watch({ patterns: '**\/*.log' });
 * ```
 */
export function createFileWatcherService(
  capability: FileWatcherCapability
): FileWatcherService & { dispose(): void } {
  const open = new Set<ManagedFileWatcher>();
  let disposed = false;

  return {
    watch(options: FileWatcherOptions): ManagedFileWatcher {
      const watcher = createManagedFileWatcher(capability, options);
      if (disposed) {
        // Nothing will ever dispose it otherwise: the service is already past
        // its own teardown.
        watcher.dispose();
        return watcher;
      }
      open.add(watcher);

      return {
        ...watcher,
        get isWatching(): boolean {
          return watcher.isWatching;
        },
        dispose(): void {
          open.delete(watcher);
          watcher.dispose();
        },
      };
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const watcher of [...open]) {
        watcher.dispose();
      }
      open.clear();
    },
  };
}
