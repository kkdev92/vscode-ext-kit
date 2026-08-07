/**
 * Shared LocalizationCapability contract for the fake and VS Code adapter, plus
 * adapter-only overload-shape checks required by message extraction. The
 * `vscode` stand-in implements formatting independently so fake and adapter
 * cannot pass through one shared mistake.
 */
import { describe, expect, it, vi } from 'vitest';

import type { LocalizationCapability } from '../../../src/foundation/platform/ports.js';

// A stand-in for `vscode.l10n` / `vscode.env`.
//
// `vscode.l10n.t` does the index templating itself when no bundle is loaded,
// which is what the real API does at runtime in the default language. The
// templating here is written from that behaviour rather than shared with the
// fake: a helper used by both would let one wrong idea satisfy the suite twice
// — a shared helper would let one wrong idea satisfy both sides at once.
const vscodeMock = vi.hoisted(() => {
  const calls: unknown[][] = [];
  const template = (message: string, args: (string | number | boolean)[]): string => {
    let out = '';
    let index = 0;
    while (index < message.length) {
      const open = message.indexOf('{', index);
      const close = open === -1 ? -1 : message.indexOf('}', open);
      if (open === -1 || close === -1) {
        out += message.slice(index);
        break;
      }
      const digits = message.slice(open + 1, close);
      out += message.slice(index, open);
      const position = /^\d+$/.test(digits) ? Number(digits) : undefined;
      const value = position === undefined ? undefined : args[position];
      out += value === undefined ? message.slice(open, close + 1) : String(value);
      index = close + 1;
    }
    return out;
  };

  return {
    calls,
    language: { current: 'en' },
    module: {
      l10n: {
        t: (...args: unknown[]): string => {
          calls.push(args);
          const first = args[0];
          if (typeof first === 'string') {
            return template(first, args.slice(1) as (string | number | boolean)[]);
          }
          const options = first as { message: string; args?: (string | number | boolean)[] };
          return template(options.message, options.args ?? []);
        },
      },
      env: {
        get language(): string {
          return vscodeMock.language.current;
        },
      },
    },
  };
});

vi.mock('vscode', () => vscodeMock.module);

const { createVSCodeLocalizationCapability } =
  await import('../../../src/vscode/capabilities/l10n.js');
const { createFakeLocalization } = await import('../../../src/testing/fakes/fake-localization.js');

/**
 * One suite, run against every implementation of the port. A fake that drifts
 * from the adapter fails here.
 */
function describeLocalizationCapability(
  name: string,
  create: () => LocalizationCapability,
  setLanguage: (language: string) => void
): void {
  describe(name, () => {
    it('reports the host display language', () => {
      setLanguage('ja-JP');

      expect(create().language).toBe('ja-JP');
    });

    it('returns an untranslated message unchanged', () => {
      setLanguage('en');

      expect(create().translate({ message: 'Plain' })).toBe('Plain');
    });

    it('fills positional placeholders from args', () => {
      setLanguage('en');

      expect(create().translate({ message: 'Hello, {0} and {1}!', args: ['a', 'b'] })).toBe(
        'Hello, a and b!'
      );
    });

    it('formats non-string args', () => {
      setLanguage('en');

      expect(create().translate({ message: '{0} files, done={1}', args: [3, true] })).toBe(
        '3 files, done=true'
      );
    });

    it('leaves a placeholder with no argument as written', () => {
      setLanguage('en');

      // Printing `undefined` into user-facing text would be worse than leaving
      // the placeholder visible, and it would hide the missing argument.
      expect(create().translate({ message: 'Hello, {0}!', args: [] })).toBe('Hello, {0}!');
    });

    it('carries a comment without letting it reach the output', () => {
      setLanguage('en');

      expect(
        create().translate({ message: 'Found {0}', args: [2], comment: 'Status bar text' })
      ).toBe('Found 2');
    });

    it('accepts a comment given as an array', () => {
      setLanguage('en');

      expect(
        create().translate({ message: 'Found {0}', args: [2], comment: ['line one', 'line two'] })
      ).toBe('Found 2');
    });
  });
}

/**
 * The fake takes its language at construction and the adapter reads it live, so
 * the suite's `setLanguage` records it here for the next `create()`.
 */
let pendingLanguage = 'en';

describe('LocalizationCapability contract', () => {
  let currentFake: ReturnType<typeof createFakeLocalization> | undefined;
  describeLocalizationCapability(
    'FakeLocalization',
    () => {
      currentFake = createFakeLocalization(pendingLanguage);
      return currentFake;
    },
    (language) => {
      pendingLanguage = language;
      currentFake?._setLanguage(language);
    }
  );

  describeLocalizationCapability(
    'VS Code adapter',
    () => createVSCodeLocalizationCapability(),
    (language) => {
      vscodeMock.language.current = language;
    }
  );
});

describe('the VS Code adapter keeps the extractor-visible call shape', () => {
  it('sends a comment-less message through the positional overload', () => {
    vscodeMock.calls.length = 0;

    createVSCodeLocalizationCapability().translate({ message: 'Found {0} files', args: [3] });

    // `vscode.l10n.t`'s object overload requires `comment`, so a comment-less
    // message has to go positionally or the call throws at runtime.
    expect(vscodeMock.calls[0]).toEqual(['Found {0} files', 3]);
  });

  it('sends a commented message through the object overload', () => {
    vscodeMock.calls.length = 0;

    createVSCodeLocalizationCapability().translate({
      message: 'Found {0} files',
      args: [3],
      comment: 'Status bar text',
    });

    expect(vscodeMock.calls[0]).toEqual([
      { message: 'Found {0} files', comment: ['Status bar text'], args: [3] },
    ]);
  });
});
