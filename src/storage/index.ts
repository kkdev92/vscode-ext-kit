import * as vscode from 'vscode';
import { validateSchema, type StandardSchemaV1 } from '../core/schema.js';
import { ok, err, type Result } from '../core/result.js';

// ============================================
// Types
// ============================================

/**
 * A validation or migration failure surfaced by {@link TypedStorage.tryGet}.
 *
 * `get()` never throws and never exposes these — it always falls back to
 * `defaultValue` instead, so callers that just want a value can ignore this
 * entirely. `tryGet()` is the escape hatch for callers that need to tell
 * "nothing stored yet" apart from "stored, but corrupted/incompatible".
 */
export interface StorageIssue {
  /** Which phase produced the issue. */
  readonly stage: 'migrate' | 'validate';
  readonly message: string;
  readonly path?: ReadonlyArray<PropertyKey>;
}

/**
 * Options for creating a typed storage.
 */
export interface StorageOptions<T> {
  /**
   * Value returned by `get()`/`has()` when nothing is stored yet, the entry
   * has expired, or migration/validation failed.
   */
  defaultValue: T;
  /**
   * Optional Standard Schema validator, run against the (possibly migrated)
   * stored value on every read. Accepts the dependency-free `s.*` builders
   * from `core/schema.js`, or any Standard-Schema-compatible library (zod,
   * valibot, ArkType, ...) with a synchronous `validate`. When omitted, a
   * stored value is trusted as-is once it has passed migration.
   */
  schema?: StandardSchemaV1<unknown, T>;
  /** Current schema version (default: 1). */
  version?: number;
  /**
   * Migration steps keyed by the version they migrate *from*. On read,
   * steps are applied in order starting at the stored value's version, up
   * to (but excluding) `version` — e.g. migrating from 1 to 4 runs
   * `migrations[1]`, then `migrations[2]`, then `migrations[3]`.
   *
   * A gap (a version with no registered step) stops the chain early: the
   * value as of that point is handed straight to validation instead of
   * guessing across the gap.
   */
  migrations?: Record<number, (old: unknown) => unknown>;
  /**
   * Time-to-live in milliseconds, measured from the moment a value is
   * written. Once expired, the entry reads back exactly as if it had never
   * been set: `get()` returns `defaultValue` and `has()` returns `false`.
   */
  ttlMs?: number;
}

/**
 * Options for {@link createGlobalStorage}.
 */
export interface GlobalStorageOptions<T> extends StorageOptions<T> {
  /**
   * Registers this key with `globalState.setKeysForSync` so it opts into
   * Settings Sync. Safe to use on multiple keys sharing the same
   * `context`: registrations are aggregated per-context internally, since
   * `setKeysForSync` replaces its *entire* argument on every call — calling
   * it independently from each `createGlobalStorage` would silently
   * un-sync every previously-registered key.
   *
   * Has no equivalent on {@link createWorkspaceStorage}: `workspaceState`
   * is never synced.
   */
  syncable?: boolean;
}

/**
 * A type-safe wrapper over a single Memento key.
 */
export interface TypedStorage<T> extends vscode.Disposable {
  /** Gets the stored value, or `defaultValue` if unset, expired, or invalid. Never throws. */
  get(): T;
  /**
   * Like {@link get}, but reports *why* a fallback happened instead of
   * hiding it. Nothing stored yet, or an expired entry, is `ok` (with
   * `defaultValue`) — neither is a failure. A migration that threw, or a
   * value that failed schema validation, comes back as `err` with the
   * details.
   */
  tryGet(): Result<T, readonly StorageIssue[]>;
  /** Sets the value with a single, atomic Memento write. */
  set(value: T): Promise<void>;
  /** Resets to the default value (still written as a stored entry — use {@link delete} to remove it entirely). */
  reset(): Promise<void>;
  /** Reports whether a non-expired value is stored, regardless of whether it would pass validation. */
  has(): boolean;
  /** Deletes the stored value. */
  delete(): Promise<void>;
  /**
   * Fires with the new effective value whenever `set`/`reset`/`delete` is
   * called through *this* instance.
   *
   * `globalState`/`workspaceState` have no native VS Code change event
   * (unlike `SecretStorage`), so this can only observe writes made through
   * this handle — not edits from another window, another process, or
   * another `TypedStorage` instance pointed at the same key.
   */
  readonly onDidChange: vscode.Event<T>;
}

