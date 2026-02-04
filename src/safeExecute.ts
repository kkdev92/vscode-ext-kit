import * as vscode from 'vscode';
import type { Logger, Result, SafeExecuteOptions } from './types.js';

function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

/**
 * Executes a function safely with unified error handling.
 * On error: logs to the logger and optionally shows a notification.
 *
 * @param logger - Logger instance for error logging
 * @param actionName - Human-readable action name for error messages
 * @param fn - Function to execute (sync or async)
 * @param opts - Options for error handling behavior
 * @returns Result of fn on success, or `undefined` on error (unless rethrow is true)
 *
 * @remarks
 * When an error occurs and `rethrow` is false (default), this function returns `undefined`.
 * This means the return type is `T | undefined`, which callers must handle appropriately.
 * If your function intentionally returns `undefined` as a valid value, consider using
 * a wrapper object or the `rethrow: true` option to distinguish errors from valid returns.
 *
 * @example
 * ```typescript
 * // Basic usage - check for undefined
 * const result = await safeExecute(logger, 'Fetch data', async () => {
 *   const response = await fetch(url);
 *   return response.json();
 * });
 * if (result === undefined) {
 *   // Error occurred, already logged and shown to user
 *   return;
 * }
 *
 * // With custom error message
 * await safeExecute(logger, 'Save file', saveFile, {
 *   userMessage: 'Failed to save the file. Please check permissions.',
 * });
 *
 * // Silent mode (log only, no notification)
 * await safeExecute(logger, 'Background sync', sync, { silent: true });
 *
 * // With rethrow for explicit error handling
 * try {
 *   const result = await safeExecute(logger, 'Critical op', fn, { rethrow: true });
 * } catch (error) {
 *   // Custom error handling after logging
 * }
 * ```
 */
export async function safeExecute<T>(
  logger: Logger,
  actionName: string,
  fn: () => Promise<T> | T,
  opts: SafeExecuteOptions = {}
): Promise<T | undefined> {
  const { userMessage, rethrow = false, silent = false } = opts;

  try {
    return await fn();
  } catch (error: unknown) {
    const errorMessage = formatError(error);
    const logMessage = `${actionName} failed: ${errorMessage}`;

    logger.error(logMessage, error);

    if (!silent) {
      const displayMessage = userMessage ?? `${actionName} failed: ${errorMessage}`;
      await vscode.window.showErrorMessage(displayMessage);
    }

    if (rethrow) {
      throw error;
    }

    return undefined;
  }
}

/**
 * Executes a function safely and returns a Result type.
 * Unlike safeExecute, this allows distinguishing between
 * a successful undefined result and an error.
 *
 * @param logger - Logger instance for error logging
 * @param actionName - Human-readable action name for error messages
 * @param fn - Function to execute (sync or async)
 * @param opts - Options for error handling behavior (rethrow is not supported)
 * @returns Result object with ok/error distinction
 *
 * @example
 * ```typescript
 * // Handles functions that may return undefined
 * const result = await trySafeExecute(logger, 'Find item', () => {
 *   return array.find(x => x.id === targetId);
 * });
 *
 * if (result.ok) {
 *   // result.value is T (may be undefined, but we know it succeeded)
 *   console.log('Found:', result.value);
 * } else {
 *   // result.error is Error
 *   console.error('Failed:', result.error.message);
 * }
 * ```
 */
export async function trySafeExecute<T>(
  logger: Logger,
  actionName: string,
  fn: () => Promise<T> | T,
  opts: Omit<SafeExecuteOptions, 'rethrow'> = {}
): Promise<Result<T>> {
  const { userMessage, silent = false } = opts;

  try {
    const value = await fn();
    return { ok: true, value };
  } catch (error: unknown) {
    const errorMessage = formatError(error);
    const logMessage = `${actionName} failed: ${errorMessage}`;

    logger.error(logMessage, error);

    if (!silent) {
      const displayMessage = userMessage ?? `${actionName} failed: ${errorMessage}`;
      await vscode.window.showErrorMessage(displayMessage);
    }

    const normalizedError = error instanceof Error ? error : new Error(String(error));
    return { ok: false, error: normalizedError };
  }
}
