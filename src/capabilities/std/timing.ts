import type { Logger } from '../../foundation/logging/logger.js';

// ---------------------------------------------------------------------------
// Debounce / throttle shared engine
// ---------------------------------------------------------------------------

interface DelayedInvokerOptions {
  readonly leading: boolean;
  readonly trailing: boolean;
  readonly maxWait: number | undefined;
  readonly signal: AbortSignal | undefined;
}

interface DelayedInvoker<T extends (...args: never[]) => void> {
  (...args: Parameters<T>): void;
  cancel(): void;
  flush(): void;
  pending(): boolean;
}

/**
 * Shared timer state machine backing both {@link debounce} and {@link throttle}.
 *
 * `throttle` is `debounce` with `maxWait` pinned to the interval and `leading`
 * defaulted to `true` — the same relationship lodash's implementations have. One
 * well-tested state machine beats two subtly different ones.
 */
function createDelayedInvoker<T extends (...args: never[]) => void>(
  fn: T,
  wait: number,
  { leading, trailing, maxWait, signal }: DelayedInvokerOptions
): DelayedInvoker<T> {
  type Args = Parameters<T>;

  let lastArgs: Args | undefined;
  let lastCallTime: number | undefined;
  let lastInvokeTime = 0;
  let timerId: ReturnType<typeof setTimeout> | undefined;
  let aborted = false;

  // Derived directly from maxWait so control-flow analysis narrows it, instead of
  // carrying a separate boolean and casting away the undefined.
  const effectiveMaxWait = maxWait === undefined ? undefined : Math.max(maxWait, wait);

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
      (effectiveMaxWait !== undefined && timeSinceLastInvoke >= effectiveMaxWait)
    );
  }

  function remainingWait(time: number): number {
    const timeSinceLastCall = time - (lastCallTime ?? time);
    const timeSinceLastInvoke = time - lastInvokeTime;
    const timeWaiting = wait - timeSinceLastCall;
    return effectiveMaxWait === undefined
      ? timeWaiting
      : Math.min(timeWaiting, effectiveMaxWait - timeSinceLastInvoke);
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
    // Once the signal has aborted the function stays inert. The signal is
    // normally a scope's, so a late event must not run the handler after
    // teardown -- cancelling only the pending call would still allow that.
    if (aborted) {
      return;
    }

    const time = Date.now();
    const isInvoking = shouldInvoke(time);

    lastArgs = args;
    lastCallTime = time;

    if (isInvoking) {
      if (timerId === undefined) {
        leadingEdge(time);
        return;
      }
      if (effectiveMaxWait !== undefined) {
        // Calls keep arriving faster than `wait`; maxWait forces progress.
        // The timer being replaced here is still armed — `timerId` is known to
        // be set on this branch — so it has to be cleared first. Overwriting
        // the handle alone leaves it running, and it fires an extra trailing
        // invocation later, once per forced call.
        clearTimeout(timerId);
        timerId = setTimeout(timerExpired, wait);
        invoke(time);
        return;
      }
    }
    if (timerId === undefined) {
      timerId = setTimeout(timerExpired, wait);
    }
  }) as DelayedInvoker<T>;

  invoker.cancel = (): void => {
    if (timerId !== undefined) {
      clearTimeout(timerId);
    }
    lastInvokeTime = 0;
    lastArgs = undefined;
    lastCallTime = undefined;
    timerId = undefined;
  };

  invoker.flush = (): void => {
    if (timerId === undefined) {
      return;
    }
    clearTimeout(timerId);
    timerId = undefined;
    trailingEdge(Date.now());
  };

  invoker.pending = (): boolean => timerId !== undefined;

  if (signal !== undefined) {
    if (signal.aborted) {
      aborted = true;
      invoker.cancel();
    } else {
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          invoker.cancel();
        },
        { once: true }
      );
    }
  }

  return invoker;
}

// ---------------------------------------------------------------------------
// Debounce
// ---------------------------------------------------------------------------

