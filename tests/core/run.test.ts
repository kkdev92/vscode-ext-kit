import { describe, it, expect } from 'vitest';
import * as vscode from 'vscode';
import { run, tryRun, isCancellation } from '../../src/core/run.js';
import { createMockLogger } from '../factories.js';

describe('isCancellation', () => {
  it('detects vscode.CancellationError', () => {
    expect(isCancellation(new vscode.CancellationError())).toBe(true);
  });

  it('detects AbortError by name', () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    expect(isCancellation(error)).toBe(true);
  });

  it('rejects ordinary errors and non-errors', () => {
    expect(isCancellation(new Error('boom'))).toBe(false);
    expect(isCancellation('Canceled?')).toBe(false);
    expect(isCancellation(undefined)).toBe(false);
  });
});

describe('tryRun', () => {
  it('returns ok with the value on success', async () => {
    const logger = createMockLogger();

    const result = await tryRun(logger, 'Op', () => 42);

    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('supports async functions', async () => {
    const logger = createMockLogger();

    const result = await tryRun(logger, 'Op', async () => 'async value');

    expect(result).toEqual({ ok: true, value: 'async value' });
  });

  it('distinguishes a successful undefined from a failure', async () => {
    const logger = createMockLogger();

    const result = await tryRun(logger, 'Op', () => undefined);

    expect(result.ok).toBe(true);
  });

  it('provides an AbortSignal to the function', async () => {
    const logger = createMockLogger();
    let received: AbortSignal | undefined;

    await tryRun(logger, 'Op', (signal) => {
      received = signal;
      return 1;
    });

    expect(received).toBeInstanceOf(AbortSignal);
    expect(received!.aborted).toBe(false);
  });

  it('returns a failure, logs, and notifies on error', async () => {
    const logger = createMockLogger();
    const error = new Error('boom');

    const result = await tryRun(logger, 'Sync files', () => {
      throw error;
    });

    expect(result).toEqual({ ok: false, error, cancelled: false });
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Sync files failed: boom'),
      expect.objectContaining({ error })
    );
    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Sync files failed: boom')
    );
  });

  it('normalizes non-Error thrown values', async () => {
    const logger = createMockLogger();

    const result = await tryRun(logger, 'Op', () => {
      throw 'string failure';
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBeInstanceOf(Error);
      expect(result.error.message).toBe('string failure');
    }
  });

  it('uses the custom userMessage for the notification', async () => {
    const logger = createMockLogger();

    await tryRun(
      logger,
      'Op',
      () => {
        throw new Error('boom');
      },
      { userMessage: 'Something friendly went wrong' }
    );

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Something friendly went wrong');
  });

  it('suppresses the notification in silent mode but still logs', async () => {
    const logger = createMockLogger();

    await tryRun(
      logger,
      'Op',
      () => {
        throw new Error('boom');
      },
      { silent: true }
    );

    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });

  describe('cancellation', () => {
    it('marks vscode.CancellationError as cancelled with no toast and no error log', async () => {
      const logger = createMockLogger();

      const result = await tryRun(logger, 'Long op', () => {
        throw new vscode.CancellationError();
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.cancelled).toBe(true);
      }
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('Long op cancelled'));
    });

    it('treats AbortError as cancellation', async () => {
      const logger = createMockLogger();
      const abortError = new Error('The operation was aborted');
      abortError.name = 'AbortError';

      const result = await tryRun(logger, 'Op', () => {
        throw abortError;
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.cancelled).toBe(true);
      }
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
  });
});

describe('run', () => {
  it('returns the value on success', async () => {
    const logger = createMockLogger();

    const value = await run(logger, 'Op', () => 'done');

    expect(value).toBe('done');
  });

  it('returns undefined on failure', async () => {
    const logger = createMockLogger();

    const value = await run(logger, 'Op', () => {
      throw new Error('boom');
    });

    expect(value).toBeUndefined();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('rethrows real errors when rethrow is set', async () => {
    const logger = createMockLogger();
    const error = new Error('boom');

    await expect(
      run(
        logger,
        'Op',
        () => {
          throw error;
        },
        { rethrow: true }
      )
    ).rejects.toThrow(error);
  });

  it('never rethrows cancellations, even with rethrow set', async () => {
    const logger = createMockLogger();

    const value = await run(
      logger,
      'Op',
      () => {
        throw new vscode.CancellationError();
      },
      { rethrow: true }
    );

    expect(value).toBeUndefined();
    expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
  });
});
