/**
 * Extension-host endpoint of the webview RPC protocol.
 *
 * Public surface: {@link createWebviewRpc} turns a raw `postMessage` pair into
 * correlated requests, one-way events, timeout/cancellation, error transport,
 * and deterministic teardown. The browser endpoint in `webview-client/` uses
 * the same envelope implementation with the directions reversed.
 *
 * Managed state: pending outbound requests are keyed by generated id; inbound
 * handlers receive one `AbortController` per request. `dispose()` rejects all
 * pending callers, aborts all running handlers, and detaches the sole message
 * subscription.
 *
 * Trust boundary: envelope shape is validated before maps are mutated, but
 * method params, results, and event payloads remain `unknown` at runtime. The
 * generic schema is compile-time coordination, not validation. Validate any
 * payload that can authorize work, select a path, or reach persistence.
 *
 * Ownership: the creator owns the returned channel and must dispose it when
 * its webview incarnation ends. `ManagedWebviewPanel` wires this to native
 * panel disposal; lower-level callers must do so themselves.
 */
import { combineRequestSignals, isRpcEnvelope, reviveError, serializeError } from './protocol.js';
import type { RpcEnvelope, WebviewRpcRequestOptions, WebviewRpcSchema } from './protocol.js';

export type { WebviewRpcSchema, WebviewRpcRequestOptions } from './protocol.js';

/**
 * The structural subset of `vscode.Webview` the RPC channel needs. A real
 * webview satisfies it; a test drives a fake pair wired back-to-back.
 */
export interface WebviewLike {
  postMessage(message: unknown): Thenable<boolean>;
  onDidReceiveMessage(listener: (message: unknown) => void): { dispose(): unknown };
}

/**
 * A typed, bidirectional request/response + event channel layered over a
 * `vscode.Webview`'s raw `postMessage`/`onDidReceiveMessage`. See
 * {@link createWebviewRpc}.
 */
export interface WebviewRpc<S extends WebviewRpcSchema = WebviewRpcSchema> {
  /**
   * Sends a request to the webview and resolves with its response.
   * Rejects if the webview responds with an error, if the message could not
   * be delivered, if `options.signal` aborts, if `options.timeoutMs`
   * elapses, or if the RPC is disposed while the request is in flight.
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
   *
   * One handler is stored per method. Registering another replaces it; dispose
   * the earlier registration first, because either registration's disposer
   * removes the method entry.
   */
  onRequest<K extends keyof NonNullable<S['hostRequests']>>(
    method: K,
    handler: (
      params: NonNullable<S['hostRequests']>[K]['params'],
      ctx: { signal: AbortSignal }
    ) =>
      | NonNullable<S['hostRequests']>[K]['result']
      | Promise<NonNullable<S['hostRequests']>[K]['result']>
  ): { dispose(): void };

  /** Sends a one-way event to the webview. Does not wait for acknowledgement. */
  emit<K extends keyof NonNullable<S['hostEvents']>>(
    event: K,
    payload: NonNullable<S['hostEvents']>[K]
  ): void;

  /**
   * Subscribes to a one-way event sent by the webview. Payloads are untrusted
   * at runtime. Handlers run synchronously; an exception propagates through the
   * platform message callback and prevents later handlers for that event from
   * running, so handle expected failures inside the callback.
   */
  onEvent<K extends keyof NonNullable<S['webviewEvents']>>(
    event: K,
    handler: (payload: NonNullable<S['webviewEvents']>[K]) => void
  ): { dispose(): void };

