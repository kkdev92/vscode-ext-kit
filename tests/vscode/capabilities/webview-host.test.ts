import { describe, expect, it, vi } from 'vitest';

/**
 * Stand-ins for the vscode webview surfaces: panels and views whose events a
 * test fires by hand, plus `workspace.fs` for reading a template.
 *
 * Only the adapter is exercised here. Template rendering, RPC lifetime and
 * panel ownership moved to capabilities/views/webview/host.ts, where they are
 * tested with no mock at all; what is left is the translation.
 *
 * Update this suite when the webview port/native wrapper changes: content
 * options, resource URI conversion, message/disposal wiring, provider resolve
 * or serializer restore. Browser execution, CSP enforcement and workbench
 * restoration timing require web/Extension Host coverage instead.
 */
const vscodeMock = vi.hoisted(() => {
  class Uri {
    readonly path: string;
    constructor(path: string) {
      this.path = path;
    }
    toString(): string {
      return `file://${this.path}`;
    }
    static joinPath(base: Uri, ...parts: string[]): Uri {
      return new Uri([base.path, ...parts].join('/'));
    }
  }

  class Emitter<T> {
    private readonly listeners = new Set<(event: T) => void>();
    event = (listener: (event: T) => void) => {
      this.listeners.add(listener);
      return { dispose: () => this.listeners.delete(listener) };
    };
    fire(event: T): void {
      for (const listener of [...this.listeners]) {
        listener(event);
      }
    }
  }

  function makeWebview() {
    const received = new Emitter<unknown>();
    const webview = {
      html: '',
      options: undefined as unknown,
      cspSource: 'vscode-resource:',
      onDidReceiveMessage: received.event,
      _receive: (message: unknown) => received.fire(message),
      posted: [] as unknown[],
      postMessage(message: unknown): Promise<boolean> {
        webview.posted.push(message);
        return Promise.resolve(true);
      },
      asWebviewUri: (uri: Uri) => new Uri(`/webview${uri.path}`),
    };
    return webview;
  }

  const panels: ReturnType<typeof makePanel>[] = [];
  function makePanel(viewType: string, title: string, column: unknown, options: unknown) {
    const disposeEmitter = new Emitter<void>();
    const viewStateEmitter = new Emitter<{ webviewPanel: { visible: boolean } }>();
    const panel = {
      viewType,
      title,
      column,
      options,
      visible: true,
      webview: makeWebview(),
      onDidDispose: disposeEmitter.event,
      onDidChangeViewState: viewStateEmitter.event,
      _fireDispose: () => disposeEmitter.fire(undefined),
      _fireViewState: (visible: boolean) => viewStateEmitter.fire({ webviewPanel: { visible } }),
      revealed: [] as unknown[],
      reveal(col?: unknown): void {
        panel.revealed.push(col);
      },
      disposed: false,
      dispose(): void {
        panel.disposed = true;
        disposeEmitter.fire(undefined);
      },
    };
    return panel;
  }

  const serializers = new Map<
    string,
    { deserializeWebviewPanel(panel: unknown, state: unknown): Promise<void> }
  >();
  const viewProviders = new Map<
    string,
    { provider: { resolveWebviewView(view: unknown): Promise<void> }; options: unknown }
  >();
  const files = new Map<string, string>();

  return {
    Uri,
    Emitter,
    makeWebview,
    panels,
    serializers,
    viewProviders,
    files,
    module: {
      Uri,
      ViewColumn: { One: 1, Two: 2 },
      window: {
        createWebviewPanel(viewType: string, title: string, column: unknown, options: unknown) {
          const panel = makePanel(viewType, title, column, options);
          panels.push(panel);
          return panel;
        },
        registerWebviewPanelSerializer(viewType: string, serializer: never) {
          serializers.set(viewType, serializer);
          return { dispose: () => serializers.delete(viewType) };
        },
        registerWebviewViewProvider(viewId: string, provider: never, options: unknown) {
          viewProviders.set(viewId, { provider, options });
          return { dispose: () => viewProviders.delete(viewId) };
        },
      },
      workspace: {
        fs: {
          readFile(uri: InstanceType<typeof Uri>): Promise<Uint8Array> {
            const content = files.get(uri.path);
            if (content === undefined) {
              return Promise.reject(new Error(`ENOENT: ${uri.path}`));
            }
            return Promise.resolve(new TextEncoder().encode(content));
          },
        },
      },
    },
  };
});

