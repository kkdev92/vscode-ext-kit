import type { OperationContext } from '../../foundation/operations/context.js';
import type { ServiceMap } from '../../foundation/services/token.js';
import type { FileWatcherEvent, FileWatcherOptions } from './filewatcher.js';

/**
 * A module-registered file watcher.
 *
 * The framework owns the native watchers (they unwind with the module), and
 * each debounced batch runs the handler as an operation — with a signal, a
 * logger, its own resource scope and error classification. A rejected handler
 * is logged and classified; it never becomes an unhandled rejection.
 */
export interface FileWatcherDefinition extends FileWatcherOptions {
  /** Unique id, used for diagnostics and preflight. */
  readonly id: string;
  /** Declared dependencies, resolved per batch. */
  readonly dependencies: ServiceMap;
  /**
   * Handles one debounced batch. Rejection is classified by the operation
   * runner and does not stop the watcher. Use `context.signal` for cooperative
   * shutdown; dependencies are a fresh resolution for each delivered batch.
   */
  readonly handle: (
    context: OperationContext,
    events: readonly FileWatcherEvent[],
    injected: Readonly<Record<string, unknown>>
  ) => void | Promise<void>;
  /** Module that registered this watcher. */
  readonly moduleId: string;
}
