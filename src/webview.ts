import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as crypto from 'crypto';

// ============================================
// Types
// ============================================

/**
 * Options for creating a WebView panel.
 */
export interface WebViewOptions {
  /** Unique identifier for the WebView type */
  viewType: string;
  /** Panel title */
  title: string;
  /** Column to show the panel in (default: One) */
  column?: vscode.ViewColumn;
  /** Retain context when hidden (default: false) */
  retainContext?: boolean;
  /** Local resource roots (default: extension's media folder) */
  localResourceRoots?: vscode.Uri[];
  /** Enable JavaScript in the WebView (default: false) */
  enableScripts?: boolean;
  /** Enable forms in the WebView (default: false) */
  enableForms?: boolean;
  /** Enable find widget (default: false) */
  enableFindWidget?: boolean;
}

/**
 * A message sent to/from a WebView.
 */
export interface WebViewMessage<T = unknown> {
  /** Message type identifier */
  type: string;
  /** Message payload */
  payload: T;
}

/**
 * A managed WebView panel with helper methods.
 */
export interface ManagedWebViewPanel<TIn = unknown, TOut = unknown> extends vscode.Disposable {
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
   * Sends a message to the WebView.
   *
   * @param message - Message to send
   */
  postMessage(message: WebViewMessage<TOut>): Promise<boolean>;

  /**
   * Registers a handler for messages from the WebView.
   *
   * @param handler - Message handler
   */
  onMessage(handler: (message: WebViewMessage<TIn>) => void): vscode.Disposable;

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
   * Converts a local URI to a WebView-safe URI.
   *
   * @param uri - Local URI
   */
  asWebviewUri(uri: vscode.Uri): vscode.Uri;

  /** The underlying VS Code WebviewPanel */
  readonly native: vscode.WebviewPanel;
}

// ============================================
// createWebViewPanel
// ============================================

/**
 * Creates a managed WebView panel.
 *
 * @param context - Extension context
 * @param options - WebView options
 * @returns A managed WebView panel
 *
 * @example
 * ```typescript
 * interface InMsg { type: 'save' | 'cancel'; data: { content: string } }
 * interface OutMsg { type: 'update'; payload: { message: string } }
 *
 * const panel = createWebViewPanel<InMsg, OutMsg>(context, {
 *   viewType: 'myext.editor',
 *   title: 'Custom Editor',
 *   enableScripts: true,
 *   retainContext: true,
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
export function createWebViewPanel<TIn = unknown, TOut = unknown>(
  context: vscode.ExtensionContext,
  options: WebViewOptions
): ManagedWebViewPanel<TIn, TOut> {
  const {
    viewType,
    title,
    column = vscode.ViewColumn.One,
    retainContext = false,
    localResourceRoots,
    enableScripts = false,
    enableForms = false,
    enableFindWidget = false,
  } = options;

  const panel = vscode.window.createWebviewPanel(viewType, title, column, {
    enableScripts,
    enableForms,
    enableFindWidget,
    retainContextWhenHidden: retainContext,
    localResourceRoots: localResourceRoots ?? [
      vscode.Uri.joinPath(context.extensionUri, 'media'),
      vscode.Uri.joinPath(context.extensionUri, 'dist'),
    ],
  });

  const disposables: vscode.Disposable[] = [];

  const managedPanel: ManagedWebViewPanel<TIn, TOut> = {
    setHtml(html: string): void {
      panel.webview.html = html;
    },

    async setHtmlFromTemplate(
      templatePath: string,
      variables?: Record<string, string>
    ): Promise<void> {
      const html = await loadHtmlTemplate(context, templatePath, panel.webview, variables);
      panel.webview.html = html;
    },

    async postMessage(message: WebViewMessage<TOut>): Promise<boolean> {
      return panel.webview.postMessage(message);
    },

    onMessage(handler: (message: WebViewMessage<TIn>) => void): vscode.Disposable {
      const disposable = panel.webview.onDidReceiveMessage(handler);
      disposables.push(disposable);
      return disposable;
    },

    onDidChangeViewState(handler: (visible: boolean) => void): vscode.Disposable {
      const disposable = panel.onDidChangeViewState((e) => {
        handler(e.webviewPanel.visible);
      });
      disposables.push(disposable);
      return disposable;
    },

    onDidDispose(handler: () => void): vscode.Disposable {
      const disposable = panel.onDidDispose(handler);
      disposables.push(disposable);
      return disposable;
    },

    reveal(col?: vscode.ViewColumn): void {
      panel.reveal(col);
    },

    asWebviewUri(uri: vscode.Uri): vscode.Uri {
      return panel.webview.asWebviewUri(uri);
    },

    get native(): vscode.WebviewPanel {
      return panel;
    },

    dispose(): void {
      for (const d of disposables) {
        d.dispose();
      }
      panel.dispose();
    },
  };

  context.subscriptions.push(managedPanel);

  return managedPanel;
}

// ============================================
// CSP and Nonce Generation
// ============================================

/**
 * Options for CSP generation.
 */
export interface CSPOptions {
  /** Nonce for inline scripts/styles */
  nonce?: string;
  /** Additional script sources */
  scriptSrc?: string[];
  /** Additional style sources */
  styleSrc?: string[];
  /** Additional image sources */
  imgSrc?: string[];
  /** Additional font sources */
  fontSrc?: string[];
  /** Additional connect sources (for fetch/XHR) */
  connectSrc?: string[];
}

/**
 * Generates a Content Security Policy string.
 *
 * @param webview - The webview for cspSource
 * @param options - CSP options
 * @returns CSP meta tag content
 *
 * @example
 * ```typescript
 * const nonce = generateNonce();
 * const csp = generateCSP(webview, { nonce });
 * // Use in HTML: <meta http-equiv="Content-Security-Policy" content="${csp}">
 * ```
 */
