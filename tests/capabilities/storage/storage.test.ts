/**
 * Unit contract for one typed Memento key and the standalone scope factories.
 * It protects the persisted envelope, fallback/diagnostic split, migration and
 * TTL semantics, ordered writes, legacy-key moves, local events, and Settings
 * Sync aggregation. Failures here point to the storage engine rather than
 * application DI or the concrete VS Code adapter.
 */
import { describe, expect, it, vi } from 'vitest';

import { s } from '../../../src/capabilities/core/schema.js';
import {
  createGlobalStorage,
  createTypedStorage,
  createWorkspaceStorage,
  listStorageKeys,
} from '../../../src/capabilities/storage/typed-storage.js';
import { createFakeMemento, createFakeStorage } from '../../../src/testing/fakes/fake-storage.js';

const memento = (): ReturnType<typeof createFakeMemento> => createFakeMemento();

/**
 * Waits for the read path's own writes to land.
 *
 * A read is synchronous but can cause a write (a migration, or a move off a
 * legacy key), and nothing awaits it. Those writes are queued and ordered — the
 * primary key first, the legacy key only after it succeeded — so flushing takes
 * a macrotask rather than a single microtask.
 */
const flushWrites = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('createTypedStorage', () => {
  it('returns the default when nothing is stored', () => {
    const storage = createTypedStorage(memento(), 'key', { defaultValue: 7 });

    expect(storage.get()).toBe(7);
    expect(storage.has()).toBe(false);
  });

  it('round-trips a value through the envelope with a single write', async () => {
    const state = memento();
    const update = vi.spyOn(state, 'update');
    const storage = createTypedStorage(state, 'key', { defaultValue: 0, version: 3 });

    await storage.set(42);

    expect(storage.get()).toBe(42);
    expect(storage.has()).toBe(true);
    // One envelope, so one write. Two keys would leave a window where the
    // value and its version disagree.
    expect(update).toHaveBeenCalledExactlyOnceWith('key', { v: 3, value: 42 });
  });

  it('writes only the stable envelope fields required by the persisted format', async () => {
    const state = memento();
    const storage = createTypedStorage(state, 'key', { defaultValue: 'x', version: 2 });

    await storage.set('hello');

    // The on-disk shape is a compatibility surface. An unplanned field change
    // requires an explicit read/migration strategy before it can ship.
    expect(state._entries().get('key')).toEqual({ v: 2, value: 'hello' });
  });

  describe('legacy plain values', () => {
    it('reads an unwrapped value as version 0 and re-persists it as an envelope', async () => {
      const state = memento();
      await state.update('key', { theme: 'light' });
      const storage = createTypedStorage<{ theme: string }>(state, 'key', {
        defaultValue: { theme: 'dark' },
        version: 1,
      });

      // has()=true must never pair with get()=default for a plain value.
      expect(storage.has()).toBe(true);
      expect(storage.get()).toEqual({ theme: 'light' });

      await flushWrites();
      expect(state._entries().get('key')).toEqual({ v: 1, value: { theme: 'light' } });
    });

    it('lets migrations[0] convert a plain value', () => {
      const state = memento();
      void state.update('key', 'legacy-string');
      const storage = createTypedStorage<{ name: string }>(state, 'key', {
        defaultValue: { name: 'none' },
        version: 1,
        migrations: { 0: (old) => ({ name: String(old) }) },
      });

      expect(storage.get()).toEqual({ name: 'legacy-string' });
    });
  });

  describe('migrations', () => {
    it('applies the chain in order from the stored version', () => {
      const state = memento();
      void state.update('key', { v: 1, value: 1 });
      const storage = createTypedStorage<number>(state, 'key', {
        defaultValue: 0,
        version: 4,
        migrations: {
          1: (old) => (old as number) + 10,
          2: (old) => (old as number) * 2,
          3: (old) => (old as number) + 1,
        },
      });

      // 1 -> +10 = 11 -> *2 = 22 -> +1 = 23
      expect(storage.get()).toBe(23);
    });

    it('stops at a gap and hands the value to validation', () => {
      const state = memento();
      void state.update('key', { v: 1, value: 5 });
      const storage = createTypedStorage<number>(state, 'key', {
        defaultValue: 0,
        version: 4,
        migrations: { 1: (old) => (old as number) + 1 }, // no 2, no 3
        schema: s.number(),
      });

      expect(storage.get()).toBe(6);
    });

    it('falls back to the default and reports when a migration throws, preserving the stored value', () => {
      const state = memento();
      void state.update('key', { v: 1, value: 'original' });
      const storage = createTypedStorage<string>(state, 'key', {
        defaultValue: 'fallback',
        version: 2,
        migrations: {
          1: () => {
            throw new Error('cannot migrate');
          },
        },
      });

      expect(storage.get()).toBe('fallback');
      const result = storage.tryGet();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error[0]?.stage).toBe('migrate');
      }
      // A failed migration must leave the stored value alone: the next
      // release may know how to read it.
      expect(state._entries().get('key')).toEqual({ v: 1, value: 'original' });
    });

    it('re-persists once after a successful migration', async () => {
      const state = memento();
      await state.update('key', { v: 1, value: 1 });
      const storage = createTypedStorage<number>(state, 'key', {
        defaultValue: 0,
        version: 2,
        migrations: { 1: (old) => (old as number) + 1 },
      });

      expect(storage.get()).toBe(2);
      await flushWrites();
      expect(state._entries().get('key')).toEqual({ v: 2, value: 2 });
    });
  });

  describe('validation', () => {
    it('falls back to the default on schema failure and reports through tryGet', () => {
      const state = memento();
      void state.update('key', { v: 1, value: 'not a number' });
      const storage = createTypedStorage<number>(state, 'key', {
        defaultValue: 9,
        schema: s.number(),
      });

      expect(storage.get()).toBe(9);
      const result = storage.tryGet();
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error[0]?.stage).toBe('validate');
      }
    });

    it('treats nothing-stored as ok through tryGet', () => {
      const storage = createTypedStorage(memento(), 'key', { defaultValue: 1 });
      expect(storage.tryGet()).toEqual({ ok: true, value: 1 });
    });

    it('survives a schema that throws', () => {
      const state = memento();
      void state.update('key', { v: 1, value: 1 });
      const storage = createTypedStorage<number>(state, 'key', {
        defaultValue: 0,
        schema: {
          '~standard': {
            version: 1,
            vendor: 'broken',
            validate: () => {
              throw new Error('schema exploded');
            },
          },
        },
      });

      expect(storage.get()).toBe(0);
    });

    /**
     * Reads are lenient on purpose — an invalid stored value falls back and
     * records a diagnostic rather than crashing whoever asked. That leniency is
     * exactly why writes cannot be: an unchecked write fails nowhere, and the
     * value is simply gone the next time anyone looks, with the diagnostic
     * pointing at the read rather than at what wrote it.
     */
    describe('writing a value the schema rejects', () => {
      it('rejects and leaves nothing behind', async () => {
        const state = memento();
        const storage = createTypedStorage<number>(state, 'key', {
          defaultValue: 9,
          schema: s.number(),
        });

        await expect(storage.set('nope' as unknown as number)).rejects.toThrow(
          /Storage key "key" could not be written/u
        );
        expect(state._entries().has('key')).toBe(false);
        expect(storage.get()).toBe(9);
      });

      it('reports a schema that threw rather than swallowing it', async () => {
        const storage = createTypedStorage<number>(memento(), 'key', {
          defaultValue: 0,
          schema: {
            '~standard': {
              version: 1,
              vendor: 'broken',
              validate: () => {
                throw new Error('schema exploded');
              },
            },
          },
        });

        await expect(storage.set(1)).rejects.toThrow(/schema threw while validating/u);
      });

      it('stores what a coercing schema produced, not what the caller passed', async () => {
        const state = memento();
        const storage = createTypedStorage<number>(state, 'key', {
          defaultValue: 0,
          schema: {
            '~standard': {
              version: 1,
              vendor: 'coercing',
              validate: (value: unknown) => ({ value: Number(value) }),
            },
          },
        });

        await storage.set('42' as unknown as number);

        // Storing the raw input would make the very next read disagree with
        // the write that produced it.
        expect(state._entries().get('key')).toEqual({ v: 1, value: 42 });
        expect(storage.get()).toBe(42);
      });
    });
  });

  describe('TTL', () => {
    it('stamps expiresAt from the injected clock and expires past it', async () => {
      let now = 1_000;
      const state = memento();
      const storage = createTypedStorage<string>(state, 'key', {
        defaultValue: 'gone',
        ttlMs: 500,
        clock: () => now,
      });

      await storage.set('alive');
      expect(state._entries().get('key')).toEqual({ v: 1, value: 'alive', expiresAt: 1_500 });
      expect(storage.get()).toBe('alive');
      expect(storage.has()).toBe(true);

      now = 1_500;
      expect(storage.get()).toBe('alive');

      now = 1_501;
      expect(storage.get()).toBe('gone');
      expect(storage.has()).toBe(false);
      // Expiry is ok-with-default, not an error.
      expect(storage.tryGet()).toEqual({ ok: true, value: 'gone' });
    });
  });

  describe('legacyKeys', () => {
    it('reads from a legacy key, re-persists under the new key, and removes the old one', async () => {
      const state = memento();
      await state.update('old-key', { v: 1, value: 'moved' });
      const storage = createTypedStorage<string>(state, 'current.key', {
        defaultValue: 'none',
        legacyKeys: ['old-key'],
      });

      expect(storage.get()).toBe('moved');
      await flushWrites();
      expect(state._entries().get('current.key')).toEqual({ v: 1, value: 'moved' });
      expect(state._entries().has('old-key')).toBe(false);
    });

    it('prefers the primary key when both exist', () => {
      const state = memento();
      void state.update('current.key', { v: 1, value: 'new' });
      void state.update('old-key', { v: 1, value: 'old' });
      const storage = createTypedStorage<string>(state, 'current.key', {
        defaultValue: 'none',
        legacyKeys: ['old-key'],
      });

      expect(storage.get()).toBe('new');
    });
  });

  describe('write operations and events', () => {
    it('reset writes the default as an entry; delete removes it', async () => {
      const state = memento();
      const storage = createTypedStorage<number>(state, 'key', { defaultValue: 5 });

      await storage.set(9);
      await storage.reset();
      expect(state._entries().get('key')).toEqual({ v: 1, value: 5 });
      expect(storage.has()).toBe(true);

      await storage.delete();
      expect(state._entries().has('key')).toBe(false);
      expect(storage.has()).toBe(false);
    });

    it('fires onDidChange with the new effective value for set/reset/delete', async () => {
      const seen: number[] = [];
      const storage = createTypedStorage<number>(memento(), 'key', { defaultValue: 0 });
      const subscription = storage.onDidChange((value) => seen.push(value));

      await storage.set(1);
      await storage.reset();
      await storage.delete();

      expect(seen).toEqual([1, 0, 0]);
      subscription.dispose();
      await storage.set(2);
      expect(seen).toEqual([1, 0, 0]);
    });
  });
});

