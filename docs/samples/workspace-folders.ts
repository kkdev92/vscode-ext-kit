import {
  Workspace,
  defineCommandContract,
  defineModule,
  type WatchedUri,
} from '@kkdev92/vscode-ext-kit';

export const Reveal = defineCommandContract<readonly [WatchedUri], void>({ id: 'sample.reveal' });

export const foldersModule = defineModule('folders', (module): undefined => {
  module.commands.handle(Reveal, {
    inject: { workspace: Workspace },
    execute: async (context, [target], { workspace }) => {
      // In no folder: say so, rather than show a path the user cannot place.
      if (workspace.folderOf(target) === undefined) {
        await context.notify.warn(context.l10n.t('{0} is outside the workspace.', target.fsPath));
        return;
      }
      // The text the Explorer shows: relative to the folder, and starting with
      // the folder's name when more than one is open.
      await context.notify.info(context.l10n.t('Revealed {0}', workspace.relativePath(target)));
    },
  });

  // Folders come and go while the extension runs. The subscription is tied to
  // the hosted service's signal like any other.
  module.hostedServices.add({
    id: 'sample.folders',
    inject: { workspace: Workspace },
    start: (context, { workspace }) => {
      const subscription = workspace.onDidChangeFolders(() => {
        context.logger.info('folders changed', { count: workspace.folders().length });
      });
      context.signal.addEventListener('abort', () => {
        subscription.dispose();
      });
    },
  });

  return undefined;
});
