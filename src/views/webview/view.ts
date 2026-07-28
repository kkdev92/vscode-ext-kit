import * as vscode from 'vscode';
import type { WebviewRpc, WebviewRpcSchema } from './rpc.js';
import { createManagedWebviewCore } from './shared.js';

// ============================================
// Types
// ============================================

/**
 * Options for {@link registerWebviewView}.
 */
export interface WebviewViewOptions {
  /** Enable JavaScript in the webview (default: false) */
  enableScripts?: boolean;
  /** Enable forms in the webview (default: false) */
  enableForms?: boolean;
  /** Local resource roots (default: extension's `media` and `dist` folders) */
  localResourceRoots?: vscode.Uri[];
  /**
   * Keep the view's iframe alive when the sidebar/panel is collapsed or
   * switched away from.
   *
   * Sidebar views are hidden and shown far more often than editor panels
   * (every time the user switches view containers), so the memory/process
   * cost of keeping content alive adds up faster here. Prefer
   * `acquireVsCodeApi().setState()`/`getState()` inside the webview over
   * enabling this.
   *
   * @default false
   */
  retainContextWhenHidden?: boolean;
}

/**
 * A managed webview view (sidebar/panel-hosted webview) with helper methods.
 */
export interface ManagedWebviewView<S extends WebviewRpcSchema = WebviewRpcSchema>
  extends vscode.Disposable {
  /**
   * Sets the HTML content directly.
   *
   * @param html - HTML content
   */
  setHtml(html: string): void;

  /**
   * Loads HTML from a template file.
   *
   * @param templatePath - Path relative to extension root
   * @param variables - Variables to replace in the template
   */
  setHtmlFromTemplate(templatePath: string, variables?: Record<string, string>): Promise<void>;

  /**
   * Typed request/response + event channel for this view's webview. See
   * {@link createWebviewRpc}.
   */
  readonly rpc: WebviewRpc<S>;

  /**
   * Registers a handler for visibility changes (collapsed/expanded, or
   * switched away from in the sidebar). Unlike a panel, a view that's
   * merely hidden (as opposed to closed via its context menu) is *not*
   * disposed — this can fire many times over the view's lifetime.
   *
   * @param handler - Handler receiving visibility state
   */
  onDidChangeVisibility(handler: (visible: boolean) => void): vscode.Disposable;

  /**
   * Registers a handler for disposal (the user closed the view via its
   * context menu). VS Code will call the {@link registerWebviewView}
   * resolver again, with a new view, if the user re-enables it later.
   *
   * @param handler - Disposal handler
   */
  onDidDispose(handler: () => void): vscode.Disposable;

  /**
   * Reveals the view, expanding it if collapsed.
   *
   * @param preserveFocus - When true, the view will not take focus
   */
  show(preserveFocus?: boolean): void;

  /**
   * Converts a local URI to a webview-safe URI.
   *
   * @param uri - Local URI
   */
  asWebviewUri(uri: vscode.Uri): vscode.Uri;

  /** The underlying VS Code WebviewView */
  readonly native: vscode.WebviewView;
}

// ============================================
// Internal: shared wrapping logic
// ============================================

/**
 * Wraps a `vscode.WebviewView` as a `ManagedWebviewView`. Shares its core
 * plumbing (HTML setting, RPC, dispose bridging) with
 * {@link ManagedWebviewPanel} via `./shared.js`.
 */
