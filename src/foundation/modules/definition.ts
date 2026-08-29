/**
 * Definition stage of the extension construction pipeline.
 *
 * A `defineModule` callback records declarations only. It does not resolve
 * services, register with VS Code or perform asynchronous initialisation. The
 * resulting `ModuleDefinition` is later combined and validated by
 * `compileApplication`, then bound transactionally by `createApplication`.
 *
 * Registration helpers in this file preserve the compiler boundary: callbacks
 * and opaque application objects keep their identity, while framework-owned
 * maps, arrays and option bags normalized here are snapshotted and frozen. A
 * configure callback is synchronous, and no partial `ModuleDefinition` is
 * published if it throws; runtime work belongs in handlers or hosted services.
 */
import type { CommandContract } from '../commands/contract.js';
import type { CommandDefinition, TextEditorCommandDefinition } from '../commands/definition.js';
import type {
  HostedServiceContext,
  HostedServiceStopContext,
} from '../hosted-services/definition.js';
import type { HostedServiceDefinition } from '../hosted-services/definition.js';
import { AsyncCallbackError } from '../internal/errors.js';
import { frozenCopy, frozenIfArray } from '../internal/immutable.js';
import { claimRejection, isThenable } from '../internal/thenable.js';
import type { ModuleCompatibility, ModuleRequirements } from './compatibility.js';
import type { OperationContext } from '../operations/context.js';
import type { ServiceDescriptor } from '../services/descriptors.js';
import { ServiceLifetime } from '../services/descriptors.js';
import type { Injected, ServiceMap, ServiceToken } from '../services/token.js';
import type { RawRegistrationContext, RawRegistrationDefinition } from '../raw/definition.js';
import type {
  SettingSpecs,
  SettingsDefinition,
  SettingsRegistration,
} from '../settings/definition.js';
import type {
  SecretDefinition,
  SecretRegistration,
  StorageDefinition,
  StorageRegistration,
} from '../../capabilities/storage/definition.js';
import type {
  LanguageStatusItemDefinition,
  StatusBarItemDefinition,
} from '../../capabilities/ui/definition.js';
import type { ActiveEditor } from '../../capabilities/editor/editor.js';
import type { TreeViewDefinition } from '../../capabilities/views/definition.js';
import type {
  WebviewPanelSerializerDefinition,
  WebviewViewDefinition,
} from '../../capabilities/views/webview/definition.js';
import type { TreeViewOptionsLike, WebviewViewRequest } from '../platform/ports.js';
import type {
  FileWatcherEvent,
  FileWatcherOptions,
} from '../../capabilities/workspace/filewatcher.js';
import type { FileWatcherDefinition } from '../../capabilities/workspace/watcher-definition.js';

/**
 * Records service descriptors for the Module.
 *
 * Factories are synchronous and lazy: registration creates no instance.
 * Dependencies must be declared in the overload's `inject` map so plan
 * preflight can validate the graph and lifetime rules before activation.
 */
export interface ServiceCollection {
  /** Registers a lazily-created Application singleton with no dependencies. */
  singleton<T>(token: ServiceToken<T>, create: () => T): void;
  /** Registers a lazily-created Application singleton with declared dependencies. */
  singleton<T, TMap extends ServiceMap>(
    token: ServiceToken<T>,
    registration: {
      readonly inject: TMap;
      readonly create: (injected: Injected<TMap>) => T;
    }
  ): void;

  /**
   * Registers a new instance for every resolution, with no dependencies.
   * Disposable transients must tear down synchronously.
   */
  transient<T>(token: ServiceToken<T>, create: () => T): void;
  /**
   * Registers a new instance for every resolution, with declared dependencies.
   * Disposable transients must tear down synchronously.
   */
  transient<T, TMap extends ServiceMap>(
    token: ServiceToken<T>,
    registration: {
      readonly inject: TMap;
      readonly create: (injected: Injected<TMap>) => T;
    }
  ): void;
}

/**
 * Records command handlers for the Module.
 *
 * Each invocation runs as an Operation. Dependencies are resolved for that
 * Operation, disposable transients are owned by its ResourceScope, and a plain
 * command handler's value or rejection is preserved for its caller. The text
 * editor-specific registration below documents its narrower platform contract.
 */
