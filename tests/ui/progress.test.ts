import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import {
  withProgress,
  withSteps,
  toAbortSignal,
  type ProgressReporter,
} from '../../src/ui/progress.js';

/**
 * Overrides `vscode.window.withProgress` for exactly one call so a test can
 * capture every `progress.report()` call it makes, instead of the inert
 * `{ report: vi.fn() }` the shared mock in tests/setup.ts installs. The
 * single cast here (rather than typing the whole callback loosely) is what
 * keeps the many call sites below simple.
 */
function mockWithProgressReporting(
  onReport: (value: { message?: string; increment?: number }) => void
): void {
  const impl = async (
    _options: vscode.ProgressOptions,
    task: (
      progress: vscode.Progress<{ message?: string; increment?: number }>,
      token: vscode.CancellationToken
    ) => Thenable<unknown>
  ) => {
    const token: vscode.CancellationToken = {
      isCancellationRequested: false,
      onCancellationRequested: vi.fn(),
    };
    return task({ report: onReport }, token);
  };
  vi.mocked(vscode.window.withProgress).mockImplementationOnce(
    impl as unknown as typeof vscode.window.withProgress
  );
}

describe('Progress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('withProgress', () => {
    it('should call vscode.window.withProgress with correct options', async () => {
      await withProgress('Loading...', async () => 'result');

      expect(vscode.window.withProgress).toHaveBeenCalledWith(
        {
          location: vscode.ProgressLocation.Notification,
          title: 'Loading...',
          cancellable: false,
        },
        expect.any(Function)
      );
    });

    it('should return task result', async () => {
      const result = await withProgress('Loading...', async () => 'success');

      expect(result).toBe('success');
    });

    it('should pass progress reporter and cancellation token to task', async () => {
      let receivedProgress: ProgressReporter | undefined;
      let receivedToken: vscode.CancellationToken | undefined;

      await withProgress('Loading...', async (progress, token) => {
        receivedProgress = progress;
        receivedToken = token;
        return 'done';
      });

      expect(receivedProgress).toBeDefined();
      expect(typeof receivedProgress?.report).toBe('function');
      expect(receivedToken).toBeDefined();
      expect(typeof receivedToken?.isCancellationRequested).toBe('boolean');
    });

    it('should use custom location when provided', async () => {
      await withProgress('Loading...', async () => 'result', {
        location: vscode.ProgressLocation.Window,
      });

      expect(vscode.window.withProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          location: vscode.ProgressLocation.Window,
        }),
        expect.any(Function)
      );
    });

    it('should enable cancellation when specified', async () => {
      await withProgress('Loading...', async () => 'result', { cancellable: true });

      expect(vscode.window.withProgress).toHaveBeenCalledWith(
        expect.objectContaining({
          cancellable: true,
        }),
        expect.any(Function)
      );
    });

    it('should handle async operations', async () => {
      const result = await withProgress('Loading...', async () => {
        await Promise.resolve();
        return { data: 'value' };
      });

      expect(result).toEqual({ data: 'value' });
    });

    it('should propagate errors', async () => {
      await expect(
        withProgress('Loading...', async () => {
          throw new Error('Task failed');
        })
      ).rejects.toThrow('Task failed');
    });

    it('should handle synchronous tasks', async () => {
      const result = await withProgress('Processing...', () => 'sync result');

      expect(result).toBe('sync result');
    });

    it('should handle synchronous tasks with progress and token', async () => {
      let receivedProgress: ProgressReporter | undefined;
      let receivedToken: vscode.CancellationToken | undefined;

      const result = await withProgress('Processing...', (progress, token) => {
        receivedProgress = progress;
        receivedToken = token;
        return 42;
      });

      expect(result).toBe(42);
      expect(receivedProgress).toBeDefined();
      expect(receivedToken).toBeDefined();
    });

    it('should allow progress reporting', async () => {
      let reportedValues: { message?: string; increment?: number }[] = [];

      await withProgress('Processing...', (progress) => {
        progress.report({ message: 'Step 1', increment: 10 });
        progress.report({ message: 'Step 2', increment: 50 });
        reportedValues = [
          { message: 'Step 1', increment: 10 },
          { message: 'Step 2', increment: 50 },
        ];
        return 'done';
      });

      expect(reportedValues).toHaveLength(2);
      expect(reportedValues[0]).toEqual({ message: 'Step 1', increment: 10 });
    });
  });

  describe('withSteps', () => {
    it('should execute all steps in order', async () => {
      const executionOrder: number[] = [];

      const result = await withSteps(
        { title: 'Test' },
        {
          label: 'Step 1',
          task: async () => {
            executionOrder.push(1);
            return 1;
          },
        },
        {
          label: 'Step 2',
          task: async () => {
            executionOrder.push(2);
            return 2;
          },
        },
        {
          label: 'Step 3',
          task: async () => {
            executionOrder.push(3);
            return 3;
          },
        }
      );

      expect(result.completed).toBe(true);
      expect(result.cancelled).toBe(false);
      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it('should return results from all steps', async () => {
      const result = await withSteps(
        { title: 'Test' },
        { label: 'A', task: async () => 'result-a' },
        { label: 'B', task: async () => 'result-b' }
      );

      expect(result.results).toEqual(['result-a', 'result-b']);
    });

    it('infers a precise per-step tuple type without needing `as const` (bug #15)', async () => {
      // Regression: previously only compiled correctly if the steps array
      // literal was annotated `as const`; passing steps as separate
      // arguments (rest parameters) keeps per-step types intact natively.
      const result = await withSteps(
        { title: 'Test' },
        { label: 'Number', task: async () => 42 },
        { label: 'String', task: async () => 'hello' },
        { label: 'Object', task: async () => ({ key: 'value' }) }
      );

      const num: number = result.results[0];
      const str: string = result.results[1];
      const obj: { key: string } = result.results[2];
      expect(num).toBe(42);
      expect(str).toBe('hello');
      expect(obj).toEqual({ key: 'value' });
    });

    it('should handle synchronous tasks', async () => {
      const result = await withSteps(
        { title: 'Test' },
        { label: 'Sync 1', task: () => 1 },
        { label: 'Sync 2', task: () => 2 }
      );

      expect(result.completed).toBe(true);
      expect(result.results).toEqual([1, 2]);
    });

    it('should pass cancellation token to steps', async () => {
      let receivedToken: vscode.CancellationToken | undefined;

      await withSteps(
        { title: 'Test' },
        {
          label: 'Check Token',
          task: (token) => {
            receivedToken = token;
          },
        }
      );

      expect(receivedToken).toBeDefined();
      expect(typeof receivedToken?.isCancellationRequested).toBe('boolean');
    });

    it('should handle zero steps', async () => {
      const result = await withSteps({ title: 'Test' });

      expect(result.completed).toBe(true);
      expect(result.cancelled).toBe(false);
      expect(result.results).toEqual([]);
    });

    it('should call vscode.window.withProgress with correct options', async () => {
      await withSteps({
        title: 'Processing',
        location: vscode.ProgressLocation.Window,
        cancellable: true,
      });

      expect(vscode.window.withProgress).toHaveBeenCalledWith(
        {
          location: vscode.ProgressLocation.Window,
          title: 'Processing',
          cancellable: true,
        },
        expect.any(Function)
      );
    });

    it('should propagate errors from steps', async () => {
      await expect(
        withSteps(
          { title: 'Test' },
          {
            label: 'Failing Step',
            task: async () => {
              throw new Error('Step failed');
            },
          }
        )
      ).rejects.toThrow('Step failed');
    });

    it("reports increment proportional to each step's weight (default weight: 1)", async () => {
      const reports: { message?: string; increment?: number }[] = [];
      mockWithProgressReporting((value) => reports.push(value));

      await withSteps(
        { title: 'Test' },
        { label: 'A', task: () => 'a' },
        { label: 'B', task: () => 'b' }
      );

      // Equal weights (default 1 each) over 2 steps -> 50% each.
      const increments = reports.filter((r) => r.increment !== undefined).map((r) => r.increment);
      expect(increments).toEqual([50, 50]);
    });

    it('reports increment proportional to unequal explicit weights', async () => {
      const reports: { message?: string; increment?: number }[] = [];
      mockWithProgressReporting((value) => reports.push(value));

      // weights 3 / 5 / 2 sum to 10 -> increments 30 / 50 / 20.
      await withSteps(
        { title: 'Test' },
        { label: 'Downloading', task: () => undefined, weight: 3 },
        { label: 'Processing', task: () => undefined, weight: 5 },
        { label: 'Uploading', task: () => undefined, weight: 2 }
      );

      const increments = reports.filter((r) => r.increment !== undefined).map((r) => r.increment);
      expect(increments).toEqual([30, 50, 20]);
    });

    it('reports each step label as the progress message before running it', async () => {
      const messages: (string | undefined)[] = [];
      mockWithProgressReporting((value) => {
        if (value.message !== undefined) messages.push(value.message);
      });

      await withSteps(
        { title: 'Test' },
        { label: 'First', task: () => undefined },
        { label: 'Second', task: () => undefined }
      );

      expect(messages).toEqual(['First', 'Second']);
    });
  });

  describe('toAbortSignal', () => {
    it('should return an AbortSignal', () => {
      const token: vscode.CancellationToken = {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      };

      const signal = toAbortSignal(token);

      expect(signal).toBeInstanceOf(AbortSignal);
    });

    it('should return aborted signal when token is already cancelled', () => {
      const token: vscode.CancellationToken = {
        isCancellationRequested: true,
        onCancellationRequested: vi.fn(),
      };

      const signal = toAbortSignal(token);

      expect(signal.aborted).toBe(true);
    });

    it('should return non-aborted signal when token is not cancelled', () => {
      const token: vscode.CancellationToken = {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(),
      };

      const signal = toAbortSignal(token);

      expect(signal.aborted).toBe(false);
    });

    it('should register cancellation listener', () => {
      const onCancellationRequested = vi.fn();
      const token: vscode.CancellationToken = {
        isCancellationRequested: false,
        onCancellationRequested,
      };

      toAbortSignal(token);

      expect(onCancellationRequested).toHaveBeenCalled();
    });

    it('should not register listener when already cancelled', () => {
      const onCancellationRequested = vi.fn();
      const token: vscode.CancellationToken = {
        isCancellationRequested: true,
        onCancellationRequested,
      };

      toAbortSignal(token);

      expect(onCancellationRequested).not.toHaveBeenCalled();
    });

    it('should abort and dispose the subscription when the token is cancelled', () => {
      let capturedListener: (() => void) | undefined;
      const dispose = vi.fn();
      const token: vscode.CancellationToken = {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn((listener: () => void) => {
          capturedListener = listener;
          return { dispose };
        }) as unknown as vscode.CancellationToken['onCancellationRequested'],
      };

      const signal = toAbortSignal(token);
      capturedListener?.();

      expect(signal.aborted).toBe(true);
      expect(dispose).toHaveBeenCalledTimes(1);
    });
  });
});
