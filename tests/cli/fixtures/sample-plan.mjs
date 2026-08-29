// A small extension, the way a consumer writes one, for the CLI to read.
// Imports the built output because that is what the CLI resolves `vscode`
// against; `npm run typecheck` builds it, and the test skips when it is absent.
import {
  Log,
  defineCommandContract,
  defineExtension,
  defineModule,
  serviceToken,
} from '../../../dist/index.js';

const Clock = serviceToken('sample.clock');
const Refresh = defineCommandContract({ id: 'sample.refresh', title: 'Refresh' });

const projects = defineModule('projects', (module) => {
  module.services.singleton(Clock, () => ({ now: () => 0 }));
  module.commands.handle(Refresh, {
    inject: { clock: Clock, log: Log },
    execute: () => undefined,
  });
  module.hostedServices.add({ id: 'projects.index', start: () => undefined });
  return undefined;
});

export const app = defineExtension({ name: 'sample', modules: [projects] });
