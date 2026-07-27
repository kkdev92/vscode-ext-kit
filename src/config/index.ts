import * as vscode from 'vscode';
import { validateSchema, type StandardSchemaV1, type Infer } from '../core/schema.js';
import { ok, err, type Result } from '../core/result.js';

// ============================================
// Validation helpers
// ============================================

function validateSection(section: string): void {
  if (typeof section !== 'string' || section.trim() === '') {
    throw new Error('section must be a non-empty string');
  }
}

function validateKey(key: string): void {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('key must be a non-empty string');
  }
}

/**
 * Resolves a scope to a stable string key, used to keep per-scope validated
 * values (see {@link defineConfigSchema}) separate. Duck-typed on purpose —
 * `vscode.Uri` is a class in the real API but a plain object of static
 * helpers in tests, so `instanceof` is avoided; presence of `languageId`/`uri`
 * is enough to tell the four {@link vscode.ConfigurationScope} shapes apart.
 */
function scopeId(scope?: vscode.ConfigurationScope): string {
  if (!scope) {
    return '';
  }
  if ('languageId' in scope) {
    // TextDocument, or the `{ uri?, languageId }` scope object.
    return `${scope.uri?.toString() ?? ''}#${scope.languageId}`;
  }
  if ('uri' in scope) {
    // WorkspaceFolder.
    return scope.uri.toString();
  }
  // A bare Uri.
  return scope.toString();
}

// ============================================
// Schema field definitions
// ============================================

/**
 * A single configuration field: a {@link StandardSchemaV1} schema paired with
 * the default value used when the setting is unset or fails validation.
 * Built by {@link field}; consumed by {@link defineConfigSchema}.
 */
export interface ConfigFieldDef<S extends StandardSchemaV1 = StandardSchemaV1> {
  readonly schema: S;
  readonly default: Infer<S>;
  readonly description?: string;
}

/**
 * Declares one field of a {@link defineConfigSchema} section: a schema
 * (either a built-in `s.*` builder from `core/schema.js`, or any Standard
 * Schema v1 validator with synchronous `validate`, e.g. zod/valibot) plus the
 * default value returned when the setting is missing or invalid.
 *
 * @param schema - Standard Schema v1 validator
 * @param defaultValue - Value used when unset, or when validation fails
 * @param description - Optional note documenting the field next to its schema
 *   (not surfaced by VS Code; `package.json`'s `contributes.configuration`
 *   remains the source of the user-facing description)
 *
 * @example
 * ```typescript
 * // `s` is the zero-dependency schema builder from core/schema.js.
 * field(s.enum('trace', 'debug', 'info', 'warn', 'error', 'silent'), 'info');
 * field(s.number({ min: 0 }), 5000, 'Request timeout in milliseconds');
 * ```
 */
export function field<S extends StandardSchemaV1>(
  schema: S,
  defaultValue: Infer<S>,
  description?: string
): ConfigFieldDef<S> {
  return { schema, default: defaultValue, description };
}

// ============================================
// TypedConfig
// ============================================

/** A single validation failure surfaced by {@link TypedConfig.tryGet}. */
export interface ConfigValidationIssue {
  /** Fully-qualified key, e.g. `"myExtension.logLevel"`. */
  readonly key: string;
  readonly message: string;
}

/** Return shape of {@link TypedConfig.inspect}, mirroring `WorkspaceConfiguration.inspect`. */
export type ConfigInspection<T> =
  | {
      key: string;
      defaultValue?: T;
      globalValue?: T;
      workspaceValue?: T;
      workspaceFolderValue?: T;
      defaultLanguageValue?: T;
      globalLanguageValue?: T;
      workspaceLanguageValue?: T;
      workspaceFolderLanguageValue?: T;
      languageIds?: string[];
    }
  | undefined;

/**
 * Schema-backed, type-safe view over one `contributes.configuration`
 * section. Returned by {@link defineConfigSchema}.
 */
export interface TypedConfig<Fields extends Record<string, ConfigFieldDef>> {
  /**
   * Reads and validates a single key. Falls back to the field's default
   * value — silently — when the setting is unset or fails validation; use
   * {@link TypedConfig.tryGet} when the failure needs to be observed instead
   * of hidden.
   */
  get<K extends keyof Fields & string>(
    key: K,
    scope?: vscode.ConfigurationScope
  ): Infer<Fields[K]['schema']>;

  /** Reads and validates every field declared in the schema. */
  getAll(scope?: vscode.ConfigurationScope): { [K in keyof Fields]: Infer<Fields[K]['schema']> };

