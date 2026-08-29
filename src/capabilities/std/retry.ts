import { withTimeout } from './timing.js';

/**
 * Jitter strategies for randomising delays.
 *
 * - `'none'` — delay used as-is
 * - `'full'` — random value in [0, delay]
 * - `'equal'` — random value in [delay/2, delay]
 *
 * `'full'` and `'equal'` come from AWS's exponential-backoff-and-jitter guidance.
 */
export type RetryJitter = 'none' | 'full' | 'equal';

/** Per-attempt context handed to the retried function. */
export interface RetryContext {
  /** Attempt number, starting at 1. */
  readonly attempt: number;
  /**
   * The signal for **this attempt**.
   *
   * Aborts when {@link RetryOptions.signal} aborts, when this attempt's own
   * {@link RetryOptions.timeoutMs} elapses, or when another attempt supersedes
   * it. This per-attempt lifetime prevents cooperative work from continuing
   * under the identity of an attempt that the retry loop has already left.
   *
   * Cooperative: it only has an effect on work that reads it.
   */
  readonly signal: AbortSignal;
}

/** Options for {@link retry}. */
export interface RetryOptions {
  /**
   * Maximum attempts, including the first.
   *
   * @defaultValue 3
   */
  readonly maxAttempts?: number;
  /**
   * Initial delay between attempts in milliseconds.
   *
   * @defaultValue 1000
   */
  readonly delay?: number;
  /**
   * `'linear'` keeps the delay constant; `'exponential'` doubles it each time.
   *
   * @defaultValue 'exponential'
   */
  readonly backoff?: 'linear' | 'exponential';
  /**
   * Upper bound on the computed delay, applied after backoff and before jitter.
   * Stops runaway waits when `maxAttempts` is large.
   */
  readonly maxDelay?: number;
  /**
   * Jitter applied to the capped delay. Worth keeping for anything that several
   * clients might retry at once.
   *
   * @defaultValue 'full'
   */
  readonly jitter?: RetryJitter;
  /**
   * Decides whether an error is worth retrying.
   * If it throws, the loop stops and propagates that exception.
   *
   * @defaultValue retry every error
   */
  readonly retryIf?: (error: unknown, attempt: number) => boolean;
  /**
   * Called before each retry, with the delay that will actually be waited.
   * If it throws, the retry loop stops and propagates that exception.
   */
  readonly onRetry?: (error: unknown, attempt: number, delay: number) => void;
  /**
   * Aborts the loop: skips further attempts, interrupts an in-progress wait, and
   * is forwarded to `fn` as {@link RetryContext.signal}.
   */
  readonly signal?: AbortSignal;
  /**
   * Per-attempt timeout. A timed-out attempt throws `TimeoutError` (from `./timing`), which
   * is then treated like any other failure.
   */
  readonly timeoutMs?: number;
}

/**
 * Thrown when {@link retry} gives up, either because `maxAttempts` was reached
 * or because `retryIf` rejected an error.
 *
 * Unlike a re-thrown error this keeps the *entire* attempt history, so a caller
 * can inspect every failure rather than only the last. The triggering error is
 * also available as `cause` for ordinary error handling.
 */
export class RetryExhaustedError extends Error {
  /** Attempts made before giving up. */
  readonly attempts: number;
  /** Every error thrown across all attempts, oldest first. */
  readonly history: readonly unknown[];

  constructor(
    message: string,
    attempts: number,
    history: readonly unknown[],
    options?: { readonly cause?: unknown }
  ) {
    super(message, ...(options?.cause === undefined ? [] : [{ cause: options.cause }]));
    this.name = 'RetryExhaustedError';
    this.attempts = attempts;
    this.history = history;
  }
}

function applyJitter(delay: number, mode: RetryJitter): number {
  switch (mode) {
    case 'full':
      return Math.random() * delay;
    case 'equal':
      return delay / 2 + Math.random() * (delay / 2);
    case 'none':
      return delay;
  }
}

