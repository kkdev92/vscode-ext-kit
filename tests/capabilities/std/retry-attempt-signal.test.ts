/**
 * Focused lifecycle regression suite for the signal owned by each retry
 * attempt. It protects timeout/supersession aborts and listener detachment,
 * which broad retry outcome tests cannot observe. Failures imply overlapping
 * cooperative work or a leaked listener on the outer operation signal.
 */
import { describe, expect, it, vi } from 'vitest';

import { retry } from '../../../src/capabilities/std/retry.js';

describe('retry attempt signals', () => {
  it('gives a timed-out attempt a signal that aborts, so its work can stop', async () => {
    // The attempt must observe the timeout-derived signal, not only an optional
    // outer signal. Otherwise timed-out cooperative work can overlap the next
    // attempt under the same retry call.
    const timeline: string[] = [];
    let firstSignal: AbortSignal | undefined;

    await expect(
      retry(
        async ({ attempt, signal }) => {
          if (attempt === 1) {
            firstSignal = signal;
          }
          timeline.push(`start#${attempt}`);
          await new Promise((resolve) => setTimeout(resolve, 60));
          timeline.push(`finish#${attempt} aborted=${String(signal.aborted)}`);
          throw new Error('always fails');
        },
        { maxAttempts: 2, timeoutMs: 15, delay: 1, jitter: 'none' }
      )
    ).rejects.toThrow(/Failed after 2 attempt/);

    expect(firstSignal?.aborted).toBe(true);
    // Both attempts observed their own abort rather than running unaware.
    await new Promise((resolve) => setTimeout(resolve, 120));
    expect(timeline).toEqual([
      'start#1',
      'start#2',
      'finish#1 aborted=true',
      'finish#2 aborted=true',
    ]);
  });

  it('always provides a signal, even with no timeout and no outer signal', async () => {
    let seen: AbortSignal | undefined;
    await expect(
      retry(
        ({ signal }) => {
          seen = signal;
          return Promise.resolve('done');
        },
        { maxAttempts: 1 }
      )
    ).resolves.toBe('done');

    // `fn` should never have to check whether a signal exists.
    expect(seen).toBeInstanceOf(AbortSignal);
    expect(seen?.aborted).toBe(false);
  });

  it('aborts a superseded attempt before the next one starts', async () => {
    const abortedAt: number[] = [];
    let attempts = 0;

    await expect(
      retry(
        ({ attempt, signal }) => {
          attempts = attempt;
          signal.addEventListener('abort', () => abortedAt.push(attempt));
          return Promise.reject(new Error('fail'));
        },
        { maxAttempts: 3, delay: 1, jitter: 'none' }
      )
    ).rejects.toThrow(/Failed after 3 attempt/);

    expect(attempts).toBe(3);
    // Attempts 1 and 2 were told to stop; the last one carries the failure out.
    expect(abortedAt).toEqual([1, 2]);
  });

  it('does not accumulate listeners on a long-lived outer signal', async () => {
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, 'addEventListener');
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');

    await expect(
      retry(() => Promise.reject(new Error('fail')), {
        maxAttempts: 4,
        delay: 1,
        jitter: 'none',
        signal: controller.signal,
      })
    ).rejects.toThrow(/Failed after 4 attempt/);

    // Every attempt (and every inter-attempt wait) detaches what it attached.
    expect(removeSpy.mock.calls.length).toBeGreaterThanOrEqual(addSpy.mock.calls.length);
  });
});
