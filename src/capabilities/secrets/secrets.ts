/**
 * Secret-storage services above the platform's encrypted secrets port.
 *
 * Public surface: {@link SecretStore} addresses dynamic user-chosen keys,
 * `SecretStorage` narrows that store to one string key, and
 * {@link SecretAccessor} adds JSON serialization plus synchronous Standard
 * Schema validation for a declared structured secret.
 *
 * Ownership: each factory subscribes to the capability's change event and the
 * returned object owns that subscription. Direct callers must dispose it;
 * accessors created from `defineSecret` are disposed by the application
 * container.
 *
 * Security invariant: framework errors and diagnostics may identify a key and
 * schema vendor, but never include a secret value, schema issue text/path, or a
 * thrown validator message. Invalid data is preserved rather than auto-deleted
 * so a read failure cannot destroy a credential.
 */
import { validateSchema } from '../core/schema.js';
import type { StandardSchemaV1 } from '../core/schema.js';
import { createEmitter } from '../../foundation/internal/emitter.js';
import { serviceToken } from '../../foundation/services/token.js';
import type { ServiceToken } from '../../foundation/services/token.js';
import { validationError } from '../../foundation/operations/errors.js';
import type { SecretsCapability } from '../../foundation/platform/ports.js';

/**
 * A secret store spanning every secret this extension owns.
 *
 * Secret **values never appear** in logs, diagnostics or thrown errors — only
 * key names do. That rule holds everywhere in this module.
 */
export interface SecretStore {
  /** Gets a secret value; adapter failures reject. */
  get(key: string): Promise<string | undefined>;
  /** Stores a secret value; adapter failures reject. */
  set(key: string, value: string): Promise<void>;
  /** Deletes a secret; adapter failures reject. */
  delete(key: string): Promise<void>;
  /** Lists every key this extension has stored secrets under. */
  keys(): Promise<readonly string[]>;
  /** Fires with the affected key whenever a secret is stored or deleted. */
  onDidChange(listener: (key: string) => void): { dispose(): void };
  /** Releases the change subscription. */
  dispose(): void;
}

/** A secret wrapper scoped to a single key, with change notification. */
export interface SecretStorage {
  /** Gets the secret value. */
  get(): Promise<string | undefined>;
  /** Sets the secret value. */
  set(value: string): Promise<void>;
  /** Deletes the secret. */
  delete(): Promise<void>;
  /** Fires when this key's value changes. */
  onDidChange(listener: () => void): { dispose(): void };
  /** Releases the change subscription. */
  dispose(): void;
}

/**
 * Injects the application's {@link SecretStore}, for secrets the *user* names.
 *
 * Distinct from `defineSecret`, which declares one key the extension knows
 * about at definition time. A store covers the other case: an extension that
 * lets a user keep several named credentials cannot declare their names,
 * because it does not learn them until the user types one. Declaring a key and
 * storing a user's are different abilities, not two ways to do the same thing.
 *
 * @example
 * ```ts
 * module.commands.handle(AddKey, {
 *   inject: { secrets: Secrets, ask: QuickInput },
 *   execute: async (_context, _args, { secrets, ask }) => {
 *     const name = await ask.text({ prompt: 'Key name' });
 *     if (name === undefined) return;
 *     await secrets.set(name, generated);
 *   },
 * });
 * ```
 */
export const Secrets: ServiceToken<SecretStore> = serviceToken<SecretStore>('framework.secrets');

/**
 * Creates a store spanning every secret this extension owns.
 *
 * The application's own store is injected through {@link Secrets}; this builds
 * one directly, which is what the host does.
 *
 * @example
 * ```ts
 * const secrets = createSecretStore(capability);
 * await secrets.set('apiKey', 'sk-...');
 * const apiKey = await secrets.get('apiKey');
 * secrets.onDidChange((key) => logger.info('secret changed', { key }));
 * ```
 */
export function createSecretStore(capability: SecretsCapability): SecretStore {
  const emitter = createEmitter<string>();
  const subscription = capability.onDidChange((key) => {
    emitter.fire(key);
  });

  return {
    get(key: string): Promise<string | undefined> {
      return capability.get(key);
    },

    set(key: string, value: string): Promise<void> {
      return capability.store(key, value);
    },

    delete(key: string): Promise<void> {
      return capability.delete(key);
    },

    keys(): Promise<readonly string[]> {
      return capability.keys();
    },

    onDidChange(listener: (key: string) => void): { dispose(): void } {
      return emitter.event(listener);
    },

    dispose(): void {
      subscription.dispose();
      emitter.dispose();
    },
  };
}

/**
 * Creates a wrapper for a single secret, with change notification.
 *
 * @example
 * ```ts
 * const apiKey = createSecretStorage(capability, 'apiKey');
 * apiKey.onDidChange(() => refreshClient());
 * await apiKey.set('sk-...');
 * ```
 */
export function createSecretStorage(capability: SecretsCapability, key: string): SecretStorage {
  const emitter = createEmitter<void>();
  const subscription = capability.onDidChange((changedKey) => {
    if (changedKey === key) {
      emitter.fire(undefined);
    }
  });

  return {
    get(): Promise<string | undefined> {
      return capability.get(key);
    },

    set(value: string): Promise<void> {
      return capability.store(key, value);
    },

    delete(): Promise<void> {
      return capability.delete(key);
    },

    onDidChange(listener: () => void): { dispose(): void } {
      return emitter.event(() => {
        listener();
      });
    },

    dispose(): void {
      subscription.dispose();
      emitter.dispose();
    },
  };
}

