/**
 * Typed state for one VS Code `Memento` key.
 *
 * Public surface: {@link TypedStorage} exposes synchronous reads, queued writes,
 * validation diagnostics, migrations, TTL, legacy-key moves, and local change
 * events. {@link createTypedStorage} supplies the engine; the global/workspace
 * factories select a host state object, while `defineStorage` lets the
 * application container create and own the same accessor.
 *
 * Managed state: values are persisted as one {@link StorageEnvelope}. Reads may
 * schedule a migration write, so every write for an accessor is serialized in
 * call order. Moving a legacy key is deliberately two-phase: write the primary
 * key first, then delete the source. There is no cross-key transaction in the
 * `MementoLike` port.
 *
 * Ownership: a directly-created accessor owns only its change emitter and the
 * caller must dispose it. A declared accessor is container-owned. `onDidChange`
 * observes writes through that accessor only because VS Code Mementos expose no
 * cross-instance change event.
 *
 * Validation is a synchronous Standard Schema boundary. `get()` is a safe
 * fallback API; `tryGet()` is the diagnostic API. Neither mutates or deletes a
 * value merely because migration or validation failed.
 */
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';
import { validateSchema } from '../core/schema.js';
import type { SchemaPathSegment, StandardSchemaV1 } from '../core/schema.js';
import { createEmitter } from '../../foundation/internal/emitter.js';
import type { MementoLike } from '../../foundation/platform/ports.js';

/**
 * A validation or migration failure surfaced by {@link TypedStorage.tryGet}.
 *
 * `get()` never throws *for these data-quality failures* and never exposes
 * them — it falls back to `defaultValue`, so callers that just want a value can
 * ignore this type. A failing custom clock or storage adapter is outside this
 * issue model and may still throw.
 * `tryGet()` is the escape hatch for callers that need to tell "nothing stored
 * yet" apart from "stored, but corrupted/incompatible".
 */
export interface StorageIssue {
  /** Which phase produced the issue. */
  readonly stage: 'migrate' | 'validate';
  /** Human-readable failure description; never used as a programmatic code. */
  readonly message: string;
  /** Standard Schema path: each segment is a raw key or an object carrying one. */
  readonly path?: ReadonlyArray<PropertyKey | SchemaPathSegment> | undefined;
}

/** Options for creating a typed storage. */
export interface StorageOptions<T> {
  /**
   * Value returned by `get()` when nothing is stored yet, the entry has
   * expired, or migration/validation failed.
   */
  readonly defaultValue: T;
  /**
   * Optional Standard Schema validator, run against the (possibly migrated)
   * stored value on every read. Accepts the dependency-free `s.*` builders or
   * any Standard-Schema-compatible library with a synchronous `validate`.
   */
  readonly schema?: StandardSchemaV1<unknown, T>;
  /**
   * Current schema version.
   *
   * @defaultValue 1
   */
  readonly version?: number;
  /**
   * Migration steps keyed by the version they migrate *from*. On read, steps
   * apply in order from the stored version up to (but excluding) `version`.
   *
   * A plain value written before this kit was adopted (not wrapped in the
   * storage envelope) reads as **version 0**: provide `migrations[0]` to
   * convert it, or leave it out and the value flows into validation unchanged.
   * Either way it is re-persisted in envelope form after the first read.
   *
   * A gap (a version with no registered step) stops the chain early: the value
   * as of that point goes straight to validation instead of guessing. If it
   * validates, it is persisted at the declared current version; a gap is
   * therefore an explicit decision that the intermediate value is already
   * acceptable, not a deferred migration.
   */
  readonly migrations?: Readonly<Record<number, (old: unknown) => unknown>>;
  /**
   * Time-to-live in milliseconds from the moment a value is written. Once
   * expired, the entry reads back exactly as if it had never been set.
   */
  readonly ttlMs?: number;
  /**
   * Keys this value may have lived under before a rename. When the primary key
   * is empty, they are read in order; the first hit is migrated/validated as
   * usual, re-persisted under the primary key, and the legacy entry is removed
   * only **after** that write succeeded.
   *
   * `delete()` clears the legacy keys too. Deleting only the primary key would
   * let the next read resurrect the value from a legacy key that had not been
   * migrated yet.
   */
  readonly legacyKeys?: readonly string[];
  /**
   * Clock used for TTL stamps and expiry checks. A test hook — the default is
   * `Date.now`.
   */
  readonly clock?: () => number;
}

