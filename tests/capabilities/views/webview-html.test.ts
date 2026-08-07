/**
 * Pure security-focused unit suite for webview escaping, CSP construction,
 * nonce generation, and HTML assembly. It protects restrictive defaults and
 * exact escaping boundaries; failures involving template placeholders belong
 * in `webview-host.test.ts`.
 */
import { describe, expect, it } from 'vitest';

import {
  createWebviewHtml,
  escapeHtml,
  generateCSP,
  generateNonce,
} from '../../../src/capabilities/views/webview/html.js';

const webview = { cspSource: 'vscode-resource:' };

describe('escapeHtml', () => {
  it('escapes the five HTML special characters', () => {
    expect(escapeHtml(`<a href="x" title='&'>`)).toBe(
      '&lt;a href=&quot;x&quot; title=&#039;&amp;&#039;&gt;'
    );
  });
});

describe('generateCSP', () => {
  it('produces the strict default policy', () => {
    const csp = generateCSP(webview);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('img-src vscode-resource: data:');
    expect(csp).not.toContain('https:');
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain('connect-src');
  });

  it('permits scripts by cspSource only while there is no nonce to use', () => {
    expect(generateCSP(webview)).toContain('script-src vscode-resource:');
  });

  it('lets the script nonce replace cspSource, never join it', () => {
    const csp = generateCSP(webview, { nonce: 'abc' });
    // Source expressions and nonces are alternatives in CSP Level 3: a script
    // matching either one runs. Keeping cspSource here would therefore let
    // anything under localResourceRoots execute with no nonce, which is the
    // whole guarantee the nonce exists to provide. VS Code's own webviews emit
    // `script-src 'nonce-x'` alone.
    expect(csp).toContain("script-src 'nonce-abc'");
    expect(csp).not.toContain('script-src vscode-resource:');
    // style-src is a different case: it keeps cspSource, because stylesheets
    // are not an execution vector and the extension's own CSS has to load.
    expect(csp).toContain("style-src vscode-resource: 'nonce-abc'");
  });

  it('still honours an explicitly requested script source alongside a nonce', () => {
    const csp = generateCSP(webview, { nonce: 'abc', scriptSrc: ['https://cdn.example.com'] });
    expect(csp).toContain("script-src 'nonce-abc' https://cdn.example.com");
  });

  it("lets 'unsafe-inline' replace the style nonce, never join it", () => {
    const csp = generateCSP(webview, { nonce: 'abc', allowInlineStyles: true });
    expect(csp).toContain("style-src vscode-resource: 'unsafe-inline'");
    expect(csp).not.toContain("style-src vscode-resource: 'unsafe-inline' 'nonce-abc'");
    // The script nonce is unaffected.
    expect(csp).toContain("script-src 'nonce-abc'");
  });

  it('opts into https images and extra sources', () => {
    const csp = generateCSP(webview, {
      allowAnyHttpsImages: true,
      connectSrc: ['https://api.example.com'],
      mediaSrc: ['https://cdn.example.com'],
      workerSrc: ["'self'"],
    });
    expect(csp).toContain('img-src vscode-resource: data: https:');
    expect(csp).toContain('connect-src https://api.example.com');
    expect(csp).toContain('media-src vscode-resource: https://cdn.example.com');
    expect(csp).toContain("worker-src vscode-resource: 'self'");
  });
});

describe('generateNonce', () => {
  it('produces 32 base64url characters, fresh every call', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(a).not.toBe(b);
  });
});

describe('createWebviewHtml', () => {
  it('assembles a full document with escaped values', () => {
    const html = createWebviewHtml({
      title: 'A <b>title</b>',
      csp: "default-src 'none'",
      styles: ['https://x/app.css'],
      scripts: ['https://x/app.js'],
      nonce: 'n1',
      body: '<div id="root"></div>',
    });

    expect(html).toContain('<title>A &lt;b&gt;title&lt;/b&gt;</title>');
    expect(html).toContain(
      '<meta http-equiv="Content-Security-Policy" content="default-src &#039;none&#039;">'
    );
    expect(html).toContain('<link rel="stylesheet" href="https://x/app.css">');
    expect(html).toContain('<script src="https://x/app.js" nonce="n1"></script>');
    expect(html).toContain('<div id="root"></div>');
  });

  it('omits the CSP meta and nonce attribute when not given', () => {
    const html = createWebviewHtml({ body: 'x', scripts: ['s.js'] });
    expect(html).not.toContain('Content-Security-Policy');
    expect(html).toContain('<script src="s.js"></script>');
  });
});
