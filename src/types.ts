import type * as vscode from 'vscode';

// ============================================
// Result type
// ============================================

/**
 * Result type for operations that may fail.
 * Provides explicit success/failure distinction, unlike `T | undefined`.
 *
 * @example
 * ```typescript
 * const result = await trySafeExecute(logger, 'Fetch data', fetchData);
 * if (result.ok) {
 *   console.log(result.value); // T - success value
 * } else {
 *   console.error(result.error); // E - error object
 * }
 * ```
 */
export type Result<T, E = Error> = { ok: true; value: T } | { ok: false; error: E };

// ============================================
// Logger types
// ============================================

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LoggerOptions {
  /** Log level threshold (default: 'info') */
  level?: LogLevel;
  /** VSCode config section to read log level from (e.g., 'myExtension.logLevel') */
  configSection?: string;
  /** Show output channel on error (default: true) */
  showOnError?: boolean;
  /**
   * Minimum interval between successive `channel.show()` calls when
   * `showOnError` is true. Suppresses repeated panel popups during error
   * storms. `0` (default) preserves the historical behaviour of showing
   * on every error.
   * @default 0
   */
  showOnErrorThrottleMs?: number;
  /** Include timestamp in log messages (default: true) */
  timestamp?: boolean;
  /** Optional telemetry reporter for error tracking */
  telemetryReporter?: TelemetryReporter;
  /**
   * When true, redact the current OS user's home directory path from
   * `errorStack` and `errorMessage` properties before sending them via
   * `telemetryReporter`. Useful for reducing PII exposure when stack
   * traces include developer-machine paths like `C:\Users\alice\...`.
   * @default false
   */
  redactStackPaths?: boolean;
}

export interface Logger extends vscode.Disposable {
  trace(message: string, ...args: unknown[]): void;
  debug(message: string, ...args: unknown[]): void;
  info(message: string, ...args: unknown[]): void;
  warn(message: string, ...args: unknown[]): void;
  error(message: string | Error, ...args: unknown[]): void;
  setLevel(level: LogLevel): void;
}

// ============================================
// SafeExecute types
// ============================================

export interface SafeExecuteOptions {
  /** Custom user-facing error message */
  userMessage?: string;
  /** Rethrow the error after logging (default: false) */
  rethrow?: boolean;
  /** Suppress notification, log only (default: false) */
  silent?: boolean;
}

// ============================================
// Commands types
// ============================================

export type CommandHandler = (...args: unknown[]) => unknown | Promise<unknown>;

export type TextEditorCommandHandler = (
  editor: vscode.TextEditor,
  edit: vscode.TextEditorEdit,
  ...args: unknown[]
) => void | Promise<void>;

export interface RegisterCommandsOptions {
  /** Wrap handlers with safeExecute (default: true) */
  wrapWithSafeExecute?: boolean;
  /** Custom error message generator */
  commandErrorMessage?: (commandId: string) => string;
}

// ============================================
// Progress types
// ============================================

export interface ProgressOptions {
  /** Progress location (default: Notification) */
  location?: vscode.ProgressLocation;
  /** Allow user to cancel (default: false) */
  cancellable?: boolean;
}

// ============================================
// UI types
// ============================================

export interface InputTextOptions {
  /** Prompt text to display */
  prompt: string;
  /** Placeholder text */
  placeHolder?: string;
  /** Initial value */
  value?: string;
  /** Password input mode */
  password?: boolean;
  /** Validation function */
  validate?: (value: string) => string | undefined | Promise<string | undefined>;
}

// ============================================
// Telemetry types
// ============================================

/**
 * Interface for telemetry reporting.
 * Compatible with vscode-extension-telemetry or custom implementations.
 */
export interface TelemetryReporter {
  /**
   * Sends a telemetry event.
   *
   * @param eventName - Name of the event
   * @param properties - Optional string properties
   * @param measurements - Optional numeric measurements
   */
  sendTelemetryEvent(
    eventName: string,
    properties?: Record<string, string>,
    measurements?: Record<string, number>
  ): void;

  /**
   * Sends a telemetry error event.
   *
   * @param eventName - Name of the error event
   * @param properties - Optional string properties
   * @param measurements - Optional numeric measurements
   */
  sendTelemetryErrorEvent(
    eventName: string,
    properties?: Record<string, string>,
    measurements?: Record<string, number>
  ): void;
}
