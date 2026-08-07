/**
 * HTML/CSP builders for webviews. vscode-free: the only platform input is
 * `cspSource`, taken structurally, so everything here is unit-testable and
 * bundleable.
 *
 * Security boundary: {@link generateCSP} emits policy text but does not install
 * it; pass that text to {@link createWebviewHtml}. The HTML builder escapes
 * title, URLs, CSP text, and nonce attributes, but inserts `body` verbatim.
 * Callers therefore own body sanitization and must not concatenate untrusted
 * values into it. Additional CSP sources are also trusted policy fragments and
 * are inserted verbatim.
 */

/** The subset of `vscode.Webview` CSP generation needs. */
export interface WebviewCspSourceLike {
  readonly cspSource: string;
}

/** Options for CSP generation. */
export interface CSPOptions {
  /** Nonce for inline scripts/styles. */
  nonce?: string;
  /**
   * Additional trusted script-source expressions, inserted verbatim.
   *
   * When a `nonce` is supplied these are the *only* other sources allowed to
   * run scripts: the webview's own `cspSource` is deliberately left out, since
   * including it would let any script under `localResourceRoots` run without
   * the nonce. See {@link generateCSP}.
   */
  scriptSrc?: string[];
  /** Additional trusted style-source expressions, inserted verbatim. */
  styleSrc?: string[];
  /** Additional image sources. */
  imgSrc?: string[];
  /** Additional font sources. */
  fontSrc?: string[];
  /** Additional connect sources (for fetch/XHR/WebSocket). */
  connectSrc?: string[];
  /** Additional media sources (for `<video>`/`<audio>`). */
  mediaSrc?: string[];
  /** Additional worker sources (for Web Workers / WASM offloading). */
  workerSrc?: string[];
  /**
   * Whether to allow `'unsafe-inline'` in style-src.
   *
   * Browsers treat `'unsafe-inline'` as overriding any nonce in the same
   * directive, so when this is `true` the nonce in style-src is effectively
   * ignored. When `false` (the default) and a `nonce` is provided, the
   * nonce is used for nonced inline styles instead.
   *
   * @default false
   */
  allowInlineStyles?: boolean;
  /**
   * Whether to allow images from any HTTPS origin (`https:`) in img-src.
   *
   * When `false` (the default), images are restricted to the webview's
   * `cspSource`, `data:` URIs, and the explicit `imgSrc` list.
   *
   * @default false
   */
  allowAnyHttpsImages?: boolean;
}

/**
 * Generates a Content Security Policy string.
 *
 * Defaults are the strictest useful policy: no inline styles, no
 * unrestricted HTTPS images. Opt into either via {@link CSPOptions.allowInlineStyles}
 * / {@link CSPOptions.allowAnyHttpsImages} if your webview genuinely needs them.
 *
 * Supplying a `nonce` makes `script-src` the nonce alone. Every script tag then
 * needs the matching `nonce` attribute — {@link createWebviewHtml} adds it for
 * the scripts it renders.
 *
 * @param webview - The webview for cspSource
 * @param options - CSP options
 * @returns CSP meta tag content
 *
 * @example
 * ```typescript
 * const nonce = generateNonce();
 * const csp = generateCSP(webview, { nonce, mediaSrc: [webview.cspSource] });
 * // Use in HTML: <meta http-equiv="Content-Security-Policy" content="${csp}">
 * ```
 */
export function generateCSP(webview: WebviewCspSourceLike, options: CSPOptions = {}): string {
  const {
    nonce,
    scriptSrc = [],
    styleSrc = [],
    imgSrc = [],
    fontSrc = [],
    connectSrc = [],
    mediaSrc = [],
    workerSrc = [],
    allowInlineStyles = false,
    allowAnyHttpsImages = false,
  } = options;

  const cspSource = webview.cspSource;

  const imgParts = [cspSource, 'data:'];
  if (allowAnyHttpsImages) {
    imgParts.push('https:');
  }
  imgParts.push(...imgSrc);

  const policies: string[] = [
    "default-src 'none'",
    `img-src ${imgParts.join(' ')}`,
    `font-src ${cspSource} ${fontSrc.join(' ')}`.trim(),
  ];

  // A nonce *replaces* the webview's own source here rather than joining it.
  //
  // Source expressions and nonces are alternatives in CSP Level 3 — a script
  // matching either one runs — so `script-src ${cspSource} 'nonce-x'` lets any
  // script under `localResourceRoots` execute with no nonce at all, which is
  // the entire guarantee the nonce was added for. VS Code's own webviews
  // (markdown, media and browser previews) emit `script-src 'nonce-x'` alone
  // for the same reason.
  //
  // Without a nonce there is no other way to permit the extension's own
  // scripts, so `cspSource` stays. Adding it back alongside a nonce is possible
  // through `scriptSrc`, and is a deliberate choice at that point.
  const scriptParts = nonce ? [`'nonce-${nonce}'`, ...scriptSrc] : [cspSource, ...scriptSrc];
  policies.push(`script-src ${scriptParts.join(' ')}`);

  const styleParts = [cspSource, ...styleSrc];
  if (allowInlineStyles) {
    // Browsers treat 'unsafe-inline' as overriding any nonce in the same
    // directive, so we don't add the nonce here.
    styleParts.push("'unsafe-inline'");
  } else if (nonce) {
    styleParts.push(`'nonce-${nonce}'`);
  }
  policies.push(`style-src ${styleParts.join(' ')}`);

  if (connectSrc.length > 0) {
    policies.push(`connect-src ${connectSrc.join(' ')}`);
  }
  if (mediaSrc.length > 0) {
    policies.push(`media-src ${[cspSource, ...mediaSrc].join(' ')}`);
  }
  if (workerSrc.length > 0) {
    policies.push(`worker-src ${[cspSource, ...workerSrc].join(' ')}`);
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
  // Web Crypto instead of node:crypto so this module stays usable in web
  // extension hosts (available globally in Node 20+ and browsers).
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
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

/**
 * Creates a basic HTML structure for a webview.
 *
 * `body` is trusted HTML and `csp` is optional; omitting it does not create a
 * safe policy automatically. The generated document declares `lang="en"`.
 * Use a localized template through `setHtmlFromTemplate` when another document
 * language is required.
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
  /** Escaped document title. */
  title?: string;
  /** CSP meta content, normally produced by {@link generateCSP}. */
  csp?: string;
  /** Stylesheet URIs; attribute-escaped but not checked against the CSP. */
  styles?: string[];
  /** Script URIs; attribute-escaped but not checked against the CSP. */
  scripts?: string[];
  /** Applied to generated script elements. */
  nonce?: string;
  /** Trusted HTML inserted verbatim into `<body>`. */
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
