/**
 * Runtime-preflight tests at two boundaries: pure plan/environment comparison,
 * then Test Host activation proving errors occur before Module binding. The
 * environment is fake; Extension Host detection and conversion belong in the
 * adapter suites.
 */
import { describe, expect, it } from 'vitest';

import { compileApplication } from '../../../src/foundation/application/plan.js';
import { runtimePreflight } from '../../../src/foundation/application/runtime-preflight.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import { PreflightError } from '../../../src/foundation/internal/errors.js';
import { ModuleCompatibility } from '../../../src/foundation/modules/compatibility.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import type { DefineModuleOptions } from '../../../src/foundation/modules/definition.js';
import { defineStorage } from '../../../src/capabilities/storage/definition.js';
import type { HostEnvironment } from '../../../src/foundation/platform/ports.js';
import { createFakeEnvironment } from '../../../src/testing/fakes/fake-environment.js';
import { createTestHost } from '../../../src/testing/test-host.js';

const Probe = defineCommandContract({ id: 'sample.probe' });

const moduleWith = (options: DefineModuleOptions): ReturnType<typeof defineModule> =>
  defineModule(
    'projects',
    (builder): undefined => {
      builder.commands.handle(Probe, () => undefined);
      return undefined;
    },
    options
  );

const planWith = (options: DefineModuleOptions): ReturnType<typeof compileApplication> =>
  compileApplication({ name: 'sample', modules: [moduleWith(options)] });

const environment = (patch: Partial<HostEnvironment> = {}): HostEnvironment =>
  createFakeEnvironment(patch).read();

describe('defineModule metadata', () => {
  it('defaults compatibility to unspecified and requires to empty', () => {
    const module = moduleWith({});

    expect(module.compatibility).toBe('unspecified');
    expect(module.requires).toEqual({});
    expect(module.source).toBeUndefined();
  });

  it('records declared compatibility, requirements and source', () => {
    const module = moduleWith({
      compatibility: ModuleCompatibility.WebSafe,
      requires: { workspace: true },
      source: 'src/projects/module.ts',
    });

    expect(module.compatibility).toBe('web-safe');
    expect(module.requires).toEqual({ workspace: true });
    expect(module.source).toBe('src/projects/module.ts');
  });
});

