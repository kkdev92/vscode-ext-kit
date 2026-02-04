import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { t, getLanguage, isLanguage, plural, formatNumber, formatDate, formatRelativeTime } from '../src/l10n.js';

describe('l10n', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('t', () => {
    it('should call vscode.l10n.t with message', () => {
      vi.mocked(vscode.l10n.t).mockReturnValue('translated');

      const result = t('Hello');

      expect(vscode.l10n.t).toHaveBeenCalledWith('Hello');
      expect(result).toBe('translated');
    });

    it('should pass arguments for interpolation', () => {
      vi.mocked(vscode.l10n.t).mockReturnValue('Hello, World!');

      const result = t('Hello, {0}!', 'World');

      expect(vscode.l10n.t).toHaveBeenCalledWith('Hello, {0}!', 'World');
      expect(result).toBe('Hello, World!');
    });

    it('should handle multiple arguments', () => {
      vi.mocked(vscode.l10n.t).mockReturnValue('Found 5 files in src');

      const result = t('Found {0} files in {1}', 5, 'src');

      expect(vscode.l10n.t).toHaveBeenCalledWith('Found {0} files in {1}', 5, 'src');
      expect(result).toBe('Found 5 files in src');
    });

    it('should handle boolean arguments', () => {
      vi.mocked(vscode.l10n.t).mockReturnValue('Enabled: true');

      const result = t('Enabled: {0}', true);

      expect(vscode.l10n.t).toHaveBeenCalledWith('Enabled: {0}', true);
      expect(result).toBe('Enabled: true');
    });
  });

  describe('getLanguage', () => {
    it('should return the current language', () => {
      Object.defineProperty(vscode.env, 'language', {
        value: 'ja',
        configurable: true,
      });

      const result = getLanguage();

      expect(result).toBe('ja');
    });
  });

  describe('isLanguage', () => {
    it('should return true for matching locale', () => {
      Object.defineProperty(vscode.env, 'language', {
        value: 'ja',
        configurable: true,
      });

      expect(isLanguage('ja')).toBe(true);
    });

    it('should return false for non-matching locale', () => {
      Object.defineProperty(vscode.env, 'language', {
        value: 'en',
        configurable: true,
      });

      expect(isLanguage('ja')).toBe(false);
    });

    it('should match locale prefix', () => {
      Object.defineProperty(vscode.env, 'language', {
        value: 'en-US',
        configurable: true,
      });

      expect(isLanguage('en')).toBe(true);
      expect(isLanguage('en-US')).toBe(true);
      expect(isLanguage('de')).toBe(false);
    });
  });

  describe('plural', () => {
    beforeEach(() => {
      Object.defineProperty(vscode.env, 'language', {
        value: 'en',
        configurable: true,
      });
    });

    it('should return one form for count of 1', () => {
      const result = plural(1, { one: '{count} item', other: '{count} items' });
      expect(result).toBe('1 item');
    });

    it('should return other form for count greater than 1', () => {
      const result = plural(5, { one: '{count} item', other: '{count} items' });
      expect(result).toBe('5 items');
    });

    it('should return other form for count of 0 when no zero form', () => {
      const result = plural(0, { one: '{count} item', other: '{count} items' });
      expect(result).toBe('0 items');
    });

    it('should return zero form when provided', () => {
      const result = plural(0, { zero: 'No items', one: '{count} item', other: '{count} items' });
      expect(result).toBe('No items');
    });

    it('should handle zero form with count interpolation', () => {
      const result = plural(0, { zero: '{count} items (empty)', one: '{count} item', other: '{count} items' });
      expect(result).toBe('0 items (empty)');
    });

    it('should fall back to other when specific form is missing', () => {
      const result = plural(1, { other: '{count} items' });
      expect(result).toBe('1 items');
    });

    it('should handle negative numbers', () => {
      const result = plural(-5, { one: '{count} item', other: '{count} items' });
      expect(result).toBe('-5 items');
    });

    it('should handle decimal numbers', () => {
      const result = plural(1.5, { one: '{count} item', other: '{count} items' });
      expect(result).toBe('1.5 items');
    });
  });

  describe('formatNumber', () => {
    beforeEach(() => {
      Object.defineProperty(vscode.env, 'language', {
        value: 'en-US',
        configurable: true,
      });
    });

    it('should format a basic number', () => {
      const result = formatNumber(1234567.89);
      expect(result).toContain('1');
      expect(result).toContain('234');
    });

    it('should format with maximum fraction digits', () => {
      const result = formatNumber(3.14159, { maximumFractionDigits: 2 });
      expect(result).toBe('3.14');
    });

    it('should format with minimum fraction digits', () => {
      const result = formatNumber(3, { minimumFractionDigits: 2 });
      expect(result).toBe('3.00');
    });

    it('should format percentage', () => {
      const result = formatNumber(0.75, { style: 'percent' });
      expect(result).toBe('75%');
    });

    it('should format currency', () => {
      const result = formatNumber(1234.56, { style: 'currency', currency: 'USD' });
      expect(result).toContain('1,234.56');
      expect(result).toMatch(/\$|USD/);
    });

    it('should handle no grouping', () => {
      const result = formatNumber(1234567, { useGrouping: false });
      expect(result).toBe('1234567');
    });
  });

  describe('formatDate', () => {
    beforeEach(() => {
      Object.defineProperty(vscode.env, 'language', {
        value: 'en-US',
        configurable: true,
      });
    });

    it('should format date with short style', () => {
      const date = new Date('2026-02-04');
      const result = formatDate(date, { dateStyle: 'short' });
      expect(result).toMatch(/2\/4\/26|2026/);
    });

    it('should format date with long style', () => {
      const date = new Date('2026-02-04');
      const result = formatDate(date, { dateStyle: 'long' });
      expect(result).toContain('February');
      expect(result).toContain('2026');
    });

    it('should format with time style', () => {
      const date = new Date('2026-02-04T10:30:00');
      const result = formatDate(date, { timeStyle: 'short' });
      expect(result).toMatch(/10:30|AM|PM/);
    });

    it('should format with both date and time style', () => {
      const date = new Date('2026-02-04T10:30:00');
      const result = formatDate(date, { dateStyle: 'short', timeStyle: 'short' });
      expect(result).toMatch(/2\/4\/26|2026/);
    });

    it('should handle no options', () => {
      const date = new Date('2026-02-04');
      const result = formatDate(date);
      expect(result).toBeTruthy();
    });
  });

  describe('formatRelativeTime', () => {
    beforeEach(() => {
      Object.defineProperty(vscode.env, 'language', {
        value: 'en',
        configurable: true,
      });
    });

    it('should format past day', () => {
      const result = formatRelativeTime(-1, 'day');
      expect(result).toBe('1 day ago');
    });

    it('should format future hours', () => {
      const result = formatRelativeTime(2, 'hour');
      expect(result).toBe('in 2 hours');
    });

    it('should format with short style', () => {
      const result = formatRelativeTime(-5, 'minute', 'short');
      expect(result).toMatch(/5\s*min.*ago/);
    });

    it('should format with narrow style', () => {
      const result = formatRelativeTime(1, 'week', 'narrow');
      expect(result).toMatch(/1\s*w.*|in 1 wk/i);
    });

    it('should handle different units', () => {
      expect(formatRelativeTime(-1, 'year')).toMatch(/1 year ago/);
      expect(formatRelativeTime(-1, 'month')).toMatch(/1 month ago/);
      expect(formatRelativeTime(-1, 'week')).toMatch(/1 week ago/);
      expect(formatRelativeTime(-1, 'second')).toMatch(/1 second ago/);
    });

    it('should handle zero value', () => {
      const result = formatRelativeTime(0, 'day');
      expect(result).toMatch(/0 days|in 0 days|today/i);
    });
  });
});
