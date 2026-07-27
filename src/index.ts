/**
 * @packageDocumentation
 * vscode-ext-kit - A lightweight utility library for VS Code extension development
 *
 * This library provides common utilities for building VS Code extensions:
 *
 * - **Extension Kit** - One-call wiring for logger + error handling + commands
 * - **Logger** - LogOutputChannel-backed structured logging with child scopes
 * - **run/tryRun** - Unified, cancellation-aware error handling
 * - **Commands** - Compile-time checked batch command registration
 * - **Config** - Schema-driven, validated, observable configuration
 * - **Storage** - Versioned, migratable global/workspace/secret storage
 * - **UI utilities** - QuickPick, InputBox, and multi-step wizard
 * - **Notification** - showInfo/showWarn/showError with actions
 * - **StatusBar** - Managed status bar items with spinner support
 * - **FileWatcher** - Debounced file watching with event batching
 * - **Editor** - Text editor manipulation utilities
 * - **TreeView** - Base TreeDataProvider with caching
 * - **WebView** - Managed WebView panels with CSP support
 * - **std** - vscode-free debounce/throttle/timeout/retry (also under the
 *   `./timing` and `./retry` subpath exports for webview bundles)
 * - **l10n** - Localization and Intl-based formatting
 *
 * @example
 * ```typescript
 * import { createExtensionKit, showInfo } from '@kkdev92/vscode-ext-kit';
 *
 * export function activate(context: vscode.ExtensionContext) {
 *   const kit = createExtensionKit<'myext.hello'>(context, 'MyExtension');
 *   kit.registerCommands({
 *     'myext.hello': () => showInfo('Hello!'),
 *   });
 * }
 * ```
 *
 * @module @kkdev92/vscode-ext-kit
 */

// ============================================
// Core: shared types
// ============================================
export type {
  LogLevel,
  LoggerOptions,
  Logger,
  CommandHandler,
  TextEditorCommandHandler,
  RegisterCommandsOptions,
  ProgressOptions,
  InputTextOptions,
} from './core/types.js';

// ============================================
// Core: Result
// ============================================
export type { Result } from './core/result.js';
export { ok, err, unwrap, unwrapOr, mapResult, mapResultErr } from './core/result.js';

// ============================================
// Core: schema (Standard Schema-compatible)
// ============================================
export { s, validateSchema } from './core/schema.js';
export type {
  StandardSchemaV1,
  Infer,
  SchemaIssue,
  SchemaResult,
  StringOptions,
  NumberOptions,
} from './core/schema.js';

// ============================================
// Core: logger
// ============================================
export { createLogger } from './core/logger.js';

// ============================================
// Core: run (unified error handling)
// ============================================
export { run, tryRun, isCancellation } from './core/run.js';
export type { RunOptions } from './core/run.js';

// ============================================
// Core: Extension Kit
// ============================================
export { createExtensionKit } from './core/kit.js';
export type { ExtensionKit, ExtensionKitOptions } from './core/kit.js';

// ============================================
// Core: commands
// ============================================
export { registerCommands, registerTextEditorCommands, executeCommand } from './core/commands.js';

// ============================================
// Core: disposable
// ============================================
export { DisposableCollection, createScope } from './core/disposable.js';

// ============================================
// Config
// ============================================
export { field, defineConfigSchema, watchSetting } from './config/index.js';
export type {
  ConfigFieldDef,
  ConfigValidationIssue,
  ConfigInspection,
  TypedConfig,
  ConfigWatcher,
} from './config/index.js';

// ============================================
// Storage
// ============================================
export {
  createGlobalStorage,
  createWorkspaceStorage,
  createSecretStore,
  createSecretStorage,
  listStorageKeys,
} from './storage/index.js';
export type {
  StorageIssue,
  StorageOptions,
  GlobalStorageOptions,
  TypedStorage,
  SecretStore,
  SecretStorage,
} from './storage/index.js';

