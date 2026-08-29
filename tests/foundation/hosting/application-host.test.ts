/**
 * Isolated ApplicationHost state-machine and ownership tests. Hooks, scopes and
 * fake timers stand in for an Application; change this suite for lifecycle
 * transitions, rollback, ingress closure, idempotence or shared shutdown-budget
 * semantics, not for Module binding details.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createApplicationHost,
  type HostDiagnostic,
} from '../../../src/foundation/hosting/application-host.js';
import { InvalidHostStateError } from '../../../src/foundation/internal/errors.js';
import { OperationCancelledError } from '../../../src/foundation/operations/cancellation.js';

const recorder = (): { events: string[]; onDiagnostic: (d: HostDiagnostic) => void } => {
  const events: string[] = [];
  return { events, onDiagnostic: (diagnostic) => events.push(diagnostic.event) };
};

/** Keeps whole diagnostics, for the assertions that are about the details. */
const detailed = (): { entries: HostDiagnostic[]; onDiagnostic: (d: HostDiagnostic) => void } => {
  const entries: HostDiagnostic[] = [];
  return { entries, onDiagnostic: (diagnostic) => entries.push(diagnostic) };
};

afterEach(() => {
  vi.useRealTimers();
});

describe('createApplicationHost', () => {
  describe('start', () => {
    it('moves new -> starting -> running', async () => {
      const { events, onDiagnostic } = recorder();
      const host = createApplicationHost({ name: 'app', onDiagnostic });

      expect(host.state).toBe('new');
      expect(host.acceptingWork).toBe(false);

      await host.start();

      expect(host.state).toBe('running');
      expect(host.acceptingWork).toBe(true);
      expect(events).toEqual(['application.starting', 'application.running']);
    });

    it('hands the start hook its scopes and the root signal', async () => {
      const seen: { registrations?: string; resources?: string; aborted?: boolean } = {};
      const host = createApplicationHost({
        name: 'app',
        start({ registrations, resources, signal }) {
          seen.registrations = registrations.name;
          seen.resources = resources.name;
          seen.aborted = signal.aborted;
        },
      });

      await host.start();

      expect(seen.registrations).toBe('app#registrations');
      expect(seen.resources).toBe('app#resources');
      expect(seen.aborted).toBe(false);
    });

    it('is single-flight: concurrent calls share one promise and run the hook once', async () => {
      const hook = vi.fn();
      const host = createApplicationHost({ name: 'app', start: hook });

      const first = host.start();
      const second = host.start();

      expect(first).toBe(second);
      await Promise.all([first, second]);
      expect(hook).toHaveBeenCalledTimes(1);
    });

    it('rejects when the host has already stopped', async () => {
      const host = createApplicationHost({ name: 'app' });
      await host.start();
      await host.stop('manual');

      await expect(host.start()).rejects.toBeInstanceOf(InvalidHostStateError);
    });

    it('rejects once stopping has begun', async () => {
      const host = createApplicationHost({ name: 'app' });
      await host.start();
      host.beginStop('context-disposed');

      await expect(host.start()).rejects.toBeInstanceOf(InvalidHostStateError);
    });

    it('rejects after a failed activation instead of replaying the rejection', async () => {
      const host = createApplicationHost({
        name: 'app',
        start() {
          throw new Error('boom');
        },
      });
      await expect(host.start()).rejects.toThrow('boom');

      await expect(host.start()).rejects.toBeInstanceOf(InvalidHostStateError);
    });
  });

  describe('activation failure', () => {
    it('rolls back framework-owned registrations and resources, then rethrows', async () => {
      const disposedRegistration = vi.fn();
      const disposedResource = vi.fn();
      const failure = new Error('binding failed');
      const { events, onDiagnostic } = recorder();

      const host = createApplicationHost({
        name: 'app',
        onDiagnostic,
        start({ registrations, resources }) {
          registrations.own({ dispose: disposedRegistration });
          resources.deferAsync(async () => {
            await Promise.resolve();
            disposedResource();
          });
          throw failure;
        },
      });

      await expect(host.start()).rejects.toBe(failure);

      expect(host.state).toBe('failed');
      expect(disposedRegistration).toHaveBeenCalledTimes(1);
      expect(disposedResource).toHaveBeenCalledTimes(1);
      // The activation-rollback gate: nothing framework-owned survives.
      expect(host.registrationCount).toBe(0);
      expect(host.resourceCount).toBe(0);
      expect(events).toEqual(['application.starting', 'application.failed']);
    });

    it('reports rollback failures without losing the original error', async () => {
      const failure = new Error('binding failed');
      const { events, onDiagnostic } = recorder();

      const host = createApplicationHost({
        name: 'app',
        onDiagnostic,
        start({ registrations }) {
          registrations.own({
            dispose: () => {
              throw new Error('cleanup also failed');
            },
          });
          throw failure;
        },
      });

      await expect(host.start()).rejects.toBe(failure);
      expect(events).toContain('application.cleanupFailed');
      expect(host.state).toBe('failed');
    });

    it('does not run the stop pipeline again for a failed host', async () => {
      const stopHook = vi.fn();
      const host = createApplicationHost({
        name: 'app',
        stop: stopHook,
        start() {
          throw new Error('boom');
        },
      });

      await expect(host.start()).rejects.toThrow('boom');
      await host.stop('deactivate');

      expect(stopHook).not.toHaveBeenCalled();
      expect(host.state).toBe('failed');
    });
  });

  describe('beginStop', () => {
    it('synchronously closes ingress and aborts the root signal', async () => {
      const registrationDisposed = vi.fn();
      let rootSignal: AbortSignal | undefined;

      const host = createApplicationHost({
        name: 'app',
        start({ registrations, signal }) {
          registrations.own({ dispose: registrationDisposed });
          rootSignal = signal;
        },
      });
      await host.start();

      host.beginStop('context-disposed');

      expect(host.state).toBe('stopping');
      expect(host.acceptingWork).toBe(false);
      expect(registrationDisposed).toHaveBeenCalledTimes(1);
      expect(rootSignal?.aborted).toBe(true);
      expect(rootSignal?.reason).toBeInstanceOf(OperationCancelledError);
    });

    it('never throws, even when a registration fails to dispose', async () => {
      const { events, onDiagnostic } = recorder();
      const host = createApplicationHost({
        name: 'app',
        onDiagnostic,
        start({ registrations }) {
          registrations.own({
            dispose: () => {
              throw new Error('dispose failed');
            },
          });
        },
      });
      await host.start();

      expect(() => host.beginStop('deactivate')).not.toThrow();
      expect(events).toContain('application.cleanupFailed');
    });

    it('is safe as the context.subscriptions failsafe firing while stop is pending', async () => {
      // The failsafe and deactivate() may request stop concurrently, including
      // while the stop hook is pending. Correctness cannot depend on ordering.
      const { events, onDiagnostic } = recorder();
      let releaseStopHook: () => void = () => undefined;
      const stopHookRan = vi.fn();
      const host = createApplicationHost({
        name: 'app',
        onDiagnostic,
        stop: async () => {
          stopHookRan();
          await new Promise<void>((resolve) => {
            releaseStopHook = resolve;
          });
        },
      });
      await host.start();

      const stopping = host.stop('deactivate');
      // Exercise the mid-flight interleaving explicitly.
      host.beginStop('context-disposed');
      releaseStopHook();
      await stopping;

      expect(host.state).toBe('stopped');
      expect(stopHookRan).toHaveBeenCalledTimes(1);
      // The pipeline ran exactly once: one stopping, one stopped, and the
      // reason stays the one that started the stop.
      expect(events.filter((event) => event === 'application.stopping')).toHaveLength(1);
      expect(events.filter((event) => event === 'application.stopped')).toHaveLength(1);

      // And a late fire (after stop settled) stays a no-op too.
      const afterStop = [...events];
      host.beginStop('context-disposed');
      expect(events).toEqual(afterStop);
    });

    it('is idempotent', async () => {
      const host = createApplicationHost({ name: 'app' });
      await host.start();

      host.beginStop('deactivate');
      host.beginStop('deactivate');

      expect(host.state).toBe('stopping');
    });
  });

  describe('stop', () => {
    it('disposes registrations before resources and settles in stopped', async () => {
      const order: string[] = [];
      const host = createApplicationHost({
        name: 'app',
        start({ registrations, resources }) {
          registrations.own({ dispose: () => order.push('registration') });
          resources.deferAsync(async () => {
            await Promise.resolve();
            order.push('resource');
          });
        },
        stop: () => {
          order.push('stop-hook');
        },
      });
      await host.start();

      await host.stop('deactivate');

      expect(order).toEqual(['registration', 'stop-hook', 'resource']);
      expect(host.state).toBe('stopped');
    });

    it('is idempotent: repeated calls share one promise and clean up once', async () => {
      const cleanup = vi.fn();
      const host = createApplicationHost({
        name: 'app',
        start({ resources }) {
          resources.defer(cleanup);
        },
      });
      await host.start();

      const first = host.stop('deactivate');
      const second = host.stop('context-disposed');

      expect(first).toBe(second);
      await Promise.all([first, second]);
      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('never rejects when cleanup fails, so deactivate cannot fail', async () => {
      const { events, onDiagnostic } = recorder();
      const host = createApplicationHost({
        name: 'app',
        onDiagnostic,
        start({ resources }) {
          resources.deferAsync(async () => {
            await Promise.resolve();
            throw new Error('flush failed');
          });
        },
      });
      await host.start();

      await expect(host.stop('deactivate')).resolves.toBeUndefined();
      expect(events).toContain('application.cleanupFailed');
      expect(host.state).toBe('stopped');
    });

    it('stops a host that was never started without running the stop hook', async () => {
      const stopHook = vi.fn();
      const { events, onDiagnostic } = recorder();
      const host = createApplicationHost({ name: 'app', stop: stopHook, onDiagnostic });

      await host.stop('deactivate');

      expect(host.state).toBe('stopped');
      expect(stopHook).not.toHaveBeenCalled();
      expect(events).toEqual(['application.stopping', 'application.stopped']);
    });

    it('gives the stop hook the remaining budget', async () => {
      let remaining = -1;
      const host = createApplicationHost({
        name: 'app',
        shutdownTimeoutMs: 5_000,
        stop: ({ deadlineMs, remainingMs }) => {
          remaining = remainingMs();
          expect(deadlineMs).toBe(5_000);
        },
      });
      await host.start();

      await host.stop('manual');

      expect(remaining).toBeGreaterThan(0);
      expect(remaining).toBeLessThanOrEqual(5_000);
    });
  });

  describe('stop requested during start', () => {
    it('aborts the root signal, rejects start, and never commits to running', async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const committed = vi.fn();
      const { events, onDiagnostic } = recorder();

      const host = createApplicationHost({
        name: 'app',
        onDiagnostic,
        async start({ registrations }) {
          registrations.own({ dispose: committed });
          await gate;
        },
      });

      const starting = host.start();
      const startAssertion = expect(starting).rejects.toBeInstanceOf(OperationCancelledError);

      const stopping = host.stop('deactivate');
      release?.();

      await startAssertion;
      await stopping;

      expect(host.state).toBe('stopped');
      expect(committed).toHaveBeenCalledTimes(1);
      expect(host.registrationCount).toBe(0);
      expect(events).not.toContain('application.running');
      expect(events).toContain('application.stopped');
    });
  });

  describe('shutdown budget', () => {
    it('stops waiting once the budget is exhausted', async () => {
      vi.useFakeTimers();
      const { events, onDiagnostic } = recorder();
      const host = createApplicationHost({
        name: 'app',
        shutdownTimeoutMs: 1_000,
        onDiagnostic,
        // A stop hook that ignores the deadline must not hang deactivation.
        stop: () => new Promise<void>(() => undefined),
      });
      await host.start();

      const stopping = host.stop('deactivate');
      await vi.advanceTimersByTimeAsync(1_000);
      await stopping;

      expect(events).toContain('application.shutdownTimeout');
      expect(host.state).toBe('stopped');
    });

    it('says which phase, how long it waited, and what was still held', async () => {
      vi.useFakeTimers();
      const { entries, onDiagnostic } = detailed();
      const host = createApplicationHost({
        name: 'app',
        shutdownTimeoutMs: 1_000,
        onDiagnostic,
        // The Host owns scopes and a deadline; only the application can name a
        // hosted service, so that half of the answer is supplied.
        describeRemaining: () => ({ hostedServices: { stopping: 'projects.index' } }),
        start: ({ resources }) => {
          resources.attach(resources.detachedChild('projects'));
        },
        stop: () => new Promise<void>(() => undefined),
      });
      await host.start();

      const stopping = host.stop('deactivate');
      await vi.advanceTimersByTimeAsync(1_000);
      await stopping;

      const timeout = entries.find((entry) => entry.event === 'application.shutdownTimeout');
      expect(timeout?.details).toMatchObject({
        phase: 'stop-hook',
        budgetMs: 1_000,
        hostedServices: { stopping: 'projects.index' },
        resources: { name: 'app#resources', children: [{ name: 'app#resources/projects' }] },
      });
      expect(timeout?.details?.['elapsedMs']).toBeGreaterThanOrEqual(1_000);
    });

    it('still stops when describeRemaining throws', async () => {
      vi.useFakeTimers();
      const { events, onDiagnostic } = recorder();
      const host = createApplicationHost({
        name: 'app',
        shutdownTimeoutMs: 1_000,
        onDiagnostic,
        describeRemaining: () => {
          throw new Error('describe failed');
        },
        stop: () => new Promise<void>(() => undefined),
      });
      await host.start();

      const stopping = host.stop('deactivate');
      await vi.advanceTimersByTimeAsync(1_000);
      await stopping;

      // The explanation failed; the stop pipeline it was explaining did not.
      expect(events).toContain('application.shutdownTimeout');
      expect(host.state).toBe('stopped');
    });
  });

  describe('inspect', () => {
    it('reports the scope tree, and nothing before start', async () => {
      const host = createApplicationHost({
        name: 'app',
        start: ({ registrations }) => {
          registrations.own({ dispose: () => undefined });
          registrations.attach(registrations.detachedChild('projects'));
        },
      });

      expect(host.inspect()).toEqual({
        state: 'new',
        registrations: undefined,
        resources: undefined,
      });

      await host.start();

      expect(host.inspect()).toMatchObject({
        state: 'running',
        registrations: {
          name: 'app#registrations',
          size: 2,
          children: [{ name: 'app#registrations/projects', size: 0, children: [] }],
        },
      });

      await host.stop('manual');

      expect(host.inspect()).toMatchObject({ state: 'stopped', registrations: { size: 0 } });
    });
  });

  it('survives a diagnostic listener that throws', async () => {
    const host = createApplicationHost({
      name: 'app',
      onDiagnostic: () => {
        throw new Error('observer failed');
      },
    });

    await expect(host.start()).resolves.toBeUndefined();
    await expect(host.stop('manual')).resolves.toBeUndefined();
    expect(host.state).toBe('stopped');
  });
});
