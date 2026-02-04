/**
 * @packageDocumentation
 * vscode-ext-kit - A lightweight utility library for VS Code extension development
 *
 * This library provides common utilities for building VS Code extensions:
 *
 * - **Logger** - Structured logging with VS Code's LogOutputChannel
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
} from './types.js';

export type { RetryOptions } from './retry.js';
export type {
  DebouncedFunction,
  ThrottledFunction,
  TimingResult,
  TimingOptions,
} from './timing.js';
export type { NotificationOptions, NotificationAction, ConfirmOptions } from './notification.js';
export type { StatusBarItemOptions, ManagedStatusBarItem } from './statusbar.js';
export type { FileWatcherOptions, FileWatcherEvent, ManagedFileWatcher } from './filewatcher.js';
export type { StorageOptions, TypedStorage, SecretStorage } from './storage.js';
export type { EditOperation } from './editor.js';
export type { TreeItemData } from './treeview.js';
export type { WebViewOptions, WebViewMessage, ManagedWebViewPanel, CSPOptions } from './webview.js';

// ============================================
// Logger
// ============================================
export { createLogger } from './logger.js';

// ============================================
// SafeExecute
// ============================================
export { safeExecute, trySafeExecute } from './safeExecute.js';

// ============================================
// Commands
// ============================================
export { registerCommands, registerTextEditorCommands, executeCommand } from './commands.js';

// ============================================
// Config
// ============================================
export { getConfig, getSetting, setSetting, onConfigChange } from './config.js';

// ============================================
// Progress
// ============================================
export { withProgress, withSteps, toAbortSignal } from './progress.js';
export type {
  ProgressReporter,
  ProgressStep,
  StepsProgressOptions,
  StepsResult,
} from './progress.js';

// ============================================
// UI
// ============================================
export { pickOne, pickMany, inputText, wizard } from './ui.js';
export type {
  WizardQuickPickItem,
  WizardQuickPickStep,
  WizardInputStep,
  WizardStep,
  WizardOptions,
  WizardResult,
} from './ui.js';

// ============================================
// Disposable
// ============================================
export { DisposableCollection } from './disposable.js';

// ============================================
// Retry
// ============================================
export { retry } from './retry.js';

// ============================================
// Timing
// ============================================
export { debounce, throttle, withTiming, measureTime } from './timing.js';

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
} from './l10n.js';
export type {
  PluralForms,
  NumberFormatOptions,
  DateFormatOptions,
  RelativeTimeUnit,
} from './l10n.js';

// ============================================
// Notification
// ============================================
export { showInfo, showWarn, showError, confirm, showWithActions } from './notification.js';

// ============================================
// StatusBar
// ============================================
export { createStatusBarItem, showStatusMessage } from './statusbar.js';

// ============================================
// FileWatcher
// ============================================
export { createFileWatcher, watchFile } from './filewatcher.js';

// ============================================
// Storage
// ============================================
export { createGlobalStorage, createWorkspaceStorage, createSecretStorage } from './storage.js';

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
} from './editor.js';

// ============================================
// TreeView
// ============================================
export { BaseTreeDataProvider, SimpleTreeDataProvider, createTreeView } from './treeview.js';

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
} from './webview.js';
