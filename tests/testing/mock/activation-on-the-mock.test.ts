import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createVSCodeMock } from '../../../src/testing/mock/vscode-mock.js';

/**
 * A whole extension, activated against the mock kit.
 *
 * The gap this fills was found by migrating a real extension: it loads its
 * built bundle with `vscode` replaced by this mock and calls `activate()`. That
 * failed on `vscode.UIKind.Web` being undefined — the framework reads
 * `env.uiKind` and `workspace.isTrusted` at activation for runtime preflight,
 * and the mock had neither.
 *
 * Testing the individual fields would not have caught it: what matters is that
 * an application built on `defineExtension` starts here at all, so that is what
 * this asserts.
 *
 * This is a wiring smoke test for the low-level module mock, not a substitute
 * for TestHost or an Extension Host. Extend it when composition-root activation
 * begins to require another `vscode` namespace member; detailed behavior of
 * that member belongs in a focused mock/adapter contract test.
 */
const mock = vi.hoisted(() => ({
  current: undefined as ReturnType<typeof createVSCodeMock> | undefined,
}));

vi.mock('vscode', () => {
  mock.current ??= createVSCodeMock(vi);
  return mock.current;
});

const { defineCommandContract } = await import('../../../src/foundation/commands/contract.js');
const { defineModule } = await import('../../../src/foundation/modules/definition.js');
const { defineSettings, setting } = await import('../../../src/foundation/settings/definition.js');
const { defineStorage } = await import('../../../src/capabilities/storage/definition.js');
const { defineExtension } = await import('../../../src/vscode/foundation/extension.js');
const { createMockExtensionContext } = await import('../../../src/testing/mock/mock-factories.js');

const Ping = defineCommandContract<readonly [], string>({ id: 'sample.ping' });

const Options = defineSettings({
  section: 'sample',
  values: { limit: setting.number({ default: 5 }) },
});

const Recent = defineStorage<readonly string[]>({
  key: 'sample.recent',
  scope: 'global',
  defaultValue: [],
});

describe('an application on the mock kit', () => {
  beforeEach(() => {
    mock.current = undefined;
  });

  it('activates, serves a command and stops', async () => {
    const started: string[] = [];
    const module = defineModule('sample', (builder): undefined => {
      builder.settings.add(Options);
      builder.storage.add(Recent);
      builder.commands.handle(Ping, () => 'pong');
      builder.hostedServices.add({
        id: 'sample.worker',
        start: () => {
          started.push('start');
        },
        stop: () => {
          started.push('stop');
        },
      });
      return undefined;
    });

    const app = defineExtension({ name: 'Sample', modules: [module] });
    const context = createMockExtensionContext(vi);

    await app.activate(context);
    try {
      expect(started).toEqual(['start']);
      await expect(app.commands.execute(Ping)).resolves.toBe('pong');
    } finally {
      await app.deactivate();
    }
    expect(started).toEqual(['start', 'stop']);
  });

  it('lets an extension look itself up', async () => {
    const vscode = (await import('vscode')) as unknown as ReturnType<typeof createVSCodeMock>;

    // Empty by default: the mock does not know what is installed.
    expect(vscode.extensions.getExtension('sample.extension')).toBeUndefined();

    vscode.extensions.all.push({
      id: 'sample.extension',
      packageJSON: { version: '1.2.3' },
    } as unknown as (typeof vscode.extensions.all)[number]);

    const found = vscode.extensions.getExtension('sample.extension');
    expect((found?.packageJSON as { version?: string } | undefined)?.version).toBe('1.2.3');
  });

  it('reports the host environment runtime preflight checks', async () => {
    const seen: unknown[] = [];
    const module = defineModule('sample', (builder): undefined => {
      builder.commands.handle(Ping, () => 'pong');
      return undefined;
    });

    const app = defineExtension({
      name: 'Sample',
      modules: [module],
      onDiagnostic: (diagnostic) => seen.push(diagnostic),
    });

    // A desktop, trusted, folderless host — the default an extension developer
    // gets without configuring anything.
    await app.activate(createMockExtensionContext(vi));
    await app.deactivate();

    // Preflight ran without an error diagnostic, which it cannot do if reading
    // the environment throws.
    expect(
      seen.filter((entry) => String((entry as { event?: string }).event).includes('preflight'))
    ).toEqual([]);
  });
});
