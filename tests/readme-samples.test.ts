import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The documented code, checked against code that compiles.
 *
 * Documentation is the first thing a reader runs, and prose goes stale quietly
 * — a rename lands, every call site is updated, and the one in the introduction
 * is not. The reader's very first compile then fails, on the one example they
 * had most reason to trust.
 *
 * Every fenced `ts` block in the pages below is preceded by a marker naming its
 * source file under docs/samples/, and `tsc -p tsconfig.samples.json` (part of
 * `npm run typecheck`) compiles those files with the compiler options the README
 * tells consumers to use. This test is the third link: the text on the page is
 * byte-for-byte the text that compiled.
 *
 * When adding or removing a runnable example, add/remove its `docs/samples`
 * source and its marker in the same change. Prose-only snippets that cannot be
 * compiled should not use this marker, or readers will reasonably assume the
 * exact block passed `tsc`.
 */
const PAGES = ['README.md', join('docs', 'guide.md'), join('docs', 'migration-from-2x.md')];
const SAMPLES = join('docs', 'samples');
// `\n+` because Prettier puts a blank line between an HTML comment and the
// fence after it. Requiring exactly one newline made `npm run format` break
// this suite, which is a bad trade: the check is about the code being current,
// not about the whitespace around it.
const MARKER = /<!-- sample: (\S+) -->\n+```ts\n([\s\S]*?)```/g;

const embedded = PAGES.flatMap((page) =>
  [...readFileSync(page, 'utf8').matchAll(MARKER)].map((match) => ({
    page,
    path: (match[1] ?? '').split('\\').join('/'),
    code: match[2] ?? '',
  }))
);

describe('documented samples', () => {
  it('embeds every file under docs/samples, and nothing else', () => {
    const files = readdirSync(SAMPLES, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
      .map((entry) => `docs/samples/${entry.name}`)
      .sort();
    const referenced = [...new Set(embedded.map((block) => block.path))].sort();

    // Both directions: an unreferenced sample stops being checked by anything a
    // reader sees, and a marker pointing nowhere is a broken promise.
    expect(referenced).toEqual(files);
  });

  it('embeds each sample exactly once', () => {
    // Two pages showing the same sample would both have to be updated together,
    // and one of them silently would not be.
    const duplicated = [
      ...new Map<string, number>(
        embedded.map((block) => [
          block.path,
          embedded.filter((other) => other.path === block.path).length,
        ])
      ),
    ].filter(([, count]) => count > 1);

    expect(duplicated).toEqual([]);
  });

  it('keeps the marker scan from silently switching off', () => {
    // Without this, a change to the marker syntax would switch the whole suite
    // off without failing anything.
    expect(embedded.length).toBeGreaterThanOrEqual(10);
    expect(new Set(embedded.map((block) => block.page)).size).toBe(PAGES.length);
  });

  for (const { page, path, code } of embedded) {
    it(`${page} matches ${path} exactly`, () => {
      const source = readFileSync(path, 'utf8');

      expect(code.split('\r\n').join('\n').trimEnd()).toBe(
        source.split('\r\n').join('\n').trimEnd()
      );
    });
  }
});
