import type { Logger } from '../core/types.js';

// ============================================
// Debounce / Throttle shared engine
// ============================================

interface DelayedInvokerOptions {
  leading: boolean;
  trailing: boolean;
  maxWait: number | undefined;
  signal: AbortSignal | undefined;
}

interface DelayedInvoker<T extends (...args: unknown[]) => void> {
  (...args: Parameters<T>): void;
  cancel(): void;
  flush(): void;
  pending(): boolean;
}

/**
 * Shared timer state machine backing both {@link debounce} and
 * {@link throttle}. `throttle` is implemented as `debounce` with `maxWait`
 * pinned to the interval and `leading` defaulted to `true` — the same
 * relationship lodash's implementations have, ported here so both share one
 * well-tested state machine instead of two subtly different ones.
 */
function createDelayedInvoker<T extends (...args: unknown[]) => void>(
  fn: T,
  wait: number,
  { leading, trailing, maxWait, signal }: DelayedInvokerOptions
): DelayedInvoker<T> {
  type Args = Parameters<T>;

  let lastArgs: Args | undefined;
  let lastCallTime: number | undefined;
  let lastInvokeTime = 0;
  let timerId: ReturnType<typeof setTimeout> | undefined;

  const maxing = maxWait !== undefined;
  const effectiveMaxWait = maxing ? Math.max(maxWait, wait) : undefined;

  function invoke(time: number): void {
    const args = lastArgs;
    lastArgs = undefined;
    lastInvokeTime = time;
    if (args !== undefined) {
      fn(...args);
    }
  }

  function shouldInvoke(time: number): boolean {
    if (lastCallTime === undefined) {
      return true;
    }
    const timeSinceLastCall = time - lastCallTime;
    const timeSinceLastInvoke = time - lastInvokeTime;
    return (
      timeSinceLastCall >= wait ||
      timeSinceLastCall < 0 ||
      (maxing && timeSinceLastInvoke >= (effectiveMaxWait as number))
    );
  }

  function remainingWait(time: number): number {
    const timeSinceLastCall = time - (lastCallTime ?? time);
    const timeSinceLastInvoke = time - lastInvokeTime;
    const timeWaiting = wait - timeSinceLastCall;
    return maxing
      ? Math.min(timeWaiting, (effectiveMaxWait as number) - timeSinceLastInvoke)
      : timeWaiting;
  }

  function trailingEdge(time: number): void {
    timerId = undefined;
    if (trailing && lastArgs !== undefined) {
      invoke(time);
    } else {
      lastArgs = undefined;
    }
  }

  function timerExpired(): void {
    const time = Date.now();
    if (shouldInvoke(time)) {
      trailingEdge(time);
      return;
    }
    timerId = setTimeout(timerExpired, remainingWait(time));
  }

  function leadingEdge(time: number): void {
    lastInvokeTime = time;
    timerId = setTimeout(timerExpired, wait);
    if (leading) {
      invoke(time);
    }
  }

  const invoker = ((...args: Args) => {
    const time = Date.now();
    const isInvoking = shouldInvoke(time);

    lastArgs = args;
    lastCallTime = time;

    if (isInvoking) {
      if (timerId === undefined) {
        leadingEdge(time);
        return;
      }
      if (maxing) {
        // Handle invocations that keep arriving faster than `wait`.
        timerId = setTimeout(timerExpired, wait);
        invoke(time);
        return;
      }
    }
    if (timerId === undefined) {
      timerId = setTimeout(timerExpired, wait);
    }
  }) as DelayedInvoker<T>;

  invoker.cancel = () => {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
    lastInvokeTime = 0;
    lastArgs = undefined;
    lastCallTime = undefined;
    timerId = undefined;
  };

  invoker.flush = () => {
    if (timerId === undefined) {
      return;
    }
    clearTimeout(timerId);
    timerId = undefined;
    trailingEdge(Date.now());
  };

  invoker.pending = () => timerId !== undefined;

  if (signal) {
    if (signal.aborted) {
      invoker.cancel();
    } else {
      signal.addEventListener('abort', () => invoker.cancel(), { once: true });
    }
  }

  return invoker;
}

// ============================================
// Debounce
// ============================================

/**
 * Options for {@link debounce}.
 */
export interface DebounceOptions {
  /**
   * Invoke on the leading edge of the wait period (as soon as the burst of
   * calls starts), in addition to any trailing invocation.
   * @default false
   */
  leading?: boolean;
  /**
   * Invoke on the trailing edge of the wait period — the classic debounce
   * behavior: run once activity has stopped for `delay` ms.
   * @default true
   */
  trailing?: boolean;
  /**
   * Upper bound, in milliseconds, on how long invocation can be deferred
   * while calls keep arriving faster than `delay`. Without this, a function
   * that's called continuously would never run.
   */
  maxWait?: number;
  /** When aborted, behaves as if `.cancel()` was called. */
  signal?: AbortSignal;
}

