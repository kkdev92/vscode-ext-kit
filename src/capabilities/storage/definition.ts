import { frozenCopy } from '../../foundation/internal/immutable.js';
import type { StandardSchemaV1 } from '../core/schema.js';
import { serviceToken } from '../../foundation/services/token.js';
import type { ServiceToken } from '../../foundation/services/token.js';
import type { SecretAccessor } from '../secrets/secrets.js';
import type { StorageOptions, TypedStorage } from './typed-storage.js';

/** Where a storage definition persists. */
export type StorageScope = 'global' | 'workspace';

/** Options for {@link defineStorage}. */
export interface DefineStorageOptions<T> extends StorageOptions<T> {
  /** Memento key the value lives under. */
  readonly key: string;
  /**
   * Which state object to persist in.
   *
   * @defaultValue 'global'
   */
  readonly scope?: StorageScope;
  /**
   * Registers the key for Settings Sync. Global scope only — `workspaceState`
   * is never synced, so declaring it there is a preflight error.
   */
  readonly syncable?: boolean;
}

/**
 * A declared storage, whose accessor is injectable under `token`. The
 * definition is immutable application-plan data; the accessor is created and
 * owned by the application container during activation.
 */
export interface StorageDefinition<T> extends DefineStorageOptions<T> {
  readonly scope: StorageScope;
  /** Token the {@link TypedStorage} accessor is registered under. */
  readonly token: ServiceToken<TypedStorage<T>>;
}

/**
 * A storage definition with its value type erased.
 *
 * Plans store this form: `TypedStorage<T>` is invariant in `T`, so a generic
 * definition is not assignable to a common supertype (same pattern as
 * `SettingsRegistration`).
 */
export interface StorageRegistration {
  readonly key: string;
  readonly scope: StorageScope;
  readonly syncable?: boolean | undefined;
  readonly token: ServiceToken<unknown>;
  /** The full options bag, used verbatim to build the accessor. */
  readonly options: StorageOptions<unknown>;
}

/**
 * Declares a typed, versioned storage.
 *
 * The definition doubles as the service token for its accessor, so a handler
 * injects storage the same way it injects anything else.
 *
 * @example
 * ```ts
 * export const UserPreferences = defineStorage({
 *   key: 'preferences',
 *   scope: 'global',
 *   version: 2,
 *   defaultValue: { theme: 'dark' },
 *   migrations: { 1: (old) => ({ ...(old as object), theme: 'dark' }) },
 *   syncable: true,
 * });
 *
 * module.storage.add(UserPreferences);
 *
 * module.commands.handle(Refresh, {
 *   inject: { preferences: UserPreferences.token },
 *   execute: (context, _args, { preferences }) => preferences.get().theme,
 * });
 * ```
 */
export function defineStorage<T>(options: DefineStorageOptions<T>): StorageDefinition<T> {
  const scope = options.scope ?? 'global';
  // Frozen so the version, migrations map and TTL the plan was compiled
  // against cannot change afterwards. `schema` and each migration step stay
  // untouched: they are opaque callables.
  return Object.freeze({
    ...frozenCopy(options),
    scope,
    token: serviceToken<TypedStorage<T>>(`storage:${scope}:${options.key}`),
  });
}

/** Options for {@link defineSecret}. */
export interface DefineSecretOptions<T> {
  /** Secret key the value lives under. */
  readonly key: string;
  /**
   * Validates the deserialized value. Present: values are JSON with this
   * schema's output type. Absent: values are plain strings.
   */
  readonly schema?: StandardSchemaV1<unknown, T>;
}

/**
 * A declared secret, whose accessor is injectable under `token`. The host owns
 * the accessor's change subscription and releases it with the container.
 */
export interface SecretDefinition<T> extends DefineSecretOptions<T> {
  /** Token the {@link SecretAccessor} is registered under. */
  readonly token: ServiceToken<SecretAccessor<T>>;
}

/** A secret definition with its value type erased. */
export interface SecretRegistration {
  readonly key: string;
  readonly schema?: StandardSchemaV1<unknown, unknown> | undefined;
  readonly token: ServiceToken<unknown>;
}

/**
 * Declares a typed secret.
 *
 * No schema means a plain string accessor. With a schema, writes are JSON and
 * reads validate synchronously; malformed/invalid data rejects without being
 * deleted and without including the secret value in framework errors.
 *
 * @example
 * ```ts
 * export const ApiCredentials = defineSecret({
 *   key: 'api.credentials',
 *   schema: s.object({ token: s.string() }),
 * });
 *
 * module.secrets.add(ApiCredentials);
 * ```
 */
export function defineSecret<T = string>(options: DefineSecretOptions<T>): SecretDefinition<T> {
  return Object.freeze({
    ...frozenCopy(options),
    token: serviceToken<SecretAccessor<T>>(`secret:${options.key}`),
  });
}
