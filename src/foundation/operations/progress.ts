import type { ProgressArea, ProgressCapability, ProgressReporterLike } from '../platform/ports.js';
import { combineAbortSignals, toAbortSignal } from './cancellation.js';

/** Options for {@link OperationProgress.run}. */
export interface OperationProgressOptions {
  /** Progress title displayed to the user. */
  readonly title: string;
  /** Where the progress UI is rendered (default: `'notification'`). */
  readonly location?: ProgressArea | undefined;
  /** Whether the user can cancel from the progress UI (default: `false`). */
  readonly cancellable?: boolean | undefined;
}

/** One step in a {@link OperationProgress.steps} run. */
export interface ProgressStep<T = void> {
  /** Shown while this step runs. */
  readonly label: string;
  /** The work. Receives the combined signal, like any other operation work. */
  readonly run: (signal: AbortSignal) => T | Promise<T>;
  /**
   * How much of the bar this step accounts for, relative to the others.
   *
   * @defaultValue 1
   */
  readonly weight?: number | undefined;
}

/** What a {@link OperationProgress.steps} run produced. */
export interface StepsOutcome<T extends readonly ProgressStep<unknown>[]> {
  /** Whether every step ran. */
  readonly completed: boolean;
  /** Whether the run stopped because it was cancelled. */
  readonly cancelled: boolean;
  /**
   * Each step's result, in order — a precise tuple, so destructuring keeps the
   * per-step types. Shorter than the step list when the run was cancelled.
   */
  readonly results: { [K in keyof T]: T[K] extends ProgressStep<infer R> ? R : never };
}

/**
 * Progress sessions scoped to one operation.
 *
 * The task's signal is the Operation signal *and* the user's cancel button
 * linked into one: aborting either aborts the task. Without a progress
 * capability (a headless test host, or a plan run outside VS Code) the task
 * still runs — reports go nowhere and the signal is the operation's own.
 */
export interface OperationProgress {
  /**
   * Runs a task under a progress UI.
   *
   * @example
   * ```ts
   * const projects = await context.progress.run(
   *   { title: 'Refreshing projects', cancellable: true },
   *   (progress, signal) => repository.refresh(signal)
   * );
   * ```
   */
  run<T>(
    options: OperationProgressOptions,
    task: (progress: ProgressReporterLike, signal: AbortSignal) => T | Promise<T>
  ): Promise<T>;

  /**
   * Runs steps in order, advancing the bar by each one's weight.
   *
   * Cancellation comes back as a value — `{ cancelled: true }` with the results
   * gathered so far — rather than as a thrown error, whether the signal aborted
   * between steps or a running step rejected because of it. A caller therefore
   * branches on `cancelled` alone instead of on `cancelled` *and* a try/catch.
   * Any error thrown after the combined signal has aborted is treated as that
   * cancellation; otherwise it propagates and no further step runs.
   *
   * Steps are rest arguments so the result tuple infers per step from an inline
   * call, with no `as const`.
   *
   * @example
   * ```ts
   * const outcome = await context.progress.steps(
   *   { title: 'Deploying', cancellable: true },
   *   { label: 'Building', run: (signal) => build(signal), weight: 3 },
   *   { label: 'Publishing', run: (signal) => publish(signal) }
   * );
   * if (outcome.cancelled) return;
   * const [built, published] = outcome.results;
   * ```
   */
  steps<T extends readonly ProgressStep<unknown>[]>(
    options: OperationProgressOptions,
    ...steps: T
  ): Promise<StepsOutcome<T>>;
}

const NOOP_REPORTER: ProgressReporterLike = {
  report(): void {
    // Headless: there is no UI to update.
  },
};

/**
 * Creates the {@link OperationProgress} facility for one Operation.
 *
 * The returned object owns no long-lived registration. Each visible progress
 * session detaches its temporary cancellation bridge when the task settles.
 *
 * @param capability - The progress UI, or `undefined` to run headless.
 * @param operationSignal - The Operation's combined cancellation signal.
 */
export function createOperationProgress(
  capability: ProgressCapability | undefined,
  operationSignal: AbortSignal
): OperationProgress {
  const progress: OperationProgress = {
    async run<T>(
      options: OperationProgressOptions,
      task: (progress: ProgressReporterLike, signal: AbortSignal) => T | Promise<T>
    ): Promise<T> {
      if (capability === undefined) {
        return task(NOOP_REPORTER, operationSignal);
      }
      return capability.run(
        {
          title: options.title,
          location: options.location ?? 'notification',
          cancellable: options.cancellable ?? false,
        },
        async (reporter, token) => {
          // The user's cancel button and the operation's own cancellation are
          // one signal to the task. Detach on settle: the operation signal is
          // long-lived relative to a progress session.
          const combined = combineAbortSignals([operationSignal, toAbortSignal(token)]);
          try {
            return await task(reporter, combined.signal);
          } finally {
            combined.dispose();
          }
        }
      );
    },

    steps<T extends readonly ProgressStep<unknown>[]>(
      options: OperationProgressOptions,
      ...steps: T
    ): Promise<StepsOutcome<T>> {
      for (const step of steps) {
        const weight = step.weight ?? 1;
        if (!Number.isFinite(weight) || weight <= 0) {
          // Thrown rather than clamped: a zero or NaN weight makes the whole
          // bar meaningless, and silently substituting 1 hides the mistake.
          throw new TypeError(
            `Step "${step.label}" has weight ${String(step.weight)}; ` +
              'every weight must be a positive, finite number.'
          );
        }
      }
      const totalWeight = steps.reduce((sum, step) => sum + (step.weight ?? 1), 0);

      return progress.run(options, async (reporter, signal) => {
        const results: unknown[] = [];
        let reported = 0;

        const stopped = (): StepsOutcome<T> => ({
          completed: false,
          cancelled: true,
          results: results as StepsOutcome<T>['results'],
        });

        for (const step of steps) {
          if (signal.aborted) {
            return stopped();
          }

          reporter.report({ message: step.label });

          let result: unknown;
          try {
            result = await step.run(signal);
          } catch (error) {
            // A step that rejects *because* it was cancelled is a cancellation,
            // not a failure, and reporting it the same way as one caught
            // between steps is what lets a caller branch on `cancelled` alone.
            // A genuine error still propagates.
            if (signal.aborted) {
              return stopped();
            }
            throw error;
          }
          results.push(result);

          const increment = ((step.weight ?? 1) / totalWeight) * 100;
          reporter.report({ increment });
          reported += increment;
        }

        // Float error accumulates across per-step increments; settle at exactly
        // 100 so a completed run never sits at 99%.
        if (reported < 100) {
          reporter.report({ increment: 100 - reported });
        }

        return {
          completed: true,
          cancelled: false,
          results: results as StepsOutcome<T>['results'],
        };
      });
    },
  };

  return progress;
}
