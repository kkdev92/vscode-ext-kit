import { InvalidHostStateError } from '../internal/errors.js';
import { CancellationReason, OperationCancelledError } from '../operations/cancellation.js';
import {
  createRegistrationScope,
  type RegistrationScope,
} from '../resources/registration-scope.js';
import { createResourceScope, type ResourceScope } from '../resources/resource-scope.js';
import { HostState, StopReason, acceptsWork, isTerminalState } from './host-state.js';

/** Default total budget for the framework-controlled stop pipeline. */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 3_000;

/** Passed to the start hook. Everything the hook creates must land in a scope. */
interface HostStartContext {
  /** Synchronously-released registrations: commands, events, views, watchers. */
  readonly registrations: RegistrationScope;
  /** Asynchronously-released resources: services, connections, flushes. */
  readonly resources: ResourceScope;
  /** Aborts when the application begins stopping. */
  readonly signal: AbortSignal;
}

/** Passed to the stop hook. Intentionally carries no UI capability. */
interface HostStopContext {
  /** Why the host is stopping. */
  readonly reason: StopReason;
  /** The configured total budget in milliseconds. */
  readonly deadlineMs: number;
  /**
   * Milliseconds left before the budget is exhausted.
   *
   * A property rather than a method so it stays safe to destructure:
   * `stop({ reason, remainingMs })`.
   */
  readonly remainingMs: () => number;
}

/**
 * An observability event emitted by the Host lifecycle.
 *
 * Diagnostics are best-effort records, not an application event bus: listener
 * failures are swallowed and delivery must not be used to coordinate work.
 */
export interface HostDiagnostic {
  /** Dotted event name, for example `application.stopping`. */
  readonly event: string;
  /** Structured context for the event. */
  readonly details?: Readonly<Record<string, unknown>>;
}

/** Options for {@link createApplicationHost}. */
export interface ApplicationHostOptions {
  /** Application name, used in scope names and diagnostics. */
  readonly name: string;
  /**
   * Binds the application. Runs once, inside the activation transaction: if it
   * throws, every framework-owned registration and resource is rolled back.
   */
  readonly start?: ((context: HostStartContext) => void | Promise<void>) | undefined;
  /**
   * Stops application-level work before resources are disposed. Runs under the
   * shutdown budget and must not touch VS Code UI.
   */
  readonly stop?: ((context: HostStopContext) => void | Promise<void>) | undefined;
  /**
   * Total shutdown budget in milliseconds. The budget is shared by start
   * unwinding, the stop hook and ResourceScope disposal; it is not renewed per
   * phase. Defaults to `3000`.
   */
  readonly shutdownTimeoutMs?: number | undefined;
  /** Receives lifecycle diagnostics. Exceptions from the observer are ignored. */
  readonly onDiagnostic?: ((diagnostic: HostDiagnostic) => void) | undefined;
}

/**
 * The single owner of an extension's lifecycle.
 *
 * There is exactly one asynchronous cleanup path: `stop()`. The Extension
 * Context owns only a synchronous failsafe that calls `beginStop()`; framework
 * registrations remain in the Host's own RegistrationScope so an external
 * subscription disposal cannot tear down half of the pipeline independently.
 *
 * Do not assume an ordering between the failsafe and `deactivate()`. Both may
 * request shutdown, and correctness comes from `beginStop()` and `stop()` being
 * state-guarded, idempotent and single-flight.
 *
 * @example
 * ```ts
 * const host = createApplicationHost({
 *   name: 'sample',
 *   start({ registrations }) {
 *     registrations.own(vscode.commands.registerCommand('sample.run', run));
 *   },
 * });
 *
 * export async function activate(context: vscode.ExtensionContext): Promise<void> {
 *   context.subscriptions.push({ dispose: () => host.beginStop('context-disposed') });
 *   await host.start();
 * }
 *
 * export async function deactivate(): Promise<void> {
 *   await host.stop('deactivate');
 * }
 * ```
 */
