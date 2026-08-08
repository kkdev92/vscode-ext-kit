/**
 * @packageDocumentation
 * Public extension-host surface of vscode-ext-kit.
 *
 * Start with `defineModule` to declare one cohesive feature, then pass those
 * modules to `defineExtension` and re-export its `activate`/`deactivate`
 * properties from the extension entry point. Handlers receive an
 * `OperationContext` and explicitly declared injected services; tests run the
 * resulting `app.plan` with the `./testing` entry point. That route preserves
 * preflight, dependency validation, resource ownership and one shutdown path.
 *
 * What is deliberately *not* here is anything that would be a second way to
 * reach something already exported. `defineExtension` compiles the plan, builds
 * every capability and owns the lifecycle, so the application constructors, the
 * `createVSCode*Capability` factories, the scope constructors and the host state
 * machine stay internal — exporting them would offer a second way to start an
 * application, one that skips the parts the first way guarantees.
 *
 * The same rule excludes a free function beside every token: `showInfo` next to
 * `Notifications`, `createTypedStorage` next to `defineStorage`. Each ability is
 * reachable exactly once, through a declaration or an injected token, so there
 * is never a question of which of two spellings is the right one.
 *
 * Extension-host feature code should import from this barrel. The vscode-free
 * helpers — `./timing`, `./retry`,
 * `./format` — are *also* their own subpaths, for a webview bundle, which cannot
 * import this module at all: it reaches `defineExtension` and therefore
 * `vscode`, which a browser build cannot resolve. Extension-host code should not
 * have to know that. The test surface is `./testing`, and the browser half of
 * the webview RPC is `./webview-client`. The root barrel is intentionally not
 * browser-safe because it includes `defineExtension` and therefore the real
 * `vscode` adapter.
 *
 * If the framework does not cover an API, use a module's managed raw
 * registration and put every registration/resource returned by VS Code into
 * the supplied scopes. That keeps declared dependencies visible to preflight
 * and cleanup inside the application lifecycle. A direct `vscode` import
 * outside that boundary is invisible to the Test Host and needs its own
 * Extension Host coverage.
 */

// --- Application declarations and the single production entry point -------
export { defineExtension } from './vscode/foundation/extension.js';
export type {
  DefineExtensionOptions,
  ExtensionApplication,
} from './vscode/foundation/extension.js';

export { defineModule } from './foundation/modules/definition.js';
export type {
  CommandCollection,
  DefineModuleOptions,
  FileWatcherCollection,
  HostedServiceCollection,
  LanguageStatusCollection,
  ModuleBuilder,
  ModuleDefinition,
  RawRegistrationCollection,
  SecretCollection,
  ServiceCollection,
  SettingsCollection,
  StatusBarCollection,
  StorageCollection,
  TreeViewCollection,
  WebviewCollection,
} from './foundation/modules/definition.js';
export { ModuleCompatibility } from './foundation/modules/compatibility.js';
export type { ModuleRequirements } from './foundation/modules/compatibility.js';
export type { ApplicationPlan } from './foundation/application/plan.js';
export type { HostDiagnostic } from './foundation/hosting/application-host.js';

// --- Explicit dependency injection ----------------------------------------
export { serviceToken } from './foundation/services/token.js';
export type { Injected, ServiceMap, ServiceOf, ServiceToken } from './foundation/services/token.js';
export { ServiceLifetime } from './foundation/services/descriptors.js';
export type { ServiceResolver } from './foundation/services/container.js';

// --- Commands -------------------------------------------------------------
export { defineCommandContract } from './foundation/commands/contract.js';
export type {
  ArgumentsValidator,
  CommandContract,
  CommandContractOptions,
  StandardSchemaLike,
  ValidationIssue,
  ValidationResult,
  Validator,
} from './foundation/commands/contract.js';
export type { CommandExecutor } from './foundation/commands/binder.js';
// Calling a command, as opposed to registering one.
export { Commands } from './capabilities/commands/commands.js';
export type { CommandsService } from './capabilities/commands/commands.js';

// --- Per-operation context, logging and resource ownership -----------------
export type { OperationContext } from './foundation/operations/context.js';
// How work that did not start in a handler comes by a context of its own.
export { Operations } from './foundation/operations/service.js';
export type { OperationsService, RunTaskOptions } from './foundation/operations/service.js';
export type {
  OperationProgress,
  OperationProgressOptions,
  ProgressStep,
  StepsOutcome,
} from './foundation/operations/progress.js';
export type { LogEntry, LogFields, Logger, LogSink } from './foundation/logging/logger.js';
// For a service, which has no operation to take `context.logger` from.
export { Log } from './foundation/logging/token.js';
export type { ResourceScope } from './foundation/resources/resource-scope.js';
export type { Registration, RegistrationScope } from './foundation/resources/registration-scope.js';