export interface CommandCollection<TUses extends ServiceMap = Record<never, never>> {
  /** Handles a command with no dependencies. */
  handle<TArgs extends readonly unknown[], TResult>(
    contract: CommandContract<TArgs, TResult>,
    execute: (
      context: OperationContext,
      args: TArgs,
      injected: Injected<TUses>
    ) => TResult | Promise<TResult>
  ): void;
  /** Handles a command with declared dependencies. */
  handle<TArgs extends readonly unknown[], TResult, TMap extends ServiceMap>(
    contract: CommandContract<TArgs, TResult>,
    registration: {
      readonly inject: TMap;
      readonly execute: (
        context: OperationContext,
        args: TArgs,
        injected: Injected<TUses & TMap>
      ) => TResult | Promise<TResult>;
    }
  ): void;

  /**
   * Handles a command that needs an editor.
   *
   * Registered with `registerTextEditorCommand`, so VS Code only invokes it
   * with an editor focused and skips it otherwise, rather than calling a
   * handler that has to give up. Prefer it for anything that edits or reads
   * the current document.
   *
   * The trade is real, and it is VS Code's, not the framework's: the registered
   * callback has a `void` contract and runs inside the platform's edit
   * transaction. The framework can start an asynchronous Operation there, but
   * its result or rejection does not become the result of `commands.execute`.
   * Operation failures are still logged by the framework. Declare a command
   * with {@link CommandCollection.handle} instead when a caller must await the
   * result, and take the editor from `Editors.active`.
   *
   * It also does not grey the palette entry out; that is the `enablement` /
   * `commandPalette` `when` clause in package.json.
   *
   * The editor is the same {@link ActiveEditor} the `Editors` service hands
   * out, so a feature written against one works with either declaration.
   *
   * The dependency-declaring overload is listed first: overload resolution
   * takes the first match, and the no-dependency shape would otherwise absorb
   * the call.
   *
   * @example
   * ```ts
   * module.handleTextEditor(UpperCase, {
   *   inject: { history: History },
   *   execute: async (_context, editor, _args, { history }) => {
   *     await editor.transformSelections((text) => text.toUpperCase());
   *     await history.record('case.upper');
   *   },
   * });
   * ```
   */
  handleTextEditor<TArgs extends readonly unknown[], TResult, TMap extends ServiceMap>(
    contract: CommandContract<TArgs, TResult>,
    registration: {
      readonly inject: TMap;
      readonly execute: (
        context: OperationContext,
        editor: ActiveEditor,
        args: TArgs,
        injected: Injected<TUses & TMap>
      ) => TResult | Promise<TResult>;
    }
  ): void;
  /** Handles a text editor command with no dependencies. */
  handleTextEditor<TArgs extends readonly unknown[], TResult>(
    contract: CommandContract<TArgs, TResult>,
    execute: (
      context: OperationContext,
      editor: ActiveEditor,
      args: TArgs,
      injected: Injected<TUses>
    ) => TResult | Promise<TResult>
  ): void;
}

/**
 * Records long-lived Application work. Start order is declaration order; stop
 * order is the reverse, and the same injected instances are passed to both.
 * Background loops must observe `context.signal`; the Host observes their
 * promise and waits for settlement only within the shared shutdown budget.
 * Non-cooperative work can outlive that budget.
 *
 * The dependency-declaring overload is listed first: overload resolution takes the
 * first match, and the no-dependency shape would otherwise absorb the call and
 * leave the callback parameters untyped.
 */
export interface HostedServiceCollection<TUses extends ServiceMap = Record<never, never>> {
  /** Adds a hosted service with declared dependencies. */
  add<TMap extends ServiceMap>(definition: {
    readonly id: string;
    readonly inject: TMap;
    readonly start?: (
      context: HostedServiceContext,
      injected: Injected<TUses & TMap>
    ) => void | Promise<void>;
    readonly stop?: (
      context: HostedServiceStopContext,
      injected: Injected<TUses & TMap>
    ) => void | Promise<void>;
  }): void;
  /** Adds a hosted service with an explicit start/stop lifecycle and no dependencies. */
  add(definition: {
    readonly id: string;
    readonly start?: (context: HostedServiceContext) => void | Promise<void>;
    readonly stop?: (context: HostedServiceStopContext) => void | Promise<void>;
  }): void;

  /**
   * Adds a background loop with declared dependencies. A rejection is logged
   * and diagnosed; it does not fail an already-running Application.
   */
  background<TMap extends ServiceMap>(definition: {
    readonly id: string;
    readonly inject: TMap;
    readonly run: (
      context: HostedServiceContext,
      injected: Injected<TUses & TMap>
    ) => void | Promise<void>;
  }): void;
  /**
   * Adds a background loop with no dependencies. It starts during activation
   * without blocking activation, but its rejection is observed and shutdown
   * waits for it up to the remaining shared budget.
   */
  background(definition: {
    readonly id: string;
    readonly run: (context: HostedServiceContext) => void | Promise<void>;
  }): void;
}

