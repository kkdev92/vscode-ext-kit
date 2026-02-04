import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { createMockExtensionContext, createMockWebview, ViewColumn } from './mocks/vscode.js';
import {
  createWebViewPanel,
  generateCSP,
  generateNonce,
  createWebViewHtml,
  escapeHtml,
} from '../src/webview.js';

// Mock fs/promises
vi.mock('fs/promises', () => ({
  readFile: vi.fn().mockResolvedValue('<html>{{title}}</html>'),
}));

describe('webview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // createWebViewPanel
  // ============================================

  describe('createWebViewPanel', () => {
    it('creates a webview panel with default options', () => {
      const context = createMockExtensionContext();

      const panel = createWebViewPanel(context as never, {
        viewType: 'test.view',
        title: 'Test View',
      });

      expect(panel.native).toBeDefined();
      expect(panel.native.viewType).toBe('test.view');
    });

    it('creates a webview panel with custom options', () => {
      const context = createMockExtensionContext();

      const panel = createWebViewPanel(context as never, {
        viewType: 'test.view',
        title: 'Test View',
        column: ViewColumn.Two,
        enableScripts: true,
        enableForms: true,
        retainContext: true,
        enableFindWidget: true,
      });

      expect(panel.native).toBeDefined();
    });

    it('sets HTML content', () => {
      const context = createMockExtensionContext();

      const panel = createWebViewPanel(context as never, {
        viewType: 'test.view',
        title: 'Test',
      });

      panel.setHtml('<html><body>Hello</body></html>');

      expect(panel.native.webview.html).toBe('<html><body>Hello</body></html>');
    });

    it('posts message to webview', async () => {
      const context = createMockExtensionContext();

      const panel = createWebViewPanel(context as never, {
        viewType: 'test.view',
        title: 'Test',
      });

      const result = await panel.postMessage({ type: 'update', payload: { data: 'test' } });

      expect(result).toBe(true);
    });

    it('registers message handler', () => {
      const context = createMockExtensionContext();

      const panel = createWebViewPanel(context as never, {
        viewType: 'test.view',
        title: 'Test',
      });

      const handler = vi.fn();
      const disposable = panel.onMessage(handler);

      expect(disposable).toBeDefined();
      expect(typeof disposable.dispose).toBe('function');
    });

    it('registers view state change handler', () => {
      const context = createMockExtensionContext();

      const panel = createWebViewPanel(context as never, {
        viewType: 'test.view',
        title: 'Test',
      });

      const handler = vi.fn();
      const disposable = panel.onDidChangeViewState(handler);

      expect(disposable).toBeDefined();
    });

    it('registers dispose handler', () => {
      const context = createMockExtensionContext();

      const panel = createWebViewPanel(context as never, {
        viewType: 'test.view',
        title: 'Test',
      });

      const handler = vi.fn();
      const disposable = panel.onDidDispose(handler);

      expect(disposable).toBeDefined();
    });

    it('reveals the panel', () => {
      const context = createMockExtensionContext();

      const panel = createWebViewPanel(context as never, {
        viewType: 'test.view',
        title: 'Test',
      });

      // Should not throw
      expect(() => panel.reveal(ViewColumn.Two)).not.toThrow();
    });

    it('converts URI to webview URI', () => {
      const context = createMockExtensionContext();

      const panel = createWebViewPanel(context as never, {
        viewType: 'test.view',
        title: 'Test',
      });

      const uri = vscode.Uri.file('/test/file.js');
      const webviewUri = panel.asWebviewUri(uri);

      expect(webviewUri).toBeDefined();
    });

    it('exposes native panel', () => {
      const context = createMockExtensionContext();

      const panel = createWebViewPanel(context as never, {
        viewType: 'test.view',
        title: 'Test',
      });

      expect(panel.native).toBeDefined();
      expect(panel.native.viewType).toBe('test.view');
    });

    it('disposes panel', () => {
      const context = createMockExtensionContext();

      const panel = createWebViewPanel(context as never, {
        viewType: 'test.view',
        title: 'Test',
      });

      // Should not throw
      expect(() => panel.dispose()).not.toThrow();
    });

    it('adds panel to context subscriptions', () => {
      const context = createMockExtensionContext();

      createWebViewPanel(context as never, {
        viewType: 'test.view',
        title: 'Test',
      });

      expect(context.subscriptions).toHaveLength(1);
    });
  });

  // ============================================
  // generateCSP
  // ============================================

  describe('generateCSP', () => {
    it('generates basic CSP', () => {
      const webview = createMockWebview();

      const csp = generateCSP(webview as never);

      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain('img-src');
      expect(csp).toContain('font-src');
      expect(csp).toContain('script-src');
      expect(csp).toContain('style-src');
    });

    it('includes nonce in CSP', () => {
      const webview = createMockWebview();

      const csp = generateCSP(webview as never, { nonce: 'abc123' });

      expect(csp).toContain("'nonce-abc123'");
    });

    it('includes additional script sources', () => {
      const webview = createMockWebview();

      const csp = generateCSP(webview as never, { scriptSrc: ['https://cdn.example.com'] });

      expect(csp).toContain('https://cdn.example.com');
    });

    it('includes connect sources', () => {
      const webview = createMockWebview();

      const csp = generateCSP(webview as never, { connectSrc: ['https://api.example.com'] });

      expect(csp).toContain('connect-src');
      expect(csp).toContain('https://api.example.com');
    });

    it('does not include connect-src when empty', () => {
      const webview = createMockWebview();

      const csp = generateCSP(webview as never);

      expect(csp).not.toContain('connect-src');
    });
  });

  // ============================================
  // generateNonce
  // ============================================

  describe('generateNonce', () => {
    it('generates 32-character nonce', () => {
      const nonce = generateNonce();

      expect(nonce).toHaveLength(32);
    });

    it('generates unique nonces', () => {
      const nonces = new Set<string>();
      for (let i = 0; i < 100; i++) {
        nonces.add(generateNonce());
      }

      expect(nonces.size).toBe(100);
    });

    it('generates base64url-safe nonces', () => {
      const nonce = generateNonce();

      // base64url uses A-Z, a-z, 0-9, -, _
      expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
    });
  });

  // ============================================
  // createWebViewHtml
  // ============================================

  describe('createWebViewHtml', () => {
    it('creates basic HTML structure', () => {
      const html = createWebViewHtml({ body: '<div>Content</div>' });

      expect(html).toContain('<!DOCTYPE html>');
      expect(html).toContain('<html lang="en">');
      expect(html).toContain('<div>Content</div>');
    });

    it('includes title', () => {
      const html = createWebViewHtml({
        title: 'My Title',
        body: '',
      });

      expect(html).toContain('<title>My Title</title>');
    });

    it('includes CSP meta tag', () => {
      const html = createWebViewHtml({
        csp: "default-src 'none'",
        body: '',
      });

      expect(html).toContain('http-equiv="Content-Security-Policy"');
      // Single quotes are escaped in HTML attributes
      expect(html).toContain('default-src');
    });

    it('includes style links', () => {
      const html = createWebViewHtml({
        styles: ['style1.css', 'style2.css'],
        body: '',
      });

      expect(html).toContain('<link rel="stylesheet" href="style1.css">');
      expect(html).toContain('<link rel="stylesheet" href="style2.css">');
    });

    it('includes script tags', () => {
      const html = createWebViewHtml({
        scripts: ['script1.js', 'script2.js'],
        body: '',
      });

      expect(html).toContain('<script src="script1.js"></script>');
      expect(html).toContain('<script src="script2.js"></script>');
    });

    it('includes nonce in script tags', () => {
      const html = createWebViewHtml({
        scripts: ['script.js'],
        nonce: 'abc123',
        body: '',
      });

      expect(html).toContain('nonce="abc123"');
    });

    it('escapes HTML in attributes', () => {
      const html = createWebViewHtml({
        title: '<script>alert("xss")</script>',
        body: '',
      });

      expect(html).not.toContain('<script>alert');
      expect(html).toContain('&lt;script&gt;');
    });
  });

  // ============================================
  // escapeHtml
  // ============================================

  describe('escapeHtml', () => {
    it('escapes ampersand', () => {
      expect(escapeHtml('a & b')).toBe('a &amp; b');
    });

    it('escapes less than', () => {
      expect(escapeHtml('a < b')).toBe('a &lt; b');
    });

    it('escapes greater than', () => {
      expect(escapeHtml('a > b')).toBe('a &gt; b');
    });

    it('escapes double quotes', () => {
      expect(escapeHtml('a "b" c')).toBe('a &quot;b&quot; c');
    });

    it('escapes single quotes', () => {
      expect(escapeHtml("a 'b' c")).toBe('a &#039;b&#039; c');
    });

    it('escapes multiple characters', () => {
      expect(escapeHtml('<div class="test">')).toBe('&lt;div class=&quot;test&quot;&gt;');
    });

    it('returns empty string for empty input', () => {
      expect(escapeHtml('')).toBe('');
    });
  });
});
