/**
 * Webview adapter: the trusted extension-host side of the VS Code boundary.
 *
 * This file resolves extension-relative resources and wraps native panels/views.
 * HTML construction, CSP policy and RPC envelope validation live above the port.
 * A webview is still an untrusted message boundary; this adapter deliberately
 * does not reinterpret arbitrary messages as typed values.
 */
import * as vscode from 'vscode';

import type {
  PlatformRegistration,
  WebviewCapability,
  WebviewPanelRequest,
  WebviewPanelSurface,
  WebviewSurface,
  WebviewViewRequest,
  WebviewViewSurface,
} from '../../foundation/platform/ports.js';

/**
 * The real webview surface, backed by `vscode.window.createWebviewPanel` and
 * `registerWebviewViewProvider`.
 *
 * Paths cross the port, not URIs: building a URI correctly for remote and
 * virtual file systems is exactly the sort of thing only the platform can do,
 * so it happens here and nowhere else.
 */

/** Resolves an extension-relative path against the extension's own root. */
function resolve(extensionUri: vscode.Uri, path: string): vscode.Uri {
  return vscode.Uri.joinPath(extensionUri, path);
}

function toContentOptions(
  extensionUri: vscode.Uri,
  request: WebviewPanelRequest | WebviewViewRequest
): vscode.WebviewOptions {
  // Defaults are extension-relative allow-list roots, never the workspace or
  // filesystem root. Supplying [] deliberately denies all local resources.
  return {
    ...(request.enableScripts === undefined ? {} : { enableScripts: request.enableScripts }),
    ...('enableForms' in request && request.enableForms !== undefined
      ? { enableForms: request.enableForms }
      : {}),
    localResourceRoots: (request.localResourceRoots ?? ['media', 'dist']).map((path) =>
      resolve(extensionUri, path)
    ),
  };
}

/**
 * Wraps a native webview as the minimal shared surface.
 * The wrapper does not own the native view; the panel/provider registration or
 * VS Code controls its lifetime. Message subscriptions return their native
 * disposable unchanged, so the managed caller—not this adapter—must release
 * subscriptions when its own webview lifetime ends.
 */
function toSurface(extensionUri: vscode.Uri, webview: vscode.Webview): WebviewSurface {
  return {
    postMessage: (message) => Promise.resolve(webview.postMessage(message)),
    onDidReceiveMessage: (listener) => webview.onDidReceiveMessage(listener),
    setHtml(html: string): void {
      webview.html = html;
    },
    get cspSource(): string {
      return webview.cspSource;
    },
    asWebviewUri: (path) => webview.asWebviewUri(resolve(extensionUri, path)).toString(),
  };
}

/**
 * Adds panel-only reveal/visibility/disposal operations to the shared surface.
 * Native disposal is forwarded rather than inferred from a failed postMessage.
 * Managed callers can use that event for RPC and listener cleanup; this adapter
 * itself does not own either policy.
 */
function toPanelSurface(extensionUri: vscode.Uri, panel: vscode.WebviewPanel): WebviewPanelSurface {
  return {
    ...toSurface(extensionUri, panel.webview),
    reveal(column?: number): void {
      panel.reveal(column);
    },
    // The native event carries no visibility flag, so it is read off the panel
    // at the moment it fires.
    onDidChangeVisibility: (listener) =>
      panel.onDidChangeViewState(() => {
        listener(panel.visible);
      }),
    onDidDispose: (listener) => panel.onDidDispose(listener),
    dispose(): void {
      panel.dispose();
    },
  };
}

/**
 * Creates the real webview capability for one extension root.
 *
 * Provider resolution happens once per incarnation of a view — hiding one tears
 * it down, showing it again resolves a new one — and each callback receives a
 * fresh surface carrying that incarnation's `onDidDispose`.
 *
 * The port still exposes neither `WebviewViewResolveContext` nor the native
 * cancellation token, so this adapter cannot report restored view state or
 * signal that a pending resolve is no longer needed. Code requiring either must
 * use the managed raw escape hatch and cover the behavior in an Extension Host
 * test.
 *
 * @example
 * ```ts
 * const capability = createVSCodeWebviewCapability(context.extensionUri);
 * const panel = capability.createPanel({ viewType: 'sample.preview', title: 'Preview' });
 * ```
 */
export function createVSCodeWebviewCapability(extensionUri: vscode.Uri): WebviewCapability {
  return {
    createPanel(request: WebviewPanelRequest): WebviewPanelSurface {
      const panel = vscode.window.createWebviewPanel(
        request.viewType,
        request.title,
        request.column ?? vscode.ViewColumn.One,
        {
          ...toContentOptions(extensionUri, request),
          ...(request.retainContextWhenHidden === undefined
            ? {}
            : { retainContextWhenHidden: request.retainContextWhenHidden }),
          ...(request.enableFindWidget === undefined
            ? {}
            : { enableFindWidget: request.enableFindWidget }),
        }
      );

      return toPanelSurface(extensionUri, panel);
    },

    registerViewProvider(
      viewId: string,
      resolveView: (surface: WebviewViewSurface) => void | Promise<void>,
      options: WebviewViewRequest
    ): PlatformRegistration {
      return vscode.window.registerWebviewViewProvider(
        viewId,
        {
          async resolveWebviewView(view: vscode.WebviewView): Promise<void> {
            view.webview.options = toContentOptions(extensionUri, options);
            await resolveView({
              ...toSurface(extensionUri, view.webview),
              // The event lives on the view, not the webview it holds, which is
              // why it has to be attached here: above the port there is nothing
              // left that knows one incarnation from the next.
              onDidDispose: (listener) => view.onDidDispose(listener),
            });
          },
        },
        options.retainContextWhenHidden === undefined
          ? {}
          : {
              webviewOptions: { retainContextWhenHidden: options.retainContextWhenHidden },
            }
      );
    },

    registerPanelSerializer(
      viewType: string,
      restore: (surface: WebviewPanelSurface, state: unknown) => void | Promise<void>
    ): PlatformRegistration {
      return vscode.window.registerWebviewPanelSerializer(viewType, {
        async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
          // Saved webview state enters the framework as `unknown`. The restore
          // callback is responsible for validating it before use; the adapter
          // must not cast it for convenience.
          await restore(toPanelSurface(extensionUri, panel), state);
        },
      });
    },

    async readExtensionFile(extensionRelativePath: string): Promise<string> {
      // `workspace.fs` rather than `node:fs`, so a template loads in the web
      // extension host and over a remote connection as well.
      const bytes = await vscode.workspace.fs.readFile(
        resolve(extensionUri, extensionRelativePath)
      );
      return new TextDecoder().decode(bytes);
    },
  };
}
