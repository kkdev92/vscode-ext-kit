import * as vscode from 'vscode';
import { pluralFor, formatNumberFor, formatDateFor, formatRelativeTimeFor } from './format.js';
import type {
  PluralForms,
  NumberFormatOptions,
  DateFormatOptions,
  RelativeTimeUnit,
} from './format.js';

export * from './format.js';

/**
 * Options accepted by the object form of {@link l10n}'s `t`.
 */
export interface L10nMessageOptions {
  /**
   * The message to localize. Supports index templating where strings like
   * `{0}` and `{1}` are replaced by the item at that index in `args`.
   */
  message: string;
  /** Arguments used to fill in the message template. */
  args?: Array<string | number | boolean>;
  /** A comment to help translators understand the context of the message. */
  comment?: string | string[];
}

function translate(message: string, ...args: Array<string | number | boolean>): string;
function translate(options: L10nMessageOptions): string;
function translate(
  messageOrOptions: string | L10nMessageOptions,
  ...args: Array<string | number | boolean>
): string {
  if (typeof messageOrOptions === 'string') {
    return vscode.l10n.t(messageOrOptions, ...args);
  }

  const { message, args: templateArgs, comment } = messageOrOptions;
  if (comment === undefined) {
    return templateArgs === undefined
      ? vscode.l10n.t(message)
      : vscode.l10n.t(message, ...templateArgs);
  }
  return vscode.l10n.t({ message, args: templateArgs, comment });
}

/**
 * Namespaced translation helper shaped as `l10n.t(...)`, matching the
 * callee pattern `@vscode/l10n-dev`'s static string extractor scans for
 * (`l10n.t(...)` / `vscode.l10n.t(...)`). A bare `t(...)` export — this
 * library's previous shape — cannot be picked up by that tool.
 *
 * For strings you need the extractor to find with certainty, calling
 * `vscode.l10n.t(...)` directly remains the safest option; this wrapper
 * exists for the common case, plus a type-safe `comment` overload for
 * translator-facing context.
 *
 * @example
 * ```typescript
 * l10n.t('Hello, {0}!', name);
 * l10n.t({ message: 'Found {0} files', args: [count], comment: 'Status bar text' });
 * ```
 */
export const l10n = { t: translate };

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
 * Returns the appropriate plural form based on count, using VS Code's
 * current display language. See `pluralFor` for the vscode-independent
 * core (e.g. for reuse in a Webview bundle).
 *
 * Supports all CLDR plural categories via `Intl.PluralRules`.
 *
 * @param count - The number to pluralize
 * @param forms - Object containing plural forms
 * @param extra - Additional named values to interpolate alongside `{count}`
 * @returns The interpolated string with the correct plural form
 *
 * @example
 * ```typescript
 * // English
 * plural(1, { one: '{count} item', other: '{count} items' });
 * // -> "1 item"
 *
 * // With zero form
 * plural(0, { zero: 'No items', one: '{count} item', other: '{count} items' });
 * // -> "No items"
 *
 * // Extra named placeholders alongside {count}
 * plural(3, { one: '{count} of {total}', other: '{count} of {total}' }, { total: 10 });
 * // -> "3 of 10"
 * ```
 */
export function plural(
  count: number,
  forms: PluralForms,
  extra?: Record<string, string | number>
): string {
  return pluralFor(vscode.env.language, count, forms, extra);
}

/**
 * Formats a number according to the current locale. See `formatNumberFor`
 * for the vscode-independent core.
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
 * ```
 */
export function formatNumber(value: number, options: NumberFormatOptions = {}): string {
  return formatNumberFor(vscode.env.language, value, options);
}

/**
 * Formats a date according to the current locale. See `formatDateFor` for
 * the vscode-independent core.
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
 * ```
 */
export function formatDate(date: Date, options: DateFormatOptions = {}): string {
  return formatDateFor(vscode.env.language, date, options);
}

/**
 * Formats a relative time (e.g., "2 days ago", "in 3 hours") according to
 * the current locale. See `formatRelativeTimeFor` for the vscode-independent
 * core.
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
 * ```
 */
export function formatRelativeTime(
  value: number,
  unit: RelativeTimeUnit,
  style: 'long' | 'short' | 'narrow' = 'long'
): string {
  return formatRelativeTimeFor(vscode.env.language, value, unit, style);
}
