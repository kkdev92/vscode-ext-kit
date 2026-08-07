/**
 * @packageDocumentation
 * The webview-side counterpart of `createWebviewRpc`, published as
 * `@kkdev92/vscode-ext-kit/webview-client`. No `vscode` import — this module
 * is meant to be bundled into webview code, where the `vscode` module doesn't
 * exist. It is written against the same {@link WebviewRpcSchema} as the host
 * side, so the request/event contract cannot drift between the two bundles.
 *
 * The contract is static only. Incoming params/results/event payloads are
 * untrusted `message` data at runtime and must be validated before they drive
 * privileged UI or state changes.
 */
import {
  combineRequestSignals,
  isRpcEnvelope,
  reviveError,
  serializeError,
} from '../views/webview/protocol.js';
import type {
  RpcEnvelope,
  WebviewRpcRequestOptions,
  WebviewRpcSchema,
} from '../views/webview/protocol.js';

export type { WebviewRpcSchema, WebviewRpcRequestOptions } from '../views/webview/protocol.js';

// ============================================
// Environment shapes (structural — this module compiles without DOM types)
// ============================================

/**
 * The subset of `acquireVsCodeApi()`'s return value this client needs.
 * Structural on purpose: the real `WebviewApi` from `@types/vscode-webview`
 * satisfies it, and tests can pass a plain object.
 */
export interface WebviewApiLike {
  postMessage(message: unknown): void;
}

/** A `message` event as delivered to {@link MessageTargetLike} listeners. */
export interface MessageEventLike {
  data: unknown;
}

/**
 * The subset of `window` this client listens on. Structural so the module
 * needs no DOM type library and tests can drive it with a fake.
 */
export interface MessageTargetLike {
  addEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEventLike) => void): void;
}

/** Options for {@link createWebviewRpcClient}. */
export interface WebviewRpcClientOptions {
  /**
   * The object returned by `acquireVsCodeApi()`.
   *
   * **Pass this whenever your webview already calls `acquireVsCodeApi()`
   * itself** (for `getState`/`setState`, say): VS Code allows exactly one
   * call per session, and a second one throws. When omitted, the client
   * calls it for you.
   */
  vscodeApi?: WebviewApiLike;
  /**
   * Where `message` events arrive. Defaults to `globalThis` (the webview's
   * `window`); tests substitute a fake.
   */
  target?: MessageTargetLike;
}

// ============================================
// Client interface
// ============================================

/**
 * A handle returned by the client's `onRequest`/`onEvent`. Shaped like
 * `vscode.Disposable` without importing it — this module must not depend on
 * `vscode`.
 */
export interface ClientDisposable {
  dispose(): void;
}

/**
 * The webview-side RPC endpoint. The mirror image of the host's
 * `WebviewRpc`: this side *sends* `hostRequests`/`webviewEvents` and
 * *handles* `webviewRequests`/`hostEvents`.
 */
export interface WebviewRpcClient<
  S extends WebviewRpcSchema = WebviewRpcSchema,
> extends ClientDisposable {
  /**
   * Sends a request to the extension host and resolves with its response.
   * Rejects if the host responds with an error, if `options.signal` aborts,
   * if `options.timeoutMs` elapses, or if the client is disposed while the
   * request is in flight.
   */
  request<K extends keyof NonNullable<S['hostRequests']>>(
    method: K,
    params: NonNullable<S['hostRequests']>[K]['params'],
    options?: WebviewRpcRequestOptions
  ): Promise<NonNullable<S['hostRequests']>[K]['result']>;

  /**
   * Registers the handler for a request the host may send. The handler's
   * `ctx.signal` aborts if the host cancels the request (or the client is
   * disposed) before the handler settles.
   *
   * One handler is stored per method. Registering another replaces it; dispose
   * the earlier registration first, because either registration's disposer
   * removes the method entry.
   */
  onRequest<K extends keyof NonNullable<S['webviewRequests']>>(
    method: K,
    handler: (
      params: NonNullable<S['webviewRequests']>[K]['params'],
      ctx: { signal: AbortSignal }
    ) =>
      | NonNullable<S['webviewRequests']>[K]['result']
      | Promise<NonNullable<S['webviewRequests']>[K]['result']>
  ): ClientDisposable;

  /** Sends a one-way event to the extension host. Does not wait for acknowledgement. */
  emit<K extends keyof NonNullable<S['webviewEvents']>>(
    event: K,
    payload: NonNullable<S['webviewEvents']>[K]
  ): void;

  /**
   * Subscribes to a one-way event sent by the extension host. Handlers run
   * synchronously; contain expected failures so one handler cannot interrupt
   * the remaining listeners for that event.
   */
  onEvent<K extends keyof NonNullable<S['hostEvents']>>(
    event: K,
    handler: (payload: NonNullable<S['hostEvents']>[K]) => void
  ): ClientDisposable;

  /**
   * Stops listening, rejects every in-flight `request`, and aborts every
   * running `onRequest` handler. Other methods are not valid after disposal;
   * only `request` has a defined post-disposal result (a rejected promise).
   */
  dispose(): void;
}

// ============================================
// createWebviewRpcClient
// ============================================

function defaultVsCodeApi(): WebviewApiLike | undefined {
  const acquire = (globalThis as { acquireVsCodeApi?: () => WebviewApiLike }).acquireVsCodeApi;
  return typeof acquire === 'function' ? acquire() : undefined;
}

