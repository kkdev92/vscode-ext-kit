/**
 * Fake-timer unit suite for debounce/throttle, timeout/timing, and retry policy.
 * It protects edge timing, cancellation, error identity/history, and logging
 * without involving an application host. A failure should be analyzed as a
 * timer-state or retry-policy regression; per-attempt signal ownership has its
 * focused companion suite.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createLogger } from '../../../src/foundation/logging/logger.js';
import type { LogEntry } from '../../../src/foundation/logging/logger.js';
import { RetryExhaustedError, retry } from '../../../src/capabilities/std/retry.js';
import {
  TimeoutError,
  debounce,
  measureTime,
  throttle,
  withTimeout,
  withTiming,
} from '../../../src/capabilities/std/timing.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('debounce', () => {
  it('runs once on the trailing edge after activity stops', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    debounced();
    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('passes the most recent arguments', () => {
    vi.useFakeTimers();
    const fn = vi.fn<(value: string) => void>();
    const debounced = debounce(fn, 100);

    debounced('first');
    debounced('last');
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledExactlyOnceWith('last');
  });

  it('can run on the leading edge instead', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100, { leading: true, trailing: false });

    debounced();
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('forces progress at maxWait under continuous calls', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100, { maxWait: 250 });

    // Without maxWait this pattern would never invoke.
    for (let elapsed = 0; elapsed < 400; elapsed += 50) {
      debounced();
      vi.advanceTimersByTime(50);
    }

    expect(fn.mock.calls.length).toBeGreaterThan(0);
  });

  /**
   * The maxWait branch replaces the pending timer. Overwriting the handle
   * without clearing it leaves the old one armed, and it fires a trailing
   * invocation nobody asked for — one per forced call, so a long stream of
   * input ends with a burst.
   */
  it('leaves no timer behind when maxWait forces an invocation', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100, { maxWait: 250 });

    for (let elapsed = 0; elapsed < 1000; elapsed += 50) {
      debounced();
      vi.advanceTimersByTime(50);
    }
    debounced.cancel();
    const forced = fn.mock.calls.length;

    // Nothing is owed: cancel() cleared the one live timer, and no orphan is
    // waiting to fire after the caller said stop.
    vi.advanceTimersByTime(10_000);
    expect(fn.mock.calls.length).toBe(forced);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels, flushes and reports pending', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(debounced.pending()).toBe(true);
    debounced.cancel();
    expect(debounced.pending()).toBe(false);
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();

    debounced();
    debounced.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(debounced.pending()).toBe(false);
  });

  it('flush on an idle debouncer does nothing', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    debounce(fn, 100).flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it('cancels when the signal aborts', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const controller = new AbortController();
    const debounced = debounce(fn, 100, { signal: controller.signal });

    debounced();
    controller.abort();
    vi.advanceTimersByTime(100);

    expect(fn).not.toHaveBeenCalled();
  });

  it('is inert when given an already-aborted signal', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const controller = new AbortController();
    controller.abort();

    const debounced = debounce(fn, 100, { signal: controller.signal });
    debounced();
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(0);
  });

  it('stays inert for calls that arrive after the signal aborts', () => {
    // Cancelling only the pending call is not enough: an event arriving after teardown
    // could still run the handler. The signal is normally a scope's, so that is
    // a real post-teardown invocation.
    vi.useFakeTimers();
    const fn = vi.fn();
    const controller = new AbortController();
    const debounced = debounce(fn, 100, { signal: controller.signal });

    debounced();
    controller.abort();
    debounced();
    vi.advanceTimersByTime(500);

    expect(fn).not.toHaveBeenCalled();
  });
});

