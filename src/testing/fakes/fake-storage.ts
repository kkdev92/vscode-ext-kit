/**
 * In-memory persistence ports for typed-storage and secret tests.
 *
 * State lasts only for the returned fake object's lifetime. There is no disk,
 * Settings Sync transport, encryption, cross-window propagation or quota; the
 * fakes reproduce the get/update/delete/event contracts consumed by the
 * framework and expose backing state intentionally for assertions.
 */
import { createEmitter } from '../../foundation/internal/emitter.js';
import type {
  MementoLike,
  PlatformRegistration,
  SecretsCapability,
  StorageCapability,
} from '../../foundation/platform/ports.js';

/** An in-memory `Memento` with the semantics the real one has. */
export interface FakeMemento extends MementoLike {
  /** Everything currently stored, for assertions. */
  _entries(): ReadonlyMap<string, unknown>;
}

/**
 * Creates an in-memory Memento.
 *
 * Mirrors the real contract: `get` is synchronous, `update` is async, and
 * updating to `undefined` removes the key from `keys()`.
 */
export function createFakeMemento(): FakeMemento {
  const entries = new Map<string, unknown>();

  return {
    get<T>(key: string): T | undefined {
      return entries.get(key) as T | undefined;
    },

    update(key: string, value: unknown): Thenable<void> {
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

    _entries(): ReadonlyMap<string, unknown> {
      return entries;
    },
  };
}

/** In-memory storage capability for tests. */
export interface FakeStorage extends StorageCapability {
  readonly global: FakeMemento;
  readonly workspace: FakeMemento;
  /** The last full key set passed to setKeysForSync. */
  _syncedKeys(): readonly string[];
}

/**
 * Creates a fake storage capability.
 *
 * @example
 * ```ts
 * const storage = createFakeStorage();
 * storage.global.update('preferences', { v: 1, value: { theme: 'dark' } });
 * ```
 */
export function createFakeStorage(): FakeStorage {
  let synced: readonly string[] = [];

  return {
    global: createFakeMemento(),
    workspace: createFakeMemento(),
    setKeysForSync(keys: readonly string[]): void {
      // Real contract: each call replaces the entire set.
      synced = [...keys];
    },
    _syncedKeys(): readonly string[] {
      return synced;
    },
  };
}

/** In-memory secrets capability for tests. */
export interface FakeSecrets extends SecretsCapability {
  /**
   * Everything currently stored, for assertions. Values are visible because
   * this is an in-memory test double, not a security boundary.
   */
  _entries(): ReadonlyMap<string, string>;
}

/**
 * Creates a fake secrets capability.
 *
 * Mirrors the real contract: `onDidChange` fires with the key on both store and
 * delete.
 *
 * @example
 * ```ts
 * const secrets = createFakeSecrets();
 * await secrets.store('apiKey', 'sk-test');
 * ```
 */
export function createFakeSecrets(): FakeSecrets {
  const entries = new Map<string, string>();
  const emitter = createEmitter<string>();

  return {
    get(key: string): Promise<string | undefined> {
      return Promise.resolve(entries.get(key));
    },

    store(key: string, value: string): Promise<void> {
      entries.set(key, value);
      emitter.fire(key);
      return Promise.resolve();
    },

    delete(key: string): Promise<void> {
      entries.delete(key);
      emitter.fire(key);
      return Promise.resolve();
    },

    keys(): Promise<readonly string[]> {
      return Promise.resolve([...entries.keys()]);
    },

    onDidChange(listener: (key: string) => void): PlatformRegistration {
      return emitter.event(listener);
    },

    _entries(): ReadonlyMap<string, string> {
      return entries;
    },
  };
}
