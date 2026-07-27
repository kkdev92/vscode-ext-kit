/**
 * @packageDocumentation
 * vscode-ext-kit - A lightweight utility library for VS Code extension development
 *
 * This library provides common utilities for building VS Code extensions:
 *
 * - **Logger** - Structured logging via OutputChannel with dynamic log levels
 * - **safeExecute** - Unified error handling with logging and notifications
 * - **registerCommands** - Batch command registration with error handling
 * - **Config utilities** - Type-safe configuration access
 * - **withProgress/withSteps** - Progress notifications with step-based tracking
 * - **UI utilities** - QuickPick, InputBox, and multi-step wizard
 * - **Notification** - showInfo/showWarn/showError with actions
 * - **StatusBar** - Managed status bar items with spinner support
 * - **FileWatcher** - Debounced file watching with event batching
 * - **Storage** - Type-safe global/workspace storage wrappers
 * - **Editor** - Text editor manipulation utilities
 * - **TreeView** - Base TreeDataProvider with caching
 * - **WebView** - Managed WebView panels with CSP support
 *
 * @example
 * ```typescript
 * import {
 *   createLogger,
 *   registerCommands,
 *   safeExecute,
 *   withProgress,
 *   showInfo,
 *   createStatusBarItem,
 * } from '@kkdev92/vscode-ext-kit';
 *
 * export function activate(context: vscode.ExtensionContext) {
 *   const logger = createLogger('MyExtension');
 *   context.subscriptions.push(logger);
 *
 *   registerCommands(context, logger, {
 *     'myext.hello': () => showInfo('Hello!'),
 *   });
 * }
 * ```
 *
 * @module @kkdev92/vscode-ext-kit
 */

// ============================================
// Types
// ============================================
export type {
  Result,
  LogLevel,
  LoggerOptions,
  Logger,
  SafeExecuteOptions,
  CommandHandler,
  TextEditorCommandHandler,
  RegisterCommandsOptions,
  ProgressOptions,
  InputTextOptions,
  TelemetryReporter,
} from './core/types.js';

export type { RetryOptions, RetryJitter } from './std/retry.js';
export type {
  DebouncedFunction,
  ThrottledFunction,
  TimingResult,
  TimingOptions,
} from './std/timing.js';
export type { NotificationOptions, NotificationAction, ConfirmOptions } from './ui/notification.js';
export type { StatusBarItemOptions, ManagedStatusBarItem } from './ui/statusbar.js';
export type {
  FileWatcherOptions,
  FileWatcherEvent,
  ManagedFileWatcher,
} from './workspace/filewatcher.js';
export type { StorageOptions, TypedStorage, SecretStorage } from './storage/index.js';
export type { EditOperation } from './workspace/editor.js';
export type { TreeItemData } from './views/treeview.js';
export type {
  WebViewOptions,
  WebViewMessage,
  ManagedWebViewPanel,
  CSPOptions,
} from './views/webview.js';

// ============================================
// Logger
// ============================================
export { createLogger } from './core/logger.js';

// ============================================
// SafeExecute
// ============================================
export { safeExecute, trySafeExecute } from './core/safeExecute.js';

// ============================================
// Commands
// ============================================
export { registerCommands, registerTextEditorCommands, executeCommand } from './core/commands.js';

// ============================================
// Config
// ============================================
export { getConfig, getSetting, setSetting, onConfigChange } from './config/index.js';

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
// Disposable
// ============================================
export { DisposableCollection } from './core/disposable.js';

// ============================================
// Retry
// ============================================
export { retry } from './std/retry.js';

// ============================================
// Timing
// ============================================
export { debounce, throttle, withTiming, measureTime } from './std/timing.js';

// ============================================
// Localization
// ============================================
export {
  t,
  getLanguage,
  isLanguage,
  plural,
  formatNumber,
  formatDate,
  formatRelativeTime,
} from './l10n/index.js';
export type {
  PluralForms,
  NumberFormatOptions,
  DateFormatOptions,
  RelativeTimeUnit,
} from './l10n/index.js';

// ============================================
// Notification
// ============================================
export { showInfo, showWarn, showError, confirm, showWithActions } from './ui/notification.js';

// ============================================
// StatusBar
// ============================================
export { createStatusBarItem, showStatusMessage } from './ui/statusbar.js';

// ============================================
// FileWatcher
// ============================================
export { createFileWatcher, watchFile } from './workspace/filewatcher.js';

// ============================================
// Storage
// ============================================
export {
  createGlobalStorage,
  createWorkspaceStorage,
  createSecretStorage,
} from './storage/index.js';

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
  transformSelection,
  transformAllSelections,
  moveCursor,
  selectRange,
  selectLine,
  selectWord,
  getLineCount,
  getDocumentText,
  getFilePath,
  isDirty,
  getLanguageId,
} from './workspace/editor.js';

// ============================================
// TreeView
// ============================================
export { BaseTreeDataProvider, SimpleTreeDataProvider, createTreeView } from './views/treeview.js';

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