/**
 * A secret store spanning every secret this extension owns.
 */
export interface SecretStore extends vscode.Disposable {
  /** Gets a secret value. */
  get(key: string): Promise<string | undefined>;
  /** Stores a secret value. */
  set(key: string, value: string): Promise<void>;
  /** Deletes a secret. */
  delete(key: string): Promise<void>;
  /**
   * Lists every key this extension has stored secrets under.
   *
   * Requires VS Code 1.105+. This library's `engines.vscode` floor is not
   * raised for it — this feature-detects at call time and rejects with a
   * clear error on older hosts instead of pretending there are no secrets.
   */
  keys(): Promise<string[]>;
  /** Fires with the affected key whenever a secret is stored or deleted. */
  onDidChange(listener: (key: string) => void): vscode.Disposable;
}

/**
 * A secret storage wrapper scoped to a single key, with change notification.
 */
export interface SecretStorage extends vscode.Disposable {
  /** Gets the secret value */
  get(): Promise<string | undefined>;
  /** Sets the secret value */
  set(value: string): Promise<void>;
  /** Deletes the secret */
  delete(): Promise<void>;
  /** Event fired when the secret value changes */
  readonly onDidChange: vscode.Event<void>;
}

// ============================================
// Envelope (internal)
// ============================================

/**
 * On-disk shape written by `set`/`reset`. Replaces the previous design's
 * two separate keys (value + `__version`): a single envelope means every
 * write is exactly one `Memento.update()` call instead of two, which
 * matters because VS Code persists a Memento by re-serializing the
 * extension's *entire* storage blob on every `update()`.
 */
