/**
 * In-memory protocol integration suite wiring the real host and browser RPC
 * endpoints back-to-back. It protects bidirectional correlation, cancellation,
 * delivery failure, error revival, disposal, listener independence, malformed
 * envelope rejection, and unhandled-rejection containment. It is not a native
 * Extension Host transport test; adapter conformance remains a separate lane.
 */
import { describe, expect, it, vi } from 'vitest';

import { createWebviewRpc } from '../../../src/capabilities/views/webview/rpc.js';
import type { WebviewLike } from '../../../src/capabilities/views/webview/rpc.js';
import { createWebviewRpcClient } from '../../../src/capabilities/webview-client/index.js';
import type {
  MessageEventLike,
  MessageTargetLike,
} from '../../../src/capabilities/webview-client/index.js';

// Node globals the repo's tsconfig deliberately omits (the runtime core must
// not reach them), declared locally for this test.
declare const process: {
  on(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
  off(event: 'unhandledRejection', listener: (reason: unknown) => void): void;
};

/**
 * Lets the loopback settle.
 *
 * Both directions hop through `queueMicrotask`, and `postMessage` returns a
 * promise, so a delivery takes an unspecified number of microtask ticks. One
 * macrotask drains all of them, which makes this exact rather than a guess at a
 * tick count — and naming it keeps the intent from reading as an arbitrary
 * sleep.
 */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A loopback pair: the host's WebviewLike delivers into the client's message
 * target, and the client's vscodeApi delivers into the host's listener —
 * the two real endpoints wired exactly as VS Code wires them.
 */
function createLoopback() {
  const hostListeners = new Set<(message: unknown) => void>();
  const clientListeners = new Set<(event: MessageEventLike) => void>();
  let deliverToClient = true;

  const hostWebview: WebviewLike = {
    postMessage(message: unknown): Promise<boolean> {
      if (!deliverToClient) {
        return Promise.resolve(false);
      }
      // Structured-clone boundary: queueMicrotask keeps ordering realistic.
      queueMicrotask(() => {
        for (const listener of [...clientListeners]) {
          listener({ data: message });
        }
      });
      return Promise.resolve(true);
    },
    onDidReceiveMessage(listener: (message: unknown) => void) {
      hostListeners.add(listener);
      return { dispose: () => hostListeners.delete(listener) };
    },
  };

  const clientTarget: MessageTargetLike = {
    addEventListener: (_type, listener) => clientListeners.add(listener),
    removeEventListener: (_type, listener) => clientListeners.delete(listener),
  };
  const clientApi = {
    postMessage(message: unknown): void {
      queueMicrotask(() => {
        for (const listener of [...hostListeners]) {
          listener(message);
        }
      });
    },
  };

  return {
    hostWebview,
    clientTarget,
    clientApi,
    stopDelivering: () => {
      deliverToClient = false;
    },
    injectToHost: (message: unknown) => {
      for (const listener of [...hostListeners]) {
        listener(message);
      }
    },
  };
}

function createPair() {
  const loop = createLoopback();
  const host = createWebviewRpc(loop.hostWebview);
  const client = createWebviewRpcClient({ vscodeApi: loop.clientApi, target: loop.clientTarget });
  return { ...loop, host, client };
}

describe('webview RPC end to end', () => {
  it('routes requests host → webview and back with typed results', async () => {
    const { host, client } = createPair();
    client.onRequest('getSelection', (params) => ({ echoed: params, text: 'hello' }));

    await expect(host.request('getSelection', { retry: 1 })).resolves.toEqual({
      echoed: { retry: 1 },
      text: 'hello',
    });
  });

  it('routes requests webview → host and back', async () => {
    const { host, client } = createPair();
    host.onRequest('save', (params) => ({ ok: true, got: params }));

    await expect(client.request('save', { content: 'abc' })).resolves.toEqual({
      ok: true,
      got: { content: 'abc' },
    });
  });

  it('delivers one-way events in both directions', async () => {
    const { host, client } = createPair();
    const hostSaw: unknown[] = [];
    const clientSaw: unknown[] = [];
    host.onEvent('dirty', (payload) => hostSaw.push(payload));
    client.onEvent('theme', (payload) => clientSaw.push(payload));

    host.emit('theme', { kind: 'dark' });
    client.emit('dirty', { isDirty: true });
    await flush();

    expect(hostSaw).toEqual([{ isDirty: true }]);
    expect(clientSaw).toEqual([{ kind: 'dark' }]);
  });

  it('rejects with a revived error carrying the peer handler failure', async () => {
    const { host, client } = createPair();
    client.onRequest('explode', () => {
      const error = new TypeError('bad payload');
      throw error;
    });

    const failure = await host.request('explode', undefined).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).name).toBe('TypeError');
    expect((failure as Error).message).toBe('bad payload');
  });

  it('rejects an unknown method', async () => {
    const { host } = createPair();
    await expect(host.request('nobodyHome', undefined)).rejects.toThrow(
      'Unknown method: nobodyHome'
    );
  });

  it('aborts the peer handler when the requester cancels', async () => {
    const { host, client } = createPair();
    const aborted = vi.fn();
    let release: () => void = () => undefined;
    client.onRequest('slow', (_params, ctx) => {
      ctx.signal.addEventListener('abort', aborted);
      return new Promise((resolve) => {
        release = () => resolve('late');
      });
    });

    const controller = new AbortController();
    const pending = host.request('slow', undefined, { signal: controller.signal });
    await flush();

    controller.abort(new Error('user cancelled'));
    await expect(pending).rejects.toThrow('user cancelled');
    await flush();
    expect(aborted).toHaveBeenCalledOnce();

    // The late resolution goes nowhere: the id was already cancelled.
    release();
    await flush();
  });

  it('rejects on timeout', async () => {
    const { host, client } = createPair();
    client.onRequest('slow', () => new Promise(() => undefined));
    await expect(host.request('slow', undefined, { timeoutMs: 5 })).rejects.toThrow();
  });

  describe('a request whose message never lands', () => {
    it('rejects the pending request when postMessage reports non-delivery', async () => {
      const { host, stopDelivering } = createPair();
      stopDelivering();
      await expect(host.request('anything', undefined)).rejects.toThrow(/not delivered/);
    });

    it('rejects the pending request when postMessage rejects', async () => {
      const failing: WebviewLike = {
        postMessage: () => Promise.reject(new Error('channel torn down')),
        onDidReceiveMessage: () => ({ dispose: () => undefined }),
      };
      const rpc = createWebviewRpc(failing);
      await expect(rpc.request('anything', undefined)).rejects.toThrow('channel torn down');
    });

    /**
     * The riskiest of the three, because it does not look asynchronous. The
     * call is evaluated as an argument to `Promise.resolve`, so a throw escapes
     * `request()` synchronously — the caller gets an exception where the
     * signature promises a promise, and the entry that was already put into
     * `pending` has nobody left to settle it, for as long as the panel lives.
     */
    it('rejects the pending request when postMessage throws synchronously', async () => {
      const throwing: WebviewLike = {
        postMessage: () => {
          throw new Error('webview is disposed');
        },
        onDidReceiveMessage: () => ({ dispose: () => undefined }),
      };
      const rpc = createWebviewRpc(throwing);

      // A rejected promise, not a thrown error.
      const pending = rpc.request('anything', undefined);
      await expect(pending).rejects.toThrow('webview is disposed');

      // And nothing is stranded: disposing afterwards has no pending entry left
      // to reject, so a second request behaves like the first.
      rpc.dispose();
      await expect(rpc.request('anything', undefined)).rejects.toThrow(/disposed/);
    });

    it('dispose rejects every pending request on both endpoints', async () => {
      const { host, client } = createPair();
      client.onRequest('never', () => new Promise(() => undefined));
      host.onRequest('never', () => new Promise(() => undefined));

      const hostPending = host.request('never', undefined);
      const clientPending = client.request('never', undefined);
      await flush();

      host.dispose();
      client.dispose();
      await expect(hostPending).rejects.toThrow(/disposed/);
      await expect(clientPending).rejects.toThrow(/disposed/);

      // Disposing twice is safe, and requesting afterwards rejects.
      host.dispose();
      await expect(host.request('never', undefined)).rejects.toThrow(/disposed/);
    });

    it('ignores a late or duplicate response', async () => {
      const { host, client, injectToHost } = createPair();
      client.onRequest('once', () => 'first');

      const result = await host.request('once', undefined);
      expect(result).toBe('first');

      // Duplicate response for the settled id: dropped, no throw.
      injectToHost({ k: 'res', id: '0', ok: true, result: 'second' });
      // A response for an id that never existed: also dropped.
      injectToHost({ k: 'res', id: '999', ok: false, error: { name: 'E', message: 'x' } });
    });

    /**
     * Registering a method twice replaces the handler, and disposing the
     * registration you just replaced is the obvious next thing to do. If the
     * disposer removed the entry regardless of who owns it, that tidy-up would
     * silently unregister the replacement — and the method would answer
     * "Unknown method" from then on.
     */
    it('disposing a replaced request handler leaves the replacement in place', async () => {
      const { host, client } = createPair();

      // Both endpoints, because they are two implementations of one contract
      // and this is precisely the kind of detail that gets fixed on one side.
      const supersededOnClient = client.onRequest('save', () => 'old');
      client.onRequest('save', () => 'new');
      supersededOnClient.dispose();

      const supersededOnHost = host.onRequest('load', () => 'old');
      host.onRequest('load', () => 'new');
      supersededOnHost.dispose();

      await expect(host.request('save', undefined)).resolves.toBe('new');
      await expect(client.request('load', undefined)).resolves.toBe('new');
    });

    it('disposing one event handler leaves the others attached', async () => {
      const { host, client } = createPair();
      const first = vi.fn();
      const second = vi.fn();
      const subscription = host.onEvent('tick', first);
      host.onEvent('tick', second);

      subscription.dispose();
      client.emit('tick', 1);
      await flush();

      expect(first).not.toHaveBeenCalled();
      expect(second).toHaveBeenCalledWith(1);
    });
  });

  it('ignores non-envelope messages without breaking the channel', async () => {
    const { host, client, injectToHost } = createPair();
    client.onRequest('getSelection', () => ({ echoed: {}, text: 'still here' }));

    // A webview shares its message channel with anything else on the page, so
    // traffic that is not ours arrives routinely and must not be treated as a
    // malformed envelope.
    injectToHost('a bare string');
    injectToHost({ some: 'object' });
    injectToHost(null);

    // The assertion that matters is not "nothing threw" — it is that the
    // channel still works afterwards. Swallowing the noise but leaving the RPC
    // state corrupted would look identical to a test that only checks for a
    // throw.
    await expect(host.request('getSelection', { retry: 0 })).resolves.toEqual({
      echoed: {},
      text: 'still here',
    });
    host.dispose();
  });

  describe('malformed envelopes from the untrusted side', () => {
    // A webview is an untrusted boundary: anything on the page can postMessage.
    // Malformed control data must be ignored before correlation maps change;
    // otherwise a request can be removed without ever being settled.
    const malformed: readonly (readonly [string, unknown])[] = [
      ['res without error', { k: 'res', id: '0', ok: false }],
      ['res with a non-object error', { k: 'res', id: '0', ok: false, error: 'boom' }],
      ['res with an error missing message', { k: 'res', id: '0', ok: false, error: { name: 'E' } }],
      ['res with a non-boolean ok', { k: 'res', id: '0', ok: 'yes' }],
      ['res without an id', { k: 'res', ok: true, result: 1 }],
      ['req without a method', { k: 'req', id: '9' }],
      ['req with a non-string id', { k: 'req', id: 9, method: 'x' }],
      ['ev without an event name', { k: 'ev', payload: 1 }],
      ['cancel without an id', { k: 'cancel' }],
      ['an unknown kind', { k: 'nonsense', id: '0' }],
    ];

    for (const [name, message] of malformed) {
      it(`ignores ${name} without throwing or dropping the request`, async () => {
        const { host, injectToHost } = createPair();
        let state = 'pending';
        const request = host.request('anything', undefined).then(
          () => (state = 'resolved'),
          () => (state = 'rejected')
        );

        expect(() => injectToHost(message)).not.toThrow();
        expect(state).toBe('pending');

        // The request is still tracked, so disposing settles it — the failure
        // mode being pinned here is a request that can never settle at all.
        host.dispose();
        await request;
        expect(state).toBe('rejected');
      });
    }

    it('still delivers a well-formed error response', async () => {
      const { host, client } = createPair();
      client.onRequest('explode', () => {
        throw new RangeError('out of range');
      });

      const failure = await host.request('explode', undefined).catch((error: unknown) => error);
      expect((failure as Error).name).toBe('RangeError');
      expect((failure as Error).message).toBe('out of range');
    });
  });

  it('does not leak a rejection when a fire-and-forget post fails', async () => {
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      let deliver: ((message: unknown) => void) | undefined;
      const failing: WebviewLike = {
        postMessage: () => Promise.reject(new Error('webview is gone')),
        onDidReceiveMessage: (listener) => {
          deliver = listener;
          return { dispose: () => undefined };
        },
      };
      const rpc = createWebviewRpc(failing);

      // Events, unknown-method responses and handler responses are all sent
      // with no caller to reject to.
      rpc.emit('tick', 1);
      deliver?.({ k: 'req', id: '1', method: 'nobody-handles-this', params: undefined });
      rpc.onRequest('handled', () => 'value');
      deliver?.({ k: 'req', id: '2', method: 'handled', params: undefined });

      await flush();
      await flush();
      expect(unhandled).toEqual([]);
      rpc.dispose();
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('requires a vscode api and a message target on the client', () => {
    expect(() =>
      createWebviewRpcClient({
        target: { addEventListener: () => 0, removeEventListener: () => 0 },
      })
    ).toThrow(/no VS Code webview API/);
  });
});
