import { serviceToken } from '@kkdev92/vscode-ext-kit';
import { createTestHost } from '@kkdev92/vscode-ext-kit/testing';

import { CountProjects } from './commands-and-services.js';
import { app } from './extension.js';

interface ProjectIndex {
  count(): number;
  rebuild(signal: AbortSignal): Promise<number>;
}
const ProjectIndex = serviceToken<ProjectIndex>('sample.projectIndex');

// The *production* plan, on fakes. Not a rebuild of it for testing: `app.plan`
// is the very object the extension host would run, and no VS Code module is
// loaded to get at it.

export async function countsProjects(): Promise<number> {
  const host = createTestHost({ plan: app.plan });
  await host.start();

  const count = await host.application.commands.execute(CountProjects);

  await host.stop();
  // Nothing left registered or undisposed: the assertion that catches a leak
  // introduced three refactors from now.
  const leaks = host.leaks();
  if (leaks.registrations !== 0 || leaks.resources !== 0) {
    throw new Error('the application leaked');
  }
  return count;
}

export async function countsWithAStubbedIndex(): Promise<number> {
  const host = createTestHost({
    plan: app.plan,
    // Replace one singleton; the rest of the graph is untouched, and the plan
    // itself is not modified.
    configureServices: (services) => {
      services.replaceSingleton(ProjectIndex, () => ({
        count: () => 99,
        rebuild: () => Promise.resolve(99),
      }));
    },
  });
  await host.start();

  const count = await host.application.commands.execute(CountProjects);

  await host.stop();
  return count;
}

export async function readsASetting(): Promise<void> {
  const host = createTestHost({ plan: app.plan });
  // Arrange a scoped value the way VS Code would resolve it, then report the
  // change with the leaf key VS Code actually reports.
  host.settings._set('sample.projects', 'enabled', 'globalValue', false);
  await host.start();
  host.settings._fireChange(['sample.projects.enabled']);
  await host.stop();
}
