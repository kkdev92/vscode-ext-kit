import * as vscode from 'vscode';
import type { Logger } from './types.js';
import type { Result } from './result.js';

export interface RunOptions {
  /** Custom user-facing error message shown in the error notification */
  userMessage?: string;
  /**
   * Rethrow real errors after logging (default: false). Cancellations are
   * never rethrown — a user pressing Escape is not an exception the caller
   * should handle.
   */
  rethrow?: boolean;
  /** Suppress the error notification, log only (default: false) */
  silent?: boolean;
}

/**
 * Returns true when the thrown value represents a user cancellation
 * (`vscode.CancellationError`, an `AbortError` from an aborted
 * `AbortSignal`, or anything named `Canceled` — the name VS Code uses).
 */
export function isCancellation(error: unknown): boolean {
  if (error instanceof vscode.CancellationError) return true;
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return name === 'AbortError' || name === 'Canceled';
}

/**
 * Executes a function and returns a {@link Result}, with unified error
 * handling: real failures are logged and shown to the user, while
 * cancellations are logged at debug level with no notification and marked
 * `cancelled: true` on the failure branch.
 *
 * The function receives an `AbortSignal` that aborts if the returned
 * promise's work is cancelled via `vscode.CancellationError` conventions —
 * pass it through to `fetch`, `retry`, and other signal-aware APIs.
 *
 * @example
 * ```typescript
 * const result = await tryRun(logger, 'Fetch data', (signal) => fetch(url, { signal }));
 * if (result.ok) {
 *   use(result.value);
 * } else if (!result.cancelled) {
 *   fallback(result.error);
 * }
 * ```
 */
export async function tryRun<T>(
  logger: Logger,
  name: string,
  fn: (signal: AbortSignal) => Promise<T> | T,
  opts: Omit<RunOptions, 'rethrow'> = {}
): Promise<Result<T>> {
  const { userMessage, silent = false } = opts;
  const controller = new AbortController();
  try {
    const value = await fn(controller.signal);
    return { ok: true, value };
  } catch (error: unknown) {
    controller.abort();
    const normalized = error instanceof Error ? error : new Error(String(error));
    if (isCancellation(error)) {
      logger.debug(`${name} cancelled`);
      return { ok: false, error: normalized, cancelled: true };
    }
    logger.error(`${name} failed: ${normalized.message}`, { error: normalized });
    if (!silent) {
      // Fire-and-forget: the notification thenable only settles when the
      // toast is dismissed, and awaiting it would hold the caller open.
      void vscode.window.showErrorMessage(userMessage ?? `${name} failed: ${normalized.message}`);
    }
    return { ok: false, error: normalized, cancelled: false };
  }
}

/**
 * Executes a function with unified error handling and collapses failures to
 * `undefined`. Cancellations always return `undefined` quietly.
 *
 * Use {@link tryRun} when the caller needs the error, or when a successful
 * `undefined` must be distinguishable from a failure.
 *
 * @example
 * ```typescript
 * const data = await run(logger, 'Fetch data', () => fetchData());
 * if (data === undefined) return; // already logged & shown to the user
 * ```
 */
export async function run<T>(
  logger: Logger,
  name: string,
  fn: (signal: AbortSignal) => Promise<T> | T,
  opts: RunOptions = {}
): Promise<T | undefined> {
  const result = await tryRun(logger, name, fn, opts);
  if (result.ok) return result.value;
  if (opts.rethrow && !result.cancelled) throw result.error;
  return undefined;
}
