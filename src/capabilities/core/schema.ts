/**
 * Minimal, zero-dependency schema toolkit.
 *
 * The interface is the Standard Schema v1 interface (https://standardschema.dev)
 * verbatim, so any library implementing it — zod, valibot, ArkType — is
 * assignable wherever the framework accepts a schema. The built-in `s.*`
 * builders are just the dependency-free default.
 *
 * Two details of the spec are part of this module's compatibility boundary:
 *
 * - `validate` may return `Result | Promise<Result>`. Narrowing that in the
 *   type cannot safely narrow that without breaking structural compatibility.
 *   The interface therefore keeps the specification's return type, while the
 *   framework's synchronous consumption rule is enforced at runtime by
 *   {@link validateSchema}.
 * - An issue's `path` is `ReadonlyArray<PropertyKey | PathSegment>`: a segment
 *   may be a raw key *or* an object carrying one.
 *
 * Sync-only remains deliberate: settings and storage reads happen on
 * synchronous paths, so an async validator cannot be awaited there. It fails
 * loudly instead of being skipped.
 */

import { defineOwn } from '../../foundation/internal/record.js';
import { claimRejection, isThenable } from '../../foundation/internal/thenable.js';

/**
 * One path segment in its object form, as the Standard Schema spec allows
 * alongside a bare `PropertyKey`.
 */
export interface SchemaPathSegment {
  readonly key: PropertyKey;
}

/** One validation problem, optionally located within the value. */
export interface SchemaIssue {
  readonly message: string;
  /** Spec shape: each segment is a raw key or an object carrying one. */
  readonly path?: ReadonlyArray<PropertyKey | SchemaPathSegment> | undefined;
}

/** Outcome of validating a value against a schema. */
export type SchemaResult<Output> =
  { readonly value: Output } | { readonly issues: ReadonlyArray<SchemaIssue> };

/**
 * A Standard Schema v1 validator.
 *
 * `validate` carries the spec's own return type — `Result | Promise<Result>` —
 * so schemas typed against the spec assign in *both* directions without a cast.
 * Do not narrow this to `SchemaResult<Output>` or widen `Promise` to
 * `PromiseLike`: either change alters structural assignability with Standard
 * Schema implementations. The bidirectional assignments in
 * `tests/capabilities/core/standard-schema-interop.test.ts` guard this exact
 * boundary.
 *
 * One parameter is enough even though the spec declares
 * `validate(value, options?)`: a source whose extra parameter is optional is
 * assignable to a single-parameter target, verified by that same test against
 * both the current spec shape and the one-parameter shape libraries ship today.
 *
 * The framework only ever consumes a schema synchronously; {@link validateSchema}
 * rejects a promise at runtime rather than pretending it cannot happen.
 *
 * Assignable to the looser {@link StandardSchemaLike} the command argument path
 * accepts, so an `s.*` schema can validate command arguments too.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => SchemaResult<Output> | Promise<SchemaResult<Output>>;
  };
  /** Phantom carrier for the input type. Never present at runtime. */
  readonly '~input'?: (value: Input) => void;
}

/** Extracts the output type of a schema. */
export type Infer<S extends StandardSchemaV1> =
  S extends StandardSchemaV1<unknown, infer Output> ? Output : never;

const VENDOR = 'vscode-ext-kit';

function pass<Output>(value: Output): SchemaResult<Output> {
  return { value };
}

function fail(
  message: string,
  path?: ReadonlyArray<PropertyKey | SchemaPathSegment>
): SchemaResult<never> {
  // `path` is only set when present: with exactOptionalPropertyTypes an explicit
  // `undefined` is not the same as an absent property.
  return { issues: [{ message, ...(path === undefined ? {} : { path }) }] };
}

function make<Output>(
  validate: (value: unknown) => SchemaResult<Output>
): StandardSchemaV1<unknown, Output> {
  // The built-ins are always synchronous, which is why they can call each
  // other directly through `validateSchema` below.
  return { '~standard': { version: 1, vendor: VENDOR, validate } };
}