describe('runtimePreflight', () => {
  it('passes an ordinary desktop workspace', () => {
    expect(runtimePreflight(planWith({}), environment())).toEqual([]);
  });

  describe('hard requirements produce errors', () => {
    it('rejects a workspace requirement with no folder open', () => {
      const issues = runtimePreflight(
        planWith({ requires: { workspace: true } }),
        environment({ workspaceFolderCount: 0 })
      );

      expect(issues).toHaveLength(1);
      expect(issues[0]?.severity).toBe('error');
      expect(issues[0]?.code).toBe('WORKSPACE_REQUIRED');
      expect(issues[0]?.moduleId).toBe('projects');
    });

    it('rejects a trust requirement in an untrusted workspace', () => {
      const issues = runtimePreflight(
        planWith({ requires: { trust: true } }),
        environment({ isTrusted: false })
      );

      expect(issues[0]?.code).toBe('TRUST_REQUIRED');
      expect(issues[0]?.severity).toBe('error');
    });

    it('rejects a local-filesystem requirement in a virtual workspace', () => {
      const issues = runtimePreflight(
        planWith({ requires: { localFileSystem: true } }),
        environment({ hasVirtualWorkspace: true })
      );

      expect(issues[0]?.code).toBe('LOCAL_FILESYSTEM_REQUIRED');
    });

    it('rejects a Node-only module in the web host', () => {
      const issues = runtimePreflight(
        planWith({ compatibility: ModuleCompatibility.WorkspaceNode }),
        environment({ uiKind: 'web' })
      );

      expect(issues[0]?.code).toBe('NODE_MODULE_IN_WEB_HOST');
      expect(issues[0]?.severity).toBe('error');
    });

    it('accepts satisfied requirements', () => {
      expect(
        runtimePreflight(
          planWith({ requires: { workspace: true, trust: true, localFileSystem: true } }),
          environment({ workspaceFolderCount: 2, isTrusted: true, hasVirtualWorkspace: false })
        )
      ).toEqual([]);
    });
  });

  describe('self-declared metadata only warns', () => {
    it('warns for an undeclared module in the web host', () => {
      // Self-declared metadata cannot prove web safety, so this must not be able
      // to refuse activation on its own.
      const issues = runtimePreflight(planWith({}), environment({ uiKind: 'web' }));

      expect(issues).toHaveLength(1);
      expect(issues[0]?.severity).toBe('warning');
      expect(issues[0]?.code).toBe('COMPATIBILITY_UNSPECIFIED_IN_WEB_HOST');
    });

    it('does not warn for a module declared web-safe', () => {
      expect(
        runtimePreflight(
          planWith({ compatibility: ModuleCompatibility.WebSafe }),
          environment({ uiKind: 'web' })
        )
      ).toEqual([]);
    });

    it('warns for a ui-preferred module on a remote host', () => {
      const issues = runtimePreflight(
        planWith({ compatibility: ModuleCompatibility.UiPreferred }),
        environment({ remoteName: 'wsl' })
      );

      expect(issues[0]?.severity).toBe('warning');
      expect(issues[0]?.code).toBe('UI_PREFERRED_ON_REMOTE');
    });
  });

  it('reports every finding rather than stopping at the first', () => {
    const issues = runtimePreflight(
      planWith({ requires: { workspace: true, trust: true } }),
      environment({ workspaceFolderCount: 0, isTrusted: false })
    );

    expect(issues.map((issue) => issue.code)).toEqual(['WORKSPACE_REQUIRED', 'TRUST_REQUIRED']);
  });
});

describe('runtime preflight during activation', () => {
  it('fails activation before any module binds', async () => {
    const host = createTestHost({
      plan: planWith({ requires: { trust: true } }),
      environment: { isTrusted: false },
    });

    await expect(host.start()).rejects.toBeInstanceOf(PreflightError);

    // The point of running before binding: nothing was registered.
    expect(host.commands.registeredIds).toEqual([]);
    expect(host.leaks().registrations).toBe(0);
    expect(host.events).toContain('application.preflight.error');
  });

  it('runs before the platform state a failed activation could not undo', async () => {
    const Preference = defineStorage<string>({
      key: 'theme',
      syncable: true,
      defaultValue: 'dark',
    });
    const syncing = defineModule(
      'syncing',
      (builder): undefined => {
        builder.storage.add(Preference);
        return undefined;
      },
      { requires: { trust: true } }
    );

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [syncing] }),
      environment: { isTrusted: false },
    });

    await expect(host.start()).rejects.toBeInstanceOf(PreflightError);

    // `setKeysForSync` writes to persistent storage and survives the failed
    // activation, so declaring a key here would leave the platform holding a
    // claim that nothing in this session backs. Preflight running first is what
    // keeps "nothing outside this process changes until every check has run"
    // true rather than merely intended.
    expect(host.storage._syncedKeys()).toEqual([]);
  });

  it('lets a warning through and records it', async () => {
    const host = createTestHost({
      plan: planWith({}),
      environment: { uiKind: 'web' },
    });

    await host.start();

    expect(host.commands.registeredIds).toEqual(['sample.probe']);
    expect(host.events).toContain('application.preflight.warning');
    expect(host.logs.at('warn')).toHaveLength(1);

    await host.stop();
  });

  it('activates cleanly when the environment satisfies everything', async () => {
    const host = createTestHost({
      plan: planWith({
        compatibility: ModuleCompatibility.WebSafe,
        requires: { workspace: true, trust: true },
      }),
    });

    await host.start();

    expect(host.events).not.toContain('application.preflight.error');
    expect(host.events).not.toContain('application.preflight.warning');

    await host.stop();
  });
});
