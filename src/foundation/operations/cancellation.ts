import type { CancellationTokenLike } from '../platform/ports.js';

/**
 * Why a signal was aborted. Kept for diagnostics: `AbortSignal` alone cannot
 * tell "the application is stopping" from "the caller gave up".
 */
export const CancellationReason = {
  ApplicationStopping: 'application-stopping',
  VSCodeRequest: 'vscode-request',
  Timeout: 'timeout',
  Superseded: 'superseded',
  Caller: 'caller',
} as const;

/** Union of {@link CancellationReason} values. */
export type CancellationReason = (typeof CancellationReason)[keyof typeof CancellationReason];

/**
 * Signals cooperative cancellation with a machine-readable reason.
 * `classifyError` treats this type as cancellation rather than an unexpected
 * failure; callers still receive the same rejection and choose how to present it.
 *
 * @example
 * ```ts
 * if (context.signal.aborted) {
 *   throw new OperationCancelledError(CancellationReason.ApplicationStopping);
 * }
 * ```
 */
export class OperationCancelledError extends Error {
  /** Why the operation was cancelled. */
  readonly reason: CancellationReason;

  constructor(reason: CancellationReason, message?: string) {
    super(message ?? `Operation cancelled (${reason}).`);
    this.name = 'OperationCancelledError';
    this.reason = reason;
  }
}

/** A signal derived from several sources, plus the detach it requires. */
export interface CombinedAbortSignal {
  /** Aborts as soon as any source signal aborts. */
  readonly signal: AbortSignal;
  /**
   * Detaches the listeners from the source signals.
   *
   * Always call this once the operation settles. Long-lived sources such as the
   * application root signal would otherwise accumulate a listener per operation.
   */
  dispose(): void;
}

/**
 * Combines abort signals while preserving the first source's abort reason.
 *
 * Implemented locally so all supported hosts have identical listener cleanup
 * and reason propagation. With no sources, the returned signal remains live.
 * If a source is already aborted, no listeners are attached.
 *
 * @example
 * ```ts
 * const combined = combineAbortSignals([host.signal, token.signal]);
 * try {
 *   await work(combined.signal);
 * } finally {
 *   combined.dispose(); // never leak a listener on the root signal
 * }
 * ```
 */
export function combineAbortSignals(signals: readonly AbortSignal[]): CombinedAbortSignal {
  const controller = new AbortController();
  const detachers: Array<() => void> = [];

  const detachAll = (): void => {
    for (const detach of detachers) {
      detach();
    }
    detachers.length = 0;
  };

  for (const signal of signals) {
    if (signal.aborted) {
      const reason: unknown = signal.reason;
      controller.abort(reason);
      return {
        signal: controller.signal,
        dispose: (): void => {
          // Nothing was attached.
        },
      };
    }
  }

  for (const signal of signals) {
    const onAbort = (): void => {
      const reason: unknown = signal.reason;
      controller.abort(reason);
      detachAll();
    };
    signal.addEventListener('abort', onAbort, { once: true });
    detachers.push(() => {
      signal.removeEventListener('abort', onAbort);
    });
  }

  return { signal: controller.signal, dispose: detachAll };
}

/** Memoizes {@link toAbortSignal}'s token → signal bridges. */
const bridgedSignals = new WeakMap<CancellationTokenLike, AbortSignal>();

/**
 * Bridges a platform `CancellationToken` onto an `AbortSignal`.
 *
 * The framework speaks `AbortSignal` throughout, because that is what the
 * platform-independent half can use and what `fetch` and friends already take.
 * VS Code hands out tokens instead, so anything that accepts one — a progress
 * UI's cancel button, a provider callback — is converted here on the way in.
 *
 * The result is cached per token: the same live token always yields the same
 * signal, so converting it repeatedly does not accumulate listeners. The
 * bridge subscription disposes itself when cancellation fires.
 *
 * @example
 * ```ts
 * const signal = toAbortSignal(token);
 * const response = await fetch(url, { signal });
 * ```
 */
export function toAbortSignal(token: CancellationTokenLike): AbortSignal {
  if (token.isCancellationRequested) {
    return AbortSignal.abort();
  }

  // One bridge per token, remembered for the token's lifetime: without this,
  // every call parks another cancellation listener on the token, and a token
  // that never fires (the common case) accumulates them without bound. The
  // WeakMap keeps the token itself collectable.
  const cached = bridgedSignals.get(token);
  if (cached !== undefined) {
    return cached;
  }

  const controller = new AbortController();
  // Dispose the event subscription once it fires — after that the token is
  // permanently cancelled and the AbortSignal.abort() path above (via
  // isCancellationRequested) takes over for later callers.
  const subscription = token.onCancellationRequested(() => {
    subscription.dispose();
    controller.abort();
  });

  bridgedSignals.set(token, controller.signal);
  return controller.signal;
}