function defaultTarget(): MessageTargetLike | undefined {
  const candidate = globalThis as Partial<MessageTargetLike>;
  return typeof candidate.addEventListener === 'function' &&
    typeof candidate.removeEventListener === 'function'
    ? (candidate as MessageTargetLike)
    : undefined;
}

/**
 * Creates the webview-side endpoint of a `createWebviewRpc` channel — the
 * import that replaces the hand-copied `postMessage` plumbing a webview
 * bundle otherwise needs.
 *
 * Wire-compatible with the extension host side by construction: both are
 * built on the same `protocol.ts`, and the direction conventions of
 * {@link WebviewRpcSchema} apply symmetrically (this side *sends*
 * `hostRequests` and *answers* `webviewRequests`).
 *
 * @param options - Pass `vscodeApi` if your code already called
 *   `acquireVsCodeApi()` (VS Code permits only one call); `target` is for
 *   tests
 *
 * @example
 * ```typescript
 * import { createWebviewRpcClient } from '@kkdev92/vscode-ext-kit/webview-client';
 * import type { MyRpcSchema } from '../../shared/rpc-schema.js';
 *
 * const vscodeApi = acquireVsCodeApi(); // you keep it for getState/setState
 * const rpc = createWebviewRpcClient<MyRpcSchema>({ vscodeApi });
 *
 * rpc.onRequest('getSelection', () => ({ text: document.getSelection()?.toString() ?? '' }));
 * rpc.onEvent('theme', ({ kind }) => applyTheme(kind));
 *
 * const { ok } = await rpc.request('save', { content: editor.value }, { timeoutMs: 5000 });
 * rpc.emit('dirty', { isDirty: false });
 * ```
 */
export function createWebviewRpcClient<S extends WebviewRpcSchema = WebviewRpcSchema>(
  options: WebviewRpcClientOptions = {}
): WebviewRpcClient<S> {
  const vscodeApi = options.vscodeApi ?? defaultVsCodeApi();
  if (!vscodeApi) {
    throw new Error(
      'createWebviewRpcClient: no VS Code webview API. Pass options.vscodeApi ' +
        '(the value your code got from acquireVsCodeApi()) or run inside a VS Code webview.'
    );
  }
  const target = options.target ?? defaultTarget();
  if (!target) {
    throw new Error(
      'createWebviewRpcClient: no message target. Pass options.target or run in an ' +
        'environment where globalThis dispatches "message" events (a VS Code webview does).'
    );
  }

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

  const onMessage = (event: MessageEventLike): void => {
    const raw = event.data;
    if (!isRpcEnvelope(raw)) {
      return;
    }

    if (raw.k === 'res') {
      const entry = pending.get(raw.id);
      if (!entry) {
        return; // Already timed out / aborted / disposed — safe to ignore.
      }
      // Mirrors the host: the envelope is fully validated, and the outcome is
      // computed before the entry leaves the map, so a request is never
      // dropped from `pending` unsettled.
      const settle = raw.ok
        ? (): void => {
            entry.resolve(raw.result);
          }
        : ((error: Error) => (): void => {
            entry.reject(error);
          })(reviveError(raw.error));
      pending.delete(raw.id);
      settle();
      return;
    }

    if (raw.k === 'req') {
      const handler = requestHandlers.get(raw.method);
      if (!handler) {
        vscodeApi.postMessage({
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
          vscodeApi.postMessage({ k: 'res', id: raw.id, ok: true, result } satisfies RpcEnvelope);
        })
        .catch((error: unknown) => {
          inFlightHandlers.delete(raw.id);
          vscodeApi.postMessage({
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
  };

  target.addEventListener('message', onMessage);

  return {
    request(method, params, requestOptions) {
      if (disposed) {
        return Promise.reject(new Error('WebviewRpcClient has been disposed'));
      }

      const signal = combineRequestSignals(requestOptions);
      if (signal?.aborted) {
        return Promise.reject(
          signal.reason instanceof Error ? signal.reason : new Error('Aborted')
        );
      }

      const id = String(nextId++);
      const done = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      vscodeApi.postMessage({ k: 'req', id, method: String(method), params } satisfies RpcEnvelope);

      if (!signal) {
        return done;
      }

      let rejectAborted!: (reason: unknown) => void;
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAborted = reject;
      });
      const onAbort = (): void => {
        if (pending.delete(id)) {
          vscodeApi.postMessage({ k: 'cancel', id } satisfies RpcEnvelope);
        }
        rejectAborted(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      // Once the request settles (response arrived, or the client was
      // disposed), the abort hook has nothing left to do — detach it so a
      // signal reused across many requests doesn't collect one dead listener
      // per request.
      const detach = (): void => signal.removeEventListener('abort', onAbort);
      void done.then(detach, detach);
      return Promise.race([done, aborted]);
    },

    onRequest(method, handler) {
      const key = String(method);
      // One handler per method, matching the host endpoint. Registering again
      // replaces it, and the disposer checks the entry is still *this* handler
      // before removing it — otherwise disposing the superseded registration,
      // the natural thing to do after replacing one, would silently unregister
      // the replacement.
      requestHandlers.set(key, handler);
      return {
        dispose: () => {
          if (requestHandlers.get(key) === handler) {
            requestHandlers.delete(key);
          }
        },
      };
    },

    emit(event, payload) {
      vscodeApi.postMessage({ k: 'ev', event: String(event), payload } satisfies RpcEnvelope);
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
      target.removeEventListener('message', onMessage);
      for (const entry of pending.values()) {
        entry.reject(new Error('WebviewRpcClient has been disposed'));
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
}
