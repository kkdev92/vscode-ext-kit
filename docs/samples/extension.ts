import { defineExtension } from '@kkdev92/vscode-ext-kit';

import { CountProjects, projectsModule } from './commands-and-services.js';

// Preflight runs here, at import time: duplicate ids, a missing service, a cycle
// or a captive dependency fail before VS Code is touched at all.
// Exported so a test can run this exact plan on fakes -- see testing.ts.
export const app = defineExtension({
  name: 'Sample',
  modules: [projectsModule],
});

// `activate` registers one synchronous failsafe on `context.subscriptions`;
// `deactivate` is the single cleanup path. Nothing else needs disposing by hand.
export const activate = app.activate;
export const deactivate = app.deactivate;

// Typed invocation from anywhere: the contract fixes the arguments and the
// result, and both the value and any rejection reach this caller.
export const countProjects = (): Promise<number> => app.commands.execute(CountProjects);
