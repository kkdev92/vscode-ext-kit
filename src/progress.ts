import * as vscode from 'vscode';
import type { ProgressOptions } from './types.js';

/**
 * Progress reporter for reporting progress updates.
 */
export type ProgressReporter = vscode.Progress<{ message?: string; increment?: number }>;

/**
 * A step in a multi-step progress operation.
 */
export interface ProgressStep<T = void> {
  /** Label displayed during this step */
  label: string;
  /** The async task to execute for this step */
  task: (token: vscode.CancellationToken) => T | Promise<T>;
  /** Optional weight for progress calculation (default: 1) */
  weight?: number;
}

/**
 * Options for step-based progress.
 */
export interface StepsProgressOptions extends ProgressOptions {
  /** Whether the operation can be cancelled (default: false) */
  cancellable?: boolean;
}

/**
 * Result of a step-based progress operation.
 */
export interface StepsResult<T extends readonly ProgressStep<unknown>[]> {
  /** Whether all steps completed successfully */
  completed: boolean;
  /** Whether the operation was cancelled */
  cancelled: boolean;
  /** Results from each step (in order) */
  results: { [K in keyof T]: T[K] extends ProgressStep<infer R> ? R : never };
}

/**
 * Displays a progress notification while executing a task.
 *
 * @param title - Progress message displayed to user
 * @param task - Function to execute with progress reporter and cancellation token
 * @param opts - Progress options
 * @returns Result of the task function
 *
 * @example
 * ```typescript
 * // With progress reporting
 * const result = await withProgress('Processing...', async (progress, token) => {
 *   for (let i = 0; i < 100; i++) {
 *     if (token.isCancellationRequested) {
 *       return undefined;
 *     }
 *     progress.report({ increment: 1, message: `Step ${i + 1}` });
 *     await processItem(i);
 *   }
 *   return 'Done!';
 * }, { cancellable: true });
 *
 * // Simple progress without reporting
 * await withProgress('Loading data...', async () => {
 *   return await fetchData();
 * });
 * ```
 */
export async function withProgress<T>(
  title: string,
  task: (progress: ProgressReporter, token: vscode.CancellationToken) => T | Promise<T>,
  opts: ProgressOptions = {}
): Promise<T> {
  const { location = vscode.ProgressLocation.Notification, cancellable = false } = opts;

  return vscode.window.withProgress(
    {
      location,
      title,
      cancellable,
    },
    async (progress, token) => {
      return await Promise.resolve(task(progress, token));
    }
  );
}

/**
 * Executes multiple steps with automatic progress tracking.
 *
 * Each step's progress is calculated based on its weight (default: 1).
 * Progress is automatically reported after each step completes.
 *
 * @param title - Progress title displayed to user
 * @param steps - Array of steps to execute in order
 * @param opts - Progress options
 * @returns Result object containing completion status and results from each step
 *
 * @example
 * ```typescript
 * // Basic usage
 * const result = await withSteps('Deploying...', [
 *   { label: 'Building', task: async () => await build() },
 *   { label: 'Testing', task: async () => await runTests() },
 *   { label: 'Publishing', task: async () => await publish() },
 * ]);
 *
 * if (result.completed) {
 *   console.log('All steps completed');
 * }
 *
 * // With weights (heavier steps show more progress)
 * const result = await withSteps('Processing...', [
 *   { label: 'Downloading', task: download, weight: 3 },
 *   { label: 'Processing', task: process, weight: 5 },
 *   { label: 'Uploading', task: upload, weight: 2 },
 * ], { cancellable: true });
 *
 * // Access individual step results
 * const [downloadResult, processResult, uploadResult] = result.results;
 *
 * // Handle cancellation
 * if (result.cancelled) {
 *   console.log('Operation was cancelled');
 * }
 * ```
 */
export async function withSteps<T extends readonly ProgressStep<unknown>[]>(
  title: string,
  steps: T,
  opts: StepsProgressOptions = {}
): Promise<StepsResult<T>> {
  const { location = vscode.ProgressLocation.Notification, cancellable = false } = opts;

  // Calculate total weight for progress calculation
  const totalWeight = steps.reduce((sum, step) => sum + (step.weight ?? 1), 0);

  return vscode.window.withProgress(
    {
      location,
      title,
      cancellable,
    },
    async (progress, token) => {
      const results: unknown[] = [];

      for (const step of steps) {
        // Check for cancellation before each step
        if (token.isCancellationRequested) {
          return {
            completed: false,
            cancelled: true,
            results: results as StepsResult<T>['results'],
          };
        }

        // Report current step
        progress.report({ message: step.label });

        // Execute the step
        const result = await Promise.resolve(step.task(token));
        results.push(result);

        // Calculate and report progress
        const stepWeight = step.weight ?? 1;
        const increment = (stepWeight / totalWeight) * 100;
        progress.report({ increment });
      }

      return {
        completed: true,
        cancelled: false,
        results: results as StepsResult<T>['results'],
      };
    }
  );
}

/**
 * Converts a VS Code CancellationToken to an AbortSignal.
 *
 * Useful for integrating with APIs that expect AbortSignal (like fetch).
 *
 * @param token - VS Code cancellation token
 * @returns AbortSignal that aborts when the token is cancelled
 *
 * @example
 * ```typescript
 * await withProgress('Fetching...', async (progress, token) => {
 *   const signal = toAbortSignal(token);
 *   const response = await fetch(url, { signal });
 *   return await response.json();
 * }, { cancellable: true });
 * ```
 */
export function toAbortSignal(token: vscode.CancellationToken): AbortSignal {
  const controller = new AbortController();

  if (token.isCancellationRequested) {
    controller.abort();
  } else {
    token.onCancellationRequested(() => controller.abort());
  }

  return controller.signal;
}
