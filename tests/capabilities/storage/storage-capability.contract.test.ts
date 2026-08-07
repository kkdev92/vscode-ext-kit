/**
 * Shared port-contract suite run against both the observable fake and the real
 * VS Code adapter over a faithful context stub. It ensures unit/Test Host tests
 * and production agree on scope separation, deletion, structured values,
 * secret events, and sync-key replacement. A one-sided failure means the fake
 * or adapter has drifted from the common `StorageCapability` contract.
 */
import { describe, expect, it, vi } from 'vitest';

import type {
  SecretsCapability,
  StorageCapability,
} from '../../../src/foundation/platform/ports.js';

// A stand-in for the ExtensionContext state surface, mirroring the real
// semantics: Memento.get is synchronous, update(key, undefined) removes the key
// from keys(), setKeysForSync replaces its entire argument, and
// secrets.onDidChange fires with the key on both store and delete.
const vscodeMock = vi.hoisted(() => {
  const makeMemento = () => {
    const entries = new Map<string, unknown>();
    return {
      get: (key: string) => entries.get(key),
      update: (key: string, value: unknown) => {
        if (value === undefined) {
          entries.delete(key);
        } else {
          entries.set(key, value);
        }
        return Promise.resolve();
      },
      keys: () => [...entries.keys()],
    };
  };

  const secretEntries = new Map<string, string>();
  const secretListeners = new Set<(event: { key: string }) => void>();
  const fireSecret = (key: string) => {
    for (const listener of [...secretListeners]) {
      listener({ key });
    }
  };

  let syncedKeys: readonly string[] = [];

  const context = {
    globalState: Object.assign(makeMemento(), {
      setKeysForSync: (keys: readonly string[]) => {
        syncedKeys = [...keys];
      },
    }),
    workspaceState: makeMemento(),
    secrets: {
      get: (key: string) => Promise.resolve(secretEntries.get(key)),
      store: (key: string, value: string) => {
        secretEntries.set(key, value);
        fireSecret(key);
        return Promise.resolve();
      },
      delete: (key: string) => {
        secretEntries.delete(key);
        fireSecret(key);
        return Promise.resolve();
      },
      keys: () => Promise.resolve([...secretEntries.keys()]),
      onDidChange: (listener: (event: { key: string }) => void) => {
        secretListeners.add(listener);
        return {
          dispose: () => {
            secretListeners.delete(listener);
          },
        };
      },
    },
    _syncedKeys: () => syncedKeys,
  };

  return { context, module: {} };
});

vi.mock('vscode', () => vscodeMock.module);

const { createVSCodeStorageCapability, createVSCodeSecretsCapability } =
  await import('../../../src/vscode/capabilities/storage.js');
const { createFakeStorage, createFakeSecrets } =
  await import('../../../src/testing/fakes/fake-storage.js');

/** Defines identical storage assertions for every port implementation. */
function describeStorageCapability(name: string, create: () => StorageCapability): void {
  describe(name, () => {
    it('keeps global and workspace state separate', async () => {
      const capability = create();

      await capability.global.update('key', 'global-value');
      await capability.workspace.update('key', 'workspace-value');

      expect(capability.global.get('key')).toBe('global-value');
      expect(capability.workspace.get('key')).toBe('workspace-value');
    });

    it('removes a key from keys() when updated to undefined', async () => {
      const capability = create();

      await capability.global.update('key', 1);
      expect(capability.global.keys()).toContain('key');

      await capability.global.update('key', undefined);
      expect(capability.global.get('key')).toBeUndefined();
      expect(capability.global.keys()).not.toContain('key');
    });

    it('stores structured values verbatim', async () => {
      const capability = create();
      const envelope = { v: 2, value: { nested: [1, 2] }, expiresAt: 99 };

      await capability.global.update('key', envelope);

      expect(capability.global.get('key')).toEqual(envelope);
    });
  });
}

/** Defines identical secret assertions for every port implementation. */
function describeSecretsCapability(name: string, create: () => SecretsCapability): void {
  describe(name, () => {
    it('round-trips values and lists keys', async () => {
      const capability = create();

      await capability.store('a', '1');
      expect(await capability.get('a')).toBe('1');
      expect(await capability.keys()).toContain('a');

      await capability.delete('a');
      expect(await capability.get('a')).toBeUndefined();
    });

    it('fires onDidChange with the key on store and on delete', async () => {
      const capability = create();
      const seen: string[] = [];
      const subscription = capability.onDidChange((key) => seen.push(key));

      await capability.store('a', '1');
      await capability.delete('a');
      subscription.dispose();
      await capability.store('b', '2');

      expect(seen).toEqual(['a', 'a']);
    });
  });
}

describe('StorageCapability contract', () => {
  describeStorageCapability('FakeStorage', () => createFakeStorage());
  describeStorageCapability('VS Code adapter', () =>
    createVSCodeStorageCapability(vscodeMock.context as never)
  );
});

describe('SecretsCapability contract', () => {
  describeSecretsCapability('FakeSecrets', () => createFakeSecrets());
  describeSecretsCapability('VS Code adapter', () =>
    createVSCodeSecretsCapability(vscodeMock.context as never)
  );
});

describe('VS Code adapter specifics', () => {
  it('setKeysForSync passes the full set through', () => {
    const capability = createVSCodeStorageCapability(vscodeMock.context as never);

    capability.setKeysForSync(['a', 'b']);

    expect(vscodeMock.context._syncedKeys()).toEqual(['a', 'b']);
  });
});
