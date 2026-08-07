import type { LocalizationCapability, LocalizedMessage } from '../../foundation/platform/ports.js';
import { serviceToken } from '../../foundation/services/token.js';
import type { ServiceToken } from '../../foundation/services/token.js';
import { formatDateFor, formatNumberFor, formatRelativeTimeFor, pluralFor } from './format.js';
import type {
  DateFormatOptions,
  NumberFormatOptions,
  PluralForms,
  RelativeTimeUnit,
} from './format.js';

/**
 * Everything an extension needs to show text in the user's language.
 *
 * One service rather than a handful of free functions, because every member
 * needs the same fact — the host's display language. Reading it separately in
 * each call site is how a report ends up half in the user's language and half
 * in someone else's, and the mismatch is invisible until it reaches a reader
 * who notices. Here the language is resolved once, so every member agrees.
 *
 * Formatting for an *explicit* locale — a webview, a log file, a bug report
 * meant to be compared against another — is the `*For` functions in
 * `./format.js`, which take the language and need no host at all.
 *
 * @example
 * ```ts
 * module.commands.handle(Greet, {
 *   inject: { l10n: Localization },
 *   execute: (_context, _args, { l10n }) => l10n.t('Hello, {0}!', name),
 * });
 * ```
 */
export interface LocalizationService {
  /** The host's display language, as a BCP 47 tag (`'en'`, `'ja-JP'`, ...). */
  readonly language: string;

  /**
   * Whether the display language matches a locale prefix, so `'ja'` covers
   * `'ja'` and `'ja-JP'` alike.
   *
   * This is a lexical prefix check, not locale negotiation or canonicalization;
   * pass normalized tags supplied by the host.
   *
   * @example
   * ```ts
   * if (l10n.is('ja')) { ... }
   * ```
   */
  is(locale: string): boolean;

  /**
   * Translates a message, filling `{0}`, `{1}` from `args`.
   *
   * Bind this service as `l10n` and the call reads `l10n.t('...')`, which is
   * the callee pattern `@vscode/l10n-dev`'s string extractor scans for. The
   * shape is the contract: a bare `t(...)` cannot be found by that tool. For a
   * string the extractor absolutely must see, `vscode.l10n.t` directly is still
   * the safest option.
   *
   * @example
   * ```ts
   * l10n.t('Found {0} files', count);
   * ```
   */
  t(message: string, ...args: (string | number | boolean)[]): string;
  /**
   * Translates a message carrying context for translators.
   *
   * @example
   * ```ts
   * l10n.t({ message: 'Found {0} files', args: [count], comment: 'Status bar' });
   * ```
   */
  t(message: LocalizedMessage): string;

  /**
   * Picks the plural form the display language calls for.
   *
   * @example
   * ```ts
   * l10n.plural(3, { one: '{count} item', other: '{count} items' }); // '3 items'
   * ```
   */
  plural(count: number, forms: PluralForms, extra?: Record<string, string | number>): string;

  /**
   * Formats a number for the display language.
   *
   * @example
   * ```ts
   * l10n.number(1234.5, { style: 'currency', currency: 'USD' }); // '$1,234.50' (en)
   * ```
   */
  number(value: number, options?: NumberFormatOptions): string;

  /**
   * Formats a date for the display language.
   *
   * @example
   * ```ts
   * l10n.date(new Date(), { dateStyle: 'long' });
   * ```
   */
  date(value: Date, options?: DateFormatOptions): string;

  /**
   * Formats a relative time for the display language.
   *
   * @example
   * ```ts
   * l10n.relativeTime(-1, 'day'); // '1 day ago' (en) / '1 日前' (ja)
   * ```
   */
  relativeTime(value: number, unit: RelativeTimeUnit, style?: 'long' | 'short' | 'narrow'): string;
}

/** Injects the application's {@link LocalizationService}. */
export const Localization: ServiceToken<LocalizationService> =
  serviceToken<LocalizationService>('framework.localization');

/**
 * Builds the localization service over a capability.
 *
 * @example
 * ```ts
 * const l10n = createLocalization(capability);
 * l10n.t('Hello');
 * ```
 */
export function createLocalization(capability: LocalizationCapability): LocalizationService {
  const language = capability.language;

  function t(message: string, ...args: (string | number | boolean)[]): string;
  function t(message: LocalizedMessage): string;
  function t(
    messageOrOptions: string | LocalizedMessage,
    ...args: (string | number | boolean)[]
  ): string {
    return capability.translate(
      typeof messageOrOptions === 'string' ? { message: messageOrOptions, args } : messageOrOptions
    );
  }

  return {
    language,
    is: (locale) => language.startsWith(locale),
    t,
    plural: (count, forms, extra) => pluralFor(language, count, forms, extra),
    number: (value, options = {}) => formatNumberFor(language, value, options),
    date: (value, options = {}) => formatDateFor(language, value, options),
    relativeTime: (value, unit, style = 'long') =>
      formatRelativeTimeFor(language, value, unit, style),
  };
}
