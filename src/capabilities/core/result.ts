/**
 * Result type for operations that may fail, with explicit cancellation tracking
 * on the failure branch.
 *
 * The framework-wide convention:
 * - APIs that ask a single question (pick, input, notifications) return
 *   `T | undefined`, matching VS Code's own vocabulary where `undefined` means
 *   the user dismissed the prompt.
 * - APIs that perform fallible work and want to report *why* return a `Result`.
 *
 * `cancelled` exists so a caller can tell "the user backed out" apart from "this
 * failed", without inspecting the error. Collapsing the two is the mistake this
 * type is here to prevent.
 *
 * @example
 * ```ts
 * const result = await tryRefresh();
 * if (!result.ok) {
 *   if (result.cancelled) return;
 *   logger.error('refresh failed', result.error);
 *   return;
 * }
 * use(result.value);
 * ```
 */
export type Result<T, E = Error> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E; readonly cancelled: boolean };

/**
 * Creates a success Result.
 *
 * @example
 * ```ts
 * return ok({ updated: 3 });
 * ```
 */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/**
 * Creates a failure Result.
 *
 * @param error - The error value.
 * @param options - Set `cancelled: true` when the failure represents a
 *   cancellation rather than a real error.
 *
 * @example
 * ```ts
 * return err(new Error('no workspace'));
 * return err(cause, { cancelled: true });
 * ```
 */
export function err<E>(error: E, options: { cancelled?: boolean } = {}): Result<never, E> {
  return { ok: false, error, cancelled: options.cancelled ?? false };
}

/**
 * Returns the success value or throws the error. Non-Error failures are wrapped.
 *
 * @example
 * ```ts
 * const value = unwrap(await tryRefresh());
 * ```
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) {
    return result.value;
  }
  throw result.error instanceof Error ? result.error : new Error(String(result.error));
}

/**
 * Returns the success value or the given fallback.
 *
 * @example
 * ```ts
 * const count = unwrapOr(await tryCount(), 0);
 * ```
 */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback;
}

/**
 * Transforms the success value, passing failures through unchanged. If `fn`
 * throws, that exception propagates; it is not converted into `err`.
 *
 * @example
 * ```ts
 * const names = mapResult(result, (projects) => projects.map((p) => p.name));
 * ```
 */
export function mapResult<T, U, E>(result: Result<T, E>, fn: (value: T) => U): Result<U, E> {
  return result.ok ? ok(fn(result.value)) : result;
}

/**
 * Transforms the failure value, passing successes through unchanged.
 *
 * Preserves `cancelled`: mapping an error must not silently turn a cancellation
 * into a failure.
 * If `fn` throws, that exception propagates; it is not wrapped in a `Result`.
 *
 * @example
 * ```ts
 * const wrapped = mapResultErr(result, (cause) => userError({ code: 'X', message: 'Failed.', cause }));
 * ```
 */
export function mapResultErr<T, E, F>(result: Result<T, E>, fn: (error: E) => F): Result<T, F> {
  return result.ok ? result : { ok: false, error: fn(result.error), cancelled: result.cancelled };
}
