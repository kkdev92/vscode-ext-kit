import type { ValidationResult } from '../commands/contract.js';
import { frozenCopy } from '../internal/immutable.js';
import { serviceToken } from '../services/token.js';
import type { ServiceToken } from '../services/token.js';
import type { SettingsAccessor } from './accessor.js';

/**
 * The `scope` values `contributes.configuration` accepts. Kept faithful so a
 * definition and the manifest cannot disagree.
 */
export const SettingContributionScope = {
  Application: 'application',
  Machine: 'machine',
  MachineOverridable: 'machine-overridable',
  Window: 'window',
  Resource: 'resource',
  LanguageOverridable: 'language-overridable',
} as const;

/** Union of {@link SettingContributionScope} values. */
export type SettingContributionScope =
  (typeof SettingContributionScope)[keyof typeof SettingContributionScope];

/**
 * One setting's runtime validator and manifest-facing metadata.
 *
 * Validation is synchronous. Defaults and successful values are returned by
 * reference, so callers should treat object and array values as immutable.
 */
export interface SettingSpec<T> {
  /** JSON Schema type, for the manifest side. */
  readonly type: 'boolean' | 'number' | 'integer' | 'string' | 'array' | 'object';
  /** Value used when nothing is configured, and when a lenient read falls back. */
  readonly default: T;
  /** Where the setting may be configured. */
  readonly scope: SettingContributionScope;
  /** Allowed values, for an enumerated setting. */
  readonly enum?: readonly T[] | undefined;
  /** Validates untrusted configuration input synchronously. */
  validate(value: unknown): ValidationResult<T>;
}

/** Common options for every `setting.*` builder. */
interface BaseOptions<T> {
  readonly default: T;
  readonly scope?: SettingContributionScope | undefined;
}

const DEFAULT_SCOPE = SettingContributionScope.Window;

const issue = (message: string): ValidationResult<never> => ({
  ok: false,
  issues: [{ message }],
});

/**
 * Builders for common typed settings. They create definitions only and never
 * read or write the workspace configuration.
 *
 * @example
 * ```ts
 * const ProjectSettings = defineSettings({
 *   section: 'sample.projects',
 *   values: {
 *     enabled: setting.boolean({ default: true, scope: 'resource' }),
 *     interval: setting.number({ default: 30, minimum: 5 }),
 *     mode: setting.enum({ values: ['fast', 'thorough'], default: 'fast' }),
 *   },
 * });
 * ```
 */
export const setting = {
  boolean(options: BaseOptions<boolean>): SettingSpec<boolean> {
    return {
      type: 'boolean',
      default: options.default,
      scope: options.scope ?? DEFAULT_SCOPE,
      validate: (value) =>
        typeof value === 'boolean' ? { ok: true, value } : issue('expected a boolean'),
    };
  },

  number(
    options: BaseOptions<number> & { readonly minimum?: number; readonly maximum?: number }
  ): SettingSpec<number> {
    return {
      type: 'number',
      default: options.default,
      scope: options.scope ?? DEFAULT_SCOPE,
      validate: (value) => {
        if (typeof value !== 'number' || Number.isNaN(value)) {
          return issue('expected a number');
        }
        if (options.minimum !== undefined && value < options.minimum) {
          return issue(`expected at least ${String(options.minimum)}`);
        }
        if (options.maximum !== undefined && value > options.maximum) {
          return issue(`expected at most ${String(options.maximum)}`);
        }
        return { ok: true, value };
      },
    };
  },

  /**
   * A whole number.
   *
   * Separate from {@link setting.number} because "a page size of 12.5" is not
   * a page size, and `number` cannot say so — the manifest's `"type": "integer"`
   * makes the same distinction.
   */
  integer(
    options: BaseOptions<number> & { readonly minimum?: number; readonly maximum?: number }
  ): SettingSpec<number> {
    return {
      type: 'integer',
      default: options.default,
      scope: options.scope ?? DEFAULT_SCOPE,
      validate: (value) => {
        if (typeof value !== 'number' || !Number.isInteger(value)) {
          return issue('expected a whole number');
        }
        if (options.minimum !== undefined && value < options.minimum) {
          return issue(`expected at least ${String(options.minimum)}`);
        }
        if (options.maximum !== undefined && value > options.maximum) {
          return issue(`expected at most ${String(options.maximum)}`);
        }
        return { ok: true, value };
      },
    };
  },

  string(options: BaseOptions<string>): SettingSpec<string> {
    return {
      type: 'string',
      default: options.default,
      scope: options.scope ?? DEFAULT_SCOPE,
      validate: (value) =>
        typeof value === 'string' ? { ok: true, value } : issue('expected a string'),
    };
  },

  enum<const TValues extends readonly [string, ...string[]]>(
    options: BaseOptions<TValues[number]> & { readonly values: TValues }
  ): SettingSpec<TValues[number]> {
    return {
      type: 'string',
      default: options.default,
      scope: options.scope ?? DEFAULT_SCOPE,
      enum: options.values,
      validate: (value) =>
        typeof value === 'string' && (options.values as readonly string[]).includes(value)
          ? { ok: true, value: value }
          : issue(`expected one of ${options.values.join(', ')}`),
    };
  },

  /**
   * A list of strings.
   *
   * `items` constrains each entry. Without it a user can put an empty string in
   * a list of glob patterns and the extension will happily match everything —
   * the kind of value that is better rejected than defaulted around.
   * Patterns are tested as supplied; avoid stateful `g` or `y` flags.
   */
  stringArray(
    options: BaseOptions<readonly string[]> & {
      readonly items?: { readonly minLength?: number; readonly pattern?: RegExp };
    }
  ): SettingSpec<readonly string[]> {
    const { minLength, pattern } = options.items ?? {};
    return {
      type: 'array',
      default: options.default,
      scope: options.scope ?? DEFAULT_SCOPE,
      validate: (value) => {
        if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
          return issue('expected an array of strings');
        }
        const entries: readonly string[] = value;
        if (minLength !== undefined && entries.some((entry) => entry.length < minLength)) {
          return issue(`every entry must be at least ${String(minLength)} character(s)`);
        }
        if (pattern !== undefined && entries.some((entry) => !pattern.test(entry))) {
          return issue(`every entry must match ${pattern.source}`);
        }
        return { ok: true, value: entries };
      },
    };
  },
};

