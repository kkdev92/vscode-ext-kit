/**
 * Snapshot helpers for framework-owned plan data.
 *
 * `compileApplication` promises an immutable plan, and preflight's guarantees
 * rest on that: if a command id or a dependency map can change after the
 * checks ran, the checks prove nothing. A plain `Object.freeze` on the plan is
 * not enough — it is shallow, and every nested definition, registration entry
 * and descriptor would still be the caller's live object.
 *
 * The boundary is deliberate. Only the plain containers the framework itself
 * creates or takes ownership of are copied and frozen. Values that merely pass
 * through — validators, schemas, factory and handler functions, tree data
 * providers, icons, `MarkdownString`s, platform option payloads — are left
 * exactly as they arrived: they are opaque to the framework, freezing them
 * could break libraries that memoise internally, and they are not the
 * framework's data to seal.
 */

/**
 * Returns a frozen copy of a framework-owned plain object.
 *
 * A copy rather than an in-place freeze: the caller may keep using (and
 * mutating) the object it passed in, and that must not reach into the plan.
 *
 * @example
 * ```ts
 * const descriptor = frozenCopy(options.descriptor);
 * ```
 */
export function frozenCopy<T extends object>(value: T): T {
  return Object.freeze({ ...value });
}

/**
 * Returns a frozen copy of `value` when it is an array, and `value` unchanged
 * otherwise.
 *
 * For options that accept either one item or a list (glob patterns, document
 * selectors), where only the list form can be mutated behind the plan's back.
 * Element identity is preserved: only the list itself is sealed, so a list of
 * opaque values stays usable.
 */
export function frozenIfArray<T>(value: T): T {
  return Array.isArray(value) ? (Object.freeze([...value]) as T) : value;
}
