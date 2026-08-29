/**
 * Aggregates every failure collected while tearing down a scope.
 *
 * Cleanup never stops at the first failure: each entry is attempted, the errors
 * are collected, and the caller receives all of them at once.
 *
 * @example
 * ```ts
 * try {
 *   scope.dispose();
 * } catch (error) {
 *   if (error instanceof ScopeCleanupError) {
 *     logger.error(`${error.scopeName} failed`, error.errors);
 *   }
 * }
 * ```
 */
export class ScopeCleanupError extends AggregateError {
  /** Name of the scope whose cleanup failed. */
  readonly scopeName: string;

  constructor(scopeName: string, errors: readonly unknown[]) {
    super(errors, `Cleanup of scope "${scopeName}" failed with ${errors.length} error(s).`);
    this.name = 'ScopeCleanupError';
    this.scopeName = scopeName;
  }
}

/**
 * Thrown when a host operation is requested in a state that cannot serve it,
 * such as starting a host that has already been stopped.
 *
 * @example
 * ```ts
 * await host.stop('deactivate');
 * await host.start(); // rejects with InvalidHostStateError
 * ```
 */
export class InvalidHostStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidHostStateError';
  }
}

/**
 * Thrown when a callback that must be synchronous returns a thenable.
 *
 * Module configuration, raw binding, service factories and command argument
 * validation all have synchronous boundaries. Their types catch ordinary
 * mistakes, while this error is the runtime guard for erased, cast or
 * structurally-compatible callbacks that still return a thenable.
 *
 * @example
 * ```ts
 * throw new AsyncCallbackError('module.configure', 'projects');
 * ```
 */
export class AsyncCallbackError extends Error {
  constructor(callbackName: string, owner: string) {
    super(
      `"${callbackName}" for "${owner}" returned a thenable. It must be synchronous: ` +
        'move asynchronous initialisation into a hosted service.'
    );
    this.name = 'AsyncCallbackError';
  }
}

/**
 * Thrown when a service cannot be resolved at runtime.
 *
 * Preflight normally catches missing and circular dependencies before anything
 * is instantiated. Runtime resolution still guards those cases for callers that
 * bypass compilation, and also rejects every resolver once container disposal
 * begins so shutdown code cannot create an unowned instance.
 *
 * @example
 * ```ts
 * container.get(UnregisteredToken); // throws ServiceResolutionError
 * ```
 */
export class ServiceResolutionError extends Error {
  /** Token id that failed to resolve. */
  readonly tokenId: string;

  constructor(tokenId: string, message: string) {
    super(message);
    this.name = 'ServiceResolutionError';
    this.tokenId = tokenId;
  }
}

/**
 * One thing preflight found wrong, as data.
 *
 * `code` is stable and meant for a program; `message` says the same thing to a
 * person. `subject` names what the problem is about — a module, a command, a
 * token, a storage key — and `moduleId` the module that declared it, when one
 * did. `path` is the dependency chain, for a cycle or a captive dependency.
 *
 * The codes `compileApplication` reports are listed on that function; the ones
 * `runtimePreflight` reports are listed on `RuntimeIssue`.
 */
export interface PreflightProblem {
  readonly code: string;
  readonly message: string;
  readonly subject?: string | undefined;
  readonly moduleId?: string | undefined;
  readonly path?: readonly string[] | undefined;
}

/**
 * Thrown when preflight rejects an application before any VS Code registration
 * happens. Carries every problem found, not just the first.
 *
 * `problems` is the structured form. `issues` is the same list as messages, in
 * the same order, for code that only wants to print them.
 *
 * @example
 * ```ts
 * try {
 *   compileApplication({ name: 'sample', modules });
 * } catch (error) {
 *   if (error instanceof PreflightError) {
 *     for (const problem of error.problems) {
 *       console.error(`${problem.code}: ${problem.message}`);
 *     }
 *   }
 * }
 * ```
 */
export class PreflightError extends Error {
  /** Every problem found, in the order detected. */
  readonly problems: readonly PreflightProblem[];
  /** Each problem's message, in the same order. */
  readonly issues: readonly string[];

  constructor(problems: readonly PreflightProblem[]) {
    const issues = problems.map((problem) => problem.message);
    super(
      `Application preflight failed with ${issues.length} problem(s):\n- ${issues.join('\n- ')}`
    );
    this.name = 'PreflightError';
    this.problems = problems;
    this.issues = issues;
  }
}
