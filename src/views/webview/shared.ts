import * as vscode from 'vscode';
import { createWebviewRpc, type WebviewRpc, type WebviewRpcSchema } from './rpc.js';
import { loadHtmlTemplate } from './html.js';

/**
 * @internal Not part of the public API (not re-exported from `./index.js`).
 *
 * Shared plumbing between `ManagedWebviewPanel` and `ManagedWebviewView`:
 * HTML setting, RPC channel creation, and dispose-once bridging. Both
 * wrappers hook the *native* dispose event (panel closed by the user /
 * view torn down) into `disposeCore()`, not just their own `dispose()`
 * method — otherwise closing a panel/view by clicking its tab/toggle would
 * leave the RPC channel's pending requests hanging forever instead of
 * rejecting.
 */
export interface ManagedWebviewCore<S extends WebviewRpcSchema> {
  setHtml(html: string): void;
  setHtmlFromTemplate(templatePath: string, variables?: Record<string, string>): Promise<void>;
  asWebviewUri(uri: vscode.Uri): vscode.Uri;
  readonly rpc: WebviewRpc<S>;
  /** Registers an extra disposable (e.g. a raw `onMessage` subscription) to tear down alongside the RPC channel. */
  track(disposable: vscode.Disposable): void;
  /** Disposes the RPC channel and every tracked disposable. Safe to call more than once. */
  disposeCore(): void;
}

/** @internal */
export function createManagedWebviewCore<S extends WebviewRpcSchema>(
  context: vscode.ExtensionContext,
  webview: vscode.Webview
): ManagedWebviewCore<S> {
  const rpc = createWebviewRpc<S>(webview);
  const tracked: vscode.Disposable[] = [];
  let disposed = false;

  return {
    setHtml(html: string): void {
      webview.html = html;
    },

    async setHtmlFromTemplate(
      templatePath: string,
      variables?: Record<string, string>
    ): Promise<void> {
      webview.html = await loadHtmlTemplate(context, templatePath, webview, variables);
    },

    asWebviewUri(uri: vscode.Uri): vscode.Uri {
      return webview.asWebviewUri(uri);
    },

    rpc,

    track(disposable: vscode.Disposable): void {
      tracked.push(disposable);
    },

    disposeCore(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      rpc.dispose();
      for (const disposable of tracked) {
        disposable.dispose();
      }
    },
  };
}
