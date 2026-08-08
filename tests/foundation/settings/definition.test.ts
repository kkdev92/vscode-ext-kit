/**
 * Pure SettingSpec builder tests for integer and constrained string-array
 * validation. Add cases here when manifest-facing metadata and synchronous
 * runtime validation must agree; reading scopes and policies belong to accessor
 * tests.
 */
import { describe, expect, it } from 'vitest';

import { setting } from '../../../src/foundation/settings/definition.js';

/**
 * `number` cannot express whole-number semantics, while string lists often need
 * per-entry constraints such as non-empty glob patterns.
 */
describe('setting.integer', () => {
  it('rejects a fraction where a count is meant', () => {
    const spec = setting.integer({ default: 10, minimum: 1, maximum: 100 });

    expect(spec.type).toBe('integer');
    expect(spec.validate(12)).toEqual({ ok: true, value: 12 });
    expect(spec.validate(12.5).ok).toBe(false);
  });

  it('honours the range', () => {
    const spec = setting.integer({ default: 10, minimum: 1, maximum: 100 });

    expect(spec.validate(0).ok).toBe(false);
    expect(spec.validate(101).ok).toBe(false);
    expect(spec.validate(1).ok).toBe(true);
    expect(spec.validate(100).ok).toBe(true);
  });

  it('rejects what is not a number at all', () => {
    const spec = setting.integer({ default: 1 });

    expect(spec.validate('3').ok).toBe(false);
    expect(spec.validate(Number.NaN).ok).toBe(false);
  });
});

describe('setting.stringArray items', () => {
  it('constrains each entry by length', () => {
    const spec = setting.stringArray({ default: [], items: { minLength: 1 } });

    expect(spec.validate(['a', 'b'])).toEqual({ ok: true, value: ['a', 'b'] });
    // An empty glob matches everything, which is the bug this prevents.
    expect(spec.validate(['a', '']).ok).toBe(false);
  });

  it('constrains each entry by pattern', () => {
    const spec = setting.stringArray({ default: [], items: { pattern: /^[a-z]+$/u } });

    expect(spec.validate(['abc']).ok).toBe(true);
    expect(spec.validate(['abc', 'A1']).ok).toBe(false);
  });

  it('still accepts a list with no constraints', () => {
    expect(setting.stringArray({ default: [] }).validate(['', 'x']).ok).toBe(true);
  });

  it('still rejects a non-list and a list of non-strings', () => {
    const spec = setting.stringArray({ default: [], items: { minLength: 1 } });

    expect(spec.validate('a').ok).toBe(false);
    expect(spec.validate(['a', 2]).ok).toBe(false);
  });
});

/**
 * A setting whose "unset" state is a value.
 *
 * The manifest cannot accept a null default unless it declares the null in its
 * type, and a spec whose `validate` rejects null makes every lenient read of a
 * cleared setting fall back to the default — so the two halves have to move
 * together, which is why this is one builder rather than advice.
 */
describe('setting.nullable', () => {
  it('adds null to the declared type without disturbing the rest', () => {
    const spec = setting.nullable(setting.integer({ default: 1200, minimum: 1 }));

    expect(spec.type).toEqual(['integer', 'null']);
    expect(spec.scope).toBe('window');
    expect(spec.validate(null)).toEqual({ ok: true, value: null });
    expect(spec.validate(800)).toEqual({ ok: true, value: 800 });
  });

  it('keeps the inner validation for everything that is not null', () => {
    const spec = setting.nullable(setting.integer({ default: 1200, minimum: 10 }));

    expect(spec.validate(4)).toMatchObject({ ok: false });
    expect(spec.validate(1.5)).toMatchObject({ ok: false });
    expect(spec.validate('1200')).toMatchObject({ ok: false });
  });

  it('carries the inner default over for a setting that is merely clearable', () => {
    expect(setting.nullable(setting.integer({ default: 1200 })).default).toBe(1200);
  });

  it('takes null as the default for a setting that is unset until chosen', () => {
    const spec = setting.nullable(setting.enum({ values: ['ai'], default: 'ai' }), {
      default: null,
    });

    expect(spec.default).toBeNull();
  });

  it('puts null first among the allowed values, where enumDescriptions expects it', () => {
    // `enum` and `enumDescriptions` pair up positionally in the manifest, so
    // the description of "unset" has to be the first one.
    const spec = setting.nullable(setting.enum({ values: ['fast', 'safe'], default: 'safe' }));

    expect(spec.enum).toEqual([null, 'fast', 'safe']);
  });

  it('leaves a non-enumerated setting without an enum', () => {
    expect(setting.nullable(setting.string({ default: '' })).enum).toBeUndefined();
  });

  it('does not add null twice when wrapping something already nullable', () => {
    const once = setting.nullable(setting.string({ default: '' }));

    expect(setting.nullable(once).type).toEqual(['string', 'null']);
  });

  it('preserves a non-default scope', () => {
    const spec = setting.nullable(setting.string({ default: '', scope: 'resource' }));

    expect(spec.scope).toBe('resource');
  });
});
