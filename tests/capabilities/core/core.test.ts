/**
 * Mixed unit/in-process integration suite for `Result` and the built-in
 * Standard Schema helpers. Pure assertions protect value/error/path semantics;
 * the application test protects the schema boundary on command arguments. A
 * failure should be localized to schema composition, spec adaptation, or
 * command validation before investigating VS Code adapters.
 */
import { describe, expect, it } from 'vitest';

// Node globals the repo's tsconfig deliberately omits, declared locally.
declare const process: {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
};

import { compileApplication } from '../../../src/foundation/application/plan.js';
import { defineCommandContract, toValidator } from '../../../src/foundation/commands/contract.js';
import {
  err,
  mapResult,
  mapResultErr,
  ok,
  unwrap,
  unwrapOr,
} from '../../../src/capabilities/core/result.js';
import type { Result } from '../../../src/capabilities/core/result.js';
import { s, validateSchema } from '../../../src/capabilities/core/schema.js';
import type { StandardSchemaV1 } from '../../../src/capabilities/core/schema.js';
import type { Infer } from '../../../src/capabilities/core/schema.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import { createApplication } from '../../../src/foundation/application/application.js';
import { createFakeCommands } from '../../../src/testing/fakes/fake-commands.js';
import { createFakeEnvironment } from '../../../src/testing/fakes/fake-environment.js';

describe('Result', () => {
  it('carries a success value', () => {
    const result = ok(3);
    expect(result).toEqual({ ok: true, value: 3 });
    expect(unwrap(result)).toBe(3);
  });

  it('defaults cancelled to false', () => {
    const result = err(new Error('boom'));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.cancelled).toBe(false);
    }
  });

  it('records cancellation separately from failure', () => {
    const result = err(new Error('aborted'), { cancelled: true });
    if (!result.ok) {
      expect(result.cancelled).toBe(true);
    }
  });

  it('throws the error on unwrap, wrapping non-Errors', () => {
    expect(() => unwrap(err(new Error('boom')))).toThrow('boom');
    expect(() => unwrap(err('a string'))).toThrow('a string');
  });

  it('returns the fallback on unwrapOr', () => {
    expect(unwrapOr(ok(1), 9)).toBe(1);
    expect(unwrapOr(err(new Error('boom')) as Result<number>, 9)).toBe(9);
  });

  it('maps the success value and passes failures through', () => {
    expect(mapResult(ok(2), (value) => value * 2)).toEqual({ ok: true, value: 4 });

    const failure = err(new Error('boom')) as Result<number>;
    expect(mapResult(failure, (value) => value * 2)).toBe(failure);
  });

  it('preserves cancelled when mapping the error', () => {
    const cancelled = err(new Error('aborted'), { cancelled: true });
    const mapped = mapResultErr(cancelled, (error) => error.message);

    expect(mapped.ok).toBe(false);
    if (!mapped.ok) {
      // Mapping an error must not turn a cancellation into a plain failure.
      expect(mapped.cancelled).toBe(true);
      expect(mapped.error).toBe('aborted');
    }
  });
});

