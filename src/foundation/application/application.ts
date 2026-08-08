/**
 * Runtime composition root for a compiled extension application.
 *
 * The public construction pipeline is deliberately one-way:
 * `defineModule` records inert declarations, `compileApplication` validates and
 * freezes them, and this file binds the resulting `ApplicationPlan` to concrete
 * platform capabilities during `Application.activate`.
 *
 * Changes here must preserve three lifecycle invariants:
 *
 * - activation is transactional; a module is attached to the Application only
 *   after all of its registrations and resources bind successfully;
 * - shutdown closes synchronous ingress before awaiting asynchronous teardown;
 * - every created registration, resource, service and background task has one
 *   framework owner and reaches the same rollback/stop path.
 *
 * Keep platform-specific conversion in adapters. This composition root may
 * coordinate foundation and capability-layer abstractions, but it must not
 * import or expose the `vscode` module itself.
 */
import { bindCommands, createCommandExecutor } from '../commands/binder.js';
import type { CommandExecutor } from '../commands/binder.js';
import { delayWithSignal } from '../hosted-services/definition.js';
import type {
  HostedServiceContext,
  HostedServiceDefinition,
  HostedServiceStopContext,
} from '../hosted-services/definition.js';
import { AsyncCallbackError, PreflightError, ScopeCleanupError } from '../internal/errors.js';
import { claimRejection, isThenable } from '../internal/thenable.js';
import { createApplicationHost } from '../hosting/application-host.js';
import type { ApplicationHost, HostDiagnostic } from '../hosting/application-host.js';
import { StopReason } from '../hosting/host-state.js';
import {
  CancellationReason,
  OperationCancelledError,
  combineAbortSignals,
} from '../operations/cancellation.js';
import { OperationKind } from '../operations/context.js';
import { runOperation } from '../operations/executor.js';
import { Operations, createOperationsService } from '../operations/service.js';
import { createLogger, createNoopLogger } from '../logging/logger.js';
import { Log } from '../logging/token.js';
import type { LogSink, Logger } from '../logging/logger.js';
import type {
  CommandCapability,
  EnvironmentCapability,
  FileWatcherCapability,
  LanguageStatusCapability,
  NotificationCapability,
  ProgressCapability,
  EditorCapability,
  LocalizationCapability,
  TreeDataSource,
  WebviewCapability,
  QuickInputCapability,
  SecretsCapability,
  SettingsCapability,
  StatusBarCapability,
  StorageCapability,
  TreeViewCapability,
} from '../platform/ports.js';
import { createServiceContainer, resolveInjected } from '../services/container.js';
import type { ServiceMap } from '../services/token.js';
import type { ServiceContainer } from '../services/container.js';
import { ServiceLifetime } from '../services/descriptors.js';
import type { ServiceDescriptor } from '../services/descriptors.js';
import { createSettingsAccessor } from '../settings/accessor.js';
import { createSecretAccessor } from '../../capabilities/secrets/secrets.js';
import { createTypedStorage } from '../../capabilities/storage/typed-storage.js';
import { createManagedLanguageStatusItem } from '../../capabilities/ui/language-status.js';
import { Notifications, createNotifier } from '../../capabilities/ui/notifications.js';
import { Editors, createEditorService, toActiveEditor } from '../../capabilities/editor/editor.js';
import { Secrets, createSecretStore } from '../../capabilities/secrets/secrets.js';
import { StatusBar, createStatusBarService } from '../../capabilities/ui/status-bar-service.js';
import {
  Webviews,
  createWebviewService,
  manageWebviewSurface,
  panelControls,
} from '../../capabilities/views/webview/host.js';
import { Localization, createLocalization } from '../../capabilities/l10n/localization.js';
import { QuickInput, createQuickInputService } from '../../capabilities/ui/quick-input-service.js';
import { createManagedStatusBarItem } from '../../capabilities/ui/statusbar.js';
import { Commands, createCommandsService } from '../../capabilities/commands/commands.js';
import { createManagedFileWatcher } from '../../capabilities/workspace/filewatcher.js';
import {
  FileWatchers,
  createFileWatcherService,
} from '../../capabilities/workspace/watch-service.js';
import { PreflightSeverity, runtimePreflight } from './runtime-preflight.js';
import type { ApplicationPlan } from './plan.js';

/**
 * The part of `vscode.ExtensionContext` the framework touches.
 *
 * Declared structurally so the runtime core never imports `vscode`; a real
 * `ExtensionContext` satisfies it.
 */
