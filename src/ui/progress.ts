import * as vscode from 'vscode';
import type { ProgressOptions } from '../core/types.js';

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
 * Options for {@link withSteps}, combining the progress title with the
 * usual {@link StepsProgressOptions}.
 */
export interface WithStepsOptions extends StepsProgressOptions {
  /** Progress title displayed to user */
  title: string;
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
 * Steps are passed as rest arguments rather than an array so that
 * `StepsResult<T>['results']` infers a precise per-step tuple type (e.g.
 * `[number, string]`) straight from an inline call — no `as const` needed.
 * Passing an array `T[]` to a single array parameter loses that per-element
 * type (it widens to `T[]`); a rest parameter keeps each argument's literal
 * position and type intact.
 *
 * @param options - Progress title plus the usual progress options
 * @param steps - Steps to execute in order (as separate arguments, not an array)
 * @returns Result object containing completion status and results from each step
 *
 * @example
 * ```typescript
 * // Basic usage
 * const result = await withSteps(
 *   { title: 'Deploying...' },
 *   { label: 'Building', task: async () => await build() },
 *   { label: 'Testing', task: async () => await runTests() },
 *   { label: 'Publishing', task: async () => await publish() }
 * );
 *
 * if (result.completed) {
 *   console.log('All steps completed');
 * }
 *
 * // With weights (heavier steps show more progress) and per-step result types
 * const result = await withSteps(
 *   { title: 'Processing...', cancellable: true },
 *   { label: 'Downloading', task: download, weight: 3 },
 *   { label: 'Counting', task: () => 42, weight: 5 },
 *   { label: 'Uploading', task: upload, weight: 2 }
 * );
 *
 * // Access individual step results — result.results[1] is typed as number
 * const [downloadResult, count, uploadResult] = result.results;
 *
 * // Handle cancellation
 * if (result.cancelled) {
 *   console.log('Operation was cancelled');
 * }
 * ```
 */
export async function withSteps<T extends readonly ProgressStep<unknown>[]>(
  options: WithStepsOptions,
  ...steps: T
): Promise<StepsResult<T>> {
  const { title, location = vscode.ProgressLocation.Notification, cancellable = false } = options;

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
  if (token.isCancellationRequested) {
    return AbortSignal.abort();
  }

  const controller = new AbortController();
  // Dispose the event subscription once it fires, so repeated calls against
  // a long-lived token don't accumulate listeners.
  const subscription = token.onCancellationRequested(() => {
    subscription.dispose();
    controller.abort();
  });

  return controller.signal;
}
