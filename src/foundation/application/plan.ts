/**
 * Definition-time compiler for extension applications.
 *
 * `defineModule` produces immutable module declarations; this file combines
 * them into one `ApplicationPlan` and rejects conflicts before activation.
 * Runtime host facts such as workspace trust are intentionally left to
 * `runtimePreflight`, while ids, dependency reachability, lifetime rules and
 * declaration-wide uniqueness are checked here without creating services or
 * touching the platform.
 *
 * When adding a new declaration kind, update all three parts together: flatten
 * it from modules, validate every identity/dependency invariant it introduces,
 * and include a frozen collection in the returned plan. If the Application
 * synthesises an injectable service for that declaration, its token must also
 * be included in the `registered` set below.
 */
import type { CommandDefinition, TextEditorCommandDefinition } from '../commands/definition.js';
import type { HostedServiceDefinition } from '../hosted-services/definition.js';
import { PreflightError } from '../internal/errors.js';
import type { ModuleDefinition } from '../modules/definition.js';
import type { ServiceDescriptor } from '../services/descriptors.js';
import { validateServiceGraph } from '../services/graph.js';
import type { ServiceMap, ServiceToken } from '../services/token.js';
import type { RawRegistrationDefinition } from '../raw/definition.js';
import type { SettingsRegistration } from '../settings/definition.js';
import type {
  SecretRegistration,
  StorageRegistration,
} from '../../capabilities/storage/definition.js';
import type {
  LanguageStatusItemDefinition,
  StatusBarItemDefinition,
} from '../../capabilities/ui/definition.js';
import { Editors } from '../../capabilities/editor/editor.js';
import { Secrets } from '../../capabilities/secrets/secrets.js';
import { StatusBar } from '../../capabilities/ui/status-bar-service.js';
import { Localization } from '../../capabilities/l10n/localization.js';
import { Webviews } from '../../capabilities/views/webview/host.js';
import { Notifications } from '../../capabilities/ui/notifications.js';
import { QuickInput } from '../../capabilities/ui/quick-input-service.js';
import { Commands } from '../../capabilities/commands/commands.js';
import { FileWatchers } from '../../capabilities/workspace/watch-service.js';
import { Operations } from '../operations/service.js';
import { Log } from '../logging/token.js';
import type { TreeViewDefinition } from '../../capabilities/views/definition.js';
import type {
  WebviewPanelSerializerDefinition,
  WebviewViewDefinition,
} from '../../capabilities/views/webview/definition.js';
import type { FileWatcherDefinition } from '../../capabilities/workspace/watcher-definition.js';

/** Shutdown policy shared by every phase of an Application stop. */
interface ShutdownPolicy {
  /** Total budget in milliseconds for stop hooks, drains and resource cleanup. */
  readonly timeoutMs: number;
}

/**
 * An immutable, validated application.
 *
 * Definition-time invariants have been checked before this exists, so runtime
 * binding does not discover an internal id clash or broken dependency graph.
 * Platform conflicts and host-dependent requirements can still fail activation
 * and are rolled back by the Application Host.
 */
export interface ApplicationPlan {
  readonly name: string;
  readonly modules: readonly ModuleDefinition[];
  readonly services: readonly ServiceDescriptor[];
  readonly commands: readonly CommandDefinition[];
  readonly textEditorCommands: readonly TextEditorCommandDefinition[];
  readonly hostedServices: readonly HostedServiceDefinition[];
  readonly settings: readonly SettingsRegistration[];
  readonly storage: readonly StorageRegistration[];
  readonly secrets: readonly SecretRegistration[];
  readonly fileWatchers: readonly FileWatcherDefinition[];
  readonly statusBarItems: readonly StatusBarItemDefinition[];
  readonly languageStatusItems: readonly LanguageStatusItemDefinition[];
  readonly treeViews: readonly TreeViewDefinition[];
  readonly webviewViews: readonly WebviewViewDefinition[];
  readonly webviewSerializers: readonly WebviewPanelSerializerDefinition[];
  readonly rawRegistrations: readonly RawRegistrationDefinition[];
  readonly shutdown: ShutdownPolicy;
}

/** Options for {@link compileApplication}. */
export interface CompileApplicationOptions {
  /** Application name, used in scope names and diagnostics. */
  readonly name: string;
  /**
   * Modules in binding order. Their registrations commit in this order, and
   * hosted services start in the flattened declaration order.
   */
  readonly modules: readonly ModuleDefinition[];
  /** Shutdown policy. Defaults to a 3000 ms budget. */
  readonly shutdown?: { readonly timeoutMs?: number } | undefined;
}

const DEFAULT_SHUTDOWN_TIMEOUT_MS = 3_000;

/**
 * Tokens the Application registers itself rather than a module.
 *
 * Named once because two things need the same list: preflight, which must not
 * report a module injecting one of these as depending on nothing, and
 * `describePlan`, which reports what is injectable without being declared.
 * Adding a framework service means adding it here.
 */