function wrapAsManagedView<S extends WebviewRpcSchema = WebviewRpcSchema>(
  context: vscode.ExtensionContext,
  webviewView: vscode.WebviewView
): ManagedWebviewView<S> {
  const core = createManagedWebviewCore<S>(context, webviewView.webview);

  // Views are disposed by VS Code itself (e.g. the user unchecks the view
  // from its context menu) — there's no way for extension code to force
  // it. Hook cleanup here so the RPC channel's pending requests are
  // rejected instead of hanging when that happens.
  webviewView.onDidDispose(() => core.disposeCore());

  const managedView: ManagedWebviewView<S> = {
    setHtml(html: string): void {
      core.setHtml(html);
    },

    async setHtmlFromTemplate(
      templatePath: string,
      variables?: Record<string, string>
    ): Promise<void> {
      await core.setHtmlFromTemplate(templatePath, variables);
    },

    rpc: core.rpc,

    onDidChangeVisibility(handler: (visible: boolean) => void): vscode.Disposable {
      const disposable = webviewView.onDidChangeVisibility(() => {
        handler(webviewView.visible);
      });
      core.track(disposable);
      return disposable;
    },

    onDidDispose(handler: () => void): vscode.Disposable {
      return webviewView.onDidDispose(handler);
    },

    show(preserveFocus?: boolean): void {
      webviewView.show(preserveFocus);
    },

    asWebviewUri(uri: vscode.Uri): vscode.Uri {
      return core.asWebviewUri(uri);
    },

    get native(): vscode.WebviewView {
      return webviewView;
    },

    dispose(): void {
      // There is no vscode.WebviewView#dispose() — views are torn down by
      // VS Code, not by extensions. This only tears down our own wiring
      // (RPC channel, tracked listeners), same as the onDidDispose bridge
      // above; safe to call from either place or both.
      core.disposeCore();
    },
  };

  return managedView;
}

// ============================================
// registerWebviewView
// ============================================

/**
 * Registers a provider for a sidebar/panel-hosted webview view (the `views`
 * contribution point with `"type": "webview"` in `package.json`), giving you
 * back the same kind of managed wrapper as {@link createWebviewPanel} —
 * HTML helpers and a typed {@link createWebviewRpc} channel — reused every
 * time VS Code (re)resolves the view.
 *
 * `onResolve` is called each time the view is resolved, which happens when
 * it first becomes visible and again after it's fully disposed and shown
 * again (e.g. the user re-enables it from the view container's context
 * menu after hiding it) — it is *not* called again for a mere
 * show/hide/collapse toggle, which fires `onDidChangeVisibility` on the
 * previous instead of recreating it. Do the setup you need for a fresh
 * instance's lifetime (HTML, RPC handlers) inside `onResolve`.
 *
 * @param context - Extension context
 * @param viewId - View identifier (must match the `views` contribution in package.json)
 * @param onResolve - Called with the managed view each time it's resolved
 * @param options - Webview content options
 * @returns A disposable that unregisters the provider
 *
 * @example
 * ```typescript
 * interface MyRpcSchema extends WebviewRpcSchema {
 *   webviewEvents: { ready: void };
 *   hostEvents: { greet: { name: string } };
 * }
 *
 * registerWebviewView<MyRpcSchema>(context, 'myext.sidebar', async (view) => {
 *   await view.setHtmlFromTemplate('media/sidebar.html', {
 *     cspSource: view.native.webview.cspSource,
 *   });
 *   view.rpc.onEvent('ready', () => view.rpc.emit('greet', { name: 'world' }));
 * }, { enableScripts: true });
 * ```
 */
export function registerWebviewView<S extends WebviewRpcSchema = WebviewRpcSchema>(
  context: vscode.ExtensionContext,
  viewId: string,
  onResolve: (view: ManagedWebviewView<S>) => void | Promise<void>,
  options: WebviewViewOptions = {}
): vscode.Disposable {
  const provider: vscode.WebviewViewProvider = {
    async resolveWebviewView(webviewView: vscode.WebviewView): Promise<void> {
      webviewView.webview.options = {
        enableScripts: options.enableScripts ?? false,
        enableForms: options.enableForms ?? false,
        localResourceRoots: options.localResourceRoots ?? [
          vscode.Uri.joinPath(context.extensionUri, 'media'),
          vscode.Uri.joinPath(context.extensionUri, 'dist'),
        ],
      };

      // resolveWebviewView can fire again for a brand new WebviewView
      // instance later in the session, so a fresh managed wrapper (and
      // fresh RPC channel) is built every time rather than reused.
      const managed = wrapAsManagedView<S>(context, webviewView);
      await onResolve(managed);
    },
  };

  const registration = vscode.window.registerWebviewViewProvider(viewId, provider, {
    webviewOptions: { retainContextWhenHidden: options.retainContextWhenHidden ?? false },
  });
  context.subscriptions.push(registration);

  return registration;
}
