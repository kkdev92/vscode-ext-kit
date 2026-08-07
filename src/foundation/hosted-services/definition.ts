import type { Logger } from '../logging/logger.js';
import type { ServiceMap } from '../services/token.js';

/** Context for starting or running a hosted service during the Application lifetime. */
export interface HostedServiceContext {
  /** Aborts when the application begins stopping. */
  readonly signal: AbortSignal;
  /** Logger scoped to this hosted service. */
  readonly logger: Logger;
  /**
   * Cancellation-aware delay. Resolves early when the signal aborts, so a
   * background loop never keeps the host waiting on a timer.
   */
  readonly delay: (milliseconds: number) => Promise<void>;
}

/**
 * Context for stopping a hosted service.
 *
 * Deliberately carries no UI capability: VS Code APIs may already be unavailable
 * during shutdown, and there is a hard budget to respect.
 */
export interface HostedServiceStopContext {
  /** Already aborted; cleanup may pass it to work that accepts cancellation. */
  readonly signal: AbortSignal;
  /** Logger scoped to this hosted service. */
  readonly logger: Logger;
  /** Milliseconds left in the shared shutdown budget, recomputed on each call. */
  readonly remainingMs: () => number;
}

/**
 * A long-lived piece of application work with an explicit lifecycle.
 *
 * Async initialisation belongs here rather than in a service factory, which is
 * why factories are required to be synchronous.
 */
export interface HostedServiceDefinition {
  /** Unique id, used for ordering diagnostics and errors. */
  readonly id: string;
  /** Declared dependencies, resolved before `start`/`run`. */
  readonly dependencies: ServiceMap;
  /**
   * Brings the service to readiness. Awaited during activation, so a failure
   * fails activation and already-started services stop in reverse order.
   */
  readonly start?: (
    context: HostedServiceContext,
    injected: Readonly<Record<string, unknown>>
  ) => void | Promise<void>;
  /**
   * Releases the service's own work in reverse start order. It receives the
   * exact dependencies used by `start`/`run`; those dependencies remain owned
   * and later disposed by the container.
   */
  readonly stop?: (
    context: HostedServiceStopContext,
    injected: Readonly<Record<string, unknown>>
  ) => void | Promise<void>;
  /**
   * Background loop, started but not awaited during activation. The Host tracks
   * the returned promise and drains it on stop. A rejection is logged and
   * diagnosed rather than changing a running Application's state.
   */
  readonly run?: (
    context: HostedServiceContext,
    injected: Readonly<Record<string, unknown>>
  ) => void | Promise<void>;
  /** Module that registered this definition. */
  readonly moduleId: string;
}

/**
 * Resolves after `milliseconds`, or as soon as `signal` aborts.
 *
 * Always detaches its abort listener, so a long-lived application signal does
 * not accumulate one listener per loop iteration.
 *
 * @example
 * ```ts
 * while (!context.signal.aborted) {
 *   await indexer.update(context.signal);
 *   await context.delay(30_000);
 * }
 * ```
 */
export function delayWithSignal(milliseconds: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