/**
 * A debounced function with cancellation and introspection helpers.
 */
export interface DebouncedFunction<T extends (...args: unknown[]) => void> {
  (...args: Parameters<T>): void;
  /** Cancels any pending invocation and resets internal timing state. */
  cancel(): void;
  /** Immediately runs a pending trailing invocation, if any, and clears it. */
  flush(): void;
  /** Returns true while an invocation is scheduled but hasn't run yet. */
  pending(): boolean;
}

/**
 * Creates a debounced version of a function that delays execution until
 * after the specified delay has elapsed since the last call.
 *
 * @param fn - The function to debounce
 * @param delay - Delay in milliseconds
 * @param options - Leading/trailing edge, `maxWait`, and abort signal control
 * @returns Debounced function with `cancel`/`flush`/`pending`
 *
 * @example
 * ```typescript
 * // Debounce search input (trailing-edge only, the default)
 * const debouncedSearch = debounce((query: string) => {
 *   performSearch(query);
 * }, 300);
 *
 * onDidChangeTextDocument((e) => {
 *   debouncedSearch(e.document.getText());
 * });
 *
 * // Force a flush at least every 2s even under continuous typing
 * const debouncedSave = debounce(save, 500, { maxWait: 2000 });
 *
 * // Cancel pending execution, or force it to run right now
 * debouncedSearch.cancel();
 * debouncedSave.flush();
 * ```
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number,
  options: DebounceOptions = {}
): DebouncedFunction<T> {
  const { leading = false, trailing = true, maxWait, signal } = options;
  return createDelayedInvoker(fn, delay, { leading, trailing, maxWait, signal });
}

// ============================================
// Throttle
// ============================================

/**
 * Options for {@link throttle}.
 */
export interface ThrottleOptions {
  /**
   * Invoke on the leading edge (immediately on the first call of a burst).
   * @default true
   */
  leading?: boolean;
  /**
   * Invoke on the trailing edge (once more after the burst ends, using the
   * most recent arguments, if calls were dropped in between).
   * @default true
   */
  trailing?: boolean;
  /** When aborted, behaves as if `.cancel()` was called. */
  signal?: AbortSignal;
}

/**
 * A throttled function with cancellation and introspection helpers.
 */
export interface ThrottledFunction<T extends (...args: unknown[]) => void> {
  (...args: Parameters<T>): void;
  /** Cancels any pending trailing invocation and resets internal timing state. */
  cancel(): void;
  /** Immediately runs a pending trailing invocation, if any, and clears it. */
  flush(): void;
  /** Returns true while a trailing invocation is scheduled but hasn't run yet. */
  pending(): boolean;
}

/**
 * Creates a throttled version of a function that executes at most once per
 * specified time period: immediately on the leading edge by default, and
 * once more on the trailing edge if further calls arrived during the wait.
 *
 * @param fn - The function to throttle
 * @param limit - Minimum time between executions in milliseconds
 * @param options - Leading/trailing edge control and abort signal
 * @returns Throttled function with `cancel`/`flush`/`pending`
 *
 * @example
 * ```typescript
 * // Throttle scroll handler
 * const throttledUpdate = throttle(() => updateVisibleRange(), 100);
 * onDidChangeTextEditorVisibleRanges(() => throttledUpdate());
 *
 * // Only the trailing edge (skip the immediate first call)
 * const trailingOnly = throttle(refresh, 100, { leading: false });
 *
 * throttledUpdate.cancel();
 * ```
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  limit: number,
  options: ThrottleOptions = {}
): ThrottledFunction<T> {
  const { leading = true, trailing = true, signal } = options;
  return createDelayedInvoker(fn, limit, { leading, trailing, maxWait: limit, signal });
}

// ============================================
// withTimeout
// ============================================

/**
 * Error thrown by {@link withTimeout} when the operation does not settle
 * within the given time budget.
 */
