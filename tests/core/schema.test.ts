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
