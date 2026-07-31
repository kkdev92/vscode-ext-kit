import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  debounce,
  throttle,
  withTiming,
  measureTime,
  withTimeout,
  TimeoutError,
} from '../../src/std/timing.js';
import { createMockLogger } from '../factories.js';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should delay function execution', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should reset delay on subsequent calls', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced();
    vi.advanceTimersByTime(50);
    debounced();
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should pass arguments to the function', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('arg1', 'arg2');
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledWith('arg1', 'arg2');
  });

  it('should use latest arguments', () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 100);

    debounced('first');
    vi.advanceTimersByTime(50);
    debounced('second');
    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('second');
  });

  describe('cancel', () => {
    it('should cancel pending execution', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      debounced.cancel();
      vi.advanceTimersByTime(100);

      expect(fn).not.toHaveBeenCalled();
    });

    it('should be safe to call cancel multiple times', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      debounced.cancel();
      debounced.cancel();
      debounced.cancel();

      expect(fn).not.toHaveBeenCalled();
    });

    it('should allow new calls after cancel', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced('first');
      debounced.cancel();
      debounced('second');
      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('second');
    });
  });

  describe('leading', () => {
    it('invokes immediately on the leading edge when enabled', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100, { leading: true, trailing: false });

      debounced('a');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('a');

      // Trailing disabled: a call queued mid-wait must not fire later.
      debounced('b');
      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('invokes on both edges when leading and trailing are enabled', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100, { leading: true, trailing: true });

      debounced('a');
      debounced('b');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('a');

      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith('b');
    });

    it('does not double-invoke for a single call with leading and trailing both enabled', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100, { leading: true, trailing: true });

      debounced('solo');
      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('maxWait', () => {
    it('invokes at least once every maxWait even under continuous calls', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100, { maxWait: 150 });

      debounced('a'); // t=0
      vi.advanceTimersByTime(60);
      debounced('b'); // t=60
      vi.advanceTimersByTime(60);
      debounced('c'); // t=120
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(30); // t=150: maxWait forces a flush
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('c');
    });

    it('does not fire before maxWait if calls stop and the normal wait elapses first', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100, { maxWait: 500 });

      debounced('only');
      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('only');
    });
  });

  describe('flush', () => {
    it('immediately invokes a pending trailing call', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced('a');
      debounced.flush();

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('a');

      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('is a no-op when nothing is pending', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced.flush();

      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('pending', () => {
    it('reports scheduled vs idle state', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      expect(debounced.pending()).toBe(false);

      debounced();
      expect(debounced.pending()).toBe(true);

      vi.advanceTimersByTime(100);
      expect(debounced.pending()).toBe(false);
    });

    it('is false after cancel', () => {
      const fn = vi.fn();
      const debounced = debounce(fn, 100);

      debounced();
      debounced.cancel();

      expect(debounced.pending()).toBe(false);
    });
  });

  describe('signal', () => {
    it('cancels the pending invocation when the signal aborts', () => {
      const fn = vi.fn();
      const controller = new AbortController();
      const debounced = debounce(fn, 100, { signal: controller.signal });

      debounced();
      controller.abort();
      vi.advanceTimersByTime(100);

      expect(fn).not.toHaveBeenCalled();
      expect(debounced.pending()).toBe(false);
    });
  });
});

describe('throttle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should execute immediately on first call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should not execute again within limit', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled();
    throttled();
    throttled();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('should execute trailing call after limit', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');
    throttled('second');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('first');

    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('second');
  });

  it('should use latest arguments for trailing call', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');
    throttled('second');
    throttled('third');

    vi.advanceTimersByTime(100);

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('third');
  });

  it('should allow execution after limit has passed', () => {
    const fn = vi.fn();
    const throttled = throttle(fn, 100);

    throttled('first');
    vi.advanceTimersByTime(100);
    throttled('second');

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenLastCalledWith('second');
  });

  describe('cancel', () => {
    it('should cancel pending trailing execution', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled('first');
      throttled('second');
      throttled.cancel();
      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('first');
    });

    it('should be safe to call cancel multiple times', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled();
      throttled.cancel();
      throttled.cancel();
      throttled.cancel();

      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should allow new calls after cancel', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled('first');
      throttled('second');
      throttled.cancel();
      vi.advanceTimersByTime(100);

      throttled('third');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith('third');
    });
  });

  describe('leading: false', () => {
    it('skips the immediate call and only fires on the trailing edge', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100, { leading: false });

      throttled('a');
      expect(fn).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('a');
    });
  });

  describe('trailing: false', () => {
    it('only fires the leading call and drops queued trailing calls', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100, { trailing: false });

      throttled('a');
      throttled('b');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('a');

      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('flush', () => {
    it('immediately invokes a pending trailing call', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      throttled('first');
      throttled('second');
      throttled.flush();

      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenLastCalledWith('second');

      vi.advanceTimersByTime(100);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('pending', () => {
    it('reports scheduled vs idle state', () => {
      const fn = vi.fn();
      const throttled = throttle(fn, 100);

      expect(throttled.pending()).toBe(false);

      throttled();
      expect(throttled.pending()).toBe(true);

      vi.advanceTimersByTime(100);
      expect(throttled.pending()).toBe(false);
    });
  });

  describe('signal', () => {
    it('cancels the pending trailing invocation when the signal aborts', () => {
      const fn = vi.fn();
      const controller = new AbortController();
      const throttled = throttle(fn, 100, { signal: controller.signal });

      throttled('first');
      throttled('second');
      controller.abort();
      vi.advanceTimersByTime(100);

      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('first');
    });
  });
});

// ============================================
// withTimeout
// ============================================

describe('withTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves with the value when the promise settles before the timeout', async () => {
    const inner = new Promise<string>((resolve) => setTimeout(() => resolve('done'), 50));

    const resultPromise = withTimeout(inner, 100);
    await vi.advanceTimersByTimeAsync(50);

    await expect(resultPromise).resolves.toBe('done');
  });

  it('rejects with a named TimeoutError when the timeout elapses first', async () => {
    const inner = new Promise<string>(() => {
      // Never settles.
    });

    const resultPromise = withTimeout(inner, 100);
    const catchPromise = resultPromise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(100);
    const error = await catchPromise;

    expect(error).toBeInstanceOf(TimeoutError);
    expect((error as Error).name).toBe('TimeoutError');
    expect((error as Error).message).toContain('100ms');
  });

  it('propagates the source promise rejection when it fails before the timeout', async () => {
    const inner = Promise.reject(new Error('boom'));

    await expect(withTimeout(inner, 100)).rejects.toThrow('boom');
  });

  it('passes a combined AbortSignal to a function-shaped operation', async () => {
    let receivedSignal: AbortSignal | undefined;
    const operation = (signal: AbortSignal): Promise<string> => {
      receivedSignal = signal;
      return new Promise((resolve) => setTimeout(() => resolve('ok'), 10));
    };

    const resultPromise = withTimeout(operation, 100);
    await vi.advanceTimersByTimeAsync(10);

    await expect(resultPromise).resolves.toBe('ok');
    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);
  });

  it('aborts the signal passed to a function-shaped operation on timeout', async () => {
    let receivedSignal: AbortSignal | undefined;
    const operation = (signal: AbortSignal): Promise<never> => {
      receivedSignal = signal;
      return new Promise(() => {
        // Never settles; only the signal matters for this test.
      });
    };

    const resultPromise = withTimeout(operation, 50);
    const catchPromise = resultPromise.catch((error: unknown) => error);

    await vi.advanceTimersByTimeAsync(50);
    await catchPromise;

    expect(receivedSignal?.aborted).toBe(true);
    expect(receivedSignal?.reason).toBeInstanceOf(TimeoutError);
  });

  it('rejects immediately if the external signal is already aborted', async () => {
    const controller = new AbortController();
    const reason = new Error('pre-aborted');
    controller.abort(reason);

    await expect(
      withTimeout(Promise.resolve('never'), 100, { signal: controller.signal })
    ).rejects.toBe(reason);
  });

  it('rejects with the external abort reason when it aborts before settling or timing out', async () => {
    const controller = new AbortController();
    const inner = new Promise<string>(() => {
      // Never settles.
    });

    const resultPromise = withTimeout(inner, 10_000, { signal: controller.signal });
    const catchPromise = resultPromise.catch((error: unknown) => error);

    const reason = new Error('cancelled by caller');
    controller.abort(reason);

    expect(await catchPromise).toBe(reason);
  });
});