describe('s.* schemas', () => {
  const issues = (result: ReturnType<typeof validateSchema>): readonly string[] =>
    'issues' in result ? result.issues.map((issue) => issue.message) : [];

  it('validates strings with length and pattern constraints', () => {
    expect(validateSchema(s.string(), 'x')).toEqual({ value: 'x' });
    expect(issues(validateSchema(s.string(), 1))).toEqual(['must be a string']);
    expect(issues(validateSchema(s.string({ minLength: 2 }), 'x'))[0]).toContain('at least 2');
    expect(issues(validateSchema(s.string({ maxLength: 1 }), 'xy'))[0]).toContain('at most 1');
    expect(issues(validateSchema(s.string({ pattern: /^a/ }), 'b'))[0]).toContain('must match');
  });

  it('validates numbers with bounds and integer constraints', () => {
    expect(validateSchema(s.number(), 1)).toEqual({ value: 1 });
    expect(issues(validateSchema(s.number(), Number.NaN))).toEqual(['must be a number']);
    expect(issues(validateSchema(s.number({ integer: true }), 1.5))).toEqual([
      'must be an integer',
    ]);
    expect(issues(validateSchema(s.number({ min: 5 }), 1))[0]).toContain('>= 5');
    expect(issues(validateSchema(s.number({ max: 5 }), 9))[0]).toContain('<= 5');
  });

  it('narrows enum output to the literal union', () => {
    const mode = s.enum('fast', 'thorough');
    const result = validateSchema(mode, 'fast');
    if ('value' in result) {
      const narrowed: 'fast' | 'thorough' = result.value;
      expect(narrowed).toBe('fast');
    }
    expect(issues(validateSchema(mode, 'other'))[0]).toContain('must be one of');
  });

  it('reports the path of a failing array item', () => {
    const result = validateSchema(s.array(s.string()), ['a', 2]);
    expect('issues' in result && result.issues[0]?.path).toEqual([1]);
  });

  it('reports the path of a failing object property', () => {
    const schema = s.object({ nested: s.object({ count: s.number() }) });
    const result = validateSchema(schema, { nested: { count: 'no' } });
    expect('issues' in result && result.issues[0]?.path).toEqual(['nested', 'count']);
  });

  it('omits path entirely when there is none', () => {
    const result = validateSchema(s.string(), 1);
    // exactOptionalPropertyTypes: absent, not explicitly undefined.
    expect('issues' in result && Object.hasOwn(result.issues[0] ?? {}, 'path')).toBe(false);
  });

  it('distinguishes optional from nullable', () => {
    expect(validateSchema(s.optional(s.string()), undefined)).toEqual({ value: undefined });
    expect(issues(validateSchema(s.optional(s.string()), null))).toEqual(['must be a string']);

    expect(validateSchema(s.nullable(s.string()), null)).toEqual({ value: null });
    expect(issues(validateSchema(s.nullable(s.string()), undefined))).toEqual(['must be a string']);
  });

  it('validates records, unknown and custom guards', () => {
    expect(validateSchema(s.record(s.number()), { a: 1 })).toEqual({ value: { a: 1 } });
    expect(issues(validateSchema(s.record(s.number()), { a: 'x' }))).toEqual(['must be a number']);
    expect(validateSchema(s.unknown(), Symbol.iterator)).toEqual({ value: Symbol.iterator });

    const isTwo = (value: unknown): value is 2 => value === 2;
    expect(validateSchema(s.custom(isTwo, 'must be two'), 2)).toEqual({ value: 2 });
    expect(issues(validateSchema(s.custom(isTwo, 'must be two'), 3))).toEqual(['must be two']);
  });

  it('rejects arrays and null where an object is required', () => {
    expect(issues(validateSchema(s.object({}), []))).toEqual(['must be an object']);
    expect(issues(validateSchema(s.object({}), null))).toEqual(['must be an object']);
  });

  /**
   * `JSON.parse` produces `__proto__` as a genuine own property, so anything
   * validating parsed JSON can be handed one — and `output[key] = value` is the
   * one assignment that does not mean what it says for that key. It reaches
   * `Object.prototype`'s setter: the entry vanishes for a primitive, and for an
   * object the result silently *inherits* whatever was supplied.
   */
  describe('a `__proto__` key in the input', () => {
    const parsed = (json: string): unknown => JSON.parse(json);

    it('is kept as an ordinary entry rather than being dropped', () => {
      const result = validateSchema(s.record(s.string()), parsed('{"__proto__":"x","a":"y"}'));

      expect('value' in result).toBe(true);
      if ('value' in result) {
        // Present, own, and visible to every normal way of reading a record.
        expect(Object.keys(result.value).sort()).toEqual(['__proto__', 'a']);
        expect(Object.getOwnPropertyDescriptor(result.value, '__proto__')?.value).toBe('x');
        expect(Object.entries(result.value)).toContainEqual(['__proto__', 'x']);
      }
    });

    it("does not become the result's prototype", () => {
      const result = validateSchema(
        s.record(s.unknown()),
        parsed('{"__proto__":{"isAdmin":true},"id":"x"}')
      );

      expect('value' in result).toBe(true);
      if ('value' in result) {
        // The whole point: nothing the input supplied is inherited, so a
        // property the schema never declared cannot answer.
        expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
        expect((result.value as { isAdmin?: unknown }).isAdmin).toBeUndefined();
        expect('isAdmin' in result.value).toBe(false);
      }
    });

    it('leaves Object.prototype alone', () => {
      validateSchema(s.record(s.unknown()), parsed('{"__proto__":{"polluted":true}}'));

      expect(({} as { polluted?: unknown }).polluted).toBeUndefined();
    });

    it('still answers to Object.prototype methods, unlike a null-prototype object', () => {
      const result = validateSchema(s.record(s.string()), parsed('{"a":"y"}'));

      // `Object.create(null)` would also have closed the hole, at the cost of
      // making every one of these throw for every caller.
      expect('value' in result).toBe(true);
      if ('value' in result) {
        const value = result.value as { hasOwnProperty?: unknown; toString?: unknown };
        expect(typeof value.hasOwnProperty).toBe('function');
        expect(typeof value.toString).toBe('function');
        expect(Object.prototype.hasOwnProperty.call(result.value, 'a')).toBe(true);
      }
    });

    it('is not copied by s.object, which projects only the declared shape', () => {
      const result = validateSchema(
        s.object({ a: s.string() }),
        parsed('{"__proto__":{"b":1},"a":"y"}')
      );

      expect(result).toEqual({ value: { a: 'y' } });
      if ('value' in result) {
        expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
      }
    });

    it('lands as an own property when an s.object shape does declare it', () => {
      // The computed key is not stylistic: in an object *literal*,
      // `__proto__: x` is the prototype-setting syntax, so `s.object({
      // __proto__: s.string() })` declares no field at all. `['__proto__']` is
      // the only way to write this shape — which is also why the input side of
      // `s.object` was never exposed.
      const shape = { ['__proto__']: s.string() };
      const result = validateSchema(s.object(shape), parsed('{"__proto__":"x"}'));

      expect('value' in result).toBe(true);
      if ('value' in result) {
        expect(Object.getPrototypeOf(result.value)).toBe(Object.prototype);
        expect(Object.getOwnPropertyDescriptor(result.value, '__proto__')?.value).toBe('x');
      }
    });
  });

  it('infers the output type of a composed schema', () => {
    const schema = s.object({
      name: s.string(),
      tags: s.array(s.string()),
      limit: s.optional(s.number()),
    });

    // The inferred type and the runtime result have to agree, so assert both.
    const declared: Infer<typeof schema> = { name: 'a', tags: ['b'], limit: undefined };
    const result = validateSchema(schema, { name: 'a', tags: ['b'], limit: 2 });

    expect(declared.name).toBe('a');
    expect(result).toEqual({ value: { name: 'a', tags: ['b'], limit: 2 } });
  });
});

