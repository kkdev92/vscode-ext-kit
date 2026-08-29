/**
 * The command-line tool, run as a consumer runs it: a child process, an entry
 * module, and whatever comes out on stdout, stderr and the exit code.
 *
 * The fixtures import the built output, because the tool resolves `vscode` to
 * a stand-in and that only matters for code that actually imports `vscode` —
 * the real adapters in `dist/`. `npm run typecheck` builds it; without it this
 * suite skips rather than failing on a missing file, and says so.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// Tests execute on Node, but the repo's tsconfig deliberately omits Node types
// (the runtime core must not reach them). Declare the one global this file needs.
declare const process: { readonly execPath: string };

const cli = resolve('bin', 'vscode-ext-kit.mjs');
const fixture = (name: string): string => resolve('tests', 'cli', 'fixtures', name);
const kit = resolve('dist', 'index.js');
const built = existsSync(kit);

interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs the CLI and captures everything, whichever way it exits. */
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

describe.skipIf(!built)('vscode-ext-kit plan', () => {
  it('describes a plan as JSON, attributing each entry to its module', () => {
    const result = run('plan', fixture('sample-plan.mjs'), '--kit', kit);

    expect(result.code).toBe(0);
    const description = JSON.parse(result.stdout) as {
      name: string;
      services: { token: string; lifetime: string; moduleId: string }[];
      commands: { id: string; dependencies: Record<string, string>; moduleId: string }[];
      hostedServices: { id: string }[];
    };
    expect(description.name).toBe('sample');
    expect(description.services).toEqual([
      { token: 'sample.clock', lifetime: 'singleton', dependencies: {}, moduleId: 'projects' },
    ]);
    expect(description.commands[0]).toMatchObject({
      id: 'sample.refresh',
      dependencies: { clock: 'sample.clock', log: 'framework.log' },
      moduleId: 'projects',
    });
    expect(description.hostedServices.map((service) => service.id)).toEqual(['projects.index']);
  });

  it('draws the plan as a Mermaid graph with dependency edges', () => {
    const result = run('plan', fixture('sample-plan.mjs'), '--kit', kit, '--format', 'mermaid');

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('flowchart LR');
    expect(result.stdout).toContain('subgraph module_projects["projects"]');
    // The command depends on the module's own service and on a framework one;
    // both edges point at a node that exists.
    expect(result.stdout).toContain('cmd_sample_refresh -.-> svc_sample_clock');
    expect(result.stdout).toContain('cmd_sample_refresh -.-> svc_framework_log');
    expect(result.stdout).toContain('subgraph framework["framework services"]');
  });

  it('draws the same graph for Graphviz', () => {
    const result = run('plan', fixture('sample-plan.mjs'), '--kit', kit, '--format', 'dot');

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('digraph plan {');
    expect(result.stdout).toContain('subgraph "cluster_projects"');
    expect(result.stdout).toContain('"sample.refresh" -> "sample.clock" [style=dashed];');
  });

  it('exits 1 on --check when preflight rejects the plan, naming every problem', () => {
    const result = run('plan', fixture('broken-plan.mjs'), '--kit', kit, '--check');

    expect(result.code).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('COMMAND_HANDLER_CONFLICT sample.refresh (module second)');
    expect(result.stderr).toContain('only one handler per command id');
  });

  it('exits 0 on --check with a one-line summary when the plan is sound', () => {
    const result = run('plan', fixture('sample-plan.mjs'), '--kit', kit, '--check');

    expect(result.code).toBe(0);
    expect(result.stdout.trim()).toBe(
      'plan ok: 1 module(s), 1 service(s), 1 command(s), 1 hosted service(s)'
    );
  });

  it('explains what to export when the entry holds no plan', () => {
    const result = run('plan', fixture('../plan.test.ts'), '--kit', kit);

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('could not load the plan');
  });

  it('treats an unknown option as a usage error', () => {
    const result = run('plan', fixture('sample-plan.mjs'), '--colour');

    expect(result.code).toBe(2);
    expect(result.stderr).toContain('unknown option --colour');
    expect(result.stderr).toContain('usage: vscode-ext-kit plan');
  });
});
