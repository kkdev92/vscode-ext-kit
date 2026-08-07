import {
  Editors,
  Localization,
  Log,
  Notifications,
  QuickInput,
  defineCommandContract,
  defineModule,
  type Injected,
} from '@kkdev92/vscode-ext-kit';

// The services every handler in this module reaches for. Declared once, as a
// value, so it can be both injected and turned into a type.
const uses = {
  logger: Log,
  notify: Notifications,
  ask: QuickInput,
  editors: Editors,
  l10n: Localization,
} as const;

// The resolved shape of that set. Deriving it means a token added above cannot
// drift from the interface a feature is written against -- the alternative is a
// hand-written interface that goes stale the first time someone is in a hurry.
type Services = Injected<typeof uses>;

// Features take the bundle and stay out of the module file, which is what keeps
// a module readable once it has forty commands in it.
async function renameSymbol(services: Services): Promise<void> {
  const name = await services.ask.text({ prompt: services.l10n.t('New name') });
  if (name === undefined) {
    return;
  }
  const editor = services.editors.active;
  if (editor === undefined) {
    await services.notify.error(services.l10n.t('Open a file first.'));
    return;
  }
  await editor.transformSelections(() => name);
  services.logger.info('renamed', { name });
}

export const Rename = defineCommandContract<readonly [], void>({ id: 'sample.rename' });

// Options second, so the module body does not gain a level of indentation.
// `defineModule(id, callback, options)` also works when you prefer it trailing.
export const editingModule = defineModule('editing', { uses }, (module): undefined => {
  // No `inject` here: the ambient set is already merged in, and naming one of
  // its members again is a definition-time error rather than a shadowing rule.
  module.commands.handle(Rename, (_context, _args, services) => renameSymbol(services));

  return undefined;
});