/**
 * Runs a schema synchronously and returns the typed result.
 *
 * The one place the framework calls a validator, so it is the one place that
 * has to hold the sync-only line. The spec permits `validate` to return a
 * promise, and the spec's own FAQ tells sync-only consumers to detect that and
 * throw — which is what happens here. Without it an async validator's promise
 * was treated as a successful result, and every read silently returned
 * `undefined` while reporting success.
 *
 * @throws TypeError when the schema validates asynchronously. A synchronous
 * third-party validator exception is propagated unchanged.
 *
 * @example
 * ```ts
 * const result = validateSchema(s.number({ min: 1 }), raw);
 * if ('issues' in result) throw new Error(result.issues[0]?.message);
 * use(result.value);
 * ```
 */
export function validateSchema<Output>(
  schema: StandardSchemaV1<unknown, Output>,
  value: unknown
): SchemaResult<Output> {
  const outcome = schema['~standard'].validate(value);
  if (isThenable(outcome)) {
    // Claim the rejection: the result is discarded, and an async validator that
    // also rejects must not surface as an unhandled rejection on top of this.
    claimRejection(outcome);
    throw new TypeError(
      `Schema "${schema['~standard'].vendor}" validates asynchronously, which this path ` +
        'cannot await. Settings, storage and command arguments are validated on ' +
        'synchronous paths; use a synchronous schema.'
    );
  }
  return outcome;
}

/** Constraints for {@link s.string}. */
export interface StringOptions {
  /** Inclusive minimum number of UTF-16 code units. */
  readonly minLength?: number;
  /** Inclusive maximum number of UTF-16 code units. */
  readonly maxLength?: number;
  /**
   * Pattern passed to `RegExp.test`. The expression is not implicitly anchored.
   * Avoid `g`/`y` expressions whose mutable `lastIndex` makes repeated
   * validation stateful.
   */
  readonly pattern?: RegExp;
}

/** Constraints for {@link s.number}. */
export interface NumberOptions {
  /** Inclusive lower bound. */
  readonly min?: number;
  /** Inclusive upper bound. */
  readonly max?: number;
  /** When true, requires `Number.isInteger(value)`. */
  readonly integer?: boolean;
}

/**
 * Built-in schema builders. Dependency-free; supply any synchronous Standard
 * Schema implementation through {@link StandardSchemaV1} when more expressive
 * validation or transformation is needed.
 *
 * Composite builders stop at the first issue and prefix its path. `object`
 * projects the declared shape and does not copy unknown properties. These are
 * intentionally small defaults, not a replacement for a full schema library.
 *
 * @example
 * ```ts
 * const schema = s.object({
 *   name: s.string({ minLength: 1 }),
 *   tags: s.array(s.string()),
 *   mode: s.enum('fast', 'thorough'),
 *   limit: s.optional(s.number({ integer: true, min: 1 })),
 * });
 * type Value = Infer<typeof schema>;
 * ```
 */
