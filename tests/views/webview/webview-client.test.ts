import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createMockWebview as createMockWebviewWith } from '../../../src/testing/index.js';
import { createWebviewRpc } from '../../../src/views/webview/rpc.js';
import {
  createWebviewRpcClient,
  type MessageEventLike,
  type MessageTargetLike,
  type WebviewApiLike,
} from '../../../src/views/webview/client.js';

/** Waits a macrotask turn — enough for the RPC's internal Promise chains to settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A stand-in for the webview environment: a `window`-like message target and
 * an `acquireVsCodeApi()`-like poster, both fully inspectable.
 */
function createFakeWebviewEnvironment() {
  const listeners = new Set<(event: MessageEventLike) => void>();
  const target: MessageTargetLike = {
    addEventListener: (_type, listener) => {
      listeners.add(listener);
    },
    removeEventListener: (_type, listener) => {
      listeners.delete(listener);
    },
  };
  const posted: unknown[] = [];
  const vscodeApi: WebviewApiLike = {
    postMessage: (message) => {
      posted.push(message);
    },
  };
  /** Simulates the extension host posting `data` into the webview. */
  const deliver = (data: unknown): void => {
    for (const listener of [...listeners]) {
      listener({ data });
    }
  };
  return { target, vscodeApi, posted, deliver, listeners };
}

type Env = ReturnType<typeof createFakeWebviewEnvironment>;

function sentEnvelope(env: Env, callIndex = 0): { id: string; [key: string]: unknown } {
  return env.posted[callIndex] as { id: string; [key: string]: unknown };
}