// ============================================
// withTiming
// ============================================

describe('withTiming', () => {
  it('returns result and duration', async () => {
    const { result, duration } = await withTiming('test', () => 'hello');

    expect(result).toBe('hello');
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('handles async functions', async () => {
    const { result, duration } = await withTiming('test', async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return 42;
    });

    expect(result).toBe(42);
    expect(duration).toBeGreaterThanOrEqual(5);
  });

  it('logs timing with logger at debug level by default', async () => {
    const logger = createMockLogger();

    await withTiming('testOp', () => 'result', { logger });

    expect(logger.debug).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    const message = (logger.debug as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(message).toContain('testOp');
    expect(message).toContain('completed in');
    expect(message).toContain('ms');
  });

  it('logs timing at info level when specified', async () => {
    const logger = createMockLogger();

    await withTiming('testOp', () => 'result', { logger, logLevel: 'info' });

    expect(logger.info).toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('uses custom message formatter', async () => {
    const logger = createMockLogger();

    await withTiming('myOperation', () => 'result', {
      logger,
      formatMessage: (name, duration) => `[${name}] took ${Math.round(duration)}ms`,
    });

    const message = (logger.debug as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(message).toMatch(/\[myOperation\] took \d+ms/);
  });

  it('throws errors and logs failure', async () => {
    const logger = createMockLogger();
    const error = new Error('Test error');

    await expect(
      withTiming(
        'failingOp',
        () => {
          throw error;
        },
        { logger }
      )
    ).rejects.toThrow('Test error');

    expect(logger.debug).toHaveBeenCalled();
    const message = (logger.debug as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(message).toContain('failingOp');
    expect(message).toContain('failed after');
  });

  it('throws async errors and logs failure', async () => {
    const logger = createMockLogger();

    await expect(
      withTiming(
        'asyncFail',
        async () => {
          throw new Error('Async error');
        },
        { logger }
      )
    ).rejects.toThrow('Async error');

    expect(logger.debug).toHaveBeenCalled();
  });

  it('respects logLevel: info on failure', async () => {
    const logger = createMockLogger();

    await expect(
      withTiming(
        'failingOp',
        () => {
          throw new Error('boom');
        },
        { logger, logLevel: 'info' }
      )
    ).rejects.toThrow('boom');

    expect(logger.info).toHaveBeenCalled();
    expect(logger.debug).not.toHaveBeenCalled();
    const message = (logger.info as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(message).toContain('failingOp');
    expect(message).toContain('failed after');
  });

  it('works without logger', async () => {
    const { result } = await withTiming('noLogger', () => 'value');

    expect(result).toBe('value');
  });
});

// ============================================
// measureTime
// ============================================

describe('measureTime', () => {
  it('wraps a function and returns timing result', async () => {
    const fn = (x: number, y: number) => x + y;
    const timed = measureTime('add', fn);

    const { result, duration } = await timed(2, 3);

    expect(result).toBe(5);
    expect(duration).toBeGreaterThanOrEqual(0);
  });

  it('wraps async function', async () => {
    const fn = async (x: number) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return x * 2;
    };
    const timed = measureTime('double', fn);

    const { result } = await timed(5);

    expect(result).toBe(10);
  });

  it('logs on each call', async () => {
    const logger = createMockLogger();
    const fn = (s: string) => s.toUpperCase();
    const timed = measureTime('uppercase', fn, { logger });

    await timed('hello');
    await timed('world');

    expect(logger.debug).toHaveBeenCalledTimes(2);
  });

  it('preserves function behavior', async () => {
    const fn = vi.fn((a: string, b: number) => `${a}-${b}`);
    const timed = measureTime('test', fn);

    const { result } = await timed('foo', 42);

    expect(fn).toHaveBeenCalledWith('foo', 42);
    expect(result).toBe('foo-42');
  });

  it('propagates errors', async () => {
    const fn = () => {
      throw new Error('Test');
    };
    const timed = measureTime('failing', fn);

    await expect(timed()).rejects.toThrow('Test');
  });
});
