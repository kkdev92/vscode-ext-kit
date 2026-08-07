import {
  defineCommandContract,
  defineModule,
  defineStatusBarItem,
  Notifications,
  QuickInput,
  type OperationContext,
  type PickItem,
} from '@kkdev92/vscode-ext-kit';

// Declared UI is created eagerly at activation and owned by the host: visible
// immediately, disposed on stop, no `context.subscriptions` bookkeeping.
const SyncStatus = defineStatusBarItem({
  id: 'sample.syncStatus',
  text: '$(cloud) Idle',
  command: 'sample.sync',
  tooltip: 'Sync projects',
});

export const Sync = defineCommandContract<readonly [], boolean>({ id: 'sample.sync' });

export const uiModule = defineModule('ui', (module): undefined => {
  module.statusBar.add(SyncStatus);

  module.commands.handle(Sync, {
    // Every UI surface arrives through a token, so all three are fakes in a
    // test with no VS Code anywhere.
    inject: { status: SyncStatus.token, notify: Notifications, ask: QuickInput },
    execute: async (context: OperationContext, _args, { status, notify, ask }) => {
      const items: readonly PickItem<'all' | 'changed'>[] = [
        { value: 'all', label: 'Everything' },
        { value: 'changed', label: 'Changed only' },
      ];
      // The signal is the operation's, so the picker closes when the command is
      // cancelled or the extension stops -- not only on Escape.
      const target = await ask.one(items, { title: 'Sync what?', signal: context.signal });
      if (target === undefined) {
        return false;
      }

      status.update('$(sync~spin) Syncing', 'Sync in progress');
      // Progress belongs to the operation: one session, cancellable, and tied to
      // the same signal the handler already has.
      await context.progress.run({ title: 'Syncing projects' }, async (reporter) => {
        reporter.report({ message: target.value, increment: 50 });
        await Promise.resolve();
      });
      status.update('$(cloud) Idle');

      await notify.info('Sync finished');
      return true;
    },
  });

  return undefined;
});
