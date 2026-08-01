import * as vscode from 'vscode';
import type { ProgressOptions } from '../core/types.js';
import { isCancellation } from '../core/run.js';

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
 * Cancellation — whether the token trips between steps or a running step
 * rejects because of it — comes back as `{ completed: false, cancelled: true }`
 * with the results gathered so far, never as a thrown error. That holds for the
 * `AbortError` a step gets from `toAbortSignal(token)` and for a
 * `vscode.CancellationError` a step throws itself, matching how `run`/`tryRun`
 * and `wizard` treat cancellation. Any other error propagates.
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
 * // Handle cancellation — one branch covers both "cancelled between steps"
 * // and "cancelled while a step was running"
 * if (result.cancelled) {
 *   console.log('Operation was cancelled');
 * }
 *
 * // A cancellable step forwarding the signal into the work it does
 * await withSteps(
 *   { title: 'Scanning...', cancellable: true },
 *   { label: 'Reading', task: (token) => scan(toAbortSignal(token)) }
 * );
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

        // Execute the step. A step cancelled mid-flight rejects — with an
        // `AbortError` when it was handed `toAbortSignal(token)`, or a
        // `CancellationError` when it threw one itself — and that is a
        // cancellation, not a failure. Report it the same way as a cancellation
        // caught between steps, so callers branch on `cancelled` alone rather
        // than on `cancelled` *and* a try/catch. Real errors still propagate.
        let result: unknown;
        try {
          result = await Promise.resolve(step.task(token));
        } catch (error) {
          if (token.isCancellationRequested || isCancellation(error)) {
            return {
              completed: false,
              cancelled: true,
              results: results as StepsResult<T>['results'],
            };
          }
          throw error;
        }
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

  // One bridge per token, remembered for the token's lifetime: without this,
  // every call parks another cancellation listener on the token, and a token
  // that never fires (the common case) accumulates them without bound. The
  // WeakMap keeps the token itself collectable.
  const cached = bridgedSignals.get(token);
  if (cached) {
    return cached;
  }

  const controller = new AbortController();
  // Dispose the event subscription once it fires — after that the token is
  // permanently cancelled and the cached AbortSignal.abort() path above (via
  // isCancellationRequested) takes over for later callers.
  const subscription = token.onCancellationRequested(() => {
    subscription.dispose();
    controller.abort();
  });

  bridgedSignals.set(token, controller.signal);
  return controller.signal;
}

/** Memoizes {@link toAbortSignal}'s token → signal bridges. */
const bridgedSignals = new WeakMap<vscode.CancellationToken, AbortSignal>();
