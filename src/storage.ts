import * as vscode from 'vscode';

// ============================================
// Types
// ============================================

/**
 * Options for creating a typed storage.
 */
export interface StorageOptions<T> {
  /** Default value when key doesn't exist */
  defaultValue: T;
  /** Validation function */
  validate?: (value: unknown) => value is T;
  /** Migration function for schema changes */
  migrate?: (oldValue: unknown, version: number) => T;
  /** Current schema version (default: 1) */
  version?: number;
}

/**
 * A type-safe storage wrapper.
 */
export interface TypedStorage<T> {
  /** Gets the stored value or default */
  get(): T;
  /** Sets the value */
  set(value: T): Promise<void>;
  /** Resets to default value */
  reset(): Promise<void>;
  /** Checks if a value exists */
  has(): boolean;
  /** Deletes the stored value */
  delete(): Promise<void>;
}

/**
 * A secret storage wrapper with change notification.
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
// Version key helper
// ============================================

const VERSION_SUFFIX = '__version';

function getVersionKey(key: string): string {
  return `${key}${VERSION_SUFFIX}`;
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
 *   migrate: (old, version) => {
 *     if (version === 1) {
 *       return { ...old, fontSize: 14 };
 *     }
 *     return old as UserPrefs;
 *   },
 * });
 *
 * const current = prefs.get();
 * await prefs.set({ ...current, theme: 'light' });
 * ```
 */
export function createGlobalStorage<T>(
  context: vscode.ExtensionContext,
  key: string,
  options: StorageOptions<T>
): TypedStorage<T> {
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
 * const workspaceData = createWorkspaceStorage<string[]>(context, 'recentFiles', {
 *   defaultValue: [],
 * });
 *
 * const files = workspaceData.get();
 * await workspaceData.set([...files, 'new-file.ts']);
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
// createSecretStorage
// ============================================

/**
 * Creates a wrapper for secure secret storage with change notification.
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
  const emitter = new vscode.EventEmitter<void>();

  const listener = context.secrets.onDidChange((e) => {
    if (e.key === key) {
      emitter.fire();
    }
  });

  return {
    async get(): Promise<string | undefined> {
      return context.secrets.get(key);
    },

    async set(value: string): Promise<void> {
      await context.secrets.store(key, value);
    },

    async delete(): Promise<void> {
      await context.secrets.delete(key);
    },

    onDidChange: emitter.event,

    dispose(): void {
      listener.dispose();
      emitter.dispose();
    },
  };
}

// ============================================
// Internal helper
// ============================================

function createTypedStorage<T>(
  memento: vscode.Memento,
  key: string,
  options: StorageOptions<T>
): TypedStorage<T> {
  const { defaultValue, validate, migrate, version = 1 } = options;
  const versionKey = getVersionKey(key);

  function getStoredVersion(): number {
    return memento.get<number>(versionKey, 1);
  }

  function getValue(): T {
    const storedVersion = getStoredVersion();
    let value = memento.get<unknown>(key);

    // No value stored
    if (value === undefined) {
      return defaultValue;
    }

    // Migration needed
    let migrated = false;
    if (migrate && storedVersion < version) {
      value = migrate(value, storedVersion);
      migrated = true;
    }

    // Validation
    if (validate && !validate(value)) {
      return defaultValue;
    }

    // Persist migrated value so migrate() doesn't run on every get().
    // Done after validation to avoid persisting an invalid migration result.
    if (migrated) {
      void memento.update(key, value);
      void memento.update(versionKey, version);
    }

    return value as T;
  }

  return {
    get(): T {
      return getValue();
    },

    async set(value: T): Promise<void> {
      await memento.update(key, value);
      await memento.update(versionKey, version);
    },

    async reset(): Promise<void> {
      await memento.update(key, defaultValue);
      await memento.update(versionKey, version);
    },

    has(): boolean {
      return memento.get(key) !== undefined;
    },

    async delete(): Promise<void> {
      await memento.update(key, undefined);
      await memento.update(versionKey, undefined);
    },
  };
}
