/**
 * Fault-injection regression suite for storage operations spanning a primary
 * and legacy key. It protects write-before-delete ordering, explicit-write
 * precedence, delete completeness, rejection handling, and queue recovery.
 * Failures signal possible data loss or resurrection even when ordinary
 * round-trip tests remain green.
 */
import { describe, expect, it } from 'vitest';

import { createTypedStorage } from '../../../src/capabilities/storage/typed-storage.js';
import type { MementoLike } from '../../../src/foundation/platform/ports.js';

/**
 * A Memento whose writes can be made to fail per key.
 *
 * The `MementoLike` port promises nothing about atomicity across two writes, so
 * "the primary write failed but the legacy delete succeeded" is a state the
 * contract permits. The engine must order operations so that state cannot
 * destroy the only copy of the value.
 */
function faultyMemento(options: { readonly failWritesTo?: readonly string[] } = {}): MementoLike & {
  readonly entries: Map<string, unknown>;
  readonly writes: string[];
} {
  const entries = new Map<string, unknown>();
  const writes: string[] = [];
  const failing = new Set(options.failWritesTo ?? []);
  return {
    entries,
    writes,
    get<T>(key: string): T | undefined {
      return entries.get(key) as T | undefined;
    },
    update(key: string, value: unknown): Promise<void> {
      writes.push(key);
      if (failing.has(key)) {
        return Promise.reject(new Error(`disk error writing "${key}"`));
      }
      if (value === undefined) {
        entries.delete(key);
      } else {
        entries.set(key, value);
      }
      return Promise.resolve();
    },
    keys(): readonly string[] {
      return [...entries.keys()];
    },
  };
}

const flushWrites = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('legacy-key migration atomicity', () => {
  it('keeps the legacy value when the primary write fails', async () => {
    const state = faultyMemento({ failWritesTo: ['new'] });
    state.entries.set('old', { v: 1, value: 'the-only-copy' });
    const storage = createTypedStorage<string>(state, 'new', {
      defaultValue: 'default',
      legacyKeys: ['old'],
    });

    expect(storage.get()).toBe('the-only-copy');
    await flushWrites();

    // The delete is ordered after the write, so a failed write leaves the
    // legacy entry alone and the value survives to be migrated next time.
    expect(storage.get()).toBe('the-only-copy');
    expect(state.entries.get('old')).toEqual({ v: 1, value: 'the-only-copy' });
    expect(state.writes).toEqual(['new']);
  });

  it('removes the legacy key only after the primary write succeeded', async () => {
    const state = faultyMemento();
    state.entries.set('old', { v: 1, value: 'moved' });
    const storage = createTypedStorage<string>(state, 'new', {
      defaultValue: 'default',
      legacyKeys: ['old'],
    });

    expect(storage.get()).toBe('moved');
    await flushWrites();

    expect(state.writes).toEqual(['new', 'old']);
    expect(state.entries.get('new')).toEqual({ v: 1, value: 'moved' });
    expect(state.entries.has('old')).toBe(false);
  });

  it('lets an explicit set win over a migration that started first', async () => {
    const state = faultyMemento();
    state.entries.set('old', { v: 1, value: 'from-legacy' });
    const storage = createTypedStorage<string>(state, 'new', {
      defaultValue: 'default',
      legacyKeys: ['old'],
    });

    // The read starts a queued migration write; the set is issued immediately
    // after and must be the value that survives.
    expect(storage.get()).toBe('from-legacy');
    await storage.set('explicit');
    await flushWrites();

    expect(storage.get()).toBe('explicit');
    expect(state.entries.get('new')).toEqual({ v: 1, value: 'explicit' });
  });

  it('does not resurrect a deleted value from an un-migrated legacy key', async () => {
    const state = faultyMemento();
    state.entries.set('old', { v: 1, value: 'legacy' });
    const storage = createTypedStorage<string>(state, 'new', {
      defaultValue: 'default',
      legacyKeys: ['old'],
    });

    // Delete covers configured legacy keys even when no read has yet started a
    // move; otherwise the next read would resurrect the removed value.
    await storage.delete();

    expect(storage.get()).toBe('default');
    expect(storage.has()).toBe(false);
    expect(state.entries.size).toBe(0);
  });

  it('does not leak a rejection when a migration write fails', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      const state = faultyMemento({ failWritesTo: ['new'] });
      state.entries.set('old', { v: 1, value: 'value' });
      const storage = createTypedStorage<string>(state, 'new', {
        defaultValue: 'default',
        legacyKeys: ['old'],
      });

      storage.get();
      await flushWrites();
      await flushWrites();
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('keeps serving values after a failed write, instead of wedging the queue', async () => {
    const state = faultyMemento({ failWritesTo: ['blocked'] });
    const storage = createTypedStorage<string>(state, 'blocked', { defaultValue: 'default' });

    await expect(storage.set('first')).rejects.toThrow(/disk error/);
    // A rejected write must not poison the queue for everything after it.
    await expect(storage.set('second')).rejects.toThrow(/disk error/);
    expect(state.writes).toEqual(['blocked', 'blocked']);
  });
});

// Node globals the repo's tsconfig deliberately omits, declared locally.
declare const process: {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
};