/** Options for {@link debounce}. */
export interface DebounceOptions {
  /**
   * Invoke on the leading edge, as soon as a burst starts, in addition to any
   * trailing invocation.
   *
   * @defaultValue false
   */
  readonly leading?: boolean;
  /**
   * Invoke on the trailing edge — the classic debounce: run once activity has
   * stopped for `delay` ms.
   *
   * @defaultValue true
   */
  readonly trailing?: boolean;
  /**
   * Upper bound on how long invocation can be deferred while calls keep
   * arriving faster than `delay`. Without it, a continuously-called function
   * never runs.
   */
  readonly maxWait?: number;
  /**
   * Cancels any pending invocation when aborted, and leaves the function inert
   * afterwards: later calls do nothing.
   *
   * Stronger than plain `cancel()` on purpose. The signal is normally a scope's,
   * so a late event must not run the handler after teardown.
   */
  readonly signal?: AbortSignal;
}

/** A debounced function with cancellation and introspection helpers. */
export interface DebouncedFunction<T extends (...args: never[]) => void> {
  (...args: Parameters<T>): void;
  /** Cancels any pending invocation and resets timing state. */
  cancel(): void;
  /**
   * Runs a pending trailing invocation immediately when trailing delivery is
   * enabled; otherwise it only clears the timer.
   */
  flush(): void;
  /** True while an invocation is scheduled but has not run. */
  pending(): boolean;
}

/**
 * Delays execution until `delay` ms have passed since the last call.
 *
 * @example
 * ```ts
 * const search = debounce((query: string) => runSearch(query), 300);
 * // Force progress at least every 2s even under continuous typing:
 * const save = debounce(persist, 500, { maxWait: 2000 });
 *
 * search.cancel();
 * save.flush();
 * ```
 */
export function debounce<T extends (...args: never[]) => void>(
  fn: T,
  delay: number,
  options: DebounceOptions = {}
): DebouncedFunction<T> {
  return createDelayedInvoker(fn, delay, {
    leading: options.leading ?? false,
    trailing: options.trailing ?? true,
    maxWait: options.maxWait,
    signal: options.signal,
  });
}

// ---------------------------------------------------------------------------
// Throttle
// ---------------------------------------------------------------------------

/** Options for {@link throttle}. */
export interface ThrottleOptions {
  /**
   * Invoke immediately on the first call of a burst.
   *
   * @defaultValue true
   */
  readonly leading?: boolean;
  /**
   * Invoke once more after the burst ends, with the most recent arguments, if
   * calls were dropped in between.
   *
   * @defaultValue true
   */
  readonly trailing?: boolean;
  /**
   * Cancels any pending invocation when aborted, and leaves the function inert
   * afterwards: later calls do nothing.
   */
  readonly signal?: AbortSignal;
}

/** A throttled function with cancellation and introspection helpers. */
export interface ThrottledFunction<T extends (...args: never[]) => void> {
  (...args: Parameters<T>): void;
  /** Cancels any pending trailing invocation and resets timing state. */
  cancel(): void;
  /**
   * Runs a pending trailing invocation immediately when trailing delivery is
   * enabled; otherwise it only clears the timer.
   */
  flush(): void;
  /** True while a trailing invocation is scheduled but has not run. */
  pending(): boolean;
}

/**
 * Executes at most once per `limit` ms: immediately on the leading edge by
 * default, and once more on the trailing edge if further calls arrived.
 *
 * @example
 * ```ts
 * const update = throttle(() => refreshVisibleRange(), 100);
 * const trailingOnly = throttle(refresh, 100, { leading: false });
 * ```
 */
export function throttle<T extends (...args: never[]) => void>(
  fn: T,
  limit: number,
  options: ThrottleOptions = {}
): ThrottledFunction<T> {
  return createDelayedInvoker(fn, limit, {
    leading: options.leading ?? true,
    trailing: options.trailing ?? true,
    maxWait: limit,
    signal: options.signal,
  });
}

// ---------------------------------------------------------------------------
// withTimeout
// ---------------------------------------------------------------------------

/** Thrown by {@link withTimeout} when the operation misses its budget. */
export class TimeoutError extends Error {
  constructor(message = 'Operation timed out') {
    super(message);
    this.name = 'TimeoutError';
  }
}

/** Options for {@link withTimeout}. */
export interface WithTimeoutOptions {
  /**
   * External signal that also aborts the wait. Combined with the internal
   * timeout signal and forwarded to a function-form operation, so cooperative
   * work can cancel itself for either reason.
   */
  readonly signal?: AbortSignal;
}

