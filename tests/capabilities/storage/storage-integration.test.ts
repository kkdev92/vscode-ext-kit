/**
 * In-process Test Host integration suite for declared storage, secrets, and a
 * settings subscription. It protects plan preflight, DI token wiring,
 * activation-time accessor creation, sync-key aggregation, and module-owned
 * teardown. Unit storage failures belong in `storage.test.ts`; failures here
 * usually indicate application/module integration.
 */
import { describe, expect, it } from 'vitest';

import { compileApplication } from '../../../src/foundation/application/plan.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import { s } from '../../../src/capabilities/core/schema.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import { defineSecret, defineStorage } from '../../../src/capabilities/storage/definition.js';
import { createTestHost } from '../../../src/testing/test-host.js';

interface Prefs {
  readonly theme: string;
}

const Preferences = defineStorage<Prefs>({
  key: 'preferences',
  scope: 'global',
  version: 2,
  defaultValue: { theme: 'dark' },
  migrations: {
    // v1 stored a bare string theme.
    1: (old) => ({ theme: String(old) }),
  },
  syncable: true,
});

const RecentFiles = defineStorage<readonly string[]>({
  key: 'recentFiles',
  scope: 'workspace',
  defaultValue: [],
  syncable: false,
});

const ApiCredentials = defineSecret({
  key: 'api.credentials',
  schema: s.object({ token: s.string() }),
});

const ReadPrefs = defineCommandContract<readonly [], Prefs>({ id: 'sample.readPrefs' });
const ReadToken = defineCommandContract<readonly [], string | undefined>({
  id: 'sample.readToken',
});

const storageModule = defineModule('storage-demo', (module): undefined => {
  module.storage.add(Preferences);
  module.storage.add(RecentFiles);
  module.secrets.add(ApiCredentials);

  module.commands.handle(ReadPrefs, {
    inject: { preferences: Preferences.token },
    execute: (_context, _args, { preferences }) => preferences.get(),
  });

  module.commands.handle(ReadToken, {
    inject: { credentials: ApiCredentials.token },
    execute: async (_context, _args, { credentials }) => (await credentials.read())?.token,
  });

  return undefined;
});

const plan = (): ReturnType<typeof compileApplication> =>
  compileApplication({ name: 'sample', modules: [storageModule] });

describe('storage through the Test Host', () => {
  it('injects a typed storage accessor and reads what is already on disk', async () => {
    const host = createTestHost({ plan: plan() });
    // Existing persisted state can carry an earlier schema version. Activation
    // must inject an accessor that migrates it without orphaning the value.
    await host.storage.global.update('preferences', { v: 1, value: 'light' });

    await host.start();

    await expect(host.application.commands.execute(ReadPrefs)).resolves.toEqual({
      theme: 'light',
    });
    await host.stop();
  });

  it('aggregates every syncable key into one setKeysForSync call', async () => {
    const host = createTestHost({ plan: plan() });

    await host.start();

    // Only the syncable global key; the workspace one must not appear.
    expect(host.storage._syncedKeys()).toEqual(['preferences']);
    await host.stop();
  });

  it('injects a typed secret accessor', async () => {
    const host = createTestHost({ plan: plan() });
    await host.secrets.store('api.credentials', JSON.stringify({ token: 'sk-99' }));

    await host.start();

    await expect(host.application.commands.execute(ReadToken)).resolves.toBe('sk-99');
    await host.stop();
  });

  it('rejects a duplicate storage key at preflight', () => {
    const duplicate = defineModule('dup', (module): undefined => {
      module.storage.add(defineStorage({ key: 'preferences', scope: 'global', defaultValue: 1 }));
      module.storage.add(defineStorage({ key: 'preferences', scope: 'global', defaultValue: 2 }));
      return undefined;
    });

    expect(() => compileApplication({ name: 'sample', modules: [duplicate] })).toThrow(
      /registered more than once/
    );
  });

  it('allows the same key in different scopes', () => {
    const distinct = defineModule('distinct', (module): undefined => {
      module.storage.add(defineStorage({ key: 'shared', scope: 'global', defaultValue: 1 }));
      module.storage.add(defineStorage({ key: 'shared', scope: 'workspace', defaultValue: 2 }));
      return undefined;
    });

    expect(() => compileApplication({ name: 'sample', modules: [distinct] })).not.toThrow();
  });

  it('rejects syncable on workspace scope at preflight', () => {
    const invalid = defineModule('invalid', (module): undefined => {
      module.storage.add(
        defineStorage({ key: 'k', scope: 'workspace', defaultValue: 1, syncable: true })
      );
      return undefined;
    });

    expect(() => compileApplication({ name: 'sample', modules: [invalid] })).toThrow(
      /never synced/
    );
  });

  it('rejects a duplicate secret key at preflight', () => {
    const duplicate = defineModule('dup', (module): undefined => {
      module.secrets.add(defineSecret({ key: 'same' }));
      module.secrets.add(defineSecret({ key: 'same' }));
      return undefined;
    });

    expect(() => compileApplication({ name: 'sample', modules: [duplicate] })).toThrow(
      /registered more than once/
    );
  });
});

describe('settings.watch', () => {
  it('invokes the listener with the new effective value when its setting changes', async () => {
    const { defineSettings, setting } =
      await import('../../../src/foundation/settings/definition.js');
    const Settings = defineSettings({
      section: 'sample.watch',
      values: { enabled: setting.boolean({ default: true }) },
    });

    const seen: boolean[] = [];
    const module = defineModule('watcher', (builder): undefined => {
      builder.settings.add(Settings);
      // A long-lived watch belongs in a module-owned scope. An operation's
      // resources are disposed when the operation settles, so registering it
      // from a command handler would end the subscription with the command.
      builder.raw.register({
        id: 'watcher.subscription',
        inject: { settings: Settings.token },
        bind: (context, { settings }): undefined => {
          context.registrations.own(
            settings.watch('enabled', undefined, (value) => {
              seen.push(value);
            })
          );
          return undefined;
        },
      });
      return undefined;
    });

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();

    host.settings._set('sample.watch', 'enabled', 'globalValue', false);
    host.settings._fireChange(['sample.watch']);
    expect(seen).toEqual([false]);

    // The module scope owns the subscription, so stop detaches it.
    await host.stop();
    host.settings._set('sample.watch', 'enabled', 'globalValue', true);
    host.settings._fireChange(['sample.watch']);
    expect(seen).toEqual([false]);
  });
});