  /**
   * Like {@link TypedConfig.get}, but reports validation failures instead of
   * swallowing them: `{ ok: false, error: issues }` when the raw setting
   * fails its schema, `{ ok: true, value }` otherwise (already falling back
   * to the default when the setting is unset, since that's not a failure).
   */
  tryGet<K extends keyof Fields & string>(
    key: K,
    scope?: vscode.ConfigurationScope
  ): Result<Infer<Fields[K]['schema']>, ConfigValidationIssue[]>;

  /** Writes a value through `WorkspaceConfiguration.update` (default target: Global). */
  set<K extends keyof Fields & string>(
    key: K,
    value: Infer<Fields[K]['schema']>,
    target?: vscode.ConfigurationTarget,
    overrideInLanguage?: boolean
  ): Promise<void>;

  /**
   * Fires with the freshly-validated value whenever `key` — and only `key`
   * — changes for the given scope. Each call registers an independent
   * subscription; dispose it like any other `vscode.Disposable`.
   */
  onDidChange<K extends keyof Fields & string>(
    key: K,
    listener: (value: Infer<Fields[K]['schema']>) => void,
    scope?: vscode.ConfigurationScope
  ): vscode.Disposable;

  /**
   * Fires the raw {@link vscode.ConfigurationChangeEvent} whenever anything
   * under this section changes. This is the direct replacement for the old
   * whole-section `onConfigChange`; prefer {@link TypedConfig.onDidChange}
   * when only one key matters.
   */
  onDidChangeAny(listener: (e: vscode.ConfigurationChangeEvent) => void): vscode.Disposable;

  /** Raw `WorkspaceConfiguration.inspect`, typed to the field's schema output. */
  inspect<K extends keyof Fields & string>(key: K): ConfigInspection<Infer<Fields[K]['schema']>>;

  /**
   * Development-time check: compares this schema's keys against
   * `context.extension.packageJSON`'s `contributes.configuration` and
   * returns the fully-qualified keys declared in the schema but missing from
   * package.json. Never throws — returns `[]` if `packageJSON` is missing or
   * malformed — so it's safe to call unconditionally during `activate()`.
   *
   * Deliberately logger-free (config has no logger dependency): report the
   * result with your own logger if desired.
   */
  checkPackageJsonSync(context: vscode.ExtensionContext): readonly string[];
}

/**
 * Derives a type-safe, validated, cached configuration accessor from a
 * schema. Unlike the old `getSetting<T>()`, where `T` was purely a call-site
 * assertion, every read is checked against its {@link StandardSchemaV1}
 * schema at runtime — a hand-edited or stale `settings.json` value falls
 * back to the field's default instead of silently poisoning the caller.
 *
 * `getConfiguration()` itself is still called on every read (VS Code treats
 * that as cheap and idiomatic, and the returned object can go stale the
 * instant the user edits settings); only the *validated* value is cached,
 * keyed by the raw value's identity, so repeated reads of an unchanged
 * setting skip re-validation without risking a stale read.
 *
 * @param section - Configuration section prefix (e.g. `'myExtension'`)
 * @param fields - Map of key to {@link field} definition
 *
 * @example
 * ```typescript
 * const myExtConfig = defineConfigSchema('myExt', {
 *   logLevel: field(s.enum('trace', 'debug', 'info', 'warn', 'error', 'silent'), 'info'),
 *   timeout: field(s.number({ min: 0 }), 5000),
 * });
 *
 * logger.setLevel(myExtConfig.get('logLevel')); // runtime-validated, never garbage
 * context.subscriptions.push(
 *   myExtConfig.onDidChange('logLevel', (level) => logger.setLevel(level)) // fires only for logLevel
 * );
 * ```
 */