interface ExtensionHostContext {
  readonly subscriptions: { push(disposable: { dispose(): unknown }): void };
}

/**
 * Platform surfaces the Application binds to.
 *
 * Production supplies VS Code adapters and the Test Host supplies fakes with
 * the same contracts. Optional capabilities are demand-driven: omitting one is
 * valid until a declaration or resolved framework service actually needs it.
 */
interface ApplicationCapabilities {
  readonly commands: CommandCapability;
  /**
   * Supplies the host facts runtime preflight checks against. Required:
   * module compatibility, workspace-trust and workspace checks must not be
   * silently skippable from the public API. Tests use the fake from
   * `@kkdev92/vscode-ext-kit/testing`.
   */
  readonly environment: EnvironmentCapability;
  /** Required only when a module registers settings. */
  readonly settings?: SettingsCapability | undefined;
  /** Required only when a module registers storage. */
  readonly storage?: StorageCapability | undefined;
  /** Required only when a module registers secrets. */
  readonly secrets?: SecretsCapability | undefined;
  /** Required only when a module registers file watchers. */
  readonly fileWatchers?: FileWatcherCapability | undefined;
  /** Required only when something injects the {@link Notifications} service. */
  readonly notifications?: NotificationCapability | undefined;
  /** Enables `context.progress`. Absent means operations run headless. */
  readonly progress?: ProgressCapability | undefined;
  /** Required only when something injects the {@link QuickInput} surface. */
  readonly quickInput?: QuickInputCapability | undefined;
  /** Required only when something injects the {@link Localization} service. */
  readonly localization?: LocalizationCapability | undefined;
  /** Required only when something injects the {@link Editors} service. */
  readonly editors?: EditorCapability | undefined;
  /**
   * Required only when something injects {@link Webviews} or a module declares
   * a webview view.
   */
  readonly webviews?: WebviewCapability | undefined;
  /** Required only when a module registers status bar items. */
  readonly statusBar?: StatusBarCapability | undefined;
  /** Required only when a module registers language status items. */
  readonly languageStatus?: LanguageStatusCapability | undefined;
  /** Required only when a module registers tree views. */
  readonly treeViews?: TreeViewCapability | undefined;
}

/** Options for composing an {@link Application} from a validated plan. */
export interface CreateApplicationOptions {
  /** Immutable output of `compileApplication`; this function does not recompile it. */
  readonly plan: ApplicationPlan;
  /** Real adapters in production, or contract-compatible fakes under test. */
  readonly capabilities: ApplicationCapabilities;
  /** Receives log entries. Defaults to discarding them; sink failures are isolated. */
  readonly logSink?: LogSink | undefined;
  /** Receives lifecycle diagnostics. Observer failures never affect Application work. */
  readonly onDiagnostic?: ((diagnostic: HostDiagnostic) => void) | undefined;
  /**
   * What `activate` resolves to, for an extension that publishes an API.
   *
   * Built once, after every hosted service has started, and returned from
   * `activate` — which is the only ordering that can work, because the services
   * it is built from do not exist until the Application does.
   *
   * A declaration rather than a way to reach the container: the framework
   * resolves it, so nothing else gains the ability to pull an arbitrary service
   * out from outside the model.
   */
  readonly exports?:
    | {
        readonly inject: ServiceMap;
        readonly create: (injected: Readonly<Record<string, unknown>>) => unknown;
      }
    | undefined;
}

/**
 * A compiled plan wired to platform capabilities, ready for Extension Host
 * activation.
 *
 * One instance represents one Application lifetime and is not restartable after
 * it reaches a terminal Host state. `activate` and `deactivate` are the intended
 * extension entry-point calls; all framework cleanup flows through the Host.
 */
export interface Application {
  /** The authoritative Application lifecycle and ownership boundary. */
  readonly host: ApplicationHost;
  /** Typed invocation of commands registered with a `CommandContract`. */
  readonly commands: CommandExecutor;
  /**
   * Registers the synchronous shutdown failsafe and starts the Host.
   * Call this once from the extension's `activate` entry point; a stopped or
   * failed Application cannot be activated again.
   *
   * @throws when activation fails, after the Host has attempted to roll back
   * framework-owned registrations and Resources. Cleanup failures are also
   * reported through diagnostics.
   */
  activate(context: ExtensionHostContext): Promise<unknown>;
  /**
   * Stops the Host through the single cleanup path. Idempotent and never
   * rejects; cleanup failures are emitted as diagnostics.
   */
  deactivate(): Promise<void>;
}

