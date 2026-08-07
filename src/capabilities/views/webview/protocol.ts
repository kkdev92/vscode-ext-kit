/**
 * @packageDocumentation
 * The wire contract shared by `createWebviewRpc` (extension host side) and
 * `createWebviewRpcClient` (webview side). Deliberately free of any `vscode`
 * import so the client — and this module — can be bundled into webview code.
 *
 * Everything here is an implementation detail of the two RPC factories except
 * {@link WebviewRpcSchema} and {@link WebviewRpcRequestOptions}, which are the
 * public types both sides are written against.
 *
 * This module validates the envelope discriminator and correlation fields, not
 * application payloads. `params`, `result`, and `payload` cross a webview trust
 * boundary as `unknown` at runtime and require domain validation in handlers.
 */

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

/** Options accepted by `request` on both the host and the webview side. */
export interface WebviewRpcRequestOptions {
  /**
   * Aborts the request, rejecting it locally and best-effort notifying the
   * peer. The peer stops only if its handler cooperates with `ctx.signal`.
   */
  signal?: AbortSignal;
  /**
   * Convenience for a timeout-only abort; combined with `signal` if both are
   * given. Timeout uses the same cooperative peer cancellation path.
   */
  timeoutMs?: number;
}

/** A serialized error crossing the webview boundary. */
export interface SerializedError {
  /** Error class/name for display and branching; prototypes are not preserved. */
  name: string;
  /** Peer-provided text. Treat it as untrusted display data. */
  message: string;
  /**
   * Optional peer stack. It can contain paths or implementation detail; do not
   * expose it to users or telemetry without an explicit redaction policy.
   */
  stack?: string;
}

/** One RPC wire message. */
export type RpcEnvelope =
  | { k: 'req'; id: string; method: string; params: unknown }
  | { k: 'res'; id: string; ok: true; result: unknown }
  | { k: 'res'; id: string; ok: false; error: SerializedError }
  | { k: 'ev'; event: string; payload: unknown }
  | { k: 'cancel'; id: string };

/**
 * Fully validates a raw message against the wire protocol.
 *
 * A webview is an untrusted boundary — any script on the page can
 * `postMessage`. Every variant's control fields are therefore checked before a
 * caller mutates correlation state. Application payloads are deliberately not
 * checked here because only the domain schema knows their valid shape.
 */
export function isRpcEnvelope(value: unknown): value is RpcEnvelope {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<
    Record<'k' | 'id' | 'method' | 'ok' | 'error' | 'event', unknown>
  >;
  switch (candidate.k) {
    case 'req':
      return typeof candidate.id === 'string' && typeof candidate.method === 'string';
    case 'res':
      if (typeof candidate.id !== 'string') {
        return false;
      }
      // `result` is deliberately unchecked: undefined is a valid result.
      return (
        candidate.ok === true || (candidate.ok === false && isSerializedError(candidate.error))
      );
    case 'ev':
      return typeof candidate.event === 'string';
    case 'cancel':
      return typeof candidate.id === 'string';
    default:
      return false;
  }
}

/** Whether `value` carries the two fields {@link reviveError} needs. */
function isSerializedError(value: unknown): value is SerializedError {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const candidate = value as Partial<SerializedError>;
  return (
    typeof candidate.name === 'string' &&
    typeof candidate.message === 'string' &&
    (candidate.stack === undefined || typeof candidate.stack === 'string')
  );
}

/**
 * Flattens an error for the wire without carrying non-serializable fields.
 * Error messages and stacks cross the boundary verbatim; callers that may
 * include secrets must redact before throwing.
 */
export function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      ...(error.stack === undefined ? {} : { stack: error.stack }),
    };
  }
  return { name: 'Error', message: String(error) };
}

/** Rebuilds an `Error` from its serialized form. */
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
export function combineRequestSignals(options?: WebviewRpcRequestOptions): AbortSignal | undefined {
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