// --- Background lifetime and the managed raw-API escape hatch --------------
export type {
  HostedServiceContext,
  HostedServiceStopContext,
} from './foundation/hosted-services/definition.js';
export type { RawRegistrationContext } from './foundation/raw/definition.js';

// --- Settings -------------------------------------------------------------
export {
  defineSettings,
  setting,
  SettingContributionScope,
  SettingsValidationPolicy,
} from './foundation/settings/definition.js';
export type {
  DefineSettingsOptions,
  SettingSpec,
  SettingSpecs,
  SettingValueType,
  SettingsDefinition,
  SettingsValues,
} from './foundation/settings/definition.js';
export type {
  SettingsAccessor,
  SettingsChangeEvent,
  SettingsSnapshot,
} from './foundation/settings/accessor.js';
export { SettingsTarget } from './foundation/platform/ports.js';
export type { SettingsInspection, SettingsScope } from './foundation/platform/ports.js';

// --- Storage and secrets --------------------------------------------------
export { defineStorage, defineSecret } from './capabilities/storage/definition.js';
export type {
  DefineSecretOptions,
  DefineStorageOptions,
  SecretDefinition,
  StorageDefinition,
  StorageScope,
} from './capabilities/storage/definition.js';
export type {
  StorageIssue,
  StorageOptions,
  TypedStorage,
} from './capabilities/storage/typed-storage.js';
export { Secrets } from './capabilities/secrets/secrets.js';
export type { SecretAccessor, SecretStore } from './capabilities/secrets/secrets.js';

// --- File watching --------------------------------------------------------
export type {
  FileWatcherEvent,
  FileWatcherOptions,
  ManagedFileWatcher,
  WatchPattern,
} from './capabilities/workspace/filewatcher.js';
// For a pattern only known at runtime — a file the user picked. Declared globs
// belong in `module.fileWatchers.add`.
export { FileWatchers } from './capabilities/workspace/watch-service.js';
export type { FileWatcherService } from './capabilities/workspace/watch-service.js';

// --- UI services resolved through declared dependency tokens ---------------
export { Notifications } from './capabilities/ui/notifications.js';
export type {
  ConfirmOptions,
  NotificationService,
  NotifyAction,
  NotifyOptions,
} from './capabilities/ui/notifications.js';
export { QuickInput } from './capabilities/ui/quick-input-service.js';
export type { QuickInputService } from './capabilities/ui/quick-input-service.js';
export { toPickButton, toPickItem, toPickSeparator } from './capabilities/ui/quick-input.js';
export type {
  InputTextOptions,
  PickButtonOptions,
  PickItem,
  PickItemDisplay,
  PickOptions,
} from './capabilities/ui/quick-input.js';
export { Localization } from './capabilities/l10n/localization.js';
export type { LocalizationService } from './capabilities/l10n/localization.js';
export { Editors } from './capabilities/editor/editor.js';
export type {
  ActiveEditor,
  DocumentLocation,
  EditorService,
  EditStage,
} from './capabilities/editor/editor.js';
export { Webviews } from './capabilities/views/webview/host.js';
export type {
  ManagedWebview,
  ManagedWebviewPanel,
  WebviewService,
} from './capabilities/views/webview/host.js';

// --- UI contributions owned by a module/application plan -------------------
export { defineLanguageStatusItem, defineStatusBarItem } from './capabilities/ui/definition.js';
export type {
  DefineLanguageStatusItemOptions,
  DefineStatusBarItemOptions,
} from './capabilities/ui/definition.js';
export type { ManagedStatusBarItem, StatusBarItemOptions } from './capabilities/ui/statusbar.js';
export { StatusBar } from './capabilities/ui/status-bar-service.js';
export type { StatusBarService } from './capabilities/ui/status-bar-service.js';
export type {
  LanguageStatusItemOptions,
  LanguageStatusItemSeverity,
  LanguageStatusItemUpdate,
  ManagedLanguageStatusItem,
} from './capabilities/ui/language-status.js';

