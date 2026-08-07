/**
 * Application composition tests using only foundation declarations and testing
 * fakes. Change this suite when plan binding, command Operations, activation
 * rollback, hosted-service order or the single Application stop path changes;
 * adapter conversion belongs in the capability contract suites instead.
 */
import { describe, expect, it, vi } from 'vitest';

import { createApplication } from '../../../src/foundation/application/application.js';
import { compileApplication } from '../../../src/foundation/application/plan.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import { userError } from '../../../src/foundation/operations/errors.js';
import { serviceToken } from '../../../src/foundation/services/token.js';
import { createFakeCommands } from '../../../src/testing/fakes/fake-commands.js';
import { createFakeEnvironment } from '../../../src/testing/fakes/fake-environment.js';
import { createRecordingLogSink } from '../../../src/testing/fakes/recording-log-sink.js';
import type { ModuleDefinition } from '../../../src/foundation/modules/definition.js';

interface Repository {
  refresh(force: boolean | undefined, signal: AbortSignal): Promise<number>;
}
const Repository = serviceToken<Repository>('projects.repository');

const Refresh = defineCommandContract<readonly [force?: boolean], number>({
  id: 'sample.refresh',
  title: 'Refresh',
});

const subscriptions = (): { subscriptions: { dispose(): unknown }[] } => ({ subscriptions: [] });

function build(modules: readonly ModuleDefinition[]): {
  app: ReturnType<typeof createApplication>;
  commands: ReturnType<typeof createFakeCommands>;
  logs: ReturnType<typeof createRecordingLogSink>;
  events: string[];
} {
  const commands = createFakeCommands();
  const logs = createRecordingLogSink();
  const events: string[] = [];
  const app = createApplication({
    plan: compileApplication({ name: 'sample', modules }),
    capabilities: { commands, environment: createFakeEnvironment({}) },
    logSink: logs.sink,
    onDiagnostic: (diagnostic) => events.push(diagnostic.event),
  });
  return { app, commands, logs, events };
}

