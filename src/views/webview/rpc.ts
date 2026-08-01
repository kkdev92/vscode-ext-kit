import * as vscode from 'vscode';
import {
  isRpcEnvelope,
  serializeError,
  reviveError,
  combineAbortSignals,
  type RpcEnvelope,
  type WebviewRpcSchema,
  type WebviewRpcRequestOptions,
} from './protocol.js';

// The schema and request-option types live in `protocol.ts` (shared,
// vscode-free) so the webview-side client can be written against the same
// contract; re-exported here so the extension-host import path is unchanged.
export type { WebviewRpcSchema, WebviewRpcRequestOptions } from './protocol.js';

// ============================================
// createWebviewRpc
// ============================================

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
 * The webview-side counterpart ships as
 * `@kkdev92/vscode-ext-kit/webview-client` — vscode-free, so it bundles into
 * webview code — and is written against the same {@link WebviewRpcSchema},
 * which is what keeps the two sides from drifting. If you'd rather not
 * bundle anything, the wire contract lives in `protocol.ts` and is small
 * enough to implement by hand.
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
 * ```typescript
 * // Webview side (bundled into your webview code):
 * import { createWebviewRpcClient } from '@kkdev92/vscode-ext-kit/webview-client';
 *
 * const rpc = createWebviewRpcClient<MyRpcSchema>({ vscodeApi: acquireVsCodeApi() });
 *
 * rpc.onRequest('getSelection', () => ({ text: window.getSelection()?.toString() ?? '' }));
 * rpc.onEvent('theme', ({ kind }) => document.body.dataset.theme = kind);
 * rpc.emit('dirty', { isDirty: true });
 *
 * const { ok } = await rpc.request('save', { content: editor.value });
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

      const signal = combineAbortSignals(options);
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