export class TimeoutError extends Error {
  constructor(message = 'Operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/**
 * Options for {@link withTimeout}.
 */
export interface WithTimeoutOptions {
  /**
   * External signal that also aborts the wait. Forwarded to a function-form
   * `operation` (combined with the internal timeout signal), so cooperative
   * work can cancel itself for either reason.
   */
  signal?: AbortSignal;
}

/**
 * An async operation to race against a timeout. Pass a plain `Promise` when
 * the underlying work cannot be cancelled, or a function receiving an
 * {@link AbortSignal} so it can cooperatively cancel (e.g. forward the
 * signal into `fetch`) when the timeout — or an external `options.signal` —
 * fires.
 */
export type TimeoutOperation<T> = Promise<T> | ((signal: AbortSignal) => Promise<T>);

/**
 * Races a promise (or promise-returning function) against a timeout.
 *
 * Rejects with a {@link TimeoutError} if `ms` elapses first. If
 * `options.signal` aborts before either the operation settles or the
 * timeout fires, rejects with that signal's abort reason instead. When
 * `operation` is a function, it receives a combined signal that aborts on
 * timeout *or* external abort, so cancellable work can stop promptly rather
 * than merely being ignored.
 *
 * @param operation - The promise to await, or a function that starts one
 * @param ms - Timeout in milliseconds
 * @param options - Optional external abort signal
 * @returns The operation's result if it settles before the timeout
 * @throws {TimeoutError} If the timeout elapses first
 *
 * @example
 * ```typescript
 * // Time-box a call that isn't itself cancellable
 * const data = await withTimeout(fetchData(url), 5000);
 *
 * // Forward the combined signal so the operation can cancel itself
 * const response = await withTimeout((signal) => fetch(url, { signal }), 5000);
 * ```
 */
export async function withTimeout<T>(
  operation: TimeoutOperation<T>,
  ms: number,
  options: WithTimeoutOptions = {}
): Promise<T> {
  const externalSignal = options.signal;
  if (externalSignal?.aborted === true) {
    // A promise-form operation was already created by the caller's argument
    // evaluation, and the synchronous throw below skips the `.then` that would
    // have handled it. Claim its rejection first, or a promise that settles
    // after this point surfaces as an unhandled rejection. A function-form
    // operation has not run yet, so there is nothing to guard.
    if (typeof operation !== 'function') {
      void operation.catch(() => undefined);
    }
    externalSignal.throwIfAborted();
  }

  const controller = new AbortController();
  const forwardAbort = (): void => controller.abort(externalSignal?.reason);
  externalSignal?.addEventListener('abort', forwardAbort, { once: true });

  const settleSource: Promise<T> =
    typeof operation === 'function' ? (async () => operation(controller.signal))() : operation;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort(new TimeoutError(`Operation timed out after ${ms}ms`));
      }, ms);

      controller.signal.addEventListener('abort', () => reject(controller.signal.reason), {
        once: true,
      });

      settleSource.then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

// ============================================
// Timing Measurement
// ============================================

/**
 * Result of a timed operation.
 */
export interface TimingResult<T> {
  /** The result of the operation */
  result: T;
  /** Duration in milliseconds */
  duration: number;
}

/**
 * Options for timing operations.
 */
export interface TimingOptions {
  /** Logger to output timing information */
  logger?: Logger;
  /** Log level for timing output (default: 'debug') */
  logLevel?: 'debug' | 'info';
  /** Custom message formatter */
  formatMessage?: (name: string, duration: number) => string;
}

/**
 * Measures the execution time of a function.
 *
 * @param name - Name/label for the operation being timed
 * @param fn - Function to execute and time
 * @param options - Timing options
 * @returns Promise with result and duration
 *
 * @example
 * ```typescript
 * // Basic timing
 * const { result, duration } = await withTiming('fetchData', () => fetchData(url));
 * console.log(`Fetched in ${duration}ms`);
 *
 * // With logger
 * const { result } = await withTiming('processFile', async () => {
 *   return await processFile(file);
 * }, { logger, logLevel: 'info' });
 * ```
 */
export async function withTiming<T>(
  name: string,
  fn: () => T | Promise<T>,
  options: TimingOptions = {}
): Promise<TimingResult<T>> {
  const { logger, logLevel = 'debug', formatMessage } = options;

  const start = performance.now();

  try {
    const result = await fn();
    const duration = performance.now() - start;

    if (logger) {
      const message = formatMessage
        ? formatMessage(name, duration)
        : `${name} completed in ${duration.toFixed(2)}ms`;

      if (logLevel === 'info') {
        logger.info(message);
      } else {
        logger.debug(message);
      }
    }

    return { result, duration };
  } catch (error) {
    const duration = performance.now() - start;

    if (logger) {
      const message = `${name} failed after ${duration.toFixed(2)}ms`;

      if (logLevel === 'info') {
        logger.info(message);
      } else {
        logger.debug(message);
      }
    }

    throw error;
  }
}

/**
 * Wraps a function to always measure its execution time.
 *
 * @param name - Name/label for the operation
 * @param fn - Function to wrap
 * @param options - Timing options
 * @returns Wrapped function that logs timing on each call
 *
 * @example
 * ```typescript
 * const timedFetch = measureTime('fetch', fetch, { logger });
 * const response = await timedFetch(url);
 * // Logs: "fetch completed in Xms"
 * ```
 */
export function measureTime<TArgs extends unknown[], TReturn>(
  name: string,
  fn: (...args: TArgs) => TReturn | Promise<TReturn>,
  options: TimingOptions = {}
): (...args: TArgs) => Promise<TimingResult<TReturn>> {
  return async (...args: TArgs): Promise<TimingResult<TReturn>> => {
    return withTiming(name, () => fn(...args), options);
  };
}
