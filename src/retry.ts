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
   * Function to determine if an error should trigger a retry.
   * Return true to retry, false to stop.
   * @default () => true (retry all errors)
   */
  retryIf?: (error: unknown, attempt: number) => boolean;

  /**
   * Called before each retry attempt.
   */
  onRetry?: (error: unknown, attempt: number, delay: number) => void;
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

      // Calculate delay for this retry
      const currentDelay = backoff === 'exponential' ? delay * Math.pow(2, attempt - 1) : delay;

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