/** Options for global storage, which alone can participate in Settings Sync. */
export interface GlobalStorageOptions<T> extends StorageOptions<T> {
  /**
   * Registers this key for Settings Sync.
   *
   * Safe on multiple keys sharing the same state object: registrations are
   * aggregated, because `setKeysForSync` replaces its *entire* argument on
   * every call — calling it independently per key would silently un-sync every
   * previously registered one.
   */
  readonly syncable?: boolean;
}

/** A type-safe wrapper over a single Memento key. */
export interface TypedStorage<T> {
  /**
   * The stored value, or `defaultValue` if unset, expired, or invalid.
   * Migration/schema failures are contained; a failing port or custom clock
   * may still throw.
   */
  get(): T;
  /**
   * Like {@link get}, but reports *why* a fallback happened. Nothing stored, or
   * an expired entry, is `ok` with `defaultValue` — neither is a failure. A
   * migration that threw, or a value that failed validation, comes back `err`.
   */
  tryGet(): Result<T, readonly StorageIssue[]>;
  /**
   * Sets the value with one `Memento.update` of the complete envelope.
   *
   * Rejects without writing when the value fails the schema. The read side is
   * lenient — it falls back and records a diagnostic — so a write that skipped
   * the check would not fail anywhere: the value would just be missing later,
   * with the diagnostic pointing at the read instead of at the write. A schema
   * that coerces has its *output* stored, so the next read agrees with it.
   */
  set(value: T): Promise<void>;
  /**
   * Resets to the default value (written as an entry — {@link delete} removes
   * it). Like {@link set}, it rejects if the value fails the schema, which for
   * this method means the declared default and the declared schema disagree.
   */
  reset(): Promise<void>;
  /** Whether a non-expired value is stored, regardless of validity. */
  has(): boolean;
  /** Deletes the primary and every configured legacy key in queue order. */
  delete(): Promise<void>;
  /**
   * Fires with the new effective value on `set`/`reset`/`delete` through *this*
   * instance. Migration/legacy-move writes are silent. Mementos have no native
   * change event, so writes from another window, process or accessor instance
   * are not observable.
   */
  onDidChange(listener: (value: T) => void): { dispose(): void };
  /**
   * Releases the change emitter. Already-queued persistence is not cancelled;
   * disposal only ends this accessor's notification lifetime.
   */
  dispose(): void;
}

/**
 * On-disk shape written by `set`/`reset`.
 *
 * A persisted compatibility boundary: changing it requires an explicit
 * compatibility strategy for values already on users' machines. A value
 * stored without this wrapper is still read (see `isEnvelope`), which makes
 * adopting typed storage on an existing key safe.
 *
 * One envelope rather than parallel keys keeps value, version and expiry in one
 * `Memento.update()`. The public Memento API has no multi-key transaction, so
 * splitting those fields across keys would expose partial updates.
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
 * Applies migration steps from `fromVersion` up to (but excluding) `toVersion`,
 * stopping at the first gap and deferring to validation.
 */
function runMigrations(
  fromVersion: number,
  initialValue: unknown,
  migrations: Readonly<Record<number, (old: unknown) => unknown>>,
  toVersion: number
): unknown {
  let value = initialValue;
  for (let from = fromVersion; from < toVersion; from += 1) {
    const step = migrations[from];
    if (step === undefined) {
      break;
    }
    value = step(value);
  }
  return value;
}

/**
 * Whether a stored value is one of this module's envelopes, as opposed to an
 * unwrapped value written by another storage path. An object that happens to
 * carry a numeric `v` and a `value` key is indistinguishable from an envelope
 * and reads as one, so schemas should still validate its payload.
 */
function isEnvelope(value: unknown): value is StorageEnvelope<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as { v?: unknown }).v === 'number' &&
    'value' in value
  );
}

/**
 * Creates a typed storage over any Memento-shaped state object.
 *
 * The engine behind {@link createGlobalStorage}, {@link createWorkspaceStorage}
 * and the module-registered `defineStorage`. vscode-free: tests drive it with a
 * fake Memento.
 *
 * @example
 * ```ts
 * const prefs = createTypedStorage(context.globalState, 'preferences', {
 *   defaultValue: { theme: 'dark' },
 *   version: 2,
 *   migrations: { 1: (old) => ({ ...(old as object), theme: 'dark' }) },
 * });
 * ```
 */
