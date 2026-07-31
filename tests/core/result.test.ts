import { describe, it, expect } from 'vitest';
import { ok, err, unwrap, unwrapOr, mapResult, mapResultErr } from '../../src/core/result.js';

describe('result helpers', () => {
  describe('ok / err', () => {
    it('ok wraps a value', () => {
      expect(ok(42)).toEqual({ ok: true, value: 42 });
    });

    it('err wraps an error with cancelled defaulting to false', () => {
      const error = new Error('boom');
      expect(err(error)).toEqual({ ok: false, error, cancelled: false });
    });

    it('err can mark cancellation', () => {
      const error = new Error('Canceled');
      expect(err(error, { cancelled: true })).toEqual({ ok: false, error, cancelled: true });
    });
  });

  describe('unwrap', () => {
    it('returns the value on success', () => {
      expect(unwrap(ok('hello'))).toBe('hello');
    });

    it('throws the error on failure', () => {
      const error = new Error('boom');
      expect(() => unwrap(err(error))).toThrow(error);
    });

    it('wraps non-Error failure values in an Error', () => {
      expect(() => unwrap(err('plain string'))).toThrow('plain string');
    });
  });

  describe('unwrapOr', () => {
    it('returns the value on success', () => {
      expect(unwrapOr(ok(1), 2)).toBe(1);
    });

    it('returns the fallback on failure', () => {
      expect(unwrapOr(err(new Error('x')), 2)).toBe(2);
    });
  });

  describe('mapResult', () => {
    it('transforms the success value', () => {
      expect(mapResult(ok(2), (n) => n * 10)).toEqual({ ok: true, value: 20 });
    });

    it('passes failures through unchanged', () => {
      const failure = err(new Error('x'), { cancelled: true });
      expect(mapResult(failure, (n: number) => n * 10)).toBe(failure);
    });
  });

  describe('mapResultErr', () => {
    it('transforms the failure value and preserves cancelled', () => {
      const mapped = mapResultErr(err(new Error('inner'), { cancelled: true }), (e) => e.message);
      expect(mapped).toEqual({ ok: false, error: 'inner', cancelled: true });
    });

    it('passes successes through unchanged', () => {
      const success = ok(5);
      expect(mapResultErr(success, () => 'never')).toBe(success);
    });
  });
});