/** Records typed settings groups whose accessors become Application singletons. */
export interface SettingsCollection {
  /**
   * Registers a settings group, making its accessor injectable under
   * `definition.token`.
   */
  add<TSpecs extends SettingSpecs>(definition: SettingsDefinition<TSpecs>): void;
}

/**
 * Records file watchers whose event batches run as Operations. The Module's
 * RegistrationScope owns the watcher, while each callback gets its own
 * Operation ResourceScope and dependency resolver.
 *
 * The dependency-declaring overload is listed first: overload resolution takes
 * the first match, and the no-dependency shape would otherwise absorb the call.
 */
export interface FileWatcherCollection<TUses extends ServiceMap = Record<never, never>> {
  /** Adds a watcher with declared dependencies. */
  add<TMap extends ServiceMap>(
    definition: FileWatcherOptions & {
      readonly id: string;
      readonly inject: TMap;
      readonly handle: (
        context: OperationContext,
        events: readonly FileWatcherEvent[],
        injected: Injected<TUses & TMap>
      ) => void | Promise<void>;
    }
  ): void;
  /** Adds a watcher needing only the module's ambient set. */
  add(
    definition: FileWatcherOptions & {
      readonly id: string;
      readonly handle: (
        context: OperationContext,
        events: readonly FileWatcherEvent[],
        injected: Injected<TUses>
      ) => void | Promise<void>;
    }
  ): void;
}

/**
 * Records tree views created at activation. Declared dependencies are resolved
 * through the Application container and the provider is created once while the
 * Module binds, so disposable transient dependencies have Application lifetime.
 * The Module RegistrationScope owns the native view and also calls the
 * provider's synchronous `dispose` when the provider exposes one.
 *
 * The dependency-declaring overload is listed first: overload resolution
 * takes the first match, and the no-dependency shape would otherwise absorb
 * the call.
 */
export interface TreeViewCollection<TUses extends ServiceMap = Record<never, never>> {
  /** Adds a tree view whose provider is built from declared dependencies. */
  add<TMap extends ServiceMap>(definition: {
    readonly id: string;
    readonly inject: TMap;
    readonly resolveProvider: (injected: Injected<TUses & TMap>) => unknown;
    readonly options?: TreeViewOptionsLike;
  }): void;
  /** Adds a tree view whose provider needs only the module's ambient set. */
  add(definition: {
    readonly id: string;
    readonly resolveProvider: (injected: Injected<TUses>) => unknown;
    readonly options?: TreeViewOptionsLike;
  }): void;
}

/**
 * Records webview views contributed in `package.json`.
 *
 * The registration happens at activation; the callback runs when the user first
 * reveals or recreates the view, which is when VS Code asks for its content.
 * Declared dependencies are resolved once through the Application container
 * during Module binding and reused by each resolve callback. A disposable
 * transient dependency is therefore Application-owned, not per-view; create
 * per-view state inside `resolve`.
 *
 * The dependency-declaring overload is listed first: overload resolution takes
 * the first match, and the no-dependency shape would otherwise absorb the call.
 */
export interface WebviewCollection<TUses extends ServiceMap = Record<never, never>> {
  /** Adds a view filled in from declared dependencies. */
  addView<TMap extends ServiceMap, TView = unknown>(definition: {
    readonly id: string;
    readonly inject: TMap;
    readonly resolve: (view: TView, injected: Injected<TUses & TMap>) => void | Promise<void>;
    readonly options?: WebviewViewRequest;
  }): void;
  /** Adds a view that needs only the module's ambient set. */
  addView<TView = unknown>(definition: {
    readonly id: string;
    readonly resolve: (view: TView, injected: Injected<TUses>) => void | Promise<void>;
    readonly options?: WebviewViewRequest;
  }): void;

