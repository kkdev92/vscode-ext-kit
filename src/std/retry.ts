import { withTimeout } from './timing.js';

/**
 * Jitter strategies for randomising delays.
 *
 * - `'none'`: no jitter, delay used as-is
 * - `'full'`: random value in [0, delay]
 * - `'equal'`: random value in [delay/2, delay]
 *
 * `'full'` and `'equal'` are described in
 * [AWS — Exponential Backoff and Jitter](https://aws.amazon.com/blogs/architecture/exponential-backoff-and-jitter/).
 */
export type RetryJitter = 'none' | 'full' | 'equal';

/**
 * Per-attempt context passed to the retried function.
 */
export interface RetryContext {
  /** The current attempt number, starting at 1. */
  attempt: number;
  /**
   * The abort signal forwarded from {@link RetryOptions.signal}, if any.
   * Cooperative: pass it through to cancellable work (e.g. `fetch`) so an
   * abort can stop the in-flight attempt, not just the retry loop's waits.
   */
  signal?: AbortSignal;
}

/**
 * Options for retry behavior.
 */
export interface RetryOptions {
  /**
   * Maximum number of attempts (including the first try).
   * @default 3
   */
  maxAttempts?: number;

  /**
   * Initial delay between retries in milliseconds.
   * @default 1000
   */
  delay?: number;

  /**
   * Backoff strategy for delays between retries.
   * - 'linear': delay stays the same
   * - 'exponential': delay doubles each retry
   * @default 'exponential'
   */
  backoff?: 'linear' | 'exponential';

  /**
   * Upper bound for the computed delay (after backoff, before jitter).
   * Useful with exponential backoff to prevent runaway waits when
   * `maxAttempts` is large. Has no effect if undefined.
   */
  maxDelay?: number;

  /**
   * Jitter strategy applied to the (capped) delay before each retry.
   * Recommended for distributed clients to avoid thundering-herd retries.
   * @default 'full'
   */
  jitter?: RetryJitter;

  /**
   * Function to determine if an error should trigger a retry.
   * Return true to retry, false to stop.
   * @default () => true (retry all errors)
   */
  retryIf?: (error: unknown, attempt: number) => boolean;

  /**
   * Called before each retry attempt. The `delay` argument reflects the
   * actual wait that will happen, including `maxDelay` and `jitter`.
   */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;

  /**
   * Aborts the retry loop: skips any further attempt, interrupts an
   * in-progress inter-retry wait, and is forwarded to `fn` as
   * {@link RetryContext.signal} so an in-flight attempt can cancel itself
   * cooperatively.
   */
  signal?: AbortSignal;

  /**
   * Per-attempt timeout in milliseconds, enforced via `withTimeout` from
   * `./timing.js`. A timed-out attempt throws a `TimeoutError`, which is
   * then treated like any other attempt failure (subject to
   * `retryIf`/`maxAttempts`).
   */
  timeoutMs?: number;
}

/**
 * Thrown when {@link retry} gives up — either every attempt failed
 * (`maxAttempts` reached) or `retryIf` rejected an error. Unlike a plain
 * re-thrown error, this preserves the *entire* attempt history so callers
 * can inspect every failure, not just the last one; the triggering error is
 * also available as `.cause` for compatibility with normal error handling.
 */
export class RetryExhaustedError extends Error {
  constructor(
    message: string,
    /** Total number of attempts made before giving up. */
    readonly attempts: number,
    /** Every error thrown across all attempts, oldest first. */
    readonly history: unknown[],
    options?: { cause?: unknown }
  ) {
    super(message, options);
    this.name = 'RetryExhaustedError';
  }
}

function applyJitter(delay: number, mode: RetryJitter): number {
  switch (mode) {
    case 'full':
      return Math.random() * delay;
    case 'equal':
      return delay / 2 + Math.random() * (delay / 2);
    case 'none':
    default:
      return delay;
  }
}

/**
 * Executes a function with automatic retry on failure. Supports
 * configurable retry count, delay, exponential backoff, per-attempt
 * timeouts, and cooperative cancellation via `AbortSignal`.
 *
 * @param fn - Async function to execute, receiving the current attempt and abort signal
 * @param options - Retry configuration options
 * @returns The result of the function
 * @throws {RetryExhaustedError} If all attempts fail (or `retryIf` rejects an error)
 *
 * @example
 * ```typescript
 * // Basic usage with defaults (3 attempts, exponential backoff, full jitter)
 * const data = await retry(() => fetchData(url));
 *
 * // Cancellable, with a per-attempt timeout and full error history on failure
 * try {
 *   const result = await retry(
 *     ({ signal }) => fetch(url, { signal }).then((r) => r.json()),
 *     { maxAttempts: 5, timeoutMs: 2000, signal: toAbortSignal(token) }
 *   );
 * } catch (error) {
 *   if (error instanceof RetryExhaustedError) {
 *     logger.error(`Gave up after ${error.attempts} attempts`, { history: error.history });
 *   }
 * }
 *
 * // Linear backoff, no jitter, only retry network errors
 * const response = await retry(
 *   () => httpRequest(),
 *   { backoff: 'linear', delay: 2000, jitter: 'none', retryIf: (error) => error instanceof NetworkError }
 * );
 * ```
 */
export async function retry<T>(
  fn: (ctx: RetryContext) => Promise<T>,
  options: RetryOptions = {}
): Promise<T> {
  const {
    maxAttempts = 3,
    delay = 1000,
    backoff = 'exponential',
    maxDelay,
    jitter = 'full',
    retryIf = () => true,
    onRetry,
    signal,
    timeoutMs,
  } = options;

  if (maxAttempts < 1) {
    throw new Error('maxAttempts must be at least 1');
  }

  const history: unknown[] = [];

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    signal?.throwIfAborted();

    try {
      const run = (): Promise<T> => fn({ attempt, signal });
      return timeoutMs !== undefined ? await withTimeout(run, timeoutMs, { signal }) : await run();
    } catch (error: unknown) {
      history.push(error);

      if (attempt >= maxAttempts || !retryIf(error, attempt)) {
        throw new RetryExhaustedError(`Failed after ${attempt} attempt(s)`, attempt, history, {
          cause: error,
        });
      }

      const baseDelay = backoff === 'exponential' ? delay * Math.pow(2, attempt - 1) : delay;
      const cappedDelay = maxDelay !== undefined ? Math.min(baseDelay, maxDelay) : baseDelay;
      const currentDelay = applyJitter(cappedDelay, jitter);

      onRetry?.(error, attempt, currentDelay);

      await sleep(currentDelay, signal);
    }
  }

  // Unreachable: the loop above always returns or throws on its final
  // iteration. Present only to satisfy TypeScript's control-flow analysis.
  throw new RetryExhaustedError('Failed after exhausting all attempts', maxAttempts, history);
}

/**
 * Creates a sleep promise for the specified duration, rejecting early with
 * the signal's abort reason if `signal` aborts while waiting.
 * @internal
 */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason);
  }
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    const timer = setTimeout(() => {
      // Detach the abort hook once the wait is over — a long-lived signal
      // would otherwise collect one dead listener per retry wait until it
      // finally aborts (or is garbage collected).
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