// ============================================
// Progress
// ============================================
export { withProgress, withSteps, toAbortSignal } from './ui/progress.js';
export type {
  ProgressReporter,
  ProgressStep,
  StepsProgressOptions,
  StepsResult,
} from './ui/progress.js';

// ============================================
// UI
// ============================================
export { pickOne, pickMany, inputText, wizard } from './ui/index.js';
export type {
  WizardQuickPickItem,
  WizardQuickPickStep,
  WizardInputStep,
  WizardStep,
  WizardOptions,
  WizardResult,
} from './ui/index.js';

// ============================================
// Notification
// ============================================
export { showInfo, showWarn, showError, confirm, showWithActions } from './ui/notification.js';
export type { NotificationOptions, NotificationAction, ConfirmOptions } from './ui/notification.js';

// ============================================
// StatusBar
// ============================================
export { createStatusBarItem, showStatusMessage } from './ui/statusbar.js';
export type { StatusBarItemOptions, ManagedStatusBarItem } from './ui/statusbar.js';

// ============================================
// FileWatcher
// ============================================
export { createFileWatcher, watchFile } from './workspace/filewatcher.js';
export type {
  FileWatcherOptions,
  FileWatcherEvent,
  ManagedFileWatcher,
  WatchPattern,
} from './workspace/filewatcher.js';

// ============================================
// Editor
// ============================================
export {
  replaceText,
  getSelectedText,
  getAllSelectedText,
  insertAtCursor,
  getLine,
  getCurrentLine,
  applyEdits,
  applyEditsGrouped,
  applyWorkspaceEdits,
  transformSelection,
  transformAllSelections,
  moveCursor,
  selectRange,
  selectLine,
  selectWord,
  getFilePath,
  rangeFromOffsets,
  getTextInOffsetRange,
  resolvePositionsBatch,
  resolveOffsetsBatch,
} from './workspace/editor.js';
export type {
  EditOperation,
  FilePathInfo,
  WorkspaceEditEntry,
  ApplyWorkspaceEditsOptions,
} from './workspace/editor.js';

// ============================================
// TreeView
// ============================================
export { BaseTreeDataProvider, SimpleTreeDataProvider, createTreeView } from './views/treeview.js';
export type { TreeItemData } from './views/treeview.js';

// ============================================
// WebView
// ============================================
export {
  createWebViewPanel,
  generateCSP,
  generateNonce,
  loadHtmlTemplate,
  createWebViewHtml,
  escapeHtml,
} from './views/webview.js';
export type {
  WebViewOptions,
  WebViewMessage,
  ManagedWebViewPanel,
  CSPOptions,
} from './views/webview.js';

// ============================================
// std: timing (vscode-free; also exported as the ./timing subpath)
// ============================================
export {
  debounce,
  throttle,
  withTiming,
  measureTime,
  withTimeout,
  TimeoutError,
} from './std/timing.js';
export type {
  DebounceOptions,
  DebouncedFunction,
  ThrottleOptions,
  ThrottledFunction,
  TimingResult,
  TimingOptions,
  WithTimeoutOptions,
  TimeoutOperation,
} from './std/timing.js';

// ============================================
// std: retry (vscode-free; also exported as the ./retry subpath)
// ============================================
export { retry, RetryExhaustedError } from './std/retry.js';
export type { RetryOptions, RetryJitter, RetryContext } from './std/retry.js';

// ============================================
// Localization
// ============================================
export {
  l10n,
  getLanguage,
  isLanguage,
  plural,
  formatNumber,
  formatDate,
  formatRelativeTime,
  pluralFor,
  formatNumberFor,
  formatDateFor,
  formatRelativeTimeFor,
  getOrCreateCached,
} from './l10n/index.js';
export type {
  L10nMessageOptions,
  PluralForms,
  NumberFormatOptions,
  DateFormatOptions,
  RelativeTimeUnit,
} from './l10n/index.js';
