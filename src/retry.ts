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
   * @default 'none'
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
 * Executes a function with automatic retry on failure.
 * Supports configurable retry count, delay, and exponential backoff.
 *
 * @param fn - Async function to execute
 * @param options - Retry configuration options
 * @returns The result of the function
 * @throws The last error if all retries are exhausted
 *
 * @example
 * ```typescript
 * // Basic usage with defaults (3 attempts, exponential backoff)
 * const data = await retry(() => fetchData(url));
 *
 * // Custom configuration
 * const result = await retry(
 *   () => unstableApiCall(),
 *   {
 *     maxAttempts: 5,
 *     delay: 500,
 *     backoff: 'exponential',
 *     retryIf: (error) => error instanceof NetworkError,
 *     onRetry: (error, attempt, delay) => {
 *       console.log(`Retry ${attempt} after ${delay}ms`);
 *     },
 *   }
 * );
 *
 * // Linear backoff
 * const response = await retry(
 *   () => httpRequest(),
 *   { backoff: 'linear', delay: 2000 }
 * );
 * ```
 */
export async function retry<T>(fn: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    maxAttempts = 3,
    delay = 1000,
    backoff = 'exponential',
    maxDelay,
    jitter = 'none',
    retryIf = () => true,
    onRetry,
  } = options;

  if (maxAttempts < 1) {
    throw new Error('maxAttempts must be at least 1');
  }

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;

      // Check if we should retry
      if (attempt >= maxAttempts || !retryIf(error, attempt)) {
        throw error;
      }

      // Calculate delay for this retry: backoff -> cap -> jitter
      const baseDelay = backoff === 'exponential' ? delay * Math.pow(2, attempt - 1) : delay;
      const cappedDelay = maxDelay !== undefined ? Math.min(baseDelay, maxDelay) : baseDelay;
      const currentDelay = applyJitter(cappedDelay, jitter);

      // Call onRetry callback if provided
      onRetry?.(error, attempt, currentDelay);

      // Wait before next attempt
      await sleep(currentDelay);
    }
  }

  // This should never be reached, but TypeScript needs it
  throw lastError;
}

/**
 * Creates a sleep promise for the specified duration.
 * @internal
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
