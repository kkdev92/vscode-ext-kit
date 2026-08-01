#!/usr/bin/env node
/**
 * Consumer smoke test.
 *
 * `npm test` in this repo never proves the *published package* actually
 * works: every source file under test is already inside `src/`, which Vite
 * transforms directly — so a `vi.mock('vscode', ...)` always reaches it. A
 * real consumer instead resolves `@kkdev92/vscode-ext-kit` through
 * `node_modules`, which Vitest externalizes by default, and unpacks a
 * tarball that only contains whatever `package.json`'s `files` allowlist
 * says it does. Both of those are invisible to this repo's own test suite.
 *
 * This script reproduces the consumer boundary for real:
 *   1. `npm pack` this working tree into a real tarball (no `file:`/symlink
 *      shortcuts — those don't go through the same "is this inside
 *      node_modules" externalization heuristic a registry install does).
 *   2. Install that tarball into a disposable "consumer" project.
 *   3. Run that project's tests with the exact Vitest setup this project's
 *      README recommends (`server.deps.inline`, included).
 *   4. Assert on the result — not just the exit code, but the *reasons* a
 *      consumer-only failure would show up:
 *        - item 1: does `vi.mock('vscode')` actually reach the kit's own
 *          `import * as vscode from 'vscode'` once it's on the far side of
 *          node_modules?
 *        - item 2: does inlining the kit (the fix for item 1) spam
 *          "Sourcemap ... points to missing source files" because the
 *          tarball ships `.js.map`/`.d.ts.map` without the `src/` they
 *          point at?
 *        - item 3: does the published mock actually implement the vscode.*
 *          surface the kit's own runtime calls (e.g. `workspace.applyEdit`
 *          for `applyWorkspaceEdits`)?
 *        - do the subpath exports (`./testing`, `./testing/vitest`,
 *          `./testing/vitest-config`, `./timing`, `./retry`, `./format`,
 *          `./package.json`) resolve at all from outside this repo?
 *
 * The consumer project is deliberately created *inside* this repo (under
 * `.smoke-tmp/`, gitignored) rather than under the OS temp dir: nesting it
 * lets Node's ordinary node_modules directory walk resolve `vitest`,
 * `typescript`, and `@types/vscode` from this repo's own `node_modules`
 * without a second, slower, network-dependent install of packages already
 * on disk. Only the packed tarball itself is installed into the consumer's
 * own `node_modules`, which is the one thing that must be a real,
 * non-symlinked package directory for the externalization behavior to be
 * representative.
 *
 * Node built-ins only — no dependencies, no dev-only tooling.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function log(message) {
  process.stdout.write(`[smoke] ${message}\n`);
}

function section(message) {
  process.stdout.write(`\n[smoke] === ${message} ===\n`);
}

/** Wraps an argument in double quotes if it needs it for a shell command line. */
function quoteArg(arg) {
  const str = String(arg);
  if (str === '') return '""';
  return /[\s"]/.test(str) ? `"${str.replace(/"/g, '\\"')}"` : str;
}

/**
 * Runs a command through the platform shell as a single, pre-quoted command
 * line, and captures output instead of inheriting stdio.
 *
 * Node's `spawnSync` cannot execute `.cmd` shims (npm, vitest, tsc, ...)
 * directly on Windows without `shell: true` (it fails with `EINVAL`), but
 * `shell: true` combined with an `args` array trips Node's own deprecation
 * warning about unescaped arguments. Building one already-quoted string
 * ourselves and passing it as `command` (no separate `args`) avoids both:
 * every argument reaching this function is a fixed flag or a path this
 * script itself constructed, never external/untrusted input.
 */
function sh(command, args, opts = {}) {
  const commandLine = [command, ...args.map(quoteArg)].join(' ');
  return spawnSync(commandLine, {
    shell: true,
    encoding: 'utf8',
    ...opts,
  });
}

function dump(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

/** Cleanup paths registered so far, printed and preserved if we fail. */
const cleanupOnFailure = [];

function fail(message) {
  console.error(`\n[smoke] FAILED: ${message}`);
  if (cleanupOnFailure.length > 0) {
    console.error('[smoke] Left on disk for inspection:');
    for (const p of cleanupOnFailure) console.error(`  - ${p}`);
  }
  process.exit(1);
}

// ----------------------------------------------------------------------
// 0. Preconditions
// ----------------------------------------------------------------------
const distEntry = path.join(REPO_ROOT, 'dist', 'index.js');
if (!existsSync(distEntry)) {
  fail(`"${distEntry}" does not exist — run "npm run build" before "npm run test:smoke".`);
}

// ----------------------------------------------------------------------
// 1. Scratch directories
// ----------------------------------------------------------------------
const scratchRoot = path.join(REPO_ROOT, '.smoke-tmp');
mkdirSync(scratchRoot, { recursive: true });
const runDir = mkdtempSync(path.join(scratchRoot, 'run-'));
cleanupOnFailure.push(runDir);

const packDir = path.join(runDir, 'pack');
const consumerDir = path.join(runDir, 'consumer');
mkdirSync(packDir, { recursive: true });
mkdirSync(path.join(consumerDir, 'tests'), { recursive: true });

// ----------------------------------------------------------------------
// 2. `npm pack` the current working tree
// ----------------------------------------------------------------------
section('npm pack');
log(`packing into ${packDir}`);
const packResult = sh(
  'npm',
  ['pack', '--json', '--ignore-scripts', '--pack-destination', packDir],
  { cwd: REPO_ROOT }
);
if (packResult.status !== 0) {
  dump(packResult);
  fail(`npm pack exited with code ${packResult.status}`);
}

let packInfo;
try {
  packInfo = JSON.parse(packResult.stdout)[0];
} catch (error) {
  dump(packResult);
  fail(`could not parse "npm pack --json" output: ${error.message}`);
}

const tarballPath = path.join(packDir, packInfo.filename);
log(`tarball: ${tarballPath} (${packInfo.files.length} files, ${packInfo.unpackedSize} bytes unpacked)`);

// Regression check for report item 2, checked directly against the pack
// manifest (not just indirectly through the sourcemap-warning grep below):
// `src/` must be part of the published tarball, since dist/**/*.map already
// points there.
const hasSrc = packInfo.files.some((f) => f.path === 'src' || f.path.startsWith('src/'));
if (!hasSrc) {
  fail(
    'the packed tarball does not contain "src/" (package.json "files" regressed — report item 2). ' +
      'dist/**/*.js.map and *.d.ts.map point at src/*.ts that would not be published.'
  );
}
log('tarball contains "src/" (sourcemaps have somewhere to point).');

// ----------------------------------------------------------------------
// 3. Write the throwaway consumer project
// ----------------------------------------------------------------------
section('writing consumer project');

writeFileSync(
  path.join(consumerDir, 'package.json'),
  JSON.stringify(
    { name: 'vscode-ext-kit-smoke-consumer', private: true, version: '0.0.0', type: 'module' },
    null,
    2
  ) + '\n'
);

// This is deliberately exactly the config the README's "Testing Your
// Extension" section recommends — `server.deps.inline` included. The whole
// point of this script is to prove that config works against the *published*
// package, not just against this repo's own src/ (report item 1).
writeFileSync(
  path.join(consumerDir, 'vitest.config.ts'),
  `import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    clearMocks: true,
    server: {
      deps: {
        // Required: the kit imports 'vscode' itself, so it must go through
        // Vite's transform for the module mock to reach it.
        inline: ['@kkdev92/vscode-ext-kit'],
      },
    },
  },
});
`
);

writeFileSync(
  path.join(consumerDir, 'tests', 'setup.ts'),
  `import { vi } from 'vitest';
import { createVSCodeMock } from '@kkdev92/vscode-ext-kit/testing';

vi.mock('vscode', () => createVSCodeMock(vi));
`
);

writeFileSync(
  path.join(consumerDir, 'tests', 'smoke.test.ts'),
  `import { describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  applyWorkspaceEdits,
  createLogger,
  defineConfigSchema,
  field,
  run,
  s,
} from '@kkdev92/vscode-ext-kit';

describe('root entry point', () => {
  it('resolves and exposes the documented exports', () => {
    expect(typeof createLogger).toBe('function');
    expect(typeof run).toBe('function');
    expect(typeof defineConfigSchema).toBe('function');
    expect(typeof field).toBe('function');
    expect(typeof s.string).toBe('function');
  });

  it('reaches the kit-internal "import * as vscode from \\'vscode\\'" via vi.mock (regression: report item 1)', () => {
    const logger = createLogger('SmokeConsumer');
    expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('SmokeConsumer', { log: true });
    logger.dispose();
  });

  it('validates a config schema end-to-end through the mocked workspace', () => {
    const config = defineConfigSchema('smokeConsumer', {
      logLevel: field(s.enum('trace', 'debug', 'info', 'warn', 'error', 'silent'), 'info'),
    });
    expect(config.get('logLevel')).toBe('info');
  });

  it('runs an operation through run()\\'s cancellation-aware error handling', async () => {
    const logger = createLogger('SmokeConsumerRun');
    const value = await run(logger, 'smoke op', () => 42);
    expect(value).toBe(42);
    logger.dispose();
  });

  // Regression: report item 3. workspace.applyEdit was missing from the
  // published mock at the time this script was written; another change in
  // flight in this repo adds it. This assertion is intentionally NOT
  // skipped even if that change hasn't landed yet in the package under
  // test — a failure here should read as "workspace.applyEdit still missing
  // from the mock", not be silently hidden.
  it('applies workspace edits through workspace.applyEdit (regression: report item 3)', async () => {
    const uri = vscode.Uri.file('/mock/smoke.ts');
    const applied = await applyWorkspaceEdits([
      { uri, range: new vscode.Range(0, 0, 0, 0), newText: 'x' },
    ]);
    expect(applied).toBe(true);
    expect(vscode.workspace.applyEdit).toHaveBeenCalled();
  });
});

describe('subpath exports resolve from the installed package', () => {
  it('./testing', async () => {
    const testing = await import('@kkdev92/vscode-ext-kit/testing');
    const logger = testing.createMockLogger(vi);
    const context = testing.createMockExtensionContext(vi);
    expect(typeof logger.info).toBe('function');
    expect(context.subscriptions).toEqual([]);
  });

  it('./timing (no vscode import)', async () => {
    const timing = await import('@kkdev92/vscode-ext-kit/timing');
    const debounced = timing.debounce(() => {}, 10);
    expect(typeof debounced).toBe('function');
    debounced.cancel();
  });

  it('./retry (no vscode import)', async () => {
    const { retry } = await import('@kkdev92/vscode-ext-kit/retry');
    const value = await retry(async () => 'ok', { maxAttempts: 1 });
    expect(value).toBe('ok');
  });

  it('./format (no vscode import)', async () => {
    const { pluralFor, formatNumberFor } = await import('@kkdev92/vscode-ext-kit/format');
    expect(pluralFor('en', 2, { one: '1 file', other: '{count} files' })).toBe('2 files');
    expect(formatNumberFor('en', 1234)).toBe('1,234');
  });

  it('./webview-client (no vscode import)', async () => {
    const { createWebviewRpcClient } = await import('@kkdev92/vscode-ext-kit/webview-client');
    const posted: unknown[] = [];
    const rpc = createWebviewRpcClient({
      vscodeApi: { postMessage: (message) => void posted.push(message) },
      target: {
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
      },
    });
    rpc.emit('ping', 1);
    expect(posted).toEqual([{ k: 'ev', event: 'ping', payload: 1 }]);
    rpc.dispose();
  });

  it('./package.json (needed to read the installed version at build time)', async () => {
    const pkg = await import('@kkdev92/vscode-ext-kit/package.json', {
      with: { type: 'json' },
    });
    expect(typeof pkg.default.version).toBe('string');
  });

  it('./testing/vitest-config carries both halves of the required setup', async () => {
    const { vscodeExtKitVitestConfig } = await import(
      '@kkdev92/vscode-ext-kit/testing/vitest-config'
    );
    expect(vscodeExtKitVitestConfig.resolve.alias.vscode).toBe(
      '@kkdev92/vscode-ext-kit/testing/vitest'
    );
    expect(vscodeExtKitVitestConfig.test.server.deps.inline).toContain(
      '@kkdev92/vscode-ext-kit'
    );
  });

  it('./testing/vitest exposes the named exports "import * as vscode" needs', async () => {
    const aliasModule = await import('@kkdev92/vscode-ext-kit/testing/vitest');
    // A default export alone would leave every window/commands call undefined
    // in the code under test, so assert on the named surface specifically.
    expect(aliasModule.window).toBeTruthy();
    expect(aliasModule.commands).toBeTruthy();
    expect(aliasModule.workspace).toBeTruthy();
    expect(aliasModule.languages).toBeTruthy();
    expect(aliasModule.env).toBeTruthy();
    expect(aliasModule.l10n).toBeTruthy();
    expect(typeof aliasModule.version).toBe('string');
    expect(aliasModule.ColorThemeKind.Dark).toBe(2);
    expect(typeof aliasModule.window.createOutputChannel).toBe('function');
  });
});
`
);

// A minimal tsconfig so "does this typecheck for a consumer" is exercised
// too — moduleResolution NodeNext is what actually walks package.json's
// "exports" map (root + every subpath asserted above), which a looser
// resolution mode could paper over. Kept intentionally small: this one test
// file is both the runtime (vitest) and compile-time (tsc) fixture.
writeFileSync(
  path.join(consumerDir, 'tsconfig.json'),
  JSON.stringify(
    {
      compilerOptions: {
        target: 'ES2023',
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        strict: true,
        skipLibCheck: true,
        types: ['vscode'],
        noEmit: true,
      },
      include: ['tests/**/*.ts', 'vitest.config.ts'],
    },
    null,
    2
  ) + '\n'
);

// ----------------------------------------------------------------------
// 4. Install the packed tarball (only the tarball — vitest/typescript/
//    @types/vscode resolve from this repo's node_modules; see module
//    comment above).
// ----------------------------------------------------------------------
section('npm install (tarball only)');
const installResult = sh(
  'npm',
  ['install', tarballPath, '--no-save', '--ignore-scripts', '--no-audit', '--no-fund'],
  { cwd: consumerDir }
);
if (installResult.status !== 0) {
  dump(installResult);
  fail(`npm install exited with code ${installResult.status}`);
}
log('installed @kkdev92/vscode-ext-kit from the tarball into the consumer project.');

// ----------------------------------------------------------------------
// 5. Typecheck the consumer project (best-effort but not ignored — see
//    module comment; this is a bonus check on top of the required items).
// ----------------------------------------------------------------------
section('tsc --noEmit (consumer)');
const tscBin = path.join(REPO_ROOT, 'node_modules', '.bin', process.platform === 'win32' ? 'tsc.cmd' : 'tsc');
const tscResult = sh(tscBin, [], { cwd: consumerDir });
dump(tscResult);
if (tscResult.status !== 0) {
  fail(`tsc --noEmit failed in the consumer project (exit code ${tscResult.status})`);
}
log('consumer project typechecks against the published .d.ts/.d.ts.map.');

// ----------------------------------------------------------------------
// 6. Run vitest in the consumer project
// ----------------------------------------------------------------------
section('vitest run (consumer)');
const vitestBin = path.join(
  REPO_ROOT,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'vitest.cmd' : 'vitest'
);
const vitestResult = sh(vitestBin, ['run'], { cwd: consumerDir });
dump(vitestResult);

const combinedOutput = `${vitestResult.stdout ?? ''}\n${vitestResult.stderr ?? ''}`;

if (vitestResult.status !== 0) {
  fail(`vitest run failed in the consumer project (exit code ${vitestResult.status})`);
}

// Regression check for report item 2: inlining the kit (required to fix
// item 1) must not spam sourcemap warnings now that "files" includes "src".
if (/points to missing source files/i.test(combinedOutput)) {
  fail(
    '"Sourcemap ... points to missing source files" appeared in vitest output ' +
      '(package.json "files" regressed — report item 2).'
  );
}
log('no "points to missing source files" warnings — sourcemaps resolve against the published src/.');

// ----------------------------------------------------------------------
// 7. Success — clean up
// ----------------------------------------------------------------------
section('done');
rmSync(runDir, { recursive: true, force: true });
try {
  rmSync(scratchRoot, { recursive: true, force: false });
} catch {
  // Not empty (a concurrent run, or a previous failed run left something
  // behind for inspection) — leave it alone.
}
log('All consumer smoke checks passed.');
