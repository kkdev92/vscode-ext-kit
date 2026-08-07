import type { Logger } from '../logging/logger.js';
import { validationError } from '../operations/errors.js';
import type {
  PlatformRegistration,
  SettingsCapability,
  SettingsInspection,
  SettingsScope,
  SettingsTarget,
} from '../platform/ports.js';
import type { SettingSpecs, SettingsValues } from './definition.js';
import { SettingsValidationPolicy } from './definition.js';

/**
 * A validated, read-only snapshot for one settings scope. The top-level values
 * record is frozen, while object-valued settings keep their declared identity.
 * It does not update in place; read again after a change event for new values.
 */
export interface SettingsSnapshot<T extends object> {
  /** Reads one setting. */
  get<K extends keyof T>(key: K): T[K];
  /** All settings in this snapshot. */
  readonly values: T;
}

/**
 * A configuration change.
 *
 * Carries no previous/current pair: one change can affect many scopes at once, so
 * it is an invalidation that prompts a re-read, not a value delivery.
 */
export interface SettingsChangeEvent<T extends object> {
  /** Whether this change touched this section, optionally for a given scope. */
  affects(scope?: SettingsScope): boolean;
  /** Re-reads the section for a scope. */
  read(scope?: SettingsScope): SettingsSnapshot<T>;
}

/**
 * Scope-aware, validated access to one configuration section.
 *
 * The accessor owns one internal platform subscription and must be disposed.
 * The Application container normally owns that lifetime. Registrations returned
 * by `onDidChange` and `watch` are caller-owned.
 */
export interface SettingsAccessor<T extends object> {
  /**
   * Reads every setting for a scope.
   *
   * Only the unscoped snapshot is cached: caching per resource URI would need
   * invalidation this event model cannot express precisely.
   */
  read(scope?: SettingsScope): SettingsSnapshot<T>;

  /** Returns every raw configuration tier for one setting without applying validation. */
  inspect<K extends keyof T>(key: K, scope?: SettingsScope): SettingsInspection<T[K]> | undefined;

  /**
   * Writes one setting and invalidates the unscoped cache after the platform
   * update succeeds. Passing `undefined` removes the target tier's value.
   */
  update<K extends keyof T>(
    key: K,
    value: T[K] | undefined,
    target: SettingsTarget,
    scope?: SettingsScope,
    overrideInLanguage?: boolean
  ): Promise<void>;

  /**
   * Subscribes to section invalidations. The returned registration is owned by
   * the caller; listener exceptions follow the platform event emitter's rules.
   */
  onDidChange(listener: (event: SettingsChangeEvent<T>) => void): PlatformRegistration;

  /**
   * Watches a single setting, invoking the listener with its new effective
   * value whenever a change affects it.
   *
   * Only this key is read, and the listener fires only when the value actually
   * changed — a change to a sibling key in the same section affects the section
   * but not this value. Under strict policy an invalid *new* value is logged
   * and the listener keeps the previous one rather than throwing from inside
   * the platform's event dispatch.
   * The watch is seeded on the first relevant change and does not invoke the
   * listener during registration. The returned registration is caller-owned;
   * listener exceptions follow the platform event emitter's rules.
   *
   * @example
   * ```ts
   * const subscription = settings.watch('enabled', scope, (enabled) => {
   *   toggleFeature(enabled);
   * });
   * ```
   */
  watch<K extends keyof T>(
    key: K,
    scope: SettingsScope | undefined,
    listener: (value: T[K]) => void
  ): PlatformRegistration;

  /**
   * Releases the accessor's own change subscription.
   *
   * The container owns accessors and calls this during shutdown; application
   * code does not need to. This does not dispose subscriptions previously
   * returned to callers by `onDidChange` or `watch`.
   */
  dispose(): void;
}

/** Options for {@link createSettingsAccessor}. */
export interface CreateSettingsAccessorOptions<TSpecs extends SettingSpecs> {
  /**
   * Only the parts an accessor needs. Narrower than `SettingsDefinition` on
   * purpose: the token is irrelevant here, and requiring it would make an erased
   * `SettingsRegistration` unusable, since `SettingsAccessor<T>` is invariant in `T`.
   */
  readonly definition: {
    readonly section: string;
    readonly values: TSpecs;
    readonly policy: SettingsValidationPolicy;
  };
  /** Platform settings port used for reads, writes and change subscriptions. */
  readonly capability: SettingsCapability;
  /** Receives lenient fallbacks and watch-time validation failures. */
  readonly logger: Logger;
  /**
   * Optional observer for `settings.invalid` diagnostics. It is called
   * synchronously and should not throw; direct exceptions are not isolated by
   * the accessor.
   */
  readonly onDiagnostic?:
    ((event: string, details: Readonly<Record<string, unknown>>) => void) | undefined;
}

/**
 * Creates a scope-aware settings accessor.
 *
 * An invalid configured value is never silently replaced: strict policy fails the
 * read, lenient policy falls back to the default *and* records a diagnostic.
 *
 * @example
 * ```ts
 * const accessor = createSettingsAccessor({ definition: ProjectSettings, capability, logger });
 * const enabled = accessor.read({ resource: document.uri }).get('enabled');
 * ```
 */
