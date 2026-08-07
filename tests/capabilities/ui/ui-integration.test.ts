/**
 * In-process Test Host integration suite for UI declarations and injectable UI
 * services. It protects activation-time creation, operation-driven updates,
 * dependency resolution, duplicate-id preflight, missing-capability errors, and
 * leak-free stop. Component rendering details remain in their focused unit
 * suites.
 */
import { describe, expect, it } from 'vitest';

import { createApplication } from '../../../src/foundation/application/application.js';
import { compileApplication } from '../../../src/foundation/application/plan.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import { serviceToken } from '../../../src/foundation/services/token.js';
import { createFakeCommands } from '../../../src/testing/fakes/fake-commands.js';
import { createFakeEnvironment } from '../../../src/testing/fakes/fake-environment.js';
import { createTestHost } from '../../../src/testing/test-host.js';
import { Notifications } from '../../../src/capabilities/ui/notifications.js';
import { QuickInput } from '../../../src/capabilities/ui/quick-input-service.js';
import { toPickSeparator } from '../../../src/capabilities/ui/quick-input.js';
import {
  defineLanguageStatusItem,
  defineStatusBarItem,
} from '../../../src/capabilities/ui/definition.js';

const SyncStatus = defineStatusBarItem({
  id: 'sample.syncStatus',
  text: '$(cloud) Idle',
  command: 'sample.sync',
  priority: 100,
});

const LintStatus = defineLanguageStatusItem({
  id: 'sample.lint',
  selector: { language: 'typescript' },
  name: 'Lint',
  text: '$(check) Clean',
});

