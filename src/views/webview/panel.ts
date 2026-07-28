import * as vscode from 'vscode';
import type { WebviewRpc, WebviewRpcSchema } from './rpc.js';
import { createManagedWebviewCore } from './shared.js';

// ============================================
// Types
// ============================================

/**
 * Options for creating a webview panel.
 */
export interface WebviewOptions {
  /** Unique identifier for the webview type */
  viewType: string;
  /** Panel title */
  title: string;
  /** Column to show the panel in (default: One) */
  column?: vscode.ViewColumn;
  /**
   * Keep the panel's iframe (and its scripts) alive when hidden, instead of
   * tearing it down and recreating it when shown again.
   *
   * Has a real memory/process cost — the hidden webview's JS context keeps
   * running. Prefer saving state via `acquireVsCodeApi().setState()` inside
   * the webview (restored via `getState()`), or a
   * {@link registerWebviewPanelSerializer}, over enabling this.
   *
   * @default false
   */
  retainContextWhenHidden?: boolean;
  /** Local resource roots (default: extension's `media` and `dist` folders) */
  localResourceRoots?: vscode.Uri[];
  /** Enable JavaScript in the webview (default: false) */
  enableScripts?: boolean;
  /** Enable forms in the webview (default: false) */
  enableForms?: boolean;
  /** Enable find widget (default: false) */
  enableFindWidget?: boolean;
}

/**
 * A raw message sent to/from a webview via `postMessage`/`onMessage`.
 *
 * For request/response semantics with correlation, timeouts, and
 * cancellation, prefer `ManagedWebviewPanel.rpc` ({@link createWebviewRpc})
 * instead of hand-rolling a dispatch over these.
 */
export interface WebviewMessage<T = unknown> {
  /** Message type identifier */
  type: string;
  /** Message payload */
  payload: T;
}

/**
 * A managed webview panel with helper methods.
 */
export interface ManagedWebviewPanel<
  S extends WebviewRpcSchema = WebviewRpcSchema,
  TIn = unknown,
  TOut = unknown,
>
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
   * Sends a raw message to the webview. For request/response, use {@link rpc} instead.
   *
   * @param message - Message to send
   */
  postMessage(message: WebviewMessage<TOut>): Promise<boolean>;

  /**
   * Registers a handler for raw messages from the webview. For
   * request/response, use {@link rpc} instead.
   *
   * @param handler - Message handler
   */
  onMessage(handler: (message: WebviewMessage<TIn>) => void): vscode.Disposable;

  /**
   * Registers a handler for visibility changes.
   *
   * @param handler - Handler receiving visibility state
   */
  onDidChangeViewState(handler: (visible: boolean) => void): vscode.Disposable;

  /**
   * Registers a handler for disposal.
   *
   * @param handler - Disposal handler
   */
  onDidDispose(handler: () => void): vscode.Disposable;

  /**
   * Shows the panel.
   *
   * @param column - Optional column to show in
   */
  reveal(column?: vscode.ViewColumn): void;

  /**
   * Converts a local URI to a webview-safe URI.
   *
   * @param uri - Local URI
   */
  asWebviewUri(uri: vscode.Uri): vscode.Uri;

  /**
   * Typed request/response + event channel for this panel's webview. See
   * {@link createWebviewRpc}.
   */
  readonly rpc: WebviewRpc<S>;

  /** The underlying VS Code WebviewPanel */
  readonly native: vscode.WebviewPanel;
}

// ============================================
// Internal: shared wrapping logic
// ============================================

/**
 * Wraps a `vscode.WebviewPanel` — whether freshly created or restored by a
 * {@link registerWebviewPanelSerializer} — as a `ManagedWebviewPanel`. Used
 * by both {@link createWebviewPanel} and `registerWebviewPanelSerializer` so
 * the wrapping logic (and its dispose bridging) is defined exactly once.
 */
function wrapAsManagedPanel<
  S extends WebviewRpcSchema = WebviewRpcSchema,
  TIn = unknown,
  TOut = unknown,
>(context: vscode.ExtensionContext, panel: vscode.WebviewPanel): ManagedWebviewPanel<S, TIn, TOut> {
  const core = createManagedWebviewCore<S>(context, panel.webview);

  // Closing the panel (user clicks the tab's close button) fires
  // onDidDispose natively, whether or not managedPanel.dispose() is ever
  // called — hook cleanup there too so the RPC channel's pending requests
  // always get rejected instead of hanging.
  panel.onDidDispose(() => core.disposeCore());

  const managedPanel: ManagedWebviewPanel<S, TIn, TOut> = {
    setHtml(html: string): void {
      core.setHtml(html);
    },

    async setHtmlFromTemplate(
      templatePath: string,
      variables?: Record<string, string>
    ): Promise<void> {
      await core.setHtmlFromTemplate(templatePath, variables);
    },

    async postMessage(message: WebviewMessage<TOut>): Promise<boolean> {
      return panel.webview.postMessage(message);
    },

    onMessage(handler: (message: WebviewMessage<TIn>) => void): vscode.Disposable {
      const disposable = panel.webview.onDidReceiveMessage(handler);
      core.track(disposable);
      return disposable;
    },

    onDidChangeViewState(handler: (visible: boolean) => void): vscode.Disposable {
      const disposable = panel.onDidChangeViewState((e) => {
        handler(e.webviewPanel.visible);
      });
      core.track(disposable);
      return disposable;
    },

    onDidDispose(handler: () => void): vscode.Disposable {
      return panel.onDidDispose(handler);
    },

    reveal(col?: vscode.ViewColumn): void {
      panel.reveal(col);
    },

    asWebviewUri(uri: vscode.Uri): vscode.Uri {
      return core.asWebviewUri(uri);
    },

    rpc: core.rpc,

    get native(): vscode.WebviewPanel {
      return panel;
    },

    dispose(): void {
      core.disposeCore();
      panel.dispose();
    },
  };

  return managedPanel;
}

