// Bundles the fixture the way a real extension ships: a single CommonJS file
// with `vscode` left external.
//
// This is not a workaround. VS Code loads an extension's `main` with `require`,
// and its own build does exactly this (bundle: true, external: ['vscode']), so
// bundling is the representative consumer setup — and it proves the framework's
// ESM output survives it.

import { resolve } from 'node:path';
import process from 'node:process';

import { build } from 'esbuild';

const here = import.meta.dirname;

const shared = {
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'warning',
};

await Promise.all([
  build({
    ...shared,
    entryPoints: [resolve(here, 'src/extension.ts')],
    outfile: resolve(here, 'out/extension.js'),
  }),
  build({
    ...shared,
    entryPoints: [resolve(here, 'src/test/index.ts')],
    outfile: resolve(here, 'out/test/index.js'),
  }),
]);

process.stdout.write('bundled fixture (cjs, vscode external)\n');
