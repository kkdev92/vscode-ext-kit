import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { s } from '../src/core/schema.js';
import {
  createGlobalStorage,
  createWorkspaceStorage,
  createSecretStore,
  createSecretStorage,
  listStorageKeys,
} from '../src/storage/index.js';

// ============================================
// Local mocks
//
// tests/factories.js's createMockExtensionContext only stubs
// `subscriptions`, and tests/mocks/vscode.js's Memento/SecretStorage mocks
// don't have everything this redesign needs (setKeysForSync, a feature-
// detectable keys()). Building minimal in-memory mocks locally keeps this
// suite in full control of exactly what the real APIs guarantee: Memento
// reads are synchronous, update() is spy-able for call-count assertions,
// and SecretStorage.keys() can be present or absent per test.
//
// Every call site below passes `context as never` into the real storage
// factories (matching the previous version of this suite), so these mocks
// only need to be runtime-correct, not structurally typed as
// vscode.ExtensionContext.
// ============================================

function createMockMemento() {
  const data = new Map<string, unknown>();
  return {
    keys: (): string[] => [...data.keys()],
    get: (k: string, defaultValue?: unknown): unknown => (data.has(k) ? data.get(k) : defaultValue),
    update: vi.fn(async (k: string, value: unknown) => {
      if (value === undefined) {
        data.delete(k);
      } else {
        data.set(k, value);
      }
    }),
    setKeysForSync: vi.fn(),
  };
}

/** Minimal shape shared by test code that reaches into a mock secrets object to simulate a native change event. */
type Fireable = { _fire: (key: string) => void };

function createMockSecretStorage(opts: { withKeys?: boolean } = {}) {
  const data = new Map<string, string>();
  const listeners: ((e: { key: string }) => void)[] = [];

  const base = {
    get: vi.fn(async (k: string) => data.get(k)),
    store: vi.fn(async (k: string, value: string) => {
      data.set(k, value);
    }),
    delete: vi.fn(async (k: string) => {
      data.delete(k);
    }),
    onDidChange: vi.fn((listener: (e: { key: string }) => void) => {
      listeners.push(listener);
      return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) };
    }),
    _fire: (key: string) => listeners.forEach((l) => l({ key })),
  };

  return opts.withKeys ? Object.assign(base, { keys: vi.fn(async () => [...data.keys()]) }) : base;
}

function createMockContext(secretOpts: { withKeys?: boolean } = {}) {
  return {
    subscriptions: [] as { dispose(): void }[],
    globalState: createMockMemento(),
    workspaceState: createMockMemento(),
    secrets: createMockSecretStorage(secretOpts),
  };
}

type MockContext = ReturnType<typeof createMockContext>;

