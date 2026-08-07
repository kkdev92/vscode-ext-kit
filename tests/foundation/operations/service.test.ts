/**
 * Unit tests for the injectable OperationsService outside command ingress.
 * An in-memory Host harness and fake progress port verify it delegates to the
 * same Operation executor, service scope, cancellation and diagnostics path.
 */
import { describe, expect, it } from 'vitest';

import { createLogger } from '../../../src/foundation/logging/logger.js';
import { OperationKind } from '../../../src/foundation/operations/context.js';
import { Operations, createOperationsService } from '../../../src/foundation/operations/service.js';
import { createResourceScope } from '../../../src/foundation/resources/resource-scope.js';
import { createServiceContainer } from '../../../src/foundation/services/container.js';
import { serviceToken } from '../../../src/foundation/services/token.js';
import { createFakeProgress } from '../../../src/testing/fakes/fake-ui.js';

function harness() {
  const controller = new AbortController();
  const resources = createResourceScope('test', { signal: controller.signal });
  const services = createServiceContainer({ descriptors: [], resources });
  const entries: string[] = [];
  const logger = createLogger((entry) => entries.push(`${entry.level}:${entry.message}`));
  return { controller, resources, services, logger, entries };
}

/**
 * Work that begins outside command ingress still needs an OperationContext;
 * this service is the supported entry point for RPC and event callbacks.
 */
describe('OperationsService', () => {
  it('gives the work a real operation context', async () => {
    const { controller, resources, services, logger } = harness();
    const operations = createOperationsService({
      applicationSignal: controller.signal,
      parentResources: resources,
      logger,
      services,
    });

    const seen = await operations.run('reindex', (context) => ({
      kind: context.kind,
      name: context.name,
      aborted: context.signal.aborted,
    }));

    expect(seen).toEqual({ kind: OperationKind.Task, name: 'reindex', aborted: false });
  });

  it('resolves services through the operation', async () => {
    const Token = serviceToken<{ value: number }>('test.value');
    const controller = new AbortController();
    const resources = createResourceScope('test', { signal: controller.signal });
    const services = createServiceContainer({
      descriptors: [
        {
          token: Token,
          lifetime: 'singleton',
          dependencies: {},
          create: () => ({ value: 7 }),
          moduleId: 'test',
        },
      ],
      resources,
    });
    const operations = createOperationsService({
      applicationSignal: controller.signal,
      parentResources: resources,
      logger: createLogger(() => undefined),
      services,
    });

    const value = await operations.run('read', (context) => context.services.get(Token).value);

    expect(value).toBe(7);
  });

  it('reports through the progress capability', async () => {
    const { controller, resources, services, logger } = harness();
    const progress = createFakeProgress();
    const operations = createOperationsService({
      applicationSignal: controller.signal,
      parentResources: resources,
      logger,
      services,
      progress,
    });

    await operations.run('scan', (context) =>
      context.progress.run({ title: 'Scanning' }, () => 'done')
    );

    expect(progress.runs.map((run) => run.title)).toEqual(['Scanning']);
  });

  it('cancels the work when the application stops', async () => {
    const { controller, resources, services, logger } = harness();
    const operations = createOperationsService({
      applicationSignal: controller.signal,
      parentResources: resources,
      logger,
      services,
    });

    const running = operations.run('wait', (context) => {
      controller.abort();
      return context.signal.aborted;
    });

    await expect(running).resolves.toBe(true);
  });

  it('combines the caller signal with the application signal', async () => {
    const { controller, resources, services, logger } = harness();
    const operations = createOperationsService({
      applicationSignal: controller.signal,
      parentResources: resources,
      logger,
      services,
    });
    const caller = new AbortController();

    const seen = await operations.run(
      'wait',
      (context) => {
        caller.abort();
        return context.signal.aborted;
      },
      { signal: caller.signal }
    );

    expect(seen).toBe(true);
  });

  it('lets the result and the rejection through untouched', async () => {
    const { controller, resources, services, logger } = harness();
    const operations = createOperationsService({
      applicationSignal: controller.signal,
      parentResources: resources,
      logger,
      services,
    });

    await expect(operations.run('ok', () => 42)).resolves.toBe(42);
    // The RPC handler that started the work is what has to decide what a
    // failure means, so nothing is swallowed here.
    await expect(
      operations.run('bad', () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
  });

  it('emits operation diagnostics under the task kind', async () => {
    const { controller, resources, services, logger } = harness();
    const events: string[] = [];
    const operations = createOperationsService({
      applicationSignal: controller.signal,
      parentResources: resources,
      logger,
      services,
      onDiagnostic: (event) => events.push(event),
    });

    await operations.run('scan', () => undefined);

    expect(events).toEqual(['operation.started', 'operation.completed']);
  });

  it('is injected under a stable token id', () => {
    expect(Operations.id).toBe('framework.operations');
  });
});
