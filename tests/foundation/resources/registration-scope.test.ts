/**
 * Pure RegistrationScope ownership tests for synchronous LIFO cleanup,
 * aggregation and detached-child commit/rollback semantics. No Application or
 * platform fake is involved; asynchronous cleanup belongs to ResourceScope
 * tests.
 */
import { describe, expect, it, vi } from 'vitest';

import { ScopeCleanupError } from '../../../src/foundation/internal/errors.js';
import { createRegistrationScope } from '../../../src/foundation/resources/registration-scope.js';

// Tests execute on Node, but the repo's tsconfig deliberately omits Node types
// (the runtime core must not reach them). Declare the two Node globals this
// test needs, scoped to this file.
declare const process: {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
};

const registration = (onDispose: () => void): { dispose(): void } => ({ dispose: onDispose });

describe('createRegistrationScope', () => {
  it('returns the registration unchanged so it can be used inline', () => {
    const scope = createRegistrationScope('root');
    const item = registration(() => undefined);

    expect(scope.own(item)).toBe(item);
    expect(scope.size).toBe(1);
    expect(scope.disposed).toBe(false);
  });

  it('disposes in LIFO order across own and defer', () => {
    const order: string[] = [];
    const scope = createRegistrationScope('root');

    scope.own(registration(() => order.push('first')));
    scope.defer(() => order.push('second'));
    scope.own(registration(() => order.push('third')));

    scope.dispose();

    expect(order).toEqual(['third', 'second', 'first']);
    expect(scope.disposed).toBe(true);
    expect(scope.size).toBe(0);
  });

  it('is idempotent: a second dispose does nothing', () => {
    const onDispose = vi.fn();
    const scope = createRegistrationScope('root');
    scope.own(registration(onDispose));

    scope.dispose();
    scope.dispose();

    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it('attempts every entry and aggregates the failures', () => {
    const survivor = vi.fn();
    const scope = createRegistrationScope('root');

    scope.own(
      registration(() => {
        throw new Error('first failure');
      })
    );
    scope.own(registration(survivor));
    scope.own(
      registration(() => {
        throw new Error('second failure');
      })
    );

    let caught: unknown;
    try {
      scope.dispose();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ScopeCleanupError);
    const cleanupError = caught as ScopeCleanupError;
    expect(cleanupError.scopeName).toBe('root');
    expect(cleanupError.errors).toHaveLength(2);
    // The failure between them did not stop the rest of the unwind.
    expect(survivor).toHaveBeenCalledTimes(1);
  });

  it('disposes immediately when owning into a disposed scope', () => {
    const onDispose = vi.fn();
    const scope = createRegistrationScope('root');
    scope.dispose();

    scope.own(registration(onDispose));

    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(scope.size).toBe(0);
  });

  it('runs a deferred cleanup immediately when the scope is already disposed', () => {
    const cleanup = vi.fn();
    const scope = createRegistrationScope('root');
    scope.dispose();

    scope.defer(cleanup);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  describe('detached children', () => {
    it('are not owned by the parent until attached', () => {
      const onDispose = vi.fn();
      const parent = createRegistrationScope('parent');
      const child = parent.detachedChild('child');
      child.own(registration(onDispose));

      parent.dispose();

      expect(onDispose).not.toHaveBeenCalled();
      expect(child.disposed).toBe(false);
    });

    it('name themselves with the parent path', () => {
      const parent = createRegistrationScope('parent');
      expect(parent.detachedChild('child').name).toBe('parent/child');
    });

    it('are disposed with the parent once attached', () => {
      const onDispose = vi.fn();
      const parent = createRegistrationScope('parent');
      const child = parent.detachedChild('child');
      child.own(registration(onDispose));

      parent.attach(child);
      expect(parent.size).toBe(1);

      parent.dispose();

      expect(onDispose).toHaveBeenCalledTimes(1);
      expect(child.disposed).toBe(true);
    });

    it('unwind child before parent entries', () => {
      const order: string[] = [];
      const parent = createRegistrationScope('parent');
      parent.own(registration(() => order.push('parent-entry')));

      const child = parent.detachedChild('child');
      child.own(registration(() => order.push('child-entry')));
      parent.attach(child);

      parent.dispose();

      expect(order).toEqual(['child-entry', 'parent-entry']);
    });

    it('reject a double attach', () => {
      const parent = createRegistrationScope('parent');
      const other = createRegistrationScope('other');
      const child = parent.detachedChild('child');

      parent.attach(child);

      expect(() => parent.attach(child)).toThrow(/already owned/);
      expect(() => other.attach(child)).toThrow(/already owned/);
    });

    it('reject attaching a disposed child', () => {
      const parent = createRegistrationScope('parent');
      const child = parent.detachedChild('child');
      child.dispose();

      expect(() => parent.attach(child)).toThrow(/already disposed/);
    });

    it('reject attaching something that is not a scope', () => {
      const parent = createRegistrationScope('parent');
      const fake = { name: 'fake', disposed: false } as unknown as ReturnType<
        typeof createRegistrationScope
      >;

      expect(() => parent.attach(fake)).toThrow(TypeError);
    });

    it('dispose the child immediately when the parent is already disposed', () => {
      const onDispose = vi.fn();
      const parent = createRegistrationScope('parent');
      const child = parent.detachedChild('child');
      child.own(registration(onDispose));
      parent.dispose();

      parent.attach(child);

      expect(onDispose).toHaveBeenCalledTimes(1);
      expect(child.disposed).toBe(true);
    });
  });

  describe('a registration whose dispose is asynchronous', () => {
    /**
     * This scope's reason to exist is that ingress is closed by the time
     * `dispose()` returns. It cannot await anything, so accepting a promise
     * would leave that promise unwatched while the guarantee still reads as
     * kept. Nothing in the type system stops such a registration arriving here:
     * `dispose(): unknown` accepts it, as does TypeScript's `void`-return rule.
     */
    it('is reported rather than silently unwatched', () => {
      const scope = createRegistrationScope('root');
      scope.own({ dispose: () => Promise.resolve() });

      expect(() => {
        scope.dispose();
      }).toThrow(ScopeCleanupError);
    });

    it('does not stop the registrations around it from being released', () => {
      const before = vi.fn();
      const after = vi.fn();
      const scope = createRegistrationScope('root');
      scope.own(registration(before));
      scope.own({ dispose: () => Promise.resolve() });
      scope.own(registration(after));

      expect(() => {
        scope.dispose();
      }).toThrow(ScopeCleanupError);
      expect(before).toHaveBeenCalledTimes(1);
      expect(after).toHaveBeenCalledTimes(1);
    });

    it('has its rejection claimed, so abandoning it stays quiet', async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on('unhandledRejection', onUnhandled);
      try {
        const scope = createRegistrationScope('root');
        scope.own({ dispose: () => Promise.reject(new Error('close failed')) });

        expect(() => {
          scope.dispose();
        }).toThrow(ScopeCleanupError);

        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });
});
