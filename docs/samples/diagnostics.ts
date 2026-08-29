import { defineExtension } from '@kkdev92/vscode-ext-kit';
import type { HostDiagnostic } from '@kkdev92/vscode-ext-kit';

import { projectsModule } from './commands-and-services.js';

/** The last few lifecycle events, for a "report an issue" command to attach. */
const recent: HostDiagnostic[] = [];

export const app = defineExtension({
  name: 'Sample',
  modules: [projectsModule],
  // Called synchronously as the host starts, binds modules, runs operations and
  // stops. Keep it cheap: it is not awaited, and an exception here is swallowed
  // rather than allowed to affect the lifecycle it is watching.
  onDiagnostic: (diagnostic) => {
    recent.push(diagnostic);
    if (recent.length > 100) {
      recent.shift();
    }
  },
});

/**
 * `application.shutdownTimeout` is the one worth reading first.
 *
 * It means the stop budget ran out and the remaining work was abandoned rather
 * than awaited. `details` says which phase ran out, how long it waited, which
 * hosted service was inside its `stop`, which operations never settled, and
 * which resource scopes still held entries — ids and counts, never arguments
 * or payloads.
 */
export function unfinishedAtShutdown(): readonly HostDiagnostic[] {
  return recent.filter((diagnostic) => diagnostic.event === 'application.shutdownTimeout');
}
