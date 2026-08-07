import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The layering, as a test.
 *
 * `src/` is four layers: `foundation` (the architecture core — plan, host,
 * container, ports), `capabilities` (the APIs an extension actually calls,
 * built on it), `vscode` (the only place allowed to touch the real API) and
 * `testing` (the published test surface). The rules that make that more than a
 * folder convention:
 *
 * - `foundation` and `capabilities` import no `vscode`, which means they must
 *   not import the adapter layer either. ESLint's `no-restricted-imports` only
 *   sees the specifier `'vscode'`, so a *relative* import of an adapter slips
 *   straight past it — a module can end up vscode-bound while every lint rule
 *   still passes.
 * - `foundation -> capabilities` does exist, because the plan has to weave
 *   capability registrations together. It is confined to the points listed
 *   below, each with its reason; adding one is a deliberate decision, not a
 *   drive-by import.
 * - production code never imports the test surface.
 *
 * This reads source text rather than a compiled graph, which is exactly why the
 * last test asserts the scan found anything at all: a regex that quietly
 * matched nothing would turn every rule above into one that passes for free.
 *
 * Maintenance rule: update this suite when introducing a layer, import form or
 * intentional cross-layer composition point. Do not add an allow-list entry
 * merely to make a new edge pass; record why the lower layer must know the
 * higher one and prefer dependency inversion through a foundation port.
 */

const SRC = 'src';
const LAYERS = ['foundation', 'capabilities', 'vscode', 'testing'] as const;
type Layer = (typeof LAYERS)[number] | 'root';

/**
 * Where `foundation` is allowed to reach into `capabilities`, and why.
 *
 * The list is the rule — the test below compares it against what the source
 * actually does, in both directions, so an entry left here after its import is
 * gone fails just as loudly as a new import that is not listed.
 */
const AGGREGATION_POINTS: readonly string[] = [
  // Binds every capability registration a plan can carry.
  'src/foundation/application/application.ts',
  // Compiles the plan those registrations live in.
  'src/foundation/application/plan.ts',
  // The module builder that collects them in the first place.
  'src/foundation/modules/definition.ts',
  // Type-only. The operation context names the services a handler finds on it
  // without declaring them, and those live in the capability layer.
  'src/foundation/operations/context.ts',
];

/** The mock kit mirrors the vscode API shape, so it may reference its types. */
const TYPE_ONLY_VSCODE: readonly string[] = [
  'src/testing/mock/vscode-mock.ts',
  'src/testing/mock/mock-factories.ts',
];

/**
 * Removes comments, keeping string and template literals intact.
 *
 * A plain regex sweep would count `@example` blocks as imports — the webview
 * client's JSDoc shows `from '../../shared/rpc-schema.js'`, a path that does not
 * exist — and would also mangle a `'https://'` inside a string.
 */
function stripComments(source: string): string {
  let out = '';
  let index = 0;
  type State = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  let state: State = 'code';
  while (index < source.length) {
    const char = source[index] ?? '';
    const next = source[index + 1] ?? '';
    if (state === 'code') {
      if (char === '/' && next === '/') {
        state = 'line';
        index += 2;
        continue;
      }
      if (char === '/' && next === '*') {
        state = 'block';
        index += 2;
        continue;
      }
      if (char === "'") state = 'single';
      else if (char === '"') state = 'double';
      else if (char === '`') state = 'template';
      out += char;
      index += 1;
      continue;
    }
    if (state === 'line') {
      if (char === '\n') {
        state = 'code';
        out += char;
      }
      index += 1;
      continue;
    }
    if (state === 'block') {
      if (char === '*' && next === '/') {
        state = 'code';
        index += 2;
        continue;
      }
      // Newlines are kept so line numbers stay usable in a failure message.
      if (char === '\n') out += char;
      index += 1;
      continue;
    }
    // Inside a literal: copy through, honouring escapes.
    out += char;
    if (char === '\\') {
      out += next;
      index += 2;
      continue;
    }
    if (
      (state === 'single' && char === "'") ||
      (state === 'double' && char === '"') ||
      (state === 'template' && char === '`')
    ) {
      state = 'code';
    }
    index += 1;
  }
  return out;
}

interface ImportRecord {
  /** Repo-relative path of the importing file, forward slashes. */
  readonly from: string;
  /** The specifier as written. */
  readonly specifier: string;
  /** Resolved repo-relative path, for a relative specifier. */
  readonly target: string | undefined;
  /** Whether the statement was `import type` / `export type`. */
  readonly typeOnly: boolean;
}

function listFiles(directory: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      found.push(...listFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.ts')) {
      found.push(path.split('\\').join('/'));
    }
  }
  return found;
}

const STATEMENT =
  /(?:^|[;\n{}])[\t ]*(?:import|export)\s+(type\s+)?(?:[\s\S]*?from\s*)?['"]([^'"]+)['"]/g;
