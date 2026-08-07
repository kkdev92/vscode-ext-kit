// Bundles the web fixture the way a web extension ships: a single browser bundle
// with `vscode` external, loaded by the `browser` entry in package.json.

import { resolve } from 'node:path';
import process from 'node:process';

import { build } from 'esbuild';

const here = import.meta.dirname;

const shared = {
  bundle: true,
  platform: 'browser',
  target: 'es2022',
  format: 'cjs',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'warning',
  // No Node shims on purpose: if the framework reached for a Node built-in the
  // bundle would fail here rather than at runtime in a user's browser.
  define: { global: 'globalThis' },
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

process.stdout.write('bundled web fixture (browser, vscode external)\n');
