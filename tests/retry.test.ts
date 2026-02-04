import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { retry } from '../src/retry.js';

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
    it('should throw after max attempts exhausted', async () => {
      const error = new Error('persistent failure');
      const fn = vi.fn().mockRejectedValue(error);

      const resultPromise = retry(fn, { maxAttempts: 3 });

      // Attach error handler immediately to prevent unhandled rejection
      const catchPromise = resultPromise.catch((e) => e);

      await vi.runAllTimersAsync();

      const caughtError = await catchPromise;
      expect(caughtError).toBeInstanceOf(Error);
      expect(caughtError.message).toBe('persistent failure');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should respect custom maxAttempts', async () => {
      const fn = vi.fn().mockRejectedValue(new Error('fail'));

      const resultPromise = retry(fn, { maxAttempts: 5 });
      const catchPromise = resultPromise.catch((e) => e);

      await vi.runAllTimersAsync();

      const caughtError = await catchPromise;
      expect(caughtError).toBeInstanceOf(Error);
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

      const resultPromise = retry(fn, { delay: 1000, backoff: 'linear' });

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

      const resultPromise = retry(fn, { delay: 1000 });

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
      const catchPromise = resultPromise.catch((e) => e);

      await vi.runAllTimersAsync();

      const caughtError = await catchPromise;
      expect(caughtError.message).toBe('permanent error');
      expect(fn).toHaveBeenCalledTimes(1);
      expect(retryIf).toHaveBeenCalledWith(expect.any(Error), 1);
    });

    it('should receive error and attempt number', async () => {
      const error = new Error('test error');
      const fn = vi.fn().mockRejectedValue(error);
      const retryIf = vi.fn().mockReturnValue(true);

      const resultPromise = retry(fn, { maxAttempts: 3, retryIf });
      const catchPromise = resultPromise.catch((e) => e);

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
      const catchPromise = resultPromise.catch((e) => e);

      await vi.runAllTimersAsync();

      const caughtError = await catchPromise;
      expect(caughtError.message).toBe('stop here');
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
        onRetry,
      });
      const catchPromise = resultPromise.catch((e) => e);

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
});
