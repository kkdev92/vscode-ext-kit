import * as vscode from 'vscode';

// ============================================
// Schema
// ============================================

/**
 * Contract for a {@link createWebviewRpc} channel. Define one interface per
 * webview and reference it from both the extension host code and the
 * webview-side counterpart — see {@link createWebviewRpc}'s `@example` for a
 * full webview-side reference implementation.
 */
export interface WebviewRpcSchema {
  /** Webview → Host. Requests that expect a response. */
  webviewRequests?: Record<string, { params: unknown; result: unknown }>;
  /** Host → Webview. Requests that expect a response. */
  hostRequests?: Record<string, { params: unknown; result: unknown }>;
  /** Host → Webview. One-way events (no response expected). */
  hostEvents?: Record<string, unknown>;
  /** Webview → Host. One-way events (no response expected). */
  webviewEvents?: Record<string, unknown>;
}

// ============================================
// Wire protocol (internal — not part of the public API)
// ============================================

interface SerializedError {
  name: string;
  message: string;
  stack?: string;
}

type RpcEnvelope =
  | { k: 'req'; id: string; method: string; params: unknown }
  | { k: 'res'; id: string; ok: true; result: unknown }
  | { k: 'res'; id: string; ok: false; error: SerializedError }
  | { k: 'ev'; event: string; payload: unknown }
  | { k: 'cancel'; id: string };

function isRpcEnvelope(value: unknown): value is RpcEnvelope {
  return (
    typeof value === 'object' && value !== null && typeof (value as { k?: unknown }).k === 'string'
  );
}

function serializeError(error: unknown): SerializedError {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { name: 'Error', message: String(error) };
}

function reviveError(error: SerializedError): Error {
  const revived = new Error(error.message);
  revived.name = error.name;
  if (error.stack !== undefined) {
    revived.stack = error.stack;
  }
  return revived;
}

// ============================================
// createWebviewRpc
// ============================================

/**
 * Options accepted by {@link WebviewRpc.request}.
 */
export interface WebviewRpcRequestOptions {
  /** Aborts the request, rejecting it locally and best-effort notifying the peer. */
  signal?: AbortSignal;
  /** Convenience for a timeout-only abort; combined with `signal` if both are given. */
  timeoutMs?: number;
}

/**
 * A typed, bidirectional request/response + event channel layered over a
 * `vscode.Webview`'s raw `postMessage`/`onDidReceiveMessage`. See
 * {@link createWebviewRpc}.
 */
export interface WebviewRpc<S extends WebviewRpcSchema = WebviewRpcSchema>
  extends vscode.Disposable {
  /**
   * Sends a request to the webview and resolves with its response.
   * Rejects if the webview responds with an error, if `options.signal`
   * aborts, if `options.timeoutMs` elapses, or if the RPC is disposed while
   * the request is in flight.
   */
  request<K extends keyof NonNullable<S['webviewRequests']>>(
    method: K,
    params: NonNullable<S['webviewRequests']>[K]['params'],
    options?: WebviewRpcRequestOptions
  ): Promise<NonNullable<S['webviewRequests']>[K]['result']>;

  /**
   * Registers the handler for a request the webview may send. The handler's
   * `ctx.signal` aborts if the webview cancels the request (or the RPC is
   * disposed) before the handler settles.
   */
  onRequest<K extends keyof NonNullable<S['hostRequests']>>(
    method: K,
    handler: (
      params: NonNullable<S['hostRequests']>[K]['params'],
      ctx: { signal: AbortSignal }
    ) =>
      | NonNullable<S['hostRequests']>[K]['result']
      | Promise<NonNullable<S['hostRequests']>[K]['result']>
  ): vscode.Disposable;

  /** Sends a one-way event to the webview. Does not wait for acknowledgement. */
  emit<K extends keyof NonNullable<S['hostEvents']>>(
    event: K,
    payload: NonNullable<S['hostEvents']>[K]
  ): void;

  /** Subscribes to a one-way event sent by the webview. */
  onEvent<K extends keyof NonNullable<S['webviewEvents']>>(
    event: K,
    handler: (payload: NonNullable<S['webviewEvents']>[K]) => void
  ): vscode.Disposable;
}

