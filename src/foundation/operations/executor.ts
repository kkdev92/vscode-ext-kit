import type { Logger } from '../logging/logger.js';
import type { ProgressCapability } from '../platform/ports.js';
import type { ResourceScope } from '../resources/resource-scope.js';
import type { ServiceContainer } from '../services/container.js';
import type { ServiceToken } from '../services/token.js';
import {
  CancellationReason,
  OperationCancelledError,
  combineAbortSignals,
} from './cancellation.js';
import type { OperationKind } from './context.js';
import { nextOperationId } from './context.js';
import type { OperationContext } from './context.js';
import { ErrorKind, classifyError } from './errors.js';
import { createOperationProgress } from './progress.js';

/** Options for {@link runOperation}. */
export interface RunOperationOptions {
  /** What kind of work this is. */
  readonly kind: OperationKind;
  /** Descriptor name, for example a command id. */
  readonly name: string;
  /**
   * Application-level cancellation source. Its abort is forwarded to
   * `context.signal`; `work` must cooperate by observing that signal.
   */
  readonly applicationSignal: AbortSignal;
  /**
   * Parent ResourceScope whose name and signal the Operation scope inherits.
   * The child remains detached and is disposed by {@link runOperation}; parent
   * disposal does not own or await it.
   */
  readonly parentResources: ResourceScope;
  /** Logger the operation's logger is derived from. */
  readonly logger: Logger;
  /** Container used to resolve services for this operation. */
  readonly services: ServiceContainer;
  /** Optional caller cancellation, for example a bridged `CancellationToken`. */
  readonly callerSignal?: AbortSignal | undefined;
  /**
   * Optional relative cancellation timeout in milliseconds, starting before
   * `work` runs. It aborts `context.signal` but cannot force non-cooperative work
   * to settle.
   */
  readonly timeoutMs?: number | undefined;
  /** Progress UI for `context.progress`. Absent means headless. */
  readonly progress?: ProgressCapability | undefined;
  /** Receives `operation.*` diagnostics. */
  readonly onDiagnostic?:
    ((event: string, details: Readonly<Record<string, unknown>>) => void) | undefined;
  /**
   * The services every handler gets on its context without declaring them,
   * keyed by the name they appear under.
   *
   * Passed in as data rather than imported: the tokens live in the capability
   * layer, and only the application is allowed to reach into it.
   */
  readonly standard?: Readonly<Record<string, ServiceToken<unknown>>> | undefined;
}

/**
 * Runs a unit of work with identity, cancellation, a scope, a logger and timing.
 *
 * Deliberately narrow: fallbacks, user notification, concurrency, retry and
 * VS Code-specific error mapping belong to the application model, not here.
 *
 * After `work` settles, its ResourceScope is disposed before this promise
 * settles. The handler's value or rejection then reaches the caller unchanged;
 * cleanup failures are logged and diagnosed but never replace that outcome.
 *
 * @example
 * ```ts
 * const updated = await runOperation(
 *   { kind: 'command', name: 'sample.refresh', ...shared },
 *   (context) => repository.refresh(context.signal)
 * );
 * ```
 */
export async function runOperation<T>(
  options: RunOperationOptions,
  work: (context: OperationContext) => T | Promise<T>
): Promise<T> {
  const sources: AbortSignal[] = [options.applicationSignal];
  if (options.callerSignal !== undefined) {
    sources.push(options.callerSignal);
  }

  let timeoutController: AbortController | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  if (options.timeoutMs !== undefined) {
    timeoutController = new AbortController();
    const controller = timeoutController;
    timeoutTimer = setTimeout(() => {
      controller.abort(new OperationCancelledError(CancellationReason.Timeout));
    }, options.timeoutMs);
    sources.push(controller.signal);
  }

  const combined = combineAbortSignals(sources);
  const id = nextOperationId(options.kind, options.name);
  // Detached: the Operation owns and disposes this scope instead of adding one
  // entry per invocation to the long-lived parent. ResourceScope inherits only
  // the parent's signal; `context.signal` below combines the explicitly supplied
  // Application signal with caller and timeout cancellation.
  const resources = options.parentResources.detachedChild(id);
  const logger = options.logger.withFields({
    operationId: id,
    operationKind: options.kind,
    operationName: options.name,
  });
  const startedAt = Date.now();

  const emit = (event: string, details: Readonly<Record<string, unknown>>): void => {
    try {
      options.onDiagnostic?.(event, { operationId: id, ...details });
    } catch {
      // A broken diagnostics observer must never fail the operation it is
      // merely watching, and must never skip the cleanup below.
    }
  };

  const resolver = options.services.createResolver(resources);
  const context = {
    id,
    kind: options.kind,
    name: options.name,
    signal: combined.signal,
    logger,
    resources,
    services: resolver,
    progress: createOperationProgress(options.progress, combined.signal),
    startedAt,
  } as OperationContext;

  // Lazily, and non-enumerable: an application that never notifies must not
  // build a notifier, and one whose capability is absent should only find out
  // if it asks. Non-enumerable also keeps an accidental spread of the context
  // from resolving all of them at once.
  for (const [name, token] of Object.entries(options.standard ?? {})) {
    Object.defineProperty(context, name, {
      get: () => resolver.get(token),
      enumerable: false,
      configurable: true,
    });
  }

  emit('operation.started', { name: options.name, kind: options.kind });

  try {
    const result = await work(context);
    emit('operation.completed', { name: options.name, durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    const kind = classifyError(error);

    if (kind === ErrorKind.Cancelled) {
      // Cancellation is normal control flow, not a failure.
      logger.debug('operation cancelled');
      emit('operation.cancelled', { name: options.name, durationMs: Date.now() - startedAt });
    } else {
      logger.error('operation failed', error, { errorKind: kind });
      emit('operation.failed', {
        name: options.name,
        durationMs: Date.now() - startedAt,
        errorKind: kind,
      });
    }

    // Rethrow unchanged: the caller's promise must reflect what happened.
    throw error;
  } finally {
    if (timeoutTimer !== undefined) {
      clearTimeout(timeoutTimer);
    }
    // Detach before disposing so a long-lived application signal never keeps a
    // listener per operation.
    combined.dispose();
    try {
      await resources.dispose();
    } catch (error) {
      logger.error('operation resource cleanup failed', error);
      emit('operation.cleanupFailed', { name: options.name });
    }
  }
}
