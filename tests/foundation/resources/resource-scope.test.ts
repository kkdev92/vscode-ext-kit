/**
 * Pure ResourceScope tests for awaited LIFO teardown, single-flight disposal and
 * detached-child ownership. Native promises and a scoped Node rejection
 * recorder exercise async failure behavior; Application shutdown budgets are
 * tested at the Host layer.
 */
import { describe, expect, it, vi } from 'vitest';

import { ScopeCleanupError } from '../../../src/foundation/internal/errors.js';
import { createResourceScope } from '../../../src/foundation/resources/resource-scope.js';

// Tests execute on Node, but the repo's tsconfig deliberately omits Node types
// (the runtime core must not reach them). Declare the two Node globals this
// test needs, scoped to this file.
declare const process: {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
};

const scopeOptions = (): { signal: AbortSignal } => ({ signal: new AbortController().signal });

describe('createResourceScope', () => {
  it('exposes the lifetime signal', () => {
    const controller = new AbortController();
    const scope = createResourceScope('root', { signal: controller.signal });

    expect(scope.signal.aborted).toBe(false);
    controller.abort();
    expect(scope.signal.aborted).toBe(true);
  });

  it('awaits async cleanups sequentially in LIFO order', async () => {
    const order: string[] = [];
    const scope = createResourceScope('root', scopeOptions());

    scope.deferAsync(async () => {
      await Promise.resolve();
      order.push('first-async');
    });
    scope.defer(() => order.push('second-sync'));
    scope.deferAsync(async () => {
      await Promise.resolve();
      order.push('third-async');
    });

    await scope.dispose();

    expect(order).toEqual(['third-async', 'second-sync', 'first-async']);
  });

  it('does not start the next cleanup before the previous one settles', async () => {
    const events: string[] = [];
    const scope = createResourceScope('root', scopeOptions());

    scope.deferAsync(async () => {
      events.push('second-start');
      await Promise.resolve();
      events.push('second-end');
    });
    scope.deferAsync(async () => {
      events.push('first-start');
      await Promise.resolve();
      events.push('first-end');
    });

    await scope.dispose();

    expect(events).toEqual(['first-start', 'first-end', 'second-start', 'second-end']);
  });

  it('is single-flight: concurrent disposals share one promise and run cleanup once', async () => {
    const cleanup = vi.fn(async () => {
      await Promise.resolve();
    });
    const scope = createResourceScope('root', scopeOptions());
    scope.deferAsync(cleanup);

    const first = scope.dispose();
    const second = scope.dispose();

    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('aggregates failures from both sync and async cleanups', async () => {
    const survivor = vi.fn();
    const scope = createResourceScope('root', scopeOptions());

    scope.defer(() => {
      throw new Error('sync failure');
    });
    scope.defer(survivor);
    scope.deferAsync(async () => {
      await Promise.resolve();
      throw new Error('async failure');
    });

    await expect(scope.dispose()).rejects.toBeInstanceOf(ScopeCleanupError);
    expect(survivor).toHaveBeenCalledTimes(1);
  });

  it('disposes immediately when owning into a disposed scope', async () => {
    const onDispose = vi.fn();
    const scope = createResourceScope('root', scopeOptions());
    await scope.dispose();

    scope.own({ dispose: onDispose });

    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it('runs a deferred cleanup immediately when already disposed', async () => {
    const cleanup = vi.fn();
    const scope = createResourceScope('root', scopeOptions());
    await scope.dispose();

    scope.defer(cleanup);

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  describe('a resource whose own dispose is asynchronous', () => {
    /**
     * `Registration.dispose` is typed as returning `unknown`, and TypeScript
     * accepts a promise-returning method wherever one returning `void` is
     * expected — so this reaches `own()` without a single complaint at the call
     * site. Dropping the promise there would break ordering silently and turn
     * a teardown failure into an unhandled rejection.
     */
    it('is awaited in place, so later cleanups still run after it', async () => {
      const order: string[] = [];
      const scope = createResourceScope('root', scopeOptions());

      scope.defer(() => {
        order.push('registered first, disposed last');
      });
      scope.own({
        dispose: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
          order.push('slow async dispose');
        },
      });

      await scope.dispose();

      expect(order).toEqual(['slow async dispose', 'registered first, disposed last']);
    });

    it('reports a rejected disposal like any other cleanup failure', async () => {
      const scope = createResourceScope('root', scopeOptions());
      scope.own({ dispose: () => Promise.reject(new Error('close failed')) });

      await expect(scope.dispose()).rejects.toThrow(ScopeCleanupError);
    });

    it('is refused by an already-disposed scope, which has nothing left to await', async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on('unhandledRejection', onUnhandled);
      try {
        const scope = createResourceScope('root', scopeOptions());
        await scope.dispose();

        expect(() =>
          scope.own({ dispose: () => Promise.reject(new Error('close failed')) })
        ).toThrow(/disposed scope "root"/);

        // The abandoned promise is claimed, so its rejection does not escape on
        // top of the error the caller already received.
        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });

  it('refuses an async cleanup after disposal rather than orphaning the promise', async () => {
    const cleanup = vi.fn(async () => {
      await Promise.resolve();
    });
    const scope = createResourceScope('root', scopeOptions());
    await scope.dispose();

    // Voiding the promise here would surface any failure as an unhandled rejection.
    expect(() => scope.deferAsync(cleanup)).toThrow(/disposed scope "root"/);
    expect(cleanup).not.toHaveBeenCalled();
  });

  describe('detached children', () => {
    it('are not owned by the parent until attached', async () => {
      const cleanup = vi.fn();
      const parent = createResourceScope('parent', scopeOptions());
      const child = parent.detachedChild('child');
      child.defer(cleanup);

      await parent.dispose();

      expect(cleanup).not.toHaveBeenCalled();
      expect(child.disposed).toBe(false);
    });

    it('inherit the parent signal and name', () => {
      const controller = new AbortController();
      const parent = createResourceScope('parent', { signal: controller.signal });
      const child = parent.detachedChild('child');

      expect(child.name).toBe('parent/child');
      expect(child.signal).toBe(controller.signal);
    });

    it('unwind child before parent entries once attached', async () => {
      const order: string[] = [];
      const parent = createResourceScope('parent', scopeOptions());
      parent.defer(() => order.push('parent-entry'));

      const child = parent.detachedChild('child');
      child.deferAsync(async () => {
        await Promise.resolve();
        order.push('child-entry');
      });
      parent.attach(child);

      await parent.dispose();

      expect(order).toEqual(['child-entry', 'parent-entry']);
      expect(child.disposed).toBe(true);
    });

    it('reject a double attach and a disposed child', async () => {
      const parent = createResourceScope('parent', scopeOptions());
      const attached = parent.detachedChild('attached');
      parent.attach(attached);
      expect(() => parent.attach(attached)).toThrow(/already owned/);

      const gone = parent.detachedChild('gone');
      await gone.dispose();
      expect(() => parent.attach(gone)).toThrow(/already disposed/);
    });

    it('reject attaching something that is not a scope', () => {
      const parent = createResourceScope('parent', scopeOptions());
      const fake = { name: 'fake', disposed: false } as unknown as ReturnType<
        typeof createResourceScope
      >;

      expect(() => parent.attach(fake)).toThrow(TypeError);
    });

    it('rejects attaching to an already-disposed parent, keeping the child awaitable', async () => {
      const cleanup = vi.fn();
      const parent = createResourceScope('parent', scopeOptions());
      const child = parent.detachedChild('child');
      child.defer(cleanup);
      await parent.dispose();

      // Fire-and-forgetting the child's async cleanup here would turn its
      // failures into unhandled rejections — same reasoning as deferAsync.
      expect(() => parent.attach(child)).toThrow(/disposed scope "parent"/);

      // The caller keeps ownership and can dispose (and await) it directly.
      await child.dispose();
      expect(cleanup).toHaveBeenCalledTimes(1);
      expect(child.disposed).toBe(true);
    });

    it('does not lose a failing child cleanup when the parent is already disposed', async () => {
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on('unhandledRejection', onUnhandled);
      try {
        const parent = createResourceScope('parent', scopeOptions());
        const child = parent.detachedChild('child');
        child.deferAsync(() => Promise.reject(new Error('cleanup failed')));
        await parent.dispose();

        expect(() => parent.attach(child)).toThrow(/disposed scope/);
        // The rejection is observable at the call site instead of escaping.
        await expect(child.dispose()).rejects.toThrow(/Cleanup of scope/);

        await new Promise((resolve) => setTimeout(resolve, 0));
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });
});

describe('inspect', () => {
  const scopeOptions = { signal: new AbortController().signal };

  it('names the scope, counts its entries and walks its attached children', () => {
    const root = createResourceScope('extension', scopeOptions);
    root.deferAsync(() => Promise.resolve());
    const child = root.detachedChild('projects');
    child.defer(() => undefined);

    expect(root.inspect()).toEqual({ name: 'extension', size: 1, children: [] });

    root.attach(child);

    expect(root.inspect()).toEqual({
      name: 'extension',
      size: 2,
      children: [{ name: 'extension/projects', size: 1, children: [] }],
    });
  });

  it('reports nothing once disposed', async () => {
    const root = createResourceScope('extension', scopeOptions);
    root.attach(root.detachedChild('projects'));

    await root.dispose();

    expect(root.inspect()).toEqual({ name: 'extension', size: 0, children: [] });
  });
});