  /**
   * Restores a panel of `viewType` when a window reopens with one still in its
   * tab layout. Without this the tab is discarded on reload. Dependencies are
   * resolved once through the Application container during Module binding and
   * reused for each restoration.
   */
  restorePanel<TMap extends ServiceMap, TPanel = unknown, TState = unknown>(definition: {
    readonly viewType: string;
    readonly inject: TMap;
    readonly restore: (
      panel: TPanel,
      state: TState,
      injected: Injected<TUses & TMap>
    ) => void | Promise<void>;
  }): void;
  /** Restores a panel needing only the module's ambient set. */
  restorePanel<TPanel = unknown, TState = unknown>(definition: {
    readonly viewType: string;
    readonly restore: (
      panel: TPanel,
      state: TState,
      injected: Injected<TUses>
    ) => void | Promise<void>;
  }): void;
}

/** Records status bar items created at activation, with injectable controllers. */
export interface StatusBarCollection {
  add(definition: StatusBarItemDefinition): void;
}

/** Records language status items created at activation, with injectable controllers. */
export interface LanguageStatusCollection {
  add(definition: LanguageStatusItemDefinition): void;
}

/** Records typed storage definitions, making their accessors injectable. */
export interface StorageCollection {
  add<T>(definition: StorageDefinition<T>): void;
}

/** Records typed secret definitions, making their accessors injectable. */
export interface SecretCollection {
  add<T>(definition: SecretDefinition<T>): void;
}

/**
 * Records VS Code APIs the framework has no model for. The callback receives
 * the Module scopes needed to participate in ownership and activation rollback;
 * see `RawRegistrationDefinition`.
 */
export interface RawRegistrationCollection<TUses extends ServiceMap = Record<never, never>> {
  /** Registers with declared dependencies. */
  register<TMap extends ServiceMap>(definition: {
    readonly id: string;
    readonly inject: TMap;
    readonly bind: (context: RawRegistrationContext, injected: Injected<TUses & TMap>) => undefined;
  }): void;
  /** Registers with only the module's ambient set. */
  register(definition: {
    readonly id: string;
    readonly bind: (context: RawRegistrationContext, injected: Injected<TUses>) => undefined;
  }): void;
}

/**
 * The builder handed to a {@link defineModule} callback.
 *
 * `TUses` is the module's ambient set — see {@link DefineModuleOptions.uses}.
 * It is merged into commands, hosted services, watchers, views and raw
 * registrations, so callbacks that share a few services declare them once.
 *
 * `services` is deliberately not ambient: a service's dependencies *are* the
 * architecture, preflight validates them as a graph, and an ambient entry could
 * both hide a dependency and make a service depend on itself.
 */
export interface ModuleBuilder<TUses extends ServiceMap = Record<never, never>> {
  readonly services: ServiceCollection;
  readonly commands: CommandCollection<TUses>;
  readonly hostedServices: HostedServiceCollection<TUses>;
  readonly settings: SettingsCollection;
  readonly storage: StorageCollection;
  readonly secrets: SecretCollection;
  readonly fileWatchers: FileWatcherCollection<TUses>;
  readonly statusBar: StatusBarCollection;
  readonly languageStatus: LanguageStatusCollection;
  readonly treeViews: TreeViewCollection<TUses>;
  readonly webviews: WebviewCollection<TUses>;
  readonly raw: RawRegistrationCollection<TUses>;
}

/** Options for {@link defineModule}. */
export interface DefineModuleOptions<TUses extends ServiceMap = Record<never, never>> {
  /**
   * Services merged into commands, hosted services, watchers, views and raw
   * registrations in this Module.
   *
   * A module's handlers usually work with the same few things — a notifier, the
   * settings accessor, the display language. Declaring them per handler means
   * repeating the same map dozens of times, and the usual way out is to build
   * one god-object service that bundles them, which hides the real
   * dependencies behind a token that means nothing.
   *
   * Declared here they are still explicit, still typed and still checked by
   * preflight; they are just declared once. A handler's own `inject` is merged
   * on top, and a name in both is rejected at definition time rather than
   * silently shadowed.
   *
   * @example
   * ```ts
   * const projects = defineModule(
   *   'projects',
   *   { uses: { notify: Notifications, l10n: Localization } },
   *   (module): undefined => {
   *     module.commands.handle(Refresh, (context, _args, { notify, l10n }) => {
   *       void notify.info(l10n.t('Refreshing'));
   *     });
   *     return undefined;
   *   }
   * );
   * ```
   */
  readonly uses?: TUses;
  /**
   * Which hosts this Module can run in. A declared hard incompatibility is
   * enforced by runtime preflight; a positive compatibility claim remains
   * metadata and does not replace bundle validation or host tests.
   *
   * @defaultValue 'unspecified'
   */
  readonly compatibility?: ModuleCompatibility;
  /** What the module needs from the host to work at all. Checked at activation. */
  readonly requires?: ModuleRequirements;
  /**
   * Where this module was declared, for diagnostics.
   *
   * A label rather than a required file path: production bundles should not be
   * forced to carry source locations.
   */
  readonly source?: string;
}