vi.mock('vscode', () => vscodeMock.module);

const { createVSCodeWebviewCapability } =
  await import('../../../src/vscode/capabilities/webview.js');

const extensionUri = new vscodeMock.Uri('/ext');
const capability = (): ReturnType<typeof createVSCodeWebviewCapability> =>
  createVSCodeWebviewCapability(extensionUri as never);

describe('creating a panel', () => {
  it('passes the request onto the platform call', () => {
    vscodeMock.panels.length = 0;

    capability().createPanel({
      viewType: 'sample.preview',
      title: 'Preview',
      column: 2,
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
    });

    const panel = vscodeMock.panels[0];
    expect(panel).toMatchObject({ viewType: 'sample.preview', title: 'Preview', column: 2 });
    expect(panel?.options).toMatchObject({
      enableScripts: true,
      retainContextWhenHidden: true,
      enableFindWidget: true,
    });
  });

  it('defaults the column and the resource roots', () => {
    vscodeMock.panels.length = 0;

    capability().createPanel({ viewType: 'a', title: 'A' });

    const panel = vscodeMock.panels[0];
    expect(panel?.column).toBe(1);
    // Extension-relative paths, resolved against the extension root here and
    // nowhere else — building a uri correctly is the platform's job.
    expect(
      (panel?.options as { localResourceRoots: { path: string }[] }).localResourceRoots.map(
        (uri) => uri.path
      )
    ).toEqual(['/ext/media', '/ext/dist']);
  });

  it('resolves declared resource roots against the extension', () => {
    vscodeMock.panels.length = 0;

    capability().createPanel({ viewType: 'a', title: 'A', localResourceRoots: ['assets'] });

    expect(
      (
        vscodeMock.panels[0]?.options as { localResourceRoots: { path: string }[] }
      ).localResourceRoots.map((uri) => uri.path)
    ).toEqual(['/ext/assets']);
  });

  it('omits an option the request did not state', () => {
    vscodeMock.panels.length = 0;

    capability().createPanel({ viewType: 'a', title: 'A' });

    expect('enableScripts' in (vscodeMock.panels[0]?.options as object)).toBe(false);
    expect('retainContextWhenHidden' in (vscodeMock.panels[0]?.options as object)).toBe(false);
  });
});

describe('the panel surface', () => {
  it('reads visibility off the panel when the state event fires', () => {
    vscodeMock.panels.length = 0;
    const surface = capability().createPanel({ viewType: 'a', title: 'A' });

    const seen: boolean[] = [];
    surface.onDidChangeVisibility((visible) => seen.push(visible));
    const panel = vscodeMock.panels[0];
    if (panel === undefined) {
      throw new Error('no panel');
    }
    // The native event carries no flag; the panel's own `visible` is the truth.
    panel.visible = false;
    panel._fireViewState(false);
    panel.visible = true;
    panel._fireViewState(true);

    expect(seen).toEqual([false, true]);
  });

  it('bridges html, messages, uris and reveal', async () => {
    vscodeMock.panels.length = 0;
    const surface = capability().createPanel({ viewType: 'a', title: 'A' });
    const panel = vscodeMock.panels[0];

    surface.setHtml('<p>x</p>');
    await surface.postMessage({ type: 'ping' });
    surface.reveal(2);
    const received: unknown[] = [];
    surface.onDidReceiveMessage((message) => received.push(message));
    panel?.webview._receive({ type: 'pong' });

    expect(panel?.webview.html).toBe('<p>x</p>');
    expect(panel?.webview.posted).toEqual([{ type: 'ping' }]);
    expect(panel?.revealed).toEqual([2]);
    expect(received).toEqual([{ type: 'pong' }]);
    expect(surface.asWebviewUri('media/app.js')).toBe('file:///webview/ext/media/app.js');
    expect(surface.cspSource).toBe('vscode-resource:');
  });

  it('reports the platform tearing the panel down', () => {
    vscodeMock.panels.length = 0;
    const surface = capability().createPanel({ viewType: 'a', title: 'A' });

    let closed = 0;
    surface.onDidDispose(() => {
      closed += 1;
    });
    vscodeMock.panels[0]?._fireDispose();

    expect(closed).toBe(1);
  });

  it('closes the native panel from the surface', () => {
    vscodeMock.panels.length = 0;
    const surface = capability().createPanel({ viewType: 'a', title: 'A' });

    surface.dispose();

    expect(vscodeMock.panels[0]?.disposed).toBe(true);
  });
});