describe('throttle', () => {
  it('runs immediately then rate-limits', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).toHaveBeenCalledTimes(1);

    throttled();
    throttled();
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('can skip the leading call', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const throttled = throttle(fn, 100, { leading: false });

    throttled();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('withTimeout', () => {
  it('resolves when the work finishes in time', async () => {
    await expect(withTimeout(Promise.resolve(7), 1000)).resolves.toBe(7);
  });

  it('rejects with TimeoutError when the budget elapses', async () => {
    vi.useFakeTimers();
    const pending = withTimeout(new Promise<number>(() => undefined), 100);
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);

    await vi.advanceTimersByTimeAsync(100);
    await assertion;
  });

  it('gives a function-form operation a signal that aborts on timeout', async () => {
    vi.useFakeTimers();
    let observed: AbortSignal | undefined;
    const pending = withTimeout((signal) => {
      observed = signal;
      return new Promise<number>(() => undefined);
    }, 100);
    const assertion = expect(pending).rejects.toBeInstanceOf(TimeoutError);

    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(observed?.aborted).toBe(true);
  });

  it('rejects with the external reason when that aborts first', async () => {
    const controller = new AbortController();
    const reason = new Error('caller gave up');
    const pending = withTimeout(new Promise<number>(() => undefined), 10_000, {
      signal: controller.signal,
    });

    controller.abort(reason);

    await expect(pending).rejects.toBe(reason);
  });

  it('throws immediately, without an unhandled rejection, for an aborted signal', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already gone'));

    // The promise argument was already created by the caller, so withTimeout has
    // to claim its rejection rather than leave it orphaned.
    const orphan = Promise.reject(new Error('would be unhandled'));
    await expect(withTimeout(orphan, 1000, { signal: controller.signal })).rejects.toThrow(
      'already gone'
    );
  });
});

describe('withTiming', () => {
  const capture = (): { entries: LogEntry[]; logger: ReturnType<typeof createLogger> } => {
    const entries: LogEntry[] = [];
    return { entries, logger: createLogger((entry) => entries.push(entry)) };
  };

  it('returns the result and a duration', async () => {
    const { result, duration } = await withTiming('work', () => 42);
    expect(result).toBe(42);
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('logs at debug by default and at info on request', async () => {
    const first = capture();
    await withTiming('work', () => 1, { logger: first.logger });
    expect(first.entries[0]?.level).toBe('debug');

    const second = capture();
    await withTiming('work', () => 1, { logger: second.logger, logLevel: 'info' });
    expect(second.entries[0]?.level).toBe('info');
  });

  it('uses a custom formatter', async () => {
    const { entries, logger } = capture();
    await withTiming('work', () => 1, { logger, formatMessage: (name) => `custom:${name}` });
    expect(entries[0]?.message).toBe('custom:work');
  });

  it('logs a failure and rethrows', async () => {
    const { entries, logger } = capture();
    const failure = new Error('boom');

    await expect(
      withTiming(
        'work',
        () => {
          throw failure;
        },
        { logger }
      )
    ).rejects.toBe(failure);

    expect(entries[0]?.message).toContain('failed after');
  });

  it('measureTime times every call', async () => {
    const timed = measureTime('double', (value: number) => value * 2);
    const { result } = await timed(3);
    expect(result).toBe(6);
  });
});

describe('retry', () => {
  it('returns the first success without waiting', async () => {
    const fn = vi.fn(() => Promise.resolve('ok'));
    await expect(retry(fn)).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until it succeeds', async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const pending = retry(
      () => {
        attempts += 1;
        return attempts < 3 ? Promise.reject(new Error('flaky')) : Promise.resolve(attempts);
      },
      { delay: 100, jitter: 'none' }
    );

    await vi.advanceTimersByTimeAsync(1000);
    await expect(pending).resolves.toBe(3);
  });

  it('reports the whole history and the triggering cause when exhausted', async () => {
    vi.useFakeTimers();
    const pending = retry(() => Promise.reject(new Error('always')), {
      maxAttempts: 3,
      delay: 10,
      jitter: 'none',
    });
    const assertion = pending.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1000);
    const error = await assertion;

    expect(error).toBeInstanceOf(RetryExhaustedError);
    const exhausted = error as RetryExhaustedError;
    expect(exhausted.attempts).toBe(3);
    expect(exhausted.history).toHaveLength(3);
    expect(exhausted.cause).toBe(exhausted.history[2]);
  });

  it('stops early when retryIf declines', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('fatal')));

    await expect(retry(fn, { retryIf: () => false })).rejects.toBeInstanceOf(RetryExhaustedError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('rejects a maxAttempts below 1', async () => {
    await expect(retry(() => Promise.resolve(1), { maxAttempts: 0 })).rejects.toBeInstanceOf(
      RangeError
    );
  });

  it('uses exponential backoff by default and linear on request', async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const options = {
      maxAttempts: 4,
      delay: 100,
      jitter: 'none',
      onRetry: (_error: unknown, _attempt: number, delay: number) => delays.push(delay),
    } as const;

    const exponential = retry(() => Promise.reject(new Error('x')), options).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10_000);
    await exponential;
    expect(delays).toEqual([100, 200, 400]);

    delays.length = 0;
    const linear = retry(() => Promise.reject(new Error('x')), {
      ...options,
      backoff: 'linear',
    }).catch(() => undefined);
    await vi.advanceTimersByTimeAsync(10_000);
    await linear;
    expect(delays).toEqual([100, 100, 100]);
  });

  it('caps the delay at maxDelay', async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const pending = retry(() => Promise.reject(new Error('x')), {
      maxAttempts: 4,
      delay: 100,
      maxDelay: 150,
      jitter: 'none',
      onRetry: (_error, _attempt, delay) => delays.push(delay),
    }).catch(() => undefined);

    await vi.advanceTimersByTimeAsync(10_000);
    await pending;

    expect(delays).toEqual([100, 150, 150]);
  });

  it('keeps jittered delays within the capped bound', async () => {
    vi.useFakeTimers();
    const delays: number[] = [];
    const pending = retry(() => Promise.reject(new Error('x')), {
      maxAttempts: 4,
      delay: 100,
      maxDelay: 100,
      jitter: 'equal',
      onRetry: (_error, _attempt, delay) => delays.push(delay),
    }).catch(() => undefined);

    await vi.advanceTimersByTimeAsync(10_000);
    await pending;

    for (const delay of delays) {
      expect(delay).toBeGreaterThanOrEqual(50);
      expect(delay).toBeLessThanOrEqual(100);
    }
  });

  it('aborts the loop and gives each attempt a signal that follows the outer one', async () => {
    const controller = new AbortController();
    let seen: AbortSignal | undefined;

    const pending = retry(
      ({ signal }) => {
        seen = signal;
        controller.abort(new Error('stop now'));
        return Promise.reject(new Error('attempt failed'));
      },
      { delay: 1, jitter: 'none', signal: controller.signal }
    );

    await expect(pending).rejects.toThrow('stop now');
    // A *derived* signal, not the outer one: it also has to carry this
    // attempt's own timeout, so identity is deliberately not the contract.
    expect(seen).toBeDefined();
    expect(seen?.aborted).toBe(true);
  });

  it('refuses to start when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn(() => Promise.resolve(1));

    await expect(retry(fn, { signal: controller.signal })).rejects.toBeDefined();
    expect(fn).not.toHaveBeenCalled();
  });

  it('applies a per-attempt timeout', async () => {
    vi.useFakeTimers();
    const pending = retry(() => new Promise<number>(() => undefined), {
      maxAttempts: 2,
      delay: 10,
      jitter: 'none',
      timeoutMs: 50,
    }).catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(1000);
    const error = await pending;

    expect(error).toBeInstanceOf(RetryExhaustedError);
    expect((error as RetryExhaustedError).history[0]).toBeInstanceOf(TimeoutError);
  });
});
