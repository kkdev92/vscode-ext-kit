/**
 * Minimal, zero-dependency schema toolkit shared by config and storage.
 *
 * The interface is compatible with the Standard Schema specification
 * (https://standardschema.dev), restricted to synchronous validation:
 * any library that implements Standard Schema v1 with a synchronous
 * `validate` (zod, valibot, ArkType, ...) can be passed wherever this
 * library accepts a schema — the built-in `s.*` builders are just the
 * dependency-free default.
 */

export interface SchemaIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey>;
}

export type SchemaResult<Output> =
  { readonly value: Output } | { readonly issues: ReadonlyArray<SchemaIssue> };

export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    /**
     * Synchronous validation only. Standard Schema allows returning a
     * Promise, but configuration and storage reads are synchronous in
     * VS Code, so async validators are rejected at the type level.
     */
    readonly validate: (value: unknown) => SchemaResult<Output>;
  };
}

/** Extracts the output type of a schema. */
export type Infer<S extends StandardSchemaV1> =
  S extends StandardSchemaV1<unknown, infer Output> ? Output : never;

const VENDOR = 'vscode-ext-kit';

function pass<Output>(value: Output): SchemaResult<Output> {
  return { value };
}

function fail(message: string, path?: ReadonlyArray<PropertyKey>): SchemaResult<never> {
  return { issues: [{ message, path }] };
}

function make<Output>(
  validate: (value: unknown) => SchemaResult<Output>
): StandardSchemaV1<unknown, Output> {
  return { '~standard': { version: 1, vendor: VENDOR, validate } };
}

/** Runs a schema and returns the typed result. */
export function validateSchema<Output>(
  schema: StandardSchemaV1<unknown, Output>,
  value: unknown
): SchemaResult<Output> {
  return schema['~standard'].validate(value);
}

export interface StringOptions {
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
}

export interface NumberOptions {
  min?: number;
  max?: number;
  integer?: boolean;
}

/**
 * Built-in schema builders. Dependency-free; swap in zod/valibot via the
 * shared {@link StandardSchemaV1} interface whenever more power is needed.
 */
export const s = {
  string(opts: StringOptions = {}): StandardSchemaV1<unknown, string> {
    return make((v) => {
      if (typeof v !== 'string') return fail('must be a string');
      if (opts.minLength !== undefined && v.length < opts.minLength) {
        return fail(`must have at least ${opts.minLength} characters`);
      }
      if (opts.maxLength !== undefined && v.length > opts.maxLength) {
        return fail(`must have at most ${opts.maxLength} characters`);
      }
      if (opts.pattern && !opts.pattern.test(v)) {
        return fail(`must match ${opts.pattern}`);
      }
      return pass(v);
    });
  },

  number(opts: NumberOptions = {}): StandardSchemaV1<unknown, number> {
    return make((v) => {
      if (typeof v !== 'number' || Number.isNaN(v)) return fail('must be a number');
      if (opts.integer && !Number.isInteger(v)) return fail('must be an integer');
      if (opts.min !== undefined && v < opts.min) return fail(`must be >= ${opts.min}`);
      if (opts.max !== undefined && v > opts.max) return fail(`must be <= ${opts.max}`);
      return pass(v);
    });
  },

  boolean(): StandardSchemaV1<unknown, boolean> {
    return make((v) => (typeof v === 'boolean' ? pass(v) : fail('must be a boolean')));
  },

  /** A union of literal values; the output type narrows to the union. */
  enum<const T extends readonly [string | number | boolean, ...(string | number | boolean)[]]>(
    ...values: T
  ): StandardSchemaV1<unknown, T[number]> {
    return make((v) =>
      (values as readonly unknown[]).includes(v)
        ? pass(v as T[number])
        : fail(`must be one of ${values.map((x) => JSON.stringify(x)).join(', ')}`)
    );
  },

  array<Item>(item: StandardSchemaV1<unknown, Item>): StandardSchemaV1<unknown, Item[]> {
    return make((v) => {
      if (!Array.isArray(v)) return fail('must be an array');
      const out: Item[] = [];
      for (let i = 0; i < v.length; i++) {
        const result = item['~standard'].validate(v[i]);
        if ('issues' in result) {
          const issue = result.issues[0];
          return fail(issue?.message ?? 'invalid item', [i, ...(issue?.path ?? [])]);
        }
        out.push(result.value);
      }
      return pass(out);
    });
  },

  object<Shape extends Record<string, StandardSchemaV1>>(
    shape: Shape
  ): StandardSchemaV1<unknown, { [K in keyof Shape]: Infer<Shape[K]> }> {
    return make((v) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return fail('must be an object');
      }
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(shape)) {
        const result = shape[key]!['~standard'].validate((v as Record<string, unknown>)[key]);
        if ('issues' in result) {
          const issue = result.issues[0];
          return fail(issue?.message ?? 'invalid property', [key, ...(issue?.path ?? [])]);
        }
        out[key] = result.value;
      }
      return pass(out as { [K in keyof Shape]: Infer<Shape[K]> });
    });
  },

  /** Accepts `undefined` in addition to the inner schema. */
  optional<Output>(
    inner: StandardSchemaV1<unknown, Output>
  ): StandardSchemaV1<unknown, Output | undefined> {
    return make((v) => (v === undefined ? pass(undefined) : inner['~standard'].validate(v)));
  },

  /** A string-keyed record with uniformly-typed values. */
  record<Value>(
    value: StandardSchemaV1<unknown, Value>
  ): StandardSchemaV1<unknown, Record<string, Value>> {
    return make((v) => {
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return fail('must be an object');
      }
      const out: Record<string, Value> = {};
      for (const [key, item] of Object.entries(v)) {
        const result = value['~standard'].validate(item);
        if ('issues' in result) {
          const issue = result.issues[0];
          return fail(issue?.message ?? 'invalid value', [key, ...(issue?.path ?? [])]);
        }
        out[key] = result.value;
      }
      return pass(out);
    });
  },

  /** Passes any value through unchanged. */
  unknown(): StandardSchemaV1<unknown, unknown> {
    return make((v) => pass(v));
  },

  /** Escape hatch: builds a schema from a type guard. */
  custom<Output>(
    check: (value: unknown) => value is Output,
    message = 'invalid value'
  ): StandardSchemaV1<unknown, Output> {
    return make((v) => (check(v) ? pass(v) : fail(message)));
  },
};
