/**
 * Adversarial lifecycle regression tests for failure, cancellation and shutdown
 * races. They use fakes, fake timers and a scoped unhandled-rejection recorder;
 * update them when Host/Application unwinding or sync-only callback guards
 * change, not for ordinary feature registration behavior.
 */
import { describe, expect, it, vi } from 'vitest';

// Tests execute on Node, but the repo's tsconfig deliberately omits Node types
// (the runtime core must not reach them). Declare the two Node globals this
// test needs, scoped to this file.
declare const process: {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
};

import { createApplication } from '../../../src/foundation/application/application.js';
import { compileApplication } from '../../../src/foundation/application/plan.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import { createApplicationHost } from '../../../src/foundation/hosting/application-host.js';
import type { HostDiagnostic } from '../../../src/foundation/hosting/application-host.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import { serviceToken } from '../../../src/foundation/services/token.js';
import { createFakeCommands } from '../../../src/testing/fakes/fake-commands.js';
import { createFakeEnvironment } from '../../../src/testing/fakes/fake-environment.js';

/** Collects process-level unhandled rejections for the duration of a test. */
async function withUnhandledRecorder(
  work: () => void | Promise<void>
): Promise<readonly unknown[]> {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  try {
    await work();
    // Two macrotask turns: rejections surface after the microtask queue drains.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  return unhandled;
}

describe('activation failure with hosted services', () => {
  it('aborts, stops and drains earlier services before failing activation', async () => {
    const timeline: string[] = [];
    let runSettled = false;

    const moduleA = defineModule('a', (builder): undefined => {
      builder.hostedServices.add({
        id: 'a.service',
        start: () => {
          timeline.push('a.start');
        },
        stop: () => {
          timeline.push('a.stop');
        },
      });
      builder.hostedServices.background({
        id: 'a.loop',
        run: async (context) => {
          timeline.push('a.run');
          // Waits for its signal, exactly like a well-behaved background loop.
          await new Promise<void>((resolve) => {
            context.signal.addEventListener('abort', () => {
              resolve();
            });
          });
          runSettled = true;
          timeline.push('a.run.settled');
        },
      });
      return undefined;
    });

    const moduleB = defineModule('b', (builder): undefined => {
      builder.hostedServices.add({
        id: 'b.service',
        start: () => {
          timeline.push('b.start');
          throw new Error('b failed to start');
        },
      });
      return undefined;
    });

    const app = createApplication({
      plan: compileApplication({ name: 'sample', modules: [moduleA, moduleB] }),
      capabilities: { commands: createFakeCommands(), environment: createFakeEnvironment({}) },
    });

    await expect(app.activate({ subscriptions: [] })).rejects.toThrow('b failed to start');

    // The earlier service's background loop observed the abort and settled
    // BEFORE activation rejected — nothing keeps running past the failure.
    expect(runSettled).toBe(true);
    expect(timeline).toEqual(['a.start', 'a.run', 'b.start', 'a.stop', 'a.run.settled']);
    expect(app.host.state).toBe('failed');
  });

  it('bounds the failure unwinding by the shutdown budget', async () => {
    vi.useFakeTimers();
    try {
      const moduleA = defineModule('a', (builder): undefined => {
        builder.hostedServices.background({
          id: 'a.stuck',
          // Ignores its signal entirely: the drain must abandon it.
          run: () => new Promise<never>(() => undefined),
        });
        return undefined;
      });
      const moduleB = defineModule('b', (builder): undefined => {
        builder.hostedServices.add({
          id: 'b.service',
          start: () => {
            throw new Error('b failed to start');
          },
        });
        return undefined;
      });

      const diagnostics: HostDiagnostic[] = [];
      const app = createApplication({
        plan: compileApplication({
          name: 'sample',
          modules: [moduleA, moduleB],
          shutdown: { timeoutMs: 200 },
        }),
        capabilities: { commands: createFakeCommands(), environment: createFakeEnvironment({}) },
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      });

      const pending = app.activate({ subscriptions: [] });
      const settled = expect(pending).rejects.toThrow('b failed to start');
      await vi.advanceTimersByTimeAsync(250);
      await settled;

      const timeout = diagnostics.find(
        (diagnostic) => diagnostic.event === 'application.shutdownTimeout'
      );
      // Which loop was abandoned matters as much as the fact that one was: a
      // count alone leaves the reader to guess which service ignored its signal.
      expect(timeout?.details).toMatchObject({ phase: 'background', pending: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('rollback of a module that failed to bind', () => {
  /**
   * The two scopes a module binds into are detached until it commits, so
   * nothing else holds them. A rollback that stops at the first failing phase
   * therefore does not merely report badly — the contents of every phase it
   * skipped leak for the rest of the session, with no owner left to find them.
   */
  it('releases its resources even when a registration refuses to dispose', async () => {
    const released: string[] = [];

    const failing = defineModule('failing', (builder): undefined => {
      builder.raw.register({
        id: 'failing.first',
        bind: ({ registrations, resources }): undefined => {
          registrations.own({
            dispose: () => {
              throw new Error('this registration will not go quietly');
            },
          });
          resources.deferAsync(async () => {
            await Promise.resolve();
            released.push('resource');
          });
          return undefined;
        },
      });
      builder.raw.register({
        id: 'failing.second',
        bind: (): undefined => {
          throw new Error('bind failed');
        },
      });
      return undefined;
    });

    const app = createApplication({
      plan: compileApplication({ name: 'sample', modules: [failing] }),
      capabilities: { commands: createFakeCommands(), environment: createFakeEnvironment({}) },
    });

    // The activation failure propagates — not the cleanup failure that
    // happened while reacting to it. Replacing the cause with a consequence is
    // how a startup failure becomes unreadable.
    await expect(app.activate({ subscriptions: [] })).rejects.toThrow('bind failed');
    expect(released).toEqual(['resource']);
  });
});

describe('shutdown deadline covers start unwinding', () => {
  it('stop() settles within the budget even when a start hook ignores its signal', async () => {
    vi.useFakeTimers();
    try {
      const events: string[] = [];
      const host = createApplicationHost({
        name: 'app',
        shutdownTimeoutMs: 300,
        onDiagnostic: (diagnostic) => events.push(diagnostic.event),
        // Never settles, never looks at the signal.
        start: () => new Promise<never>(() => undefined),
      });

      const startPending = host.start();
      const settle = vi.fn();
      const stopping = host.stop('deactivate').then(settle);

      await vi.advanceTimersByTimeAsync(299);
      expect(settle).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(50);
      await stopping;

      expect(settle).toHaveBeenCalledTimes(1);
      expect(events).toContain('application.shutdownTimeout');
      // The abandoned start eventually being rejected must not fail anything.
      startPending.catch(() => undefined);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('observers must not interfere', () => {
  it('a throwing diagnostics observer neither fails work nor skips cleanup', async () => {
    const Refresh = await import('../../../src/foundation/commands/contract.js').then((m) =>
      m.defineCommandContract<readonly [], number>({ id: 'sample.refresh' })
    );
    const disposed = vi.fn();
    const module = defineModule('projects', (builder): undefined => {
      builder.commands.handle(Refresh, (context) => {
        context.resources.defer(disposed);
        return 42;
      });
      return undefined;
    });

    const commands = createFakeCommands();
    const app = createApplication({
      plan: compileApplication({ name: 'sample', modules: [module] }),
      capabilities: { commands, environment: createFakeEnvironment({}) },
      onDiagnostic: () => {
        throw new Error('observer exploded');
      },
    });

    await app.activate({ subscriptions: [] });
    await expect(app.commands.execute(Refresh)).resolves.toBe(42);
    expect(disposed).toHaveBeenCalledTimes(1);
    await app.deactivate();
    expect(app.host.state).toBe('stopped');
  });

  it('a throwing log sink neither fails work nor masks results', async () => {
    const Refresh = await import('../../../src/foundation/commands/contract.js').then((m) =>
      m.defineCommandContract<readonly [], string>({ id: 'sample.log' })
    );
    const module = defineModule('projects', (builder): undefined => {
      builder.commands.handle(Refresh, (context) => {
        context.logger.info('about to work');
        return 'worked';
      });
      return undefined;
    });

    const app = createApplication({
      plan: compileApplication({ name: 'sample', modules: [module] }),
      capabilities: { commands: createFakeCommands(), environment: createFakeEnvironment({}) },
      logSink: () => {
        throw new Error('sink exploded');
      },
    });

    await app.activate({ subscriptions: [] });
    await expect(app.commands.execute(Refresh)).resolves.toBe('worked');
    await app.deactivate();
  });
});

describe('hosted service stop receives the same injected instances', () => {
  it('passes the instance start() got, not a freshly resolved transient', async () => {
    interface Tracker {
      readonly id: number;
    }
    const TrackerToken = serviceToken<Tracker>('demo.tracker');
    let created = 0;
    const seen: { start?: Tracker; stop?: Tracker } = {};

    const module = defineModule('svc', (builder): undefined => {
      builder.services.transient(TrackerToken, () => ({ id: (created += 1) }));
      builder.hostedServices.add({
        id: 'svc.tracked',
        inject: { tracker: TrackerToken },
        start: (_context, { tracker }) => {
          seen.start = tracker;
        },
        stop: (_context, { tracker }) => {
          seen.stop = tracker;
        },
      });
      return undefined;
    });

    const app = createApplication({
      plan: compileApplication({ name: 'sample', modules: [module] }),
      capabilities: { commands: createFakeCommands(), environment: createFakeEnvironment({}) },
    });

    await app.activate({ subscriptions: [] });
    await app.deactivate();

    expect(seen.start).toBeDefined();
    expect(seen.stop).toBe(seen.start);
    expect(created).toBe(1);
  });
});

describe('sync-only guards claim the discarded rejection', () => {
  it('a rejecting async module configure produces no unhandled rejection', async () => {
    const unhandled = await withUnhandledRecorder(() => {
      expect(() =>
        defineModule('bad', ((): Promise<undefined> => {
          return Promise.resolve().then(() => {
            throw new Error('inner rejection');
          });
        }) as never)
      ).toThrow(/module configure callback/);
    });
    expect(unhandled).toEqual([]);
  });

  it('a rejecting async service factory produces no unhandled rejection', async () => {
    const { defineCommandContract } = await import('../../../src/foundation/commands/contract.js');
    const Touch = defineCommandContract<readonly [], undefined>({ id: 'demo.touch' });
    const Token = serviceToken<number>('demo.async');
    const module = defineModule('bad', (builder): undefined => {
      builder.services.singleton(Token, ((): Promise<never> =>
        Promise.resolve().then(() => {
          throw new Error('inner rejection');
        })) as never);
      // Anything that forces resolution.
      builder.commands.handle(Touch, { inject: { value: Token }, execute: () => undefined });
      return undefined;
    });

    const unhandled = await withUnhandledRecorder(async () => {
      const app = createApplication({
        plan: compileApplication({ name: 'sample', modules: [module] }),
        capabilities: { commands: createFakeCommands(), environment: createFakeEnvironment({}) },
      });
      await app.activate({ subscriptions: [] });
      await expect(app.commands.execute(Touch)).rejects.toThrow(/service factory/);
      await app.deactivate();
    });
    expect(unhandled).toEqual([]);
  });

  it('a rejecting async raw bind produces no unhandled rejection', async () => {
    const module = defineModule('bad', (builder): undefined => {
      builder.raw.register({
        id: 'bad.bind',
        bind: ((): Promise<never> =>
          Promise.resolve().then(() => {
            throw new Error('inner rejection');
          })) as never,
      });
      return undefined;
    });

    const unhandled = await withUnhandledRecorder(async () => {
      const app = createApplication({
        plan: compileApplication({ name: 'sample', modules: [module] }),
        capabilities: { commands: createFakeCommands(), environment: createFakeEnvironment({}) },
      });
      await expect(app.activate({ subscriptions: [] })).rejects.toThrow(/raw registration/);
    });
    expect(unhandled).toEqual([]);
  });

  it('a rejecting async Standard Schema validator produces no unhandled rejection', async () => {
    const { toValidator } = await import('../../../src/foundation/commands/contract.js');
    const validator = toValidator({
      '~standard': {
        version: 1,
        vendor: 'test',
        validate: (): Promise<never> =>
          Promise.resolve().then(() => {
            throw new Error('inner rejection');
          }),
      },
    } as never);

    const unhandled = await withUnhandledRecorder(() => {
      expect(() => validator.validate([])).toThrow(/Standard Schema validate/);
    });
    expect(unhandled).toEqual([]);
  });
});

describe('shutdown timeout diagnostics', () => {
  const Slow = defineCommandContract<readonly [], void>({ id: 'sample.slow', title: 'Slow' });

  it('names the hosted service and the operation still holding the budget', async () => {
    vi.useFakeTimers();
    try {
      const module = defineModule('sample', (builder): undefined => {
        // Ignores its signal, so the stop hook holds the budget to the end.
        builder.commands.handle(Slow, () => new Promise<void>(() => undefined));
        // Two services, so the report distinguishes the one being stopped from
        // the one that has not been asked yet. Stop order is reverse, so the
        // stuck one goes first and the first one never gets its turn.
        builder.hostedServices.add({ id: 'sample.first', stop: () => undefined });
        builder.hostedServices.add({
          id: 'sample.stuck',
          stop: () => new Promise<void>(() => undefined),
        });
        return undefined;
      });

      const diagnostics: HostDiagnostic[] = [];
      const commands = createFakeCommands();
      const app = createApplication({
        plan: compileApplication({
          name: 'sample',
          modules: [module],
          shutdown: { timeoutMs: 200 },
        }),
        capabilities: { commands, environment: createFakeEnvironment({}) },
        onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
      });
      await app.activate({ subscriptions: [] });

      // Started and never settles: the handler ignores its signal, the way one
      // that forgot to check it would.
      void commands.execute('sample.slow').catch(() => undefined);
      const stopping = app.deactivate();
      await vi.advanceTimersByTimeAsync(250);
      await stopping;

      const timeout = diagnostics.find(
        (diagnostic) => diagnostic.event === 'application.shutdownTimeout'
      );
      expect(timeout?.details).toMatchObject({
        phase: 'stop-hook',
        budgetMs: 200,
        // `started` is what is still up and untouched; the one inside its own
        // `stop` is named separately, because "still running" and "refusing to
        // stop" call for different things from whoever reads this.
        hostedServices: { started: ['sample.first'], stopping: 'sample.stuck' },
        operations: [{ name: 'sample.slow', kind: 'command' }],
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it('forgets an operation once it settles', async () => {
    const Quick = defineCommandContract<readonly [], void>({ id: 'sample.quick', title: 'Quick' });
    const module = defineModule('sample', (builder): undefined => {
      builder.commands.handle(Quick, () => undefined);
      return undefined;
    });
    const commands = createFakeCommands();
    const app = createApplication({
      plan: compileApplication({ name: 'sample', modules: [module] }),
      capabilities: { commands, environment: createFakeEnvironment({}) },
    });
    await app.activate({ subscriptions: [] });

    await commands.execute('sample.quick');

    // Otherwise the tracking map grows for the life of the extension, and a
    // shutdown diagnostic would name every command ever run.
    expect(app.inspect().operations).toEqual([]);
    await app.deactivate();
  });
});
