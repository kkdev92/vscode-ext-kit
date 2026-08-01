import { describe, it, expect, vi } from 'vitest';
import { createVSCodeMock, ColorThemeKind, TextEditorRevealType } from '../../src/testing/index.js';

/**
 * Direct tests for the parts of `createVSCodeMock` the kit's own runtime never
 * touches, and which are therefore invisible to
 * `testing-kit-coverage.test.ts`'s scan: APIs a *consumer* extension calls.
 * Enum values are asserted against the real numbers from `@types/vscode`,
 * because a mock enum that disagrees with VS Code makes a test pass against
 * behavior the extension host would never produce.
 */
describe('createVSCodeMock: consumer-facing surface', () => {
  describe('version', () => {
    it('reports a plausible version string', () => {
      const mock = createVSCodeMock(vi);

      expect(mock.version).toBe('1.125.0');
    });

    it('is distinct from TextDocument.version, which is a document revision', async () => {
      const mock = createVSCodeMock(vi);
      const doc = await mock.workspace.openTextDocument();

      expect(typeof mock.version).toBe('string');
      expect(typeof doc.version).toBe('number');
    });
  });

  describe('enums', () => {
    it('ColorThemeKind matches the real numeric values', () => {
      expect(ColorThemeKind).toEqual({
        Light: 1,
        Dark: 2,
        HighContrast: 3,
        HighContrastLight: 4,
      });
    });

    it('TextEditorRevealType matches the real numeric values', () => {
      expect(TextEditorRevealType).toEqual({
        Default: 0,
        InCenter: 1,
        InCenterIfOutsideViewport: 2,
        AtTop: 3,
      });
    });

    it('exposes both enums on the module mock', () => {
      const mock = createVSCodeMock(vi);

      expect(mock.ColorThemeKind).toBe(ColorThemeKind);
      expect(mock.TextEditorRevealType).toBe(TextEditorRevealType);
    });
  });

  describe('color theme', () => {
    it('starts on a dark theme', () => {
      const mock = createVSCodeMock(vi);

      expect(mock.window.activeColorTheme.kind).toBe(ColorThemeKind.Dark);
    });

    it('_setColorTheme updates activeColorTheme and notifies listeners', () => {
      const mock = createVSCodeMock(vi);
      const seen: number[] = [];
      mock.window.onDidChangeActiveColorTheme((theme) => seen.push(theme.kind));

      mock.window._setColorTheme(ColorThemeKind.Light);

      expect(mock.window.activeColorTheme.kind).toBe(ColorThemeKind.Light);
      expect(seen).toEqual([ColorThemeKind.Light]);
    });

    it('stops notifying a disposed listener', () => {
      const mock = createVSCodeMock(vi);
      const seen: number[] = [];
      const subscription = mock.window.onDidChangeActiveColorTheme((t) => seen.push(t.kind));

      subscription.dispose();
      mock.window._setColorTheme(ColorThemeKind.HighContrast);

      expect(seen).toEqual([]);
      // The state still moved, only the notification was unsubscribed.
      expect(mock.window.activeColorTheme.kind).toBe(ColorThemeKind.HighContrast);
    });
  });

  describe('file dialogs', () => {
    it('resolve undefined by default, as a cancelled dialog does', async () => {
      const mock = createVSCodeMock(vi);

      await expect(mock.window.showOpenDialog()).resolves.toBeUndefined();
      await expect(mock.window.showSaveDialog()).resolves.toBeUndefined();
    });

    it('record the options they were called with', async () => {
      const mock = createVSCodeMock(vi);

      await mock.window.showOpenDialog({ canSelectMany: false });

      expect(mock.window.showOpenDialog.mock.calls[0]).toEqual([{ canSelectMany: false }]);
    });
  });

  describe('MockFn shape', () => {
    it('exposes mock.results, so the object a factory returned can be asserted on', () => {
      const mock = createVSCodeMock(vi);

      const channel = mock.window.createOutputChannel('demo', { log: true });
      const [firstResult] = mock.window.createOutputChannel.mock.results;

      expect(firstResult?.type).toBe('return');
      expect(firstResult?.value).toBe(channel);
    });

    it('supports the *Once helpers a per-test override relies on', async () => {
      const mock = createVSCodeMock(vi);
      mock.window.showInputBox.mockResolvedValueOnce('first');

      await expect(mock.window.showInputBox()).resolves.toBe('first');
      // Falls back to the default (undefined) once the queued value is spent.
      await expect(mock.window.showInputBox()).resolves.toBeUndefined();
    });
  });
});
