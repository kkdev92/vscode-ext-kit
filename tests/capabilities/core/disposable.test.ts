/**
 * Unit contract for synchronous, caller-owned disposable collections. It pins
 * LIFO cleanup, idempotence, late ownership, error aggregation, and
 * `context.subscriptions` integration. Failures indicate resource-lifetime
 * semantics in this utility, not the application `ResourceScope`.
 */
import { describe, expect, it, vi } from 'vitest';

import { DisposableCollection, createScope } from '../../../src/capabilities/core/disposable.js';

const disposable = (onDispose: () => void): { dispose(): void } => ({ dispose: onDispose });

describe('DisposableCollection', () => {
  it('add returns the same disposable for chaining', () => {
    const collection = new DisposableCollection();
    const item = disposable(() => undefined);

    expect(collection.add(item)).toBe(item);
    expect(collection.size).toBe(1);
  });

  it('push accepts several at once', () => {
    const collection = new DisposableCollection();
    collection.push(
      disposable(() => undefined),
      disposable(() => undefined)
    );

    expect(collection.size).toBe(2);
  });

  it('disposes in LIFO order', () => {
    const order: string[] = [];
    const collection = new DisposableCollection();
    collection.push(
      disposable(() => order.push('first')),
      disposable(() => order.push('second')),
      disposable(() => order.push('third'))
    );

    collection.dispose();

    expect(order).toEqual(['third', 'second', 'first']);
    expect(collection.size).toBe(0);
  });

  it('is idempotent', () => {
    const onDispose = vi.fn();
    const collection = new DisposableCollection();
    collection.add(disposable(onDispose));

    collection.dispose();
    collection.dispose();

    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it('disposes immediately when adding after disposal, without throwing', () => {
    const onDispose = vi.fn();
    const collection = new DisposableCollection();
    collection.dispose();

    const item = collection.add(disposable(onDispose));

    expect(item).toBeDefined();
    expect(onDispose).toHaveBeenCalledTimes(1);
    expect(collection.size).toBe(0);
  });

  it('rethrows a single cleanup error as-is', () => {
    const failure = new Error('boom');
    const survivor = vi.fn();
    const collection = new DisposableCollection();
    collection.push(disposable(survivor), {
      dispose: () => {
        throw failure;
      },
    });

    // Exactly one error is rethrown unwrapped rather than aggregated: a
    // caller catching it should see the failure it recognises, not a wrapper.
    expect(() => collection.dispose()).toThrow(failure);
    expect(survivor).toHaveBeenCalledTimes(1);
  });

  it('aggregates several cleanup errors', () => {
    const collection = new DisposableCollection();
    collection.push(
      {
        dispose: () => {
          throw new Error('first');
        },
      },
      {
        dispose: () => {
          throw new Error('second');
        },
      }
    );

    let caught: unknown;
    try {
      collection.dispose();
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(AggregateError);
    expect((caught as AggregateError).errors).toHaveLength(2);
  });

  it('supports using declarations via Symbol.dispose', () => {
    const onDispose = vi.fn();

    {
      using collection = new DisposableCollection();
      collection.add(disposable(onDispose));
    }

    expect(onDispose).toHaveBeenCalledTimes(1);
  });
});

describe('createScope', () => {
  it('registers itself in context.subscriptions', () => {
    const subscriptions: { dispose(): unknown }[] = [];
    const scope = createScope({ subscriptions });

    expect(subscriptions).toHaveLength(1);

    const onDispose = vi.fn();
    scope.add(disposable(onDispose));

    // Deactivation path: VS Code disposes subscriptions.
    for (const entry of subscriptions) {
      entry.dispose();
    }

    expect(onDispose).toHaveBeenCalledTimes(1);
  });

  it('can be disposed early, ahead of deactivation', () => {
    const subscriptions: { dispose(): unknown }[] = [];
    const scope = createScope({ subscriptions });
    const onDispose = vi.fn();
    scope.add(disposable(onDispose));

    scope.dispose();
    expect(onDispose).toHaveBeenCalledTimes(1);

    // Later deactivation disposal is a safe no-op.
    for (const entry of subscriptions) {
      entry.dispose();
    }
    expect(onDispose).toHaveBeenCalledTimes(1);
  });
});