/**
 * A typed secret scoped to one key.
 *
 * The structured flavour of `SecretStorage`: values are JSON-serialized,
 * and when a schema is declared they are validated against it in both
 * directions — before a write is serialized, and after a read is parsed.
 */
export interface SecretAccessor<T> {
  /**
   * The value, or undefined when unset. Rejects on malformed/invalid data or
   * adapter failure; failure details never contain the stored value.
   */
  read(): Promise<T | undefined>;
  /**
   * Writes the value. With a schema, the value is validated first and an
   * invalid one rejects with `SECRET_INVALID` before anything reaches the
   * platform's store. Structured values are then JSON-serialized, so values
   * unsupported by JSON can throw before the asynchronous store call.
   */
  write(value: T): Promise<void>;
  /** Deletes the secret. */
  delete(): Promise<void>;
  /** Fires when this key's value changes. */
  onDidChange(listener: () => void): { dispose(): void };
  /** Releases the change subscription. */
  dispose(): void;
}

/** Options for {@link createSecretAccessor}. */
export interface CreateSecretAccessorOptions<T> {
  readonly key: string;
  /**
   * Validates the deserialized value. When present, `T` is the schema's output;
   * when absent, values are plain strings.
   */
  readonly schema?: StandardSchemaV1<unknown, T> | undefined;
}

/**
 * Creates a typed secret accessor.
 *
 * A malformed or invalid stored secret **throws** rather than silently reading
 * as undefined, and it is never auto-deleted: destroying a credential because
 * one read failed to parse would be worse than surfacing the problem. Error
 * messages carry the key name only — never the value.
 *
 * Validation runs in both directions. Reads are the boundary where persisted
 * data re-enters the typed application; writes are checked too, because a
 * write that skipped validation would succeed and then make every later read
 * throw for the life of the stored value — a failure reported nowhere near its
 * cause — and because an invalid value must never reach the keychain at all.
 * Neither direction reports anything a schema produced: only the key, the
 * vendor and an issue count.
 *
 * @example
 * ```ts
 * const credentials = createSecretAccessor(capability, {
 *   key: 'api.credentials',
 *   schema: s.object({ token: s.string(), endpoint: s.string() }),
 * });
 * const current = await credentials.read();
 * ```
 */
export function createSecretAccessor<T = string>(
  capability: SecretsCapability,
  options: CreateSecretAccessorOptions<T>
): SecretAccessor<T> {
  const { key, schema } = options;
  const storage = createSecretStorage(capability, key);

  /**
   * Runs the schema without letting anything it produced escape.
   *
   * A third-party schema is not trusted to keep the secret out of what it
   * reports. Its messages routinely quote the value that failed ("expected
   * string, received \"sk-live-...\""), and both a thrown error and an issue
   * list would otherwise travel straight into an error message, its `cause`,
   * its stack and the diagnostics `details`. So nothing the schema produced is
   * propagated: only the key, the vendor, and how many issues there were.
   */
  const validate = (
    active: StandardSchemaV1<unknown, T>,
    value: unknown,
    direction: 'read' | 'write'
  ): T => {
    let result;
    try {
      result = validateSchema(active, value);
    } catch (error) {
      throw validationError({
        code: 'SECRET_SCHEMA_FAILED',
        message: `The schema for secret "${key}" threw while validating on ${direction}.`,
        details: {
          key,
          direction,
          vendor: active['~standard'].vendor,
          // The error's *type*, never its message: the message may quote the
          // secret. No `cause` for the same reason.
          errorName: error instanceof Error ? error.name : typeof error,
        },
      });
    }

    if ('issues' in result) {
      throw validationError({
        code: 'SECRET_INVALID',
        message: `Secret "${key}" failed validation on ${direction}.`,
        details: {
          key,
          direction,
          vendor: active['~standard'].vendor,
          // Neither messages nor paths: a message may quote the value and a
          // path may name keys inside it.
          issueCount: result.issues.length,
        },
      });
    }
    return result.value;
  };

  return {
    async read(): Promise<T | undefined> {
      const raw = await storage.get();
      if (raw === undefined) {
        return undefined;
      }

      if (schema === undefined) {
        // No schema means the plain-string flavour.
        return raw as T;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw validationError({
          code: 'SECRET_MALFORMED',
          message: `Secret "${key}" is not valid JSON.`,
          details: { key },
        });
      }

      return validate(schema, parsed, 'read');
    },

    async write(value: T): Promise<void> {
      if (schema === undefined) {
        // No schema means the plain-string flavour: nothing to check.
        return storage.set(String(value));
      }

      // Checked here as well as on read, because the alternative is a write
      // that succeeds and a read that then throws for the life of the stored
      // value — a failure reported at a point that has nothing to do with what
      // caused it. Validating first also means an invalid value never reaches
      // the platform's keychain at all.
      const validated = validate(schema, value, 'write');

      let serialized: string;
      try {
        serialized = JSON.stringify(validated);
      } catch (error) {
        // `JSON.stringify` names properties in its own error text, and a
        // circular secret would put them in front of whoever reads the log.
        throw validationError({
          code: 'SECRET_UNSERIALIZABLE',
          message: `Secret "${key}" could not be serialized.`,
          details: { key, errorName: error instanceof Error ? error.name : typeof error },
        });
      }
      return storage.set(serialized);
    },

    delete(): Promise<void> {
      return storage.delete();
    },

    onDidChange(listener: () => void): { dispose(): void } {
      return storage.onDidChange(listener);
    },

    dispose(): void {
      storage.dispose();
    },
  };
}
