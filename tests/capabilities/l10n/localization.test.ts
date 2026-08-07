/**
 * Unit contract for binding the localization service to one host display
 * language. It distinguishes host translation delegation from pure `Intl`
 * formatting and pins the service's language snapshot. Failures here implicate
 * the service/capability bridge; locale algorithm failures belong in
 * `format.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import { createLocalization } from '../../../src/capabilities/l10n/localization.js';
import { createFakeLocalization } from '../../../src/testing/fakes/fake-localization.js';

describe('LocalizationService', () => {
  it('exposes the host display language', () => {
    expect(createLocalization(createFakeLocalization('ja-JP')).language).toBe('ja-JP');
  });

  it('matches a locale prefix, region and all', () => {
    const l10n = createLocalization(createFakeLocalization('ja-JP'));

    expect(l10n.is('ja')).toBe(true);
    expect(l10n.is('ja-JP')).toBe(true);
    expect(l10n.is('en')).toBe(false);
  });

  describe('t', () => {
    it('translates the string form with positional args', () => {
      const capability = createFakeLocalization('ja');
      capability._addBundle({ 'Hello, {0}!': 'こんにちは、{0}!' });

      expect(createLocalization(capability).t('Hello, {0}!', 'world')).toBe('こんにちは、world!');
    });

    it('falls through untranslated when the bundle has no entry', () => {
      expect(createLocalization(createFakeLocalization('ja')).t('Untranslated {0}', 1)).toBe(
        'Untranslated 1'
      );
    });

    it('translates the object form and keeps the comment out of the output', () => {
      const capability = createFakeLocalization();

      expect(
        createLocalization(capability).t({
          message: 'Found {0} files',
          args: [3],
          comment: 'Status bar text',
        })
      ).toBe('Found 3 files');
      expect(capability.requested[0]?.comment).toBe('Status bar text');
    });

    it('passes the string form to the capability as a message plus args', () => {
      const capability = createFakeLocalization();

      createLocalization(capability).t('Hi {0}', 'there');

      // The service never templates by itself: the host owns the bundle, so
      // substitution has to happen where the translation is chosen.
      expect(capability.requested[0]).toEqual({ message: 'Hi {0}', args: ['there'] });
    });
  });

  describe('formatting follows the display language', () => {
    it('pluralizes', () => {
      const en = createLocalization(createFakeLocalization('en'));

      expect(en.plural(1, { one: '{count} item', other: '{count} items' })).toBe('1 item');
      expect(en.plural(2, { one: '{count} item', other: '{count} items' })).toBe('2 items');
    });

    it('formats numbers', () => {
      expect(createLocalization(createFakeLocalization('de-DE')).number(1234.5)).toBe('1.234,5');
      expect(createLocalization(createFakeLocalization('en-US')).number(1234.5)).toBe('1,234.5');
    });

    it('formats dates', () => {
      const value = new Date(Date.UTC(2026, 1, 4, 12));

      expect(
        createLocalization(createFakeLocalization('en-US')).date(value, { dateStyle: 'long' })
      ).toContain('February');
    });

    it('formats relative time', () => {
      expect(createLocalization(createFakeLocalization('en')).relativeTime(-1, 'day')).toBe(
        '1 day ago'
      );
      // Preserve the exact string produced by the runtime's Japanese locale
      // data, including the separator between number and unit.
      expect(createLocalization(createFakeLocalization('ja')).relativeTime(-1, 'day')).toBe(
        '1 日前'
      );
    });

    it('reads the language once, so every member agrees', () => {
      // A service that re-read the language per call could format a number in
      // one locale and a date in another within a single handler.
      const capability = createFakeLocalization('en');
      const l10n = createLocalization(capability);

      capability._setLanguage('de-DE');

      expect(l10n.language).toBe('en');
      expect(l10n.number(1234.5)).toBe('1,234.5');
    });
  });
});
