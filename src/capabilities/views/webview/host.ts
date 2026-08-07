/**
 * Managed webview content above the platform's panel/view surfaces.
 *
 * Public surface: {@link WebviewService} opens editor-tab panels;
 * {@link ManagedWebview} adds HTML templates, URI rewriting, raw messaging,
 * and typed RPC to any host surface. Module-declared views and panel restorers
 * receive the same managed shape from the application host.
 *
 * Adapter boundary: `WebviewCapability` alone creates panels, reads packaged
 * files, and rewrites extension-relative paths. This module owns the portable
 * template/RPC behavior and contains no `vscode` import.
 *
 * Ownership: the service tracks every panel it opens and closes remaining
 * panels when the container disposes it. A panel's native dispose event closes
 * its RPC channel, including when the user closes the tab. Module-declared
 * view/provider registrations are owned by their module; consumers receive no
 * native handle to dispose.
 *
 * Trust boundary: webview messages and saved restoration state are untrusted
 * runtime input. RPC schemas provide TypeScript agreement only; handlers must
 * validate security-sensitive payloads. Template values are escaped unless a
 * caller explicitly selects `raw:`.
 */
import type {
  PlatformRegistration,
  WebviewCapability,
  WebviewPanelRequest,
  WebviewPanelSurface,
  WebviewSurface,
} from '../../../foundation/platform/ports.js';
import { serviceToken } from '../../../foundation/services/token.js';
import type { ServiceToken } from '../../../foundation/services/token.js';
import { escapeHtml } from './html.js';
import { createWebviewRpc } from './rpc.js';
import type { WebviewRpc, WebviewRpcSchema } from './rpc.js';

/**
 * A webview the framework manages: HTML, a typed RPC channel, and cleanup that
 * happens once however the content goes away.
 */
export interface ManagedWebview<S extends WebviewRpcSchema = WebviewRpcSchema> {
  /**
   * Replaces the rendered HTML. The caller owns the complete document and its
   * CSP; this method performs no sanitization.
   */
  setHtml(html: string): void;

  /**
   * Renders a template file shipped with the extension.
   *
   * Placeholders:
   * - `{{name}}` — the value, HTML-escaped
   * - `{{raw:name}}` — the value verbatim, which is an injection vector unless
   *   you produced the value yourself
   * - `{{webviewUri:media/app.js}}` — a uri the content may actually load
   *
   * @example
   * ```ts
   * await panel.setHtmlFromTemplate('media/editor.html', {
   *   title: 'Editor',
   *   cspSource: panel.cspSource,
   * });
   * ```
   */
  setHtmlFromTemplate(
    templatePath: string,
    variables?: Readonly<Record<string, string>>
  ): Promise<void>;

  /**
   * Sends a raw message accepted by the platform's webview serialization
   * boundary. For request/response, use {@link ManagedWebview.rpc}. Resolves
   * false when the platform reports that the content is no longer live.
   */
  post(message: unknown): Promise<boolean>;

  /**
   * Subscribes to raw, untrusted messages from the page. The caller owns the
   * returned registration. For request/response, prefer
   * {@link ManagedWebview.rpc}.
   */
  onMessage(listener: (message: unknown) => void): PlatformRegistration;

  /** Rewrites an extension-relative path into a uri the content may load. */
  asWebviewUri(extensionRelativePath: string): string;

  /** The source a content security policy has to allow. */
  readonly cspSource: string;

  /**
   * Typed request/response and events over the raw message channel. Types do
   * not perform runtime payload validation at the webview boundary.
   */
  readonly rpc: WebviewRpc<S>;
}

/** A managed webview living in its own editor tab. */
export interface ManagedWebviewPanel<
  S extends WebviewRpcSchema = WebviewRpcSchema,
> extends ManagedWebview<S> {
  /** Brings the panel to the front. */
  reveal(column?: number): void;
  /** Fires when the panel is shown or hidden. */
  onDidChangeVisibility(listener: (visible: boolean) => void): PlatformRegistration;
  /** Fires when the panel goes away, including when the user closes the tab. */
  onDidDispose(listener: () => void): PlatformRegistration;
  /** Closes the panel. */
  dispose(): void;
}

/** Opening webview panels. */
export interface WebviewService {
  /**
   * Opens a panel.
   *
   * The application owns it: a panel still open when the extension stops is
   * closed with everything else, so nothing is parked on
   * `context.subscriptions` and nothing outlives the host.
   *
   * @example
   * ```ts
   * module.commands.handle(OpenPreview, {
   *   inject: { webviews: Webviews },
   *   execute: async (_context, _args, { webviews }) => {
   *     const panel = webviews.openPanel({ viewType: 'sample.preview', title: 'Preview' });
   *     await panel.setHtmlFromTemplate('media/preview.html');
   *   },
   * });
   * ```
   */
  openPanel<S extends WebviewRpcSchema = WebviewRpcSchema>(
    request: WebviewPanelRequest
  ): ManagedWebviewPanel<S>;
}

