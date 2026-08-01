/**
 * @packageDocumentation
 * The wire contract shared by {@link ../rpc.js createWebviewRpc} (extension
 * host side) and {@link ../client.js createWebviewRpcClient} (webview side).
 * Deliberately free of any `vscode` import so the client — and this module —
 * can be bundled into webview code.
 *
 * Everything here is an implementation detail of the two RPC factories except
 * {@link WebviewRpcSchema} and {@link WebviewRpcRequestOptions}, which are the
 * public types both sides are written against.
 */

// ============================================
// Schema (public)
// ============================================

/**
 * Contract for a webview RPC channel. Define one interface per webview and
 * reference it from both the extension host code (`createWebviewRpc`) and the
 * webview bundle (`createWebviewRpcClient`), so the two sides cannot drift.
 *
 * The two naming conventions here differ, because requests and events need
 * different information. A request field is named after the side that
 * **answers** it (`webviewRequests` are handled by the webview), since that's
 * the side whose handler signature the types have to describe. An event field
 * is named after the side that **sends** it (`hostEvents` travel host →
 * webview), because a one-way message has no handler contract to pin down.
 */
export interface WebviewRpcSchema {
  /** Handled by the webview. The host calls these with `rpc.request`. */
  webviewRequests?: Record<string, { params: unknown; result: unknown }>;
  /** Handled by the host. The webview calls these; bind with `rpc.onRequest`. */
  hostRequests?: Record<string, { params: unknown; result: unknown }>;
  /** Host → Webview. One-way events (no response expected). */
  hostEvents?: Record<string, unknown>;
  /** Webview → Host. One-way events (no response expected). */
  webviewEvents?: Record<string, unknown>;
}

/**
 * Options accepted by `request` on both the host and the webview side.
 */
export interface WebviewRpcRequestOptions {
  /** Aborts the request, rejecting it locally and best-effort notifying the peer. */
  signal?: AbortSignal;
  /** Convenience for a timeout-only abort; combined with `signal` if both are given. */
  timeoutMs?: number;
}

// ============================================
// Wire protocol (internal)
// ============================================

export interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

export type RpcEnvelope =
  | { k: 'req'; id: string; method: string; params: unknown }
  | { k: 'res'; id: string; ok: true; result: unknown }
  | { k: 'res'; id: string; ok: false; error: SerializedError }
  | { k: 'ev'; event: string; payload: unknown }
  | { k: 'cancel'; id: string };

export function isRpcEnvelope(value: unknown): value is RpcEnvelope {
  return (
    typeof value === 'object' && value !== null && typeof (value as { k?: unknown }).k === 'string'
  );
}

export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: 'Error', message: String(error) };
}

export function reviveError(error: SerializedError): Error {
  const revived = new Error(error.message);
  revived.name = error.name;
  if (error.stack !== undefined) {
    revived.stack = error.stack;
  }
  return revived;
}

/**
 * Folds an optional external signal and an optional timeout into the single
 * `AbortSignal` a request listens to, or `undefined` when neither was given.
 * Shared so the host and the client cancel with byte-identical semantics.
 */
export function combineAbortSignals(options?: WebviewRpcRequestOptions): AbortSignal | undefined {
  const signals: AbortSignal[] = [];
  if (options?.signal) {
    signals.push(options.signal);
  }
  if (options?.timeoutMs !== undefined) {
    signals.push(AbortSignal.timeout(options.timeoutMs));
  }
  return signals.length === 0
    ? undefined
    : signals.length === 1
      ? signals[0]
      : AbortSignal.any(signals);
}
