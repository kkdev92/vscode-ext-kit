import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockTextEditor,
  Selection,
  Position,
  Range,
} from './mocks/vscode.js';
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
  getLineCount,
  getDocumentText,
  getFilePath,
  isDirty,
  getLanguageId,
} from '../src/editor.js';

describe('editor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  // ============================================
  // Document Info
  // ============================================

  describe('getLineCount', () => {
    it('returns line count', () => {
      const editor = createMockTextEditor('line 1\nline 2\nline 3');

      expect(getLineCount(editor as never)).toBe(3);
    });
  });

  describe('getDocumentText', () => {
    it('returns full document text', () => {
      const content = 'hello\nworld';
      const editor = createMockTextEditor(content);

      expect(getDocumentText(editor as never)).toBe(content);
    });
  });

  describe('getFilePath', () => {
    it('returns file path', () => {
      const editor = createMockTextEditor('hello');

      const path = getFilePath(editor as never);

      expect(path).toBe('/mock/document.txt');
    });

    it('returns undefined for untitled documents', () => {
      const editor = createMockTextEditor('hello');
      editor.document.uri = { scheme: 'untitled', fsPath: '' } as never;

      const path = getFilePath(editor as never);

      expect(path).toBeUndefined();
    });
  });

  describe('isDirty', () => {
    it('returns dirty status', () => {
      const editor = createMockTextEditor('hello');

      expect(isDirty(editor as never)).toBe(false);

      editor.document.isDirty = true;
      expect(isDirty(editor as never)).toBe(true);
    });
  });

  describe('getLanguageId', () => {
    it('returns language id', () => {
      const editor = createMockTextEditor('const x = 1;', 'typescript');

      expect(getLanguageId(editor as never)).toBe('typescript');
    });
  });
});
