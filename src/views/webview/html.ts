import * as vscode from 'vscode';

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
  // vscode.workspace.fs instead of node:fs so templates load in remote and
  // web extension hosts as well.
  const templateUri = vscode.Uri.joinPath(context.extensionUri, templatePath);
  const bytes = await vscode.workspace.fs.readFile(templateUri);
  let html = new TextDecoder().decode(bytes);

  // Replace webview URI placeholders
  html = html.replace(/\{\{webviewUri:([^}]+)\}\}/g, (_, filePath: string) => {
    const uri = vscode.Uri.joinPath(context.extensionUri, filePath.trim());
    return webview.asWebviewUri(uri).toString();
  });

  // Replace variable placeholders in a single pass so values cannot contain
  // other placeholders that get expanded transitively (which would be both
  // order-dependent across Object.entries and an injection vector).
  html = html.replace(/\{\{(raw:)?([^}]+)\}\}/g, (match, raw: string | undefined, key: string) => {
    const value = variables[key.trim()];
    if (value === undefined) {
      return match;
    }
    return raw ? value : escapeHtml(value);
  });

  return html;
}

// ============================================
// HTML Builder Utilities
// ============================================

/**
 * Creates a basic HTML structure for a webview.
 *
 * @param options - HTML options
 * @returns Complete HTML document
 *
 * @example
 * ```typescript
 * const html = createWebviewHtml({
 *   title: 'My View',
 *   csp: generateCSP(webview, { nonce }),
 *   styles: [styleUri.toString()],
 *   scripts: [scriptUri.toString()],
 *   nonce,
 *   body: '<div id="root"></div>',
 * });
 * ```
 */
export function createWebviewHtml(options: {
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
