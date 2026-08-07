/**
 * Deterministic localization-port fake. It models source-message lookup and
 * positional placeholder substitution, not bundle loading, locale fallback,
 * extraction tooling or ICU formatting performed outside this port.
 */
import type { LocalizationCapability, LocalizedMessage } from '../../foundation/platform/ports.js';

/** In-memory localization capability for tests. */
export interface FakeLocalization extends LocalizationCapability {
  /** Switches the reported display language. */
  _setLanguage(language: string): void;
  /**
   * Adds bundle entries, keyed by the *source* message the code passes to `t`.
   * A message with no entry falls through untranslated, as VS Code's own
   * bundle lookup does. Translator comments are still recorded in `requested`
   * but do not form a second lookup key in this focused fake.
   */
  _addBundle(entries: Readonly<Record<string, string>>): void;
  /** Every message asked for, in order, before placeholders were filled. */
  readonly requested: readonly LocalizedMessage[];
}

/**
 * Fills `{0}`, `{1}` from `args`.
 *
 * A placeholder with no matching argument is left as written — the same thing
 * VS Code does, and the behaviour a test should be able to observe rather than
 * having the fake quietly print `undefined`.
 */
function fill(template: string, args: readonly (string | number | boolean)[]): string {
  return template.replace(/\{(\d+)\}/g, (whole, index: string) => {
    const value = args[Number(index)];
    return value === undefined ? whole : String(value);
  });
}

/**
 * Creates a fake localization capability.
 *
 * Untranslated by default, which is the honest starting point: a test that
 * asserts on English text is asserting on the source strings. Add a bundle to
 * exercise a translated path.
 *
 * @example
 * ```ts
 * const localization = createFakeLocalization('ja');
 * localization._addBundle({ 'Hello, {0}!': 'こんにちは、{0}!' });
 * ```
 */
export function createFakeLocalization(language = 'en'): FakeLocalization {
  let current = language;
  const bundle = new Map<string, string>();
  const requested: LocalizedMessage[] = [];

  return {
    get language(): string {
      return current;
    },

    translate(message: LocalizedMessage): string {
      requested.push(message);
      const template = bundle.get(message.message) ?? message.message;
      return fill(template, message.args ?? []);
    },

    _setLanguage(next: string): void {
      current = next;
    },

    _addBundle(entries: Readonly<Record<string, string>>): void {
      for (const [source, translated] of Object.entries(entries)) {
        bundle.set(source, translated);
      }
    },

    requested,
  };
}
