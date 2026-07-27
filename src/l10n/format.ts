/**
 * Vscode-independent Intl formatting core. Every function here takes the
 * target language as an explicit argument instead of reading
 * `vscode.env.language`, so this module has zero runtime dependency on the
 * `vscode` module and can be reused from a Webview/browser bundle.
 * `src/l10n/index.ts` wraps these with the current VS Code display language.
 */

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
  'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';

// Intl constructors are expensive (locale data lookup); cache instances per
// language + options. The caches are bounded as a true LRU (never a bulk
// clear), so a long session with a handful of hot option sets doesn't
// thrash once the limit is reached.
const FORMATTER_CACHE_LIMIT = 100;
const pluralRulesCache = new Map<string, Intl.PluralRules>();
const numberFormatCache = new Map<string, Intl.NumberFormat>();
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();
const relativeTimeFormatCache = new Map<string, Intl.RelativeTimeFormat>();

/**
 * Gets `key` from `cache`, creating and storing it via `create` on a miss.
 * Bounded as a true LRU: once `cache.size` reaches `limit`, only the single
 * least-recently-used entry is evicted (never a bulk clear), and reading an
 * existing key promotes it to most-recently-used by re-inserting it.
 *
 * Exported so other bounded-cache needs (e.g. a custom formatter cache in a
 * consuming extension) can reuse this eviction logic directly.
 *
 * @param cache - The backing map, mutated in place
 * @param key - Cache key to look up or insert
 * @param limit - Maximum number of entries before the oldest is evicted
 * @param create - Factory invoked on a cache miss
 * @returns The cached or newly created value
 *
 * @example
 * ```typescript
 * const cache = new Map<string, ExpensiveThing>();
 * const thing = getOrCreateCached(cache, 'key', 100, () => new ExpensiveThing());
 * ```
 */
export function getOrCreateCached<T>(
  cache: Map<string, T>,
  key: string,
  limit: number,
  create: () => T
): T {
  const existing = cache.get(key);
  if (existing !== undefined) {
    // Re-insert to move this key to the end (most-recently-used position).
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }
  if (cache.size >= limit) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  const created = create();
  cache.set(key, created);
  return created;
}

function cacheKey(language: string, options?: unknown): string {
  return options === undefined ? language : `${language}|${JSON.stringify(options)}`;
}

function interpolate(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? String(values[key]) : match
  );
}

/**
 * Returns the appropriate plural form based on count, for an explicit
 * `language`. This is the vscode-independent core behind the `plural()`
 * wrapper in `./index.js`; call it directly from a Webview/browser context
 * where `vscode.env.language` isn't available.
 *
 * Uses `Intl.PluralRules` to determine the correct CLDR plural category for
 * `language`, then interpolates `{count}` — and any names present in
 * `extra` — into the chosen form.
 *
 * @param language - BCP 47 language tag (e.g. `vscode.env.language`)
 * @param count - The number to pluralize
 * @param forms - Object containing plural forms
 * @param extra - Additional named values to interpolate alongside `{count}`
 * @returns The interpolated string with the correct plural form
 *
 * @example
 * ```typescript
 * pluralFor('en', 1, { one: '{count} item', other: '{count} items' });
 * // -> "1 item"
 *
 * // Extra named placeholders alongside {count}
 * pluralFor('en', 3, { one: '{count} of {total}', other: '{count} of {total}' }, { total: 10 });
 * // -> "3 of 10"
 * ```
 */
export function pluralFor(
  language: string,
  count: number,
  forms: PluralForms,
  extra?: Record<string, string | number>
): string {
  const rules = getOrCreateCached(
    pluralRulesCache,
    language,
    FORMATTER_CACHE_LIMIT,
    () => new Intl.PluralRules(language)
  );
  const rule = rules.select(count);

  const form =
    count === 0 && forms.zero !== undefined
      ? forms.zero
      : (forms[rule as keyof PluralForms] ?? forms.other);

  return interpolate(form, { count, ...extra });
}

/**
 * Formats a number for an explicit `language`. This is the
 * vscode-independent core behind the `formatNumber()` wrapper in
 * `./index.js`.
 *
 * @param language - BCP 47 language tag (e.g. `vscode.env.language`)
 * @param value - The number to format
 * @param options - Formatting options
 * @returns Formatted number string
 *
 * @example
 * ```typescript
 * formatNumberFor('en-US', 1234.56, { style: 'currency', currency: 'USD' });
 * // -> "$1,234.56"
 * ```
 */
export function formatNumberFor(
  language: string,
  value: number,
  options: NumberFormatOptions = {}
): string {
  const formatter = getOrCreateCached(
    numberFormatCache,
    cacheKey(language, options),
    FORMATTER_CACHE_LIMIT,
    () => new Intl.NumberFormat(language, options)
  );
  return formatter.format(value);
}

/**
 * Formats a date for an explicit `language`. This is the vscode-independent
 * core behind the `formatDate()` wrapper in `./index.js`.
 *
 * @param language - BCP 47 language tag (e.g. `vscode.env.language`)
 * @param date - The date to format
 * @param options - Formatting options
 * @returns Formatted date string
 *
 * @example
 * ```typescript
 * formatDateFor('en-US', new Date('2026-02-04'), { dateStyle: 'long' });
 * // -> "February 4, 2026"
 * ```
 */
export function formatDateFor(
  language: string,
  date: Date,
  options: DateFormatOptions = {}
): string {
  const formatter = getOrCreateCached(
    dateTimeFormatCache,
    cacheKey(language, options),
    FORMATTER_CACHE_LIMIT,
    () => new Intl.DateTimeFormat(language, options)
  );
  return formatter.format(date);
}

/**
 * Formats a relative time (e.g. "2 days ago") for an explicit `language`.
 * This is the vscode-independent core behind the `formatRelativeTime()`
 * wrapper in `./index.js`.
 *
 * @param language - BCP 47 language tag (e.g. `vscode.env.language`)
 * @param value - The relative time value (negative for past, positive for future)
 * @param unit - The time unit
 * @param style - Format style: 'long', 'short', 'narrow' (default: 'long')
 * @returns Formatted relative time string
 *
 * @example
 * ```typescript
 * formatRelativeTimeFor('en', -1, 'day');
 * // -> "1 day ago"
 * ```
 */
export function formatRelativeTimeFor(
  language: string,
  value: number,
  unit: RelativeTimeUnit,
  style: 'long' | 'short' | 'narrow' = 'long'
): string {
  const formatter = getOrCreateCached(
    relativeTimeFormatCache,
    cacheKey(language, style),
    FORMATTER_CACHE_LIMIT,
    () => new Intl.RelativeTimeFormat(language, { style })
  );
  return formatter.format(value, unit);
}
