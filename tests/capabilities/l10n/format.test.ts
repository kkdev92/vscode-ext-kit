/**
 * Pure unit suite for locale-explicit `Intl` helpers and their bounded LRU
 * caches. It protects CLDR plural selection, interpolation, formatting options,
 * and cache eviction independently of the host display language. Locale-only
 * failures usually indicate runtime ICU data; cache/order failures indicate
 * this module.
 */
import { describe, expect, it } from 'vitest';

import {
  formatDateFor,
  formatNumberFor,
  formatRelativeTimeFor,
  getOrCreateCached,
  pluralFor,
} from '../../../src/capabilities/l10n/format.js';

describe('pluralFor', () => {
  it('selects the CLDR form for the count', () => {
    const forms = { one: '{count} item', other: '{count} items' };

    expect(pluralFor('en', 1, forms)).toBe('1 item');
    expect(pluralFor('en', 2, forms)).toBe('2 items');
  });

  it('prefers an explicit zero form even where CLDR says other', () => {
    // English has no `zero` category, but a caller writing "no items" expects it.
    const forms = { zero: 'no items', one: '{count} item', other: '{count} items' };

    expect(pluralFor('en', 0, forms)).toBe('no items');
    expect(pluralFor('en', 0, { one: '{count} item', other: '{count} items' })).toBe('0 items');
  });

  it('uses language-specific rules', () => {
    // Japanese has a single form, so both counts take `other`.
    const forms = { one: '{count}個', other: '{count}個' };
    expect(pluralFor('ja', 1, forms)).toBe('1個');
    expect(pluralFor('ja', 5, forms)).toBe('5個');

    // Russian distinguishes few/many.
    const russian = {
      one: '{count} файл',
      few: '{count} файла',
      many: '{count} файлов',
      other: '{count} файла',
    };
    expect(pluralFor('ru', 1, russian)).toBe('1 файл');
    expect(pluralFor('ru', 3, russian)).toBe('3 файла');
    expect(pluralFor('ru', 11, russian)).toBe('11 файлов');
  });

  it('interpolates extra named values alongside count', () => {
    const forms = { one: '{count} of {total}', other: '{count} of {total}' };
    expect(pluralFor('en', 3, forms, { total: 10 })).toBe('3 of 10');
  });

  it('leaves unknown placeholders untouched', () => {
    expect(pluralFor('en', 1, { other: '{count} {missing}' })).toBe('1 {missing}');
  });

  it('falls back to other when the selected form is absent', () => {
    expect(pluralFor('en', 1, { other: 'fallback {count}' })).toBe('fallback 1');
  });
});

describe('formatNumberFor', () => {
  it('formats plain numbers per language', () => {
    expect(formatNumberFor('en-US', 1234.5)).toBe('1,234.5');
    expect(formatNumberFor('de-DE', 1234.5)).toBe('1.234,5');
  });

  it('formats currency, percent and fraction digits', () => {
    expect(formatNumberFor('en-US', 1234.56, { style: 'currency', currency: 'USD' })).toBe(
      '$1,234.56'
    );
    expect(formatNumberFor('en-US', 0.25, { style: 'percent' })).toBe('25%');
    expect(formatNumberFor('en-US', 1.5, { minimumFractionDigits: 3 })).toBe('1.500');
  });

  it('can disable grouping', () => {
    expect(formatNumberFor('en-US', 1234567, { useGrouping: false })).toBe('1234567');
  });
});

describe('formatDateFor', () => {
  it('formats a date per language and style', () => {
    // Midday UTC, so the calendar year is the same in every timezone the test
    // might run in.
    const date = new Date(Date.UTC(2026, 1, 4, 12, 0, 0));

    expect(formatDateFor('en-US', date, { dateStyle: 'long' })).toContain('2026');
    expect(formatDateFor('en-US', date, { dateStyle: 'long' })).toContain('February');
    expect(formatDateFor('ja-JP', date, { dateStyle: 'long' })).toContain('2026');
    expect(formatDateFor('en-US', date, { dateStyle: 'short' })).toMatch(/\d/);
  });

  it('can include a time style', () => {
    const date = new Date(Date.UTC(2026, 1, 4, 12, 0, 0));
    const formatted = formatDateFor('en-US', date, { dateStyle: 'short', timeStyle: 'short' });

    expect(formatted).toMatch(/\d/);
    expect(formatted.length).toBeGreaterThan(
      formatDateFor('en-US', date, { dateStyle: 'short' }).length
    );
  });
});

describe('formatRelativeTimeFor', () => {
  it('formats past and future values', () => {
    expect(formatRelativeTimeFor('en', -1, 'day')).toBe('1 day ago');
    expect(formatRelativeTimeFor('en', 2, 'hour')).toBe('in 2 hours');
  });

  it('honours the style', () => {
    expect(formatRelativeTimeFor('en', -1, 'day', 'narrow')).toContain('1');
  });
});

describe('getOrCreateCached', () => {
  it('creates on a miss and reuses on a hit', () => {
    const cache = new Map<string, object>();
    let created = 0;
    const create = (): object => {
      created += 1;
      return {};
    };

    const first = getOrCreateCached(cache, 'a', 10, create);
    const second = getOrCreateCached(cache, 'a', 10, create);

    expect(first).toBe(second);
    expect(created).toBe(1);
  });

  it('evicts only the least-recently-used entry at the limit', () => {
    const cache = new Map<string, string>();
    getOrCreateCached(cache, 'a', 2, () => 'a');
    getOrCreateCached(cache, 'b', 2, () => 'b');

    // Reading 'a' promotes it, so 'b' becomes the oldest.
    getOrCreateCached(cache, 'a', 2, () => 'a');
    getOrCreateCached(cache, 'c', 2, () => 'c');

    expect([...cache.keys()]).toEqual(['a', 'c']);
    // A bulk clear would have dropped 'a' too.
    expect(cache.size).toBe(2);
  });
});
