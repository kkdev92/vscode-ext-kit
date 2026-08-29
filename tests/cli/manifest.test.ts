/**
 * `vscode-ext-kit manifest`, run as a consumer runs it: a child process, an
 * entry module, a package.json, and whatever comes out. `--apply` is exercised
 * against a copy in a temporary directory, so the fixture stays as committed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

declare const process: { readonly execPath: string };

const cli = resolve('bin', 'vscode-ext-kit.mjs');
const fixture = (name: string): string => resolve('tests', 'cli', 'fixtures', name);
const kit = resolve('dist', 'index.js');
const kitRoot = resolve('.');
const built = existsSync(kit);

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface Mismatch {
  readonly kind: string;
  readonly direction: string;
  readonly id: string;
  readonly paste?: string;
}

function run(...args: readonly string[]): Run {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (error) {
    const failed = error as { status?: number; stdout?: string; stderr?: string };
    return { code: failed.status ?? -1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? '' };
  }
}

/** The manifest command against a fixture manifest, with the kit resolved from this checkout. */
const manifest = (manifestFile: string, ...extra: readonly string[]): Run =>
  run(
    'manifest',
    fixture('manifest-plan.mjs'),
    '--manifest',
    manifestFile,
    '--kit',
    kitRoot,
    ...extra
  );

describe.skipIf(!built)('vscode-ext-kit manifest', () => {
  const scratch: string[] = [];
  afterEach(() => {
    for (const dir of scratch.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('reports every disagreement at once and exits 1', () => {
    const result = manifest(fixture('manifest-drifted.json'));

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('disagrees with the plan in 6 place(s)');
    expect(result.stdout).toContain(
      'command "sample.refresh" is declared in src but missing from contributes.commands'
    );
    expect(result.stdout).toContain('"command": "sample.refresh"');
    expect(result.stdout).toContain('command "sample.clear" is in contributes.commands');
    expect(result.stdout).toContain(
      'setting "sample.limit" defaults to 5 in the manifest and 10 in src'
    );
    expect(result.stdout).toContain('setting "sample.mode" is declared in src but missing');
    expect(result.stdout).toContain('view "sample.projects" is registered in src but missing');
    expect(result.stdout).toContain(
      'view "sample.other" is contributed but nothing in src registers it'
    );
  });

  it('prints the disagreements as JSON with --format json', () => {
    const result = manifest(fixture('manifest-drifted.json'), '--format', 'json');

    expect(result.code).toBe(1);
    const mismatches = JSON.parse(result.stdout) as Mismatch[];
    expect(mismatches.map((m) => `${m.kind}:${m.direction}:${m.id}`)).toEqual([
      'command:missing-in-manifest:sample.refresh',
      'command:missing-in-src:sample.clear',
      'setting:drift:sample.limit',
      'setting:missing-in-manifest:sample.mode',
      'view:missing-in-manifest:sample.projects',
      'view:missing-in-src:sample.other',
    ]);
  });

  it('exits 0 with a summary when the manifest agrees with the plan', () => {
    const result = manifest(fixture('manifest-agreeing.json'));

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe('manifest ok: 1 command(s), 2 setting(s), 1 view(s) agree');
  });

  it('adds missing commands and settings with --apply, and leaves the rest to a person', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vek-manifest-'));
    scratch.push(dir);
    const copy = join(dir, 'package.json');
    writeFileSync(copy, readFileSync(fixture('manifest-drifted.json'), 'utf8'), 'utf8');

    const result = manifest(copy, '--apply');

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('applied 2 change(s)');
    expect(result.stdout).toContain('4 disagreement(s) need a person');

    const written = readFileSync(copy, 'utf8');
    const updated = JSON.parse(written) as {
      contributes: {
        commands: { command: string; title: string }[];
        configuration: { properties: Record<string, { default: unknown; enum?: unknown[] }> };
        views: Record<string, { id: string }[]>;
      };
    };
    expect(updated.contributes.commands).toEqual([
      { command: 'sample.clear', title: 'Clear' },
      { command: 'sample.refresh', title: 'TODO' },
    ]);
    expect(updated.contributes.configuration.properties['sample.mode']).toMatchObject({
      type: 'string',
      default: 'fast',
      enum: ['fast', 'thorough'],
      description: '%TODO: describe this setting%',
    });
    // Drift is reported, not resolved: the manifest's default stays until a
    // person decides which side is right.
    expect(updated.contributes.configuration.properties['sample.limit']?.default).toBe(5);
    // A view needs a container, which the declaration does not carry.
    expect(updated.contributes.views['explorer']?.map((view) => view.id)).toEqual(['sample.other']);
    // The file keeps its two-space indentation and trailing newline.
    expect(written.startsWith('{\n  "name"')).toBe(true);
    expect(written.endsWith('}\n')).toBe(true);

    // A second run has nothing left to apply.
    const again = manifest(copy, '--apply');
    expect(again.stdout).toContain('applied 0 change(s)');
  });

  it('explains a missing manifest as a usage error', () => {
    const result = manifest(fixture('does-not-exist.json'));

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('does not exist');
    expect(result.stderr).toContain('--manifest');
  });
});
