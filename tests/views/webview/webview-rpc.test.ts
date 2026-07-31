import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockWebview as createMockWebviewWith } from '../../../src/testing/index.js';
import { createWebviewRpc } from '../../../src/views/webview/rpc.js';

// Thin local re-bind so the rest of this file doesn't need a `vi` argument
// at every call site.
const createMockWebview = () => createMockWebviewWith(vi);

/** Waits a macrotask turn — enough for the RPC's internal Promise chains to settle. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type MockWebview = ReturnType<typeof createMockWebview>;

/** Reads the envelope from the nth call to `webview.postMessage`. */
function sentEnvelope(webview: MockWebview, callIndex = 0): { id: string; [key: string]: unknown } {
  return webview.postMessage.mock.calls[callIndex]![0] as { id: string; [key: string]: unknown };
}

describe('createWebviewRpc', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // request / response
  // ============================================

  describe('request/response', () => {
    it('sends a req envelope and resolves when a matching res envelope arrives', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);

      const promise = rpc.request('add', { a: 1, b: 2 });

      expect(webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ k: 'req', method: 'add', params: { a: 1, b: 2 } })
      );
      const { id } = sentEnvelope(webview);
      webview._fireMessage({ k: 'res', id, ok: true, result: 3 });

      await expect(promise).resolves.toBe(3);
    });

    it('assigns increasing ids across multiple in-flight requests', () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);

      void rpc.request('a', undefined);
      void rpc.request('b', undefined);

      const id0 = sentEnvelope(webview, 0).id;
      const id1 = sentEnvelope(webview, 1).id;
      expect(id0).not.toBe(id1);
    });

    it('rejects with a revived Error when the webview responds with ok: false', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);

      const promise = rpc.request('add', undefined);
      const { id } = sentEnvelope(webview);
      webview._fireMessage({
        k: 'res',
        id,
        ok: false,
        error: { name: 'RangeError', message: 'bad input' },
      });

      await expect(promise).rejects.toMatchObject({ name: 'RangeError', message: 'bad input' });
    });

    it('ignores a res envelope with an unknown id', () => {
      const webview = createMockWebview();
      createWebviewRpc(webview as never);

      expect(() =>
        webview._fireMessage({ k: 'res', id: 'nonexistent', ok: true, result: 'x' })
      ).not.toThrow();
    });

    it('ignores malformed or non-envelope messages without throwing', () => {
      const webview = createMockWebview();
      createWebviewRpc(webview as never);

      expect(() => webview._fireMessage(null)).not.toThrow();
      expect(() => webview._fireMessage(undefined)).not.toThrow();
      expect(() => webview._fireMessage('hello')).not.toThrow();
      expect(() => webview._fireMessage(42)).not.toThrow();
      expect(() => webview._fireMessage({})).not.toThrow();
      expect(() => webview._fireMessage({ k: 'unknown-kind' })).not.toThrow();
    });
  });

  // ============================================
  // onRequest
  // ============================================

  describe('onRequest', () => {
    it('handles a webview-initiated request and posts back the result', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      rpc.onRequest('ping', () => 'pong');

      webview._fireMessage({ k: 'req', id: '1', method: 'ping', params: undefined });
      await flush();

      expect(webview.postMessage).toHaveBeenCalledWith({
        k: 'res',
        id: '1',
        ok: true,
        result: 'pong',
      });
    });

    it('awaits an async handler before responding', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      rpc.onRequest('double', async (n) => (n as number) * 2);

      webview._fireMessage({ k: 'req', id: '1', method: 'double', params: 21 });
      await flush();

      expect(webview.postMessage).toHaveBeenCalledWith({ k: 'res', id: '1', ok: true, result: 42 });
    });

    it('responds with a serialized error envelope when the handler throws', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      rpc.onRequest('fail', () => {
        throw new Error('boom');
      });

      webview._fireMessage({ k: 'req', id: '2', method: 'fail', params: undefined });
      await flush();

      expect(webview.postMessage).toHaveBeenCalledWith({
        k: 'res',
        id: '2',
        ok: false,
        error: { name: 'Error', message: 'boom', stack: expect.any(String) },
      });
    });

    it('responds with a serialized error envelope when the handler rejects', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      rpc.onRequest('fail', async () => {
        throw new Error('async boom');
      });

      webview._fireMessage({ k: 'req', id: '2', method: 'fail', params: undefined });
      await flush();

      expect(webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ message: 'async boom' }),
        })
      );
    });

    it('responds with an "Unknown method" error when no handler is registered', () => {
      const webview = createMockWebview();
      createWebviewRpc(webview as never);

      webview._fireMessage({ k: 'req', id: '3', method: 'nope', params: undefined });

      expect(webview.postMessage).toHaveBeenCalledWith({
        k: 'res',
        id: '3',
        ok: false,
        error: { name: 'Error', message: 'Unknown method: nope' },
      });
    });

    it('unregisters the handler when its disposable is disposed', () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      const disposable = rpc.onRequest('ping', () => 'pong');

      disposable.dispose();
      webview._fireMessage({ k: 'req', id: '4', method: 'ping', params: undefined });

      expect(webview.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          ok: false,
          error: expect.objectContaining({ message: 'Unknown method: ping' }),
        })
      );
    });

    it("aborts the handler's ctx.signal when the webview sends a cancel envelope", async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      let receivedSignal: AbortSignal | undefined;
      rpc.onRequest('slow', (_params, ctx) => {
        receivedSignal = ctx.signal;
        return new Promise(() => {
          /* never settles */
        });
      });

      webview._fireMessage({ k: 'req', id: '5', method: 'slow', params: undefined });
      await flush();
      expect(receivedSignal?.aborted).toBe(false);

      webview._fireMessage({ k: 'cancel', id: '5' });

      expect(receivedSignal?.aborted).toBe(true);
    });
  });

  // ============================================
  // emit / onEvent
  // ============================================

  describe('emit/onEvent', () => {
    it('emit() posts a one-way ev envelope', () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);

      rpc.emit('theme', { kind: 'dark' });

      expect(webview.postMessage).toHaveBeenCalledWith({
        k: 'ev',
        event: 'theme',
        payload: { kind: 'dark' },
      });
    });

    it('dispatches an incoming ev envelope to every registered handler', () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      const handlerA = vi.fn();
      const handlerB = vi.fn();
      rpc.onEvent('dirty', handlerA);
      rpc.onEvent('dirty', handlerB);

      webview._fireMessage({ k: 'ev', event: 'dirty', payload: { isDirty: true } });

      expect(handlerA).toHaveBeenCalledWith({ isDirty: true });
      expect(handlerB).toHaveBeenCalledWith({ isDirty: true });
    });

    it('does not notify handlers registered for a different event', () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      const handler = vi.fn();
      rpc.onEvent('dirty', handler);

      webview._fireMessage({ k: 'ev', event: 'other', payload: {} });

      expect(handler).not.toHaveBeenCalled();
    });

    it("disposing one handler's subscription leaves other handlers for the same event intact", () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      const handlerA = vi.fn();
      const handlerB = vi.fn();
      const subA = rpc.onEvent('dirty', handlerA);
      rpc.onEvent('dirty', handlerB);

      subA.dispose();
      webview._fireMessage({ k: 'ev', event: 'dirty', payload: {} });

      expect(handlerA).not.toHaveBeenCalled();
      expect(handlerB).toHaveBeenCalled();
    });
  });

  // ============================================
  // timeout
  // ============================================

  describe('timeoutMs', () => {
    it('rejects once timeoutMs elapses without a response', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);

      const promise = rpc.request('slow', undefined, { timeoutMs: 15 });

      await expect(promise).rejects.toBeDefined();
    });

    it('sends a best-effort cancel envelope to the peer once it times out', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);

      const promise = rpc.request('slow', undefined, { timeoutMs: 15 });
      const { id } = sentEnvelope(webview);
      await expect(promise).rejects.toBeDefined();

      expect(webview.postMessage).toHaveBeenCalledWith({ k: 'cancel', id });
    });

    it('does not reject early when the response arrives before timeoutMs elapses', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);

      const promise = rpc.request('fast', undefined, { timeoutMs: 10_000 });
      const { id } = sentEnvelope(webview);
      webview._fireMessage({ k: 'res', id, ok: true, result: 'done' });

      await expect(promise).resolves.toBe('done');
    });
  });

  // ============================================
  // abort (AbortSignal)
  // ============================================

  describe('abort', () => {
    it('rejects immediately without sending a request when the signal is already aborted', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      const controller = new AbortController();
      controller.abort(new Error('already gone'));

      await expect(rpc.request('x', undefined, { signal: controller.signal })).rejects.toThrow(
        'already gone'
      );
      expect(webview.postMessage).not.toHaveBeenCalled();
    });

    it('rejects with the abort reason and sends a cancel envelope when aborted mid-flight', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      const controller = new AbortController();

      const promise = rpc.request('x', undefined, { signal: controller.signal });
      const { id } = sentEnvelope(webview);
      controller.abort(new Error('user cancelled'));

      await expect(promise).rejects.toThrow('user cancelled');
      expect(webview.postMessage).toHaveBeenCalledWith({ k: 'cancel', id });
    });

    it('does not send a cancel envelope if the response already arrived before the abort', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      const controller = new AbortController();

      const promise = rpc.request('x', undefined, { signal: controller.signal });
      const { id } = sentEnvelope(webview);
      webview._fireMessage({ k: 'res', id, ok: true, result: 'done' });
      await expect(promise).resolves.toBe('done');

      webview.postMessage.mockClear();
      controller.abort();

      expect(webview.postMessage).not.toHaveBeenCalledWith(
        expect.objectContaining({ k: 'cancel' })
      );
    });

    it('combines signal and timeoutMs, rejecting with whichever fires first', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      const controller = new AbortController();

      const promise = rpc.request('x', undefined, { signal: controller.signal, timeoutMs: 10_000 });
      controller.abort(new Error('manual abort wins'));

      await expect(promise).rejects.toThrow('manual abort wins');
    });
  });

  // ============================================
  // dispose
  // ============================================

  describe('dispose', () => {
    it('rejects every pending request', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);

      const p1 = rpc.request('a', undefined);
      const p2 = rpc.request('b', undefined);
      rpc.dispose();

      await expect(p1).rejects.toThrow(/disposed/i);
      await expect(p2).rejects.toThrow(/disposed/i);
    });

    it('aborts in-flight onRequest handler signals', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      let receivedSignal: AbortSignal | undefined;
      rpc.onRequest('slow', (_params, ctx) => {
        receivedSignal = ctx.signal;
        return new Promise(() => {
          /* never settles */
        });
      });
      webview._fireMessage({ k: 'req', id: '1', method: 'slow', params: undefined });
      await flush();

      rpc.dispose();

      expect(receivedSignal?.aborted).toBe(true);
    });

    it('unsubscribes from the webview so further messages are ignored', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      const handler = vi.fn();
      rpc.onRequest('ping', handler);

      rpc.dispose();
      webview._fireMessage({ k: 'req', id: '9', method: 'ping', params: undefined });
      await flush();

      expect(handler).not.toHaveBeenCalled();
    });

    it('rejects new requests made after disposal without posting a message', async () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);
      rpc.dispose();
      webview.postMessage.mockClear();

      await expect(rpc.request('x', undefined)).rejects.toThrow(/disposed/i);
      expect(webview.postMessage).not.toHaveBeenCalled();
    });

    it('is idempotent', () => {
      const webview = createMockWebview();
      const rpc = createWebviewRpc(webview as never);

      rpc.dispose();

      expect(() => rpc.dispose()).not.toThrow();
    });
  });
});