export function createSettingsAccessor<TSpecs extends SettingSpecs>(
  options: CreateSettingsAccessorOptions<TSpecs>
): SettingsAccessor<SettingsValues<TSpecs>> {
  type Values = SettingsValues<TSpecs>;
  const { definition, capability, logger } = options;
  const keys = Object.keys(definition.values);

  let unscopedCache: SettingsSnapshot<Values> | undefined;

  const readOne = (key: string, scope: SettingsScope | undefined): unknown => {
    const spec = definition.values[key];
    if (spec === undefined) {
      throw new TypeError(`Unknown setting "${key}" in section "${definition.section}".`);
    }

    const raw = capability.read<unknown>(definition.section, key, scope);
    if (raw === undefined) {
      return spec.default;
    }

    const outcome = spec.validate(raw);
    if (outcome.ok) {
      return outcome.value;
    }

    const details = {
      section: definition.section,
      key,
      issues: outcome.issues.map((entry) => entry.message),
    };

    if (definition.policy === SettingsValidationPolicy.Strict) {
      options.onDiagnostic?.('settings.invalid', details);
      throw validationError({
        code: 'SETTING_INVALID',
        message: `Setting "${definition.section}.${key}" is invalid.`,
        details,
      });
    }

    // Lenient still records the problem: a silent fallback would hide a
    // misconfiguration for the life of the session.
    logger.warn('setting value is invalid; using the default', details);
    options.onDiagnostic?.('settings.invalid', details);
    return spec.default;
  };

  const buildSnapshot = (scope: SettingsScope | undefined): SettingsSnapshot<Values> => {
    const values: Record<string, unknown> = {};
    for (const key of keys) {
      values[key] = readOne(key, scope);
    }
    const frozen = Object.freeze(values) as Values;
    return {
      values: frozen,
      get<K extends keyof Values>(key: K): Values[K] {
        return frozen[key];
      },
    };
  };

  // The accessor invalidates its own cache, independent of whether application
  // code ever subscribes. Relying on a user listener to do it would hand back a
  // permanently stale value to anyone who only reads.
  const invalidation = capability.onDidChange((source) => {
    if (source.affects(definition.section)) {
      unscopedCache = undefined;
    }
  });

  return {
    dispose(): void {
      invalidation.dispose();
    },

    read(scope?: SettingsScope): SettingsSnapshot<Values> {
      if (scope !== undefined) {
        // Scoped reads are on demand: a per-URI cache cannot be invalidated
        // precisely from a change event.
        return buildSnapshot(scope);
      }
      unscopedCache ??= buildSnapshot(undefined);
      return unscopedCache;
    },

    inspect<K extends keyof Values>(
      key: K,
      scope?: SettingsScope
    ): SettingsInspection<Values[K]> | undefined {
      return capability.inspect<Values[K]>(definition.section, String(key), scope);
    },

    async update<K extends keyof Values>(
      key: K,
      value: Values[K] | undefined,
      target: SettingsTarget,
      scope?: SettingsScope,
      overrideInLanguage?: boolean
    ): Promise<void> {
      await capability.update(
        definition.section,
        String(key),
        value,
        target,
        scope,
        overrideInLanguage
      );
      unscopedCache = undefined;
    },

    onDidChange(listener: (event: SettingsChangeEvent<Values>) => void): PlatformRegistration {
      return capability.onDidChange((source) => {
        if (!source.affects(definition.section)) {
          return;
        }
        listener({
          affects: (scope) => source.affects(definition.section, scope),
          read: (scope) => buildSnapshot(scope),
        });
      });
    },

    watch<K extends keyof Values>(
      key: K,
      scope: SettingsScope | undefined,
      listener: (value: Values[K]) => void
    ): PlatformRegistration {
      // Seeded on the first change rather than up front: constructing a watch
      // must not read configuration.
      let hasLast = false;
      let last: Values[K] | undefined;

      return capability.onDidChange((source) => {
        // The section-level gate is the one that cannot miss a change: VS Code
        // reports changed keys as leaf paths, and asking about the section
        // matches every key under it. Precision comes from what happens next,
        // not from narrowing the gate.
        if (!source.affects(definition.section, scope)) {
          return;
        }

        // Read only the watched key. Rebuilding the whole snapshot would make
        // each watch proportional to the section size and would let a
        // strict-invalid *sibling* throw from inside platform event dispatch
        // even though the watched key itself is valid.
        let current: Values[K];
        try {
          current = readOne(String(key), scope) as Values[K];
        } catch (error) {
          // Under strict policy the watched key's own new value can be invalid.
          // Throwing here would escape into the platform's event dispatch, so
          // the problem is reported and the stale value is left in place.
          logger.warn('watched setting is invalid; keeping the previous value', {
            section: definition.section,
            key: String(key),
            error,
          });
          return;
        }

        // A change to a sibling key affects the section but not this value.
        if (hasLast && Object.is(last, current)) {
          return;
        }
        hasLast = true;
        last = current;
        listener(current);
      });
    },
  };
}
