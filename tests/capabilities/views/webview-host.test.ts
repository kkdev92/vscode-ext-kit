/**
 * Unit/lifecycle suite for managed webview panels over the fake webview port.
 * It protects request forwarding, raw messaging, template escaping/URI
 * rewriting, visibility, RPC closure on native disposal, and service-owned
 * panel shutdown. Protocol correlation itself belongs in the RPC loopback
 * suite.
 */
import { describe, expect, it } from 'vitest';

import { createWebviewService } from '../../../src/capabilities/views/webview/host.js';
import { createFakeWebviews } from '../../../src/testing/fakes/fake-webview.js';

describe('opening a panel', () => {
  it('passes the request through and renders HTML', () => {
    const capability = createFakeWebviews();
    const panel = createWebviewService(capability).openPanel({
      viewType: 'sample.preview',
      title: 'Preview',
      enableScripts: true,
    });

    panel.setHtml('<h1>hi</h1>');

    expect(capability.panels[0]?.request).toMatchObject({
      viewType: 'sample.preview',
      title: 'Preview',
      enableScripts: true,
    });
    expect(capability.panels[0]?.html).toBe('<h1>hi</h1>');
  });

  it('carries raw messages both ways', async () => {
    const capability = createFakeWebviews();
    const panel = createWebviewService(capability).openPanel({
      viewType: 'sample.preview',
      title: 'Preview',
    });

    const received: unknown[] = [];
    panel.onMessage((message) => received.push(message));
    await panel.post({ type: 'ping' });
    capability.panels[0]?._receive({ type: 'pong' });

    expect(capability.panels[0]?.posted).toEqual([{ type: 'ping' }]);
    expect(received).toEqual([{ type: 'pong' }]);
  });

  it('reports visibility changes', () => {
    const capability = createFakeWebviews();
    const panel = createWebviewService(capability).openPanel({
      viewType: 'sample.preview',
      title: 'Preview',
    });

    const seen: boolean[] = [];
    panel.onDidChangeVisibility((visible) => seen.push(visible));
    capability.panels[0]?._setVisible(false);
    capability.panels[0]?._setVisible(true);

    expect(seen).toEqual([false, true]);
  });
});

describe('rendering a template', () => {
  const service = (): {
    capability: ReturnType<typeof createFakeWebviews>;
    open: () => ReturnType<ReturnType<typeof createWebviewService>['openPanel']>;
  } => {
    const capability = createFakeWebviews();
    const webviews = createWebviewService(capability);
    return {
      capability,
      open: () => webviews.openPanel({ viewType: 'sample.preview', title: 'Preview' }),
    };
  };

  it('escapes a value by default', async () => {
    const { capability, open } = service();
    capability._addFile('media/panel.html', '<title>{{title}}</title>');

    await open().setHtmlFromTemplate('media/panel.html', { title: '<script>x</script>' });

    expect(capability.panels[0]?.html).toBe('<title>&lt;script&gt;x&lt;/script&gt;</title>');
  });

  it('leaves a raw: value alone', async () => {
    const { capability, open } = service();
    capability._addFile('media/panel.html', '<body>{{raw:markup}}</body>');

    await open().setHtmlFromTemplate('media/panel.html', { markup: '<b>bold</b>' });

    expect(capability.panels[0]?.html).toBe('<body><b>bold</b></body>');
  });

  it('rewrites a webviewUri placeholder', async () => {
    const { capability, open } = service();
    capability._addFile('media/panel.html', '<script src="{{webviewUri:media/app.js}}">');

    await open().setHtmlFromTemplate('media/panel.html');

    expect(capability.panels[0]?.html).toBe('<script src="vscode-webview://fake/media/app.js">');
  });

  it('leaves an unknown placeholder in place rather than blanking it', async () => {
    const { capability, open } = service();
    capability._addFile('media/panel.html', '<p>{{missing}}</p>');

    await open().setHtmlFromTemplate('media/panel.html', {});

    // A silently emptied placeholder is much harder to notice than a visible one.
    expect(capability.panels[0]?.html).toBe('<p>{{missing}}</p>');
  });

  it('does not expand a placeholder that came from a value', async () => {
    const { capability, open } = service();
    capability._addFile('media/panel.html', '{{first}}|{{second}}');

    await open().setHtmlFromTemplate('media/panel.html', {
      first: '{{second}}',
      second: 'expanded',
    });

    // Transitive expansion would be order-dependent across the variable object
    // *and* an injection vector, so substitution is a single pass.
    expect(capability.panels[0]?.html).toBe('{{second}}|expanded');
  });

  it('reports a missing template rather than rendering nothing', async () => {
    const { open } = service();

    await expect(open().setHtmlFromTemplate('media/absent.html')).rejects.toThrow(
      /No such extension file/
    );
  });
});

describe('lifetime', () => {
  it('rejects pending RPC requests when the user closes the tab', async () => {
    const capability = createFakeWebviews();
    const panel = createWebviewService(capability).openPanel({
      viewType: 'sample.preview',
      title: 'Preview',
    });

    const pending = panel.rpc.request('slow', undefined);
    capability.panels[0]?._close();

    // Without this the request hangs forever: nobody called `dispose()`, the
    // platform simply tore the panel down.
    await expect(pending).rejects.toThrow();
  });

  it('closes panels still open when the service is disposed', () => {
    const capability = createFakeWebviews();
    const webviews = createWebviewService(capability);
    webviews.openPanel({ viewType: 'a', title: 'A' });
    webviews.openPanel({ viewType: 'b', title: 'B' });

    webviews.dispose();

    // The container disposes the service at shutdown, so this is what stops a
    // panel outliving the extension that opened it.
    expect(capability.panels.map((panel) => panel.disposed)).toEqual([true, true]);
  });

  it('does not reopen a panel the user already closed', () => {
    const capability = createFakeWebviews();
    const webviews = createWebviewService(capability);
    const panel = webviews.openPanel({ viewType: 'a', title: 'A' });

    capability.panels[0]?._close();
    webviews.dispose();

    expect(capability.panels).toHaveLength(1);
    expect(panel).toBeDefined();
  });

  it('closes a panel from its own handle', () => {
    const capability = createFakeWebviews();
    const panel = createWebviewService(capability).openPanel({ viewType: 'a', title: 'A' });

    panel.dispose();

    expect(capability.panels[0]?.disposed).toBe(true);
  });
});