describe('view providers', () => {
  it('applies the content options when the view is resolved', async () => {
    let resolved: string | undefined;
    capability().registerViewProvider(
      'sample.sidebar',
      (surface) => {
        surface.setHtml('<p>view</p>');
        resolved = 'yes';
      },
      { enableScripts: true }
    );

    const registered = vscodeMock.viewProviders.get('sample.sidebar');
    const view = { webview: vscodeMock.makeWebview() };
    await registered?.provider.resolveWebviewView(view);

    expect(resolved).toBe('yes');
    expect(view.webview.html).toBe('<p>view</p>');
    expect(view.webview.options).toMatchObject({ enableScripts: true });
  });

  it('hands a fresh surface to each resolve', async () => {
    const surfaces: unknown[] = [];
    capability().registerViewProvider(
      'sample.sidebar',
      (surface) => {
        surfaces.push(surface);
      },
      {}
    );
    const registered = vscodeMock.viewProviders.get('sample.sidebar');

    await registered?.provider.resolveWebviewView({ webview: vscodeMock.makeWebview() });
    await registered?.provider.resolveWebviewView({ webview: vscodeMock.makeWebview() });

    // VS Code resolves a view again after it is torn down and re-revealed, and
    // each incarnation is a different webview.
    expect(surfaces[0]).not.toBe(surfaces[1]);
  });

  it('passes retainContextWhenHidden through as webviewOptions', () => {
    capability().registerViewProvider('sample.sidebar', () => undefined, {
      retainContextWhenHidden: true,
    });

    expect(vscodeMock.viewProviders.get('sample.sidebar')?.options).toEqual({
      webviewOptions: { retainContextWhenHidden: true },
    });
  });

  it('unregisters on dispose', () => {
    const registration = capability().registerViewProvider('sample.sidebar', () => undefined, {});

    registration.dispose();

    expect(vscodeMock.viewProviders.has('sample.sidebar')).toBe(false);
  });
});

describe('panel restoration', () => {
  it('hands the restorer a panel surface and the saved state', async () => {
    const restored: { state: unknown }[] = [];
    capability().registerPanelSerializer('sample.preview', (surface, state) => {
      surface.setHtml('<p>restored</p>');
      restored.push({ state });
    });

    const serializer = vscodeMock.serializers.get('sample.preview');
    const webview = vscodeMock.makeWebview();
    await serializer?.deserializeWebviewPanel(
      {
        webview,
        onDidDispose: new vscodeMock.Emitter<void>().event,
        onDidChangeViewState: new vscodeMock.Emitter<unknown>().event,
        reveal: () => undefined,
        dispose: () => undefined,
        visible: true,
      },
      { scrollTop: 42 }
    );

    // Without a serializer VS Code discards the tab on reload, so this is what
    // makes a panel survive a window restart.
    expect(restored).toEqual([{ state: { scrollTop: 42 } }]);
    expect(webview.html).toBe('<p>restored</p>');
  });

  it('unregisters on dispose', () => {
    const registration = capability().registerPanelSerializer('sample.preview', () => undefined);

    registration.dispose();

    expect(vscodeMock.serializers.has('sample.preview')).toBe(false);
  });
});

describe('reading an extension file', () => {
  it('resolves the path against the extension root and decodes it', async () => {
    vscodeMock.files.set('/ext/media/panel.html', '<h1>{{title}}</h1>');

    await expect(capability().readExtensionFile('media/panel.html')).resolves.toBe(
      '<h1>{{title}}</h1>'
    );
  });

  it('rejects for a file that is not there', async () => {
    await expect(capability().readExtensionFile('media/absent.html')).rejects.toThrow(/ENOENT/);
  });
});
