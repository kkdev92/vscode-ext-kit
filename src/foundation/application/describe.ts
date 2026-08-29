/**
 * @packageDocumentation
 * A compiled plan, as plain data.
 *
 * The framework knows exactly what an extension registers — that is the point
 * of compiling declarations before running them — but an `ApplicationPlan`
 * holds factories, handlers and token objects, so it cannot be printed,
 * diffed or serialized. This turns it into JSON: ids, names, lifetimes and
 * dependency edges, and nothing that carries behaviour or user data.
 *
 * What it is for: a "what does this extension actually register?" answer in a
 * review, a diff in a pull request, a graph, a manifest cross-check, and
 * machine-readable context for a tool reading a codebase it did not write.
 *
 * What it is not: a way to reach into the application. Nothing here can be
 * called, resolved or mutated, and the projection is deliberately one-way.
 */
import { defineOwn } from '../internal/record.js';
import type { ApplicationPlan } from './plan.js';
import { FRAMEWORK_SERVICES } from './plan.js';

/** Element types read straight off the plan, so this file names no capability. */
type Module = ApplicationPlan['modules'][number];
type Dependencies = ApplicationPlan['services'][number]['dependencies'];
type SettingsRegistration = ApplicationPlan['settings'][number];
type SettingSpec = SettingsRegistration['values'][string];
type WatcherPattern = ApplicationPlan['fileWatchers'][number]['patterns'];

/** One module, and what it says it needs from the host. */
export interface ModuleDescription {
  readonly id: string;
  /** Declared host compatibility, or `'unspecified'`. */
  readonly compatibility: string;
  /** Hard requirements checked at activation. */
  readonly requires: {
    readonly workspace: boolean;
    readonly trust: boolean;
    readonly localFileSystem: boolean;
  };
  /** The optional diagnostic label the module was declared with. */
  readonly source: string | undefined;
}

/** One service registration and the edges out of it. */
export interface ServiceDescription {
  /** The token's debug id. Container identity is the token object, not this. */
  readonly token: string;
  readonly lifetime: 'singleton' | 'transient';
  /** Injected token ids, keyed by the name the factory receives. */
  readonly dependencies: Readonly<Record<string, string>>;
  readonly moduleId: string;
}

/** One command handler. */
export interface CommandDescription {
  readonly id: string;
  readonly title: string | undefined;
  readonly category: string | undefined;
  /** Whether it was declared with `handleTextEditor`. */
  readonly textEditor: boolean;
  /** Whether the contract carries a runtime argument validator. */
  readonly validated: boolean;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly moduleId: string;
}

/** One hosted service, and which phases it implements. */
export interface HostedServiceDescription {
  readonly id: string;
  readonly start: boolean;
  readonly run: boolean;
  readonly stop: boolean;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly moduleId: string;
}

/** One setting, keyed as the manifest keys it. */
export interface SettingDescription {
  /** Fully-qualified key: the section and the name, joined. */
  readonly key: string;
  /** JSON Schema type names, always as a list. */
  readonly type: readonly string[];
  /** The declared default. Whatever the declaration put there. */
  readonly default: unknown;
  /** Contribution scope, matching `contributes.configuration`. */
  readonly scope: string;
  /** Allowed values, in declaration order, when the setting is an enum. */
  readonly enum: readonly unknown[] | undefined;
}

/** One settings group. */
export interface SettingsSectionDescription {
  readonly section: string;
  /** How an invalid configured value is treated: `'strict'` or `'lenient'`. */
  readonly policy: string;
  /** Whether the extension contributes the section, or only reads one the host or another extension owns. */
  readonly contributed: boolean;
  readonly values: readonly SettingDescription[];
  readonly moduleId: string;
}

/** One typed storage key. */
export interface StorageDescription {
  readonly key: string;
  readonly scope: 'global' | 'workspace';
  /** Whether the key participates in Settings Sync. */
  readonly syncable: boolean;
  /** The schema version values are written at. */
  readonly version: number;
  /** Whether a schema validates what is read and written. */
  readonly validated: boolean;
  readonly ttlMs: number | undefined;
  readonly legacyKeys: readonly string[];
  /** Versions a migration step is registered for, ascending. */
  readonly migratesFrom: readonly number[];
  readonly moduleId: string;
}

/** One declared secret. Names only — a value never exists at plan time. */
export interface SecretDescription {
  readonly key: string;
  readonly validated: boolean;
  readonly moduleId: string;
}

/** One declared file watcher. */
export interface FileWatcherDescription {
  readonly id: string;
  /** Globs, with a relative pattern rendered as `<base>::<glob>`. */
  readonly patterns: readonly string[];
  readonly ignorePatterns: readonly string[];
  /** Event kinds watched, or the default three when unspecified. */
  readonly events: readonly string[];
  readonly debounceDelayMs: number | undefined;
  readonly maxWaitMs: number | undefined;
  readonly maxBatchSize: number | undefined;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly moduleId: string;
}

