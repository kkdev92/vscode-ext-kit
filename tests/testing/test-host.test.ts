/**
 * TestHost integration contract.
 *
 * This suite proves a compiled production plan reaches the real application
 * host through fakes, that overrides are isolated, and managed raw/settings
 * registrations participate in rollback and cleanup. Add coverage here when
 * TestHost exposes a new capability or claims a new lifecycle guarantee. Port-
 * fake fidelity and real VS Code behavior belong in their own contract lanes.
 */
import { describe, expect, it, vi } from 'vitest';

import { createApplication } from '../../src/foundation/application/application.js';
import { compileApplication } from '../../src/foundation/application/plan.js';
import { defineCommandContract } from '../../src/foundation/commands/contract.js';
import { defineModule } from '../../src/foundation/modules/definition.js';
import { SettingsTarget } from '../../src/foundation/platform/ports.js';
import { serviceToken } from '../../src/foundation/services/token.js';
import { defineSettings, setting } from '../../src/foundation/settings/definition.js';
import { createFakeCommands } from '../../src/testing/fakes/fake-commands.js';
import { createFakeEnvironment } from '../../src/testing/fakes/fake-environment.js';
import { createTestHost } from '../../src/testing/test-host.js';

interface Repository {
  count(): number;
}
const Repository = serviceToken<Repository>('projects.repository');

const CountProjects = defineCommandContract<readonly [], number>({ id: 'sample.count' });

const ProjectSettings = defineSettings({
  section: 'sample.projects',
  values: {
    enabled: setting.boolean({ default: true, scope: 'resource' }),
    limit: setting.number({ default: 10, minimum: 1 }),
  },
});

const projectsModule = defineModule('projects', (module): undefined => {
  module.settings.add(ProjectSettings);
  module.services.singleton(Repository, () => ({ count: () => 1 }));
  module.commands.handle(CountProjects, {
    inject: { repository: Repository, settings: ProjectSettings.token },
    execute: (_context, _args, { repository, settings }) =>
      settings.read().get('enabled') ? repository.count() : 0,
  });
  return undefined;
});

const plan = compileApplication({ name: 'sample', modules: [projectsModule] });

describe('createTestHost', () => {
  it('runs the production plan on fakes', async () => {
    const host = createTestHost({ plan });

    await host.start();

    expect(host.commands.registeredIds).toEqual(['sample.count']);
    await expect(host.application.commands.execute(CountProjects)).resolves.toBe(1);

    await host.stop();
  });

  it('reports no leaks after a clean stop', async () => {
    const host = createTestHost({ plan });
    await host.start();
    await host.application.commands.execute(CountProjects);

    await host.stop();

    // Exactly these three fields: consumers assert on the whole object, and
    // the guide tells them to, so the shape is part of the contract.
    expect(host.leaks()).toEqual({ registrations: 0, resources: 0, commands: [] });
    // The same ownership, named. A zero count beside a non-empty scope would
    // mean one of the two is reading something other than what it claims.
    expect(host.inspect()).toMatchObject({
      state: 'stopped',
      registrations: { size: 0, children: [] },
      resources: { size: 0, children: [] },
      hostedServices: [],
      operations: [],
      backgroundTasks: 0,
    });
  });

  it('replaces a singleton without touching the plan', async () => {
    const host = createTestHost({
      plan,
      configureServices: (services) => {
        services.replaceSingleton(Repository, () => ({ count: () => 99 }));
      },
    });

    await host.start();

    await expect(host.application.commands.execute(CountProjects)).resolves.toBe(99);
    // The shared plan is untouched, so other tests still see the real service.
    expect(plan.services.some((service) => service.moduleId === 'test.override')).toBe(false);

    await host.stop();
  });

  it('exposes the settings fake so scoped values can be arranged', async () => {
    const host = createTestHost({ plan });
    host.settings._set('sample.projects', 'enabled', 'globalValue', false);

    await host.start();

    await expect(host.application.commands.execute(CountProjects)).resolves.toBe(0);
    await host.stop();
  });

  it('records diagnostics in order', async () => {
    const host = createTestHost({ plan });

    await host.start();
    await host.stop();

    expect(host.events.slice(0, 4)).toEqual([
      'application.starting',
      'module.binding',
      'module.bound',
      'application.running',
    ]);
    expect(host.events).toContain('application.stopped');
  });

  it('captures what the application logged', async () => {
    const failing = defineModule('failing', (module): undefined => {
      module.commands.handle(defineCommandContract({ id: 'sample.fail' }), () => {
        throw new Error('handler exploded');
      });
      return undefined;
    });
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [failing] }),
    });
    await host.start();

    await expect(host.commands.execute('sample.fail')).rejects.toThrow('handler exploded');

    expect(host.logs.at('error')).toHaveLength(1);
    await host.stop();
  });
});

