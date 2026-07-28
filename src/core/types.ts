import type * as vscode from 'vscode';

// ============================================
// Logger types
// ============================================

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface LoggerOptions {
  /**
   * Log level threshold applied by this library on top of the channel.
   *
   * Defaults: `'trace'` in `'log'` channel mode (the Output panel already
   * filters by the user-selected level, so the library passes everything
   * through), `'info'` in `'plain'` mode (the gate is the only filter).
   */
  level?: LogLevel;
  /** VS Code config section to read the log level from (e.g. 'myExtension.logLevel') */
  configSection?: string;
  /**
   * `'log'` (default): use a {@link vscode.LogOutputChannel}. Timestamps,
   * level colors, the Output panel level dropdown and the
   * `Developer: Set Log Level` command all work natively. Note that the
   * panel-side level is user-controlled, so `trace`/`debug` lines may be
   * hidden until the user raises their log level.
   *
   * `'plain'`: format lines manually into a regular OutputChannel. The
   * `level` option is then the only filter, guaranteeing that forced
   * verbose logging (e.g. a diagnostics command) is always visible.
   */
  channelMode?: 'log' | 'plain';
  /** Show the output channel on error (default: true) */
  showOnError?: boolean;
  /**
   * Minimum interval between successive `channel.show()` calls when
   * `showOnError` is true. Suppresses repeated panel popups during error
   * storms. `0` (default) shows on every error.
   */
  showOnErrorThrottleMs?: number;
  /**
   * Native telemetry sender. Wrapped with `vscode.env.createTelemetryLogger`,
   * which applies VS Code's built-in PII scrubbing (paths, emails, tokens)
   * and respects the user's telemetry settings automatically.
   */
  telemetry?: vscode.TelemetrySender;
}

export interface Logger extends vscode.Disposable {
  trace(message: string, fields?: Record<string, unknown>): void;
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(error: string | Error, fields?: Record<string, unknown>): void;
  /**
   * Creates a child logger that shares this logger's channel, level and
   * telemetry, prefixing every message with `[scope]`. Nested children
   * compose scopes with `:`. Disposing a child is a no-op — the root
   * logger owns the channel lifecycle.
   */
  child(scope: string): Logger;
  setLevel(level: LogLevel): void;
  readonly level: LogLevel;
  [Symbol.dispose](): void;
}

// ============================================
// Commands types
// ============================================

/**
 * Command handler. Uses `any[]` on purpose: `vscode.commands.registerCommand`
 * itself types callback arguments as `any[]`, and a stricter `unknown[]`
 * would reject precisely-typed handlers like `(uri: vscode.Uri) => void`
 * that the raw API accepts.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CommandHandler = (...args: any[]) => unknown;

export type TextEditorCommandHandler = (
  editor: vscode.TextEditor,
  edit: vscode.TextEditorEdit,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ...args: any[]
) => void | Promise<void>;

export interface RegisterCommandsOptions {
  /** Wrap handlers with run() error handling (default: true) */
  wrap?: boolean;
  /** Custom user-facing action name per command (used in error messages) */
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
//
// `InputTextOptions` (and the wizard's various step/option types) moved to
// `src/ui/input.ts` / `src/ui/wizard.ts` / `src/ui/pick.ts` as part of the
// v1 UI redesign — the UI layer's option types now live next to the
// functions that use them instead of in this shared file.
