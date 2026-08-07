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