/** One declared status bar item. */
export interface StatusBarItemDescription {
  readonly id: string;
  readonly alignment: string | undefined;
  readonly priority: number | undefined;
  readonly moduleId: string;
}

/** One declared language status item. */
export interface LanguageStatusItemDescription {
  readonly id: string;
  /** Short name shown in the Language Status hover. */
  readonly name: string;
  readonly moduleId: string;
}

/**
 * A declaration identified by an id and resolved from the container: a tree
 * view, a webview view, a panel restorer, a managed raw registration.
 */
export interface RegistrationDescription {
  readonly id: string;
  readonly dependencies: Readonly<Record<string, string>>;
  readonly moduleId: string;
}

/**
 * Everything a compiled plan registers, as JSON.
 *
 * Every list is in declaration order, so two runs over the same modules
 * produce the same document and a diff means something changed.
 */
export interface ApplicationPlanDescription {
  readonly name: string;
  readonly shutdown: { readonly timeoutMs: number };
  readonly modules: readonly ModuleDescription[];
  readonly services: readonly ServiceDescription[];
  /**
   * Token ids the Application registers itself, which a module may inject
   * without declaring: `Notifications`, `Editors`, `Log` and the rest.
   */
  readonly frameworkServices: readonly string[];
  readonly commands: readonly CommandDescription[];
  readonly hostedServices: readonly HostedServiceDescription[];
  readonly settings: readonly SettingsSectionDescription[];
  readonly storage: readonly StorageDescription[];
  readonly secrets: readonly SecretDescription[];
  readonly fileWatchers: readonly FileWatcherDescription[];
  readonly statusBarItems: readonly StatusBarItemDescription[];
  readonly languageStatusItems: readonly LanguageStatusItemDescription[];
  readonly treeViews: readonly RegistrationDescription[];
  readonly webviewViews: readonly RegistrationDescription[];
  /** Panel restorers, keyed by the `viewType` they restore. */
  readonly webviewSerializers: readonly RegistrationDescription[];
  readonly rawRegistrations: readonly RegistrationDescription[];
}

/**
 * Which module declared each entry.
 *
 * Some declarations carry a `moduleId` and some do not, so rather than
 * depending on which is which, ownership is recovered the same way for all of
 * them: the plan's flat lists hold the very objects the modules hold, so
 * identity answers it.
 */
function owners<T extends object>(
  modules: readonly Module[],
  pick: (module: Module) => readonly T[]
): ReadonlyMap<T, string> {
  const owner = new Map<T, string>();
  for (const module of modules) {
    for (const entry of pick(module)) {
      owner.set(entry, module.id);
    }
  }
  return owner;
}

/**
 * Turns a declared dependency map into token ids.
 *
 * `defineOwn` rather than assignment: the names come from a declaration this
 * package did not write, and one of them would reach `Object.prototype`'s
 * `__proto__` setter instead of creating a property.
 */
function dependencyIds(dependencies: Dependencies): Readonly<Record<string, string>> {
  const ids: Record<string, string> = {};
  for (const [name, token] of Object.entries(dependencies)) {
    defineOwn(ids, name, token.id);
  }
  return ids;
}

/** Renders one glob. A relative pattern keeps its base, which is what makes it relative. */
function patternText(pattern: string | { readonly baseUri: { toString(): string } }): string {
  if (typeof pattern === 'string') {
    return pattern;
  }
  const relative = pattern as {
    readonly baseUri: { toString(): string };
    readonly pattern: string;
  };
  return `${relative.baseUri.toString()}::${relative.pattern}`;
}

/** Both spellings of `patterns` — one glob or several — as a list. */
function patternList(patterns: WatcherPattern): readonly string[] {
  return Array.isArray(patterns)
    ? patterns.map((pattern: string | { readonly baseUri: { toString(): string } }) =>
        patternText(pattern)
      )
    : [patternText(patterns as string | { readonly baseUri: { toString(): string } })];
}

/** A JSON Schema `type` is a name or a list of them; a list is easier to read. */
function typeNames(spec: SettingSpec): readonly string[] {
  return Array.isArray(spec.type) ? [...(spec.type as readonly string[])] : [spec.type as string];
}

/**
 * Describes a compiled plan.
 *
 * Deterministic: the same modules produce the same document, in declaration
 * order. Nothing callable and nothing opaque crosses the boundary — no
 * factories, handlers, schemas, providers or token objects — so the result is
 * safe to `JSON.stringify`, commit, diff and hand to a tool.
 *
 * Secret *keys* appear, because a declared key is metadata the extension's own
 * source states in the clear. Secret values do not exist at plan time and
 * never could.
 *
 * @example
 * ```ts
 * const description = describePlan(app.plan);
 * console.log(description.commands.map((command) => command.id));
 * ```
 */
