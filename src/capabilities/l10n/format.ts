/**
 * vscode-independent Intl formatting core.
 *
 * Every function takes the target language explicitly rather than reading
 * `vscode.env.language`, so this module has no runtime dependency on `vscode`
 * and can be reused from a webview or browser bundle. The wrappers that supply
 * the current VS Code display language live alongside it.
 */

/** Plural forms, following CLDR plural categories. */
export interface PluralForms {
  /** Used for a count of 0. Falls back to `other` when absent. */
  readonly zero?: string;
  /** Used for a count of 1. */
  readonly one?: string;
  /** Used for a count of 2 (Arabic and others). */
  readonly two?: string;
  /** Used for small counts (Slavic languages and others). */
  readonly few?: string;
  /** Used for large counts (Slavic languages and others). */
  readonly many?: string;
  /** Required default form. */
  readonly other: string;
}

/** Options for number formatting. */
export interface NumberFormatOptions {
  /** Minimum digits before the decimal separator. */
  readonly minimumIntegerDigits?: number;
  /** Minimum digits after the decimal separator. */
  readonly minimumFractionDigits?: number;
  /** Maximum digits after the decimal separator. */
  readonly maximumFractionDigits?: number;
  /** Whether locale-specific digit grouping may be used. */
  readonly useGrouping?: boolean;
  /** Output style; currency and unit styles require their matching option. */
  readonly style?: 'decimal' | 'currency' | 'percent' | 'unit';
  /** Required when `style` is `'currency'`. */
  readonly currency?: string;
  /** Required when `style` is `'unit'`. */
  readonly unit?: string;
}

/** Options for date formatting. */
export interface DateFormatOptions {
  /** Locale-defined calendar-date verbosity. */
  readonly dateStyle?: 'full' | 'long' | 'medium' | 'short';
  /** Locale-defined clock/time-zone verbosity. */
  readonly timeStyle?: 'full' | 'long' | 'medium' | 'short';
}

/** Unit for relative time formatting. */
export type RelativeTimeUnit =
  'year' | 'quarter' | 'month' | 'week' | 'day' | 'hour' | 'minute' | 'second';

// Intl constructors are expensive (locale data lookup), so instances are cached
// per language plus options. The caches evict as a true LRU rather than clearing
// in bulk, so a long session with a few hot option sets does not thrash once the
// limit is reached.
const FORMATTER_CACHE_LIMIT = 100;
const pluralRulesCache = new Map<string, Intl.PluralRules>();
const numberFormatCache = new Map<string, Intl.NumberFormat>();
const dateTimeFormatCache = new Map<string, Intl.DateTimeFormat>();
const relativeTimeFormatCache = new Map<string, Intl.RelativeTimeFormat>();

/**
 * Reads `key` from `cache`, creating and storing it on a miss.
 *
 * Bounded as a true LRU: at `limit`, only the single least-recently-used entry is
 * evicted, and reading an existing key promotes it by re-inserting it. Exported
 * because the same eviction logic is useful for a consumer's own caches.
 *
 * @example
 * ```ts
 * const cache = new Map<string, Expensive>();
 * const value = getOrCreateCached(cache, 'key', 100, () => new Expensive());
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
    // Re-insert to move the key into the most-recently-used position.
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

function interpolate(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

/**
 * Picks the right plural form for `count` in `language` and interpolates it.
 *
 * Uses `Intl.PluralRules` for the CLDR category, then substitutes `{count}` and
 * anything in `extra`.
 *
 * @example
 * ```ts
 * pluralFor('en', 1, { one: '{count} item', other: '{count} items' });
 * // '1 item'
 * pluralFor('en', 3, { one: '{count} of {total}', other: '{count} of {total}' }, { total: 10 });
 * // '3 of 10'
 * ```
 */
export function pluralFor(
  language: string,
  count: number,
  forms: PluralForms,
  extra?: Readonly<Record<string, string | number>>
): string {
  const rules = getOrCreateCached(
    pluralRulesCache,
    language,
    FORMATTER_CACHE_LIMIT,
    () => new Intl.PluralRules(language)
  );
  const rule = rules.select(count);

  // An explicit `zero` wins for 0 even in languages whose CLDR category for 0
  // is `other`, which is what callers writing "no items" expect.
  // Intl.LDMLPluralRule is exactly keyof PluralForms, so no cast is needed.
  const form = count === 0 && forms.zero !== undefined ? forms.zero : (forms[rule] ?? forms.other);

  return interpolate(form, { count, ...extra });
}

/**
 * Formats a number for an explicit language.
 *
 * @example
 * ```ts
 * formatNumberFor('en-US', 1234.56, { style: 'currency', currency: 'USD' }); // '$1,234.56'
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
 * Formats a date for an explicit language.
 *
 * @example
 * ```ts
 * formatDateFor('en-US', new Date('2026-02-04'), { dateStyle: 'long' }); // 'February 4, 2026'
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
 * Formats a relative time for an explicit language.
 *
 * @param value - Negative for the past, positive for the future.
 *
 * @example
 * ```ts
 * formatRelativeTimeFor('en', -1, 'day'); // '1 day ago'
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