export interface ApplicationHost {
  /** Application name. */
  readonly name: string;
  /** Current lifecycle state. */
  readonly state: HostState;
  /** Whether new operations may start. True only while running. */
  readonly acceptingWork: boolean;
  /** Framework-owned registrations still held. Activation-rollback gates read this. */
  readonly registrationCount: number;
  /** Framework-owned resources still held. */
  readonly resourceCount: number;

  /**
   * Starts the application. Single-flight: concurrent calls share one promise.
   * Rejects with the original activation error after rollback completes. A Host
   * is single-use and cannot start again after stopping or failing.
   */
  start(): Promise<void>;

  /**
   * Closes ingress synchronously: disposes registrations and aborts the root
   * signal. Safe to call from a synchronous `dispose()` — it never throws and
   * never starts async cleanup. The first stop reason wins.
   */
  beginStop(reason: StopReason): void;

  /**
   * Runs the full stop pipeline exactly once. Idempotent: repeated calls share
   * one promise. Never rejects, so `deactivate()` cannot fail the host; cleanup
   * failures are reported through diagnostics. When the budget expires, it may
   * settle while non-cooperative asynchronous work is still pending.
   */
  stop(reason: StopReason): Promise<void>;
}

/**
 * Creates an application host.
 *
 * @example
 * ```ts
 * const host = createApplicationHost({ name: 'sample' });
 * await host.start();
 * await host.stop('manual');
 * ```
 */
