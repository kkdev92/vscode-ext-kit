import { Commands, defineExtension, defineModule, serviceToken } from '@kkdev92/vscode-ext-kit';
import { createTestHost } from '@kkdev92/vscode-ext-kit/testing';

interface Projects {
  count(): number;
  onDidChange(listener: () => void): { dispose(): void };
}
const Projects = serviceToken<Projects>('sample.projects');

// A `when` clause in package.json -- on a menu entry, a keybinding, a view --
// reads context keys, and an extension sets its own with the built-in
// `setContext` command. `Commands` runs it: as `context.commands` in a handler,
// or injected, as here, into a hosted service that keeps a key in step with the
// application's state.
export const contextModule = defineModule('context', (module): undefined => {
  module.services.singleton(Projects, () => ({
    count: () => 0,
    onDidChange: () => ({ dispose: () => undefined }),
  }));

  module.hostedServices.add({
    id: 'sample.hasProjects',
    inject: { commands: Commands, projects: Projects },
    start: async (context, { commands, projects }) => {
      const publish = (): Promise<void> =>
        commands.execute('setContext', 'sample.hasProjects', projects.count() > 0);
      // Awaited, so the key is in place before activation reports done.
      await publish();
      const subscription = projects.onDidChange(() => {
        publish().catch((error: unknown) => {
          context.logger.warn('could not set sample.hasProjects', { error: String(error) });
        });
      });
      context.signal.addEventListener('abort', () => {
        subscription.dispose();
      });
    },
  });

  return undefined;
});

export const app = defineExtension({ name: 'Sample', modules: [contextModule] });

// The fake command capability knows only the commands registered on it, and
// `setContext` is the platform's. A test registers a stand-in for it before
// start, and reads back what the application set.
export async function readsTheKey(): Promise<unknown> {
  const host = createTestHost({ plan: app.plan });
  const keys = new Map<string, unknown>();
  host.commands.register('setContext', (key, value) => {
    keys.set(String(key), value);
  });
  await host.start();
  await host.stop();
  return keys.get('sample.hasProjects');
}