/** Injects the application's {@link WebviewService}. */
export const Webviews: ServiceToken<WebviewService> =
  serviceToken<WebviewService>('framework.webviews');

/** Matches `{{webviewUri:path}}`. */
const WEBVIEW_URI = /\{\{webviewUri:([^}]+)\}\}/g;
/** Matches `{{name}}` and `{{raw:name}}`. */
const PLACEHOLDER = /\{\{(raw:)?([^}]+)\}\}/g;

/**
 * Fills a template's placeholders.
 *
 * Values are substituted in a single pass, so a value that happens to contain
 * `{{...}}` is never expanded in turn — transitive expansion would be both
 * order-dependent and an injection vector.
 */
function renderTemplate(
  template: string,
  variables: Readonly<Record<string, string>>,
  toWebviewUri: (path: string) => string
): string {
  const withUris = template.replace(WEBVIEW_URI, (_whole, path: string) =>
    toWebviewUri(path.trim())
  );
  return withUris.replace(PLACEHOLDER, (whole, raw: string | undefined, key: string) => {
    const value = variables[key.trim()];
    if (value === undefined) {
      return whole;
    }
    return raw === undefined ? escapeHtml(value) : value;
  });
}

/**
 * Wraps a platform surface with the RPC channel and template rendering.
 *
 * `disposeOnce` is shared by the caller's `dispose()` and by the platform's own
 * teardown, because a user closing a tab fires the native event without anyone
 * calling `dispose()` — and if the RPC channel is not closed on that path, its
 * pending requests hang forever instead of rejecting.
 */
function manage<S extends WebviewRpcSchema>(
  capability: WebviewCapability,
  surface: WebviewSurface
): ManagedWebview<S> & { disposeOnce(): void } {
  const rpc = createWebviewRpc<S>(surface);
  let disposed = false;

  return {
    setHtml: (html) => {
      surface.setHtml(html);
    },

    async setHtmlFromTemplate(templatePath, variables = {}): Promise<void> {
      const template = await capability.readExtensionFile(templatePath);
      surface.setHtml(renderTemplate(template, variables, (path) => surface.asWebviewUri(path)));
    },

    post: (message) => surface.postMessage(message),
    onMessage: (listener) => surface.onDidReceiveMessage(listener),
    asWebviewUri: (path) => surface.asWebviewUri(path),
    get cspSource(): string {
      return surface.cspSource;
    },
    rpc,

    disposeOnce(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      rpc.dispose();
    },
  };
}

/**
 * The panel-only half of a managed panel.
 *
 * Split out because a *restored* panel arrives from the platform's serializer
 * rather than from `openPanel`, and has to end up with the same shape.
 */
export function panelControls(surface: WebviewPanelSurface): {
  reveal(column?: number): void;
  onDidChangeVisibility(listener: (visible: boolean) => void): PlatformRegistration;
  onDidDispose(listener: () => void): PlatformRegistration;
  dispose(): void;
} {
  return {
    reveal: (column) => {
      surface.reveal(column);
    },
    onDidChangeVisibility: (listener) => surface.onDidChangeVisibility(listener),
    onDidDispose: (listener) => surface.onDidDispose(listener),
    dispose: () => {
      surface.dispose();
    },
  };
}

/**
 * Wraps a platform surface for a module's view provider.
 *
 * Used by the host when it resolves a declared webview view; an application
 * receives the result in its `resolve` callback.
 */
export function manageWebviewSurface<S extends WebviewRpcSchema = WebviewRpcSchema>(
  capability: WebviewCapability,
  surface: WebviewSurface
): ManagedWebview<S> & { disposeOnce(): void } {
  return manage<S>(capability, surface);
}

/**
 * Builds the webview service over a capability.
 *
 * The service owns every panel it opened. Disposing it — which the container
 * does when the application stops — closes them.
 *
 * @example
 * ```ts
 * const webviews = createWebviewService(capability);
 * const panel = webviews.openPanel({ viewType: 'sample.preview', title: 'Preview' });
 * ```
 */
export function createWebviewService(
  capability: WebviewCapability
): WebviewService & { dispose(): void } {
  const open = new Set<{ dispose(): void }>();

  return {
    openPanel<S extends WebviewRpcSchema = WebviewRpcSchema>(
      request: WebviewPanelRequest
    ): ManagedWebviewPanel<S> {
      const surface: WebviewPanelSurface = capability.createPanel(request);
      const core = manage<S>(capability, surface);

      const panel: ManagedWebviewPanel<S> = {
        ...core,
        get cspSource(): string {
          return core.cspSource;
        },
        ...panelControls(surface),
      };

      const tracked = {
        dispose(): void {
          surface.dispose();
        },
      };
      open.add(tracked);

      // The native event is the single point every teardown path passes
      // through: the user closing the tab, `panel.dispose()`, and the service
      // being disposed on shutdown all end up here exactly once.
      surface.onDidDispose(() => {
        core.disposeOnce();
        open.delete(tracked);
      });

      return panel;
    },

    dispose(): void {
      for (const panel of [...open]) {
        panel.dispose();
      }
      open.clear();
    },
  };
}
