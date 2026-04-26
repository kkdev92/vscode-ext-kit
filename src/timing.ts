import type { Logger } from './types.js';

// ============================================
// Types
// ============================================

/**
 * A debounced function with a cancel method.
 */
export interface DebouncedFunction<T extends (...args: unknown[]) => void> {
  (...args: Parameters<T>): void;
  /** Cancels any pending invocation. */
  cancel: () => void;
}

/**
 * A throttled function with a cancel method.
 */
export interface ThrottledFunction<T extends (...args: unknown[]) => void> {
  (...args: Parameters<T>): void;
  /** Cancels any pending invocation. */
  cancel: () => void;
}

/**
 * Creates a debounced version of a function that delays execution
 * until after the specified delay has elapsed since the last call.
 *
 * @param fn - The function to debounce
 * @param delay - Delay in milliseconds
 * @returns Debounced function with cancel method
 *
 * @example
 * ```typescript
 * // Debounce search input
 * const debouncedSearch = debounce((query: string) => {
 *   performSearch(query);
 * }, 300);
 *
 * // Use in event handler
 * onDidChangeTextDocument((e) => {
 *   debouncedSearch(e.document.getText());
 * });
 *
 * // Cancel pending execution
 * debouncedSearch.cancel();
 * ```
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): DebouncedFunction<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  const debounced = ((...args: Parameters<T>) => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      timeoutId = undefined;
      fn(...args);
    }, delay);
  }) as DebouncedFunction<T>;

  debounced.cancel = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  return debounced;
}

/**
 * Creates a throttled version of a function that only executes
 * at most once per specified time period.
 *
 * @param fn - The function to throttle
 * @param limit - Minimum time between executions in milliseconds
 * @returns Throttled function with cancel method
 *
 * @example
 * ```typescript
 * // Throttle scroll handler
 * const throttledUpdate = throttle(() => {
 *   updateVisibleRange();
 * }, 100);
 *
 * // Use in event handler
 * onDidChangeTextEditorVisibleRanges(() => {
 *   throttledUpdate();
 * });
 *
 * // Cancel pending execution
 * throttledUpdate.cancel();
 * ```
 */
export function throttle<T extends (...args: unknown[]) => void>(
  fn: T,
  limit: number
): ThrottledFunction<T> {
  let lastArgs: Parameters<T> | undefined;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let lastCallTime = 0;

  const throttled = ((...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = limit - (now - lastCallTime);

    if (remaining <= 0) {
      // Execute immediately
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
        timeoutId = undefined;
      }
      lastCallTime = now;
      fn(...args);
    } else {
      // Schedule execution
      lastArgs = args;
      if (timeoutId === undefined) {
        timeoutId = setTimeout(() => {
          timeoutId = undefined;
          lastCallTime = Date.now();
          if (lastArgs !== undefined) {
            fn(...lastArgs);
            lastArgs = undefined;
          }
        }, remaining);
      }
    }
  }) as ThrottledFunction<T>;

  throttled.cancel = () => {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
      timeoutId = undefined;
    }
    lastArgs = undefined;
  };

  return throttled;
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
