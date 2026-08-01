import { describe, it, expect } from 'vitest';
import { s, validateSchema } from '../../src/core/schema.js';

describe('s.nullable', () => {
  it('accepts null', () => {
    expect(validateSchema(s.nullable(s.string()), null)).toEqual({ value: null });
  });

  it('delegates to the inner schema for non-null values', () => {
    const schema = s.nullable(s.enum('compact', 'wide'));

    expect(validateSchema(schema, 'wide')).toEqual({ value: 'wide' });

    const rejected = validateSchema(schema, 'huge');
    expect(rejected).toHaveProperty('issues');
    if ('issues' in rejected) {
      expect(rejected.issues[0]?.message).toContain('must be one of');
    }
  });

  it('does not accept undefined (that is s.optional)', () => {
    expect(validateSchema(s.nullable(s.string()), undefined)).toHaveProperty('issues');
  });

  it('preserves the inner schema constraints', () => {
    const schema = s.nullable(s.number({ min: 1, integer: true }));

    expect(validateSchema(schema, 5)).toEqual({ value: 5 });
    expect(validateSchema(schema, 0)).toHaveProperty('issues');
    expect(validateSchema(schema, 1.5)).toHaveProperty('issues');
    expect(validateSchema(schema, null)).toEqual({ value: null });
  });

  it('composes with s.optional to admit both null and undefined', () => {
    const schema = s.optional(s.nullable(s.boolean()));

    expect(validateSchema(schema, undefined)).toEqual({ value: undefined });
    expect(validateSchema(schema, null)).toEqual({ value: null });
    expect(validateSchema(schema, true)).toEqual({ value: true });
    expect(validateSchema(schema, 'no')).toHaveProperty('issues');
  });

  it('works nested inside a container schema', () => {
    const schema = s.object({ preset: s.nullable(s.string()) });

    expect(validateSchema(schema, { preset: null })).toEqual({ value: { preset: null } });
    expect(validateSchema(schema, { preset: 'wide' })).toEqual({ value: { preset: 'wide' } });
    expect(validateSchema(schema, { preset: 3 })).toHaveProperty('issues');
  });
});

describe('s.optional (contrast with nullable)', () => {
  it('accepts undefined but not null', () => {
    const schema = s.optional(s.string());

    expect(validateSchema(schema, undefined)).toEqual({ value: undefined });
    expect(validateSchema(schema, null)).toHaveProperty('issues');
  });
});

// ============================================
// Builders exercised only indirectly (via config/storage) until now —
// direct tests so the schema module carries its own coverage.
// ============================================

describe('s.string constraints', () => {
  it('enforces minLength, maxLength, and pattern with specific messages', () => {
    expect(validateSchema(s.string({ minLength: 3 }), 'ab')).toEqual({
      issues: [{ message: 'must have at least 3 characters', path: undefined }],
    });
    expect(validateSchema(s.string({ maxLength: 2 }), 'abc')).toHaveProperty('issues');
    expect(validateSchema(s.string({ pattern: /^\d+$/ }), 'abc')).toHaveProperty('issues');
    expect(
      validateSchema(s.string({ minLength: 1, maxLength: 3, pattern: /^\d+$/ }), '42')
    ).toEqual({ value: '42' });
  });

  it('rejects non-strings', () => {
    expect(validateSchema(s.string(), 42)).toHaveProperty('issues');
  });
});

describe('s.number constraints', () => {
  it('enforces integer, min, and max', () => {
    expect(validateSchema(s.number({ integer: true }), 1.5)).toHaveProperty('issues');
    expect(validateSchema(s.number({ min: 0 }), -1)).toHaveProperty('issues');
    expect(validateSchema(s.number({ max: 10 }), 11)).toHaveProperty('issues');
    expect(validateSchema(s.number({ integer: true, min: 0, max: 10 }), 7)).toEqual({ value: 7 });
  });

  it('rejects NaN and non-numbers', () => {
    expect(validateSchema(s.number(), Number.NaN)).toHaveProperty('issues');
    expect(validateSchema(s.number(), '7')).toHaveProperty('issues');
  });
});