/**
 * Creates a typed request/response + event RPC channel over a
 * `vscode.Webview`. VS Code's own `postMessage`/`onDidReceiveMessage` are
 * fire-and-forget with no correlation, timeout, or cancellation built in —
 * this fills that gap.
 *
 * Works with both `WebviewPanel.webview` and `WebviewView.webview` (they
 * share the same `Webview` shape), and `ManagedWebviewPanel`/
 * `ManagedWebviewView` both expose this automatically as `.rpc`.
 *
 * Only the extension host side is implemented by this library (it has no
 * runtime dependencies and ships no browser bundle). The webview side is a
 * small amount of code you copy into your own webview bundle — see the
 * second code block in the example below for a complete, minimal
 * counterpart.
 *
 * @param webview - The webview to layer the RPC channel over
 *
 * @example
 * ```typescript
 * // Define the contract once, referenced by both sides.
 * interface MyRpcSchema extends WebviewRpcSchema {
 *   webviewRequests: { getSelection: { params: void; result: { text: string } } };
 *   hostRequests: { save: { params: { content: string }; result: { ok: boolean } } };
 *   hostEvents: { theme: { kind: 'light' | 'dark' } };
 *   webviewEvents: { dirty: { isDirty: boolean } };
 * }
 *
 * // Extension host side:
 * const rpc = createWebviewRpc<MyRpcSchema>(panel.webview);
 *
 * rpc.onRequest('save', async ({ content }) => {
 *   await writeFile(content);
 *   return { ok: true };
 * });
 * rpc.onEvent('dirty', ({ isDirty }) => updateTabTitle(isDirty));
 * rpc.emit('theme', { kind: 'dark' });
 *
 * const { text } = await rpc.request('getSelection', undefined, { timeoutMs: 5000 });
 * ```
 *
 * ```js
 * // media/rpc-client.js — minimal webview-side counterpart (not shipped by
 * // this library; copy and adapt into your own webview bundle).
 * const vscodeApi = acquireVsCodeApi();
 * const pending = new Map();
 * const requestHandlers = new Map();
 * const eventHandlers = new Map();
 * const inFlight = new Map();
 * let nextId = 0;
 *
 * window.addEventListener('message', ({ data: msg }) => {
 *   if (msg.k === 'res') {
 *     const p = pending.get(msg.id);
 *     if (!p) return;
 *     pending.delete(msg.id);
 *     msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error.message));
 *   } else if (msg.k === 'req') {
 *     const handler = requestHandlers.get(msg.method);
 *     if (!handler) {
 *       vscodeApi.postMessage({ k: 'res', id: msg.id, ok: false, error: { name: 'Error', message: `Unknown method: ${msg.method}` } });
 *       return;
 *     }
 *     const controller = new AbortController();
 *     inFlight.set(msg.id, controller);
 *     Promise.resolve(handler(msg.params, { signal: controller.signal })).then(
 *       (result) => vscodeApi.postMessage({ k: 'res', id: msg.id, ok: true, result }),
 *       (error) => vscodeApi.postMessage({ k: 'res', id: msg.id, ok: false, error: { name: error?.name ?? 'Error', message: String(error?.message ?? error) } })
 *     ).finally(() => inFlight.delete(msg.id));
 *   } else if (msg.k === 'ev') {
 *     for (const fn of eventHandlers.get(msg.event) ?? []) fn(msg.payload);
 *   } else if (msg.k === 'cancel') {
 *     inFlight.get(msg.id)?.abort();
 *     inFlight.delete(msg.id);
 *   }
 * });
 *
 * export function request(method, params) {
 *   const id = String(nextId++);
 *   return new Promise((resolve, reject) => {
 *     pending.set(id, { resolve, reject });
 *     vscodeApi.postMessage({ k: 'req', id, method, params });
 *   });
 * }
 * export function onRequest(method, handler) { requestHandlers.set(method, handler); }
 * export function emit(event, payload) { vscodeApi.postMessage({ k: 'ev', event, payload }); }
 * export function onEvent(event, handler) {
 *   const set = eventHandlers.get(event) ?? new Set();
 *   set.add(handler);
 *   eventHandlers.set(event, set);
 * }
 * ```
 */
