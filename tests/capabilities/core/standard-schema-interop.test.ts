/**
 * Compile-time plus runtime contract suite for Standard Schema v1 interop. The
 * assignments are deliberate type assertions in both directions, while the
 * expectations pin path adaptation. Typecheck failures here usually mean the
 * local structural interface drifted from the external specification shape.
 */
import { describe, expect, it } from 'vitest';

import { s, validateSchema } from '../../../src/capabilities/core/schema.js';
import type { StandardSchemaV1 } from '../../../src/capabilities/core/schema.js';
import { toValidator } from '../../../src/foundation/commands/contract.js';
import type { ArgumentsValidator } from '../../../src/foundation/commands/contract.js';

/**
 * The Standard Schema v1 interface, transcribed from the spec repository
 * (`standard-schema/standard-schema`, `packages/spec/src/index.ts`).
 *
 * A local replica rather than a dependency: the point is to prove assignability
 * against the *declared* shape, and taking on a package just to type-check would
 * add supply-chain surface for no extra proof. Two details of the spec decide
 * whether real schemas assign, and both are easy to get wrong:
 *
 * - `validate` returns `Result | Promise<Result>` — exactly that. Narrowing it
 *   to the sync half rejects real schemas; widening it to `PromiseLike` breaks
 *   the reverse direction, because the spec asks for `Promise`.
 * - `path` segments are `PropertyKey | PathSegment`, not just `PropertyKey`.
 *
 * The spec's `validate` also takes a second, optional `options` parameter. The
 * kit declares one parameter, and these assignments show that is enough: a
 * source whose extra parameter is optional is assignable to a
 * single-parameter target.
 *
 * The assignments below ARE the assertions: if the kit's interface drifts from
 * the spec, `npm run typecheck` fails here rather than a consumer finding out.
 */
interface SpecPathSegment {
  readonly key: PropertyKey;
}
interface SpecIssue {
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey | SpecPathSegment> | undefined;
}
interface SpecSuccessResult<Output> {
  readonly value: Output;
  readonly issues?: undefined;
}
interface SpecFailureResult {
  readonly issues: ReadonlyArray<SpecIssue>;
}
type SpecResult<Output> = SpecSuccessResult<Output> | SpecFailureResult;
interface SpecOptions {
  readonly libraryOptions?: Record<string, unknown> | undefined;
}
interface SpecTypes<Input, Output> {
  readonly input: Input;
  readonly output: Output;
}
interface SpecSchema<Input = unknown, Output = Input> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: SpecTypes<Input, Output> | undefined;
    readonly validate: (
      value: unknown,
      options?: SpecOptions
    ) => SpecResult<Output> | Promise<SpecResult<Output>>;
  };
}

/**
 * The one-parameter shape used by Standard-Schema-compatible libraries. Both
 * this deployed shape and the full specification shape have to assign.
 */
interface DeployedSpecSchema<Output> {
  readonly '~standard': {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (
      value: unknown
    ) => { value: Output } | { issues: readonly { message: string }[] };
  };
}

describe('Standard Schema v1 interop', () => {
  it('accepts a schema typed with the current spec interface', () => {
    const specSchema: SpecSchema<unknown, string> = {
      '~standard': {
        version: 1,
        vendor: 'spec-shaped',
        validate: (value: unknown) =>
          typeof value === 'string'
            ? { value }
            : { issues: [{ message: 'expected a string', path: ['field', { key: 2 }] }] },
      },
    };

    // The assignments ARE the assertions: a drift fails typecheck.
    const asKitSchema: StandardSchemaV1<unknown, string> = specSchema;
    const asArgumentsValidator: ArgumentsValidator<string> = specSchema;

    expect(validateSchema(asKitSchema, 'ok')).toEqual({ value: 'ok' });
    expect(toValidator(asArgumentsValidator).validate('ok')).toEqual({ ok: true, value: 'ok' });

    const failed = toValidator(asArgumentsValidator).validate(1);
    expect(failed.ok).toBe(false);
    // Object path segments must survive the validator boundary as their keys;
    // treating every segment as a primitive loses this location information.
    expect(failed.ok === false && failed.issues[0]?.path).toEqual(['field', 2]);
  });

  it('accepts the deployed one-parameter structural shape', () => {
    const deployed: DeployedSpecSchema<number> = {
      '~standard': {
        version: 1,
        vendor: 'deployed-shape',
        validate: (value: unknown) =>
          typeof value === 'number' ? { value } : { issues: [{ message: 'expected a number' }] },
      },
    };

    const asKitSchema: StandardSchemaV1<unknown, number> = deployed;
    expect(validateSchema(asKitSchema, 7)).toEqual({ value: 7 });
  });

  it('lets a kit schema be consumed as a spec schema', () => {
    // The reverse direction: the built-in builders have to satisfy anything
    // written against the spec, or `s.*` could not be handed to other libraries.
    const kitSchema = s.object({ name: s.string({ minLength: 1 }) });
    const asSpecSchema: SpecSchema<unknown, { name: string }> = kitSchema;

    const outcome = asSpecSchema['~standard'].validate({ name: 'ada' });
    expect(outcome).toEqual({ value: { name: 'ada' } });
  });
});
