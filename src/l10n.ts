import * as vscode from 'vscode';

/**
 * Plural forms for different languages.
 * Based on CLDR plural rules.
 */
export interface PluralForms {
  /** Used for count of 0 (optional, falls back to 'other') */
  zero?: string;
  /** Used for count of 1 */
  one?: string;
  /** Used for count of 2 (Arabic, etc.) */
  two?: string;
  /** Used for small numbers (Slavic languages, etc.) */
  few?: string;
  /** Used for large numbers (Slavic languages, etc.) */
  many?: string;
  /** Default form (required) */
  other: string;
}

/**
 * Options for number formatting.
 */
export interface NumberFormatOptions {
  /** Minimum number of integer digits (default: 1) */
  minimumIntegerDigits?: number;
  /** Minimum number of fraction digits */
  minimumFractionDigits?: number;
  /** Maximum number of fraction digits */
  maximumFractionDigits?: number;
  /** Use grouping separators (default: true) */
  useGrouping?: boolean;
  /** Style: 'decimal', 'currency', 'percent', 'unit' */
  style?: 'decimal' | 'currency' | 'percent' | 'unit';
  /** Currency code for style: 'currency' */
  currency?: string;
  /** Unit for style: 'unit' */
  unit?: string;
}

/**
 * Options for date formatting.
 */
export interface DateFormatOptions {
  /** Date style: 'full', 'long', 'medium', 'short' */
  dateStyle?: 'full' | 'long' | 'medium' | 'short';
  /** Time style: 'full', 'long', 'medium', 'short' */
  timeStyle?: 'full' | 'long' | 'medium' | 'short';
}

/**
 * Unit for relative time formatting.
 */
export type RelativeTimeUnit =
  | 'year'
  | 'quarter'
  | 'month'
  | 'week'
  | 'day'
  | 'hour'
  | 'minute'
  | 'second';

/**
 * Translates a message string using VS Code's localization API.
 * This is a convenience wrapper around `vscode.l10n.t`.
 *
 * @param message - The message to translate
 * @param args - Arguments for string interpolation
 * @returns The translated string
 *
 * @example
 * ```typescript
 * // Simple translation
 * const greeting = t('Hello, World!');
 *
 * // With interpolation
 * const welcome = t('Welcome, {0}!', userName);
 *
 * // With multiple arguments
 * const status = t('Found {0} files in {1}', count, folderName);
 * ```
 */
export function t(message: string, ...args: (string | number | boolean)[]): string {
  return vscode.l10n.t(message, ...args);
}

/**
 * Gets the current VS Code display language.
 *
 * @returns The language code (e.g., 'en', 'ja', 'de')
 *
 * @example
 * ```typescript
 * const lang = getLanguage();
 * if (lang === 'ja') {
 *   // Japanese-specific handling
 * }
 * ```
 */
export function getLanguage(): string {
  return vscode.env.language;
}

/**
 * Checks if the current language matches a specific locale.
 *
 * @param locale - The locale to check (e.g., 'en', 'ja', 'de')
 * @returns True if the current language starts with the specified locale
 *
 * @example
 * ```typescript
 * if (isLanguage('ja')) {
 *   // Running in Japanese
 * }
 * ```
 */
export function isLanguage(locale: string): boolean {
  return vscode.env.language.startsWith(locale);
}

/**
 * Returns the appropriate plural form based on count.
 *
 * Uses the Intl.PluralRules API to determine the correct form
 * for the current language. Supports all CLDR plural categories.
 *
 * @param count - The number to pluralize
 * @param forms - Object containing plural forms
 * @returns The interpolated string with the correct plural form
 *
 * @example
 * ```typescript
 * // English
 * plural(1, { one: '{count} item', other: '{count} items' });
 * // -> "1 item"
 *
 * plural(5, { one: '{count} item', other: '{count} items' });
 * // -> "5 items"
 *
 * // With zero form
 * plural(0, {
 *   zero: 'No items',
 *   one: '{count} item',
 *   other: '{count} items'
 * });
 * // -> "No items"
 *
 * // Japanese (no plural distinction)
 * plural(5, { other: '{count}個のアイテム' });
 * // -> "5個のアイテム"
 * ```
 */
