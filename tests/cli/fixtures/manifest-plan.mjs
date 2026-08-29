// An extension with one of each thing a manifest must agree with: a command,
// a settings section and a view. Imports the built output like the other
// fixtures; `npm run typecheck` builds it, and the tests skip when it is absent.
import {
  defineCommandContract,
  defineExtension,
  defineModule,
  defineSettings,
  setting,
} from '../../../dist/index.js';

const Refresh = defineCommandContract({ id: 'sample.refresh', title: 'Refresh' });
const Settings = defineSettings({
  section: 'sample',
  values: {
    limit: setting.number({ default: 10, minimum: 1 }),
    mode: setting.enum({ values: ['fast', 'thorough'], default: 'fast' }),
  },
});
// A section the extension reads but does not own; the manifest must not be
// asked for it, so none of the manifest fixtures mention `editor`.
const Editor = defineSettings({
  section: 'editor',
  values: { tabSize: setting.integer({ default: 4 }) },
  contributed: false,
});

const projects = defineModule('projects', (module) => {
  module.settings.add(Settings);
  module.settings.add(Editor);
  module.commands.handle(Refresh, () => undefined);
  module.treeViews.add({ id: 'sample.projects', resolveProvider: () => ({}) });
  return undefined;
});

export const app = defineExtension({ name: 'sample', modules: [projects] });
