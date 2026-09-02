import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The versions the documentation quotes, checked against the manifest.
 *
 * Prose that names a version is correct on the day it is written and wrong on
 * the day the version moves, and nothing fails in between — the reader is the
 * one who finds out. This repository already pins the documented *code* to
 * sources that compile; these are the documented *numbers*, pinned the same way.
 *
 * Only requirements are pinned here. A claim about which release is current
 * belongs to the npm badge, which is generated: the pages below should not say
 * it at all, and the last case asserts they do not.
 */
const PAGES = ['README.md', join('docs', 'guide.md'), join('docs', 'migration-from-2x.md')];

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  engines: { vscode: string; node: string };
  devDependencies: Record<string, string>;
};

const pages = PAGES.map((page) => ({ page, text: readFileSync(page, 'utf8') }));

describe('documented versions', () => {
  it('quotes the VS Code floor exactly as the manifest declares it', () => {
    const declared = manifest.engines.vscode;
    const readme = pages.find((p) => p.page === 'README.md');
    expect(readme?.text).toContain(`\`${declared}\``);
  });

  it('quotes the Node floor exactly as the manifest declares it', () => {
    const declared = manifest.engines.node;
    const readme = pages.find((p) => p.page === 'README.md');
    expect(readme?.text).toContain(`\`${declared}\``);
  });

  it('names no VS Code version other than the declared floor', () => {
    // `1.134.0` on its own is the same floor written without a range, which the
    // paragraph under the requirements table does deliberately. Anything else
    // is a version that moved without the prose moving with it.
    const floor = manifest.engines.vscode.replace(/^[^\d]*/, '');
    const found = pages.flatMap(({ page, text }) =>
      [...text.matchAll(/`\^?(1\.\d{2,3}\.\d+)`/g)].map((m) => ({ page, version: m[1] ?? '' }))
    );
    const stale = found.filter((f) => f.version !== floor);
    expect(stale).toEqual([]);
  });

  it('keeps @types/vscode on the same version as the floor', () => {
    // Raising only the types would let code compile against an API the declared
    // floor does not have, and `vsce` refuses the opposite. The README says the
    // two move together; this is that sentence as a check.
    const types = (manifest.devDependencies['@types/vscode'] ?? '').replace(/^[^\d]*/, '');
    const floor = manifest.engines.vscode.replace(/^[^\d]*/, '');
    expect(types).toBe(floor);
  });

  it('leaves "which release is current" to the badge', () => {
    // The npm badge renders the current version and cannot go stale. Prose that
    // repeats it can, and did: `4.1.0 is the current release` survived into the
    // release that replaced it.
    const claims = pages.flatMap(({ page, text }) =>
      [...text.matchAll(/^.*\b(?:is the current (?:release|line)|holds `latest`).*$/gm)].map(
        (m) => `${page}: ${m[0].trim()}`
      )
    );
    expect(claims).toEqual([]);
  });
});