/**
 * Work to race against a timeout.
 *
 * Pass a plain promise when the work cannot be cancelled, or a function taking
 * an `AbortSignal` so it can cancel itself when the timeout — or an external
 * signal — fires.
 */
export type TimeoutOperation<T> = Promise<T> | ((signal: AbortSignal) => Promise<T>);

/**
 * Races work against a timeout.
 *
 * Rejects with {@link TimeoutError} if `ms` elapses first, or with the external
 * signal's reason if that aborts first. A function-form operation receives a
 * signal that aborts on either, so cancellable work stops promptly instead of
 * merely having its result ignored.
 *
 * A plain promise cannot be cancelled: timeout only stops waiting for its
 * result. Prefer the function form for I/O or mutations that accept a signal.
 *
 * @example
 * ```ts
 * const data = await withTimeout(fetchData(url), 5000);
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
    // A promise-form operation was already created when the caller's argument
    // was evaluated, and the throw below skips the `.then` that would have
    // handled it. Claim its rejection first, or a later settlement surfaces as
    // an unhandled rejection. A function-form operation has not run yet.
    if (typeof operation !== 'function') {
      void operation.catch(() => undefined);
    }
    externalSignal.throwIfAborted();
  }

  const controller = new AbortController();
  const forwardAbort = (): void => {
    const reason: unknown = externalSignal?.reason;
    controller.abort(reason);
  };
  externalSignal?.addEventListener('abort', forwardAbort, { once: true });

  const settleSource: Promise<T> =
    typeof operation === 'function' ? (async () => operation(controller.signal))() : operation;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort(new TimeoutError(`Operation timed out after ${String(ms)}ms`));
      }, ms);

      controller.signal.addEventListener(
        'abort',
        () => {
          const reason: unknown = controller.signal.reason;
          reject(reason instanceof Error ? reason : new Error(String(reason)));
        },
        { once: true }
      );

      settleSource.then(resolve, reject);
    });
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener('abort', forwardAbort);
  }
}

// ---------------------------------------------------------------------------
// Timing measurement
// ---------------------------------------------------------------------------

/** Result of a timed operation. */
export interface TimingResult<T> {
  /** What the operation returned. */
  readonly result: T;
  /** Duration in milliseconds. */
  readonly duration: number;
}

/** Options for {@link withTiming} and {@link measureTime}. */
export interface TimingOptions {
  /** Receives the timing line. */
  readonly logger?: Logger;
  /**
   * Level to log at.
   *
   * @defaultValue 'debug'
   */
  readonly logLevel?: 'debug' | 'info';
  /**
   * Custom success-message formatter. Failure messages keep the standard
   * `"name failed after …"` form.
   */
  readonly formatMessage?: (name: string, duration: number) => string;
}

/**
 * Measures how long a function takes, logging it if a logger is given.
 *
 * @example
 * ```ts
 * const { result, duration } = await withTiming('fetchData', () => fetchData(url));
 * ```
 */
export async function withTiming<T>(
  name: string,
  fn: () => T | Promise<T>,
  options: TimingOptions = {}
): Promise<TimingResult<T>> {
  const { logger, logLevel = 'debug', formatMessage } = options;
  const start = performance.now();

  const log = (message: string): void => {
    if (logger === undefined) {
      return;
    }
    if (logLevel === 'info') {
      logger.info(message);
    } else {
      logger.debug(message);
    }
  };

  try {
    const result = await fn();
    const duration = performance.now() - start;
    log(
      formatMessage === undefined
        ? `${name} completed in ${duration.toFixed(2)}ms`
        : formatMessage(name, duration)
    );
    return { result, duration };
  } catch (error) {
    log(`${name} failed after ${(performance.now() - start).toFixed(2)}ms`);
    throw error;
  }
}

/**
 * Wraps a function so every call is timed.
 *
 * @example
 * ```ts
 * const timedLoad = measureTime('load', load, { logger });
 * const { result } = await timedLoad(uri);
 * ```
 */
export function measureTime<TArgs extends unknown[], TReturn>(
  name: string,
  fn: (...args: TArgs) => TReturn | Promise<TReturn>,
  options: TimingOptions = {}
): (...args: TArgs) => Promise<TimingResult<TReturn>> {
  return (...args: TArgs): Promise<TimingResult<TReturn>> =>
    withTiming(name, () => fn(...args), options);
}