  /**
   * Stops listening, rejects every in-flight `request`, and aborts every
   * running `onRequest` handler. Safe to call more than once. Other methods are
   * not valid after disposal; only `request` has a defined post-disposal result
   * (a rejected promise).
   */
  dispose(): void;
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
 * which keeps method names and TypeScript payload shapes aligned. It does not
 * make values crossing `postMessage` trustworthy: validate them in handlers.
 *
 * @param webview - The webview to layer the RPC channel over
 *
 * @example
 * ```typescript
 * interface MyRpcSchema extends WebviewRpcSchema {
 *   webviewRequests: { getSelection: { params: void; result: { text: string } } };
 *   hostRequests: { save: { params: { content: string }; result: { ok: boolean } } };
 *   hostEvents: { theme: { kind: 'light' | 'dark' } };
 *   webviewEvents: { dirty: { isDirty: boolean } };
 * }
 *
 * const rpc = createWebviewRpc<MyRpcSchema>(panel.webview);
 * rpc.onRequest('save', async ({ content }) => ({ ok: await writeFile(content) }));
 * rpc.onEvent('dirty', ({ isDirty }) => updateTabTitle(isDirty));
 * rpc.emit('theme', { kind: 'dark' });
 * const { text } = await rpc.request('getSelection', undefined, { timeoutMs: 5000 });
 * ```
 */
export function createWebviewRpc<S extends WebviewRpcSchema = WebviewRpcSchema>(
  webview: WebviewLike
): WebviewRpc<S> {
  /**
   * Sends a fire-and-forget envelope without leaking its rejection.
   *
   * `void webview.postMessage(...)` attaches no handler, so a webview that
   * disappears mid-flight turns every response, event and cancel into an
   * unhandled rejection. There is no caller to report to here, so failures are
   * swallowed deliberately — a dead webview cannot be told anything.
   */
  const post = (envelope: RpcEnvelope): void => {
    try {
      Promise.resolve(webview.postMessage(envelope)).then(
        () => undefined,
        () => undefined
      );
    } catch {
      // A synchronous throw from a disposed webview: same story.
    }
  };

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
      // The envelope is fully validated by now, and the outcome is computed
      // before the entry leaves the map: a request must never be dropped from
      // `pending` without being settled, or it hangs for the panel's lifetime.
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
        post({
          k: 'res',
          id: raw.id,
          ok: false,
          error: { name: 'Error', message: `Unknown method: ${raw.method}` },
        });
        return;
      }
      const controller = new AbortController();
      inFlightHandlers.set(raw.id, controller);
      Promise.resolve()
        .then(() => handler(raw.params, { signal: controller.signal }))
        .then((result) => {
          inFlightHandlers.delete(raw.id);
          post({ k: 'res', id: raw.id, ok: true, result });
        })
        .catch((error: unknown) => {
          inFlightHandlers.delete(raw.id);
          post({ k: 'res', id: raw.id, ok: false, error: serializeError(error) });
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

      const signal = combineRequestSignals(options);
      if (signal?.aborted) {
        return Promise.reject(
          signal.reason instanceof Error ? signal.reason : new Error('Aborted')
        );
      }

      const id = String(nextId++);
      const done = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      const failPending = (reason: unknown): void => {
        const entry = pending.get(id);
        if (entry) {
          pending.delete(id);
          entry.reject(reason instanceof Error ? reason : new Error(String(reason)));
        }
      };

      // An undeliverable request would otherwise hang forever: the webview
      // that was supposed to answer is gone. Every way `postMessage` can fail
      // settles the pending entry — a rejection, a resolved `false` (VS Code's
      // "the webview is destroyed"), and a synchronous throw.
      //
      // The last one needs its own catch: the call is evaluated as an argument
      // *before* `Promise.resolve` runs, so a disposed webview that throws
      // would escape this method synchronously — leaving the caller with an
      // exception instead of a rejected promise and the entry stranded in
      // `pending` for the panel's lifetime.
      try {
        Promise.resolve(
          webview.postMessage({
            k: 'req',
            id,
            method: String(method),
            params,
          } satisfies RpcEnvelope)
        ).then((delivered) => {
          if (delivered === false) {
            failPending(new Error(`Request "${String(method)}" was not delivered.`));
          }
        }, failPending);
      } catch (error) {
        failPending(error);
      }

      if (!signal) {
        return done;
      }

      let rejectAborted!: (reason: unknown) => void;
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAborted = reject;
      });
      const onAbort = (): void => {
        if (pending.delete(id)) {
          post({ k: 'cancel', id });
        }
        rejectAborted(signal.reason instanceof Error ? signal.reason : new Error('Aborted'));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      // Once the request settles (response arrived, or the RPC was disposed),
      // the abort hook has nothing left to do — detach it so a signal reused
      // across many requests doesn't collect one dead listener per request.
      const detach = (): void => {
        signal.removeEventListener('abort', onAbort);
      };
      void done.then(detach, detach);
      return Promise.race([done, aborted]);
    },

    onRequest(method, handler) {
      const key = String(method);
      // There is exactly one request handler per method, and registering again
      // replaces it. The disposer checks that the entry is still *this*
      // handler before removing it: otherwise disposing the superseded
      // registration — the natural thing to do after replacing one — would
      // silently unregister the replacement.
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
      post({ k: 'ev', event: String(event), payload });
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
