import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import {
  createMockTextEditor as createMockTextEditorWith,
  createMockTextDocument as createMockTextDocumentWith,
  createMockCancellationToken as createMockCancellationTokenWith,
  createMockUri,
  Selection,
  Position,
  Range,
  WorkspaceEdit as MockWorkspaceEdit,
} from '../../src/testing/index.js';
import {
  replaceText,
  getSelectedText,
  getAllSelectedText,
  insertAtCursor,
  getLine,
  getCurrentLine,
  applyEdits,
  transformSelection,
  transformAllSelections,
  moveCursor,
  selectRange,
  selectLine,
  selectWord,
  getFilePath,
  rangeFromOffsets,
  getTextInOffsetRange,
  resolvePositionsBatch,
  resolveOffsetsBatch,
  applyEditsGrouped,
  applyWorkspaceEdits,
} from '../../src/workspace/editor.js';

// Thin local re-binds so the rest of this file — written against the
// pre-testing-kit factories — doesn't need a `vi` argument at every call site.
const createMockTextEditor = (content?: string, languageId?: string) =>
  createMockTextEditorWith(vi, content, languageId);
const createMockTextDocument = (content?: string, languageId?: string) =>
  createMockTextDocumentWith(vi, content, languageId);
const createMockCancellationToken = (isCancellationRequested?: boolean) =>
  createMockCancellationTokenWith(vi, isCancellationRequested);
const Uri = createMockUri(vi);