/**
 * A Module declaration whose framework-owned structure is frozen, ready to be
 * compiled into an Application plan. Callback functions and deliberately
 * opaque nested application objects retain their identity. No service instance
 * or platform registration exists until activation.
 *
 * To a consumer this is a handle: `defineModule` produces it, `defineExtension`
 * consumes it. The registration records it carries are the framework's own
 * and not a public contract — `describePlan`, on the compiled application, is
 * the readable form.
 */
export interface ModuleDefinition {
  readonly id: string;
  /** @internal */
  readonly services: readonly ServiceDescriptor[];
  /** @internal */
  readonly commands: readonly CommandDefinition[];
  /** @internal */
  readonly textEditorCommands: readonly TextEditorCommandDefinition[];
  /** @internal */
  readonly hostedServices: readonly HostedServiceDefinition[];
  /** @internal */
  readonly settings: readonly SettingsRegistration[];
  /** @internal */
  readonly storage: readonly StorageRegistration[];
  /** @internal */
  readonly secrets: readonly SecretRegistration[];
  /** @internal */
  readonly fileWatchers: readonly FileWatcherDefinition[];
  /** @internal */
  readonly statusBarItems: readonly StatusBarItemDefinition[];
  /** @internal */
  readonly languageStatusItems: readonly LanguageStatusItemDefinition[];
  /** @internal */
  readonly treeViews: readonly TreeViewDefinition[];
  /** @internal */
  readonly webviewViews: readonly WebviewViewDefinition[];
  /** @internal */
  readonly webviewSerializers: readonly WebviewPanelSerializerDefinition[];
  /** @internal */
  readonly rawRegistrations: readonly RawRegistrationDefinition[];
  /** Declared host compatibility. */
  readonly compatibility: ModuleCompatibility;
  /** Declared host requirements. */
  readonly requires: ModuleRequirements;
  /** Optional diagnostic label for where this module came from. */
  readonly source: string | undefined;
}

/** Shape shared by both registration flavours, before normalisation. */
interface RawRegistration {
  readonly inject?: ServiceMap;
  readonly create?: (injected: Readonly<Record<string, unknown>>) => unknown;
  readonly execute?: (
    context: OperationContext,
    args: readonly unknown[],
    injected: Readonly<Record<string, unknown>>
  ) => unknown;
}

const EMPTY_MAP: ServiceMap = Object.freeze({});

/**
 * Snapshots a declared `inject` map. Preflight resolves these tokens, so the
 * set it validated must be the set the host resolves — the caller's object is
 * copied rather than referenced.
 */
function snapshotInject(inject: ServiceMap | undefined): ServiceMap {
  return inject === undefined ? EMPTY_MAP : Object.freeze({ ...inject });
}

/**
 * Merges the module's ambient set under a handler's own `inject`.
 *
 * A name declared in both is rejected here rather than resolved by precedence:
 * `defineModule` runs at import time, so this fails before VS Code is touched,
 * and silently shadowing a module-wide service with a local one is the kind of
 * mistake that only shows up as the wrong object at runtime.
 */
function withAmbient(
  ambient: ServiceMap,
  inject: ServiceMap | undefined,
  owner: string,
  moduleId: string
): ServiceMap {
  if (inject === undefined) {
    return ambient;
  }
  const clashes = Object.keys(inject).filter((name) => name in ambient);
  if (clashes.length > 0) {
    throw new TypeError(
      `${owner} in module "${moduleId}" injects ${clashes.map((name) => `"${name}"`).join(', ')}, ` +
        'which the module already declares in `uses`. Rename one of them.'
    );
  }
  return Object.freeze({ ...ambient, ...inject });
}