export function createWebviewRpc<S extends WebviewRpcSchema = WebviewRpcSchema>(
  webview: vscode.Webview
): WebviewRpc<S> {
  interface PendingEntry {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
  }
  type RequestHandler = (params: unknown, ctx: { signal: AbortSignal }) => unknown;

  const pending = new Map<string, PendingEntry>();
  const requestHandlers = new Map<string, RequestHandler>();
  const eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
  const inFlightHandlers = new Map<string, AbortController>();
  let nextId = 0;
  let disposed = false;

  const messageSub = webview.onDidReceiveMessage((raw: unknown) => {
    if (!isRpcEnvelope(raw)) {
      return;
    }

    if (raw.k === 'res') {
      const entry = pending.get(raw.id);
      if (!entry) {
        return; // Already timed out / aborted / disposed — safe to ignore.
      }
      pending.delete(raw.id);
      if (raw.ok) {
        entry.resolve(raw.result);
      } else {
        entry.reject(reviveError(raw.error));
      }
      return;
    }

    if (raw.k === 'req') {
      const handler = requestHandlers.get(raw.method);
      if (!handler) {
        void webview.postMessage({
          k: 'res',
          id: raw.id,
          ok: false,
          error: { name: 'Error', message: `Unknown method: ${raw.method}` },
        } satisfies RpcEnvelope);
        return;
      }
      const controller = new AbortController();
      inFlightHandlers.set(raw.id, controller);
      Promise.resolve()
        .then(() => handler(raw.params, { signal: controller.signal }))
        .then((result) => {
          inFlightHandlers.delete(raw.id);
          void webview.postMessage({
            k: 'res',
            id: raw.id,
            ok: true,
            result,
          } satisfies RpcEnvelope);
        })
        .catch((error: unknown) => {
          inFlightHandlers.delete(raw.id);
          void webview.postMessage({
            k: 'res',
            id: raw.id,
            ok: false,
            error: serializeError(error),
          } satisfies RpcEnvelope);
        });
      return;
    }

    if (raw.k === 'ev') {
      for (const fn of eventHandlers.get(raw.event) ?? []) {
        fn(raw.payload);
      }
      return;
    }

    // raw.k === 'cancel'
    inFlightHandlers.get(raw.id)?.abort();
    inFlightHandlers.delete(raw.id);
  });

  const rpc: WebviewRpc<S> = {
    request(method, params, options) {
      if (disposed) {
        return Promise.reject(new Error('WebviewRpc has been disposed'));
      }

      const signals: AbortSignal[] = [];
      if (options?.signal) {
        signals.push(options.signal);
      }
      if (options?.timeoutMs !== undefined) {
        signals.push(AbortSignal.timeout(options.timeoutMs));
      }
      const signal =
        signals.length === 0
          ? undefined
          : signals.length === 1
            ? signals[0]
            : AbortSignal.any(signals);

      if (signal?.aborted) {
        return Promise.reject(signal.reason ?? new Error('Aborted'));
      }

      const id = String(nextId++);
      const done = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      void webview.postMessage({
        k: 'req',
        id,
        method: String(method),
        params,
      } satisfies RpcEnvelope);

      if (!signal) {
        return done as Promise<never>;
      }

      const aborted = new Promise<never>((_resolve, reject) => {
        signal.addEventListener(
          'abort',
          () => {
            if (pending.delete(id)) {
              void webview.postMessage({ k: 'cancel', id } satisfies RpcEnvelope);
            }
            reject(signal.reason ?? new Error('Aborted'));
          },
          { once: true }
        );
      });
      return Promise.race([done, aborted]) as Promise<never>;
    },

    onRequest(method, handler) {
      const key = String(method);
      requestHandlers.set(key, handler as never);
      return {
        dispose: () => {
          requestHandlers.delete(key);
        },
      };
    },

    emit(event, payload) {
      void webview.postMessage({ k: 'ev', event: String(event), payload } satisfies RpcEnvelope);
    },

    onEvent(event, handler) {
      const key = String(event);
      const set = eventHandlers.get(key) ?? new Set();
      set.add(handler as never);
      eventHandlers.set(key, set);
      return {
        dispose: () => {
          set.delete(handler as never);
        },
      };
    },

    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      messageSub.dispose();
      for (const entry of pending.values()) {
        entry.reject(new Error('WebviewRpc has been disposed'));
      }
      pending.clear();
      requestHandlers.clear();
      eventHandlers.clear();
      for (const controller of inFlightHandlers.values()) {
        controller.abort();
      }
      inFlightHandlers.clear();
    },
  };

  return rpc;
}