// --- The wizard -----------------------------------------------------------
export { WizardStepError, inputStep, quickpickStep } from './capabilities/ui/wizard.js';
export type {
  InputStepConfig,
  QuickPickStepConfig,
  StepDefinition,
  StepOutcome,
  StepRunContext,
  WizardBuilder,
  WizardRunOptions,
  WizardStepPhase,
} from './capabilities/ui/wizard.js';

// --- Editing text ---------------------------------------------------------
export type {
  TextEdit,
  TextEditOptions,
  TextPosition,
  TextRange,
  WorkspaceEditOptions,
  WorkspaceTextEdit,
} from './foundation/platform/ports.js';

// --- Tree views -----------------------------------------------------------
export {
  BaseTreeDataProvider,
  LOAD_MORE_ID,
  SimpleTreeDataProvider,
  withPagination,
} from './capabilities/views/tree.js';
export type {
  AddItemOptions,
  PaginationOptions,
  TreeCheckboxChange,
  TreeDragAndDropOptions,
  TreeItemData,
} from './capabilities/views/tree.js';
export { TreeItemChecked, TreeItemCollapsible } from './foundation/platform/ports.js';
export type { TreeItemIcon, TreeViewOptionsLike } from './foundation/platform/ports.js';

// --- Webviews -------------------------------------------------------------
export { createWebviewRpc } from './capabilities/views/webview/rpc.js';
export type {
  WebviewRpc,
  WebviewRpcRequestOptions,
  WebviewRpcSchema,
} from './capabilities/views/webview/rpc.js';
export {
  createWebviewHtml,
  escapeHtml,
  generateCSP,
  generateNonce,
} from './capabilities/views/webview/html.js';
export type { CSPOptions } from './capabilities/views/webview/html.js';
export type { WebviewPanelRequest, WebviewViewRequest } from './foundation/platform/ports.js';

// --- Results and validation -----------------------------------------------
export { err, mapResult, mapResultErr, ok, unwrap, unwrapOr } from './capabilities/core/result.js';
export type { Result } from './capabilities/core/result.js';
export { s, validateSchema } from './capabilities/core/schema.js';
export type {
  Infer,
  NumberOptions,
  SchemaIssue,
  SchemaResult,
  StandardSchemaV1,
  StringOptions,
} from './capabilities/core/schema.js';

// --- Errors ---------------------------------------------------------------
export {
  ErrorKind,
  FrameworkError,
  classifyError,
  isCancellation,
  userError,
  validationError,
} from './foundation/operations/errors.js';
export type { FrameworkErrorOptions } from './foundation/operations/errors.js';
export { OperationCancelledError } from './foundation/operations/cancellation.js';
export { RetryExhaustedError } from './capabilities/std/retry.js';
export { TimeoutError } from './capabilities/std/timing.js';

// --- Timing, retry and formatting -----------------------------------------
// Also on `./timing`, `./retry` and `./format`. Those exist for a webview
// bundle, which cannot import this barrel at all — it reaches `defineExtension`
// and therefore `vscode`, which a browser build cannot resolve. Extension-host
// code has no such problem and should not have to know which subpath a helper
// lives in, least of all when `TimeoutError` and `RetryExhaustedError` are
// already here and only the functions that throw them were somewhere else.
export {
  debounce,
  measureTime,
  throttle,
  withTimeout,
  withTiming,
} from './capabilities/std/timing.js';
export type {
  DebounceOptions,
  DebouncedFunction,
  ThrottleOptions,
  ThrottledFunction,
  TimeoutOperation,
  TimingOptions,
  TimingResult,
  WithTimeoutOptions,
} from './capabilities/std/timing.js';
export { retry } from './capabilities/std/retry.js';
export type { RetryContext, RetryJitter, RetryOptions } from './capabilities/std/retry.js';
export {
  formatDateFor,
  formatNumberFor,
  formatRelativeTimeFor,
  getOrCreateCached,
  pluralFor,
} from './capabilities/l10n/format.js';
export type {
  DateFormatOptions,
  NumberFormatOptions,
  PluralForms,
  RelativeTimeUnit,
} from './capabilities/l10n/format.js';

// --- Disposal -------------------------------------------------------------
export { DisposableCollection, createScope } from './capabilities/core/disposable.js';

// --- Where the host is running --------------------------------------------
export { UiKind } from './foundation/platform/ports.js';
export type { HostEnvironment, ResourceUri, WatchedUri } from './foundation/platform/ports.js';
