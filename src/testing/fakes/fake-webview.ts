/**
 * In-memory extension-host side of the webview port.
 *
 * It records HTML, bidirectional messages, provider/serializer registration and
 * panel lifetime. It does not execute HTML/JavaScript, enforce CSP, rewrite
 * browser URLs, isolate origins, persist browser state or reproduce workbench
 * restoration scheduling. Use it to test host logic and RPC; use browser/
 * Extension Host tests for the webview environment itself.
 */
import { createEmitter } from '../../foundation/internal/emitter.js';
import type {
  PlatformRegistration,
  WebviewCapability,
  WebviewPanelRequest,
  WebviewPanelSurface,
  WebviewSurface,
  WebviewViewRequest,
  WebviewViewSurface,
} from '../../foundation/platform/ports.js';

/** One panel the fake opened. */
export interface FakeWebviewPanel {
  readonly request: WebviewPanelRequest;
  /** The HTML currently rendered. */
  readonly html: string;
  /** Every message the extension sent, in order. */
  readonly posted: readonly unknown[];
  /** Whether the panel is still open. */
  readonly disposed: boolean;
  /** Simulates the content posting a message back. */
  _receive(message: unknown): void;
  /** Simulates the user closing the tab. */
  _close(): void;
  /** Simulates the panel being shown or hidden. */
  _setVisible(visible: boolean): void;
}

/** One view provider the fake registered. */
export interface FakeWebviewView {
  readonly id: string;
  readonly options: WebviewViewRequest;
  readonly html: string;
  readonly posted: readonly unknown[];
  readonly registered: boolean;
  /** Whether an incarnation is currently on screen. */
  readonly visible: boolean;
  /** How many times the provider has been asked to fill the view in. */
  readonly resolveCount: number;
  /**
   * Simulates the user revealing the view, which is when VS Code asks the
   * provider to fill it in. Resolves once the provider has. Revealing a view
   * that is already visible does nothing.
   */
  _reveal(): Promise<void>;
  /**
   * Simulates the user hiding the view, which destroys the current incarnation
   * — the next `_reveal()` resolves a fresh one, as VS Code does.
   */
  _hide(): void;
  /** Simulates the content posting a message back. Ignored while hidden. */
  _receive(message: unknown): void;
}

/** One panel restorer the fake registered. */
export interface FakeWebviewSerializer {
  readonly viewType: string;
  readonly registered: boolean;
  /**
   * Simulates VS Code restoring a panel of this kind after a window reload,
   * with whatever the content had saved. Resolves with the restored panel.
   */
  _restore(state: unknown): Promise<FakeWebviewPanel>;
}

/** In-memory webview capability for tests. */
export interface FakeWebviews extends WebviewCapability {
  /** Every panel opened, in order, including closed ones. */
  readonly panels: readonly FakeWebviewPanel[];
  /** Every view provider registered, in order. */
  readonly views: readonly FakeWebviewView[];
  /** Every panel restorer registered, in order. */
  readonly serializers: readonly FakeWebviewSerializer[];
  /** Adds a file the extension can read as a template. */
  _addFile(path: string, contents: string): void;
}

/**
 * Creates a fake webview capability.
 *
 * Content is not rendered—there is no browser here—but everything the
 * extension side does is observable: the HTML it set, the messages it sent, and
 * whether it cleaned up. Messages travel both ways, so a typed RPC channel can
 * be driven end to end against the extension-host side of the port. This does
 * not validate the browser client's acquisition of the VS Code API.
 *
 * @example
 * ```ts
 * const webviews = createFakeWebviews();
 * webviews._addFile('media/panel.html', '<html>{{title}}</html>');
 * ```
 */
