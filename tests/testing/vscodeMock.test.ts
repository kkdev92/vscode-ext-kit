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

// ============================================
// Fidelity to the real vscode value classes (verified against the
// microsoft/vscode implementation, not assumed)
// ============================================

describe('createVSCodeMock: value-class fidelity', () => {
  describe('Range normalization', () => {
    it('swaps start and end when constructed reversed, as the real Range does', () => {
      const mock = createVSCodeMock(vi);
      const later = new mock.Position(2, 5);
      const earlier = new mock.Position(1, 0);

      const range = new mock.Range(later, earlier);

      expect(range.start).toBe(earlier);
      expect(range.end).toBe(later);
    });

    it('normalizes the numeric-overload form too', () => {
      const mock = createVSCodeMock(vi);

      const range = new mock.Range(3, 4, 1, 2);

      expect(range.start.line).toBe(1);
      expect(range.start.character).toBe(2);
      expect(range.end.line).toBe(3);
      expect(range.end.character).toBe(4);
    });

    it('a reversed Selection keeps anchor/active but exposes normalized start/end', () => {
      const mock = createVSCodeMock(vi);
      const anchor = new mock.Position(2, 0); // where the drag started (later)
      const active = new mock.Position(0, 3); // where the cursor is (earlier)

      const selection = new mock.Selection(anchor, active);

      expect(selection.anchor).toBe(anchor);
      expect(selection.active).toBe(active);
      expect(selection.isReversed).toBe(true);
      // Real vscode: start is always the earlier position.
      expect(selection.start).toBe(active);
      expect(selection.end).toBe(anchor);
    });
  });

  describe('EventEmitter snapshot delivery', () => {
    it('a listener disposing itself mid-fire does not starve later listeners', () => {
      const mock = createVSCodeMock(vi);
      const emitter = new mock.EventEmitter<string>();
      const secondSaw: string[] = [];
      const subscription = emitter.event(() => {
        subscription.dispose(); // one-shot listener
      });
      emitter.event((value) => {
        secondSaw.push(value);
      });

      emitter.fire('first');
      emitter.fire('second');

      // Real vscode delivers each fire to a snapshot of the listeners, so
      // the self-removal must not skip the second listener.
      expect(secondSaw).toEqual(['first', 'second']);
    });
  });

  describe('QuickPick/InputBox subscription disposal', () => {
    it('a disposed onDidAccept subscription stops receiving (QuickPick)', () => {
      const mock = createVSCodeMock(vi);
      const quickPick = mock.window.createQuickPick();
      const listener = vi.fn();
      const subscription = quickPick.onDidAccept(listener);

      subscription.dispose();
      quickPick._accept();

      expect(listener).not.toHaveBeenCalled();
    });

    it('a disposed onDidChangeValue subscription stops receiving (InputBox)', () => {
      const mock = createVSCodeMock(vi);
      const inputBox = mock.window.createInputBox();
      const listener = vi.fn();
      const subscription = inputBox.onDidChangeValue(listener);

      subscription.dispose();
      inputBox._setValue('typed');

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('Uri fidelity', () => {
    it('joinPath resolves . and .. segments like the real Uri.joinPath', () => {
      const mock = createVSCodeMock(vi);
      const base = mock.Uri.file('/a/b/c.txt');

      const parent = mock.Uri.joinPath(base, '..');
      const sibling = mock.Uri.joinPath(base, '..', 'd.txt');
      const dot = mock.Uri.joinPath(base, '.', 'e');

      expect(parent.path).toBe('/a/b');
      expect(sibling.path).toBe('/a/b/d.txt');
      expect(dot.path).toBe('/a/b/c.txt/e');
    });

    it('parse extracts the scheme instead of hardcoding file', () => {
      const mock = createVSCodeMock(vi);

      const untitled = mock.Uri.parse('untitled:Untitled-1');
      const plain = mock.Uri.parse('/just/a/path');

      expect(untitled.scheme).toBe('untitled');
      expect(untitled.path).toBe('Untitled-1');
      expect(plain.scheme).toBe('file');
    });
  });
});
