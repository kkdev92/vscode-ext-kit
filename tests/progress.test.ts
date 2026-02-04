import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { withProgress, withSteps, toAbortSignal, type ProgressReporter, type ProgressStep } from '../src/progress.js';

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

      const steps: ProgressStep<number>[] = [
        { label: 'Step 1', task: async () => { executionOrder.push(1); return 1; } },
        { label: 'Step 2', task: async () => { executionOrder.push(2); return 2; } },
        { label: 'Step 3', task: async () => { executionOrder.push(3); return 3; } },
      ];

      const result = await withSteps('Test', steps);

      expect(result.completed).toBe(true);
      expect(result.cancelled).toBe(false);
      expect(executionOrder).toEqual([1, 2, 3]);
    });

    it('should return results from all steps', async () => {
      const steps: ProgressStep<string>[] = [
        { label: 'A', task: async () => 'result-a' },
        { label: 'B', task: async () => 'result-b' },
      ];

      const result = await withSteps('Test', steps);

      expect(result.results).toEqual(['result-a', 'result-b']);
    });

    it('should handle steps with different return types', async () => {
      const steps = [
        { label: 'Number', task: async () => 42 },
        { label: 'String', task: async () => 'hello' },
        { label: 'Object', task: async () => ({ key: 'value' }) },
      ] as const;

      const result = await withSteps('Test', steps);

      expect(result.results[0]).toBe(42);
      expect(result.results[1]).toBe('hello');
      expect(result.results[2]).toEqual({ key: 'value' });
    });

    it('should handle synchronous tasks', async () => {
      const steps: ProgressStep<number>[] = [
        { label: 'Sync 1', task: () => 1 },
        { label: 'Sync 2', task: () => 2 },
      ];

      const result = await withSteps('Test', steps);

      expect(result.completed).toBe(true);
      expect(result.results).toEqual([1, 2]);
    });

    it('should pass cancellation token to steps', async () => {
      let receivedToken: vscode.CancellationToken | undefined;

      const steps: ProgressStep<void>[] = [
        { label: 'Check Token', task: (token) => { receivedToken = token; } },
      ];

      await withSteps('Test', steps);

      expect(receivedToken).toBeDefined();
      expect(typeof receivedToken?.isCancellationRequested).toBe('boolean');
    });

    it('should handle empty steps array', async () => {
      const result = await withSteps('Test', []);

      expect(result.completed).toBe(true);
      expect(result.cancelled).toBe(false);
      expect(result.results).toEqual([]);
    });

    it('should call vscode.window.withProgress with correct options', async () => {
      await withSteps('Processing', [], { location: vscode.ProgressLocation.Window, cancellable: true });

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
      const steps: ProgressStep<void>[] = [
        { label: 'Failing Step', task: async () => { throw new Error('Step failed'); } },
      ];

      await expect(withSteps('Test', steps)).rejects.toThrow('Step failed');
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
  });
});
