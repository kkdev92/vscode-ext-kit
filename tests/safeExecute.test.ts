import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { safeExecute, trySafeExecute } from '../src/safeExecute.js';
import type { Logger } from '../src/types.js';
import { createMockLogger } from './factories.js';

describe('safeExecute', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
  });

  describe('successful execution', () => {
    it('should return result on success', async () => {
      const result = await safeExecute(mockLogger, 'Test Action', () => 'success');

      expect(result).toBe('success');
      expect(mockLogger.error).not.toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });

    it('should handle async functions', async () => {
      const result = await safeExecute(mockLogger, 'Async Action', async () => {
        await Promise.resolve();
        return 42;
      });

      expect(result).toBe(42);
    });

    it('should pass through undefined return value', async () => {
      const result = await safeExecute(mockLogger, 'Void Action', () => undefined);

      expect(result).toBeUndefined();
      expect(mockLogger.error).not.toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('should return undefined and log error on failure', async () => {
      const error = new Error('Test error');

      const result = await safeExecute(mockLogger, 'Test Action', () => {
        throw error;
      });

      expect(result).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Test Action failed'),
        error
      );
      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    });

    it('should show error notification with action name', async () => {
      await safeExecute(mockLogger, 'Save File', () => {
        throw new Error('Permission denied');
      });

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
        expect.stringContaining('Save File failed')
      );
    });

    it('should handle non-Error thrown values', async () => {
      const result = await safeExecute(mockLogger, 'Test Action', () => {
        throw 'string error';
      });

      expect(result).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('string error'),
        'string error'
      );
    });

    it('should handle null thrown values', async () => {
      const result = await safeExecute(mockLogger, 'Test Action', () => {
        throw null;
      });

      expect(result).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('options', () => {
    describe('userMessage', () => {
      it('should use custom user message when provided', async () => {
        await safeExecute(
          mockLogger,
          'Test Action',
          () => {
            throw new Error('internal error');
          },
          { userMessage: 'Something went wrong. Please try again.' }
        );

        expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
          'Something went wrong. Please try again.'
        );
      });
    });

    describe('silent', () => {
      it('should not show notification when silent is true', async () => {
        await safeExecute(
          mockLogger,
          'Background Task',
          () => {
            throw new Error('Test');
          },
          { silent: true }
        );

        expect(mockLogger.error).toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      });
    });

    describe('rethrow', () => {
      it('should rethrow the error when rethrow is true', async () => {
        const error = new Error('Test error');

        await expect(
          safeExecute(
            mockLogger,
            'Test Action',
            () => {
              throw error;
            },
            { rethrow: true }
          )
        ).rejects.toThrow('Test error');

        expect(mockLogger.error).toHaveBeenCalled();
      });

      it('should still log and notify before rethrowing', async () => {
        const error = new Error('Test error');

        try {
          await safeExecute(
            mockLogger,
            'Test Action',
            () => {
              throw error;
            },
            { rethrow: true }
          );
        } catch {
          // Expected
        }

        expect(mockLogger.error).toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).toHaveBeenCalled();
      });

      it('should not rethrow when rethrow is false (default)', async () => {
        const result = await safeExecute(
          mockLogger,
          'Test Action',
          () => {
            throw new Error('Test');
          },
          { rethrow: false }
        );

        expect(result).toBeUndefined();
      });
    });

    describe('combined options', () => {
      it('should handle silent + rethrow', async () => {
        const error = new Error('Test');

        await expect(
          safeExecute(
            mockLogger,
            'Test',
            () => {
              throw error;
            },
            { silent: true, rethrow: true }
          )
        ).rejects.toThrow();

        expect(mockLogger.error).toHaveBeenCalled();
        expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
      });
    });
  });

  describe('async error handling', () => {
    it('should catch async errors', async () => {
      const result = await safeExecute(mockLogger, 'Async Task', async () => {
        await Promise.resolve();
        throw new Error('Async error');
      });

      expect(result).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Async error'),
        expect.any(Error)
      );
    });

    it('should catch rejected promises', async () => {
      const result = await safeExecute(mockLogger, 'Promise Task', () =>
        Promise.reject(new Error('Rejected'))
      );

      expect(result).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });
});

describe('trySafeExecute', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
  });

  describe('successful execution', () => {
    it('should return ok result on success', async () => {
      const result = await trySafeExecute(mockLogger, 'Test Action', () => 'success');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe('success');
      }
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should handle async functions', async () => {
      const result = await trySafeExecute(mockLogger, 'Async Action', async () => {
        await Promise.resolve();
        return 42;
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(42);
      }
    });

    it('should distinguish undefined success from error', async () => {
      const result = await trySafeExecute(mockLogger, 'Void Action', () => undefined);

      // This is the key difference from safeExecute:
      // We can tell this is a successful undefined, not an error
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBeUndefined();
      }
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('should wrap undefined-returning function correctly', async () => {
      const findItem = (id: number) => {
        const items = [{ id: 1 }, { id: 2 }];
        return items.find((item) => item.id === id);
      };

      // Item found
      const found = await trySafeExecute(mockLogger, 'Find Item', () => findItem(1));
      expect(found.ok).toBe(true);
      if (found.ok) {
        expect(found.value).toEqual({ id: 1 });
      }

      // Item not found (undefined is valid success)
      const notFound = await trySafeExecute(mockLogger, 'Find Item', () => findItem(999));
      expect(notFound.ok).toBe(true);
      if (notFound.ok) {
        expect(notFound.value).toBeUndefined();
      }
    });
  });

  describe('error handling', () => {
    it('should return error result on failure', async () => {
      const error = new Error('Test error');

      const result = await trySafeExecute(mockLogger, 'Test Action', () => {
        throw error;
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe(error);
        expect(result.error.message).toBe('Test error');
      }
      expect(mockLogger.error).toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    });

    it('should normalize non-Error thrown values', async () => {
      const result = await trySafeExecute(mockLogger, 'Test Action', () => {
        throw 'string error';
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('string error');
      }
    });

    it('should handle null thrown values', async () => {
      const result = await trySafeExecute(mockLogger, 'Test Action', () => {
        throw null;
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(Error);
        expect(result.error.message).toBe('null');
      }
    });
  });

  describe('options', () => {
    it('should use custom user message when provided', async () => {
      await trySafeExecute(
        mockLogger,
        'Test Action',
        () => {
          throw new Error('internal error');
        },
        { userMessage: 'Something went wrong.' }
      );

      expect(vscode.window.showErrorMessage).toHaveBeenCalledWith('Something went wrong.');
    });

    it('should not show notification when silent is true', async () => {
      const result = await trySafeExecute(
        mockLogger,
        'Background Task',
        () => {
          throw new Error('Test');
        },
        { silent: true }
      );

      expect(result.ok).toBe(false);
      expect(mockLogger.error).toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).not.toHaveBeenCalled();
    });
  });

  describe('async error handling', () => {
    it('should catch async errors', async () => {
      const result = await trySafeExecute(mockLogger, 'Async Task', async () => {
        await Promise.resolve();
        throw new Error('Async error');
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Async error');
      }
    });

    it('should catch rejected promises', async () => {
      const result = await trySafeExecute(mockLogger, 'Promise Task', () =>
        Promise.reject(new Error('Rejected'))
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Rejected');
      }
    });
  });
});