export function createFakeWebviews(): FakeWebviews {
  const panels: (FakeWebviewPanel & { html: string; disposed: boolean })[] = [];
  const views: (FakeWebviewView & { html: string; registered: boolean })[] = [];
  const files = new Map<string, string>();
  const serializers: (FakeWebviewSerializer & { registered: boolean })[] = [];

  /** Builds the shared host-side surface: HTML assignment, messages and URI text. */
  const makeSurface = (
    onHtml: (html: string) => void,
    posted: unknown[]
    // `this: void` on `receive`: it is destructured out of this object, and the
    // linter is right that a plain method signature would leave the receiver
    // ambiguous at the call site.
  ): { surface: WebviewSurface; receive(this: void, message: unknown): void } => {
    const incoming = createEmitter<unknown>();
    return {
      surface: {
        postMessage(message: unknown): Promise<boolean> {
          posted.push(message);
          return Promise.resolve(true);
        },
        onDidReceiveMessage: (listener) => incoming.event(listener),
        setHtml: onHtml,
        cspSource: 'vscode-webview://fake',
        // Shaped like the real thing so a template's rewritten uris are
        // recognisable in an assertion.
        asWebviewUri: (path) => `vscode-webview://fake/${path}`,
      },
      receive: (message) => {
        incoming.fire(message);
      },
    };
  };

  const createPanel = (request: WebviewPanelRequest): WebviewPanelSurface => {
    {
      const posted: unknown[] = [];
      const visibility = createEmitter<boolean>();
      const closed = createEmitter<void>();

      const entry = {
        request,
        html: '',
        posted,
        disposed: false,
        _receive: (message: unknown) => {
          receive(message);
        },
        _close: () => {
          close();
        },
        _setVisible: (visible: boolean) => {
          visibility.fire(visible);
        },
      };

      const { surface, receive } = makeSurface((html) => {
        entry.html = html;
      }, posted);

      const close = (): void => {
        if (entry.disposed) {
          return;
        }
        entry.disposed = true;
        closed.fire();
      };

      panels.push(entry);

      return {
        ...surface,
        reveal: () => undefined,
        onDidChangeVisibility: (listener) => visibility.event(listener),
        onDidDispose: (listener) => closed.event(() => listener()),
        dispose: close,
      };
    }
  };

  return {
    createPanel,

    registerViewProvider(
      viewId: string,
      resolveView: (surface: WebviewViewSurface) => void | Promise<void>,
      options: WebviewViewRequest
    ): PlatformRegistration {
      const posted: unknown[] = [];
      // One incarnation at a time, as VS Code does it: revealing a hidden view
      // builds a new webview rather than waking the old one. Reusing a single
      // surface here would let a host leak — an undisposed channel per reveal —
      // pass every test, which is exactly the class of fake that agrees with
      // the code by construction.
      let current: { dispose(): void; receive(message: unknown): void } | undefined;

      const entry = {
        id: viewId,
        options,
        html: '',
        posted,
        registered: true,
        get resolveCount(): number {
          return resolveCount;
        },
        get visible(): boolean {
          return current !== undefined;
        },
        _reveal: async (): Promise<void> => {
          if (current !== undefined) {
            return;
          }
          resolveCount += 1;
          const closed = createEmitter<void>();
          const { surface, receive } = makeSurface((html) => {
            entry.html = html;
          }, posted);
          current = {
            dispose: () => {
              closed.fire();
              closed.dispose();
            },
            receive,
          };
          await resolveView({
            ...surface,
            onDidDispose: (listener) => closed.event(() => listener()),
          });
        },
        _hide: () => {
          const incarnation = current;
          current = undefined;
          incarnation?.dispose();
        },
        _receive: (message: unknown) => {
          current?.receive(message);
        },
      };

      let resolveCount = 0;

      views.push(entry);

      return {
        dispose(): void {
          entry.registered = false;
        },
      };
    },

    registerPanelSerializer(
      viewType: string,
      restore: (surface: WebviewPanelSurface, state: unknown) => void | Promise<void>
    ): PlatformRegistration {
      const entry = {
        viewType,
        registered: true,
        _restore: async (state: unknown): Promise<FakeWebviewPanel> => {
          // A restored panel is a panel: the same recording surface, so a test
          // can assert on the HTML the restorer set exactly as for a fresh one.
          const surface = createPanel({ viewType, title: viewType });
          await restore(surface, state);
          const opened = panels[panels.length - 1];
          if (opened === undefined) {
            throw new Error('restoring did not open a panel');
          }
          return opened;
        },
      };
      serializers.push(entry);
      return {
        dispose(): void {
          entry.registered = false;
        },
      };
    },

    readExtensionFile(extensionRelativePath: string): Promise<string> {
      const contents = files.get(extensionRelativePath);
      if (contents === undefined) {
        // The real capability rejects for a missing file, and a template path
        // typo is worth failing loudly rather than rendering an empty panel.
        return Promise.reject(new Error(`No such extension file: ${extensionRelativePath}`));
      }
      return Promise.resolve(contents);
    },

    panels,
    views,
    serializers,

    _addFile(path: string, contents: string): void {
      files.set(path, contents);
    },
  };
}