describe('createApplication', () => {
  it('registers commands on activate and removes them on deactivate', async () => {
    const module = defineModule('projects', (builder): undefined => {
      builder.commands.handle(Refresh, () => 0);
      return undefined;
    });
    const { app, commands } = build([module]);
    const context = subscriptions();

    await app.activate(context);
    expect(commands.registeredIds).toEqual(['sample.refresh']);
    expect(app.host.state).toBe('running');

    await app.deactivate();
    expect(commands.registeredIds).toEqual([]);
    expect(app.host.state).toBe('stopped');
  });

  it('delivers the handler return value through the typed executor', async () => {
    const module = defineModule('projects', (builder): undefined => {
      builder.services.singleton(Repository, () => ({
        refresh: (force) => Promise.resolve(force === true ? 10 : 1),
      }));
      builder.commands.handle(Refresh, {
        inject: { repository: Repository },
        execute: (context, [force], { repository }) => repository.refresh(force, context.signal),
      });
      return undefined;
    });
    const { app } = build([module]);
    await app.activate(subscriptions());

    await expect(app.commands.execute(Refresh, true)).resolves.toBe(10);
    await expect(app.commands.execute(Refresh)).resolves.toBe(1);
  });

  it('propagates a handler rejection to the caller instead of swallowing it', async () => {
    const failure = userError({ code: 'NOPE', message: 'Cannot refresh right now.' });
    const module = defineModule('projects', (builder): undefined => {
      builder.commands.handle(Refresh, () => {
        throw failure;
      });
      return undefined;
    });
    const { app, logs } = build([module]);
    await app.activate(subscriptions());

    await expect(app.commands.execute(Refresh)).rejects.toBe(failure);
    expect(logs.at('error')).toHaveLength(1);
  });

  it('gives the handler an operation context with a live signal', async () => {
    const seen: { id?: string; kind?: string; aborted?: boolean } = {};
    const module = defineModule('projects', (builder): undefined => {
      builder.commands.handle(Refresh, (context) => {
        seen.id = context.id;
        seen.kind = context.kind;
        seen.aborted = context.signal.aborted;
        return 0;
      });
      return undefined;
    });
    const { app } = build([module]);
    await app.activate(subscriptions());

    await app.commands.execute(Refresh);

    expect(seen.kind).toBe('command');
    expect(seen.id).toContain('command:sample.refresh#');
    expect(seen.aborted).toBe(false);
  });

  it('cancels in-flight handlers when the application stops', async () => {
    let observed: AbortSignal | undefined;
    let release: (() => void) | undefined;
    const module = defineModule('projects', (builder): undefined => {
      builder.commands.handle(Refresh, async (context) => {
        observed = context.signal;
        await new Promise<void>((resolve) => {
          release = resolve;
        });
        return 0;
      });
      return undefined;
    });
    const { app } = build([module]);
    await app.activate(subscriptions());

    const pending = app.commands.execute(Refresh);
    await vi.waitFor(() => expect(observed).toBeDefined());

    const stopping = app.deactivate();
    expect(observed?.aborted).toBe(true);

    release?.();
    await pending;
    await stopping;
  });

  it('rolls back a failed activation so no command stays registered', async () => {
    // Preflight catches duplicates *within* the application. It cannot know that
    // another installed extension already owns an id, so that failure surfaces
    // from the platform at bind time -- which is what the activation transaction
    // exists for.
    const Other = defineCommandContract({ id: 'sample.other' });
    const good = defineModule('good', (builder): undefined => {
      builder.commands.handle(Refresh, () => 0);
      return undefined;
    });
    const bad = defineModule('bad', (builder): undefined => {
      builder.commands.handle(Other, () => undefined);
      return undefined;
    });

    const commands = createFakeCommands();
    const events: string[] = [];
    const hostile = {
      ...commands,
      register: (id: string, handler: (...args: readonly unknown[]) => unknown) => {
        if (id === 'sample.other') {
          throw new Error(`command '${id}' already exists`);
        }
        return commands.register(id, handler);
      },
    };
    const app = createApplication({
      plan: compileApplication({ name: 'sample', modules: [good, bad] }),
      capabilities: { commands: hostile, environment: createFakeEnvironment({}) },
      onDiagnostic: (diagnostic) => events.push(diagnostic.event),
    });

    await expect(app.activate(subscriptions())).rejects.toThrow(/already exists/);

    expect(app.host.state).toBe('failed');
    // The first module bound successfully, but activation as a whole failed, so
    // its registrations are rolled back too.
    expect(commands.registeredIds).toEqual([]);
    expect(app.host.registrationCount).toBe(0);
    expect(events).toContain('module.failed');
  });

  it('registers exactly one failsafe on context.subscriptions', async () => {
    const module = defineModule('projects', (): undefined => undefined);
    const { app } = build([module]);
    const context = subscriptions();

    await app.activate(context);
    expect(context.subscriptions).toHaveLength(1);

    // Subscription disposal and deactivate() may overlap. Fire the failsafe
    // mid-flight and require exactly-once cleanup without assuming their order.
    const stopping = app.deactivate();
    expect(() => {
      for (const disposable of context.subscriptions) {
        disposable.dispose();
      }
    }).not.toThrow();
    await stopping;
    expect(app.host.state).toBe('stopped');

    // A late fire after stop settled stays a no-op as well.
    expect(() => {
      for (const disposable of context.subscriptions) {
        disposable.dispose();
      }
    }).not.toThrow();
    expect(app.host.state).toBe('stopped');
  });

  it('disposes singletons after the module resources that use them', async () => {
    const order: string[] = [];
    const module = defineModule('projects', (builder): undefined => {
      builder.services.singleton(Repository, () => ({
        refresh: () => Promise.resolve(0),
        dispose: () => order.push('singleton'),
      }));
      builder.commands.handle(Refresh, {
        inject: { repository: Repository },
        execute: (context, _args, { repository }) => {
          context.resources.defer(() => {
            order.push('operation-resource');
          });
          return repository.refresh(undefined, context.signal);
        },
      });
      return undefined;
    });
    const { app } = build([module]);
    await app.activate(subscriptions());
    await app.commands.execute(Refresh);

    await app.deactivate();

    expect(order).toEqual(['operation-resource', 'singleton']);
  });

  describe('hosted services', () => {
    it('starts in declaration order and stops in reverse', async () => {
      const order: string[] = [];
      const module = defineModule('projects', (builder): undefined => {
        builder.hostedServices.add({
          id: 'first',
          start: () => {
            order.push('start:first');
          },
          stop: () => {
            order.push('stop:first');
          },
        });
        builder.hostedServices.add({
          id: 'second',
          start: () => {
            order.push('start:second');
          },
          stop: () => {
            order.push('stop:second');
          },
        });
        return undefined;
      });
      const { app } = build([module]);

      await app.activate(subscriptions());
      await app.deactivate();

      expect(order).toEqual(['start:first', 'start:second', 'stop:second', 'stop:first']);
    });

    it('stops already-started services in reverse when a later start fails', async () => {
      const order: string[] = [];
      const module = defineModule('projects', (builder): undefined => {
        builder.hostedServices.add({
          id: 'first',
          start: () => {
            order.push('start:first');
          },
          stop: () => {
            order.push('stop:first');
          },
        });
        builder.hostedServices.add({
          id: 'second',
          start: () => {
            throw new Error('cannot connect');
          },
        });
        return undefined;
      });
      const { app } = build([module]);

      await expect(app.activate(subscriptions())).rejects.toThrow('cannot connect');

      expect(order).toEqual(['start:first', 'stop:first']);
      expect(app.host.state).toBe('failed');
    });

    it('runs a background loop that unwinds when the application stops', async () => {
      let iterations = 0;
      const module = defineModule('projects', (builder): undefined => {
        builder.hostedServices.background({
          id: 'indexer',
          run: async (context) => {
            while (!context.signal.aborted) {
              iterations += 1;
              await context.delay(10_000);
            }
          },
        });
        return undefined;
      });
      const { app } = build([module]);

      await app.activate(subscriptions());
      await vi.waitFor(() => expect(iterations).toBeGreaterThan(0));

      // delay() resolves early on abort, so deactivate does not wait 10 seconds.
      await app.deactivate();
      expect(app.host.state).toBe('stopped');
    });

    it('injects declared dependencies into a hosted service', async () => {
      let injected: Repository | undefined;
      const module = defineModule('projects', (builder): undefined => {
        builder.services.singleton(Repository, () => ({
          refresh: () => Promise.resolve(0),
        }));
        builder.hostedServices.add({
          id: 'warmup',
          inject: { repository: Repository },
          start: (_context, deps) => {
            injected = deps.repository;
          },
        });
        return undefined;
      });
      const { app } = build([module]);

      await app.activate(subscriptions());
      expect(injected).toBeDefined();
      await app.deactivate();
    });
  });

  describe('argument validation', () => {
    it('rejects invalid arguments from untrusted callers', async () => {
      const Validated = defineCommandContract<readonly [force: boolean], number>(
        { id: 'sample.validated' },
        {
          args: {
            validate: (value) => {
              const args = value as readonly unknown[];
              return typeof args[0] === 'boolean'
                ? { ok: true, value: [args[0]] as readonly [boolean] }
                : { ok: false, issues: [{ message: 'force must be a boolean' }] };
            },
          },
        }
      );
      const handler = vi.fn(() => 1);
      const module = defineModule('projects', (builder): undefined => {
        builder.commands.handle(Validated, handler);
        return undefined;
      });
      const { app, commands } = build([module]);
      await app.activate(subscriptions());

      await expect(commands.execute('sample.validated', 'nope')).rejects.toThrow(
        /Invalid arguments/
      );
      expect(handler).not.toHaveBeenCalled();

      await expect(app.commands.execute(Validated, true)).resolves.toBe(1);
    });
  });
});