interface StorageEnvelope<T> {
  /** Schema version this value was written with. */
  v: number;
  value: T;
  /** Absolute epoch-ms deadline; the entry reads back as unset once passed. */
  expiresAt?: number;
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Applies migration steps in order, starting at `fromVersion` up to (but
 * excluding) `toVersion`. Stops at the first version without a registered
 * step, deferring to validation rather than guessing past a gap.
 */
function runMigrations(
  fromVersion: number,
  initialValue: unknown,
  migrations: Record<number, (old: unknown) => unknown>,
  toVersion: number
): unknown {
  let value = initialValue;
  for (let v = fromVersion; v < toVersion; v++) {
    const step = migrations[v];
    if (!step) break;
    value = step(value);
  }
  return value;
}

function isExpired(envelope: StorageEnvelope<unknown>): boolean {
  return envelope.expiresAt !== undefined && Date.now() > envelope.expiresAt;
}

// ============================================
// createGlobalStorage
// ============================================

/**
 * Creates a type-safe wrapper for global extension storage.
 *
 * @param context - Extension context
 * @param key - Storage key
 * @param options - Storage options
 * @returns A typed storage interface
 *
 * @example
 * ```typescript
 * interface UserPrefs {
 *   theme: string;
 *   fontSize: number;
 * }
 *
 * const prefs = createGlobalStorage<UserPrefs>(context, 'preferences', {
 *   defaultValue: { theme: 'dark', fontSize: 14 },
 *   version: 2,
 *   migrations: {
 *     // Migrates data written by v1 (no fontSize) up to v2.
 *     1: (old) => ({ ...(old as { theme: string }), fontSize: 14 }),
 *   },
 * });
 *
 * const current = prefs.get();
 * await prefs.set({ ...current, theme: 'light' });
 * context.subscriptions.push(prefs);
 * ```
 */
export function createGlobalStorage<T>(
  context: vscode.ExtensionContext,
  key: string,
  options: GlobalStorageOptions<T>
): TypedStorage<T> {
  if (options.syncable) {
    registerSyncKey(context, key);
  }
  return createTypedStorage(context.globalState, key, options);
}

// ============================================
// createWorkspaceStorage
// ============================================

/**
 * Creates a type-safe wrapper for workspace-specific storage.
 *
 * @param context - Extension context
 * @param key - Storage key
 * @param options - Storage options
 * @returns A typed storage interface
 *
 * @example
 * ```typescript
 * const recentFiles = createWorkspaceStorage<string[]>(context, 'recentFiles', {
 *   defaultValue: [],
 * });
 *
 * const files = recentFiles.get();
 * await recentFiles.set([...files, 'new-file.ts']);
 * ```
 */
export function createWorkspaceStorage<T>(
  context: vscode.ExtensionContext,
  key: string,
  options: StorageOptions<T>
): TypedStorage<T> {
  return createTypedStorage(context.workspaceState, key, options);
}

// ============================================
// setKeysForSync aggregation
// ============================================

const syncKeysByContext = new WeakMap<vscode.ExtensionContext, Set<string>>();

/**
 * Registers `key` for Settings Sync via `globalState.setKeysForSync`,
 * aggregating with every other key registered for the same `context`.
 *
 * `setKeysForSync` replaces the *entire* synced-key set on every call, so
 * calling it independently from each `createGlobalStorage({ syncable: true })`
 * would silently un-sync every previously-registered key. Accumulating the
 * set per-context and re-issuing the full set on each registration avoids
 * that trap.
 */
function registerSyncKey(context: vscode.ExtensionContext, key: string): void {
  let keys = syncKeysByContext.get(context);
  if (!keys) {
    keys = new Set();
    syncKeysByContext.set(context, keys);
  }
  keys.add(key);
  context.globalState.setKeysForSync([...keys]);
}

// ============================================
// createSecretStore
// ============================================

/**
 * Creates a store spanning every secret this extension owns.
 *
 * @param context - Extension context
 * @returns A secret store interface
 *
 * @example
 * ```typescript
 * const secrets = createSecretStore(context);
 *
 * await secrets.set('apiKey', 'sk-...');
 * const apiKey = await secrets.get('apiKey');
 *
 * secrets.onDidChange((key) => console.log(`${key} changed`));
 *
 * // Requires VS Code 1.105+; feature-detected internally.
 * const allKeys = await secrets.keys();
 *
 * context.subscriptions.push(secrets);
 * ```
 */
export function createSecretStore(context: vscode.ExtensionContext): SecretStore {
  const emitter = new vscode.EventEmitter<string>();
  const listener = context.secrets.onDidChange((e) => emitter.fire(e.key));

  return {
    get(key: string): Promise<string | undefined> {
      return Promise.resolve(context.secrets.get(key));
    },

    set(key: string, value: string): Promise<void> {
      return Promise.resolve(context.secrets.store(key, value));
    },

    delete(key: string): Promise<void> {
      return Promise.resolve(context.secrets.delete(key));
    },

    async keys(): Promise<string[]> {
      // `@types/vscode` already types `SecretStorage.keys()` as always
      // present (stable since 1.105), but this library's `engines.vscode`
      // floor (^1.96.0) predates that — the type is ahead of the runtime
      // guarantee, so this is the one storage API that still needs a real
      // feature-detect instead of trusting the type. The cast goes through
      // `unknown` first so the already-required type above doesn't defeat
      // the optionality we're asserting here.
      const secrets = context.secrets as unknown as { keys?: () => Thenable<string[]> };
      if (typeof secrets.keys !== 'function') {
        throw new Error(
          'SecretStore.keys() requires VS Code 1.105+; feature-detect before calling.'
        );
      }
      return secrets.keys();
    },

    onDidChange(listener: (key: string) => void): vscode.Disposable {
      return emitter.event(listener);
    },

    dispose(): void {
      listener.dispose();
      emitter.dispose();
    },
  };
}

// ============================================
// createSecretStorage
// ============================================

/**
 * Creates a wrapper for a single secret, with change notification. Built on
 * top of {@link createSecretStore}.
 *
 * @param context - Extension context
 * @param key - Secret key
 * @returns A secret storage interface
 *
 * @example
 * ```typescript
 * const apiKey = createSecretStorage(context, 'apiKey');
 *
 * // Listen for changes
 * apiKey.onDidChange(() => {
 *   console.log('API key changed');
 * });
 *
 * await apiKey.set('my-secret-key');
 * const key = await apiKey.get();
 * await apiKey.delete();
 *
 * // Don't forget to dispose
 * context.subscriptions.push(apiKey);
 * ```
 */
export function createSecretStorage(context: vscode.ExtensionContext, key: string): SecretStorage {
  const store = createSecretStore(context);
  const emitter = new vscode.EventEmitter<void>();
  const listener = store.onDidChange((changedKey) => {
    if (changedKey === key) {
      emitter.fire();
    }
  });

  return {
    get(): Promise<string | undefined> {
      return store.get(key);
    },

    set(value: string): Promise<void> {
      return store.set(key, value);
    },

    delete(): Promise<void> {
      return store.delete(key);
    },

    onDidChange: emitter.event,

    dispose(): void {
      listener.dispose();
      emitter.dispose();
      store.dispose();
    },
  };
}

// ============================================
// listStorageKeys
// ============================================

/**
 * Lists every key currently stored in `memento`, optionally filtered to
 * those starting with `prefix`.
 *
 * @param memento - `context.globalState` or `context.workspaceState`
 * @param prefix - Only return keys starting with this string
 * @returns The stored keys
 *
 * @example
 * ```typescript
 * const allKeys = listStorageKeys(context.globalState, 'myExtension.');
 * ```
 */
export function listStorageKeys(memento: vscode.Memento, prefix?: string): readonly string[] {
  const keys = memento.keys();
  return prefix ? keys.filter((k) => k.startsWith(prefix)) : keys;
}

// ============================================
// Internal: createTypedStorage
// ============================================

function createTypedStorage<T>(
  memento: vscode.Memento,
  key: string,
  options: StorageOptions<T>
): TypedStorage<T> {
  const { defaultValue, schema, version = 1, migrations = {}, ttlMs } = options;
  const changeEmitter = new vscode.EventEmitter<T>();

  function resolve(): { value: T; issues?: readonly StorageIssue[] } {
    const envelope = memento.get<StorageEnvelope<unknown>>(key);
    if (envelope === undefined || isExpired(envelope)) {
      return { value: defaultValue };
    }

    let value: unknown = envelope.value;
    let migrated = false;

    if (envelope.v < version) {
      try {
        value = runMigrations(envelope.v, value, migrations, version);
        migrated = true;
      } catch (error) {
        return {
          value: defaultValue,
          issues: [{ stage: 'migrate', message: toMessage(error) }],
        };
      }
    }

    if (schema) {
      try {
        const result = validateSchema(schema, value);
        if ('issues' in result) {
          return {
            value: defaultValue,
            issues: result.issues.map((issue) => ({
              stage: 'validate' as const,
              message: issue.message,
              path: issue.path,
            })),
          };
        }
        value = result.value;
      } catch (error) {
        // Defensive: a well-behaved Standard Schema never throws (it
        // reports failures via `{ issues }`), but get()/tryGet() must never
        // crash regardless of what a third-party schema does.
        return {
          value: defaultValue,
          issues: [{ stage: 'validate', message: toMessage(error) }],
        };
      }
    }

    if (migrated) {
      const persisted: StorageEnvelope<T> = { v: version, value: value as T };
      if (envelope.expiresAt !== undefined) {
        persisted.expiresAt = envelope.expiresAt;
      }
      // Best-effort: if this write rejects (disk error, etc.), migration
      // simply runs again on the next read. Never let it surface as an
      // unhandledRejection — nothing awaits this from a read path.
      memento.update(key, persisted).then(undefined, () => undefined);
    }

    return { value: value as T };
  }

  async function write(value: T): Promise<void> {
    const envelope: StorageEnvelope<T> = { v: version, value };
    if (ttlMs !== undefined) {
      envelope.expiresAt = Date.now() + ttlMs;
    }
    await memento.update(key, envelope); // single write — see StorageEnvelope
    changeEmitter.fire(value);
  }

  return {
    get(): T {
      return resolve().value;
    },

    tryGet(): Result<T, readonly StorageIssue[]> {
      const { value, issues } = resolve();
      return issues ? err(issues) : ok(value);
    },

    set(value: T): Promise<void> {
      return write(value);
    },

    reset(): Promise<void> {
      return write(defaultValue);
    },

    has(): boolean {
      const envelope = memento.get<StorageEnvelope<unknown>>(key);
      return envelope !== undefined && !isExpired(envelope);
    },

    async delete(): Promise<void> {
      await memento.update(key, undefined); // single write
      changeEmitter.fire(defaultValue);
    },

    onDidChange: changeEmitter.event,

    dispose(): void {
      changeEmitter.dispose();
    },
  };
}
