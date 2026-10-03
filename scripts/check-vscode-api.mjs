// Reports whether the stable VS Code extension API has moved past this
// package's floor.
//
// The floor (`engines.vscode`) rises when this package starts using an API that
// older versions lack, so the question to ask when VS Code ships is whether the
// stable `vscode.d.ts` gained or changed a declaration at all. A new
// `@types/vscode` release does not answer it: those are often published with
// the declarations unchanged. This compares the declarations at the floor's
// release tag with those of the newest stable release (or of a version given on
// the command line), ignoring comments, and prints the Electron and Node each of
// the two runs extensions on.
//
//   npm run check:vscode-api                      floor vs the newest stable release
//   npm run check:vscode-api -- 1.141.0           floor vs a given release
//   npm run check:vscode-api -- 1.107.0 1.108.0   two given releases
//
// Exit codes: 0 when the declarations are unchanged, 1 when they differ (the
// difference is printed), 2 when something could not be fetched or parsed. The
// last is kept apart from 0 so that an outage never reads as "nothing changed".

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';

import ts from 'typescript';

const RAW = 'https://raw.githubusercontent.com/microsoft/vscode';
const STABLE_RELEASES = 'https://update.code.visualstudio.com/api/releases/stable';
const ELECTRON_RELEASES = 'https://artifacts.electronjs.org/headers/dist/index.json';

function fail(message) {
  process.stderr.write(`check-vscode-api: ${message}\n`);
  process.exit(2);
}

async function fetchText(url) {
  let response;
  try {
    response = await fetch(url);
  } catch (error) {
    fail(`${url}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) fail(`${url}: HTTP ${response.status}`);
  const text = await response.text();
  if (text.length === 0) fail(`${url}: empty response`);
  return text;
}

/** The declarations with every comment removed, printed the same way for both sides. */
function declarations(source, version) {
  const file = ts.createSourceFile(
    `vscode-${version}.d.ts`,
    source,
    ts.ScriptTarget.Latest,
    false,
    ts.ScriptKind.TS
  );
  const errors = file.parseDiagnostics ?? [];
  if (errors.length > 0) {
    fail(`vscode.d.ts at ${version} does not parse (${errors.length} errors)`);
  }
  return ts.createPrinter({ removeComments: true }).printFile(file);
}

async function runtimeOf(version, electronReleases) {
  const target = (npmrc) => /^target="([^"]+)"/m.exec(npmrc)?.[1];
  const electron = target(await fetchText(`${RAW}/${version}/.npmrc`));
  const remoteNode = target(await fetchText(`${RAW}/${version}/remote/.npmrc`));
  if (electron === undefined || remoteNode === undefined) {
    fail(`no target in the .npmrc files at ${version}`);
  }
  const release = electronReleases.find((entry) => entry.version === electron);
  return `Electron ${electron} (Node ${release?.node ?? 'unknown'}), remote Node ${remoteNode}`;
}

const args = process.argv.slice(2);
if (args.length > 2) fail('usage: check-vscode-api.mjs [[floor] target]');
let floor = args.length === 2 ? args[0] : undefined;
if (floor === undefined) {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  floor = /(\d+\.\d+\.\d+)/.exec(manifest.engines?.vscode ?? '')?.[1];
  if (floor === undefined) fail('package.json has no engines.vscode version');
}

let target = args.at(-1);
if (target === undefined) {
  const releases = JSON.parse(await fetchText(STABLE_RELEASES));
  if (!Array.isArray(releases) || typeof releases[0] !== 'string') {
    fail('the stable release list is empty');
  }
  target = releases[0];
}

const electronReleases = JSON.parse(await fetchText(ELECTRON_RELEASES));
if (!Array.isArray(electronReleases) || electronReleases.length === 0) {
  fail('the Electron release list is empty');
}

const [floorSource, targetSource] = await Promise.all(
  [floor, target].map((version) => fetchText(`${RAW}/${version}/src/vscode-dts/vscode.d.ts`))
);

process.stdout.write(`floor   ${floor.padEnd(9)} ${await runtimeOf(floor, electronReleases)}\n`);
process.stdout.write(`target  ${target.padEnd(9)} ${await runtimeOf(target, electronReleases)}\n`);

if (floorSource === targetSource) {
  process.stdout.write('vscode.d.ts is byte-for-byte the same: the stable API has not moved.\n');
  process.exit(0);
}

const before = declarations(floorSource, floor);
const after = declarations(targetSource, target);
if (before === after) {
  process.stdout.write(
    'vscode.d.ts differs only in comments: no declaration was added, removed or changed.\n'
  );
  process.exit(0);
}

const scratch = mkdtempSync(join(tmpdir(), 'check-vscode-api-'));
try {
  writeFileSync(join(scratch, `${floor}.d.ts`), before);
  writeFileSync(join(scratch, `${target}.d.ts`), after);
  const diff = spawnSync(
    'git',
    ['diff', '--no-index', '--no-color', '-U1', `${floor}.d.ts`, `${target}.d.ts`],
    { cwd: scratch, encoding: 'utf8' }
  );
  process.stdout.write(`The stable API changed between ${floor} and ${target}:\n\n`);
  process.stdout.write(diff.stdout || '(git could not print the difference)\n');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
process.exit(1);