export const s = {
  string(options: StringOptions = {}): StandardSchemaV1<unknown, string> {
    return make((value) => {
      if (typeof value !== 'string') {
        return fail('must be a string');
      }
      if (options.minLength !== undefined && value.length < options.minLength) {
        return fail(`must have at least ${String(options.minLength)} characters`);
      }
      if (options.maxLength !== undefined && value.length > options.maxLength) {
        return fail(`must have at most ${String(options.maxLength)} characters`);
      }
      if (options.pattern !== undefined && !options.pattern.test(value)) {
        return fail(`must match ${String(options.pattern)}`);
      }
      return pass(value);
    });
  },

  number(options: NumberOptions = {}): StandardSchemaV1<unknown, number> {
    return make((value) => {
      if (typeof value !== 'number' || Number.isNaN(value)) {
        return fail('must be a number');
      }
      if (options.integer === true && !Number.isInteger(value)) {
        return fail('must be an integer');
      }
      if (options.min !== undefined && value < options.min) {
        return fail(`must be >= ${String(options.min)}`);
      }
      if (options.max !== undefined && value > options.max) {
        return fail(`must be <= ${String(options.max)}`);
      }
      return pass(value);
    });
  },

  boolean(): StandardSchemaV1<unknown, boolean> {
    return make((value) => (typeof value === 'boolean' ? pass(value) : fail('must be a boolean')));
  },

  /** A union of literal values; the output type narrows to the union. */
  enum<const T extends readonly [string | number | boolean, ...(string | number | boolean)[]]>(
    ...values: T
  ): StandardSchemaV1<unknown, T[number]> {
    return make((value) =>
      (values as readonly unknown[]).includes(value)
        ? pass(value as T[number])
        : fail(`must be one of ${values.map((entry) => JSON.stringify(entry)).join(', ')}`)
    );
  },

  array<Item>(item: StandardSchemaV1<unknown, Item>): StandardSchemaV1<unknown, Item[]> {
    return make((value) => {
      if (!Array.isArray(value)) {
        return fail('must be an array');
      }
      const output: Item[] = [];
      for (const [index, entry] of (value as readonly unknown[]).entries()) {
        const result = validateSchema(item, entry);
        if ('issues' in result) {
          const issue = result.issues[0];
          return fail(issue?.message ?? 'invalid item', [index, ...(issue?.path ?? [])]);
        }
        output.push(result.value);
      }
      return pass(output);
    });
  },

  object<Shape extends Record<string, StandardSchemaV1>>(
    shape: Shape
  ): StandardSchemaV1<unknown, { [K in keyof Shape]: Infer<Shape[K]> }> {
    return make((value) => {
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        return fail('must be an object');
      }
      const source = value as Record<string, unknown>;
      const output: Record<string, unknown> = {};
      for (const [key, schema] of Object.entries(shape)) {
        const result = validateSchema(schema, source[key]);
        if ('issues' in result) {
          const issue = result.issues[0];
          return fail(issue?.message ?? 'invalid property', [key, ...(issue?.path ?? [])]);
        }
        defineOwn(output, key, result.value);
      }
      return pass(output as { [K in keyof Shape]: Infer<Shape[K]> });
    });
  },

  /** Accepts `undefined` in addition to the inner schema. */
  optional<Output>(
    inner: StandardSchemaV1<unknown, Output>
  ): StandardSchemaV1<unknown, Output | undefined> {
    return make((value) => (value === undefined ? pass(undefined) : validateSchema(inner, value)));
  },

  /**
   * Accepts `null` in addition to the inner schema.
   *
   * VS Code settings commonly use `"type": ["string", "null"]` with a `null`
   * default to mean "unset", which {@link s.optional} (which admits `undefined`)
   * does not cover.
   */
  nullable<Output>(
    inner: StandardSchemaV1<unknown, Output>
  ): StandardSchemaV1<unknown, Output | null> {
    return make((value) => (value === null ? pass(null) : validateSchema(inner, value)));
  },

  /**
   * A string-keyed record with uniformly-typed values.
   *
   * Keys come from the input, which for a record is the whole point — and
   * `JSON.parse` produces `__proto__` as a genuine own property, so a record
   * built from parsed JSON can carry one. See `defineOwn` in `foundation/internal/record.ts` for why that key
   * is not written with `output[key] = …`.
   */
  record<Value>(
    value: StandardSchemaV1<unknown, Value>
  ): StandardSchemaV1<unknown, Record<string, Value>> {
    return make((candidate) => {
      if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
        return fail('must be an object');
      }
      const output: Record<string, Value> = {};
      for (const [key, entry] of Object.entries(candidate)) {
        const result = validateSchema(value, entry);
        if ('issues' in result) {
          const issue = result.issues[0];
          return fail(issue?.message ?? 'invalid value', [key, ...(issue?.path ?? [])]);
        }
        defineOwn(output, key, result.value);
      }
      return pass(output);
    });
  },

  /** Passes any value through unchanged. */
  unknown(): StandardSchemaV1<unknown, unknown> {
    return make((value) => pass(value));
  },

  /** Escape hatch: builds a schema from a type guard. */
  custom<Output>(
    check: (value: unknown) => value is Output,
    message = 'invalid value'
  ): StandardSchemaV1<unknown, Output> {
    return make((value) => (check(value) ? pass(value) : fail(message)));
  },
};
