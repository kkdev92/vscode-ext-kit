/**
 * Building a record whose keys the framework did not choose.
 *
 * Dependency names come from a module's declaration; a validated record's keys
 * come from the value being validated. Neither is written by this package, and
 * one key behaves unlike every other.
 */

/**
 * Writes an own property onto a record, for any key including `__proto__`.
 *
 * `target[key] = value` looks equivalent and is, for every key but one.
 * `__proto__` is an accessor inherited from `Object.prototype`, so assigning to
 * it *replaces the object's prototype* rather than creating a property — and
 * silently does nothing at all when the value is a primitive.
 *
 * Both outcomes are wrong, in opposite directions: the entry disappears without
 * anything being reported, or the result quietly *inherits* whatever was
 * supplied, so `result.role` answers while `Object.keys(result)` never mentions
 * it. `JSON.parse` produces `__proto__` as a genuine own property, so any
 * record built from parsed JSON can be handed one.
 *
 * `defineProperty` gives assignment's semantics without the accessor: an own,
 * enumerable, writable, configurable property, for `__proto__` exactly as for
 * any other name.
 *
 * Preferred over building on `Object.create(null)`, which also closes the hole
 * but hands the caller an object with no `Object.prototype` — so a perfectly
 * ordinary `injected.hasOwnProperty(...)` or `String(value)` throws. The fix
 * should not cost the caller anything.
 *
 * @example
 * ```ts
 * const injected: Record<string, unknown> = {};
 * defineOwn(injected, name, resolver.get(token));
 * ```
 */
export function defineOwn(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}
