import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createVSCodeMock } from '../src/testing/index.js';

/**
 * Regression test for the class of bug described in
 * `work/20260728/vscode-ext-kit-1.0-upstream-issues.md` (#3): the kit's own
 * runtime code called `vscode.workspace.applyEdit`, but `createVSCodeMock`
 * never implemented it, so any consumer test exercising `applyWorkspaceEdits`
 * failed with "vscode.workspace.applyEdit is not a function".
 *
 * This scans `src/**\/*.ts` (excluding `src/testing/**`, which *builds* the
 * mock rather than *consuming* the real API) for every `vscode.<namespace>.
 * <member>` the kit itself references, and asserts each one exists on the
 * matching `createVSCodeMock(vi)` namespace. Comments (including JSDoc
 * `@example` blocks) are stripped before scanning — an API mentioned only in
 * a doc comment (e.g. `vscode.window.onDidChangeActiveTextEditor` in
 * `src/core/disposable.ts`'s example) is not a real usage and must not be
 * treated as one.
 */

const SRC_DIR = fileURLToPath(new URL('../src', import.meta.url));

const MOCK_NAMESPACES = ['window', 'workspace', 'commands', 'languages', 'env', 'l10n'] as const;
type MockNamespace = (typeof MOCK_NAMESPACES)[number];

const USAGE_PATTERN = new RegExp(`vscode\\.(${MOCK_NAMESPACES.join('|')})\\.(\\w+)`, 'g');

/**
 * Strips `/* *\/`-style block comments (including JSDoc, so multi-line
 * `@example` code fences disappear as a whole) and then `//`-style line
 * comments, so example code inside documentation is never mistaken for a
 * real `vscode.*` call.
 */
function stripComments(source: string): string {
  const withoutBlockComments = source.replace(/\/\*[\s\S]*?\*\//g, '');
  return withoutBlockComments
    .split('\n')
    .map((line) => {
      const commentStart = line.indexOf('//');
      return commentStart === -1 ? line : line.slice(0, commentStart);
    })
    .join('\n');
}

/** Recursively lists every `.ts` file under `dir`. */
function listTsFilesRecursive(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listTsFilesRecursive(fullPath));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * Every `vscode.<namespace>.<member>` referenced by the kit's own runtime
 * source (excluding `src/testing/**`), grouped by namespace.
 */
function collectVSCodeUsage(): Map<MockNamespace, Set<string>> {
  const usage = new Map<MockNamespace, Set<string>>();
  for (const namespace of MOCK_NAMESPACES) {
    usage.set(namespace, new Set());
  }

  for (const file of listTsFilesRecursive(SRC_DIR)) {
    const relPath = relative(SRC_DIR, file).split(sep).join('/');
    if (relPath.startsWith('testing/')) continue;

    const code = stripComments(readFileSync(file, 'utf8'));
    for (const match of code.matchAll(USAGE_PATTERN)) {
      const namespace = match[1];
      const member = match[2];
      if (!namespace || !member) continue;
      usage.get(namespace as MockNamespace)?.add(member);
    }
  }

  return usage;
}

describe('testing kit coverage (meta test)', () => {
  it('scans real vscode.* usage in src/ (sanity check for the scanner itself)', () => {
    // Guards against the coverage assertion below passing vacuously (e.g. if
    // a future src/ reorg quietly breaks the scan and it stops matching
    // anything at all).
    const usage = collectVSCodeUsage();
    const totalUsages = [...usage.values()].reduce((sum, members) => sum + members.size, 0);
    expect(totalUsages).toBeGreaterThan(0);
  });

  it('createVSCodeMock implements every vscode.<namespace>.<member> the kit itself calls', () => {
    const usage = collectVSCodeUsage();
    const mock = createVSCodeMock(vi) as unknown as Record<MockNamespace, object>;

    const missing: string[] = [];
    for (const [namespace, members] of usage) {
      const mockNamespace = mock[namespace];
      for (const member of members) {
        if (!(member in mockNamespace)) {
          missing.push(`vscode.${namespace}.${member}`);
        }
      }
    }

    expect(missing).toEqual([]);
  });
});