export function defineConfigSchema<Fields extends Record<string, ConfigFieldDef>>(
  section: string,
  fields: Fields
): TypedConfig<Fields> {
  validateSection(section);

  const cache = new Map<
    string,
    { raw: unknown; value: unknown; issues: ConfigValidationIssue[] | undefined }
  >();

  function resolve<K extends keyof Fields & string>(
    key: K,
    scope?: vscode.ConfigurationScope
  ): { value: Infer<Fields[K]['schema']>; issues: ConfigValidationIssue[] | undefined } {
    // Keys of `fields` are statically constrained to K, so the entry always
    // exists; the assertion only bridges noUncheckedIndexedAccess.
    const def = fields[key]!;
    // Explicit <unknown> so the raw read isn't silently re-trusted as
    // Infer<...> before validation — that would reintroduce the exact
    // "T is just a self-reported cast" problem this module exists to fix.
    const raw = vscode.workspace.getConfiguration(section, scope).get<unknown>(key, def.default);

    const cacheKey = `${scopeId(scope)}\0${key}`;
    const cached = cache.get(cacheKey);
    if (cached && Object.is(cached.raw, raw)) {
      return { value: cached.value as Infer<Fields[K]['schema']>, issues: cached.issues };
    }

    const result = validateSchema(def.schema, raw);
    if ('issues' in result) {
      const issues = result.issues.map((issue) => ({
        key: `${section}.${key}`,
        message: issue.message,
      }));
      cache.set(cacheKey, { raw, value: def.default, issues });
      return { value: def.default as Infer<Fields[K]['schema']>, issues };
    }

    cache.set(cacheKey, { raw, value: result.value, issues: undefined });
    return { value: result.value as Infer<Fields[K]['schema']>, issues: undefined };
  }

  function inspectKey<K extends keyof Fields & string>(
    key: K
  ): ConfigInspection<Infer<Fields[K]['schema']>> {
    // `WorkspaceConfiguration.inspect<T>` only has T in its return position,
    // so there's no argument to infer it from; cast at this one boundary
    // rather than lean on return-type-driven generic inference.
    return vscode.workspace.getConfiguration(section).inspect(key) as ConfigInspection<
      Infer<Fields[K]['schema']>
    >;
  }

  return {
    get: (key, scope) => resolve(key, scope).value,

    getAll: (scope) => {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(fields)) {
        out[key] = resolve(key as keyof Fields & string, scope).value;
      }
      return out as { [K in keyof Fields]: Infer<Fields[K]['schema']> };
    },

    tryGet: (key, scope) => {
      const { value, issues } = resolve(key, scope);
      return issues ? err(issues) : ok(value);
    },

    set: async (key, value, target = vscode.ConfigurationTarget.Global, overrideInLanguage) => {
      await vscode.workspace
        .getConfiguration(section)
        .update(key, value, target, overrideInLanguage);
    },

    onDidChange: (key, listener, scope) => {
      const fullKey = `${section}.${key}`;
      return vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(fullKey, scope)) {
          listener(resolve(key, scope).value);
        }
      });
    },

    onDidChangeAny: (listener) =>
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(section)) {
          listener(e);
        }
      }),

    inspect: inspectKey,

    checkPackageJsonSync: (context) => {
      try {
        const pkg = context.extension.packageJSON as {
          contributes?: {
            configuration?:
              | { properties?: Record<string, unknown> }
              | Array<{ properties?: Record<string, unknown> }>;
          };
        };
        const configuration = pkg.contributes?.configuration;
        const groups = Array.isArray(configuration)
          ? configuration
          : configuration
            ? [configuration]
            : [];
        const declared = new Set(groups.flatMap((group) => Object.keys(group.properties ?? {})));
        return Object.keys(fields)
          .map((key) => `${section}.${key}`)
          .filter((full) => !declared.has(full));
      } catch {
        return [];
      }
    },
  };
}

// ============================================
// watchSetting
// ============================================

/** A single setting exposed as a live value + change event. Returned by {@link watchSetting}. */
export interface ConfigWatcher<T> extends vscode.Disposable {
  /** Current value; always up to date — no need to re-read after `onDidChange` fires. */
  readonly value: T;
  /** Fires with the new value whenever it changes. */
  readonly onDidChange: vscode.Event<T>;
}

/**
 * Watches a single setting, combining the read and the change subscription
 * that the old `getSetting`/`onConfigChange` pair required wiring up by
 * hand. Unlike {@link defineConfigSchema}, this performs no schema
 * validation — it's a thin, single-key convenience for the common case of
 * one setting driving one piece of state (e.g. a log level), too small to
 * warrant declaring a whole section schema.
 *
 * @param section - Configuration section prefix (e.g. `'myExtension'`)
 * @param key - Setting key within the section
 * @param defaultValue - Value used when the setting is unset
 *
 * @example
 * ```typescript
 * const logLevel = watchSetting('myExtension', 'logLevel', 'info');
 * context.subscriptions.push(logLevel);
 *
 * logger.setLevel(logLevel.value);
 * context.subscriptions.push(logLevel.onDidChange((level) => logger.setLevel(level)));
 * ```
 */
export function watchSetting<T>(section: string, key: string, defaultValue: T): ConfigWatcher<T> {
  validateSection(section);
  validateKey(key);

  const fullKey = `${section}.${key}`;
  const emitter = new vscode.EventEmitter<T>();

  function read(): T {
    return vscode.workspace.getConfiguration(section).get<T>(key, defaultValue);
  }

  let current = read();

  const configListener = vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration(fullKey)) {
      return;
    }
    const next = read();
    if (next !== current) {
      current = next;
      emitter.fire(current);
    }
  });

  return {
    get value() {
      return current;
    },
    onDidChange: emitter.event,
    dispose(): void {
      configListener.dispose();
      emitter.dispose();
    },
  };
}