describe('editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // `WorkspaceEdit` and `workspace.applyEdit` aren't part of the shared
    // vscode mock in tests/setup.ts, so they're injected here for the
    // `applyWorkspaceEdits` tests. Cast through `Record<string, unknown>`
    // because `vscode`/`vscode.workspace` are typed as read-only namespaces.
    (vscode as unknown as Record<string, unknown>).WorkspaceEdit = MockWorkspaceEdit;
    (vscode.workspace as unknown as Record<string, unknown>).applyEdit = vi
      .fn()
      .mockResolvedValue(true);
  });

  // ============================================
  // Text Operations
  // ============================================

  describe('replaceText', () => {
    it('replaces text in range', async () => {
      const editor = createMockTextEditor('hello world');
      const range = new Range(0, 0, 0, 5);

      const result = await replaceText(editor as never, range, 'goodbye');

      expect(result).toBe(true);
      expect(editor.edit).toHaveBeenCalled();
    });
  });

  describe('getSelectedText', () => {
    it('returns empty string when no selection', () => {
      const editor = createMockTextEditor('hello world');

      const text = getSelectedText(editor as never);

      expect(text).toBe('');
    });

    it('returns selected text', () => {
      const editor = createMockTextEditor('hello world');
      editor.selection = new Selection(0, 0, 0, 5);

      const text = getSelectedText(editor as never);

      expect(text).toBe('hello');
    });
  });

  describe('getAllSelectedText', () => {
    it('returns empty array when no selections', () => {
      const editor = createMockTextEditor('hello world');

      const texts = getAllSelectedText(editor as never);

      expect(texts).toEqual([]);
    });

    it('returns all selected texts', () => {
      const editor = createMockTextEditor('hello world foo');
      editor.selections = [new Selection(0, 0, 0, 5), new Selection(0, 12, 0, 15)];

      const texts = getAllSelectedText(editor as never);

      expect(texts).toEqual(['hello', 'foo']);
    });

    it('skips empty selections when mixed with non-empty ones', () => {
      const editor = createMockTextEditor('hello world');
      editor.selections = [
        new Selection(0, 0, 0, 5),
        new Selection(0, 6, 0, 6), // empty
        new Selection(0, 6, 0, 11),
      ];

      const texts = getAllSelectedText(editor as never);

      expect(texts).toEqual(['hello', 'world']);
    });
  });

  describe('insertAtCursor', () => {
    it('inserts text at cursor position', async () => {
      const editor = createMockTextEditor('hello world');
      editor.selection = new Selection(0, 5, 0, 5);

      const result = await insertAtCursor(editor as never, ' there');

      expect(result).toBe(true);
      expect(editor.edit).toHaveBeenCalled();
    });
  });

  describe('getLine', () => {
    it('returns line text', () => {
      const editor = createMockTextEditor('line one\nline two\nline three');

      expect(getLine(editor as never, 0)).toBe('line one');
      expect(getLine(editor as never, 1)).toBe('line two');
      expect(getLine(editor as never, 2)).toBe('line three');
    });

    it('returns empty string for invalid line number', () => {
      const editor = createMockTextEditor('hello');

      expect(getLine(editor as never, -1)).toBe('');
      expect(getLine(editor as never, 100)).toBe('');
    });
  });

  describe('getCurrentLine', () => {
    it('returns current line text', () => {
      const editor = createMockTextEditor('line one\nline two\nline three');
      editor.selection = new Selection(1, 0, 1, 0);

      const line = getCurrentLine(editor as never);

      expect(line).toBe('line two');
    });
  });

  describe('applyEdits', () => {
    it('applies multiple edits', async () => {
      const editor = createMockTextEditor('hello world');

      const result = await applyEdits(editor as never, [
        { range: new Range(0, 0, 0, 5), text: 'goodbye' },
        { range: new Range(0, 6, 0, 11), text: 'universe' },
      ]);

      expect(result).toBe(true);
      expect(editor.edit).toHaveBeenCalled();
    });

    it('handles empty edit array', async () => {
      const editor = createMockTextEditor('hello');

      const result = await applyEdits(editor as never, []);

      expect(result).toBe(true);
    });
  });

  describe('transformSelection', () => {
    it('transforms selected text', async () => {
      const editor = createMockTextEditor('hello world');
      editor.selection = new Selection(0, 0, 0, 5);

      const result = await transformSelection(editor as never, (text) => text.toUpperCase());

      expect(result).toBe(true);
      expect(editor.edit).toHaveBeenCalled();
    });

    it('returns false when no selection', async () => {
      const editor = createMockTextEditor('hello world');

      const result = await transformSelection(editor as never, (text) => text.toUpperCase());

      expect(result).toBe(false);
    });
  });

  describe('transformAllSelections', () => {
    it('transforms all selections', async () => {
      const editor = createMockTextEditor('hello world foo');
      editor.selections = [new Selection(0, 0, 0, 5), new Selection(0, 12, 0, 15)];

      const result = await transformAllSelections(editor as never, (text) => text.toUpperCase());

      expect(result).toBe(true);
      expect(editor.edit).toHaveBeenCalled();
    });

    it('provides index to transform function', async () => {
      const editor = createMockTextEditor('a b c');
      editor.selections = [new Selection(0, 0, 0, 1), new Selection(0, 2, 0, 3)];

      const transform = vi.fn((text, index) => `${index}:${text}`);
      await transformAllSelections(editor as never, transform);

      expect(transform).toHaveBeenCalledWith('a', 0);
      expect(transform).toHaveBeenCalledWith('b', 1);
    });

    it('returns false when no selections', async () => {
      const editor = createMockTextEditor('hello world');

      const result = await transformAllSelections(editor as never, (text) => text);

      expect(result).toBe(false);
    });
  });

  // ============================================
  // Cursor and Selection
  // ============================================

  describe('moveCursor', () => {
    it('moves cursor to position', () => {
      const editor = createMockTextEditor('hello\nworld');
      const position = new Position(1, 3);

      moveCursor(editor as never, position);

      expect(editor.selection.active.line).toBe(1);
      expect(editor.selection.active.character).toBe(3);
      expect(editor.revealRange).toHaveBeenCalled();
    });
  });

  describe('selectRange', () => {
    it('selects range', () => {
      const editor = createMockTextEditor('hello world');
      const range = new Range(0, 0, 0, 5);

      selectRange(editor as never, range);

      expect(editor.selection.start.character).toBe(0);
      expect(editor.selection.end.character).toBe(5);
      expect(editor.revealRange).toHaveBeenCalled();
    });
  });

  describe('selectLine', () => {
    it('selects entire line', () => {
      const editor = createMockTextEditor('line one\nline two');

      selectLine(editor as never, 1);

      expect(editor.selection.start.line).toBe(1);
      expect(editor.selection.start.character).toBe(0);
    });

    it('does nothing for invalid line', () => {
      const editor = createMockTextEditor('hello');
      const originalSelection = editor.selection;

      selectLine(editor as never, -1);

      expect(editor.selection).toBe(originalSelection);
    });
  });

  describe('selectWord', () => {
    it('selects word at cursor', () => {
      const editor = createMockTextEditor('hello world');
      editor.selection = new Selection(0, 2, 0, 2);

      const result = selectWord(editor as never);

      expect(result).toBe(true);
      expect(editor.revealRange).toHaveBeenCalled();
    });

    it('returns false when no word at cursor', () => {
      const editor = createMockTextEditor('   ');
      editor.selection = new Selection(0, 1, 0, 1);
      editor.document.getWordRangeAtPosition = vi.fn().mockReturnValue(undefined);

      const result = selectWord(editor as never);

      expect(result).toBe(false);
    });

    it('uses a custom word-matching regex when provided', () => {
      const editor = createMockTextEditor('foo-bar baz');
      editor.selection = new Selection(0, 5, 0, 5); // inside 'bar' of 'foo-bar'

      const result = selectWord(editor as never, /[\w-]+/);

      expect(result).toBe(true);
      expect(getSelectedText(editor as never)).toBe('foo-bar');
    });

    it('falls back to the default word definition without a regex', () => {
      const editor = createMockTextEditor('foo-bar baz');
      editor.selection = new Selection(0, 5, 0, 5); // inside 'bar' of 'foo-bar'

      selectWord(editor as never);

      expect(getSelectedText(editor as never)).toBe('bar');
    });
  });

  // ============================================
  // Document Info
  // ============================================

  describe('getFilePath', () => {
    it('returns fsPath and uri for local files', () => {
      const editor = createMockTextEditor('hello');

      const result = getFilePath(editor as never);

      expect(result).toEqual({ fsPath: '/mock/document.txt', uri: editor.document.uri });
    });

    it('returns fsPath and uri for Remote-SSH/WSL/Codespaces documents (vscode-remote scheme)', () => {
      const editor = createMockTextEditor('hello');
      editor.document.uri = {
        scheme: 'vscode-remote',
        fsPath: '/home/user/project/file.ts',
        path: '/home/user/project/file.ts',
        toString: () => 'vscode-remote://wsl+ubuntu/home/user/project/file.ts',
      } as never;

      const result = getFilePath(editor as never);

      expect(result).toEqual({
        fsPath: '/home/user/project/file.ts',
        uri: editor.document.uri,
      });
    });

    it('returns fsPath and uri for virtual file systems (vscode-vfs scheme)', () => {
      const editor = createMockTextEditor('hello');
      editor.document.uri = {
        scheme: 'vscode-vfs',
        fsPath: '/repo/file.ts',
        path: '/repo/file.ts',
        toString: () => 'vscode-vfs://github/owner/repo/file.ts',
      } as never;

      const result = getFilePath(editor as never);

      expect(result).toEqual({ fsPath: '/repo/file.ts', uri: editor.document.uri });
    });

    it('returns undefined for untitled documents', () => {
      const editor = createMockTextEditor('hello');
      editor.document.uri = { scheme: 'untitled', fsPath: '' } as never;

      const path = getFilePath(editor as never);

      expect(path).toBeUndefined();
    });
  });

  // ============================================
  // Offset / Position Utilities
  // ============================================

  describe('rangeFromOffsets', () => {
    it('builds a Range spanning two offsets', () => {
      const document = createMockTextDocument('hello\nworld');

      const range = rangeFromOffsets(document as never, 6, 11);

      expect(range.start).toEqual(new Position(1, 0));
      expect(range.end).toEqual(new Position(1, 5));
    });
  });

  describe('getTextInOffsetRange', () => {
    it('extracts text between two offsets', () => {
      const document = createMockTextDocument('hello\nworld');

      expect(getTextInOffsetRange(document as never, 6, 11)).toBe('world');
    });
  });

  describe('resolvePositionsBatch', () => {
    it('resolves multiple offsets in a single pass', () => {
      const document = createMockTextDocument('aaa\nbbb\nccc');

      const positions = resolvePositionsBatch(document as never, [0, 4, 9]);

      expect(positions).toEqual([new Position(0, 0), new Position(1, 0), new Position(2, 1)]);
    });

    it('returns an empty array for an empty input', () => {
      const document = createMockTextDocument('abc');

      expect(resolvePositionsBatch(document as never, [])).toEqual([]);
    });

    it('clamps out-of-range offsets like positionAt does', () => {
      const document = createMockTextDocument('abc');

      const [position] = resolvePositionsBatch(document as never, [999]);

      expect(position).toEqual(new Position(0, 3));
    });

    it('throws a CancellationError when the token is already cancelled', () => {
      const document = createMockTextDocument('abc');
      const token = createMockCancellationToken(true);

      expect(() => resolvePositionsBatch(document as never, [0], token as never)).toThrow();
    });
  });

  describe('resolveOffsetsBatch', () => {
    it('resolves multiple positions in a single pass', () => {
      const document = createMockTextDocument('aaa\nbbb\nccc');

      const offsets = resolveOffsetsBatch(document as never, [
        new Position(0, 0),
        new Position(1, 0),
        new Position(2, 1),
      ]);

      expect(offsets).toEqual([0, 4, 9]);
    });

    it('round-trips with resolvePositionsBatch', () => {
      const document = createMockTextDocument('one\ntwo\nthree');
      const original = [0, 2, 4, 6, 9, 12];

      const positions = resolvePositionsBatch(document as never, original);
      const roundTripped = resolveOffsetsBatch(document as never, positions);

      expect(roundTripped).toEqual(original);
    });

    it('returns an empty array for an empty input', () => {
      const document = createMockTextDocument('abc');

      expect(resolveOffsetsBatch(document as never, [])).toEqual([]);
    });

    it('throws a CancellationError when the token is already cancelled', () => {
      const document = createMockTextDocument('abc');
      const token = createMockCancellationToken(true);

      expect(() =>
        resolveOffsetsBatch(document as never, [new Position(0, 0)], token as never)
      ).toThrow();
    });
  });

  // ============================================
  // Workspace Edits
  // ============================================

  describe('applyEditsGrouped', () => {
    it('returns true without calling edit for an empty list', async () => {
      const editor = createMockTextEditor('hello');

      const result = await applyEditsGrouped(editor as never, []);

      expect(result).toBe(true);
      expect(editor.edit).not.toHaveBeenCalled();
    });

    it('groups multiple edit() calls with undo stops only at the ends', async () => {
      const editor = createMockTextEditor('hello world');

      const result = await applyEditsGrouped(editor as never, [
        (eb) => eb.insert(new Position(0, 0), 'A'),
        (eb) => eb.insert(new Position(0, 5), 'B'),
        (eb) => eb.insert(new Position(0, 11), 'C'),
      ]);

      expect(result).toBe(true);
      expect(editor.edit).toHaveBeenCalledTimes(3);
      const calls = editor.edit.mock.calls;
      expect(calls[0]?.[1]).toEqual({ undoStopBefore: true, undoStopAfter: false });
      expect(calls[1]?.[1]).toEqual({ undoStopBefore: false, undoStopAfter: false });
      expect(calls[2]?.[1]).toEqual({ undoStopBefore: false, undoStopAfter: true });
    });

    it('returns false if any edit in the sequence fails', async () => {
      const editor = createMockTextEditor('hello');
      editor.edit = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(false);

      const result = await applyEditsGrouped(editor as never, [
        (eb) => eb.insert(new Position(0, 0), 'A'),
        (eb) => eb.insert(new Position(0, 1), 'B'),
      ]);

      expect(result).toBe(false);
    });
  });

  describe('applyWorkspaceEdits', () => {
    it('applies edits across multiple files in one WorkspaceEdit', async () => {
      const uriA = Uri.file('/a.ts') as never;
      const uriB = Uri.file('/b.ts') as never;
      const rangeA = new Range(0, 0, 0, 3);
      const rangeB = new Range(1, 0, 1, 3);

      const result = await applyWorkspaceEdits([
        { uri: uriA, range: rangeA, newText: 'foo' },
        { uri: uriB, range: rangeB, newText: 'bar' },
      ]);

      expect(result).toBe(true);
      expect(vscode.workspace.applyEdit).toHaveBeenCalledTimes(1);

      const appliedEdit = vi.mocked(vscode.workspace.applyEdit).mock
        .calls[0]?.[0] as unknown as InstanceType<typeof MockWorkspaceEdit>;
      expect(appliedEdit.size).toBe(2);
      expect(appliedEdit._getEntries(uriA)).toEqual([
        { range: rangeA, newText: 'foo', metadata: undefined },
      ]);
      expect(appliedEdit._getEntries(uriB)).toEqual([
        { range: rangeB, newText: 'bar', metadata: undefined },
      ]);
    });

    it('attaches label/needsConfirmation metadata to every entry', async () => {
      const uri = Uri.file('/a.ts') as never;

      await applyWorkspaceEdits([{ uri, range: new Range(0, 0, 0, 1), newText: 'x' }], {
        label: 'Rename symbol across files',
        needsConfirmation: true,
      });

      const appliedEdit = vi.mocked(vscode.workspace.applyEdit).mock
        .calls[0]?.[0] as unknown as InstanceType<typeof MockWorkspaceEdit>;
      expect(appliedEdit._getEntries(uri)[0]?.metadata).toEqual({
        label: 'Rename symbol across files',
        needsConfirmation: true,
      });
    });

    it('passes isRefactoring through as applyEdit metadata', async () => {
      const uri = Uri.file('/a.ts') as never;

      await applyWorkspaceEdits([{ uri, range: new Range(0, 0, 0, 1), newText: 'x' }], {
        isRefactoring: true,
      });

      expect(vscode.workspace.applyEdit).toHaveBeenCalledWith(expect.anything(), {
        isRefactoring: true,
      });
    });

    it('returns the boolean result of workspace.applyEdit', async () => {
      (vscode.workspace as unknown as Record<string, unknown>).applyEdit = vi
        .fn()
        .mockResolvedValue(false);
      const uri = Uri.file('/a.ts') as never;

      const result = await applyWorkspaceEdits([
        { uri, range: new Range(0, 0, 0, 1), newText: 'x' },
      ]);

      expect(result).toBe(false);
    });

    it('throws a CancellationError when the token is already cancelled, without calling applyEdit', async () => {
      const uri = Uri.file('/a.ts') as never;
      const token = createMockCancellationToken(true);

      await expect(
        applyWorkspaceEdits([{ uri, range: new Range(0, 0, 0, 1), newText: 'x' }], {
          token: token as never,
        })
      ).rejects.toThrow();
      expect(vscode.workspace.applyEdit).not.toHaveBeenCalled();
    });
  });
});