export const FRAMEWORK_SERVICES: readonly ServiceToken<unknown>[] = Object.freeze([
  Notifications,
  QuickInput,
  Localization,
  Editors,
  Webviews,
  Secrets,
  StatusBar,
  Commands,
  FileWatchers,
  Operations,
  Log,
]);

/**
 * Compiles modules into an immutable plan, reporting every definition-time
 * problem it can find before a single platform registration happens.
 *
 * Runs at definition time, so it can be exercised in a plain unit test with no
 * extension host involved.
 *
 * Module definitions are expected to come from `defineModule`, which already
 * freezes their entries. This compiler snapshots the module list and every
 * flattened plan collection; it does not mutate caller-owned definitions.
 *
 * @throws {@link PreflightError} listing every problem found. No partial plan
 * is returned and no module callback is run by this function.
 *
 * @example
 * ```ts
 * const plan = compileApplication({
 *   name: 'sample',
 *   modules: [coreModule, projectsModule],
 * });
 * ```
 */
export function compileApplication(options: CompileApplicationOptions): ApplicationPlan {
  const issues: string[] = [];

  const moduleIds = new Set<string>();
  for (const module of options.modules) {
    if (moduleIds.has(module.id)) {
      issues.push(`Module "${module.id}" is registered more than once.`);
      continue;
    }
    moduleIds.add(module.id);
  }

  const services = options.modules.flatMap((module) => module.services);
  const commands = options.modules.flatMap((module) => module.commands);
  const textEditorCommands = options.modules.flatMap((module) => module.textEditorCommands);
  const hostedServices = options.modules.flatMap((module) => module.hostedServices);
  const settings = options.modules.flatMap((module) => module.settings);
  const storage = options.modules.flatMap((module) => module.storage);
  const secrets = options.modules.flatMap((module) => module.secrets);
  const fileWatchers = options.modules.flatMap((module) => module.fileWatchers);
  const statusBarItems = options.modules.flatMap((module) => module.statusBarItems);
  const languageStatusItems = options.modules.flatMap((module) => module.languageStatusItems);
  const treeViews = options.modules.flatMap((module) => module.treeViews);
  const webviewViews = options.modules.flatMap((module) => module.webviewViews);
  const webviewSerializers = options.modules.flatMap((module) => module.webviewSerializers);
  const rawRegistrations = options.modules.flatMap((module) => module.rawRegistrations);

  const watcherIds = new Set<string>();
  for (const watcher of fileWatchers) {
    if (watcherIds.has(watcher.id)) {
      issues.push(`File watcher "${watcher.id}" is registered more than once.`);
      continue;
    }
    watcherIds.add(watcher.id);
  }

  const statusBarIds = new Set<string>();
  for (const item of statusBarItems) {
    if (statusBarIds.has(item.id)) {
      issues.push(`Status bar item "${item.id}" is registered more than once.`);
      continue;
    }
    statusBarIds.add(item.id);
  }

  const languageStatusIds = new Set<string>();
  for (const item of languageStatusItems) {
    if (languageStatusIds.has(item.id)) {
      issues.push(`Language status item "${item.id}" is registered more than once.`);
      continue;
    }
    languageStatusIds.add(item.id);
  }

  const treeViewIds = new Set<string>();
  for (const view of treeViews) {
    if (treeViewIds.has(view.id)) {
      issues.push(`Tree view "${view.id}" is registered more than once.`);
      continue;
    }
    treeViewIds.add(view.id);
  }

  const serializerTypes = new Set<string>();
  for (const serializer of webviewSerializers) {
    if (serializerTypes.has(serializer.viewType)) {
      issues.push(`Webview panel restorer "${serializer.viewType}" is registered more than once.`);
      continue;
    }
    serializerTypes.add(serializer.viewType);
  }

  const webviewViewIds = new Set<string>();
  for (const view of webviewViews) {
    if (webviewViewIds.has(view.id)) {
      issues.push(`Webview view "${view.id}" is registered more than once.`);
      continue;
    }
    webviewViewIds.add(view.id);
  }

  const storageIds = new Set<string>();
  for (const registration of storage) {
    const id = `${registration.scope}:${registration.key}`;
    if (storageIds.has(id)) {
      issues.push(
        `Storage key "${registration.key}" (${registration.scope}) is registered more than once.`
      );
      continue;
    }
    storageIds.add(id);

    if (registration.syncable === true && registration.scope !== 'global') {
      issues.push(
        `Storage key "${registration.key}" declares syncable but is workspace-scoped; ` +
          'workspaceState is never synced.'
      );
    }
  }

  const secretIds = new Set<string>();
  for (const registration of secrets) {
    if (secretIds.has(registration.key)) {
      issues.push(`Secret key "${registration.key}" is registered more than once.`);
      continue;
    }
    secretIds.add(registration.key);
  }

  const rawIds = new Set<string>();
  for (const registration of rawRegistrations) {
    if (rawIds.has(registration.id)) {
      issues.push(`Raw registration "${registration.id}" is registered more than once.`);
      continue;
    }
    rawIds.add(registration.id);
  }

  const settingsSections = new Set<string>();
  for (const registration of settings) {
    if (settingsSections.has(registration.section)) {
      issues.push(`Settings section "${registration.section}" is registered more than once.`);
      continue;
    }
    settingsSections.add(registration.section);
  }

  // One namespace: a text editor command and a plain command with the same id
  // clash in VS Code exactly like two plain commands do.
  const commandOwners = new Map<string, string>();
  for (const command of [...commands, ...textEditorCommands]) {
    const id = command.contract.descriptor.id;
    const existing = commandOwners.get(id);
    if (existing !== undefined) {
      issues.push(
        `Command "${id}" has handlers in both "${existing}" and "${command.moduleId}". ` +
          'VS Code allows only one handler per command id.'
      );
      continue;
    }
    commandOwners.set(id, command.moduleId);
  }

  const hostedServiceOwners = new Map<string, string>();
  for (const hostedService of hostedServices) {
    const existing = hostedServiceOwners.get(hostedService.id);
    if (existing !== undefined) {
      issues.push(
        `Hosted service "${hostedService.id}" is registered in both "${existing}" and ` +
          `"${hostedService.moduleId}".`
      );
      continue;
    }
    hostedServiceOwners.set(hostedService.id, hostedService.moduleId);

    if (
      hostedService.start === undefined &&
      hostedService.run === undefined &&
      hostedService.stop === undefined
    ) {
      issues.push(`Hosted service "${hostedService.id}" declares no start, run or stop.`);
    }
  }

  /**
   * Everything the container will be able to resolve.
   *
   * `services` is only the part a module registered directly. The framework
   * builds a descriptor for each declared setting, storage, secret and UI item
   * too, and synthesises its own services on top — all resolvable, none of them
   * in `services`. One missing entry here makes preflight reject a perfectly
   * valid application.
   */
  const registered = new Set<ServiceToken<unknown>>([
    ...services.map((service) => service.token),
    ...settings.map((registration) => registration.token),
    ...storage.map((registration) => registration.token),
    ...secrets.map((registration) => registration.token),
    ...statusBarItems.map((item) => item.token),
    ...languageStatusItems.map((item) => item.token),
    ...FRAMEWORK_SERVICES,
  ]);

  // The graph is checked against the same set. A service that injects a
  // declared storage or a framework token is ordinary, and the module-registered
  // descriptors alone cannot see either.
  for (const issue of validateServiceGraph(services, { provided: registered })) {
    issues.push(issue.message);
  }

  // Commands, hosted services and the rest take dependencies too, and those
  // tokens are not part of the service-to-service graph.
  const checkDependencies = (dependencies: ServiceMap, owner: string, moduleId: string): void => {
    for (const [name, token] of Object.entries(dependencies)) {
      if (!registered.has(token)) {
        issues.push(
          `${owner} in module "${moduleId}" depends on "${token.id}" as "${name}", ` +
            'but nothing registers that token.'
        );
      }
    }
  };

  for (const command of [...commands, ...textEditorCommands]) {
    checkDependencies(
      command.dependencies,
      `Command "${command.contract.descriptor.id}"`,
      command.moduleId
    );
  }
  for (const hostedService of hostedServices) {
    checkDependencies(
      hostedService.dependencies,
      `Hosted service "${hostedService.id}"`,
      hostedService.moduleId
    );
  }
  for (const registration of rawRegistrations) {
    checkDependencies(
      registration.dependencies,
      `Raw registration "${registration.id}"`,
      registration.moduleId
    );
  }
  for (const watcher of fileWatchers) {
    checkDependencies(watcher.dependencies, `File watcher "${watcher.id}"`, watcher.moduleId);
  }
  for (const view of treeViews) {
    checkDependencies(view.dependencies, `Tree view "${view.id}"`, view.moduleId);
  }
  for (const view of webviewViews) {
    checkDependencies(view.dependencies, `Webview view "${view.id}"`, view.moduleId);
  }
  for (const serializer of webviewSerializers) {
    checkDependencies(
      serializer.dependencies,
      `Webview panel restorer "${serializer.viewType}"`,
      serializer.moduleId
    );
  }

  if (issues.length > 0) {
    throw new PreflightError(issues);
  }

  return Object.freeze({
    name: options.name,
    modules: Object.freeze([...options.modules]),
    services: Object.freeze(services),
    commands: Object.freeze(commands),
    textEditorCommands: Object.freeze(textEditorCommands),
    hostedServices: Object.freeze(hostedServices),
    settings: Object.freeze(settings),
    storage: Object.freeze(storage),
    secrets: Object.freeze(secrets),
    fileWatchers: Object.freeze(fileWatchers),
    statusBarItems: Object.freeze(statusBarItems),
    languageStatusItems: Object.freeze(languageStatusItems),
    treeViews: Object.freeze(treeViews),
    webviewViews: Object.freeze(webviewViews),
    webviewSerializers: Object.freeze(webviewSerializers),
    rawRegistrations: Object.freeze(rawRegistrations),
    shutdown: Object.freeze({
      timeoutMs: options.shutdown?.timeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
    }),
  });
}