describe('createWebviewRpcClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // environment acquisition
  // ============================================

  describe('environment', () => {
    afterEach(() => {
      delete (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi;
    });

    it('calls acquireVsCodeApi() itself when no vscodeApi is passed', () => {
      const env = createFakeWebviewEnvironment();
      const acquire = vi.fn(() => env.vscodeApi);
      (globalThis as { acquireVsCodeApi?: unknown }).acquireVsCodeApi = acquire;

      const rpc = createWebviewRpcClient({ target: env.target });
      rpc.emit('ping', undefined);

      expect(acquire).toHaveBeenCalledTimes(1);
      expect(env.posted).toEqual([{ k: 'ev', event: 'ping', payload: undefined }]);
    });

    it('throws a pointed error outside a webview when no vscodeApi is passed', () => {
      const env = createFakeWebviewEnvironment();

      expect(() => createWebviewRpcClient({ target: env.target })).toThrow(/acquireVsCodeApi/);
    });
  });

  // ============================================
  // request / response
  // ============================================

  describe('request/response', () => {
    it('sends a req envelope and resolves when a matching res envelope arrives', async () => {
      const env = createFakeWebviewEnvironment();
      const rpc = createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });

      const promise = rpc.request('add', { a: 1, b: 2 });

      expect(env.posted[0]).toEqual(
        expect.objectContaining({ k: 'req', method: 'add', params: { a: 1, b: 2 } })
      );
      env.deliver({ k: 'res', id: sentEnvelope(env).id, ok: true, result: 3 });

      await expect(promise).resolves.toBe(3);
    });

    it('rejects with a revived error when the host responds with one', async () => {
      const env = createFakeWebviewEnvironment();
      const rpc = createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });

      const promise = rpc.request('explode', undefined);
      env.deliver({
        k: 'res',
        id: sentEnvelope(env).id,
        ok: false,
        error: { name: 'RangeError', message: 'boom', stack: 'RangeError: boom\n  at host' },
      });

      await expect(promise).rejects.toMatchObject({
        name: 'RangeError',
        message: 'boom',
        stack: 'RangeError: boom\n  at host',
      });
    });

    it('ignores responses for unknown ids and non-envelope messages', async () => {
      const env = createFakeWebviewEnvironment();
      const rpc = createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });

      expect(() => {
        env.deliver({ k: 'res', id: 'nonexistent', ok: true, result: 'x' });
        env.deliver(null);
        env.deliver('hello');
        env.deliver(42);
        env.deliver({});
        env.deliver({ k: 'unknown-kind' });
      }).not.toThrow();

      // The channel still works afterwards.
      const promise = rpc.request('ping', undefined);
      env.deliver({ k: 'res', id: sentEnvelope(env).id, ok: true, result: 'pong' });
      await expect(promise).resolves.toBe('pong');
    });

    it('rejects once timeoutMs elapses without a response, sending a cancel envelope', async () => {
      const env = createFakeWebviewEnvironment();
      const rpc = createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });

      const promise = rpc.request('slow', undefined, { timeoutMs: 15 });
      const { id } = sentEnvelope(env);

      await expect(promise).rejects.toBeDefined();
      expect(env.posted).toContainEqual({ k: 'cancel', id });
    });

    it('rejects immediately when the signal is already aborted, without posting', () => {
      const env = createFakeWebviewEnvironment();
      const rpc = createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });
      const controller = new AbortController();
      const reason = new Error('pre-aborted');
      controller.abort(reason);

      const promise = rpc.request('x', undefined, { signal: controller.signal });

      expect(env.posted).toEqual([]);
      return expect(promise).rejects.toBe(reason);
    });

    it('aborting mid-flight rejects locally and notifies the host', async () => {
      const env = createFakeWebviewEnvironment();
      const rpc = createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });
      const controller = new AbortController();

      const promise = rpc.request('x', undefined, { signal: controller.signal });
      const { id } = sentEnvelope(env);
      const reason = new Error('user cancelled');
      controller.abort(reason);

      await expect(promise).rejects.toBe(reason);
      expect(env.posted).toContainEqual({ k: 'cancel', id });

      // A late response for the aborted id is ignored.
      expect(() => env.deliver({ k: 'res', id, ok: true, result: 'late' })).not.toThrow();
    });
  });

  // ============================================
  // onRequest (host → webview)
  // ============================================

  describe('onRequest', () => {
    it('answers a host request with the handler result', async () => {
      const env = createFakeWebviewEnvironment();
      const rpc = createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });
      rpc.onRequest('double', (n) => (n as number) * 2);

      env.deliver({ k: 'req', id: '1', method: 'double', params: 21 });
      await flush();

      expect(env.posted).toContainEqual({ k: 'res', id: '1', ok: true, result: 42 });
    });

    it('awaits an async handler', async () => {
      const env = createFakeWebviewEnvironment();
      const rpc = createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });
      rpc.onRequest('fetch', async () => {
        await flush();
        return 'data';
      });

      env.deliver({ k: 'req', id: '1', method: 'fetch', params: undefined });
      await flush();
      await flush();

      expect(env.posted).toContainEqual({ k: 'res', id: '1', ok: true, result: 'data' });
    });

    it('serializes a thrown error back to the host', async () => {
      const env = createFakeWebviewEnvironment();
      const rpc = createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });
      rpc.onRequest('explode', () => {
        throw new RangeError('boom');
      });

      env.deliver({ k: 'req', id: '1', method: 'explode', params: undefined });
      await flush();

      expect(env.posted).toContainEqual({
        k: 'res',
        id: '1',
        ok: false,
        error: expect.objectContaining({ name: 'RangeError', message: 'boom' }),
      });
    });

    it('answers an unknown method with an error response', () => {
      const env = createFakeWebviewEnvironment();
      createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });

      env.deliver({ k: 'req', id: '1', method: 'nope', params: undefined });

      expect(env.posted).toContainEqual({
        k: 'res',
        id: '1',
        ok: false,
        error: expect.objectContaining({ message: 'Unknown method: nope' }),
      });
    });

    it("aborts the handler's ctx.signal when the host cancels", async () => {
      const env = createFakeWebviewEnvironment();
      const rpc = createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });
      let receivedSignal: AbortSignal | undefined;
      rpc.onRequest('slow', (_params, ctx) => {
        receivedSignal = ctx.signal;
        return new Promise(() => {}); // never settles
      });

      env.deliver({ k: 'req', id: '1', method: 'slow', params: undefined });
      await flush();
      expect(receivedSignal?.aborted).toBe(false);

      env.deliver({ k: 'cancel', id: '1' });

      expect(receivedSignal?.aborted).toBe(true);
    });

    it('stops answering after the registration is disposed', async () => {
      const env = createFakeWebviewEnvironment();
      const rpc = createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });
      const registration = rpc.onRequest('ping', () => 'pong');

      registration.dispose();
      env.deliver({ k: 'req', id: '1', method: 'ping', params: undefined });
      await flush();

      expect(env.posted).toContainEqual(expect.objectContaining({ k: 'res', id: '1', ok: false }));
    });
  });

  // ============================================
  // events (both directions)
  // ============================================

  describe('events', () => {
    it('emit posts an ev envelope', () => {
      const env = createFakeWebviewEnvironment();
      const rpc = createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });

      rpc.emit('dirty', { isDirty: true });

      expect(env.posted).toEqual([{ k: 'ev', event: 'dirty', payload: { isDirty: true } }]);
    });

    it('onEvent receives host events; a disposed handler stops receiving', () => {
      const env = createFakeWebviewEnvironment();
      const rpc = createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });
      const first = vi.fn();
      const second = vi.fn();
      const firstSub = rpc.onEvent('theme', first);
      rpc.onEvent('theme', second);

      env.deliver({ k: 'ev', event: 'theme', payload: { kind: 'dark' } });
      firstSub.dispose();
      env.deliver({ k: 'ev', event: 'theme', payload: { kind: 'light' } });

      expect(first.mock.calls).toEqual([[{ kind: 'dark' }]]);
      expect(second.mock.calls).toEqual([[{ kind: 'dark' }], [{ kind: 'light' }]]);
    });
  });

  // ============================================
  // dispose
  // ============================================

  describe('dispose', () => {
    it('rejects in-flight requests and unhooks the message listener', async () => {
      const env = createFakeWebviewEnvironment();
      const rpc = createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });

      const promise = rpc.request('x', undefined);
      expect(env.listeners.size).toBe(1);

      rpc.dispose();

      await expect(promise).rejects.toThrow(/disposed/);
      expect(env.listeners.size).toBe(0);
    });

    it('aborts running handlers, rejects new requests, and tolerates double dispose', async () => {
      const env = createFakeWebviewEnvironment();
      const rpc = createWebviewRpcClient({ vscodeApi: env.vscodeApi, target: env.target });
      let receivedSignal: AbortSignal | undefined;
      rpc.onRequest('slow', (_params, ctx) => {
        receivedSignal = ctx.signal;
        return new Promise(() => {});
      });
      env.deliver({ k: 'req', id: '1', method: 'slow', params: undefined });
      await flush();

      rpc.dispose();
      rpc.dispose();

      expect(receivedSignal?.aborted).toBe(true);
      await expect(rpc.request('x', undefined)).rejects.toThrow(/disposed/);
    });
  });

  // ============================================
  // Loopback: the shipped client against the shipped host
  // ============================================

  describe('loopback with createWebviewRpc', () => {
    /**
     * Wires the real host endpoint and the real client endpoint back to
     * back, exactly as a webview and its extension host are: whatever the
     * host posts arrives as a message event at the client, and whatever the
     * client posts arrives at the host's onDidReceiveMessage. This is the
     * proof that the published client actually speaks the host's protocol.
     */
    function createLoopback() {
      const webview = createMockWebviewWith(vi);
      const env = createFakeWebviewEnvironment();
      webview.postMessage.mockImplementation((message: unknown) => {
        env.deliver(message);
        return Promise.resolve(true);
      });
      const client = createWebviewRpcClient({
        vscodeApi: { postMessage: (message) => webview._fireMessage(message) },
        target: env.target,
      });
      const host = createWebviewRpc(webview as never);
      return { host, client };
    }

    it('host → client request/response round-trips', async () => {
      const { host, client } = createLoopback();
      client.onRequest('getSelection', () => ({ text: 'selected' }));

      await expect(host.request('getSelection', undefined)).resolves.toEqual({
        text: 'selected',
      });
    });

    it('client → host request/response round-trips', async () => {
      const { host, client } = createLoopback();
      host.onRequest('save', (params) => ({ ok: true, size: (params as string).length }));

      await expect(client.request('save', 'content')).resolves.toEqual({ ok: true, size: 7 });
    });

    it('errors thrown on one side arrive revived on the other', async () => {
      const { host, client } = createLoopback();
      host.onRequest('explode', () => {
        throw new RangeError('boom');
      });

      await expect(client.request('explode', undefined)).rejects.toMatchObject({
        name: 'RangeError',
        message: 'boom',
      });
    });

    it('events flow both ways', async () => {
      const { host, client } = createLoopback();
      const hostSaw = vi.fn();
      const clientSaw = vi.fn();
      host.onEvent('dirty', hostSaw);
      client.onEvent('theme', clientSaw);

      client.emit('dirty', { isDirty: true });
      host.emit('theme', { kind: 'dark' });
      await flush();

      expect(hostSaw).toHaveBeenCalledWith({ isDirty: true });
      expect(clientSaw).toHaveBeenCalledWith({ kind: 'dark' });
    });

    it("host-side abort cancels the client handler's ctx.signal across the wire", async () => {
      const { host, client } = createLoopback();
      let clientSignal: AbortSignal | undefined;
      client.onRequest('slow', (_params, ctx) => {
        clientSignal = ctx.signal;
        return new Promise(() => {});
      });
      const controller = new AbortController();

      const promise = host.request('slow', undefined, { signal: controller.signal });
      // Attach the rejection handler before aborting, or the reject fires
      // with nothing listening and Vitest reports an unhandled rejection.
      const rejection = expect(promise).rejects.toBeDefined();
      await flush();
      expect(clientSignal?.aborted).toBe(false);

      controller.abort();
      await flush();

      await rejection;
      expect(clientSignal?.aborted).toBe(true);
    });

    it("client-side abort cancels the host handler's ctx.signal across the wire", async () => {
      const { host, client } = createLoopback();
      let hostSignal: AbortSignal | undefined;
      host.onRequest('slow', (_params, ctx) => {
        hostSignal = ctx.signal;
        return new Promise(() => {});
      });
      const controller = new AbortController();

      const promise = client.request('slow', undefined, { signal: controller.signal });
      // Attach the rejection handler before aborting (see the host-side twin).
      const rejection = expect(promise).rejects.toBeDefined();
      await flush();
      expect(hostSignal?.aborted).toBe(false);

      controller.abort();
      await flush();

      await rejection;
      expect(hostSignal?.aborted).toBe(true);
    });
  });
});