describe('s.* schemas as command argument validators', () => {
  // The point of speaking Standard Schema: one validator vocabulary covers both
  // settings/storage and the untrusted command-argument boundary.
  it('is accepted by toValidator', () => {
    const validator = toValidator(s.string());

    expect(validator.validate('x')).toEqual({ ok: true, value: 'x' });
    const failure = validator.validate(1);
    expect(failure.ok).toBe(false);
    if (!failure.ok) {
      expect(failure.issues[0]?.message).toBe('must be a string');
    }
  });

  it('rejects invalid command arguments end to end', async () => {
    const Refresh = defineCommandContract<readonly [{ force: boolean }], number>(
      { id: 'sample.refresh' },
      {
        args: s.custom((value): value is readonly [{ force: boolean }] => {
          const args = value as readonly unknown[];
          const first = args[0] as { force?: unknown } | undefined;
          return args.length === 1 && typeof first?.force === 'boolean';
        }, 'expected [{ force: boolean }]'),
      }
    );

    const module = defineModule('projects', (builder): undefined => {
      builder.commands.handle(Refresh, () => 1);
      return undefined;
    });

    const commands = createFakeCommands();
    const app = createApplication({
      plan: compileApplication({ name: 'sample', modules: [module] }),
      capabilities: { commands, environment: createFakeEnvironment({}) },
    });
    await app.activate({ subscriptions: [] });

    await expect(commands.execute('sample.refresh', { force: 'no' })).rejects.toThrow(
      /Invalid arguments/
    );
    await expect(app.commands.execute(Refresh, { force: true })).resolves.toBe(1);

    await app.deactivate();
  });
});

