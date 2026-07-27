/**
 * @packageDocumentation
 * Webview utilities: managed panels and sidebar views, CSP generation, HTML
 * templating, and a typed request/response + event RPC channel
 * ({@link createWebviewRpc}) layered over `postMessage`.
 *
 * @module @kkdev92/vscode-ext-kit/views/webview
 */

// ============================================
// RPC
// ============================================
export { createWebviewRpc } from './rpc.js';
export type { WebviewRpcSchema, WebviewRpc, WebviewRpcRequestOptions } from './rpc.js';

// ============================================
// Panel
// ============================================
export { createWebviewPanel, registerWebviewPanelSerializer } from './panel.js';
export type { WebviewOptions, WebviewMessage, ManagedWebviewPanel } from './panel.js';

// ============================================
// View (sidebar/panel webview views)
// ============================================
export { registerWebviewView } from './view.js';
export type { WebviewViewOptions, ManagedWebviewView } from './view.js';

// ============================================
// CSP
// ============================================
export { generateCSP, generateNonce } from './csp.js';
export type { CSPOptions } from './csp.js';

// ============================================
// HTML
// ============================================
export { loadHtmlTemplate, createWebviewHtml, escapeHtml } from './html.js';
