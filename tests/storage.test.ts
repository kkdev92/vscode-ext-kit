import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockExtensionContext } from './mocks/vscode.js';
import { createGlobalStorage, createWorkspaceStorage, createSecretStorage } from '../src/storage.js';

describe('storage', () => {
  let context: ReturnType<typeof createMockExtensionContext>;

  beforeEach(() => {
    vi.clearAllMocks();
    context = createMockExtensionContext();
  });

  // ============================================
  // createGlobalStorage
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

    describe('validation', () => {
      it('returns default when validation fails', async () => {
        const storage = createGlobalStorage<number>(context as never, 'count', {
          defaultValue: 0,
          validate: (value): value is number => typeof value === 'number' && value >= 0,
        });

        // Manually set invalid value in memento
        await context.globalState.update('count', -1);

        expect(storage.get()).toBe(0);
      });

      it('returns value when validation passes', async () => {
        const storage = createGlobalStorage<number>(context as never, 'count', {
          defaultValue: 0,
          validate: (value): value is number => typeof value === 'number' && value >= 0,
        });

        await storage.set(42);

        expect(storage.get()).toBe(42);
      });
    });

    describe('migration', () => {
      it('migrates old schema version', async () => {
        // Set up old data with version 1
        await context.globalState.update('config', { name: 'test' });
        await context.globalState.update('config__version', 1);

        interface ConfigV2 {
          name: string;
          enabled: boolean;
        }

        const storage = createGlobalStorage<ConfigV2>(context as never, 'config', {
          defaultValue: { name: '', enabled: false },
          version: 2,
          migrate: (old, version) => {
            if (version === 1) {
              const oldConfig = old as { name: string };
              return { name: oldConfig.name, enabled: true };
            }
            return old as ConfigV2;
          },
        });

        expect(storage.get()).toEqual({ name: 'test', enabled: true });
      });

      it('does not migrate current version', async () => {
        const migrate = vi.fn((old) => old);

        await context.globalState.update('data', { value: 1 });
        await context.globalState.update('data__version', 2);

        const storage = createGlobalStorage<{ value: number }>(context as never, 'data', {
          defaultValue: { value: 0 },
          version: 2,
          migrate,
        });

        storage.get();

        expect(migrate).not.toHaveBeenCalled();
      });

      it('updates version after set', async () => {
        await context.globalState.update('data', { old: true });
        await context.globalState.update('data__version', 1);

        const storage = createGlobalStorage<{ new: boolean }>(context as never, 'data', {
          defaultValue: { new: false },
          version: 3,
          migrate: () => ({ new: true }),
        });

        await storage.set({ new: true });

        expect(context.globalState.get('data__version')).toBe(3);
      });

      it('persists migrated value so migrate runs only once', async () => {
        await context.globalState.update('config', { name: 'test' });
        await context.globalState.update('config__version', 1);

        const migrate = vi.fn((old) => ({ ...(old as object), enabled: true }));

        const storage = createGlobalStorage<{ name: string; enabled: boolean }>(
          context as never,
          'config',
          {
            defaultValue: { name: '', enabled: false },
            version: 2,
            migrate,
          }
        );

        // First get triggers migration and writes the result back.
        storage.get();
        // Subsequent gets must not re-run migrate.
        storage.get();
        storage.get();

        expect(migrate).toHaveBeenCalledTimes(1);
        expect(context.globalState.get('config')).toEqual({ name: 'test', enabled: true });
        expect(context.globalState.get('config__version')).toBe(2);
      });
    });
  });

  // ============================================
  // createWorkspaceStorage
  // ============================================

  describe('createWorkspaceStorage', () => {
    it('uses workspace state', async () => {
      const storage = createWorkspaceStorage(context as never, 'wsData', {
        defaultValue: [],
      });

      await storage.set(['file1.ts', 'file2.ts']);

      expect(context.workspaceState.get('wsData')).toEqual(['file1.ts', 'file2.ts']);
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
  });

  // ============================================
  // createSecretStorage
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

    it('is disposable', () => {
      const storage = createSecretStorage(context as never, 'apiKey');

      expect(storage.dispose).toBeDefined();
      expect(typeof storage.dispose).toBe('function');

      // Should not throw
      storage.dispose();
    });
  });
});
