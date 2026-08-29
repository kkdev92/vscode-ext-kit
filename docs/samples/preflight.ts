import { PreflightError } from '@kkdev92/vscode-ext-kit';

/**
 * Turns a preflight failure into lines a person can act on.
 *
 * `defineExtension` throws before VS Code is touched, with every problem it
 * found rather than the first. Each problem carries a stable `code` — for a
 * script or a test to branch on — and a `message` that says the same thing to
 * a person. Anything else is rethrown untouched.
 */
export function explainPreflight(error: unknown): readonly string[] {
  if (!(error instanceof PreflightError)) {
    throw error;
  }
  return error.problems.map((problem) =>
    problem.moduleId === undefined
      ? `${problem.code}: ${problem.message}`
      : `${problem.code} in ${problem.moduleId}: ${problem.message}`
  );
}

/**
 * The one check a CI step usually wants: did the graph change shape?
 *
 * A captive dependency — a singleton holding a transient — is the kind of
 * mistake that only shows up as a stale value weeks later. Preflight reports
 * it at import time, and the code makes it a one-line gate.
 */
export function holdsATransientCaptive(error: unknown): boolean {
  return (
    error instanceof PreflightError &&
    error.problems.some((problem) => problem.code === 'SERVICE_CAPTIVE_DEPENDENCY')
  );
}
