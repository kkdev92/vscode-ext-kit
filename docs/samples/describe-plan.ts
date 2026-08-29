import { describePlan } from '@kkdev92/vscode-ext-kit';

import { app } from './extension.js';

/**
 * What this extension registers, as JSON.
 *
 * Commit the output and a pull request shows the topology change beside the
 * code change: a new command, a service that gained a dependency, a watcher
 * whose glob moved. Deterministic, so a diff means a declaration changed.
 */
export function planAsJson(): string {
  return JSON.stringify(describePlan(app.plan), null, 2);
}

/** Every command in the plan, with the module that declared it. */
export function commandOwners(): readonly string[] {
  return describePlan(app.plan).commands.map((command) => `${command.id} (${command.moduleId})`);
}

/**
 * The service graph as edges, which is most of what a dependency diagram is.
 *
 * Token ids, not token objects: the description carries nothing callable, so
 * there is nothing here to resolve or mutate.
 */
export function serviceEdges(): readonly string[] {
  return describePlan(app.plan).services.flatMap((service) =>
    Object.values(service.dependencies).map((dependency) => `${service.token} -> ${dependency}`)
  );
}