export function plural(count: number, forms: PluralForms): string {
  const rules = new Intl.PluralRules(vscode.env.language);
  const rule = rules.select(count);

  // Special case for zero if provided
  if (count === 0 && forms.zero !== undefined) {
    return interpolateCount(forms.zero, count);
  }

  // Get the form for the plural rule, falling back to 'other'
  const form = forms[rule as keyof PluralForms] ?? forms.other;
  return interpolateCount(form, count);
}

/**
 * Interpolates {count} placeholder in a string.
 */
function interpolateCount(template: string, count: number): string {
  return template.replace(/\{count\}/g, String(count));
}

/**
 * Formats a number according to the current locale.
 *
 * Uses Intl.NumberFormat with VS Code's display language.
 *
 * @param value - The number to format
 * @param options - Formatting options
 * @returns Formatted number string
 *
 * @example
 * ```typescript
 * // Basic formatting
 * formatNumber(1234567.89);
 * // -> "1,234,567.89" (en) / "1.234.567,89" (de) / "1 234 567,89" (fr)
 *
 * // Currency
 * formatNumber(1234.56, { style: 'currency', currency: 'USD' });
 * // -> "$1,234.56" (en) / "1.234,56 $" (de)
 *
 * // Percentage
 * formatNumber(0.75, { style: 'percent' });
 * // -> "75%"
 *
 * // Fixed decimals
 * formatNumber(3.14159, { maximumFractionDigits: 2 });
 * // -> "3.14"
 * ```
 */
export function formatNumber(value: number, options: NumberFormatOptions = {}): string {
  const formatter = new Intl.NumberFormat(vscode.env.language, options);
  return formatter.format(value);
}

/**
 * Formats a date according to the current locale.
 *
 * Uses Intl.DateTimeFormat with VS Code's display language.
 *
 * @param date - The date to format
 * @param options - Formatting options
 * @returns Formatted date string
 *
 * @example
 * ```typescript
 * const date = new Date('2026-02-04');
 *
 * // Short date
 * formatDate(date, { dateStyle: 'short' });
 * // -> "2/4/26" (en-US) / "04.02.26" (de) / "2026/02/04" (ja)
 *
 * // Long date
 * formatDate(date, { dateStyle: 'long' });
 * // -> "February 4, 2026" (en) / "4. Februar 2026" (de)
 *
 * // Date and time
 * formatDate(new Date(), { dateStyle: 'medium', timeStyle: 'short' });
 * // -> "Feb 4, 2026, 10:30 AM" (en)
 * ```
 */
export function formatDate(date: Date, options: DateFormatOptions = {}): string {
  const formatter = new Intl.DateTimeFormat(vscode.env.language, options);
  return formatter.format(date);
}

/**
 * Formats a relative time (e.g., "2 days ago", "in 3 hours").
 *
 * Uses Intl.RelativeTimeFormat with VS Code's display language.
 *
 * @param value - The relative time value (negative for past, positive for future)
 * @param unit - The time unit
 * @param style - Format style: 'long', 'short', 'narrow' (default: 'long')
 * @returns Formatted relative time string
 *
 * @example
 * ```typescript
 * formatRelativeTime(-1, 'day');
 * // -> "1 day ago" (en) / "vor 1 Tag" (de) / "1日前" (ja)
 *
 * formatRelativeTime(2, 'hour');
 * // -> "in 2 hours" (en) / "in 2 Stunden" (de)
 *
 * formatRelativeTime(-5, 'minute', 'short');
 * // -> "5 min. ago" (en)
 *
 * formatRelativeTime(1, 'week', 'narrow');
 * // -> "in 1 wk." (en)
 * ```
 */
export function formatRelativeTime(
  value: number,
  unit: RelativeTimeUnit,
  style: 'long' | 'short' | 'narrow' = 'long'
): string {
  const formatter = new Intl.RelativeTimeFormat(vscode.env.language, { style });
  return formatter.format(value, unit);
}