describe('storage', () => {
  let context: MockContext;

  beforeEach(() => {
    context = createMockContext();
  });

  // ============================================
  // createGlobalStorage: basic get/set/reset/has/delete
  // ============================================

  describe('createGlobalStorage', () => {
    it('returns default value when key does not exist', () => {
      const storage = createGlobalStorage(context as never, 'test', {
        defaultValue: 'default',
      });

      expect(storage.get()).toBe('default');
    });

    it('returns stored value', async () => {
      const storage = createGlobalStorage(context as never, 'test', {
        defaultValue: 'default',
      });

      await storage.set('stored');

      expect(storage.get()).toBe('stored');
    });

    it('stores complex objects', async () => {
      interface Config {
        theme: string;
        fontSize: number;
      }

      const storage = createGlobalStorage<Config>(context as never, 'config', {
        defaultValue: { theme: 'dark', fontSize: 14 },
      });

      await storage.set({ theme: 'light', fontSize: 16 });

      expect(storage.get()).toEqual({ theme: 'light', fontSize: 16 });
    });

    it('resets to default value', async () => {
      const storage = createGlobalStorage(context as never, 'test', {
        defaultValue: 'default',
      });

      await storage.set('modified');
      await storage.reset();

      expect(storage.get()).toBe('default');
    });

    it('reports has() correctly', async () => {
      const storage = createGlobalStorage(context as never, 'test', {
        defaultValue: 'default',
      });

      expect(storage.has()).toBe(false);

      await storage.set('value');

      expect(storage.has()).toBe(true);
    });

    it('deletes stored value', async () => {
      const storage = createGlobalStorage(context as never, 'test', {
        defaultValue: 'default',
      });

      await storage.set('stored');
      await storage.delete();

      expect(storage.has()).toBe(false);
      expect(storage.get()).toBe('default');
    });
  });

  // ============================================
  // Envelope write-count (bug #5 fix)
  // ============================================

  describe('envelope writes', () => {
    it('set() writes the Memento exactly once', async () => {
      const storage = createGlobalStorage(context as never, 'test', { defaultValue: 'default' });

      await storage.set('value');

      expect(context.globalState.update).toHaveBeenCalledTimes(1);
      expect(context.globalState.update).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ v: 1, value: 'value' })
      );
    });

    it('reset() writes the Memento exactly once', async () => {
      const storage = createGlobalStorage(context as never, 'test', { defaultValue: 'default' });
      await storage.set('value');
      context.globalState.update.mockClear();

      await storage.reset();

      expect(context.globalState.update).toHaveBeenCalledTimes(1);
      expect(context.globalState.update).toHaveBeenCalledWith(
        'test',
        expect.objectContaining({ v: 1, value: 'default' })
      );
    });

    it('delete() writes the Memento exactly once', async () => {
      const storage = createGlobalStorage(context as never, 'test', { defaultValue: 'default' });
      await storage.set('value');
      context.globalState.update.mockClear();

      await storage.delete();

      expect(context.globalState.update).toHaveBeenCalledTimes(1);
      expect(context.globalState.update).toHaveBeenCalledWith('test', undefined);
    });

    it('stores a single envelope key rather than a separate version key', async () => {
      const storage = createGlobalStorage(context as never, 'test', {
        defaultValue: 'default',
        version: 5,
      });

      await storage.set('value');

      expect(context.globalState.keys()).toEqual(['test']);
      expect(context.globalState.get('test')).toEqual({ v: 5, value: 'value' });
    });
  });

  // ============================================
  // Schema validation (optional)
  // ============================================

  describe('schema validation', () => {
    it('returns default when no schema is provided (unvalidated)', async () => {
      const storage = createGlobalStorage<number>(context as never, 'count', {
        defaultValue: 0,
      });

      await storage.set(42);

      expect(storage.get()).toBe(42);
    });

    it('returns default when stored value fails schema validation', async () => {
      const storage = createGlobalStorage<number>(context as never, 'count', {
        defaultValue: 0,
        schema: s.number({ min: 0 }),
      });

      // Bypass the wrapper to write an invalid envelope directly.
      await context.globalState.update('count', { v: 1, value: -1 });

      expect(storage.get()).toBe(0);
    });

    it('returns value when schema validation passes', async () => {
      const storage = createGlobalStorage<number>(context as never, 'count', {
        defaultValue: 0,
        schema: s.number({ min: 0 }),
      });

      await storage.set(42);

      expect(storage.get()).toBe(42);
    });

    it('does not crash get() when a third-party schema throws', async () => {
      const throwingSchema = {
        '~standard': {
          version: 1 as const,
          vendor: 'test',
          validate: () => {
            throw new Error('schema exploded');
          },
        },
      };

      const storage = createGlobalStorage<number>(context as never, 'count', {
        defaultValue: 0,
        schema: throwingSchema,
      });

      await context.globalState.update('count', { v: 1, value: 42 });

      expect(() => storage.get()).not.toThrow();
      expect(storage.get()).toBe(0);
    });
  });

  // ============================================
  // Migration (Record<version, step>)
  // ============================================

  describe('migration', () => {
    it('migrates old schema version using a single step', async () => {
      await context.globalState.update('config', { v: 1, value: { name: 'test' } });

      interface ConfigV2 {
        name: string;
        enabled: boolean;
      }

      const storage = createGlobalStorage<ConfigV2>(context as never, 'config', {
        defaultValue: { name: '', enabled: false },
        version: 2,
        migrations: {
          1: (old) => ({ ...(old as { name: string }), enabled: true }),
        },
      });

      expect(storage.get()).toEqual({ name: 'test', enabled: true });
    });

    it('chains multiple migration steps in order', async () => {
      await context.globalState.update('data', { v: 1, value: { count: 1 } });

      const step1 = vi.fn((old: unknown) => ({ ...(old as { count: number }), doubled: true }));
      const step2 = vi.fn((old: unknown) => ({ ...(old as object), tripled: true }));

      const storage = createGlobalStorage(context as never, 'data', {
        defaultValue: { count: 0 },
        version: 3,
        migrations: { 1: step1, 2: step2 },
      });

      expect(storage.get()).toEqual({ count: 1, doubled: true, tripled: true });
      expect(step1).toHaveBeenCalledTimes(1);
      expect(step2).toHaveBeenCalledTimes(1);
    });

    it('stops the migration chain at the first missing step', async () => {
      await context.globalState.update('data', { v: 1, value: { count: 1 } });

      const step1 = vi.fn((old: unknown) => ({ ...(old as object), step1: true }));
      const step3 = vi.fn((old: unknown) => ({ ...(old as object), step3: true }));

      const storage = createGlobalStorage(context as never, 'data', {
        // No schema: the gap at version 2 just means the loop stops early
        // and hands the partially-migrated value straight through.
        defaultValue: { count: 0 },
        version: 4,
        migrations: { 1: step1, 3: step3 }, // gap at 2
      });

      expect(storage.get()).toEqual({ count: 1, step1: true });
      expect(step3).not.toHaveBeenCalled();
    });

    it('does not migrate when the stored version already matches', async () => {
      const migrate = vi.fn((old: unknown) => old);
      await context.globalState.update('data', { v: 2, value: { value: 1 } });

      const storage = createGlobalStorage<{ value: number }>(context as never, 'data', {
        defaultValue: { value: 0 },
        version: 2,
        migrations: { 1: migrate },
      });

      storage.get();

      expect(migrate).not.toHaveBeenCalled();
    });

    it('persists the migrated value with a single write so migrate runs only once', async () => {
      await context.globalState.update('config', { v: 1, value: { name: 'test' } });

      const migrate = vi.fn((old) => ({ ...(old as { name: string }), enabled: true }));

      const storage = createGlobalStorage<{ name: string; enabled: boolean }>(
        context as never,
        'config',
        {
          defaultValue: { name: '', enabled: false },
          version: 2,
          migrations: { 1: migrate },
        }
      );
      // Isolate the migration-triggered write from the seed write above.
      context.globalState.update.mockClear();

      // First get() triggers migration and writes the result back.
      storage.get();
      // Subsequent gets must not re-run migrate.
      storage.get();
      storage.get();

      expect(migrate).toHaveBeenCalledTimes(1);
      expect(context.globalState.get('config')).toEqual({
        v: 2,
        value: { name: 'test', enabled: true },
      });
      expect(context.globalState.update).toHaveBeenCalledTimes(1);
    });

    it('falls back to defaultValue (no throw) when a migration step throws', async () => {
      await context.globalState.update('config', { v: 1, value: { name: 'test' } });

      const storage = createGlobalStorage<{ name: string; enabled: boolean }>(
        context as never,
        'config',
        {
          defaultValue: { name: '', enabled: false },
          version: 2,
          migrations: {
            1: () => {
              throw new Error('boom');
            },
          },
        }
      );

      expect(() => storage.get()).not.toThrow();
      expect(storage.get()).toEqual({ name: '', enabled: false });
    });

    it('does not surface unhandledRejection when migration persistence write fails', async () => {
      await context.globalState.update('config', { v: 1, value: { v: 1 } });

      const failure = new Error('disk full');
      context.globalState.update.mockRejectedValueOnce(failure);

      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      process.on('unhandledRejection', onUnhandled);

      try {
        const storage = createGlobalStorage<{ v: number }>(context as never, 'config', {
          defaultValue: { v: 0 },
          version: 2,
          migrations: { 1: (old) => ({ v: (old as { v: number }).v + 1 }) },
        });

        expect(storage.get()).toEqual({ v: 2 });

        await new Promise((r) => setImmediate(r));

        expect(unhandled).toHaveLength(0);
      } finally {
        process.off('unhandledRejection', onUnhandled);
      }
    });
  });

  // ============================================
  // tryGet(): Result-based observability
  // ============================================

  describe('tryGet', () => {
    it('returns ok(defaultValue) when nothing is stored', () => {
      const storage = createGlobalStorage(context as never, 'test', { defaultValue: 'default' });

      expect(storage.tryGet()).toEqual({ ok: true, value: 'default' });
    });

    it('returns ok(value) when the stored value is valid', async () => {
      const storage = createGlobalStorage<number>(context as never, 'count', {
        defaultValue: 0,
        schema: s.number(),
      });

      await storage.set(7);

      expect(storage.tryGet()).toEqual({ ok: true, value: 7 });
    });

    it('returns err with validate-stage issues when schema validation fails', async () => {
      const storage = createGlobalStorage<number>(context as never, 'count', {
        defaultValue: 0,
        schema: s.number({ min: 0 }),
      });
      await context.globalState.update('count', { v: 1, value: -5 });

      const result = storage.tryGet();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.cancelled).toBe(false);
        expect(result.error).toHaveLength(1);
        expect(result.error[0]).toMatchObject({ stage: 'validate' });
      }
    });

    it('returns err with migrate-stage issues when a migration step throws', async () => {
      await context.globalState.update('data', { v: 1, value: {} });

      const storage = createGlobalStorage(context as never, 'data', {
        defaultValue: { ok: false },
        version: 2,
        migrations: {
          1: () => {
            throw new Error('cannot migrate');
          },
        },
      });

      const result = storage.tryGet();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error[0]).toMatchObject({ stage: 'migrate', message: 'cannot migrate' });
      }
    });
  });

  // ============================================
  // TTL / expiry
  // ============================================

  describe('TTL', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns the stored value before it expires', async () => {
      vi.setSystemTime(0);
      const storage = createGlobalStorage(context as never, 'test', {
        defaultValue: 'default',
        ttlMs: 1000,
      });

      await storage.set('fresh');
      vi.setSystemTime(999);

      expect(storage.get()).toBe('fresh');
      expect(storage.has()).toBe(true);
    });

    it('returns defaultValue once the entry has expired', async () => {
      vi.setSystemTime(0);
      const storage = createGlobalStorage(context as never, 'test', {
        defaultValue: 'default',
        ttlMs: 1000,
      });

      await storage.set('fresh');
      vi.setSystemTime(1001);

      expect(storage.get()).toBe('default');
      expect(storage.has()).toBe(false);
    });

    it('treats an expired entry as absent for tryGet (ok, not an error)', async () => {
      vi.setSystemTime(0);
      const storage = createGlobalStorage(context as never, 'test', {
        defaultValue: 'default',
        ttlMs: 1000,
      });

      await storage.set('fresh');
      vi.setSystemTime(2000);

      expect(storage.tryGet()).toEqual({ ok: true, value: 'default' });
    });

    it('never expires when ttlMs is not set', async () => {
      vi.setSystemTime(0);
      const storage = createGlobalStorage(context as never, 'test', { defaultValue: 'default' });

      await storage.set('permanent');
      vi.setSystemTime(1_000_000_000);

      expect(storage.get()).toBe('permanent');
    });
  });

  // ============================================
  // onDidChange
  // ============================================

  describe('onDidChange', () => {
    it('fires with the new value on set()', async () => {
      const storage = createGlobalStorage(context as never, 'test', { defaultValue: 'default' });
      const listener = vi.fn();
      storage.onDidChange(listener);

      await storage.set('updated');

      expect(listener).toHaveBeenCalledExactlyOnceWith('updated');
    });

    it('fires with defaultValue on reset()', async () => {
      const storage = createGlobalStorage(context as never, 'test', { defaultValue: 'default' });
      await storage.set('updated');
      const listener = vi.fn();
      storage.onDidChange(listener);

      await storage.reset();

      expect(listener).toHaveBeenCalledExactlyOnceWith('default');
    });

    it('fires with defaultValue on delete()', async () => {
      const storage = createGlobalStorage(context as never, 'test', { defaultValue: 'default' });
      await storage.set('updated');
      const listener = vi.fn();
      storage.onDidChange(listener);

      await storage.delete();

      expect(listener).toHaveBeenCalledExactlyOnceWith('default');
    });

    it('does not fire for writes on other keys or instances', async () => {
      const a = createGlobalStorage(context as never, 'a', { defaultValue: 'a-default' });
      const b = createGlobalStorage(context as never, 'b', { defaultValue: 'b-default' });
      const listener = vi.fn();
      a.onDidChange(listener);

      await b.set('b-value');

      expect(listener).not.toHaveBeenCalled();
    });

    it('stops firing after the listener is disposed', async () => {
      const storage = createGlobalStorage(context as never, 'test', { defaultValue: 'default' });
      const listener = vi.fn();
      const subscription = storage.onDidChange(listener);

      subscription.dispose();
      await storage.set('updated');

      expect(listener).not.toHaveBeenCalled();
    });

    it('stops firing after the storage instance is disposed', async () => {
      const storage = createGlobalStorage(context as never, 'test', { defaultValue: 'default' });
      const listener = vi.fn();
      storage.onDidChange(listener);

      storage.dispose();
      await storage.set('updated');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // setKeysForSync aggregation
  // ============================================

  describe('syncable', () => {
    it('registers the key via globalState.setKeysForSync', () => {
      createGlobalStorage(context as never, 'a', { defaultValue: 1, syncable: true });

      expect(context.globalState.setKeysForSync).toHaveBeenCalledWith(['a']);
    });

    it('does not call setKeysForSync when syncable is not set', () => {
      createGlobalStorage(context as never, 'a', { defaultValue: 1 });

      expect(context.globalState.setKeysForSync).not.toHaveBeenCalled();
    });

    it('aggregates keys across multiple createGlobalStorage calls on the same context', () => {
      createGlobalStorage(context as never, 'a', { defaultValue: 1, syncable: true });
      createGlobalStorage(context as never, 'b', { defaultValue: 2, syncable: true });

      expect(context.globalState.setKeysForSync).toHaveBeenNthCalledWith(1, ['a']);
      expect(context.globalState.setKeysForSync).toHaveBeenNthCalledWith(2, ['a', 'b']);
    });

    it('keeps sync registrations isolated per context', () => {
      const otherContext = createMockContext();

      createGlobalStorage(context as never, 'a', { defaultValue: 1, syncable: true });
      createGlobalStorage(otherContext as never, 'z', { defaultValue: 1, syncable: true });

      expect(context.globalState.setKeysForSync).toHaveBeenLastCalledWith(['a']);
      expect(otherContext.globalState.setKeysForSync).toHaveBeenLastCalledWith(['z']);
    });
  });

  // ============================================
  // createWorkspaceStorage
  // ============================================

  describe('createWorkspaceStorage', () => {
    it('uses workspace state', async () => {
      const storage = createWorkspaceStorage<string[]>(context as never, 'wsData', {
        defaultValue: [],
      });

      await storage.set(['file1.ts', 'file2.ts']);

      expect(context.workspaceState.get('wsData')).toEqual({
        v: 1,
        value: ['file1.ts', 'file2.ts'],
      });
      expect(context.globalState.get('wsData')).toBeUndefined();
    });

    it('isolates from global storage', async () => {
      const globalStorage = createGlobalStorage(context as never, 'data', {
        defaultValue: 'global',
      });
      const workspaceStorage = createWorkspaceStorage(context as never, 'data', {
        defaultValue: 'workspace',
      });

      await globalStorage.set('global-value');
      await workspaceStorage.set('workspace-value');

      expect(globalStorage.get()).toBe('global-value');
      expect(workspaceStorage.get()).toBe('workspace-value');
    });

    it('supports all storage operations', async () => {
      const storage = createWorkspaceStorage<string[]>(context as never, 'files', {
        defaultValue: [],
      });

      expect(storage.get()).toEqual([]);
      expect(storage.has()).toBe(false);

      await storage.set(['a.ts']);
      expect(storage.get()).toEqual(['a.ts']);
      expect(storage.has()).toBe(true);

      await storage.reset();
      expect(storage.get()).toEqual([]);

      await storage.set(['b.ts']);
      await storage.delete();
      expect(storage.has()).toBe(false);
    });

    it('has no setKeysForSync option (workspaceState is never synced)', () => {
      // GlobalStorageOptions<T>-only field; createWorkspaceStorage's options
      // type has no `syncable`, so nothing is registered for sync.
      createWorkspaceStorage(context as never, 'files', { defaultValue: [] });

      expect(context.globalState.setKeysForSync).not.toHaveBeenCalled();
    });
  });

  // ============================================
  // listStorageKeys
  // ============================================

  describe('listStorageKeys', () => {
    it('lists every key in the given memento', async () => {
      const a = createGlobalStorage(context as never, 'myExt.a', { defaultValue: 1 });
      const b = createGlobalStorage(context as never, 'myExt.b', { defaultValue: 2 });
      const other = createGlobalStorage(context as never, 'other.c', { defaultValue: 3 });

      await a.set(1);
      await b.set(2);
      await other.set(3);

      expect([...listStorageKeys(context.globalState as never)].sort()).toEqual([
        'myExt.a',
        'myExt.b',
        'other.c',
      ]);
    });

    it('filters by prefix', async () => {
      const a = createGlobalStorage(context as never, 'myExt.a', { defaultValue: 1 });
      const other = createGlobalStorage(context as never, 'other.c', { defaultValue: 3 });

      await a.set(1);
      await other.set(3);

      expect(listStorageKeys(context.globalState as never, 'myExt.')).toEqual(['myExt.a']);
    });

    it('returns an empty list when nothing matches the prefix', () => {
      expect(listStorageKeys(context.globalState as never, 'nope.')).toEqual([]);
    });
  });

  // ============================================
  // createSecretStore (multi-key)
  // ============================================

  describe('createSecretStore', () => {
    it('stores and retrieves secrets', async () => {
      const store = createSecretStore(context as never);

      await store.set('apiKey', 'secret-key-123');

      expect(await store.get('apiKey')).toBe('secret-key-123');
    });

    it('returns undefined for a non-existent secret', async () => {
      const store = createSecretStore(context as never);

      expect(await store.get('nonExistent')).toBeUndefined();
    });

    it('deletes secrets', async () => {
      const store = createSecretStore(context as never);

      await store.set('apiKey', 'secret');
      await store.delete('apiKey');

      expect(await store.get('apiKey')).toBeUndefined();
    });

    it('isolates different keys', async () => {
      const store = createSecretStore(context as never);

      await store.set('key1', 'secret1');
      await store.set('key2', 'secret2');

      expect(await store.get('key1')).toBe('secret1');
      expect(await store.get('key2')).toBe('secret2');
    });

    it('notifies onDidChange with the affected key', async () => {
      const store = createSecretStore(context as never);
      const listener = vi.fn();
      store.onDidChange(listener);

      await store.set('apiKey', 'value');
      (context.secrets as Fireable)._fire('apiKey');

      expect(listener).toHaveBeenCalledWith('apiKey');
    });

    it('is disposable and stops notifying after dispose', async () => {
      const store = createSecretStore(context as never);
      const listener = vi.fn();
      store.onDidChange(listener);

      store.dispose();
      (context.secrets as Fireable)._fire('apiKey');

      expect(listener).not.toHaveBeenCalled();
    });

    describe('keys()', () => {
      it('resolves the stored key list when the host supports SecretStorage.keys() (1.105+)', async () => {
        const withKeysContext = createMockContext({ withKeys: true });
        const store = createSecretStore(withKeysContext as never);

        await store.set('a', '1');
        await store.set('b', '2');

        expect((await store.keys()).sort()).toEqual(['a', 'b']);
      });

      it('rejects with a clear error when the host predates 1.105', async () => {
        // Default mock context has no `keys` method, simulating VS Code < 1.105.
        const store = createSecretStore(context as never);

        await expect(store.keys()).rejects.toThrow(/1\.105/);
      });
    });
  });

  // ============================================
  // createSecretStorage (single-key wrapper)
  // ============================================

  describe('createSecretStorage', () => {
    it('stores and retrieves secrets', async () => {
      const storage = createSecretStorage(context as never, 'apiKey');

      await storage.set('secret-key-123');
      const value = await storage.get();

      expect(value).toBe('secret-key-123');
    });

    it('returns undefined for non-existent secret', async () => {
      const storage = createSecretStorage(context as never, 'nonExistent');

      const value = await storage.get();

      expect(value).toBeUndefined();
    });

    it('deletes secrets', async () => {
      const storage = createSecretStorage(context as never, 'apiKey');

      await storage.set('secret');
      await storage.delete();
      const value = await storage.get();

      expect(value).toBeUndefined();
    });

    it('isolates different keys', async () => {
      const storage1 = createSecretStorage(context as never, 'key1');
      const storage2 = createSecretStorage(context as never, 'key2');

      await storage1.set('secret1');
      await storage2.set('secret2');

      expect(await storage1.get()).toBe('secret1');
      expect(await storage2.get()).toBe('secret2');
    });

    it('overwrites existing secret', async () => {
      const storage = createSecretStorage(context as never, 'apiKey');

      await storage.set('old-secret');
      await storage.set('new-secret');

      expect(await storage.get()).toBe('new-secret');
    });

    it('provides onDidChange event', () => {
      const storage = createSecretStorage(context as never, 'apiKey');

      expect(storage.onDidChange).toBeDefined();
      expect(typeof storage.onDidChange).toBe('function');
    });

    it('fires onDidChange only for its own key', async () => {
      const storage = createSecretStorage(context as never, 'apiKey');
      const other = createSecretStorage(context as never, 'other');
      const listener = vi.fn();
      const otherListener = vi.fn();
      storage.onDidChange(listener);
      other.onDidChange(otherListener);

      (context.secrets as Fireable)._fire('apiKey');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(otherListener).not.toHaveBeenCalled();
    });

    it('is disposable', () => {
      const storage = createSecretStorage(context as never, 'apiKey');

      expect(storage.dispose).toBeDefined();
      expect(typeof storage.dispose).toBe('function');

      // Should not throw
      storage.dispose();
    });

    it('stops notifying after dispose', async () => {
      const storage = createSecretStorage(context as never, 'apiKey');
      const listener = vi.fn();
      storage.onDidChange(listener);

      storage.dispose();
      (context.secrets as Fireable)._fire('apiKey');

      expect(listener).not.toHaveBeenCalled();
    });
  });
});
