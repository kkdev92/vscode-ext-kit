/**
 * Detects a thenable without awaiting it.
 *
 * TypeScript accepts an async function wherever a `void`-returning callback is
 * expected, so callbacks and factories that must stay synchronous are checked at
 * runtime as well as by their declared type.
 *
 * @example
 * ```ts
 * const result = configure(builder);
 * if (isThenable(result)) {
 *   throw new AsyncCallbackError('configure', moduleId);
 * }
 * ```
 */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  // A function counts too. `await` resolves anything with a callable `then`,
  // object or not, so a guard that only looked at objects would let one class
  // of async value through the checks that exist to keep callbacks
  // synchronous.
  return (
    (typeof value === 'object' || typeof value === 'function') &&
    value !== null &&
    typeof (value as { readonly then?: unknown }).then === 'function'
  );
}

/**
 * Attaches a no-op rejection handler to a thenable that is about to be
 * discarded.
 *
 * Every "sync-only callback returned a thenable" guard must call this before
 * throwing: the rejected value is thrown away, so without a handler its
 * eventual rejection would surface as a process-level unhandled rejection on
 * top of the `AsyncCallbackError` the caller already gets.
 */
export function claimRejection(value: unknown): void {
  if (isThenable(value)) {
    void Promise.resolve(value).then(
      () => undefined,
      () => undefined
    );
  }
}

/**
 * Detects the minimal disposable shape the framework tracks. Whether a returned
 * thenable is awaited depends on the owner: ServiceContainer and
 * `ResourceScope.own` await it during teardown, while `RegistrationScope.own`
 * rejects it — that scope exists to close ingress synchronously.
 */
export function isDisposable(value: unknown): value is { dispose(): unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { readonly dispose?: unknown }).dispose === 'function'
  );
}