describe('UI models through the Test Host', () => {
  it('creates declared items at activation and disposes them on stop', async () => {
    const module = defineModule('ui', (builder): undefined => {
      builder.statusBar.add(SyncStatus);
      builder.languageStatus.add(LintStatus);
      return undefined;
    });
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });

    await host.start();
    // Nothing injected them; they exist and render anyway.
    expect(host.statusBar.items[0]).toMatchObject({
      id: 'sample.syncStatus',
      text: '$(cloud) Idle',
      priority: 100,
      visible: true,
    });
    expect(host.languageStatus.items[0]).toMatchObject({ id: 'sample.lint', name: 'Lint' });

    await host.stop();
    expect(host.statusBar.items[0]?.disposed).toBe(true);
    expect(host.languageStatus.items[0]?.disposed).toBe(true);
    expect(host.leaks()).toEqual({ registrations: 0, resources: 0, commands: [] });
  });

  it('lets a command drive the status bar, progress UI and notifications', async () => {
    const Sync = defineCommandContract<readonly [], string>({ id: 'sample.sync' });
    const module = defineModule('ui', (builder): undefined => {
      builder.statusBar.add(SyncStatus);
      builder.commands.handle(Sync, {
        inject: { status: SyncStatus.token, notifier: Notifications },
        execute: async (context, _args, { status, notifier }) => {
          status.setBusy(true);
          try {
            const outcome = await context.progress.run(
              { title: 'Syncing', cancellable: true },
              (progress, signal) => {
                progress.report({ message: 'uploading' });
                return signal.aborted ? 'aborted' : 'done';
              }
            );
            status.update('$(check) Synced');
            await notifier.info('Sync finished');
            return outcome;
          } finally {
            status.setBusy(false);
          }
        },
      });
      return undefined;
    });

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();

    await expect(host.application.commands.execute(Sync)).resolves.toBe('done');

    expect(host.progress.runs[0]).toMatchObject({ title: 'Syncing', cancellable: true });
    expect(host.progress.runs[0]?.reports).toEqual([{ message: 'uploading' }]);
    expect(host.statusBar.items[0]?.text).toBe('$(check) Synced');
    expect(host.notifications.shown[0]).toMatchObject({
      severity: 'info',
      message: 'Sync finished',
    });
    await host.stop();
  });

  it('aborts the progress task signal when the user cancels', async () => {
    const Long = defineCommandContract<readonly [], boolean>({ id: 'sample.long' });
    const module = defineModule('ui', (builder): undefined => {
      builder.commands.handle(Long, (context) =>
        context.progress.run({ title: 'Long', cancellable: true }, async (_progress, signal) => {
          hostRef?.progress.runs.at(-1)?.cancel();
          await Promise.resolve();
          return signal.aborted;
        })
      );
      return undefined;
    });

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    const hostRef = host;
    await host.start();
    await expect(host.application.commands.execute(Long)).resolves.toBe(true);
    await host.stop();
  });

  it('lets a command drive a quick pick through the injected QuickInput surface', async () => {
    const Choose = defineCommandContract<readonly [], string | undefined>({ id: 'sample.choose' });
    const module = defineModule('ui', (builder): undefined => {
      builder.commands.handle(Choose, {
        inject: { ask: QuickInput },
        execute: async (context, _args, { ask }) => {
          const selected = await ask.one(
            [
              toPickSeparator('Targets'),
              { label: 'Alpha', value: 'a' },
              { label: 'Beta', value: 'b' },
            ] as const,
            { placeHolder: 'Pick a target', signal: context.signal }
          );
          return selected !== undefined && 'value' in selected ? selected.value : undefined;
        },
      });
      return undefined;
    });

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();

    const pending = host.application.commands.execute(Choose);
    const quickPick = host.quickInput.quickPicks[0];
    expect(quickPick?.placeholder).toBe('Pick a target');
    expect(quickPick?.items).toHaveLength(3);
    const beta = quickPick?.items[2];
    quickPick?._accept(beta === undefined ? [] : [beta]);

    await expect(pending).resolves.toBe('b');
    await host.stop();
  });

  it('rejects duplicate status bar and language status ids at compile time', () => {
    const duplicateStatus = defineModule('ui', (builder): undefined => {
      builder.statusBar.add(SyncStatus);
      builder.statusBar.add(defineStatusBarItem({ id: 'sample.syncStatus', text: 'other' }));
      return undefined;
    });
    expect(() => compileApplication({ name: 'sample', modules: [duplicateStatus] })).toThrow(
      /Status bar item "sample.syncStatus" is registered more than once/
    );

    const duplicateLanguage = defineModule('ui', (builder): undefined => {
      builder.languageStatus.add(LintStatus);
      builder.languageStatus.add(
        defineLanguageStatusItem({ id: 'sample.lint', selector: 'json', name: 'x', text: 'y' })
      );
      return undefined;
    });
    expect(() => compileApplication({ name: 'sample', modules: [duplicateLanguage] })).toThrow(
      /Language status item "sample.lint" is registered more than once/
    );
  });

  it('creates module tree views at activation with a DI-resolved provider and unwinds them on stop', async () => {
    const ProviderToken = serviceToken<{ name: string; disposed: boolean; dispose(): void }>(
      'demo.treeProvider'
    );
    const module = defineModule('trees', (builder): undefined => {
      builder.services.singleton(ProviderToken, () => ({
        name: 'provider',
        disposed: false,
        dispose(): void {
          this.disposed = true;
        },
      }));
      builder.treeViews.add({
        id: 'sample.projects',
        inject: { provider: ProviderToken },
        resolveProvider: ({ provider }) => provider,
        options: { showCollapseAll: true },
      });
      return undefined;
    });

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();

    const view = host.treeViews.views[0];
    expect(view).toMatchObject({
      id: 'sample.projects',
      options: { showCollapseAll: true },
      disposed: false,
    });
    expect((view?.source as unknown as { name: string }).name).toBe('provider');

    await host.stop();
    expect(host.treeViews.views[0]?.disposed).toBe(true);
    expect((view?.source as unknown as { disposed: boolean }).disposed).toBe(true);
    expect(host.leaks()).toEqual({ registrations: 0, resources: 0, commands: [] });
  });

  it('rejects duplicate tree view ids at compile time', () => {
    const module = defineModule('trees', (builder): undefined => {
      builder.treeViews.add({ id: 'same.view', resolveProvider: () => ({}) });
      builder.treeViews.add({ id: 'same.view', resolveProvider: () => ({}) });
      return undefined;
    });
    expect(() => compileApplication({ name: 'sample', modules: [module] })).toThrow(
      /Tree view "same.view" is registered more than once/
    );
  });

  it('fails activation clearly when a declared item has no capability', async () => {
    const module = defineModule('ui', (builder): undefined => {
      builder.statusBar.add(SyncStatus);
      return undefined;
    });
    const application = createApplication({
      plan: compileApplication({ name: 'sample', modules: [module] }),
      capabilities: { commands: createFakeCommands(), environment: createFakeEnvironment({}) },
    });

    await expect(application.activate({ subscriptions: [] })).rejects.toThrow(
      /needs a statusBar capability/
    );
  });

  it('fails the first Notifications injection clearly when no capability exists', async () => {
    const Notify = defineCommandContract<readonly [], undefined>({ id: 'sample.notify' });
    const module = defineModule('ui', (builder): undefined => {
      builder.commands.handle(Notify, {
        inject: { notifier: Notifications },
        execute: async (_context, _args, { notifier }) => {
          await notifier.info('hi');
          return undefined;
        },
      });
      return undefined;
    });
    const commands = createFakeCommands();
    const application = createApplication({
      plan: compileApplication({ name: 'sample', modules: [module] }),
      capabilities: { commands, environment: createFakeEnvironment({}) },
    });
    await application.activate({ subscriptions: [] });

    await expect(application.commands.execute(Notify)).rejects.toThrow(
      /needs a notifications capability/
    );
    await application.deactivate();
  });
});
