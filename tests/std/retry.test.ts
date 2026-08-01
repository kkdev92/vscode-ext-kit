import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retry, RetryExhaustedError } from '../../src/std/retry.js';
import { TimeoutError } from '../../src/std/timing.js';

describe('retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('successful execution', () => {
    it('should return result on first success', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      const resultPromise = retry(fn);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should return result after retry', async () => {
      const fn = vi.fn().mockRejectedValueOnce(new Error('fail')).mockResolvedValue('success');

      const resultPromise = retry(fn);
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('maxAttempts', () => {
    it('should throw a RetryExhaustedError after max attempts exhausted', async () => {
      const error = new Error('persistent failure');
      const fn = vi.fn().mockRejectedValue(error);

      const resultPromise = retry(fn, { maxAttempts: 3 });

      // Attach error handler immediately to prevent unhandled rejection
      const catchPromise = resultPromise.catch(
        (e): RetryExhaustedError => e as RetryExhaustedError
      );

      await vi.runAllTimersAsync();

      const caughtError = (await catchPromise) as RetryExhaustedError;
      expect(caughtError).toBeInstanceOf(RetryExhaustedError);
      expect(caughtError.attempts).toBe(3);
      expect(caughtError.cause).toBe(error);
      expect(caughtError.history).toEqual([error, error, error]);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should respect custom maxAttempts', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      const resultPromise = retry(fn, { maxAttempts: 5 });
      const catchPromise = resultPromise.catch(
        (e): RetryExhaustedError => e as RetryExhaustedError
      );

      await vi.runAllTimersAsync();

      const caughtError = (await catchPromise) as RetryExhaustedError;
      expect(caughtError).toBeInstanceOf(RetryExhaustedError);
      expect(caughtError.attempts).toBe(5);
      expect(caughtError.history).toHaveLength(5);
      expect(fn).toHaveBeenCalledTimes(5);
    });

    it('should throw if maxAttempts is less than 1', async () => {
      const fn = vi.fn().mockResolvedValue('success');

      await expect(retry(fn, { maxAttempts: 0 })).rejects.toThrow('maxAttempts must be at least 1');
    });
  });

  describe('delay', () => {
    it('should wait before retrying with linear backoff', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const resultPromise = retry(fn, { delay: 1000, backoff: 'linear', jitter: 'none' });

      // First call happens immediately
      expect(fn).toHaveBeenCalledTimes(1);

      // Advance 1000ms for first retry
      await vi.advanceTimersByTimeAsync(1000);
      expect(fn).toHaveBeenCalledTimes(2);

      // Advance another 1000ms for second retry (linear = same delay)
      await vi.advanceTimersByTimeAsync(1000);
      expect(fn).toHaveBeenCalledTimes(3);

      const result = await resultPromise;
      expect(result).toBe('success');
    });

    it('should use exponential backoff by default', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const resultPromise = retry(fn, { delay: 1000, jitter: 'none' });

      // First call happens immediately
      expect(fn).toHaveBeenCalledTimes(1);

      // Advance 1000ms for first retry (1000 * 2^0 = 1000)
      await vi.advanceTimersByTimeAsync(1000);
      expect(fn).toHaveBeenCalledTimes(2);

      // Advance 2000ms for second retry (1000 * 2^1 = 2000)
      await vi.advanceTimersByTimeAsync(2000);
      expect(fn).toHaveBeenCalledTimes(3);

      const result = await resultPromise;
      expect(result).toBe('success');
    });
  });

  describe('retryIf', () => {
    it('should not retry if retryIf returns false', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('permanent error'));
      const retryIf = vi.fn().mockReturnValue(false);

      const resultPromise = retry(fn, { retryIf });
      const catchPromise = resultPromise.catch(
        (e): RetryExhaustedError => e as RetryExhaustedError
      );

      await vi.runAllTimersAsync();

      const caughtError = (await catchPromise) as RetryExhaustedError;
      expect(caughtError).toBeInstanceOf(RetryExhaustedError);
      expect(caughtError.attempts).toBe(1);
      expect((caughtError.cause as Error).message).toBe('permanent error');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(retryIf).toHaveBeenCalledWith(expect.any(Error), 1);
    });

    it('should receive error and attempt number', async () => {
      const error = new Error('test error');
      const fn = vi.fn().mockRejectedValue(error);
      const retryIf = vi.fn().mockReturnValue(true);

      const resultPromise = retry(fn, { maxAttempts: 3, retryIf });
      const catchPromise = resultPromise.catch((e): Error => e as Error);

      await vi.runAllTimersAsync();

      await catchPromise;
      expect(retryIf).toHaveBeenCalledWith(error, 1);
      expect(retryIf).toHaveBeenCalledWith(error, 2);
    });

    it('should selectively retry based on error type', async () => {
      class RetryableError extends Error {}
      class FatalError extends Error {}

      const fn = vi
        .fn()
        .mockRejectedValueOnce(new RetryableError('retry me'))
        .mockRejectedValueOnce(new FatalError('stop here'));

      const resultPromise = retry(fn, {
        retryIf: (error) => error instanceof RetryableError,
      });
      const catchPromise = resultPromise.catch(
        (e): RetryExhaustedError => e as RetryExhaustedError
      );

      await vi.runAllTimersAsync();

      const caughtError = (await catchPromise) as RetryExhaustedError;
      expect(caughtError).toBeInstanceOf(RetryExhaustedError);
      expect(caughtError.attempts).toBe(2);
      expect((caughtError.cause as Error).message).toBe('stop here');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('onRetry callback', () => {
    it('should call onRetry before each retry', async () => {
      const error = new Error('fail');
      const fn = vi.fn().mockRejectedValue(error);
      const onRetry = vi.fn();

      const resultPromise = retry(fn, {
        maxAttempts: 3,
        delay: 1000,
        backoff: 'exponential',
        jitter: 'none',
        onRetry,
      });
      const catchPromise = resultPromise.catch((e): Error => e as Error);

      await vi.runAllTimersAsync();

      await catchPromise;
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, error, 1, 1000);
      expect(onRetry).toHaveBeenNthCalledWith(2, error, 2, 2000);
    });

    it('should not call onRetry on success', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const onRetry = vi.fn();

      const resultPromise = retry(fn, { onRetry });
      await vi.runAllTimersAsync();

      await resultPromise;
      expect(onRetry).not.toHaveBeenCalled();
    });
  });

  describe('defaults', () => {
    it('should use default options', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const resultPromise = retry(fn);
      await vi.runAllTimersAsync();

      const result = await resultPromise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });
  });

  describe('maxDelay', () => {
    it('caps exponential backoff at maxDelay', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const onRetry = vi.fn();

      const resultPromise = retry(fn, {
        maxAttempts: 4,
        delay: 1000,
        backoff: 'exponential',
        maxDelay: 1500,
        jitter: 'none',
        onRetry,
      });
      const catchPromise = resultPromise.catch((e): Error => e as Error);

      await vi.runAllTimersAsync();
      await catchPromise;

      // Without cap: 1000, 2000, 4000. With cap=1500: 1000, 1500, 1500.
      expect(onRetry).toHaveBeenNthCalledWith(1, expect.any(Error), 1, 1000);
      expect(onRetry).toHaveBeenNthCalledWith(2, expect.any(Error), 2, 1500);
      expect(onRetry).toHaveBeenNthCalledWith(3, expect.any(Error), 3, 1500);
    });

    it('does not cap if maxDelay is greater than computed delay', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const onRetry = vi.fn();

      const resultPromise = retry(fn, {
        maxAttempts: 2,
        delay: 1000,
        backoff: 'linear',
        maxDelay: 10_000,
        jitter: 'none',
        onRetry,
      });
      const catchPromise = resultPromise.catch((e): Error => e as Error);

      await vi.runAllTimersAsync();
      await catchPromise;

      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 1000);
    });
  });

  describe('jitter', () => {
    it('full: scales delay by Math.random()', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const onRetry = vi.fn();

      const resultPromise = retry(fn, {
        maxAttempts: 2,
        delay: 1000,
        backoff: 'linear',
        jitter: 'full',
        onRetry,
      });
      const catchPromise = resultPromise.catch((e): Error => e as Error);

      await vi.runAllTimersAsync();
      await catchPromise;

      // 1000 * 0.5 = 500
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 500);
    });

    it('is full jitter by default when omitted', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const onRetry = vi.fn();

      const resultPromise = retry(fn, {
        maxAttempts: 2,
        delay: 1000,
        backoff: 'linear',
        onRetry,
      });
      const catchPromise = resultPromise.catch((e): Error => e as Error);

      await vi.runAllTimersAsync();
      await catchPromise;

      // Same formula as the explicit 'full' test above: 1000 * 0.5 = 500.
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 500);
    });

    it('equal: yields delay/2 + random*(delay/2)', async () => {
      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const onRetry = vi.fn();

      const resultPromise = retry(fn, {
        maxAttempts: 2,
        delay: 1000,
        backoff: 'linear',
        jitter: 'equal',
        onRetry,
      });
      const catchPromise = resultPromise.catch((e): Error => e as Error);

      await vi.runAllTimersAsync();
      await catchPromise;

      // 500 + 0.5 * 500 = 750
      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 750);
    });

    it('none: leaves delay unchanged', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));
      const onRetry = vi.fn();

      const resultPromise = retry(fn, {
        maxAttempts: 2,
        delay: 1234,
        backoff: 'linear',
        jitter: 'none',
        onRetry,
      });
      const catchPromise = resultPromise.catch((e): Error => e as Error);

      await vi.runAllTimersAsync();
      await catchPromise;

      expect(onRetry).toHaveBeenCalledWith(expect.any(Error), 1, 1234);
    });
  });

  describe('context (attempt/signal)', () => {
    it('passes the current attempt number and the signal to fn', async () => {
      const controller = new AbortController();
      const seen: Array<{ attempt: number; signal: AbortSignal | undefined }> = [];

      const fn = vi.fn(async (ctx: { attempt: number; signal?: AbortSignal }) => {
        seen.push({ attempt: ctx.attempt, signal: ctx.signal });
        if (ctx.attempt < 3) {
          throw new Error('fail');
        }
        return 'done';
      });

      const resultPromise = retry(fn, { signal: controller.signal, jitter: 'none' });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(result).toBe('done');
      expect(seen.map((s) => s.attempt)).toEqual([1, 2, 3]);
      expect(seen.every((s) => s.signal === controller.signal)).toBe(true);
    });
  });

  describe('signal', () => {
    it('rejects immediately without calling fn if already aborted', async () => {
      const controller = new AbortController();
      const reason = new Error('pre-aborted');
      controller.abort(reason);

      const fn = vi.fn().mockResolvedValue('success');

      await expect(retry(fn, { signal: controller.signal })).rejects.toBe(reason);
      expect(fn).not.toHaveBeenCalled();
    });

    it('interrupts the inter-retry wait and does not attempt again', async () => {
      const controller = new AbortController();
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      const resultPromise = retry(fn, {
        maxAttempts: 5,
        delay: 1000,
        signal: controller.signal,
      });
      const catchPromise = resultPromise.catch((error: unknown) => error);

      // Let the first attempt run and fail, entering the inter-retry sleep.
      await vi.advanceTimersByTimeAsync(0);
      expect(fn).toHaveBeenCalledTimes(1);

      const reason = new Error('cancelled mid-wait');
      controller.abort(reason);

      const error = await catchPromise;
      expect(error).toBe(reason);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('timeoutMs', () => {
    it('treats a per-attempt timeout as a retryable failure and records it in history', async () => {
      const fn = vi.fn(
        () =>
          new Promise<never>(() => {
            // Never settles: forces every attempt to time out.
          })
      );
      const onRetry = vi.fn();

      const resultPromise = retry(fn, {
        maxAttempts: 2,
        timeoutMs: 500,
        delay: 100,
        jitter: 'none',
        onRetry,
      });
      const catchPromise = resultPromise.catch(
        (e): RetryExhaustedError => e as RetryExhaustedError
      );

      await vi.runAllTimersAsync();
      const error = await catchPromise;

      expect(error).toBeInstanceOf(RetryExhaustedError);
      expect(error.attempts).toBe(2);
      expect(error.history).toHaveLength(2);
      expect(error.history[0]).toBeInstanceOf(TimeoutError);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('succeeds if a later attempt resolves within the timeout', async () => {
      const fn = vi
        .fn()
        .mockImplementationOnce(() => new Promise<never>(() => {}))
        .mockResolvedValueOnce('success');

      const resultPromise = retry(fn, {
        maxAttempts: 2,
        timeoutMs: 500,
        delay: 100,
        jitter: 'none',
      });
      await vi.runAllTimersAsync();

      const result = await resultPromise;
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});

describe('retry: abort listener hygiene', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('removes its abort listener from the signal once a wait completes', async () => {
    const controller = new AbortController();
    const addSpy = vi.spyOn(controller.signal, 'addEventListener');
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
    const fn = vi
      .fn<(ctx: { attempt: number }) => Promise<string>>()
      .mockRejectedValueOnce(new Error('first'))
      .mockResolvedValue('ok');

    const resultPromise = retry(fn, {
      maxAttempts: 2,
      delay: 100,
      jitter: 'none',
      signal: controller.signal,
    });
    await vi.advanceTimersByTimeAsync(100);

    await expect(resultPromise).resolves.toBe('ok');
    // Without this, a long-lived signal accumulates one dead listener per
    // retry wait for as long as it stays un-aborted. Identity matters:
    // removing any *other* function would be a no-op.
    const added = addSpy.mock.calls.find((call) => call[0] === 'abort')?.[1];
    expect(added).toBeDefined();
    expect(removeSpy).toHaveBeenCalledWith('abort', added);
  });
});
