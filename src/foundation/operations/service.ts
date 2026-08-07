import type { Logger } from '../logging/logger.js';
import type { ProgressCapability } from '../platform/ports.js';
import type { ResourceScope } from '../resources/resource-scope.js';
import type { ServiceContainer } from '../services/container.js';
import { serviceToken } from '../services/token.js';
import type { ServiceToken } from '../services/token.js';
import { OperationKind } from './context.js';
import type { OperationContext } from './context.js';
import { runOperation } from './executor.js';

/** Options for {@link OperationsService.run}. */
export interface RunTaskOptions {
  /** Caller cancellation, combined with the application's. */
  readonly signal?: AbortSignal | undefined;
  /**
   * Relative cancellation timeout in milliseconds. It aborts the Operation
   * signal but does not forcibly terminate non-cooperative work.
   */
  readonly timeoutMs?: number | undefined;
}

/**
 * Starts Operation-scoped framework work from somewhere that is not a command.
 *
 * A command handler is handed an {@link OperationContext} — cancellation, a
 * scoped logger, a resource scope, `progress`. Plenty of real work starts
 * elsewhere: a webview asks the host to do something over RPC, a tree view
 * refreshes, an editor event fires. This is how that work gets the same
 * context, rather than each caller improvising a signal and a progress call.
 *
 * It is not a second way to show progress. `context.progress` remains the only
 * one; this is how you come by a `context` outside a handler.
 *
 * @example
 * ```ts
 * panel.rpc.onRequest('reindex', () =>
 *   operations.run('reindex', (context) =>
 *     context.progress.run({ title: 'Reindexing', cancellable: true }, (_report, signal) =>
 *       index.rebuild(signal)
 *     )
 *   )
 * );
 * ```
 */
export interface OperationsService {
  /**
   * Runs `work` as an operation.
   *
   * The result and any rejection reach the caller untouched, exactly as for a
   * command. Operation resources are disposed before the returned promise
   * settles; cleanup failures are reported but do not replace that result.
   *
   * @param name - What the work is, for diagnostics and log fields
   * @param work - The work
   * @param options - Caller cancellation and deadline
   */
  run<T>(
    name: string,
    work: (context: OperationContext) => T | Promise<T>,
    options?: RunTaskOptions
  ): Promise<T>;
}

/** Injects the application's {@link OperationsService}. */
export const Operations: ServiceToken<OperationsService> =
  serviceToken<OperationsService>('framework.operations');

/** What {@link createOperationsService} needs from the host to run an operation. */
export interface OperationsServiceOptions {
  /** Aborts when the application begins stopping. */
  readonly applicationSignal: AbortSignal;
  /** Scope each operation's own scope is derived from. */
  readonly parentResources: ResourceScope;
  /** Logger each operation's logger is derived from. */
  readonly logger: Logger;
  /** Container used to resolve services inside the operation. */
  readonly services: ServiceContainer;
  /** Progress UI for `context.progress`. Absent means headless. */
  readonly progress?: ProgressCapability | undefined;
  /** Receives `operation.*` diagnostics. */
  readonly onDiagnostic?:
    ((event: string, details: Readonly<Record<string, unknown>>) => void) | undefined;
  /** The services every operation's context carries without being asked. */
  readonly standard?: Readonly<Record<string, ServiceToken<unknown>>> | undefined;
}

/**
 * Builds the operation-starting service.
 *
 * @example
 * ```ts
 * const operations = createOperationsService({ applicationSignal, parentResources, logger, services });
 * await operations.run('refresh', (context) => repository.refresh(context.signal));
 * ```
 */
export function createOperationsService(options: OperationsServiceOptions): OperationsService {
  return {
    run<T>(
      name: string,
      work: (context: OperationContext) => T | Promise<T>,
      runOptions?: RunTaskOptions
    ): Promise<T> {
      return runOperation<T>(
        {
          kind: OperationKind.Task,
          name,
          applicationSignal: options.applicationSignal,
          parentResources: options.parentResources,
          logger: options.logger,
          services: options.services,
          callerSignal: runOptions?.signal,
          timeoutMs: runOptions?.timeoutMs,
          progress: options.progress,
          onDiagnostic: options.onDiagnostic,
          standard: options.standard,
        },
        work
      );
    },
  };
}