export function createTypedStorage<T>(
  memento: MementoLike,
  key: string,
  options: StorageOptions<T>
): TypedStorage<T> {
  const {
    defaultValue,
    schema,
    version = 1,
    migrations = {},
    ttlMs,
    legacyKeys = [],
    clock = Date.now,
  } = options;
  const changeEmitter = createEmitter<T>();

  /**
   * Serialises every write to this key.
   *
   * Reads are synchronous but can *cause* a write (migration, legacy move), and
   * those writes are not awaited by the caller. Without a queue a migration
   * still in flight could land after a later `set()` and resurrect the old
   * value; with it, the last write wins in call order.
   */
  let writeQueue: Promise<unknown> = Promise.resolve();
  // `PromiseLike` because `MementoLike.update` returns VS Code's `Thenable`.
  const enqueue = <R>(work: () => PromiseLike<R>): Promise<R> => {
    const next = writeQueue.then(work, work);
    // The chain must not become a rejected promise, or every later write in the
    // queue would be skipped. Failures still reach the caller through `next`.
    writeQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };

  const isExpired = (envelope: StorageEnvelope<unknown>): boolean =>
    envelope.expiresAt !== undefined && clock() > envelope.expiresAt;

  /** Reads the raw stored value, falling back through legacy keys. */
  function readRaw(): { raw: unknown; from: string } | undefined {
    const primary = memento.get<unknown>(key);
    if (primary !== undefined) {
      return { raw: primary, from: key };
    }
    for (const legacyKey of legacyKeys) {
      const legacy = memento.get<unknown>(legacyKey);
      if (legacy !== undefined) {
        return { raw: legacy, from: legacyKey };
      }
    }
    return undefined;
  }

  function resolve(): { value: T; issues?: readonly StorageIssue[] } {
    const stored = readRaw();
    if (stored === undefined) {
      return { value: defaultValue };
    }

    // An unwrapped value reads as schema version 0 rather than reaching for a
    // nonexistent `.value`: migrations[0] can convert it, and without one it
    // flows into validation unchanged. This is the adoption path for an
    // existing Memento key.
    const envelope: StorageEnvelope<unknown> = isEnvelope(stored.raw)
      ? stored.raw
      : { v: 0, value: stored.raw };
    if (isExpired(envelope)) {
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

    if (schema !== undefined) {
      try {
        const result = validateSchema(schema, value);
        if ('issues' in result) {
          return {
            value: defaultValue,
            issues: result.issues.map((issue) => ({
              stage: 'validate' as const,
              message: issue.message,
              ...(issue.path === undefined ? {} : { path: issue.path }),
            })),
          };
        }
        value = result.value;
      } catch (error) {
        // Defensive: a well-behaved Standard Schema reports failures via
        // `{ issues }` and never throws, but reads must never crash regardless
        // of what a third-party schema does.
        return {
          value: defaultValue,
          issues: [{ stage: 'validate', message: toMessage(error) }],
        };
      }
    }

    const movedFromLegacy = stored.from !== key;
    if (migrated || movedFromLegacy) {
      const persisted: StorageEnvelope<T> = { v: version, value: value as T };
      if (envelope.expiresAt !== undefined) {
        persisted.expiresAt = envelope.expiresAt;
      }
      const legacyKey = stored.from;
      // Write the primary key first and only drop the legacy one after it
      // resolves. The MementoLike contract offers no atomic operation spanning
      // two keys, so concurrent writes could otherwise delete the source after
      // a failed destination write. This remains best-effort: if the primary
      // write fails, the source stays and migration is retried on a later read.
      void enqueue(async () => {
        await memento.update(key, persisted);
        if (movedFromLegacy) {
          await memento.update(legacyKey, undefined);
        }
      }).then(
        () => undefined,
        // Nothing awaits a read, so a rejection must not escape as an
        // unhandled rejection.
        () => undefined
      );
    }

    return { value: value as T };
  }

  async function write(value: T): Promise<void> {
    // Checked here as well as on read. The read side is lenient by design — an
    // invalid stored value falls back to the default and records a diagnostic —
    // so a write that skipped validation would not fail anywhere at all: the
    // value would simply be gone the next time anyone looked, with the
    // diagnostic pointing at the read rather than at whatever wrote it.
    if (schema !== undefined) {
      let result;
      try {
        result = validateSchema(schema, value);
      } catch (error) {
        throw new Error(
          `Storage key "${key}" could not be written: its schema threw while validating.`,
          { cause: error }
        );
      }
      if ('issues' in result) {
        throw new Error(
          `Storage key "${key}" could not be written: ${result.issues
            .map((issue) => issue.message)
            .join('; ')}`
        );
      }
      // The schema's output, not the input: a schema may coerce, and storing
      // the raw input would make the next read disagree with this write.
      value = result.value;
    }

    const envelope: StorageEnvelope<T> = { v: version, value };
    if (ttlMs !== undefined) {
      envelope.expiresAt = clock() + ttlMs;
    }
    // Queued behind any in-flight migration write, so an explicit set always
    // wins over a migration that started earlier.
    await enqueue(() => memento.update(key, envelope)); // single write — see StorageEnvelope
    changeEmitter.fire(value);
  }

  return {
    get(): T {
      return resolve().value;
    },

    tryGet(): Result<T, readonly StorageIssue[]> {
      const { value, issues } = resolve();
      return issues === undefined ? ok(value) : err(issues);
    },

    set(value: T): Promise<void> {
      return write(value);
    },

    reset(): Promise<void> {
      return write(defaultValue);
    },

    has(): boolean {
      const stored = readRaw();
      if (stored === undefined) {
        return false;
      }
      // An unwrapped value has no envelope deadline to check.
      return !isEnvelope(stored.raw) || !isExpired(stored.raw);
    },

    async delete(): Promise<void> {
      await enqueue(async () => {
        await memento.update(key, undefined);
        // Legacy keys go too: leaving an un-migrated one behind would let the
        // next read resurrect the value that was just deleted.
        for (const legacyKey of legacyKeys) {
          if (memento.get<unknown>(legacyKey) !== undefined) {
            await memento.update(legacyKey, undefined);
          }
        }
      });
      changeEmitter.fire(defaultValue);
    },

    onDidChange(listener: (value: T) => void): { dispose(): void } {
      return changeEmitter.event(listener);
    },

    dispose(): void {
      changeEmitter.dispose();
    },
  };
}

/** The part of `vscode.ExtensionContext` the standalone storage factories use. */
interface StorageHost {
  readonly globalState: MementoLike & {
    setKeysForSync?(keys: readonly string[]): void;
  };
  readonly workspaceState: MementoLike;
}

// setKeysForSync replaces its whole argument per call, so syncable keys are
// aggregated per state object and the full set re-issued on each registration.
const syncKeysByState = new WeakMap<object, Set<string>>();

function registerSyncKey(globalState: StorageHost['globalState'], key: string): void {
  let keys = syncKeysByState.get(globalState);
  if (keys === undefined) {
    keys = new Set();
    syncKeysByState.set(globalState, keys);
  }
  keys.add(key);
  globalState.setKeysForSync?.([...keys]);
}

/**
 * Creates a type-safe wrapper for global extension storage.
 *
 * The returned store is yours to own — it is not added to
 * `context.subscriptions` automatically; `context` is only how it reaches
 * `globalState`.
 *
 * @example
 * ```ts
 * const prefs = createGlobalStorage<UserPrefs>(context, 'preferences', {
 *   defaultValue: { theme: 'dark', fontSize: 14 },
 *   version: 2,
 *   migrations: { 1: (old) => ({ ...(old as { theme: string }), fontSize: 14 }) },
 * });
 * context.subscriptions.push(prefs);
 * ```
 */
export function createGlobalStorage<T>(
  context: StorageHost,
  key: string,
  options: GlobalStorageOptions<T>
): TypedStorage<T> {
  if (options.syncable === true) {
    registerSyncKey(context.globalState, key);
  }
  return createTypedStorage(context.globalState, key, options);
}

/**
 * Creates a type-safe wrapper for workspace-specific storage.
 *
 * @example
 * ```ts
 * const recent = createWorkspaceStorage<string[]>(context, 'recentFiles', {
 *   defaultValue: [],
 * });
 * ```
 */
export function createWorkspaceStorage<T>(
  context: StorageHost,
  key: string,
  options: StorageOptions<T>
): TypedStorage<T> {
  return createTypedStorage(context.workspaceState, key, options);
}

/**
 * Lists every key currently stored in `memento`, optionally filtered by prefix.
 *
 * @example
 * ```ts
 * const keys = listStorageKeys(context.globalState, 'myExtension.');
 * ```
 */
export function listStorageKeys(memento: MementoLike, prefix?: string): readonly string[] {
  const keys = memento.keys();
  return prefix === undefined ? keys : keys.filter((key) => key.startsWith(prefix));
}