/**
 * Declares a module.
 *
 * This is a definition-phase callback: keep it to builder calls rather than
 * touching `vscode`, performing I/O, starting timers or creating service
 * instances. Those side effects are outside the framework lifecycle and Test
 * Host guarantees. A thenable return is rejected at runtime because TypeScript
 * accepts an async function wherever a `void` callback is expected.
 *
 * @throws {TypeError} when no configure callback is supplied, a service or
 * command registration lacks its required callback, or a local `inject` name
 * duplicates one from `uses`.
 * @throws {AsyncCallbackError} when `configure` returns a thenable. No
 * `ModuleDefinition` is returned in either case.
 *
 * @example
 * ```ts
 * export const projectsModule = defineModule('projects', (module): undefined => {
 *   module.services.singleton(ProjectRepository, {
 *     inject: { clock: Clock },
 *     create: ({ clock }) => new DefaultProjectRepository(clock),
 *   });
 *
 *   module.commands.handle(RefreshProjects, {
 *     inject: { repository: ProjectRepository },
 *     execute: (context, [options], { repository }) =>
 *       repository.refresh(options, context.signal),
 *   });
 *
 *   return undefined;
 * });
 * ```
 *
 * Options may come before or after the callback. This order — options second —
 * is the one to use when there are any: with them last the call wraps, and the
 * whole module body gains a level of indentation for the sake of one word.
 */
export function defineModule<TUses extends ServiceMap = Record<never, never>>(
  id: string,
  options: DefineModuleOptions<TUses>,
  configure: (module: ModuleBuilder<TUses>) => undefined
): ModuleDefinition;
/**
 * Defines a module with no options, or with them trailing the callback.
 *
 * Prefer this form when there are no options: the id and the callback on one
 * line is the shortest thing that says what the module is.
 */