describe('s.boolean / s.enum', () => {
  it('boolean accepts only booleans', () => {
    expect(validateSchema(s.boolean(), true)).toEqual({ value: true });
    expect(validateSchema(s.boolean(), 'true')).toHaveProperty('issues');
  });

  it('enum lists the allowed values in its failure message', () => {
    const schema = s.enum('a', 'b', 3);

    expect(validateSchema(schema, 'a')).toEqual({ value: 'a' });
    expect(validateSchema(schema, 3)).toEqual({ value: 3 });
    expect(validateSchema(schema, 'c')).toEqual({
      issues: [{ message: 'must be one of "a", "b", 3', path: undefined }],
    });
  });
});

describe('s.array', () => {
  it('validates every item and reports the failing index in the path', () => {
    const schema = s.array(s.number());

    expect(validateSchema(schema, [1, 2, 3])).toEqual({ value: [1, 2, 3] });
    expect(validateSchema(schema, [1, 'two', 3])).toEqual({
      issues: [{ message: 'must be a number', path: [1] }],
    });
  });

  it('prepends the index to a nested failure path', () => {
    const schema = s.array(s.object({ id: s.string() }));

    expect(validateSchema(schema, [{ id: 'a' }, { id: 2 }])).toEqual({
      issues: [{ message: 'must be a string', path: [1, 'id'] }],
    });
  });

  it('rejects non-arrays', () => {
    expect(validateSchema(s.array(s.number()), 'nope')).toHaveProperty('issues');
  });
});

describe('s.object', () => {
  it('rejects non-objects, null, and arrays', () => {
    const schema = s.object({ a: s.string() });

    expect(validateSchema(schema, 'x')).toHaveProperty('issues');
    expect(validateSchema(schema, null)).toHaveProperty('issues');
    expect(validateSchema(schema, [])).toHaveProperty('issues');
  });

  it('reports the failing key in the path', () => {
    const schema = s.object({ a: s.string(), b: s.number() });

    expect(validateSchema(schema, { a: 'x', b: 'not a number' })).toEqual({
      issues: [{ message: 'must be a number', path: ['b'] }],
    });
  });
});

describe('s.record', () => {
  it('validates every value against the value schema', () => {
    const schema = s.record(s.number());

    expect(validateSchema(schema, { a: 1, b: 2 })).toEqual({ value: { a: 1, b: 2 } });
  });

  it('reports the failing key in the path', () => {
    const schema = s.record(s.number());

    expect(validateSchema(schema, { a: 1, b: 'two' })).toEqual({
      issues: [{ message: 'must be a number', path: ['b'] }],
    });
  });

  it('prepends the key to a nested failure path', () => {
    const schema = s.record(s.object({ n: s.number() }));

    expect(validateSchema(schema, { x: { n: 'bad' } })).toEqual({
      issues: [{ message: 'must be a number', path: ['x', 'n'] }],
    });
  });

  it('rejects non-objects and arrays', () => {
    expect(validateSchema(s.record(s.number()), 'nope')).toHaveProperty('issues');
    expect(validateSchema(s.record(s.number()), [1])).toHaveProperty('issues');
  });
});

describe('s.unknown', () => {
  it('passes any value through unchanged', () => {
    const value = { anything: [1, null] };

    expect(validateSchema(s.unknown(), value)).toEqual({ value });
    expect(validateSchema(s.unknown(), undefined)).toEqual({ value: undefined });
  });
});

describe('s.custom', () => {
  it('builds a schema from a type guard', () => {
    const isPort = (v: unknown): v is number => typeof v === 'number' && v >= 1 && v <= 65535;
    const schema = s.custom(isPort, 'must be a port number');

    expect(validateSchema(schema, 8080)).toEqual({ value: 8080 });
    expect(validateSchema(schema, 0)).toEqual({
      issues: [{ message: 'must be a port number', path: undefined }],
    });
  });

  it('uses a generic message when none is given', () => {
    const schema = s.custom((v): v is string => typeof v === 'string');

    expect(validateSchema(schema, 1)).toEqual({
      issues: [{ message: 'invalid value', path: undefined }],
    });
  });
});