describe('standalone factories', () => {
  it('createGlobalStorage aggregates syncable keys instead of replacing them', () => {
    const capability = createFakeStorage();
    const context = {
      globalState: Object.assign(capability.global, {
        setKeysForSync: (keys: readonly string[]) => capability.setKeysForSync(keys),
      }),
      workspaceState: capability.workspace,
    };

    createGlobalStorage(context, 'first', { defaultValue: 1, syncable: true });
    createGlobalStorage(context, 'second', { defaultValue: 2, syncable: true });
    createGlobalStorage(context, 'unsynced', { defaultValue: 3 });

    // setKeysForSync replaces its whole argument, so the second registration
    // must re-issue the first key too.
    expect([...capability._syncedKeys()].sort()).toEqual(['first', 'second']);
  });

  it('createWorkspaceStorage writes to workspaceState', async () => {
    const capability = createFakeStorage();
    const context = { globalState: capability.global, workspaceState: capability.workspace };

    const storage = createWorkspaceStorage<number>(context, 'recent', { defaultValue: 0 });
    await storage.set(3);

    expect(capability.workspace._entries().has('recent')).toBe(true);
    expect(capability.global._entries().has('recent')).toBe(false);
  });

  it('listStorageKeys filters by prefix', async () => {
    const state = memento();
    await state.update('ext.a', 1);
    await state.update('ext.b', 2);
    await state.update('other', 3);

    expect([...listStorageKeys(state, 'ext.')].sort()).toEqual(['ext.a', 'ext.b']);
    expect(listStorageKeys(state)).toHaveLength(3);
  });
});