const DYNAMIC = /import\(\s*['"]([^'"]+)['"]/g;

function collect(): ImportRecord[] {
  const records: ImportRecord[] = [];
  for (const file of listFiles(SRC)) {
    const source = stripComments(readFileSync(file, 'utf8'));
    const add = (specifier: string, typeOnly: boolean): void => {
      const target = specifier.startsWith('.')
        ? posix.normalize(posix.join(dirname(file).split('\\').join('/'), specifier))
        : undefined;
      records.push({
        from: file,
        specifier,
        // `.js` in a specifier is `.ts` on disk.
        target: target?.replace(/\.js$/, '.ts'),
        typeOnly,
      });
    };
    for (const match of source.matchAll(STATEMENT)) {
      add(match[2] ?? '', match[1] !== undefined);
    }
    for (const match of source.matchAll(DYNAMIC)) {
      add(match[1] ?? '', false);
    }
  }
  return records;
}

const IMPORTS = collect();

function layerOf(path: string): Layer {
  for (const layer of LAYERS) {
    if (path.startsWith(`${SRC}/${layer}/`)) {
      return layer;
    }
  }
  return 'root';
}

/** Every cross-layer relative edge, as `"a.ts -> b.ts"` for readable failures. */
function edges(from: Layer, to: Layer): string[] {
  return IMPORTS.filter(
    (record) =>
      record.target !== undefined && layerOf(record.from) === from && layerOf(record.target) === to
  ).map((record) => `${record.from} -> ${String(record.target)}`);
}

describe('layer boundaries', () => {
  for (const layer of ['foundation', 'capabilities'] as const) {
    it(`${layer} does not import the vscode adapter layer`, () => {
      expect(edges(layer, 'vscode')).toEqual([]);
    });

    it(`${layer} does not import the test surface`, () => {
      expect(edges(layer, 'testing')).toEqual([]);
    });

    it(`${layer} does not import vscode itself`, () => {
      const offenders = IMPORTS.filter(
        (record) => record.specifier === 'vscode' && layerOf(record.from) === layer
      ).map((record) => record.from);

      expect(offenders).toEqual([]);
    });
  }

  it('lets only the vscode layer and the mock kit name vscode at all', () => {
    const files = [
      ...new Set(
        IMPORTS.filter((record) => record.specifier === 'vscode').map((record) => record.from)
      ),
    ];
    const unexpected = files.filter(
      (file) => layerOf(file) !== 'vscode' && !TYPE_ONLY_VSCODE.includes(file)
    );

    expect(unexpected).toEqual([]);
  });

  it('keeps the mock kit type-only, so it carries no runtime dependency', () => {
    const runtime = IMPORTS.filter(
      (record) =>
        record.specifier === 'vscode' && TYPE_ONLY_VSCODE.includes(record.from) && !record.typeOnly
    ).map((record) => record.from);

    expect(runtime).toEqual([]);
  });

  it('confines foundation -> capabilities to the declared aggregation points', () => {
    const importers = [
      ...new Set(edges('foundation', 'capabilities').map((edge) => edge.split(' -> ')[0] ?? '')),
    ].sort();

    expect(importers).toEqual([...AGGREGATION_POINTS].sort());
  });

  it('keeps the root barrel out of everything below it', () => {
    const offenders = IMPORTS.filter(
      (record) => record.target === `${SRC}/index.ts` && record.from !== `${SRC}/index.ts`
    ).map((record) => record.from);

    expect(offenders).toEqual([]);
  });

  it('resolves every relative specifier to a file that exists', () => {
    // Catches a typo, and proves the scan is reading real paths rather than
    // pattern-matching noise.
    const files = new Set(listFiles(SRC));
    const missing = IMPORTS.filter(
      (record) => record.target !== undefined && !files.has(record.target)
    ).map((record) => `${record.from} -> ${record.specifier}`);

    expect(missing).toEqual([]);
  });

  it('actually scanned a non-trivial source graph', () => {
    // Without this, a regex that stopped matching would make every rule above
    // pass by finding nothing at all.
    // These are tripwires, not architecture size targets. Keep them comfortably
    // below the current graph so normal file movement does not create churn.
    expect(listFiles(SRC).length).toBeGreaterThan(80);
    expect(IMPORTS.filter((record) => record.target !== undefined).length).toBeGreaterThan(200);
    expect(edges('capabilities', 'foundation').length).toBeGreaterThan(10);
    // Deliberately low. Adapters should mostly translate foundation ports, so
    // few of them need to reach back into capability implementation. This is a
    // scan-health tripwire, not a target that encourages more dependencies.
    expect(edges('vscode', 'capabilities').length).toBeGreaterThan(0);
    expect(IMPORTS.filter((record) => record.specifier === 'vscode').length).toBeGreaterThan(10);
  });
});