/**
 * Waits, resolving early and rejecting with the abort reason if `signal` fires.
 *
 * Always detaches its listener: a long-lived signal would otherwise collect a
 * dead listener per retry wait.
 */
function sleep(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted === true) {
    const reason: unknown = signal.reason;
    return Promise.reject(reason instanceof Error ? reason : new Error(String(reason)));
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      const reason: unknown = signal?.reason;
      reject(reason instanceof Error ? reason : new Error(String(reason)));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Runs a function with automatic retry: configurable attempts, backoff, jitter,
 * per-attempt timeout, and cooperative cancellation.
 *
 * @throws {@link RetryExhaustedError} when every attempt failed, or `retryIf`
 * declined the latest failure. An abort reason, `RangeError` for an invalid
 * attempt count, or an exception thrown by `retryIf`/`onRetry` propagates
 * directly instead of being added to attempt history.
 *
 * @example
 * ```ts
 * const data = await retry(() => fetchData(url));
 *
 * try {
 *   await retry(({ signal }) => fetch(url, { signal }), {
 *     maxAttempts: 5,
 *     timeoutMs: 2000,
 *     signal: context.signal,
 *   });
 * } catch (error) {
 *   if (error instanceof RetryExhaustedError) {
 *     logger.error(`gave up after ${error.attempts}`, error, { history: error.history });
 *   }
 * }
 * ```
 */
export async function retry<T>(
  fn: (context: RetryContext) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delay = 1000,
    backoff = 'exponential',
    maxDelay,
    jitter = 'full',
    retryIf = (): boolean => true,
    onRetry,
    signal,
    timeoutMs,
  } = options;

  if (maxAttempts < 1) {
    throw new RangeError('maxAttempts must be at least 1');
  }

  const history: unknown[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    signal?.throwIfAborted();

    // Every attempt gets a signal, even without a per-attempt timeout: `fn`
    // should never have to check whether one exists.
    const attemptController = new AbortController();
    const forwardOuterAbort = (): void => {
      attemptController.abort(signal?.reason);
    };
    signal?.addEventListener('abort', forwardOuterAbort, { once: true });

    try {
      // With a timeout, withTimeout owns the attempt signal: it links the outer
      // signal to the attempt deadline and hands the combined signal to the
      // function form, which is what carries it into `fn`.
      const run = (attemptSignal: AbortSignal): Promise<T> =>
        fn({ attempt, signal: attemptSignal });
      return timeoutMs === undefined
        ? await run(attemptController.signal)
        : await withTimeout(run, timeoutMs, ...(signal === undefined ? [] : [{ signal }]));
    } catch (error) {
      history.push(error);

      if (attempt >= maxAttempts || !retryIf(error, attempt)) {
        signal?.removeEventListener('abort', forwardOuterAbort);
        throw new RetryExhaustedError(
          `Failed after ${String(attempt)} attempt(s)`,
          attempt,
          history,
          { cause: error }
        );
      }

      const baseDelay = backoff === 'exponential' ? delay * Math.pow(2, attempt - 1) : delay;
      const cappedDelay = maxDelay === undefined ? baseDelay : Math.min(baseDelay, maxDelay);
      const currentDelay = applyJitter(cappedDelay, jitter);

      onRetry?.(error, attempt, currentDelay);

      // This attempt is over: tell whatever it started to stop before the next
      // one begins, and stop holding a listener on a long-lived outer signal.
      attemptController.abort(new Error(`Retry attempt ${String(attempt)} was superseded`));
      signal?.removeEventListener('abort', forwardOuterAbort);

      await sleep(currentDelay, signal);
    } finally {
      signal?.removeEventListener('abort', forwardOuterAbort);
    }
  }

  // Unreachable: the final iteration always returns or throws. Present only for
  // control-flow analysis.
  throw new RetryExhaustedError('Failed after exhausting all attempts', maxAttempts, history);
}
