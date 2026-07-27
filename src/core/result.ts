/**
 * Result type for operations that may fail, with explicit cancellation
 * tracking on the failure branch.
 *
 * The library-wide convention:
 * - APIs that ask a single question (pick, input, notifications) return
 *   `T | undefined`, matching VS Code's own vocabulary where `undefined`
 *   means the user dismissed the prompt.
 * - APIs that perform fallible work return `Result` via their `try`-prefixed
 *   variant (`tryRun`), while the plain variant collapses failures to
 *   `undefined` for callers that don't need the error.
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E; readonly cancelled: boolean };

/** Creates a success Result. */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Creates a failure Result.
 *
 * @param error - The error value
 * @param opts - Set `cancelled: true` when the failure represents a user
 *   cancellation rather than a real error
 */
export function err<E>(error: E, opts: { cancelled?: boolean } = {}): Result<never, E> {
  return { ok: false, error, cancelled: opts.cancelled ?? false };
}

/**
 * Returns the success value or throws the error.
 * Non-Error failure values are wrapped in an `Error`.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw result.error instanceof Error ? result.error : new Error(String(result.error));
}

/** Returns the success value or the given fallback. */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/** Transforms the success value, passing failures through unchanged. */
export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/** Transforms the failure value, passing successes through unchanged. */
export function mapResultErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : { ok: false, error: fn(result.error), cancelled: result.cancelled };
}
