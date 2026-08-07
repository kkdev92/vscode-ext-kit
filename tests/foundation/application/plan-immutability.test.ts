/**
 * Definition-time ownership tests for ModuleDefinition and ApplicationPlan
 * snapshots. No Host is started: this suite changes when compiler-owned data or
 * synthetic framework tokens change, and protects preflight from caller
 * mutation after compilation.
 */
import { describe, expect, it } from 'vitest';
import { Notifications } from '../../../src/capabilities/ui/notifications.js';
import { QuickInput } from '../../../src/capabilities/ui/quick-input-service.js';
import { Localization } from '../../../src/capabilities/l10n/localization.js';
import { Editors } from '../../../src/capabilities/editor/editor.js';
import { Webviews } from '../../../src/capabilities/views/webview/host.js';
import { Secrets } from '../../../src/capabilities/secrets/secrets.js';
import { StatusBar } from '../../../src/capabilities/ui/status-bar-service.js';

import { compileApplication } from '../../../src/foundation/application/plan.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import { serviceToken } from '../../../src/foundation/services/token.js';
import { defineSettings, setting } from '../../../src/foundation/settings/definition.js';
import { defineStorage } from '../../../src/capabilities/storage/definition.js';
import { defineStatusBarItem } from '../../../src/capabilities/ui/definition.js';

/**
 * The plan's immutability is what makes preflight's guarantees hold: an id or a
 * dependency map that can change after the checks ran means the checks proved
 * nothing. `Object.freeze` on the plan alone is shallow, so these pin the whole
 * depth the framework owns. Opaque callbacks and application values are outside
 * this suite because the framework deliberately preserves their identity.
 */
describe('ApplicationPlan immutability', () => {
  it('does not see a later edit to the descriptor the caller passed in', () => {
    const descriptor = { id: 'sample.original', title: 'Original' };
    const contract = defineCommandContract(descriptor);
    const module = defineModule('m', (builder): undefined => {
      builder.commands.handle(contract, () => undefined);
      return undefined;
    });
    const plan = compileApplication({ name: 'app', modules: [module] });

    descriptor.id = 'sample.hijacked';
    descriptor.title = 'Hijacked';

    expect(plan.commands[0]?.contract.descriptor.id).toBe('sample.original');
    expect(plan.commands[0]?.contract.descriptor.title).toBe('Original');
  });

  it('freezes registration entries, their dependency maps and the modules', () => {
    const Repo = serviceToken<{ ping(): void }>('demo.repo');
    const Contract = defineCommandContract<readonly [], undefined>({ id: 'sample.run' });
    const inject = { repo: Repo };
    const module = defineModule('m', (builder): undefined => {
      builder.services.singleton(Repo, () => ({ ping: () => undefined }));
      builder.commands.handle(Contract, { inject, execute: () => undefined });
      return undefined;
    });
    const plan = compileApplication({ name: 'app', modules: [module] });

    const command = plan.commands[0];
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.modules[0])).toBe(true);
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command?.dependencies)).toBe(true);
    expect(Object.isFrozen(plan.services[0])).toBe(true);
    expect(Object.isFrozen(Repo)).toBe(true);

    // The caller's own inject object is snapshotted, not adopted.
    const injectAsRecord = inject as Record<string, unknown>;
    injectAsRecord['other'] = serviceToken('demo.other');
    expect(Object.keys(command?.dependencies ?? {})).toEqual(['repo']);
  });

  it('freezes the definitions that carry preflight-relevant identity', () => {
    const Prefs = defineStorage({ key: 'prefs', defaultValue: { theme: 'dark' }, version: 3 });
    const Status = defineStatusBarItem({ id: 'sample.status', text: 'Ready' });
    const Settings = defineSettings({
      section: 'sample.demo',
      values: { enabled: setting.boolean({ default: true }) },
    });

    for (const definition of [Prefs, Status, Settings]) {
      expect(Object.isFrozen(definition)).toBe(true);
    }
    expect(Object.isFrozen(Settings.values)).toBe(true);

    // Mutating a frozen definition silently fails in sloppy mode and throws in
    // strict mode; either way the value the plan compiled against is intact.
    expect(() => {
      (Prefs as unknown as { version: number }).version = 99;
    }).toThrow(TypeError);
    expect(Prefs.version).toBe(3);
  });

  it('snapshots watcher pattern lists so the watched set cannot change', () => {
    const patterns = ['**/*.ts'];
    const module = defineModule('m', (builder): undefined => {
      builder.fileWatchers.add({ id: 'w', patterns, handle: () => undefined });
      return undefined;
    });
    const plan = compileApplication({ name: 'app', modules: [module] });

    patterns.push('**/*.secret');

    expect(plan.fileWatchers[0]?.patterns).toEqual(['**/*.ts']);
    expect(Object.isFrozen(plan.fileWatchers[0]?.patterns)).toBe(true);
  });

  it('snapshots tree view option bags', () => {
    const options = { showCollapseAll: true };
    const module = defineModule('m', (builder): undefined => {
      builder.treeViews.add({ id: 'v', resolveProvider: () => ({}), options });
      return undefined;
    });
    const plan = compileApplication({ name: 'app', modules: [module] });

    options.showCollapseAll = false;

    expect(plan.treeViews[0]?.options.showCollapseAll).toBe(true);
  });
});

describe('framework services satisfy preflight', () => {
  // Every service the application synthesises has to be in preflight's
  // registered set. A missing entry rejects an otherwise valid Application at
  // import time and stays invisible until that particular token is injected,
  // so every synthetic service belongs in one table-driven gate.
  const FRAMEWORK_TOKENS = [
    ['Notifications', Notifications],
    ['QuickInput', QuickInput],
    ['Localization', Localization],
    ['Editors', Editors],
    ['Webviews', Webviews],
    ['Secrets', Secrets],
    ['StatusBar', StatusBar],
  ] as const;

  for (const [name, token] of FRAMEWORK_TOKENS) {
    it(`accepts a handler injecting ${name}`, () => {
      const module = defineModule('sample', (builder): undefined => {
        builder.commands.handle(defineCommandContract({ id: 'sample.run' }), {
          inject: { injected: token },
          execute: () => undefined,
        });
        return undefined;
      });

      expect(() => compileApplication({ name: 'sample', modules: [module] })).not.toThrow();
    });
  }
});
