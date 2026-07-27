import * as vscode from 'vscode';

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
  /** Additional connect sources (for fetch/XHR/WebSocket) */
  connectSrc?: string[];
  /** Additional media sources (for `<video>`/`<audio>`) */
  mediaSrc?: string[];
  /** Additional worker sources (for Web Workers / WASM offloading) */
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
export function generateCSP(webview: vscode.Webview, options: CSPOptions = {}): string {
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

  // Image source
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

  // Script source
  const scriptParts = [cspSource, ...scriptSrc];
  if (nonce) {
    scriptParts.push(`'nonce-${nonce}'`);
  }
  policies.push(`script-src ${scriptParts.join(' ')}`);

  // Style source
  const styleParts = [cspSource, ...styleSrc];
  if (allowInlineStyles) {
    // Browsers treat 'unsafe-inline' as overriding any nonce in the same
    // directive, so we don't add the nonce here.
    styleParts.push("'unsafe-inline'");
  } else if (nonce) {
    // Strict mode: rely on nonce for inline styles (if any are needed).
    styleParts.push(`'nonce-${nonce}'`);
  }
  policies.push(`style-src ${styleParts.join(' ')}`);

  // Connect source (for fetch/XHR/WebSocket)
  if (connectSrc.length > 0) {
    policies.push(`connect-src ${connectSrc.join(' ')}`);
  }

  // Media source (for <video>/<audio> playback)
  if (mediaSrc.length > 0) {
    policies.push(`media-src ${[cspSource, ...mediaSrc].join(' ')}`);
  }

  // Worker source (for Web Workers / WASM offloading)
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
