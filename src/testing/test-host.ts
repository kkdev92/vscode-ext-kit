/**
 * @packageDocumentation
 * In-process host for a compiled production application plan.
 *
 * By default the Test Host changes only platform implementations: it feeds the
 * already-compiled production descriptors to the same application factory,
 * container, runtime preflight, operation runner and stop path. Explicit test
 * service overrides are applied to an isolated plan copy before that container
 * is built. This makes TestHost the default integration seam for code that stays
 * inside framework capabilities.
 *
 * It does not emulate VS Code itself. There is no workbench rendering, extension
 * scheduling, webview browser, or interception of a module's direct
 * `import "vscode"`. Managed raw registrations can be tested here only when
 * their `bind` callback uses injected/portable collaborators; raw VS Code calls
 * require the low-level mock or, for authoritative behavior, an Extension Host.
 */
import { createApplication } from '../foundation/application/application.js';
import type { Application } from '../foundation/application/application.js';
import type { ApplicationPlan } from '../foundation/application/plan.js';
import type { HostDiagnostic } from '../foundation/hosting/application-host.js';
import { ServiceLifetime } from '../foundation/services/descriptors.js';
import type { ServiceDescriptor } from '../foundation/services/descriptors.js';
import type { ServiceToken } from '../foundation/services/token.js';
import { createFakeCommands } from './fakes/fake-commands.js';
import type { FakeCommands } from './fakes/fake-commands.js';
import { createFakeEnvironment } from './fakes/fake-environment.js';
import type { FakeEnvironment } from './fakes/fake-environment.js';
import { createFakeSettings } from './fakes/fake-settings.js';
import type { FakeSettings } from './fakes/fake-settings.js';
import { createFakeFileWatchers } from './fakes/fake-filewatcher.js';
import type { FakeFileWatchers } from './fakes/fake-filewatcher.js';
import { createFakeSecrets, createFakeStorage } from './fakes/fake-storage.js';
import type { FakeSecrets, FakeStorage } from './fakes/fake-storage.js';
import { createFakeQuickInput } from './fakes/fake-quick-input.js';
import type { FakeQuickInput } from './fakes/fake-quick-input.js';
import { createFakeEditor } from './fakes/fake-editor.js';
import type { FakeEditor } from './fakes/fake-editor.js';
import { createFakeLocalization } from './fakes/fake-localization.js';
import type { FakeLocalization } from './fakes/fake-localization.js';
import { createFakeTreeViews } from './fakes/fake-treeview.js';
import { createFakeWebviews } from './fakes/fake-webview.js';
import type { FakeWebviews } from './fakes/fake-webview.js';
import type { FakeTreeViews } from './fakes/fake-treeview.js';
import {
  createFakeLanguageStatus,
  createFakeNotifications,
  createFakeProgress,
  createFakeStatusBar,
} from './fakes/fake-ui.js';
import type {
  FakeLanguageStatus,
  FakeNotifications,
  FakeProgress,
  FakeStatusBar,
} from './fakes/fake-ui.js';
import { createRecordingLogSink } from './fakes/recording-log-sink.js';
import type { RecordingLogSink } from './fakes/recording-log-sink.js';

/** Composition-root-only service replacements for one isolated test host. */
export interface ServiceOverrides {
  /**
   * Replaces (or adds) a singleton before the container is built. The
   * replacement is used everywhere that exact token object is injected and
   * never mutates the shared production plan.
   *
   * Use a fresh fake per host. A singleton may be retained until `stop()` and is
   * disposed by the host if it implements the framework's disposable contract.
   */
  replaceSingleton<T>(token: ServiceToken<T>, create: () => T): void;
}

/**
 * Framework-owned resources still held by the host.
 *
 * A zero report proves the application scopes released what they registered;
 * it cannot detect arbitrary global listeners, timers or objects created by raw
 * code outside those scopes.
 */
export interface LeakReport {
  readonly registrations: number;
  readonly resources: number;
  /** Command ids still registered on the fake capability. */
  readonly commands: readonly string[];
}

/**
 * A production plan running on observable fake capabilities.
 *
 * Recording collections such as status items, tree views and panels retain
 * disposed records so tests can inspect history. Consult each fake's documented
 * `disposed`/`registered` state; not every fake represents cleanup by removing
 * an entry from an array.
 */
export interface TestHost {
  /** The wired application. */
  readonly application: Application;
  /** The fake command capability the plan bound to. */
  readonly commands: FakeCommands;
  /** The fake settings capability the plan bound to. */
  readonly settings: FakeSettings;
  /** The fake host environment runtime preflight reads. */
  readonly environment: FakeEnvironment;
  /** The fake persisted state the plan's storage definitions read and write. */
  readonly storage: FakeStorage;
  /** The fake secret storage the plan's secret definitions read and write. */
  readonly secrets: FakeSecrets;
  /** The fake native watchers the plan's file watchers subscribe to. */
  readonly fileWatchers: FakeFileWatchers;
  /** The fake message surface behind the Notifications service. */
  readonly notifications: FakeNotifications;
  /** The fake progress UI behind `context.progress`. */
  readonly progress: FakeProgress;
  /** The fake status bar the plan's items render on. */
  readonly statusBar: FakeStatusBar;
  /** The fake language status area the plan's items render on. */
  readonly languageStatus: FakeLanguageStatus;
  /** The fake quick input the {@link QuickInput} service resolves to. */
  readonly quickInput: FakeQuickInput;
  /** The fake tree view registry the plan's views register into. */
  readonly treeViews: FakeTreeViews;
  /** The fake display language and bundle behind the Localization service. */
  readonly localization: FakeLocalization;
  /** The fake in-memory document behind the Editors service. */
  readonly editors: FakeEditor;
  /** The fake webview host the plan's panels and views run on. */
  readonly webviews: FakeWebviews;
  /** Everything the application logged. */
  readonly logs: RecordingLogSink;
  /** Lifecycle and operation diagnostics, in order. */
  readonly diagnostics: readonly HostDiagnostic[];
  /** Diagnostic event names, in order. Convenient for ordering assertions. */
  readonly events: readonly string[];