export function createApplicationHost(options: ApplicationHostOptions): ApplicationHost {
  const shutdownTimeoutMs = options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS;
  const rootController = new AbortController();

  let state: HostState = HostState.New;
  let startPromise: Promise<void> | undefined;
  let stopPromise: Promise<void> | undefined;
  let stopReason: StopReason | undefined;
  let startAttempted = false;
  let registrations: RegistrationScope | undefined;
  let resources: ResourceScope | undefined;

  const emit = (event: string, details?: Readonly<Record<string, unknown>>): void => {
    const listener = options.onDiagnostic;
    if (listener === undefined) {
      return;
    }
    try {
      listener({ event, ...(details === undefined ? {} : { details }) });
    } catch {
      // A broken observer must never affect the lifecycle.
    }
  };

  const beginStop = (reason: StopReason): void => {
    if (state === HostState.Stopping || state === HostState.Stopped || state === HostState.Failed) {
      return;
    }

    stopReason ??= reason;
    state = HostState.Stopping;
    emit('application.stopping', { reason });

    // Order matters: stop new work arriving, then tell in-flight work to unwind.
    if (registrations !== undefined) {
      try {
        registrations.dispose();
      } catch (error) {
        emit('application.cleanupFailed', { phase: 'registrations', error });
      }
    }

    if (!rootController.signal.aborted) {
      rootController.abort(new OperationCancelledError(CancellationReason.ApplicationStopping));
    }
  };

  const rollback = async (
    startRegistrations: RegistrationScope,
    startResources: ResourceScope
  ): Promise<void> => {
    try {
      startRegistrations.dispose();
    } catch (error) {
      emit('application.cleanupFailed', { phase: 'registrations', error });
    }
    try {
      await startResources.dispose();
    } catch (error) {
      emit('application.cleanupFailed', { phase: 'resources', error });
    }
  };

  const runStart = async (): Promise<void> => {
    startAttempted = true;
    state = HostState.Starting;
    emit('application.starting');

    const startRegistrations = createRegistrationScope(`${options.name}#registrations`);
    const startResources = createResourceScope(`${options.name}#resources`, {
      signal: rootController.signal,
    });
    registrations = startRegistrations;
    resources = startResources;

    try {
      if (rootController.signal.aborted) {
        throw new OperationCancelledError(CancellationReason.ApplicationStopping);
      }

      const hook = options.start;
      if (hook !== undefined) {
        await hook({
          registrations: startRegistrations,
          resources: startResources,
          signal: rootController.signal,
        });
      }

      // A stop requested mid-start must not commit a half-built application.
      if (rootController.signal.aborted) {
        throw new OperationCancelledError(CancellationReason.ApplicationStopping);
      }

      state = HostState.Running;
      emit('application.running');
    } catch (error) {
      await rollback(startRegistrations, startResources);

      // The root signal aborts only from beginStop, so it answers "was a stop
      // requested while we were starting?" without relying on `state`, which
      // control-flow analysis cannot see being mutated re-entrantly.
      if (rootController.signal.aborted) {
        state = HostState.Stopped;
        emit('application.stopped', { reason: stopReason ?? StopReason.StartFailed });
      } else {
        state = HostState.Failed;
        emit('application.failed', { error });
      }
      throw error;
    }
  };

  const runStop = async (reason: StopReason): Promise<void> => {
    // One absolute deadline for the whole stop pipeline, taken before anything
    // runs: the synchronous registration disposal in beginStop, an in-flight
    // start's unwinding, the stop hook and resource disposal all share it. A
    // start hook that ignores its signal must not be able to hold stop() past
    // the budget.
    const deadlineAt = Date.now() + shutdownTimeoutMs;
    const remainingMs = (): number => Math.max(0, deadlineAt - Date.now());

    beginStop(reason);

    const withBudget = async (phase: string, work: () => Promise<void>): Promise<void> => {
      const remaining = remainingMs();
      if (remaining <= 0) {
        emit('application.shutdownTimeout', { phase });
        return;
      }

      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => {
          resolve('timeout');
        }, remaining);
      });

      const settled = work().then(
        (): 'done' => 'done',
        (error: unknown): 'done' => {
          emit('application.cleanupFailed', { phase, error });
          return 'done';
        }
      );

      try {
        // Past the budget we stop waiting; the pending work is abandoned, not awaited.
        if ((await Promise.race([settled, timeout])) === 'timeout') {
          emit('application.shutdownTimeout', { phase });
        }
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      }
    };

    // Let an in-flight start unwind first; it observes the aborted root signal.
    // Bounded: a start hook that never settles is abandoned once the budget is
    // spent, and the pipeline proceeds to dispose what it can.
    if (startPromise !== undefined) {
      const pendingStart = startPromise;
      await withBudget('start-unwind', async () => {
        await pendingStart.catch(() => undefined);
      });
    }

    // Start may have already rolled everything back and settled.
    if (state === HostState.Stopped || state === HostState.Failed) {
      return;
    }

    if (!startAttempted) {
      state = HostState.Stopped;
      emit('application.stopped', { reason });
      return;
    }

    const stopHook = options.stop;
    if (stopHook !== undefined) {
      await withBudget('stop-hook', async () => {
        await stopHook({ reason, deadlineMs: shutdownTimeoutMs, remainingMs });
      });
    }

    const activeResources = resources;
    if (activeResources !== undefined) {
      await withBudget('resources', async () => {
        await activeResources.dispose();
      });
    }

    state = HostState.Stopped;
    emit('application.stopped', { reason });
  };

  return {
    get name(): string {
      return options.name;
    },

    get state(): HostState {
      return state;
    },

    get acceptingWork(): boolean {
      return acceptsWork(state);
    },

    get registrationCount(): number {
      return registrations?.size ?? 0;
    },

    get resourceCount(): number {
      return resources?.size ?? 0;
    },

    start(): Promise<void> {
      // A host is single-use. This guard comes before the single-flight cache:
      // otherwise restarting a stopped host would hand back the stale promise
      // from the first start and appear to succeed.
      if (state === HostState.Stopping || isTerminalState(state)) {
        return Promise.reject(
          new InvalidHostStateError(`Cannot start "${options.name}" in state "${state}".`)
        );
      }
      if (startPromise !== undefined) {
        return startPromise;
      }
      startPromise = runStart();
      return startPromise;
    },

    beginStop(reason: StopReason): void {
      try {
        beginStop(reason);
      } catch (error) {
        // beginStop is called from synchronous dispose paths; it must not throw.
        emit('application.cleanupFailed', { phase: 'beginStop', error });
      }
    },

    stop(reason: StopReason): Promise<void> {
      if (stopPromise !== undefined) {
        return stopPromise;
      }
      stopPromise = runStop(reason).catch((error: unknown) => {
        emit('application.cleanupFailed', { phase: 'stop', error });
      });
      return stopPromise;
    },
  };
}
