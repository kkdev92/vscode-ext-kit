import {
  defineCommandContract,
  defineExtension,
  defineModule,
  defineSettings,
  serviceToken,
  setting,
  type OperationContext,
} from '@kkdev92/vscode-ext-kit';

// The inventory, declared. Each registration says what it is and what it needs;
// when it is disposed is no longer its concern. Nothing in this file imports
// `vscode`, which is what lets a test run this exact plan on fakes.

interface ProjectIndex {
  count(): number;
  touch(path: string): void;
  forget(path: string): void;
  prune(olderThanMs: number): void;
}
const ProjectIndex = serviceToken<ProjectIndex>('sample.projectIndex');

// The setting the command read ad hoc, declared once: key, type, default and
// contribution scope, with package.json checked against it.
export const Settings = defineSettings({
  section: 'sample',
  values: { limit: setting.number({ default: 10, minimum: 1 }) },
});

// The command's id, arguments and result, fixed for every caller.
export const CountProjects = defineCommandContract<readonly [], number>({
  id: 'sample.countProjects',
});

export const projectsModule = defineModule('projects', (module): undefined => {
  module.settings.add(Settings);

  // The module-level `let index` becomes a service: built by the container,
  // owned by it, and replaceable in a test.
  module.services.singleton(ProjectIndex, () => {
    const seen = new Map<string, number>();
    return {
      count: () => seen.size,
      touch: (path) => void seen.set(path, Date.now()),
      forget: (path) => void seen.delete(path),
      prune: (olderThanMs) => {
        const cutoff = Date.now() - olderThanMs;
        for (const [path, at] of seen) {
          if (at < cutoff) seen.delete(path);
        }
      },
    };
  });

  module.commands.handle(CountProjects, {
    inject: { index: ProjectIndex, settings: Settings.token },
    execute: (_context: OperationContext, _args, { index, settings }) =>
      Math.min(index.count(), settings.read().values.limit),
  });

  // The watcher, its three callbacks collapsed into one debounced batch that
  // runs as an operation.
  module.fileWatchers.add({
    id: 'projects.files',
    patterns: ['**/*.project.json'],
    ignorePatterns: ['**/node_modules/**'],
    inject: { index: ProjectIndex },
    handle: (_context: OperationContext, events, { index }) => {
      for (const event of events) {
        if (event.type === 'delete') index.forget(event.uri.fsPath);
        else index.touch(event.uri.fsPath);
      }
    },
  });

  // The `setInterval` becomes a background hosted service. The host tracks it,
  // `context.delay` returns early on shutdown, and there is no handle to clear.
  module.hostedServices.background({
    id: 'projects.prune',
    inject: { index: ProjectIndex },
    run: async (context, { index }) => {
      while (!context.signal.aborted) {
        await context.delay(30_000);
        if (context.signal.aborted) return;
        index.prune(24 * 60 * 60 * 1000);
      }
    },
  });

  return undefined;
});

// Preflight runs here, at import time. `activate` and `deactivate` are the
// framework's: `deactivate` is the one cleanup path, and `activate` puts a
// single synchronous failsafe on `context.subscriptions`. Nothing else is
// pushed there, by you or by anything you declared.
export const app = defineExtension({ name: 'Sample', modules: [projectsModule] });
export const activate = app.activate;
export const deactivate = app.deactivate;