  /**
   * Activates the already statically validated plan through the production
   * host, including runtime preflight, module binding and the same synchronous
   * subscription failsafe.
   */
  start(): Promise<void>;
  /**
   * Deactivates through the production stop path. Safe to call again after the
   * first stop has settled; the underlying host owns idempotency.
   */
  stop(): Promise<void>;
  /** What the framework still owns. Assert this is empty after `stop()`. */
  leaks(): LeakReport;
}

/** Options for {@link createTestHost}. */
export interface CreateTestHostOptions {
  /** The already-compiled plan exposed as `app.plan` by `defineExtension`. */
  readonly plan: ApplicationPlan;
  /** Replaces services in a shallow plan copy before the container is built. */
  readonly configureServices?: ((overrides: ServiceOverrides) => void) | undefined;
  /** Overrides the reported host environment, for exercising runtime preflight. */
  readonly environment?: Parameters<typeof createFakeEnvironment>[0] | undefined;
}

/**
 * Runs a production `ApplicationPlan` on fake capabilities.
 *
 * The plan is not recompiled or simplified for tests—the same descriptors,
 * runtime preflight, host and stop path are used unless the caller explicitly
 * replaces a service. What normally differs is only which capability
 * implementations are bound.
 *
 * The fakes are intentionally observable rather than visual: tests script user
 * input and platform events, then inspect recorded calls/state. Shared contract
 * suites keep important fake/adapter semantics aligned, but only a real
 * Extension Host can prove behavior that belongs to VS Code itself.
 *
 * @example
 * ```ts
 * const host = createTestHost({
 *   plan: app.plan,
 *   configureServices: (services) => {
 *     services.replaceSingleton(ProjectRepository, () => fakeRepository);
 *   },
 * });
 *
 * await host.start();
 * await expect(host.application.commands.execute(Refresh)).resolves.toBe(3);
 * await host.stop();
 * expect(host.leaks().commands).toEqual([]);
 * ```
 */
export function createTestHost(options: CreateTestHostOptions): TestHost {
  const commands = createFakeCommands();
  const settings = createFakeSettings();
  const environment = createFakeEnvironment(options.environment ?? {});
  const storage = createFakeStorage();
  const secrets = createFakeSecrets();
  const fileWatchers = createFakeFileWatchers();
  const notifications = createFakeNotifications();
  const progress = createFakeProgress();
  const statusBar = createFakeStatusBar();
  const languageStatus = createFakeLanguageStatus();
  const quickInput = createFakeQuickInput();
  const treeViews = createFakeTreeViews();
  const localization = createFakeLocalization();
  const editors = createFakeEditor();
  const webviews = createFakeWebviews();
  const logs = createRecordingLogSink();
  const diagnostics: HostDiagnostic[] = [];

  const replacements = new Map<ServiceToken<unknown>, ServiceDescriptor>();
  options.configureServices?.({
    replaceSingleton<T>(token: ServiceToken<T>, create: () => T): void {
      replacements.set(token, {
        token: token,
        lifetime: ServiceLifetime.Singleton,
        dependencies: {},
        create,
        moduleId: 'test.override',
      });
    },
  });

  // Copy before replacement: `app.plan` is commonly shared by an entire test
  // file, so one host's override must not leak into the next host.
  const services = options.plan.services.map(
    (descriptor) => replacements.get(descriptor.token) ?? descriptor
  );
  for (const [token, descriptor] of replacements) {
    if (!services.some((existing) => existing.token === token)) {
      services.push(descriptor);
    }
  }

  const plan: ApplicationPlan = { ...options.plan, services };

  const application = createApplication({
    plan,
    capabilities: {
      commands,
      settings,
      environment,
      storage,
      secrets,
      fileWatchers,
      notifications,
      progress,
      statusBar,
      languageStatus,
      quickInput,
      treeViews,
      localization,
      editors,
      webviews,
    },
    logSink: logs.sink,
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });

  // Minimal ExtensionContext seam required by the host. It is intentionally not
  // the low-level vscode ExtensionContext mock: TestHost talks to ports, and
  // introducing a second platform representation here would blur that boundary.
  const subscriptions: { dispose(): unknown }[] = [];

  return {
    application,
    commands,
    settings,
    environment,
    storage,
    secrets,
    fileWatchers,
    notifications,
    progress,
    statusBar,
    languageStatus,
    quickInput,
    treeViews,
    localization,
    editors,
    webviews,
    logs,
    get diagnostics(): readonly HostDiagnostic[] {
      return diagnostics;
    },
    get events(): readonly string[] {
      return diagnostics.map((diagnostic) => diagnostic.event);
    },

    start(): Promise<void> {
      return application.activate({ subscriptions });
    },

    stop(): Promise<void> {
      return application.deactivate();
    },

    leaks(): LeakReport {
      return {
        registrations: application.host.registrationCount,
        resources: application.host.resourceCount,
        commands: commands.registeredIds,
      };
    },
  };
}
