import {
  defineCommandContract,
  defineModule,
  serviceToken,
  type OperationContext,
} from '@kkdev92/vscode-ext-kit';

// A service is an interface plus a token. The token carries the type, so
// injection sites need no casts and a missing registration is a compile error.
interface ProjectIndex {
  count(): number;
  rebuild(signal: AbortSignal): Promise<number>;
}
export const ProjectIndex = serviceToken<ProjectIndex>('sample.projectIndex');

// A command contract names the id once and fixes the argument and result types
// for every caller.
export const CountProjects = defineCommandContract<readonly [], number>({
  id: 'sample.countProjects',
});
export const Rebuild = defineCommandContract<readonly [force: boolean], number>({
  id: 'sample.rebuild',
});

export const projectsModule = defineModule('projects', (module): undefined => {
  module.services.singleton(ProjectIndex, () => {
    let known = 0;
    return {
      count: () => known,
      rebuild: async (signal) => {
        // Cooperative cancellation: the operation's signal aborts on stop,
        // caller cancellation and timeout alike.
        for (let step = 0; step < 10 && !signal.aborted; step += 1) {
          known += 1;
        }
        return known;
      },
    };
  });

  module.commands.handle(CountProjects, {
    inject: { index: ProjectIndex },
    execute: (_context: OperationContext, _args, { index }) => index.count(),
  });

  module.commands.handle(Rebuild, {
    inject: { index: ProjectIndex },
    execute: async (context: OperationContext, [force], { index }) => {
      context.logger.info('rebuilding', { force });
      return index.rebuild(context.signal);
    },
  });

  return undefined;
});
