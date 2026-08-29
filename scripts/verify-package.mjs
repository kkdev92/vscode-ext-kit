/**
 * Verifies the published package from the outside.
 *
 * Everything else in the repo tests the source tree. This packs the tarball npm
 * would publish, installs it into a throwaway consumer project, and checks the
 * two claims a consumer actually depends on:
 *
 * 1. Every subpath in `exports` can be imported. A missing file, a wrong `dist`
 *    path or a barrel that throws at import time fails here rather than in
 *    somebody's extension.
 * 2. The package is ESM-only, and *provably* so: `require()` of every subpath
 *    fails with ERR_PACKAGE_PATH_NOT_EXPORTED. Documenting "ESM only" is a
 *    claim; this is the test that keeps it from quietly becoming half-true.
 *
 * The consumer gets a stub `vscode` module, because the real one is injected by
 * the extension host and does not exist on npm. The stub is a recursive Proxy,
 * so any module-scope `vscode.Foo.Bar` the kit touches while loading resolves to
 * something rather than throwing — which is exactly what this check needs to
 * distinguish "the barrel is broken" from "there is no extension host here".
 *
 * Run with `npm run verify:package`. Requires a build first; it checks.
 */

import { execFileSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = resolve(import.meta.dirname, '..');
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

/**
 * Runs a command, echoing nothing unless it fails.
 *
 * `npm` is `npm.cmd` on Windows, and Node refuses to spawn a `.cmd` without a
 * shell, so those calls go through one — with every argument quoted, since a
 * shell would otherwise split a path containing a space.
 */
function run(command, args, cwd) {
  const shell = command.endsWith('.cmd');
  return execFileSync(shell ? command : command, shell ? args.map((a) => `"${a}"`) : args, {
    cwd,
    shell,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const packageName = manifest.name;

/** Every importable subpath, `.` first, `./package.json` excluded. */
const subpaths = Object.entries(manifest.exports)
  .filter(([key]) => key !== './package.json')
  .map(([key]) => (key === '.' ? packageName : `${packageName}/${key.slice(2)}`));

/**
 * Subpaths that import the optional `vitest` peer, so a consumer without vitest
 * is *expected* to fail on them.
 */
const NEEDS_VITEST = new Set([`${packageName}/testing/vitest`]);

if (!existsSync(join(ROOT, 'dist', 'index.js'))) {
  console.error('dist/ is missing. Run `npm run build` first.');
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), 'vek-consumer-'));
let failures = 0;
const note = (ok, message) => {
  if (!ok) failures += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${message}`);
};

try {
  // 0. Zero runtime dependencies is a published claim -- README, SECURITY.md
  // and the 4.0.0 changelog all make it -- so it is asserted rather than
  // assumed: here on the manifest about to be packed, and again below on the
  // copy a consumer actually installs.
  note(
    Object.keys(manifest.dependencies ?? {}).length === 0,
    'package.json declares no runtime dependencies'
  );

  // 1. Pack exactly what `npm publish` would send.
  // `prepack` cleans and rebuilds first, so the tarball cannot contain a stale
  // output. It did: `dist/capabilities/ui/index.js` shipped for one commit after
  // the file moved, because `tsc -b` leaves removed outputs behind.
  const packed = JSON.parse(run(npm, ['pack', '--json', '--pack-destination', work], ROOT))[0];
  const tarball = join(work, packed.filename);
  console.log(
    `packed ${packed.filename}: ${packed.files.length} files, ` +
      `${Math.round(packed.size / 1024)} KiB packed, ` +
      `${Math.round(packed.unpackedSize / 1024)} KiB unpacked`
  );

  // A budget, not a limit for its own sake. `files` ships `src` and source maps
  // on purpose so a consumer can step into the library, which is most of the
  // unpacked size; the point of the numbers is to notice when something *else*
  // starts riding along.
  note(packed.files.length < 600, `file count within budget (${packed.files.length} < 600)`);
  note(
    packed.size < 600 * 1024,
    `tarball within budget (${Math.round(packed.size / 1024)} KiB < 600)`
  );
  note(
    !packed.files.some((file) => file.path.startsWith('dist/capabilities/ui/index')),
    'no stale pre-move output in dist/'
  );

  // 2. A consumer project, ESM, with a stub `vscode` in node_modules.
  const consumer = join(work, 'consumer');
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, 'package.json'),
    JSON.stringify({ name: 'consumer', private: true, type: 'module', version: '0.0.0' }, null, 2)
  );

  run(npm, ['install', '--no-audit', '--no-fund', tarball], consumer);
  note(existsSync(join(consumer, 'node_modules', ...packageName.split('/'))), 'tarball installs');

  const installedManifest = JSON.parse(
    readFileSync(join(consumer, 'node_modules', ...packageName.split('/'), 'package.json'), 'utf8')
  );
  note(
    Object.keys(installedManifest.dependencies ?? {}).length === 0,
    'the installed package.json declares no runtime dependencies'
  );

  // The stub and the types go in *after* the install: npm prunes anything in
  // node_modules that no manifest declares, which silently removed the stub and
  // turned every `vscode`-touching subpath into ERR_MODULE_NOT_FOUND.
  const vscodeStub = join(consumer, 'node_modules', 'vscode');
  mkdirSync(vscodeStub, { recursive: true });
  writeFileSync(
    join(vscodeStub, 'package.json'),
    JSON.stringify({ name: 'vscode', version: '1.125.0', main: 'index.cjs' }, null, 2)
  );
  writeFileSync(
    join(vscodeStub, 'index.cjs'),
    `// Recursive Proxy: any property access answers with another Proxy, so the
// kit's module-scope reads resolve while loading. Calling one returns a Proxy
// too, which is enough for a load-time \`createX()\`.
const make = () =>
  new Proxy(function () {}, {
    get: (_target, key) => (key === 'then' ? undefined : make()),
    apply: () => make(),
    construct: () => make(),
  });
module.exports = make();
`
  );

  // Real consumers install @types/vscode; reuse the copy this repo pins so the
  // type check runs against the same version the kit is built against.
  cpSync(
    join(ROOT, 'node_modules', '@types', 'vscode'),
    join(consumer, 'node_modules', '@types', 'vscode'),
    { recursive: true }
  );

  // 3. Import every subpath, and require every subpath.
  const probe = join(consumer, 'probe.mjs');
  writeFileSync(
    probe,
    `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const results = [];
for (const specifier of ${JSON.stringify(subpaths)}) {
  let esm = 'ok';
  let names = 0;
  let message = '';
  try {
    const loaded = await import(specifier);
    names = Object.keys(loaded).length;
  } catch (error) {
    esm = error?.code ?? String(error?.message ?? error);
    message = String(error?.message ?? '');
  }
  let cjs = 'loaded';
  try {
    require(specifier);
  } catch (error) {
    cjs = error?.code ?? 'threw';
  }
  results.push({ specifier, esm, names, cjs, message });
}
console.log(JSON.stringify(results));
`
  );
  const results = JSON.parse(run(process.execPath, [probe], consumer));

  for (const { specifier, esm, names, cjs, message } of results) {
    if (NEEDS_VITEST.has(specifier)) {
      // This subpath imports `vi` from vitest, declared as an optional peer, and
      // the consumer here has no vitest. The right outcome is not "it loads" but
      // "it fails naming vitest" -- anything else (a missing dist file, say)
      // would produce a different message and still fail this check.
      note(
        esm === 'ERR_MODULE_NOT_FOUND' && /vitest/.test(message),
        `import ${specifier} needs the optional vitest peer (got ${esm})`
      );
    } else {
      note(
        esm === 'ok',
        `import ${specifier}${esm === 'ok' ? ` (${names} exports)` : ` -> ${esm} ${message}`}`
      );
    }
    note(
      cjs === 'ERR_PACKAGE_PATH_NOT_EXPORTED' || cjs === 'ERR_REQUIRE_ESM',
      `require ${specifier} rejected as ESM-only (got ${cjs})`
    );
  }

  // 4. The README's own samples, compiled against the packed .d.ts files.
  //
  // `npm run typecheck` already compiles docs/samples against `src` through path
  // aliases, and tests/readme-samples.test.ts pins them to the README text. This
  // is the third leg: the same code, resolving the package by name, against the
  // declarations a consumer actually installs. A `.d.ts` that only works inside
  // this repo fails here.
  const samples = join(ROOT, 'docs', 'samples');
  cpSync(samples, join(consumer, 'samples'), { recursive: true });
  const sampleFiles = readdirSync(samples, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => `samples/${entry.name}`);
  note(sampleFiles.length > 0, `found ${sampleFiles.length} README samples to compile`);
  writeFileSync(
    join(consumer, 'tsconfig.json'),
    JSON.stringify(
      {
        // The configuration the README tells consumers to use, and the reason
        // the README has to say it at all: the kit's public types name
        // `Symbol.dispose` (needs ESNext.Disposable, else TS2550) and
        // `AbortSignal` (needs DOM, WebWorker or @types/node, else TS2304).
        // Both were found by this check rather than by reading the docs.
        compilerOptions: {
          module: 'nodenext',
          moduleResolution: 'nodenext',
          target: 'es2023',
          lib: ['ES2023', 'ESNext.Disposable', 'DOM'],
          types: ['vscode'],
          strict: true,
          noEmit: true,
          skipLibCheck: false,
        },
        files: sampleFiles,
      },
      null,
      2
    )
  );
  try {
    run(
      process.execPath,
      [join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', '.'],
      consumer
    );
    note(true, 'README samples typecheck against the packed types (nodenext)');
  } catch (error) {
    note(false, `consumer.ts typecheck failed:\n${error.stdout ?? error.message}`);
  }

  // 5. The command-line tool, run from the installed package against a plan
  // the consumer wrote. The only place the `vscode` stand-in meets a real
  // install rather than this repository's own layout.
  writeFileSync(
    join(consumer, 'consumer-plan.mjs'),
    `import { defineCommandContract, defineExtension, defineModule } from '${packageName}';
const Hello = defineCommandContract({ id: 'consumer.hello', title: 'Hello' });
const greeting = defineModule('greeting', (module) => {
  module.commands.handle(Hello, () => undefined);
  return undefined;
});
export const app = defineExtension({ name: 'consumer', modules: [greeting] });
`
  );
  try {
    const described = JSON.parse(
      run(
        process.execPath,
        [
          join(consumer, 'node_modules', ...packageName.split('/'), 'bin', 'vscode-ext-kit.mjs'),
          'plan',
          join(consumer, 'consumer-plan.mjs'),
          '--format',
          'json',
        ],
        consumer
      )
    );
    note(
      described.name === 'consumer' && described.commands[0]?.id === 'consumer.hello',
      'the CLI describes a consumer plan from the installed package'
    );
  } catch (error) {
    note(false, `the CLI failed against the installed package:\n${error.stderr ?? error.message}`);
  }

  // 6. `manifest`, from the installed package. The consumer's package.json
  // contributes nothing, so the one command its plan declares must come back
  // as missing — through the package's `./testing` entry, resolved from a real
  // install rather than this repository's layout.
  const cli = join(
    consumer,
    'node_modules',
    ...packageName.split('/'),
    'bin',
    'vscode-ext-kit.mjs'
  );
  try {
    run(
      process.execPath,
      [
        cli,
        'manifest',
        join(consumer, 'consumer-plan.mjs'),
        '--manifest',
        join(consumer, 'package.json'),
        '--format',
        'json',
      ],
      consumer
    );
    note(false, 'the CLI reported no manifest disagreement where one exists');
  } catch (error) {
    const mismatches = error.status === 1 ? JSON.parse(error.stdout) : [];
    const [only] = mismatches;
    note(
      mismatches.length === 1 &&
        only.kind === 'command' &&
        only.direction === 'missing-in-manifest' &&
        only.id === 'consumer.hello',
      error.status === 1
        ? 'the CLI diffs a consumer manifest from the installed package'
        : `the CLI failed to diff the consumer manifest:\n${error.stderr ?? error.message}`
    );
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(
  failures === 0 ? '\nall package checks passed' : `\n${failures} package check(s) failed`
);
process.exit(failures === 0 ? 0 : 1);

// Referenced so a bundler-style analysis does not consider it unused.
void pathToFileURL;