describe('managed raw registration', () => {
  it('takes part in the activation transaction and unwinds on stop', async () => {
    const disposed = vi.fn();
    const module = defineModule('raw', (builder): undefined => {
      builder.raw.register({
        id: 'raw.codeLens',
        bind: (context): undefined => {
          context.registrations.own({ dispose: disposed });
          return undefined;
        },
      });
      return undefined;
    });
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });

    await host.start();
    expect(disposed).not.toHaveBeenCalled();

    await host.stop();
    expect(disposed).toHaveBeenCalledTimes(1);
    expect(host.leaks().registrations).toBe(0);
  });

  it('receives declared dependencies', async () => {
    let seen: Repository | undefined;
    const module = defineModule('raw', (builder): undefined => {
      builder.services.singleton(Repository, () => ({ count: () => 7 }));
      builder.raw.register({
        id: 'raw.withDeps',
        inject: { repository: Repository },
        bind: (_context, { repository }): undefined => {
          seen = repository;
          return undefined;
        },
      });
      return undefined;
    });
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });

    await host.start();

    expect(seen?.count()).toBe(7);
    await host.stop();
  });

  it('rolls back when bind throws', async () => {
    const disposed = vi.fn();
    const module = defineModule('raw', (builder): undefined => {
      builder.raw.register({
        id: 'raw.first',
        bind: (context): undefined => {
          context.registrations.own({ dispose: disposed });
          throw new Error('provider registration failed');
        },
      });
      return undefined;
    });
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });

    await expect(host.start()).rejects.toThrow('provider registration failed');

    expect(disposed).toHaveBeenCalledTimes(1);
    expect(host.application.host.state).toBe('failed');
    expect(host.leaks().registrations).toBe(0);
  });

  it('rejects an async bind', async () => {
    const module = defineModule('raw', (builder): undefined => {
      builder.raw.register({
        id: 'raw.async',
        bind: (() => Promise.resolve(undefined)) as unknown as () => undefined,
      });
      return undefined;
    });
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });

    await expect(host.start()).rejects.toThrow(/must be synchronous/);
  });

  it('is rejected by preflight when an id repeats', () => {
    const first = defineModule('a', (builder): undefined => {
      builder.raw.register({ id: 'raw.same', bind: (): undefined => undefined });
      return undefined;
    });
    const second = defineModule('b', (builder): undefined => {
      builder.raw.register({ id: 'raw.same', bind: (): undefined => undefined });
      return undefined;
    });

    expect(() => compileApplication({ name: 'sample', modules: [first, second] })).toThrow(
      /registered more than once/
    );
  });
});

describe('settings integration', () => {
  it('injects an accessor and reflects an update', async () => {
    const host = createTestHost({ plan });
    await host.start();

    await expect(host.application.commands.execute(CountProjects)).resolves.toBe(1);

    const accessor = host.settings;
    await accessor.update('sample.projects', 'enabled', false, SettingsTarget.Global);
    accessor._fireChange(['sample.projects']);

    await expect(host.application.commands.execute(CountProjects)).resolves.toBe(0);
    await host.stop();
  });

  it('fails at wiring time when settings are declared without a capability', async () => {
    // Preflight is happy: a plan may declare settings without knowing where the
    // values will come from. createApplication is the boundary that needs the
    // capability, so that is where the error has to appear — and it has to name
    // the section, or a consumer cannot tell which module is unsatisfied.
    expect(plan.settings).toHaveLength(1);

    const application = createApplication({
      plan,
      capabilities: { commands: createFakeCommands(), environment: createFakeEnvironment() },
    });

    await expect(application.host.start()).rejects.toThrow(
      /Module settings for "sample\.projects" need a settings capability/
    );
    // The failed start still owns the single cleanup path.
    expect(application.host.state).toBe('failed');
    await application.host.stop('manual');
  });
});
