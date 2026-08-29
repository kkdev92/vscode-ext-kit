import { ScopeCleanupError } from '../internal/errors.js';
import { claimRejection, isThenable } from '../internal/thenable.js';
import type { Registration, ScopeInspection } from './registration-scope.js';

/** Options for {@link createResourceScope}. */
export interface ResourceScopeOptions {
  /**
   * Lifetime signal supplied by the owner and exposed unchanged by the scope.
   * Calling `scope.dispose()` does not abort it.
   */
  readonly signal: AbortSignal;
}

/**
 * Owns resource cleanups, including teardown that must be awaited: services,
 * connections, flushes and closes. Use `deferAsync` for a promise-returning
 * cleanup callback; `defer` is the synchronous convenience path, and `own`
 * takes a disposable whose own teardown may be either.
 *
 * Kept separate from `RegistrationScope` so that stopping can close ingress
 * synchronously first, then drain async work under a budget.
 *
 * @example
 * ```ts
 * const scope = createResourceScope('projects', { signal });
 * scope.deferAsync(() => connection.close());
 * await scope.dispose();
 * ```
 */
export interface ResourceScope {
  /** Diagnostic name, including the parent path for child scopes. */
  readonly name: string;
  /** Whether disposal has started. */
  readonly disposed: boolean;
  /** Number of cleanup entries still held. */
  readonly size: number;
  /**
   * The owner-supplied lifetime signal. Child scopes share this exact signal;
   * disposing this scope does not abort it.
   */
  readonly signal: AbortSignal;

  /**
   * Takes ownership of a disposable resource and returns it unchanged.
   *
   * A `dispose()` that returns a promise is awaited in place during teardown,
   * so ordering holds and a rejection is collected like any other cleanup
   * failure. Prefer `deferAsync` when the intent is async teardown — it says so
   * at the registration site, where a reader is looking.
   *
   * Owning into an already-disposed scope disposes the resource immediately.
   * That path cannot await anything, so an async disposal there **throws**
   * after claiming the promise's rejection. A synchronous disposal that throws
   * propagates to the caller.
   */
  own<T extends Registration>(resource: T): T;

  /**
   * Registers a synchronous cleanup callback. Runs immediately if already
   * disposed; any exception then propagates to the caller. Do not pass an
   * `async` function: TypeScript permits one where `void` is expected, but its
   * promise cannot be handled when registration happens after disposal. Use
   * {@link ResourceScope.deferAsync} for every promise-returning callback.
   */
  defer(cleanup: () => void): void;

  /**
   * Registers an asynchronous cleanup callback.
   *
   * Unlike {@link ResourceScope.defer}, registering after disposal **throws**
   * without invoking `cleanup`: nothing could await it, so running it here
   * would only produce an unhandled rejection.
   */
  deferAsync(cleanup: () => Promise<void>): void;

  /**
   * Creates a detached child with the same lifetime signal and a nested
   * diagnostic name. The caller owns it until `attach` succeeds.
   */
  detachedChild(name: string): ResourceScope;

  /**
   * Transfers ownership of a distinct, live, unattached child to this scope.
   * Pass a scope returned by `detachedChild`; attaching a scope to itself is
   * invalid. Runtime checks reject values not made by `createResourceScope`,
   * double attachment, a disposed child and a disposed parent.
   */
  attach(child: ResourceScope): void;

  /**
   * Disposes every entry in LIFO order, awaiting async cleanups one at a time
   * so ordering is preserved. Failures are collected, not short-circuited, and
   * thrown together as a {@link ScopeCleanupError}. Calling twice returns the
   * same promise.
   */
  dispose(): Promise<void>;

  /**
   * Reports what this scope and its attached children still hold. Safe to call
   * while disposal is in progress, which is exactly when a shutdown that ran
   * out of budget wants to know.
   */
  inspect(): ScopeInspection;
}

interface ScopeInternals {
  attached: boolean;
}

const internals = new WeakMap<ResourceScope, ScopeInternals>();

/**
 * Creates an async-capable resource scope.
 *
 * @example
 * ```ts
 * const controller = new AbortController();
 * const scope = createResourceScope('extension', { signal: controller.signal });
 * ```
 */
