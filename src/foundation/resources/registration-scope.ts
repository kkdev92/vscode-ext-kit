import { ScopeCleanupError } from '../internal/errors.js';
import { claimRejection, isThenable } from '../internal/thenable.js';

/**
 * Anything with a synchronous `dispose`, including every `vscode.Disposable`.
 * The return value is ignored; promise-returning teardown belongs in a
 * ResourceScope via `deferAsync`.
 */
export interface Registration {
  dispose(): unknown;
}

/**
 * Owns registrations that must be released **synchronously**, so that stopping
 * the host closes ingress immediately: no new command invocation or event
 * callback can arrive after `dispose()` returns.
 *
 * Use this for command registrations, event subscriptions, view registrations
 * and watchers. Anything needing async teardown belongs in a `ResourceScope`.
 *
 * @example
 * ```ts
 * const scope = createRegistrationScope('projects');
 * scope.own(vscode.commands.registerCommand('sample.refresh', handler));
 * scope.dispose(); // command is gone before this returns
 * ```
 */
export interface RegistrationScope {
  /** Diagnostic name, including the parent path for child scopes. */
  readonly name: string;
  /** Whether `dispose()` has already run. */
  readonly disposed: boolean;
  /** Number of cleanup entries still held. Framework-owned leak gates read this. */
  readonly size: number;

  /**
   * Takes ownership of a registration and returns it unchanged.
   *
   * Registering into an already-disposed scope disposes the registration
   * immediately rather than leaking it. An exception from that immediate
   * disposal propagates to the caller.
   *
   * A `dispose()` that returns a promise is rejected: this scope's whole
   * purpose is that teardown has finished by the time it returns. Own such a
   * resource in a `ResourceScope` instead.
   */
  own<T extends Registration>(registration: T): T;

  /**
   * Registers a synchronous cleanup callback. It runs in LIFO order with owned
   * registrations, or immediately when the scope is already disposed.
   */
  defer(cleanup: () => void): void;

  /**
   * Creates a child that is **not** yet owned by this scope.
   *
   * Activation builds into a detached child so a failure can dispose only that
   * child, leaving already-committed scopes untouched. Call `attach()` to
   * transfer ownership once the work succeeded.
   */
  detachedChild(name: string): RegistrationScope;

  /**
   * Transfers ownership of a detached child to this scope in constant time. If
   * the parent is already disposed, the child is disposed immediately instead.
   */
  attach(child: RegistrationScope): void;

  /**
   * Disposes every entry in LIFO order.
   *
   * A single failure never stops the remaining entries; all failures are
   * collected and thrown together as a {@link ScopeCleanupError}. Repeated
   * calls after the first are no-ops.
   */
  dispose(): void;
}

interface ScopeInternals {
  attached: boolean;
}

const internals = new WeakMap<RegistrationScope, ScopeInternals>();

/**
 * Creates a synchronous registration scope.
 *
 * @example
 * ```ts
 * const root = createRegistrationScope('extension');
 * const child = root.detachedChild('projects');
 * child.own(registerCommand());
 * root.attach(child); // commit
 * ```
 */
/**
 * Refuses a registration whose teardown is asynchronous.
 *
 * This scope exists so that stopping closes ingress the moment `dispose()`
 * returns; a promise it cannot await would make that guarantee false while
 * still looking kept. `Registration.dispose` is typed as returning `unknown`
 * and TypeScript accepts a promise-returning method wherever `void` is
 * expected, so the check has to happen here. The rejection is claimed first —
 * the promise is being abandoned either way, and an unhandled rejection on top
 * of the thrown error helps nobody.
 */
function rejectAsyncDisposal(result: unknown, scopeName: string): void {
  if (isThenable(result)) {
    claimRejection(result);
    throw new Error(
      `Registration in scope "${scopeName}" disposed asynchronously. ` +
        'This scope must close ingress synchronously; own the resource in a ResourceScope instead.'
    );
  }
}

export function createRegistrationScope(name: string): RegistrationScope {
  const cleanups: Array<() => void> = [];
  let disposed = false;

  const scope: RegistrationScope = {
    get name(): string {
      return name;
    },

    get disposed(): boolean {
      return disposed;
    },

    get size(): number {
      return cleanups.length;
    },

    own<T extends Registration>(registration: T): T {
      if (disposed) {
        rejectAsyncDisposal(registration.dispose(), name);
        return registration;
      }
      cleanups.push(() => {
        rejectAsyncDisposal(registration.dispose(), name);
      });
      return registration;
    },

    defer(cleanup: () => void): void {
      if (disposed) {
        cleanup();
        return;
      }
      cleanups.push(cleanup);
    },

    detachedChild(childName: string): RegistrationScope {
      return createRegistrationScope(`${name}/${childName}`);
    },

    attach(child: RegistrationScope): void {
      const childInternals = internals.get(child);
      if (childInternals === undefined) {
        throw new TypeError(`Cannot attach "${child.name}": not a registration scope.`);
      }
      if (childInternals.attached) {
        throw new Error(`Cannot attach "${child.name}": already owned by another scope.`);
      }
      if (child.disposed) {
        throw new Error(`Cannot attach "${child.name}": already disposed.`);
      }
      if (disposed) {
        // The parent is gone, so the child cannot outlive it.
        child.dispose();
        return;
      }
      childInternals.attached = true;
      cleanups.push(() => {
        child.dispose();
      });
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;

      const errors: unknown[] = [];
      // LIFO: children and later registrations unwind before earlier ones.
      for (let index = cleanups.length - 1; index >= 0; index -= 1) {
        const cleanup = cleanups[index];
        if (cleanup === undefined) {
          continue;
        }
        try {
          cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      cleanups.length = 0;

      if (errors.length > 0) {
        throw new ScopeCleanupError(name, errors);
      }
    },
  };

  internals.set(scope, { attached: false });
  return scope;
}