// ============================================
// createWebviewPanel
// ============================================

/**
 * Creates a managed webview panel.
 *
 * @param context - Extension context
 * @param options - Webview options
 * @returns A managed webview panel
 *
 * @example
 * ```typescript
 * interface InMsg { type: 'save' | 'cancel'; data: { content: string } }
 * interface OutMsg { type: 'update'; payload: { message: string } }
 *
 * const panel = createWebviewPanel<WebviewRpcSchema, InMsg, OutMsg>(context, {
 *   viewType: 'myext.editor',
 *   title: 'Custom Editor',
 *   enableScripts: true,
 * });
 *
 * await panel.setHtmlFromTemplate('media/editor.html', {
 *   cspSource: panel.native.webview.cspSource,
 *   nonce: generateNonce(),
 * });
 *
 * panel.onMessage((msg) => {
 *   if (msg.type === 'save') {
 *     saveContent(msg.payload.content);
 *   }
 * });
 *
 * await panel.postMessage({ type: 'update', payload: { message: 'Saved!' } });
 * ```
 */
export function createWebviewPanel<
  S extends WebviewRpcSchema = WebviewRpcSchema,
  TIn = unknown,
  TOut = unknown,
>(context: vscode.ExtensionContext, options: WebviewOptions): ManagedWebviewPanel<S, TIn, TOut> {
  const {
    viewType,
    title,
    column = vscode.ViewColumn.One,
    retainContextWhenHidden = false,
    localResourceRoots,
    enableScripts = false,
    enableForms = false,
    enableFindWidget = false,
  } = options;

  const panel = vscode.window.createWebviewPanel(viewType, title, column, {
    enableScripts,
    enableForms,
    enableFindWidget,
    retainContextWhenHidden,
    localResourceRoots: localResourceRoots ?? [
      vscode.Uri.joinPath(context.extensionUri, 'media'),
      vscode.Uri.joinPath(context.extensionUri, 'dist'),
    ],
  });

  const managedPanel = wrapAsManagedPanel<S, TIn, TOut>(context, panel);
  context.subscriptions.push(managedPanel);

  return managedPanel;
}

// ============================================
// registerWebviewPanelSerializer
// ============================================

/**
 * Registers a serializer that restores webview panels across editor
 * restarts, returning them wrapped as the same `ManagedWebviewPanel` you'd
 * get from {@link createWebviewPanel}.
 *
 * Your extension must have declared an `onWebviewPanel:<viewType>`
 * activation event in `package.json` for VS Code to reactivate it and call
 * this in time to restore the panel.
 *
 * @param context - Extension context
 * @param viewType - The webview panel's view type (must match what {@link createWebviewPanel} used)
 * @param restore - Called with the restored panel and its persisted state
 * @returns A disposable that unregisters the serializer
 *
 * @example
 * ```typescript
 * registerWebviewPanelSerializer<WebviewRpcSchema, { content: string }>(
 *   context,
 *   'myext.editor',
 *   async (panel, state) => {
 *     await panel.setHtmlFromTemplate('media/editor.html', {
 *       cspSource: panel.native.webview.cspSource,
 *     });
 *     if (state) {
 *       await panel.postMessage({ type: 'restore', payload: state });
 *     }
 *   }
 * );
 * ```
 */
export function registerWebviewPanelSerializer<
  S extends WebviewRpcSchema = WebviewRpcSchema,
  TState = unknown,
  TIn = unknown,
  TOut = unknown,
>(
  context: vscode.ExtensionContext,
  viewType: string,
  restore: (
    panel: ManagedWebviewPanel<S, TIn, TOut>,
    state: TState | undefined
  ) => void | Promise<void>
): vscode.Disposable {
  const registration = vscode.window.registerWebviewPanelSerializer(viewType, {
    async deserializeWebviewPanel(panel: vscode.WebviewPanel, state: unknown): Promise<void> {
      const managed = wrapAsManagedPanel<S, TIn, TOut>(context, panel);
      context.subscriptions.push(managed);
      await restore(managed, state as TState | undefined);
    },
  });

  context.subscriptions.push(registration);
  return registration;
}
