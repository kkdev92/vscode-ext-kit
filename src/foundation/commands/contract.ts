import { AsyncCallbackError } from '../internal/errors.js';
import { frozenCopy } from '../internal/immutable.js';
import { claimRejection, isThenable } from '../internal/thenable.js';

/** Static metadata for a command. Mirrors what `contributes.commands` declares. */
export interface CommandDescriptor {
  /** Fully-qualified command id, exactly as contributed. */
  readonly id: string;
  /** Title shown in the Command Palette. */
  readonly title?: string;
  /** Category shown in the Command Palette. */
  readonly category?: string;
}

/** A single validation problem safe to expose to command callers. */
export interface ValidationIssue {
  /** Human-readable explanation of the rejected value. */
  readonly message: string;
  /** Optional path from the argument tuple root to the rejected value. */
  readonly path?: readonly (string | number)[];
}

/** Outcome of validating untrusted input. */
export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

/**
 * Minimal validator contract. The core depends on no validator library.
 *
 * Any synchronous Standard Schema v1 validator is also accepted; see
 * `toValidator`.
 */
export interface Validator<T> {
  validate(value: unknown): ValidationResult<T>;
}

/**
 * The subset of Standard Schema v1 the framework consumes.
 *
 * The spec allows `validate` to return either a result or a promise, so
 * "synchronous only" cannot be expressed in the type system: it is enforced at
 * runtime instead.
 */
export interface StandardSchemaLike<T> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    validate(value: unknown): StandardSchemaResult<T> | PromiseLike<StandardSchemaResult<T>>;
  };
}

/**
 * Result shape Standard Schema validators return.
 *
 * The optional members carry an explicit `| undefined`: under
 * `exactOptionalPropertyTypes` a schema whose own type declares
 * `path?: ... | undefined` (as the spec's does) is otherwise not assignable
 * here, which would reject exactly the third-party schemas this is meant to
 * accept. Path segments stay `unknown`: the spec allows a raw key or an object
 * carrying one, and this layer never inspects them.
 */
export interface StandardSchemaResult<T> {
  readonly value?: T | undefined;
  readonly issues?:
    | readonly { readonly message: string; readonly path?: readonly unknown[] | undefined }[]
    | undefined;
}

/**
 * Any synchronous validator the framework accepts for command arguments.
 * Standard Schema implementations that return a promise are rejected at use.
 */
export type ArgumentsValidator<T> = Validator<T> | StandardSchemaLike<T>;

/**
 * A typed command, pairing static metadata with runtime argument and result types.
 *
 * Type safety applies to calls made through the framework's executor. Invocation
 * from the Command Palette, a keybinding, a menu or another extension is runtime
 * input, which is what the optional `args` validator is for.
 *
 * @example
 * ```ts
 * export const RefreshProjects = defineCommandContract<
 *   readonly [options?: { force?: boolean }],
 *   { updated: number }
 * >({ id: 'sample.refreshProjects', title: 'Refresh Projects' });
 * ```
 */
export interface CommandContract<TArgs extends readonly unknown[], TResult> {
  /** Static metadata, including the id used for registration. */
  readonly descriptor: CommandDescriptor;
  /** Optional validator applied to arguments from untrusted callers. */
  readonly args?: ArgumentsValidator<TArgs>;
  /** Phantom carrier for the result type. Never present at runtime. */
  readonly returns?: () => TResult;
}

/** Options accepted by {@link defineCommandContract}. */
export interface CommandContractOptions<TArgs extends readonly unknown[]> {
  /**
   * Validates the argument tuple before the handler runs.
   *
   * Worth adding for commands reachable from menus, keybindings or other
   * extensions, where TypeScript guarantees nothing.
   */
  readonly args?: ArgumentsValidator<TArgs>;
}

/**
 * Declares a typed command contract.
 *
 * @example
 * ```ts
 * const Refresh = defineCommandContract<readonly [force?: boolean], number>(
 *   { id: 'sample.refresh' },
 *   { args: refreshArgsSchema }
 * );
 * ```
 */
export function defineCommandContract<
  TArgs extends readonly unknown[] = readonly [],
  TResult = void,
>(
  descriptor: CommandDescriptor,
  options?: CommandContractOptions<TArgs>
): CommandContract<TArgs, TResult> {
  const args = options?.args;
  // The descriptor is snapshotted, not referenced: the id is what preflight
  // checked for duplicates and what the command registers under, so a later
  // edit to the caller's object must not reach the compiled plan. `args` is an
  // opaque validator and passes through untouched.
  return Object.freeze({
    descriptor: frozenCopy(descriptor),
    ...(args === undefined ? {} : { args }),
  });
}

/**
 * Normalises one Standard Schema path segment.
 *
 * The spec allows a segment to be a bare `PropertyKey` *or* an object carrying
 * one (`{ key }`), and libraries use both. Stringifying blindly turned the
 * object form into `"[object Object]"`, which pointed at nothing.
 */
function toPathSegment(segment: unknown): string | number {
  const key =
    typeof segment === 'object' && segment !== null && 'key' in segment
      ? (segment as { readonly key: PropertyKey }).key
      : segment;
  return typeof key === 'number' ? key : String(key);
}

/**
 * Normalises either accepted validator shape into the one the binder calls.
 *
 * A contract may carry a Standard Schema (zod, valibot, arktype and friends) or
 * a hand-written `Validator`. The binder should not care which, so the
 * difference is resolved once, here.
 *
 * A schema that validates *asynchronously* is rejected rather than awaited:
 * arguments are checked on the synchronous path before a handler runs, and
 * quietly accepting a promise there would mean running the handler on
 * unvalidated input.
 *
 * @throws {@link AsyncCallbackError} when a Standard Schema validator returns
 * a thenable. Any eventual rejection is claimed before the error is thrown.
 *
 * @example
 * ```ts
 * const validator = toValidator(zodSchema); // zod implements Standard Schema
 * const result = validator.validate(rawArgs);
 * ```
 */
export function toValidator<T>(validator: ArgumentsValidator<T>): Validator<T> {
  if ('~standard' in validator) {
    const standard = validator['~standard'];
    return {
      validate(value: unknown): ValidationResult<T> {
        const outcome = standard.validate(value);
        if (isThenable(outcome)) {
          claimRejection(outcome);
          throw new AsyncCallbackError('Standard Schema validate', standard.vendor);
        }
        if (outcome.issues !== undefined && outcome.issues.length > 0) {
          return {
            ok: false,
            issues: outcome.issues.map((issue) => ({
              message: issue.message,
              ...(issue.path === undefined ? {} : { path: issue.path.map(toPathSegment) }),
            })),
          };
        }
        return { ok: true, value: outcome.value as T };
      },
    };
  }
  return validator;
}