export function createResourceScope(name: string, options: ResourceScopeOptions): ResourceScope {
  const cleanups: Array<() => void | Promise<void>> = [];
  // Tracked apart from `cleanups`, which holds opaque callbacks: a child is
  // the one entry that can name itself, and naming is the point of `inspect`.
  const children: ResourceScope[] = [];
  let disposed = false;
  let disposePromise: Promise<void> | undefined;

  const runDispose = async (): Promise<void> => {
    const errors: unknown[] = [];
    for (let index = cleanups.length - 1; index >= 0; index -= 1) {
      const cleanup = cleanups[index];
      if (cleanup === undefined) {
        continue;
      }
      try {
        // Sequential on purpose: LIFO ordering is part of the contract.
        await cleanup();
      } catch (error) {
        errors.push(error);
      }
    }
    cleanups.length = 0;
    children.length = 0;

    if (errors.length > 0) {
      throw new ScopeCleanupError(name, errors);
    }
  };

  const scope: ResourceScope = {
    get name(): string {
      return name;
    },

    get disposed(): boolean {
      return disposed;
    },

    get size(): number {
      return cleanups.length;
    },

    get signal(): AbortSignal {
      return options.signal;
    },

    own<T extends Registration>(resource: T): T {
      if (disposed) {
        // Nothing is left to await the teardown of a resource handed to a dead
        // scope, so an async one fails loudly here rather than becoming an
        // unhandled rejection — the same reasoning as `deferAsync` below.
        const result = resource.dispose();
        if (isThenable(result)) {
          claimRejection(result);
          throw new Error(
            `Cannot own an asynchronously disposed resource on disposed scope "${name}". ` +
              'Await the disposal at the call site instead.'
          );
        }
        return resource;
      }
      cleanups.push(() => {
        // Returned, not discarded: `Registration.dispose` is typed as returning
        // `unknown`, and TypeScript accepts a promise-returning method wherever
        // one returning `void` is expected. Handing the promise back lets
        // `runDispose` await it in place, which keeps LIFO ordering true for
        // async teardown and routes a rejection into `ScopeCleanupError`
        // instead of losing it.
        const result = resource.dispose();
        return isThenable(result) ? Promise.resolve(result).then(() => undefined) : undefined;
      });
      return resource;
    },

    defer(cleanup: () => void): void {
      if (disposed) {
        cleanup();
        return;
      }
      cleanups.push(cleanup);
    },

    deferAsync(cleanup: () => Promise<void>): void {
      if (disposed) {
        // An async cleanup registered after teardown can never be awaited by
        // anyone: running it here and voiding the promise would turn a failure
        // into an unhandled rejection. Registering into a dead scope is a
        // caller bug, so it fails loudly and synchronously instead.
        throw new Error(
          `Cannot register async cleanup on disposed scope "${name}". ` +
            'Await the cleanup at the call site instead.'
        );
      }
      cleanups.push(cleanup);
    },

    detachedChild(childName: string): ResourceScope {
      return createResourceScope(`${name}/${childName}`, options);
    },

    attach(child: ResourceScope): void {
      const childInternals = internals.get(child);
      if (childInternals === undefined) {
        throw new TypeError(`Cannot attach "${child.name}": not a resource scope.`);
      }
      if (childInternals.attached) {
        throw new Error(`Cannot attach "${child.name}": already owned by another scope.`);
      }
      if (child.disposed) {
        throw new Error(`Cannot attach "${child.name}": already disposed.`);
      }
      if (disposed) {
        // The parent is gone, so nothing would ever await the child's async
        // cleanup: disposing it here and voiding the promise would turn a
        // cleanup failure into an unhandled rejection (the same reasoning as
        // deferAsync above). Attaching to a dead scope is a caller bug.
        throw new Error(
          `Cannot attach "${child.name}" to disposed scope "${name}". ` +
            'Dispose the child at the call site instead.'
        );
      }
      childInternals.attached = true;
      children.push(child);
      cleanups.push(() => child.dispose());
    },

    inspect(): ScopeInspection {
      return {
        name,
        size: cleanups.length,
        children: children.map((child) => child.inspect()),
      };
    },

    dispose(): Promise<void> {
      if (disposePromise !== undefined) {
        return disposePromise;
      }
      disposed = true;
      disposePromise = runDispose();
      return disposePromise;
    },
  };

  internals.set(scope, { attached: false });
  return scope;
}