/**
 * Wires a plan, capabilities and a host into an application.
 *
 * Capability-agnostic on purpose: the same plan runs on real VS Code adapters and
 * on fakes, which is what lets a Test Host exercise production wiring.
 *
 * @example
 * ```ts
 * const app = createApplication({
 *   plan: compileApplication({ name: 'sample', modules: [projectsModule] }),
 *   capabilities: { commands: fakeCommands, environment: fakeEnvironment },
 * });
 *
 * await app.activate({ subscriptions: [] });
 * await app.commands.execute(RefreshProjects, { force: true });
 * await app.deactivate();
 * ```
 */
export function createApplication(options: CreateApplicationOptions): Application {
  /** Filled by the start phase when `options.exports` is declared. */
  let resolvedExports: unknown;
  const plan = options.plan;
  const rootLogger: Logger =
    options.logSink === undefined
      ? createNoopLogger()
      : createLogger(options.logSink, { application: plan.name });

  const startedServices: {
    readonly definition: HostedServiceDefinition;
    readonly injected: Readonly<Record<string, unknown>>;
  }[] = [];
  const backgroundTasks: Promise<void>[] = [];

  // Observability must never interfere: a throwing observer cannot be allowed
  // to fail activation, an operation, or cleanup.
  const emitDiagnostic = (diagnostic: HostDiagnostic): void => {
    try {
      options.onDiagnostic?.(diagnostic);
    } catch {
      // Deliberately swallowed; see above.
    }
  };

  const emitOperationDiagnostic = (
    event: string,
    details: Readonly<Record<string, unknown>>
  ): void => {
    emitDiagnostic({ event, details });
  };

  /**
   * Waits for tracked background loops to settle, never past the remaining
   * budget. The tasks already carry their own catch handlers, so abandoning an
   * overdue one cannot surface an unhandled rejection.
   */
  const drainBackgroundTasks = async (remainingMs: () => number): Promise<void> => {
    if (backgroundTasks.length === 0) {
      return;
    }
    const pending = [...backgroundTasks];
    backgroundTasks.length = 0;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        resolve('timeout');
      }, remainingMs());
    });
    try {
      if ((await Promise.race([Promise.all(pending), timeout])) === 'timeout') {
        emitDiagnostic({ event: 'application.shutdownTimeout', details: { phase: 'background' } });
      }
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  };

  const startHostedService = async (
    definition: HostedServiceDefinition,
    activeContainer: ServiceContainer,
    signal: AbortSignal
  ): Promise<void> => {
    const logger = rootLogger.withFields({ hostedServiceId: definition.id });
    const injected = resolveInjected(definition.dependencies, activeContainer);
    const context: HostedServiceContext = {
      signal,
      logger,
      delay: (milliseconds) => delayWithSignal(milliseconds, signal),
    };

    emitDiagnostic({
      event: 'hostedService.starting',
      details: { id: definition.id },
    });

    if (definition.start !== undefined) {
      await definition.start(context, injected);
    }
    // The exact injected instances are kept so stop() receives the same ones
    // start()/run() got — re-resolving would hand a *different* transient to
    // stop, leaving the one actually started running.
    startedServices.push({ definition, injected });

    if (definition.run !== undefined) {
      const run = definition.run;
      // Tracked, never fire-and-forget: drained within the budget on stop and
      // on activation failure alike.
      backgroundTasks.push(
        (async () => {
          try {
            await run(context, injected);
          } catch (error) {
            logger.error('background hosted service failed', error);
            emitDiagnostic({
              event: 'hostedService.failed',
              details: { id: definition.id, error },
            });
          }
        })()
      );
    }

    emitDiagnostic({ event: 'hostedService.started', details: { id: definition.id } });
  };

  const stopHostedServices = async (
    remainingMs: () => number,
    signal: AbortSignal
  ): Promise<void> => {
    for (let index = startedServices.length - 1; index >= 0; index -= 1) {
      const started = startedServices[index];
      const stop = started?.definition.stop;
      if (started === undefined || stop === undefined) {
        continue;
      }
      const { definition, injected } = started;
      const logger = rootLogger.withFields({ hostedServiceId: definition.id });
      const context: HostedServiceStopContext = { signal, logger, remainingMs };
      emitDiagnostic({ event: 'hostedService.stopping', details: { id: definition.id } });
      try {
        await stop(context, injected);
        emitDiagnostic({ event: 'hostedService.stopped', details: { id: definition.id } });
      } catch (error) {
        logger.error('hosted service stop failed', error);
        emitDiagnostic({
          event: 'hostedService.failed',
          details: { id: definition.id, error },
        });
      }
    }
    startedServices.length = 0;
  };

  const host = createApplicationHost({
    name: plan.name,
    shutdownTimeoutMs: plan.shutdown.timeoutMs,
    ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),

    async start({ registrations, resources, signal }) {
      // Runtime preflight: the second stage, checking what definition-time
      // compilation cannot see. It runs *first*, before anything in this
      // function touches VS Code, because some of what follows cannot be undone
      // — `setKeysForSync` writes to persistent storage and survives a failed
      // activation, so declaring sync keys for an application that then refuses
      // to start would leave the platform holding a claim nothing backs. The
      // boundary is: nothing outside this process changes until every check
      // that can run has run. Never skippable — the environment capability is a
      // required option.
      const issues = runtimePreflight(plan, options.capabilities.environment.read());
      for (const issue of issues) {
        emitDiagnostic({
          event: `application.preflight.${issue.severity}`,
          details: { code: issue.code, moduleId: issue.moduleId, message: issue.message },
        });
      }

      const warnings = issues.filter((issue) => issue.severity === PreflightSeverity.Warning);
      for (const warning of warnings) {
        rootLogger.warn(warning.message, { code: warning.code, moduleId: warning.moduleId });
      }

      const errors = issues.filter((issue) => issue.severity === PreflightSeverity.Error);
      if (errors.length > 0) {
        throw new PreflightError(errors.map((issue) => issue.message));
      }

      // Settings accessors are registered by the framework, not by a module, so
      // they are synthesised here and resolve like any other singleton.
      const settingsDescriptors: ServiceDescriptor[] = plan.settings.map((registration) => {
        const capability = options.capabilities.settings;
        if (capability === undefined) {
          throw new Error(
            `Module settings for "${registration.section}" need a settings capability, ` +
              'but none was supplied to createApplication.'
          );
        }
        return {
          token: registration.token,
          lifetime: ServiceLifetime.Singleton,
          dependencies: {},
          create: () =>
            createSettingsAccessor({
              definition: registration,
              capability,
              logger: rootLogger.withFields({ settingsSection: registration.section }),
              onDiagnostic: emitOperationDiagnostic,
            }),
          moduleId: 'framework.settings',
        };
      });

      const storageDescriptors: ServiceDescriptor[] = plan.storage.map((registration) => {
        const capability = options.capabilities.storage;
        if (capability === undefined) {
          throw new Error(
            `Module storage for key "${registration.key}" needs a storage capability, ` +
              'but none was supplied to createApplication.'
          );
        }
        return {
          token: registration.token,
          lifetime: ServiceLifetime.Singleton,
          dependencies: {},
          create: () =>
            createTypedStorage(
              registration.scope === 'global' ? capability.global : capability.workspace,
              registration.key,
              registration.options
            ),
          moduleId: 'framework.storage',
        };
      });

      // setKeysForSync replaces its entire argument, so every syncable key is
      // aggregated and declared exactly once per activation.
      const syncableKeys = plan.storage
        .filter((registration) => registration.syncable === true)
        .map((registration) => registration.key);
      if (syncableKeys.length > 0) {
        options.capabilities.storage?.setKeysForSync([...new Set(syncableKeys)]);
      }

      const secretDescriptors: ServiceDescriptor[] = plan.secrets.map((registration) => {
        const capability = options.capabilities.secrets;
        if (capability === undefined) {
          throw new Error(
            `Module secret "${registration.key}" needs a secrets capability, ` +
              'but none was supplied to createApplication.'
          );
        }
        return {
          token: registration.token,
          lifetime: ServiceLifetime.Singleton,
          dependencies: {},
          create: () =>
            createSecretAccessor(capability, {
              key: registration.key,
              schema: registration.schema,
            }),
          moduleId: 'framework.secrets',
        };
      });

      // One notification service for the whole application. Suppressed while
      // stopping, so teardown never races a dialog; injecting it without a
      // capability is an error at first resolve, not a silent no-op.
      const notificationsDescriptor: ServiceDescriptor = {
        token: Notifications,
        lifetime: ServiceLifetime.Singleton,
        dependencies: {},
        create: () => {
          const capability = options.capabilities.notifications;
          if (capability === undefined) {
            throw new Error(
              'The Notifications service needs a notifications capability, ' +
                'but none was supplied to createApplication.'
            );
          }
          return createNotifier(capability, {
            isSuppressed: () => signal.aborted,
            onDiagnostic: emitOperationDiagnostic,
          });
        },
        moduleId: 'framework.notifications',
      };

      const webviewsDescriptor: ServiceDescriptor = {
        token: Webviews,
        lifetime: ServiceLifetime.Singleton,
        dependencies: {},
        create: () => {
          const capability = options.capabilities.webviews;
          if (capability === undefined) {
            throw new Error(
              'The Webviews service needs a webviews capability, ' +
                'but none was supplied to createApplication.'
            );
          }
          // Container-owned, so every panel still open at shutdown closes with
          // the application rather than outliving it.
          return createWebviewService(capability);
        },
        moduleId: 'framework.webviews',
      };

      const secretsDescriptor: ServiceDescriptor = {
        token: Secrets,
        lifetime: ServiceLifetime.Singleton,
        dependencies: {},
        create: () => {
          const capability = options.capabilities.secrets;
          if (capability === undefined) {
            throw new Error(
              'The Secrets store needs a secrets capability, ' +
                'but none was supplied to createApplication.'
            );
          }
          // Container-owned, so the change subscription it holds is released
          // with everything else.
          return createSecretStore(capability);
        },
        moduleId: 'framework.secrets',
      };

      const statusBarDescriptor: ServiceDescriptor = {
        token: StatusBar,
        lifetime: ServiceLifetime.Singleton,
        dependencies: {},
        create: () => {
          const capability = options.capabilities.statusBar;
          if (capability === undefined) {
            throw new Error(
              'The StatusBar service needs a statusBar capability, ' +
                'but none was supplied to createApplication.'
            );
          }
          return createStatusBarService(capability);
        },
        moduleId: 'framework.statusBar',
      };

      const editorsDescriptor: ServiceDescriptor = {
        token: Editors,
        lifetime: ServiceLifetime.Singleton,
        dependencies: {},
        create: () => {
          const capability = options.capabilities.editors;
          if (capability === undefined) {
            throw new Error(
              'The Editors service needs an editors capability, ' +
                'but none was supplied to createApplication.'
            );
          }
          return createEditorService(capability);
        },
        moduleId: 'framework.editors',
      };

      const localizationDescriptor: ServiceDescriptor = {
        token: Localization,
        lifetime: ServiceLifetime.Singleton,
        dependencies: {},
        create: () => {
          const capability = options.capabilities.localization;
          if (capability === undefined) {
            throw new Error(
              'The Localization service needs a localization capability, ' +
                'but none was supplied to createApplication.'
            );
          }
          return createLocalization(capability);
        },
        moduleId: 'framework.localization',
      };

      const quickInputDescriptor: ServiceDescriptor = {
        token: QuickInput,
        lifetime: ServiceLifetime.Singleton,
        dependencies: {},
        create: () => {
          const capability = options.capabilities.quickInput;
          if (capability === undefined) {
            throw new Error(
              'The QuickInput service needs a quickInput capability, ' +
                'but none was supplied to createApplication.'
            );
          }
          return createQuickInputService(capability);
        },
        moduleId: 'framework.quickInput',
      };

      /**
       * What a handler finds on its context without declaring anything.
       *
       * The line is what a handler *body* talks to the user and the document
       * with. `StatusBar` is here because `flash` is a transient handler action,
       * while `defineStatusBarItem` is a long-lived Application declaration;
       * those two lifetimes intentionally share one service token.
       *
       * What stays explicit: `Webviews`, `FileWatchers` and `Operations`,
       * which a handler reaches for rarely enough that declaring them is worth
       * the reader knowing, and `Secrets`, where "this module touches secrets"
       * is worth saying out loud.
       */
      const standardServices = {
        notify: Notifications,
        ask: QuickInput,
        l10n: Localization,
        editors: Editors,
        commands: Commands,
        status: StatusBar,
      };

      const commandsDescriptor: ServiceDescriptor = {
        token: Commands,
        lifetime: ServiceLifetime.Singleton,
        dependencies: {},
        // The same capability the framework registers against, so a fake host
        // sees an application's outgoing calls too.
        create: () => createCommandsService(options.capabilities.commands),
        moduleId: 'framework.commands',
      };

      const fileWatchersDescriptor: ServiceDescriptor = {
        token: FileWatchers,
        lifetime: ServiceLifetime.Singleton,
        dependencies: {},
        create: () => {
          const capability = options.capabilities.fileWatchers;
          if (capability === undefined) {
            throw new Error(
              'The FileWatchers service needs a fileWatchers capability, ' +
                'but none was supplied to createApplication.'
            );
          }
          // Container-owned, so a watcher the application forgot to dispose
          // still stops with the application.
          return createFileWatcherService(capability);
        },
        moduleId: 'framework.fileWatchers',
      };

      const logDescriptor: ServiceDescriptor = {
        token: Log,
        lifetime: ServiceLifetime.Singleton,
        dependencies: {},
        // The same logger every operation derives from, so a service and a
        // handler write to one place with one configured level.
        create: () => rootLogger,
        moduleId: 'framework.log',
      };

      const operationsDescriptor: ServiceDescriptor = {
        token: Operations,
        lifetime: ServiceLifetime.Singleton,
        dependencies: {},
        // `activeContainer` is only read when something resolves this service,
        // which cannot happen before the container exists.
        create: () =>
          createOperationsService({
            applicationSignal: signal,
            parentResources: resources,
            logger: rootLogger,
            services: activeContainer,
            progress: options.capabilities.progress,
            onDiagnostic: emitOperationDiagnostic,
            standard: standardServices,
          }),
        moduleId: 'framework.operations',
      };

      const statusBarDescriptors: ServiceDescriptor[] = plan.statusBarItems.map((item) => {
        const capability = options.capabilities.statusBar;
        if (capability === undefined) {
          throw new Error(
            `Status bar item "${item.id}" needs a statusBar capability, ` +
              'but none was supplied to createApplication.'
          );
        }
        return {
          token: item.token,
          lifetime: ServiceLifetime.Singleton,
          dependencies: {},
          create: () =>
            createManagedStatusBarItem(
              capability.createItem(item.id, item.alignment ?? 'left', item.priority),
              item
            ),
          moduleId: 'framework.statusBar',
        };
      });

      const languageStatusDescriptors: ServiceDescriptor[] = plan.languageStatusItems.map(
        (item) => {
          const capability = options.capabilities.languageStatus;
          if (capability === undefined) {
            throw new Error(
              `Language status item "${item.id}" needs a languageStatus capability, ` +
                'but none was supplied to createApplication.'
            );
          }
          return {
            token: item.token,
            lifetime: ServiceLifetime.Singleton,
            dependencies: {},
            create: () =>
              createManagedLanguageStatusItem(capability.createItem(item.id, item.selector), item),
            moduleId: 'framework.languageStatus',
          };
        }
      );

      const activeContainer = createServiceContainer({
        descriptors: [
          ...plan.services,
          ...settingsDescriptors,
          ...storageDescriptors,
          ...secretDescriptors,
          notificationsDescriptor,
          quickInputDescriptor,
          localizationDescriptor,
          editorsDescriptor,
          webviewsDescriptor,
          secretsDescriptor,
          statusBarDescriptor,
          commandsDescriptor,
          fileWatchersDescriptor,
          logDescriptor,
          operationsDescriptor,
          ...statusBarDescriptors,
          ...languageStatusDescriptors,
        ],
        resources,
      });

      // Registered before any module, so LIFO unwinding disposes singletons
      // *after* every module resource that might depend on them.
      resources.deferAsync(() => activeContainer.dispose());

      for (const module of plan.modules) {
        const moduleRegistrations = registrations.detachedChild(module.id);
        const moduleResources = resources.detachedChild(module.id);

        emitDiagnostic({ event: 'module.binding', details: { id: module.id } });
        try {
          bindCommands({
            commands: module.commands,
            textEditorCommands: module.textEditorCommands,
            capability: options.capabilities.commands,
            registrations: moduleRegistrations,
            resources: moduleResources,
            applicationSignal: signal,
            logger: rootLogger.withFields({ moduleId: module.id }),
            services: activeContainer,
            progress: options.capabilities.progress,
            onDiagnostic: emitOperationDiagnostic,
            standard: standardServices,
            // The capability layer owns the editor API; the binder is in
            // foundation and may not reach into it.
            toEditor: toActiveEditor,
          });

          for (const registration of module.rawRegistrations) {
            // Synchronous by contract: an async bind could let a half-bound
            // module commit.
            const result: unknown = registration.bind(
              {
                registrations: moduleRegistrations,
                resources: moduleResources,
                logger: rootLogger.withFields({ rawRegistrationId: registration.id }),
                services: activeContainer.createResolver(moduleResources),
              },
              resolveInjected(registration.dependencies, activeContainer)
            );
            if (isThenable(result)) {
              claimRejection(result);
              throw new AsyncCallbackError(`raw registration "${registration.id}" bind`, module.id);
            }
          }

          for (const view of module.webviewViews) {
            const capability = options.capabilities.webviews;
            if (capability === undefined) {
              throw new Error(
                `Webview view "${view.id}" needs a webviews capability, ` +
                  'but none was supplied to createApplication.'
              );
            }
            // View dependencies have Module lifetime and are reused across
            // resolve calls. Per-incarnation state belongs in the callback.
            const injected = resolveInjected(view.dependencies, activeContainer);

            // Each incarnation's RPC channel is owned for exactly as long as
            // that incarnation. A view that is torn down and resolved again
            // gets a new channel, and without this the old one keeps a live
            // message subscription and a pending map nothing can settle.
            //
            // Measured on 1.132.0 desktop (`fixtures/extension-host`): ordinary
            // hide/show does *not* end an incarnation — the same webview comes
            // back. So this covers the paths that retire the pane rather than a
            // leak you can watch accumulate, and the fixture reports which of
            // the two a given version does.
            const live = new Set<{ disposeOnce(): void }>();
            const handle = capability.registerViewProvider(
              view.id,
              async (surface) => {
                const managed = manageWebviewSurface(capability, surface);
                live.add(managed);
                surface.onDidDispose(() => {
                  live.delete(managed);
                  managed.disposeOnce();
                });
                await view.resolve(managed, injected);
              },
              view.options
            );
            moduleRegistrations.own(handle);
            // Whatever is still on screen when the module unbinds: the platform
            // will not fire `onDidDispose` for a view that outlives us.
            moduleRegistrations.defer(() => {
              for (const managed of [...live]) {
                managed.disposeOnce();
              }
              live.clear();
            });
          }

          for (const serializer of module.webviewSerializers) {
            const capability = options.capabilities.webviews;
            if (capability === undefined) {
              throw new Error(
                `Webview panel restorer "${serializer.viewType}" needs a webviews capability, ` +
                  'but none was supplied to createApplication.'
              );
            }
            // Restorer dependencies are resolved once with the Module, not once
            // per restored panel.
            const injected = resolveInjected(serializer.dependencies, activeContainer);
            moduleRegistrations.own(
              capability.registerPanelSerializer(serializer.viewType, async (surface, state) => {
                const managed = manageWebviewSurface(capability, surface);
                await serializer.restore(
                  { ...managed, ...panelControls(surface) },
                  state,
                  injected
                );
              })
            );
          }

          for (const view of module.treeViews) {
            const capability = options.capabilities.treeViews;
            if (capability === undefined) {
              throw new Error(
                `Tree view "${view.id}" needs a treeViews capability, ` +
                  'but none was supplied to createApplication.'
              );
            }
            const provider = view.resolveProvider(
              resolveInjected(view.dependencies, activeContainer)
            ) as TreeDataSource<never>;
            const handle = capability.create(view.id, provider, view.options);
            // The view unwinds before the provider it renders: the provider is
            // owned first, the handle after, and disposal is LIFO.
            if (typeof provider.dispose === 'function') {
              moduleRegistrations.own(provider as { dispose(): void });
            }
            moduleRegistrations.own(handle);
          }

          for (const watcher of module.fileWatchers) {
            const capability = options.capabilities.fileWatchers;
            if (capability === undefined) {
              throw new Error(
                `File watcher "${watcher.id}" needs a fileWatchers capability, ` +
                  'but none was supplied to createApplication.'
              );
            }
            const managed = createManagedFileWatcher(capability, watcher);
            // The module scope owns the native watchers and their timers.
            moduleRegistrations.own(managed);
            managed.onDidChange((batch) => {
              // Each batch is an operation: signal, logger, scope, error
              // classification. runOperation already logs failures, so the
              // rejection is deliberately consumed here -- a watcher batch has
              // no caller to reject to.
              void runOperation(
                {
                  kind: OperationKind.FileWatcher,
                  name: `fileWatcher:${watcher.id}`,
                  applicationSignal: signal,
                  parentResources: resources,
                  logger: rootLogger.withFields({ moduleId: module.id }),
                  services: activeContainer,
                  progress: options.capabilities.progress,
                  onDiagnostic: emitOperationDiagnostic,
                  standard: standardServices,
                },
                (operation) =>
                  watcher.handle(
                    operation,
                    batch,
                    resolveInjected(watcher.dependencies, operation.services)
                  )
              ).catch(() => undefined);
            });
          }

          // Ownership transfer only after the module bound cleanly.
          registrations.attach(moduleRegistrations);
          resources.attach(moduleResources);
          emitDiagnostic({ event: 'module.bound', details: { id: module.id } });
        } catch (error) {
          // Both scopes are detached: nothing else holds them, so a phase that
          // is skipped is a phase whose contents leak for the session. They are
          // therefore attempted independently — a registration whose dispose
          // throws must not take the module's resources down with it.
          const cleanupErrors: unknown[] = [];
          try {
            moduleRegistrations.dispose();
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }
          try {
            await moduleResources.dispose();
          } catch (cleanupError) {
            cleanupErrors.push(cleanupError);
          }

          // The activation failure is what the caller has to act on, so it is
          // what propagates. A cleanup that also failed is reported rather than
          // thrown: replacing the cause with a consequence is how a startup
          // failure becomes unreadable.
          if (cleanupErrors.length > 0) {
            rootLogger.error(
              `rollback of module "${module.id}" did not complete cleanly`,
              new ScopeCleanupError(module.id, cleanupErrors)
            );
            emitDiagnostic({
              event: 'module.rollbackFailed',
              details: { id: module.id, errors: cleanupErrors },
            });
          }

          emitDiagnostic({ event: 'module.failed', details: { id: module.id, error } });
          throw error;
        }
      }

      // Declared UI items appear at activation, not at first injection. The
      // container still owns them (they are ordinary singletons), so disposal
      // stays in reverse creation order with everything else.
      if (plan.statusBarItems.length > 0 || plan.languageStatusItems.length > 0) {
        const resolver = activeContainer.createResolver(resources);
        for (const item of plan.statusBarItems) {
          resolver.get(item.token);
        }
        for (const item of plan.languageStatusItems) {
          resolver.get(item.token);
        }
      }

      // Hosted services run on a signal that aborts either with the whole
      // application *or* when activation fails partway: a background run()
      // started by service A must not survive service B's failed start.
      const activationController = new AbortController();
      const hostedSignal = combineAbortSignals([signal, activationController.signal]);
      resources.defer(() => {
        hostedSignal.dispose();
      });

      for (const definition of plan.hostedServices) {
        try {
          await startHostedService(definition, activeContainer, hostedSignal.signal);
        } catch (error) {
          // Unwind under one absolute deadline, mirroring a normal shutdown:
          // abort the already-started services, stop them in reverse, then
          // drain their background loops — and only then fail activation.
          activationController.abort(
            new OperationCancelledError(CancellationReason.ApplicationStopping)
          );
          const deadlineAt = Date.now() + plan.shutdown.timeoutMs;
          const remaining = (): number => Math.max(0, deadlineAt - Date.now());
          await stopHostedServices(remaining, abortedSignal());
          await drainBackgroundTasks(remaining);
          throw error;
        }
      }

      // Last, so everything it is built from has started. A failure here fails
      // activation like any other and unwinds through the same path.
      if (options.exports !== undefined) {
        resolvedExports = options.exports.create(
          resolveInjected(options.exports.inject, activeContainer)
        );
      }
    },

    async stop({ remainingMs }) {
      await stopHostedServices(remainingMs, abortedSignal());
      // Background loops observe the aborted signal; give them the rest of
      // the budget to notice, but never wait past it.
      await drainBackgroundTasks(remainingMs);
    },
  });

  return {
    host,
    commands: createCommandExecutor(options.capabilities.commands),

    async activate(context: ExtensionHostContext): Promise<unknown> {
      // The single failsafe — and the ONLY thing the framework puts on
      // context.subscriptions. The Extension Host may dispose subscriptions
      // while deactivate() is still pending, so this must remain safe in the
      // middle of the stop pipeline. Safety comes from beginStop() being
      // state-guarded and idempotent, not from an assumed callback order.
      context.subscriptions.push({
        dispose: () => {
          host.beginStop(StopReason.ContextDisposed);
        },
      });
      await host.start();
      return resolvedExports;
    },

    deactivate(): Promise<void> {
      return host.stop(StopReason.Deactivate);
    },
  };
}

/** An already-aborted signal, for stop contexts. */
function abortedSignal(): AbortSignal {
  const controller = new AbortController();
  controller.abort();
  return controller.signal;
}
