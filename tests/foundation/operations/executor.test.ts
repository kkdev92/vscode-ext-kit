/**
 * Low-level `runOperation` tests using in-memory scopes, a real service
 * container and fake timers. This suite owns combined cancellation, diagnostics
 * isolation, per-Operation cleanup and stale-resolver guards; command binding
 * is tested separately.
 */
import { describe, expect, it, vi } from 'vitest';

import { createLogger } from '../../../src/foundation/logging/logger.js';
import { OperationKind } from '../../../src/foundation/operations/context.js';
import { runOperation } from '../../../src/foundation/operations/executor.js';
import { createResourceScope } from '../../../src/foundation/resources/resource-scope.js';
import { createServiceContainer } from '../../../src/foundation/services/container.js';

function harness() {
  const controller = new AbortController();
  const resources = createResourceScope('test', { signal: controller.signal });
  const services = createServiceContainer({ descriptors: [], resources });
  const entries: string[] = [];
  const logger = createLogger((entry) => entries.push(`${entry.level}:${entry.message}`));
  return { controller, resources, services, logger, entries };
}

describe('runOperation options', () => {
  it('aborts the operation signal when the caller signal fires', async () => {
    const { controller, resources, services, logger } = harness();
    const caller = new AbortController();

    const observed = await runOperation(
      {
        kind: OperationKind.Command,
        name: 'sample.caller',
        applicationSignal: controller.signal,
        parentResources: resources,
        logger,
        services,
        callerSignal: caller.signal,
      },
      async (context) => {
        expect(context.signal.aborted).toBe(false);
        caller.abort(new Error('caller gave up'));
        await Promise.resolve();
        return context.signal.aborted;
      }
    );
    expect(observed).toBe(true);
  });

  it('aborts with a timeout reason once timeoutMs elapses, and clears the timer', async () => {
    vi.useFakeTimers();
    try {
      const { controller, resources, services, logger } = harness();

      const pending = runOperation(
        {
          kind: OperationKind.Command,
          name: 'sample.slow',
          applicationSignal: controller.signal,
          parentResources: resources,
          logger,
          services,
          timeoutMs: 50,
        },
        (context) =>
          new Promise((_resolve, reject) => {
            context.signal.addEventListener('abort', () => {
              reject(
                context.signal.reason instanceof Error
                  ? context.signal.reason
                  : new Error('aborted')
              );
            });
          })
      );
      const settled = expect(pending).rejects.toThrow(/timeout/);
      await vi.advanceTimersByTimeAsync(60);
      await settled;
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs each watcher-style operation under its declared kind', async () => {
    const { controller, resources, services, logger } = harness();
    const events: string[] = [];

    await runOperation(
      {
        kind: OperationKind.FileWatcher,
        name: 'fileWatcher:project-files',
        applicationSignal: controller.signal,
        parentResources: resources,
        logger,
        services,
        onDiagnostic: (event, details) =>
          events.push(
            `${event}:${typeof details['operationKind'] === 'string' ? details['operationKind'] : ''}`
          ),
      },
      (context) => {
        expect(context.kind).toBe('file-watcher');
        expect(context.id.startsWith('file-watcher:')).toBe(true);
        return undefined;
      }
    );
    expect(events.some((entry) => entry.startsWith('operation.started'))).toBe(true);
  });

  it('a throwing diagnostics observer neither prevents the work nor the cleanup', async () => {
    const { controller, resources, services, logger } = harness();
    const cleaned = vi.fn();

    const result = await runOperation(
      {
        kind: OperationKind.Command,
        name: 'sample.observed',
        applicationSignal: controller.signal,
        parentResources: resources,
        logger,
        services,
        onDiagnostic: () => {
          throw new Error('observer exploded');
        },
      },
      (context) => {
        context.resources.defer(cleaned);
        return 'worked';
      }
    );

    expect(result).toBe('worked');
    expect(cleaned).toHaveBeenCalledTimes(1);
    // The parent scope holds nothing: the operation scope settled and detached.
    expect(resources.size).toBe(0);
  });
});

describe('disposed container guard', () => {
  it('refuses to mint singletons after dispose, from any resolver', async () => {
    const { serviceToken } = await import('../../../src/foundation/services/token.js');
    const Token = serviceToken<{ disposed: boolean; dispose(): void }>('demo.guarded');
    const controller = new AbortController();
    const resources = createResourceScope('root', { signal: controller.signal });

    let created = 0;
    const container = createServiceContainer({
      descriptors: [
        {
          token: Token,
          lifetime: 'singleton',
          dependencies: {},
          create: () => {
            created += 1;
            const instance = {
              disposed: false,
              dispose(): void {
                instance.disposed = true;
              },
            };
            return instance;
          },
          moduleId: 'test',
        } as never,
      ],
      resources,
    });

    const staleResolver = container.createResolver(resources);
    const first = container.get(Token);
    await container.dispose();
    expect(first.disposed).toBe(true);

    expect(() => container.get(Token)).toThrow(/disposed/);
    expect(() => staleResolver.get(Token)).toThrow(/disposed/);
    expect(created).toBe(1);

    // Second dispose stays the same settled promise.
    await expect(container.dispose()).resolves.toBeUndefined();
  });
});