export function describePlan(plan: ApplicationPlan): ApplicationPlanDescription {
  const modules = plan.modules;
  const settingsOwner = owners(modules, (module) => module.settings);
  const storageOwner = owners(modules, (module) => module.storage);
  const secretOwner = owners(modules, (module) => module.secrets);
  const statusBarOwner = owners(modules, (module) => module.statusBarItems);
  const languageStatusOwner = owners(modules, (module) => module.languageStatusItems);

  const unknownModule = '<unknown>';

  return {
    name: plan.name,
    shutdown: { timeoutMs: plan.shutdown.timeoutMs },

    modules: modules.map((module) => ({
      id: module.id,
      compatibility: module.compatibility,
      requires: {
        workspace: module.requires.workspace === true,
        trust: module.requires.trust === true,
        localFileSystem: module.requires.localFileSystem === true,
      },
      source: module.source,
    })),

    services: plan.services.map((service) => ({
      token: service.token.id,
      lifetime: service.lifetime,
      dependencies: dependencyIds(service.dependencies),
      moduleId: service.moduleId,
    })),

    frameworkServices: FRAMEWORK_SERVICES.map((token) => token.id),

    commands: [
      ...plan.commands.map((command) => ({ command, textEditor: false })),
      ...plan.textEditorCommands.map((command) => ({ command, textEditor: true })),
    ].map(({ command, textEditor }) => ({
      id: command.contract.descriptor.id,
      title: command.contract.descriptor.title,
      category: command.contract.descriptor.category,
      textEditor,
      validated: command.contract.args !== undefined,
      dependencies: dependencyIds(command.dependencies),
      moduleId: command.moduleId,
    })),

    hostedServices: plan.hostedServices.map((service) => ({
      id: service.id,
      start: service.start !== undefined,
      run: service.run !== undefined,
      stop: service.stop !== undefined,
      dependencies: dependencyIds(service.dependencies),
      moduleId: service.moduleId,
    })),

    settings: plan.settings.map((registration) => ({
      section: registration.section,
      policy: registration.policy,
      contributed: registration.contributed,
      values: Object.entries(registration.values).map(([name, spec]) => ({
        key: `${registration.section}.${name}`,
        type: typeNames(spec),
        default: spec.default,
        scope: spec.scope,
        enum: spec.enum === undefined ? undefined : [...spec.enum],
      })),
      moduleId: settingsOwner.get(registration) ?? unknownModule,
    })),

    storage: plan.storage.map((registration) => ({
      key: registration.key,
      scope: registration.scope,
      syncable: registration.syncable === true,
      version: registration.options.version ?? 1,
      validated: registration.options.schema !== undefined,
      ttlMs: registration.options.ttlMs,
      legacyKeys: [...(registration.options.legacyKeys ?? [])],
      migratesFrom: Object.keys(registration.options.migrations ?? {})
        .map((version) => Number(version))
        .sort((left, right) => left - right),
      moduleId: storageOwner.get(registration) ?? unknownModule,
    })),

    secrets: plan.secrets.map((registration) => ({
      key: registration.key,
      validated: registration.schema !== undefined,
      moduleId: secretOwner.get(registration) ?? unknownModule,
    })),

    fileWatchers: plan.fileWatchers.map((watcher) => ({
      id: watcher.id,
      patterns: patternList(watcher.patterns),
      ignorePatterns: [...(watcher.ignorePatterns ?? [])],
      events: [...(watcher.events ?? ['create', 'change', 'delete'])],
      debounceDelayMs: watcher.debounceDelay,
      maxWaitMs: watcher.maxWait,
      maxBatchSize: watcher.maxBatchSize,
      dependencies: dependencyIds(watcher.dependencies),
      moduleId: watcher.moduleId,
    })),

    statusBarItems: plan.statusBarItems.map((item) => ({
      id: item.id,
      alignment: item.alignment,
      priority: item.priority,
      moduleId: statusBarOwner.get(item) ?? unknownModule,
    })),

    languageStatusItems: plan.languageStatusItems.map((item) => ({
      id: item.id,
      name: item.name,
      moduleId: languageStatusOwner.get(item) ?? unknownModule,
    })),

    treeViews: plan.treeViews.map((view) => ({
      id: view.id,
      dependencies: dependencyIds(view.dependencies),
      moduleId: view.moduleId,
    })),

    webviewViews: plan.webviewViews.map((view) => ({
      id: view.id,
      dependencies: dependencyIds(view.dependencies),
      moduleId: view.moduleId,
    })),

    webviewSerializers: plan.webviewSerializers.map((serializer) => ({
      id: serializer.viewType,
      dependencies: dependencyIds(serializer.dependencies),
      moduleId: serializer.moduleId,
    })),

    rawRegistrations: plan.rawRegistrations.map((registration) => ({
      id: registration.id,
      dependencies: dependencyIds(registration.dependencies),
      moduleId: registration.moduleId,
    })),
  };
}
