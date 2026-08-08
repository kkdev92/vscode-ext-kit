import { defineExtension } from '@kkdev92/vscode-ext-kit';

import { CountProjects, ProjectIndex, projectsModule } from './commands-and-services.js';

// Some extensions publish an API: another extension reads it off
// `extensions.getExtension(id).exports`, and the built-in Markdown preview
// reads `extendMarkdownIt` the same way. VS Code takes it from whatever
// `activate` resolves to.
//
// That value has to be built from services, and services do not exist until the
// application has started -- so declaring it is what lets the framework build it
// at the one moment it can. `create` runs after every hosted service has
// started, with the same instances everything else got.
export const app = defineExtension({
  name: 'Sample',
  modules: [projectsModule],
  exports: {
    inject: { index: ProjectIndex },
    // No annotations: `index` is typed from `inject`, and `activate` resolves to
    // whatever this returns.
    create: ({ index }) => ({
      count: (): number => index.count(),
      rebuild: (signal: AbortSignal): Promise<number> => index.rebuild(signal),
    }),
  },
});

// Resolves to `{ count(): number; rebuild(signal): Promise<number> }`.
export const activate = app.activate;
export const deactivate = app.deactivate;

export const countProjects = (): Promise<number> => app.commands.execute(CountProjects);
