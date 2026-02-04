import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce, throttle, withTiming, measureTime } from '../src/timing.js';
import type { Logger } from '../src/types.js';

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
});

// ============================================
// withTiming
// ============================================

describe('withTiming', () => {
  function createMockLogger(): Logger {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLevel: vi.fn(),
      dispose: vi.fn(),
    };
  }

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
    expect(duration).toBeGreaterThanOrEqual(10);
  });

  it('logs timing with logger at debug level by default', async () => {
    const logger = createMockLogger();

    await withTiming('testOp', () => 'result', { logger });

    expect(logger.debug).toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
    const message = (logger.debug as ReturnType<typeof vi.fn>).mock.calls[0][0];
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

    const message = (logger.debug as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(message).toMatch(/\[myOperation\] took \d+ms/);
  });

  it('throws errors and logs failure', async () => {
    const logger = createMockLogger();
    const error = new Error('Test error');

    await expect(
      withTiming('failingOp', () => {
        throw error;
      }, { logger })
    ).rejects.toThrow('Test error');

    expect(logger.debug).toHaveBeenCalled();
    const message = (logger.debug as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(message).toContain('failingOp');
    expect(message).toContain('failed after');
  });

  it('throws async errors and logs failure', async () => {
    const logger = createMockLogger();

    await expect(
      withTiming('asyncFail', async () => {
        throw new Error('Async error');
      }, { logger })
    ).rejects.toThrow('Async error');

    expect(logger.debug).toHaveBeenCalled();
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
  function createMockLogger(): Logger {
    return {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      setLevel: vi.fn(),
      dispose: vi.fn(),
    };
  }

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