/** A map of setting keys to their specs. */
export type SettingSpecs = Readonly<Record<string, SettingSpec<unknown>>>;

/** The value object a group of specs resolves to. */
export type SettingsValues<TSpecs extends SettingSpecs> = {
  readonly [K in keyof TSpecs]: TSpecs[K] extends SettingSpec<infer V> ? V : never;
};

/** How an invalid configured value is treated. */
export const SettingsValidationPolicy = {
  /** Reads and operations fail on an invalid value. */
  Strict: 'strict',
  /** Falls back to the default, and always records a diagnostic. Never silent. */
  Lenient: 'lenient',
} as const;

/** Union of {@link SettingsValidationPolicy} values. */
export type SettingsValidationPolicy =
  (typeof SettingsValidationPolicy)[keyof typeof SettingsValidationPolicy];

/**
 * A validated settings group bound to one configuration section. Register it
 * with a Module to make its `SettingsAccessor` token available at activation.
 */
export interface SettingsDefinition<TSpecs extends SettingSpecs> {
  /** Configuration section, for example `sample.projects`. */
  readonly section: string;
  /** The specs, keyed by setting name. */
  readonly values: TSpecs;
  /** How invalid values are treated. Defaults to lenient. */
  readonly policy: SettingsValidationPolicy;
  /** Token the accessor is registered under, so handlers can inject it. */
  readonly token: ServiceToken<SettingsAccessor<SettingsValues<TSpecs>>>;
}

/**
 * A settings definition with its value types erased.
 *
 * Plans and the container store this form: `SettingsAccessor<T>` is invariant in
 * `T`, so a generic definition is not assignable to a common supertype, while
 * this structural subset is everything the runtime actually needs.
 */
export interface SettingsRegistration {
  readonly section: string;
  readonly values: SettingSpecs;
  readonly policy: SettingsValidationPolicy;
  readonly token: ServiceToken<unknown>;
}

/** Options for declaring a settings group with {@link defineSettings}. */
export interface DefineSettingsOptions<TSpecs extends SettingSpecs> {
  /** Fully-qualified configuration section shared with the extension manifest. */
  readonly section: string;
  /** Settings keyed relative to `section`. The map is snapshotted. */
  readonly values: TSpecs;
  /** Invalid-value behavior. Defaults to {@link SettingsValidationPolicy.Lenient}. */
  readonly policy?: SettingsValidationPolicy | undefined;
}

/**
 * Declares a typed settings group.
 *
 * The returned definition doubles as the service token for its accessor, so a
 * handler injects settings the same way it injects anything else.
 * Definition is synchronous and performs no configuration I/O.
 *
 * @example
 * ```ts
 * export const ProjectSettings = defineSettings({
 *   section: 'sample.projects',
 *   values: { enabled: setting.boolean({ default: true, scope: 'resource' }) },
 * });
 *
 * module.commands.handle(Refresh, {
 *   inject: { settings: ProjectSettings.token },
 *   execute: (context, _args, { settings }) => settings.read().get('enabled'),
 * });
 * ```
 */
export function defineSettings<TSpecs extends SettingSpecs>(
  options: DefineSettingsOptions<TSpecs>
): SettingsDefinition<TSpecs> {
  return Object.freeze({
    section: options.section,
    // The spec map is snapshotted; each spec stays as it is (its `validate` is
    // an opaque function and `default` may be any application value).
    values: frozenCopy(options.values),
    policy: options.policy ?? SettingsValidationPolicy.Lenient,
    token: serviceToken<SettingsAccessor<SettingsValues<TSpecs>>>(`settings:${options.section}`),
  });
}
