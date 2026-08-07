/**
 * OperationProgress step orchestration against the fake progress capability.
 * The suite defines sequencing, weighted reporting, typed result accumulation
 * and cancellation-as-data; adapter rendering is outside this layer.
 */
import { describe, expect, it } from 'vitest';

import { createOperationProgress } from '../../../src/foundation/operations/progress.js';
import { createFakeProgress } from '../../../src/testing/fakes/fake-ui.js';

/**
 * Weighted multi-step progress.
 *
 * The part worth pinning is that cancellation comes back as a *value* —
 * `{ cancelled: true }` with whatever finished — rather than as a thrown error.
 * A caller then branches on one thing instead of on a flag *and* a try/catch,
 * and the results gathered before the user gave up are still there to use.
 */
const never = (): AbortSignal => new AbortController().signal;

describe('progress.steps', () => {
  it('runs steps in order and returns a typed tuple', async () => {
    const capability = createFakeProgress();
    const progress = createOperationProgress(capability, never());
    const order: string[] = [];

    const outcome = await progress.steps(
      { title: 'Deploying' },
      {
        label: 'Building',
        run: () => {
          order.push('build');
          return 7;
        },
      },
      {
        label: 'Publishing',
        run: () => {
          order.push('publish');
          return 'done';
        },
      }
    );

    expect(order).toEqual(['build', 'publish']);
    expect(outcome).toEqual({ completed: true, cancelled: false, results: [7, 'done'] });
    // Destructuring keeps the per-step types, which is why steps are rest args.
    const [built, published]: [number, string] = outcome.results;
    expect(built + published.length).toBe(11);
  });

  it('advances the bar by each step weight and settles at exactly 100', async () => {
    const capability = createFakeProgress();
    const progress = createOperationProgress(capability, never());

    await progress.steps(
      { title: 'Deploying' },
      { label: 'Building', run: () => undefined, weight: 3 },
      { label: 'Publishing', run: () => undefined }
    );

    const increments = capability.runs[0]?.reports
      .map((report) => report.increment)
      .filter((increment): increment is number => increment !== undefined);
    expect(increments).toEqual([75, 25]);
    // Float error across per-step increments would otherwise leave a completed
    // run sitting at 99%.
    expect(increments?.reduce((sum, value) => sum + value, 0)).toBe(100);
  });

  it('reports each step label before running it', async () => {
    const capability = createFakeProgress();
    const progress = createOperationProgress(capability, never());

    await progress.steps(
      { title: 'Deploying' },
      { label: 'Building', run: () => undefined },
      { label: 'Publishing', run: () => undefined }
    );

    expect(
      capability.runs[0]?.reports
        .map((report) => report.message)
        .filter((message): message is string => message !== undefined)
    ).toEqual(['Building', 'Publishing']);
  });

  it('stops between steps when the signal aborts, returning what it has', async () => {
    const capability = createFakeProgress();
    const controller = new AbortController();
    const progress = createOperationProgress(capability, controller.signal);
    const ran: string[] = [];

    const outcome = await progress.steps(
      { title: 'Deploying' },
      {
        label: 'Building',
        run: () => {
          ran.push('build');
          controller.abort();
          return 1;
        },
      },
      {
        label: 'Publishing',
        run: () => {
          ran.push('publish');
          return 2;
        },
      }
    );

    expect(ran).toEqual(['build']);
    expect(outcome).toEqual({ completed: false, cancelled: true, results: [1] });
  });

  it('treats a step rejecting after cancellation as cancelled, not failed', async () => {
    const capability = createFakeProgress();
    const controller = new AbortController();
    const progress = createOperationProgress(capability, controller.signal);

    // A caller branches on `cancelled` alone rather than also catching the
    // cancellation rejection from a cooperative step.
    const outcome = await progress.steps(
      { title: 'Deploying' },
      {
        label: 'Building',
        run: (signal) => {
          controller.abort();
          // The step notices its own cancellation and throws, which is the
          // ordinary way cooperative work stops.
          signal.throwIfAborted();
          return 1;
        },
      }
    );

    expect(outcome).toEqual({ completed: false, cancelled: true, results: [] });
  });

  it('propagates a genuine failure', async () => {
    const capability = createFakeProgress();
    const progress = createOperationProgress(capability, never());
    const ran: string[] = [];

    await expect(
      progress.steps(
        { title: 'Deploying' },
        {
          label: 'Building',
          run: () => {
            ran.push('build');
            throw new Error('build failed');
          },
        },
        {
          label: 'Publishing',
          run: () => {
            ran.push('publish');
          },
        }
      )
    ).rejects.toThrow('build failed');

    expect(ran).toEqual(['build']);
  });

  it('gives each step the combined signal', async () => {
    const capability = createFakeProgress();
    const controller = new AbortController();
    const progress = createOperationProgress(capability, controller.signal);
    let seen: AbortSignal | undefined;

    await progress.steps(
      { title: 'Deploying' },
      {
        label: 'Building',
        run: (signal) => {
          seen = signal;
        },
      }
    );

    expect(seen).toBeInstanceOf(AbortSignal);
    // The operation's own cancellation reaches the step, not just the progress
    // UI's cancel button.
    expect(seen?.aborted).toBe(false);
  });

  it('refuses a weight that would make the bar meaningless', () => {
    const progress = createOperationProgress(createFakeProgress(), never());

    for (const weight of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        progress.steps({ title: 'x' }, { label: 'Building', run: () => undefined, weight })
      ).toThrow(TypeError);
    }
  });

  it('runs headless when there is no progress UI', async () => {
    const progress = createOperationProgress(undefined, never());

    const outcome = await progress.steps(
      { title: 'Deploying' },
      {
        label: 'Building',
        run: () => 'ok',
      }
    );

    // A Test Host with no progress capability still runs the work; the reports
    // simply go nowhere.
    expect(outcome).toEqual({ completed: true, cancelled: false, results: ['ok'] });
  });
});