export function defineModule<TUses extends ServiceMap = Record<never, never>>(
  id: string,
  configure: (module: ModuleBuilder<TUses>) => undefined,
  options?: DefineModuleOptions<TUses>
): ModuleDefinition;
export function defineModule<TUses extends ServiceMap = Record<never, never>>(
  id: string,
  second: ((module: ModuleBuilder<TUses>) => undefined) | DefineModuleOptions<TUses>,
  third?: DefineModuleOptions<TUses> | ((module: ModuleBuilder<TUses>) => undefined)
): ModuleDefinition {
  const configure = (typeof second === 'function' ? second : third) as (
    module: ModuleBuilder<TUses>
  ) => undefined;
  const options = ((typeof second === 'function' ? third : second) ??
    {}) as DefineModuleOptions<TUses>;
  if (typeof configure !== 'function') {
    throw new TypeError(`Module "${id}" was defined without a configure callback.`);
  }
  // Snapshotted like every other declared map: preflight validates this exact
  // set, so the caller's object must not be able to change underneath it.
  const ambient = snapshotInject(options.uses);

  const services: ServiceDescriptor[] = [];
  const commands: CommandDefinition[] = [];
  const textEditorCommands: TextEditorCommandDefinition[] = [];
  const hostedServices: HostedServiceDefinition[] = [];
  const settings: SettingsRegistration[] = [];
  const storage: StorageRegistration[] = [];
  const secrets: SecretRegistration[] = [];
  const fileWatchers: FileWatcherDefinition[] = [];
  const statusBarItems: StatusBarItemDefinition[] = [];
  const languageStatusItems: LanguageStatusItemDefinition[] = [];
  const treeViews: TreeViewDefinition[] = [];
  const webviewViews: WebviewViewDefinition[] = [];
  const webviewSerializers: WebviewPanelSerializerDefinition[] = [];
  const rawRegistrations: RawRegistrationDefinition[] = [];

  const addService = (
    token: ServiceToken<unknown>,
    lifetime: ServiceLifetime,
    second: unknown
  ): void => {
    if (typeof second === 'function') {
      services.push({
        token,
        lifetime,
        dependencies: EMPTY_MAP,
        create: second as () => unknown,
        moduleId: id,
      });
      return;
    }
    const registration = second as RawRegistration;
    const create = registration.create;
    if (create === undefined) {
      throw new TypeError(`Service "${token.id}" in module "${id}" has no create function.`);
    }
    services.push({
      token,
      lifetime,
      dependencies: snapshotInject(registration.inject),
      create,
      moduleId: id,
    });
  };

  const builder: ModuleBuilder = {
    services: {
      singleton(token: ServiceToken<unknown>, second: unknown): void {
        addService(token, ServiceLifetime.Singleton, second);
      },
      transient(token: ServiceToken<unknown>, second: unknown): void {
        addService(token, ServiceLifetime.Transient, second);
      },
    },

    commands: {
      handle(contract: CommandContract<readonly unknown[], unknown>, second: unknown): void {
        if (typeof second === 'function') {
          const execute = second as (
            context: OperationContext,
            args: readonly unknown[],
            injected: Readonly<Record<string, unknown>>
          ) => unknown;
          commands.push({
            contract,
            // Not empty: a handler that declares no `inject` of its own still
            // receives the module's ambient set, which is the whole point.
            dependencies: ambient,
            execute: (context, args, injected) => execute(context, args, injected),
            moduleId: id,
          });
          return;
        }
        const registration = second as RawRegistration;
        const execute = registration.execute;
        if (execute === undefined) {
          throw new TypeError(
            `Command "${contract.descriptor.id}" in module "${id}" has no execute function.`
          );
        }
        commands.push({
          contract,
          dependencies: withAmbient(
            ambient,
            registration.inject,
            `Command "${contract.descriptor.id}"`,
            id
          ),
          execute,
          moduleId: id,
        });
      },

      handleTextEditor(
        contract: CommandContract<readonly unknown[], unknown>,
        second: unknown
      ): void {
        if (typeof second === 'function') {
          const execute = second as (
            context: OperationContext,
            editor: unknown,
            args: readonly unknown[],
            injected: Readonly<Record<string, unknown>>
          ) => unknown;
          textEditorCommands.push({
            contract,
            dependencies: ambient,
            execute: (context, editor, args, injected) => execute(context, editor, args, injected),
            moduleId: id,
          });
          return;
        }
        const registration = second as {
          inject?: ServiceMap;
          execute?: (
            context: OperationContext,
            editor: unknown,
            args: readonly unknown[],
            injected: Readonly<Record<string, unknown>>
          ) => unknown;
        };
        const execute = registration.execute;
        if (execute === undefined) {
          throw new TypeError(
            `Text editor command "${contract.descriptor.id}" in module "${id}" has no execute function.`
          );
        }
        textEditorCommands.push({
          contract,
          dependencies: withAmbient(
            ambient,
            registration.inject,
            `Text editor command "${contract.descriptor.id}"`,
            id
          ),
          execute,
          moduleId: id,
        });
      },
    },

    hostedServices: {
      add(definition: { id: string; inject?: ServiceMap; start?: unknown; stop?: unknown }): void {
        hostedServices.push({
          id: definition.id,
          dependencies: withAmbient(
            ambient,
            definition.inject,
            `Hosted service "${definition.id}"`,
            id
          ),
          ...(definition.start === undefined
            ? {}
            : {
                start: definition.start as NonNullable<HostedServiceDefinition['start']>,
              }),
          ...(definition.stop === undefined
            ? {}
            : { stop: definition.stop as NonNullable<HostedServiceDefinition['stop']> }),
          moduleId: id,
        });
      },
      background(definition: { id: string; inject?: ServiceMap; run: unknown }): void {
        hostedServices.push({
          id: definition.id,
          dependencies: withAmbient(
            ambient,
            definition.inject,
            `Hosted service "${definition.id}"`,
            id
          ),
          run: definition.run as NonNullable<HostedServiceDefinition['run']>,
          moduleId: id,
        });
      },
    },

    settings: {
      add<TSpecs extends SettingSpecs>(definition: SettingsDefinition<TSpecs>): void {
        settings.push(definition);
      },
    },

    storage: {
      add<T>(definition: StorageDefinition<T>): void {
        storage.push({
          key: definition.key,
          scope: definition.scope,
          syncable: definition.syncable,
          token: definition.token,
          options: definition,
        });
      },
    },

    secrets: {
      add<T>(definition: SecretDefinition<T>): void {
        secrets.push({
          key: definition.key,
          schema: definition.schema,
          token: definition.token,
        });
      },
    },

    fileWatchers: {
      add(
        definition: FileWatcherOptions & {
          id: string;
          inject?: ServiceMap;
          handle: unknown;
        }
      ): void {
        const { id: watcherId, inject, handle, ...watcherOptions } = definition;
        fileWatchers.push({
          ...watcherOptions,
          // The lists decide what is watched and what is filtered out, so they
          // are snapshotted rather than referenced.
          patterns: frozenIfArray(watcherOptions.patterns),
          ...(watcherOptions.events === undefined
            ? {}
            : { events: frozenIfArray(watcherOptions.events) }),
          ...(watcherOptions.ignorePatterns === undefined
            ? {}
            : { ignorePatterns: frozenIfArray(watcherOptions.ignorePatterns) }),
          id: watcherId,
          dependencies: withAmbient(ambient, inject, `File watcher "${definition.id}"`, id),
          handle: handle as FileWatcherDefinition['handle'],
          moduleId: id,
        });
      },
    },

    statusBar: {
      add(definition: StatusBarItemDefinition): void {
        statusBarItems.push(definition);
      },
    },

    languageStatus: {
      add(definition: LanguageStatusItemDefinition): void {
        languageStatusItems.push(definition);
      },
    },

    treeViews: {
      add(definition: {
        id: string;
        inject?: ServiceMap;
        resolveProvider: (injected: Readonly<Record<string, unknown>>) => unknown;
        options?: TreeViewOptionsLike;
      }): void {
        treeViews.push({
          id: definition.id,
          dependencies: withAmbient(ambient, definition.inject, `Tree view "${definition.id}"`, id),
          resolveProvider: definition.resolveProvider,
          // Snapshot of the option bag; the drop handler inside it stays
          // opaque and untouched.
          options: frozenCopy(definition.options ?? {}),
          moduleId: id,
        });
      },
    },

    webviews: {
      addView(definition: {
        id: string;
        inject?: ServiceMap;
        resolve: (view: never, injected: Readonly<Record<string, unknown>>) => unknown;
        options?: WebviewViewRequest;
      }): void {
        webviewViews.push({
          id: definition.id,
          dependencies: withAmbient(
            ambient,
            definition.inject,
            `Webview view "${definition.id}"`,
            id
          ),
          resolve: definition.resolve as WebviewViewDefinition['resolve'],
          options: frozenCopy(definition.options ?? {}),
          moduleId: id,
        });
      },

      restorePanel(definition: {
        viewType: string;
        inject?: ServiceMap;
        restore: (
          panel: never,
          state: never,
          injected: Readonly<Record<string, unknown>>
        ) => unknown;
      }): void {
        webviewSerializers.push({
          viewType: definition.viewType,
          dependencies: withAmbient(
            ambient,
            definition.inject,
            `Webview restorer "${definition.viewType}"`,
            id
          ),
          restore: definition.restore as WebviewPanelSerializerDefinition['restore'],
          moduleId: id,
        });
      },
    },

    raw: {
      register(definition: { id: string; inject?: ServiceMap; bind: unknown }): void {
        rawRegistrations.push({
          id: definition.id,
          dependencies: withAmbient(
            ambient,
            definition.inject,
            `Raw registration "${definition.id}"`,
            id
          ),
          bind: definition.bind as RawRegistrationDefinition['bind'],
          moduleId: id,
        });
      },
    },
  };

  // The ambient set is a type-level fact only: the runtime object treats every
  // `injected` as an opaque record, and `withAmbient` above is what actually
  // puts the module's services in it. Casting here confines that to one line.
  const result: unknown = configure(builder as unknown as ModuleBuilder<TUses>);
  if (isThenable(result)) {
    claimRejection(result);
    throw new AsyncCallbackError('module configure callback', id);
  }

  return Object.freeze({
    id,
    services: sealAll(services),
    commands: sealAll(commands),
    textEditorCommands: sealAll(textEditorCommands),
    hostedServices: sealAll(hostedServices),
    settings: sealAll(settings),
    storage: sealAll(storage),
    secrets: sealAll(secrets),
    fileWatchers: sealAll(fileWatchers),
    statusBarItems: sealAll(statusBarItems),
    languageStatusItems: sealAll(languageStatusItems),
    treeViews: sealAll(treeViews),
    webviewViews: sealAll(webviewViews),
    webviewSerializers: sealAll(webviewSerializers),
    rawRegistrations: sealAll(rawRegistrations),
    compatibility: options.compatibility ?? 'unspecified',
    requires: Object.freeze({ ...options.requires }),
    source: options.source,
  });
}

/**
 * Freezes a registration list and every entry in it, including each entry's
 * dependency map.
 *
 * One place rather than thirteen push sites: preflight validates ids and
 * dependency tokens once, and everything it validated has to still be true
 * when the host binds. Entries are framework-built objects, so they are frozen
 * in place; the contracts, definitions and callbacks they carry were already
 * sealed by their own factories or are deliberately opaque.
 */
function sealAll<T extends object>(entries: readonly T[]): readonly T[] {
  for (const entry of entries) {
    // Read structurally: only some entry kinds declare dependencies, and a
    // weak-typed constraint would reject the ones that do not.
    const dependencies = (entry as { readonly dependencies?: ServiceMap }).dependencies;
    if (dependencies !== undefined) {
      Object.freeze(dependencies);
    }
    Object.freeze(entry);
  }
  return Object.freeze([...entries]);
}
