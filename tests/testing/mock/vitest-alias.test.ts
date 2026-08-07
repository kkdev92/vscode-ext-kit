import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import * as alias from '../../../src/testing/mock/vitest.js';

/**
 * The alias module's named exports, checked against what the framework reads.
 *
 * `resolve.alias` pointing at `testing/vitest` is a documented, recommended way
 * to run an extension's tests, and `import * as vscode from 'vscode'` reads
 * *named* exports — so a member the mock object has but this module forgets to
 * re-export is `undefined` at runtime, not a type error.
 *
 * That is not hypothetical. `UIKind` and `extensions` were added to the mock
 * without being added here, and the environment adapter reads
 * `vscode.UIKind.Web` during runtime preflight: activation through the
 * recommended alias threw on every application, while every unit test passed.
 *
 * Listing the members by hand would have the same failure mode, so this reads
 * them out of the adapter sources instead. It is deliberately a containment
 * check and not an equality one — the mock may offer more than the framework
 * happens to use.
 */

/** Adapter sources: the only files that touch the real `vscode` at runtime. */
const ADAPTERS = 'src/vscode';

/**
 * Drops comments so a `@example` block cannot invent a requirement. Strings are
 * left alone: no string literal in these files contains `vscode.` followed by
 * an identifier, and treating them as code costs nothing if one ever does.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '');
}

function listSources(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...listSources(path));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      found.push(path);
    }
  }
  return found;
}

/**
 * Value positions only. `vscode.TextEditor` in a type annotation is erased
 * before anything runs and needs no export, so matching every `vscode.X` would
 * demand exports for types and make the check meaningless. What survives to
 * runtime is a member access (`vscode.env.uiKind`), a call, or a construction.
 */
const USES = [/\bvscode\.([A-Za-z_$][\w$]*)\s*[.(]/gu, /\bnew\s+vscode\.([A-Za-z_$][\w$]*)/gu];

/** Every `vscode.X` the adapters dereference, mapped to the files that do. */
function collectMembers(): Map<string, Set<string>> {
  const members = new Map<string, Set<string>>();
  for (const file of listSources(ADAPTERS)) {
    const source = readFileSync(file, 'utf8');
    // Type-only importers never dereference the namespace at runtime.
    if (!/^import \* as vscode from 'vscode';$/mu.test(source)) {
      continue;
    }
    const code = stripComments(source);
    for (const pattern of USES) {
      for (const match of code.matchAll(pattern)) {
        const name = match[1];
        if (name === undefined) {
          continue;
        }
        const files = members.get(name) ?? new Set<string>();
        files.add(file.split('\\').join('/'));
        members.set(name, files);
      }
    }
  }
  return members;
}

const MEMBERS = collectMembers();

describe('the vitest alias module', () => {
  it('scans the adapters it claims to', () => {
    // A regex that silently matched nothing would make the assertion below pass
    // for free, which is the one way this test could be worse than useless.
    expect(MEMBERS.size).toBeGreaterThan(10);
    expect([...MEMBERS.keys()]).toContain('UIKind');
  });

  it('exports every vscode member the adapters read', () => {
    const exported = new Set(Object.keys(alias));
    const missing = [...MEMBERS.entries()]
      .filter(([name]) => !exported.has(name))
      .map(([name, files]) => `  - ${name}  (read by ${[...files].join(', ')})`);

    expect(
      missing,
      `src/testing/mock/vitest.ts is missing named exports the framework dereferences ` +
        `at runtime. Aliasing 'vscode' to it would leave these undefined:\n${missing.join('\n')}`
    ).toEqual([]);
  });
});