export function generateCSP(webview: vscode.Webview, options: CSPOptions = {}): string {
  const {
    nonce,
    scriptSrc = [],
    styleSrc = [],
    imgSrc = [],
    fontSrc = [],
    connectSrc = [],
  } = options;

  const cspSource = webview.cspSource;

  const policies: string[] = [
    "default-src 'none'",
    `img-src ${cspSource} https: data: ${imgSrc.join(' ')}`.trim(),
    `font-src ${cspSource} ${fontSrc.join(' ')}`.trim(),
  ];

  // Script source
  const scriptParts = [cspSource, ...scriptSrc];
  if (nonce) {
    scriptParts.push(`'nonce-${nonce}'`);
  }
  policies.push(`script-src ${scriptParts.join(' ')}`);

  // Style source
  const styleParts = [cspSource, "'unsafe-inline'", ...styleSrc];
  policies.push(`style-src ${styleParts.join(' ')}`);

  // Connect source (for fetch/XHR)
  if (connectSrc.length > 0) {
    policies.push(`connect-src ${connectSrc.join(' ')}`);
  }

  return policies.join('; ');
}

/**
 * Generates a cryptographically secure random nonce for CSP.
 *
 * @returns A random 32-character base64url nonce
 *
 * @example
 * ```typescript
 * const nonce = generateNonce();
 * // Use in CSP: script-src 'nonce-${nonce}'
 * // Use in script: <script nonce="${nonce}">...</script>
 * ```
 */
export function generateNonce(): string {
  return crypto.randomBytes(24).toString('base64url');
}

// ============================================
// HTML Template Loading
// ============================================

/**
 * Loads an HTML template file and processes it.
 *
 * Variables are HTML-escaped by default to prevent XSS.
 * Use `{{raw:variableName}}` for unescaped content (use with caution).
 *
 * @param context - Extension context
 * @param templatePath - Path relative to extension root
 * @param webview - Webview for URI conversion
 * @param variables - Variables to replace in the template
 * @returns Processed HTML content
 *
 * @example
 * ```typescript
 * const html = await loadHtmlTemplate(context, 'media/editor.html', webview, {
 *   title: 'My Editor',
 *   nonce: generateNonce(),
 *   cspSource: webview.cspSource,
 * });
 * ```
 *
 * Template syntax:
 * - `{{variableName}}` - Replaced with HTML-escaped value (safe)
 * - `{{raw:variableName}}` - Replaced with raw value (use with caution)
 * - `{{webviewUri:path/to/file.js}}` - Converted to webview URI
 */
export async function loadHtmlTemplate(
  context: vscode.ExtensionContext,
  templatePath: string,
  webview: vscode.Webview,
  variables: Record<string, string> = {}
): Promise<string> {
  const templateUri = vscode.Uri.joinPath(context.extensionUri, templatePath);
  let html = await fs.readFile(templateUri.fsPath, 'utf-8');

  // Replace webview URI placeholders
  html = html.replace(/\{\{webviewUri:([^}]+)\}\}/g, (_, filePath: string) => {
    const uri = vscode.Uri.joinPath(context.extensionUri, filePath.trim());
    return webview.asWebviewUri(uri).toString();
  });

  // Replace variable placeholders (escaped and raw)
  for (const [key, value] of Object.entries(variables)) {
    const escapedKey = escapeRegExp(key);
    // Raw (unescaped) replacement: {{raw:key}}
    html = html.replace(new RegExp(`\\{\\{raw:${escapedKey}\\}\\}`, 'g'), value);
    // Default (escaped) replacement: {{key}}
    html = html.replace(new RegExp(`\\{\\{${escapedKey}\\}\\}`, 'g'), escapeHtml(value));
  }

  return html;
}

/**
 * Escapes special characters for use in a regular expression.
 */
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ============================================
// HTML Builder Utilities
// ============================================

/**
 * Creates a basic HTML structure for a WebView.
 *
 * @param options - HTML options
 * @returns Complete HTML document
 *
 * @example
 * ```typescript
 * const html = createWebViewHtml({
 *   title: 'My View',
 *   csp: generateCSP(webview, { nonce }),
 *   styles: [styleUri.toString()],
 *   scripts: [scriptUri.toString()],
 *   nonce,
 *   body: '<div id="root"></div>',
 * });
 * ```
 */
export function createWebViewHtml(options: {
  title?: string;
  csp?: string;
  styles?: string[];
  scripts?: string[];
  nonce?: string;
  body: string;
}): string {
  const { title = '', csp, styles = [], scripts = [], nonce, body } = options;

  const styleLinks = styles
    .map((href) => `<link rel="stylesheet" href="${escapeHtml(href)}">`)
    .join('\n    ');

  const scriptTags = scripts
    .map((src) => {
      const nonceAttr = nonce ? ` nonce="${escapeHtml(nonce)}"` : '';
      return `<script src="${escapeHtml(src)}"${nonceAttr}></script>`;
    })
    .join('\n    ');

  const cspMeta = csp
    ? `<meta http-equiv="Content-Security-Policy" content="${escapeHtml(csp)}">`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    ${cspMeta}
    <title>${escapeHtml(title)}</title>
    ${styleLinks}
</head>
<body>
    ${body}
    ${scriptTags}
</body>
</html>`;
}

/**
 * Escapes HTML special characters.
 *
 * @param text - Text to escape
 * @returns Escaped text
 */
export function escapeHtml(text: string): string {
  const escapeMap: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;',
  };
  return text.replace(/[&<>"']/g, (char) => escapeMap[char] ?? char);
}