describe('Standard Schema v1 conformance', () => {
  /**
   * A schema shaped exactly like the official interface: `validate` returns a
   * result *or* a promise of one, and issue paths may carry either a raw key or
   * a `{ key }` segment. The spec type is what real libraries (zod, valibot)
   * declare, so this is the assignability the kit has to accept.
   */
  const officialStyle: StandardSchemaV1<unknown, string> = {
    '~standard': {
      version: 1,
      vendor: 'official-style',
      validate: (value: unknown) =>
        typeof value === 'string'
          ? { value }
          : { issues: [{ message: 'expected a string', path: ['a', { key: 0 }, 'b'] }] },
    },
  };

  it('accepts a schema declared with the spec return type', () => {
    expect(validateSchema(officialStyle, 'ok')).toEqual({ value: 'ok' });
    const failed = validateSchema(officialStyle, 1);
    expect('issues' in failed && failed.issues[0]?.path).toEqual(['a', { key: 0 }, 'b']);
  });

  it('throws instead of treating an async validator as a validated value', () => {
    // A synchronous consumer must reject the thenable explicitly; treating it
    // as a result would report false success with no validated value.
    const asyncSchema: StandardSchemaV1<unknown, string> = {
      '~standard': {
        version: 1,
        vendor: 'async-vendor',
        validate: () => Promise.resolve({ value: 'late' }),
      },
    };

    expect(() => validateSchema(asyncSchema, 'x')).toThrow(TypeError);
    expect(() => validateSchema(asyncSchema, 'x')).toThrow(/async-vendor/);
  });

  it('does not leak an async validator rejection as an unhandled rejection', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const rejecting: StandardSchemaV1<unknown, string> = {
        '~standard': {
          version: 1,
          vendor: 'rejecting',
          validate: () =>
            Promise.resolve().then((): { value: string } => {
              throw new Error('inner rejection');
            }),
        },
      };
      expect(() => validateSchema(rejecting, 'x')).toThrow(TypeError);
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('enforces the rule inside composites, not just at the top level', () => {
    // s.array/object/record call their item validators directly, so the gate
    // has to be in the shared entry point rather than at the outer call.
    const asyncItem: StandardSchemaV1<unknown, string> = {
      '~standard': {
        version: 1,
        vendor: 'async-item',
        validate: () => Promise.resolve({ value: 'late' }),
      },
    };

    expect(() => validateSchema(s.array(asyncItem), ['x'])).toThrow(/async-item/);
    expect(() => validateSchema(s.object({ inner: asyncItem }), { inner: 'x' })).toThrow(
      /async-item/
    );
    expect(() => validateSchema(s.record(asyncItem), { key: 'x' })).toThrow(/async-item/);
    expect(() => validateSchema(s.optional(asyncItem), 'x')).toThrow(/async-item/);
    expect(() => validateSchema(s.nullable(asyncItem), 'x')).toThrow(/async-item/);
  });
});
