// Two modules handling one command id: preflight rejects this while the module
// evaluates, which is the failure the CLI's `--check` exists to report.
import { defineCommandContract, defineExtension, defineModule } from '../../../dist/index.js';

const Refresh = defineCommandContract({ id: 'sample.refresh', title: 'Refresh' });

const first = defineModule('first', (module) => {
  module.commands.handle(Refresh, () => undefined);
  return undefined;
});
const second = defineModule('second', (module) => {
  module.commands.handle(Refresh, () => undefined);
  return undefined;
});

export const app = defineExtension({ name: 'broken', modules: [first, second] });
