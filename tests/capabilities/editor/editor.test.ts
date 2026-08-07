/**
 * Unit suite for the portable editor model against `FakeEditor`. It protects
 * active-editor freshness, UTF-16 position math, batch/transaction semantics,
 * selection helpers, and undo grouping. Failures should be traced through
 * `EditorService`/`ActiveEditor` before the real VS Code editor adapter.
 */
import { describe, expect, it } from 'vitest';

import { createEditorService } from '../../../src/capabilities/editor/editor.js';
import type { ActiveEditor } from '../../../src/capabilities/editor/editor.js';
import { createFakeEditor } from '../../../src/testing/fakes/fake-editor.js';
import type { FakeEditor } from '../../../src/testing/fakes/fake-editor.js';
import type { TextRange } from '../../../src/foundation/platform/ports.js';

const at = (line: number, character: number): { line: number; character: number } => ({
  line,
  character,
});
const span = (
  startLine: number,
  startCharacter: number,
  endLine: number,
  endCharacter: number
): TextRange => ({ start: at(startLine, startCharacter), end: at(endLine, endCharacter) });

/** Opens a document and returns the service's view of it plus the fake behind it. */
function open(
  text: string,
  selections?: readonly TextRange[]
): { editor: ActiveEditor; capability: FakeEditor } {
  const capability = createFakeEditor();
  capability._open({ text, ...(selections === undefined ? {} : { selections }) });
  const editor = createEditorService(capability).active;
  if (editor === undefined) {
    throw new Error('expected an active editor');
  }
  return { editor, capability };
}

describe('EditorService', () => {
  it('reports no active editor when none is open', () => {
    expect(createEditorService(createFakeEditor()).active).toBeUndefined();
  });

  it('re-resolves the active editor on every access', () => {
    // A handler awaits, the user switches files, and the next read has to see
    // the new document -- a captured editor would keep editing the old one.
    const capability = createFakeEditor();
    const editors = createEditorService(capability);
    capability._open({ text: 'first' });
    expect(editors.active?.text()).toBe('first');

    capability._open({ text: 'second' });
    expect(editors.active?.text()).toBe('second');

    capability._close();
    expect(editors.active).toBeUndefined();
  });
});

describe('reading', () => {
  it('returns the primary selection text, and empty when the cursor is a caret', () => {
    expect(open('hello world', [span(0, 0, 0, 5)]).editor.selectedText()).toBe('hello');
    expect(open('hello world', [span(0, 3, 0, 3)]).editor.selectedText()).toBe('');
  });

  it('returns every non-empty selection, skipping bare carets', () => {
    const { editor } = open('alpha beta gamma', [
      span(0, 0, 0, 5),
      span(0, 6, 0, 6),
      span(0, 11, 0, 16),
    ]);

    expect(editor.selectedTexts()).toEqual(['alpha', 'gamma']);
  });

  it('reads a line by number, and empty for one that does not exist', () => {
    const { editor } = open('one\ntwo\nthree');

    expect(editor.line(1)).toBe('two');
    expect(editor.line(2)).toBe('three');
    expect(editor.line(9)).toBe('');
    expect(editor.line(-1)).toBe('');
  });

  it('reads the line the cursor sits on', () => {
    expect(open('one\ntwo\nthree', [span(1, 1, 1, 1)]).editor.currentLine()).toBe('two');
  });

  it('reads text between two document offsets', () => {
    const { editor } = open('const value = 1;\nconst other = 2;');
    const text = editor.text();
    const index = text.indexOf('other');

    expect(editor.textOfOffsets(index, index + 5)).toBe('other');
  });

  it('describes where the document lives, and nothing for an untitled one', () => {
    const capability = createFakeEditor();
    capability._open({ text: '', uri: 'file:/workspace/a.ts' });
    expect(createEditorService(capability).active?.location()?.fsPath).toBe('/workspace/a.ts');

    capability._open({ text: '', uri: 'untitled:Untitled-1' });
    expect(createEditorService(capability).active?.location()).toBeUndefined();
  });
});

describe('editing', () => {
  it('replaces a span', async () => {
    const { editor, capability } = open('hello world');

    await expect(editor.replace(span(0, 0, 0, 5), 'goodbye')).resolves.toBe(true);

    expect(capability._text()).toBe('goodbye world');
  });

  it('inserts at the cursor', async () => {
    const { editor, capability } = open('hello world', [span(0, 5, 0, 5)]);

    await editor.insertAtCursor(',');

    expect(capability._text()).toBe('hello, world');
  });

  it('applies a batch against the document as it was, not one edit at a time', async () => {
    // Both ranges are stated against the original text. An implementation that
    // applied them front to back would shift the second one.
    const { editor, capability } = open('aaa bbb ccc');

    await editor.edit([
      { range: span(0, 0, 0, 3), text: 'xxxxxx' },
      { range: span(0, 8, 0, 11), text: 'y' },
    ]);

    expect(capability._text()).toBe('xxxxxx bbb y');
  });

  it('reports a refused edit rather than pretending it landed', async () => {
    const { editor, capability } = open('hello');
    capability._refuseNextEdit();

    await expect(editor.replace(span(0, 0, 0, 5), 'bye')).resolves.toBe(false);

    expect(capability._text()).toBe('hello');
  });

  it('transforms the primary selection', async () => {
    const { editor, capability } = open('hello world', [span(0, 0, 0, 5)]);

    await expect(editor.transformSelection((text) => text.toUpperCase())).resolves.toBe(true);

    expect(capability._text()).toBe('HELLO world');
  });

  it('refuses to transform when nothing is selected', async () => {
    const { editor, capability } = open('hello', [span(0, 2, 0, 2)]);

    await expect(editor.transformSelection((text) => text.toUpperCase())).resolves.toBe(false);

    expect(capability._text()).toBe('hello');
  });

  it('transforms every selection, passing its index', async () => {
    const { editor, capability } = open('aaa bbb ccc', [span(0, 0, 0, 3), span(0, 8, 0, 11)]);

    await expect(
      editor.transformSelections((text, index) => `${text}${String(index)}`)
    ).resolves.toBe(true);

    expect(capability._text()).toBe('aaa0 bbb ccc1');
  });

  it('refuses to transform selections when they are all carets', async () => {
    const { editor } = open('hello', [span(0, 1, 0, 1), span(0, 3, 0, 3)]);

    await expect(editor.transformSelections((text) => text)).resolves.toBe(false);
  });
});

describe('selection', () => {
  it('moves the cursor and reveals it', () => {
    const { editor, capability } = open('one\ntwo\nthree');

    editor.moveCursor(at(2, 1));

    expect(editor.selections).toEqual([span(2, 1, 2, 1)]);
    expect(capability.revealed).toEqual([span(2, 1, 2, 1)]);
  });

  it('selects a whole line, and ignores one that does not exist', () => {
    const { editor } = open('one\ntwo\nthree');

    editor.selectLine(1);
    expect(editor.selectedText()).toBe('two');

    editor.selectLine(99);
    expect(editor.selectedText()).toBe('two');
  });

  it('selects the word under the cursor', () => {
    const { editor } = open('const value = 1;', [span(0, 8, 0, 8)]);

    expect(editor.selectWord()).toBe(true);
    expect(editor.selectedText()).toBe('value');
  });

  it('honours a custom word pattern', () => {
    const { editor } = open('use kebab-case-name here', [span(0, 8, 0, 8)]);

    expect(editor.selectWord(/[\w-]+/)).toBe(true);
    expect(editor.selectedText()).toBe('kebab-case-name');
  });

  it('reports no word when the cursor is not on one', () => {
    const { editor } = open('   ', [span(0, 1, 0, 1)]);

    expect(editor.selectWord()).toBe(false);
  });
});

describe('offset arithmetic', () => {
  it('builds a range from two offsets across a line break', () => {
    const { editor } = open('one\ntwo\nthree');

    // 'two' starts at offset 4 and ends at 7.
    expect(editor.rangeOfOffsets(4, 7)).toEqual(span(1, 0, 1, 3));
  });

  it('resolves many offsets in one pass', () => {
    const { editor } = open('one\ntwo\nthree');

    expect(editor.positionsAt([0, 4, 8])).toEqual([at(0, 0), at(1, 0), at(2, 0)]);
  });

  it('clamps an out-of-range offset to the document', () => {
    const { editor } = open('abc');

    expect(editor.positionsAt([-5, 999])).toEqual([at(0, 0), at(0, 3)]);
  });

  it('resolves positions back to offsets', () => {
    const { editor } = open('one\ntwo\nthree');

    expect(editor.offsetsAt([at(0, 0), at(1, 0), at(2, 2)])).toEqual([0, 4, 10]);
  });

  it('returns empty without touching the document for an empty batch', () => {
    const { editor } = open('anything');

    expect(editor.positionsAt([])).toEqual([]);
    expect(editor.offsetsAt([])).toEqual([]);
  });

  it('stops a large batch when the operation is aborted', () => {
    const { editor } = open('one\ntwo\nthree');
    const controller = new AbortController();
    controller.abort();

    expect(() => editor.positionsAt([0, 1, 2], controller.signal)).toThrow();
    expect(() => editor.offsetsAt([at(0, 0)], controller.signal)).toThrow();
  });

  it('rebuilds its line table per call, so an edit cannot make offsets stale', async () => {
    // A cached table would still describe the pre-edit document here, and wrong
    // offsets corrupt a file rather than merely returning a wrong answer.
    const { editor } = open('one\ntwo');
    expect(editor.positionsAt([4])).toEqual([at(1, 0)]);

    await editor.edit([{ range: span(0, 0, 0, 0), text: 'XXXX' }]);

    expect(editor.positionsAt([4])).toEqual([at(0, 4)]);
  });
});

describe('cross-file edits', () => {
  it('passes the entries and metadata through', async () => {
    const capability = createFakeEditor();
    const editors = createEditorService(capability);
    const uri = { scheme: 'file', path: '/a.ts', fsPath: '/a.ts', toString: () => 'file:///a.ts' };

    await expect(
      editors.editFiles([{ uri, range: span(0, 0, 0, 1), text: 'x' }], {
        label: 'Rename',
        needsConfirmation: true,
      })
    ).resolves.toBe(true);

    expect(capability.workspaceEdits).toHaveLength(1);
    expect(capability.workspaceEdits[0]?.options).toEqual({
      label: 'Rename',
      needsConfirmation: true,
    });
  });

  it('does not need an open editor', async () => {
    const capability = createFakeEditor();

    await expect(createEditorService(capability).editFiles([])).resolves.toBe(true);
  });
});

describe('editStages', () => {
  it('lets each stage see what the previous one left behind', async () => {
    const { editor, capability } = open('b\na\nc', [span(0, 0, 2, 1)]);

    // Sort, then dedupe what sorting produced. One batch cannot express this:
    // both stages would be resolved against 'b\na\nc'.
    await editor.editStages([
      (current) =>
        current.selections.map((range) => ({
          range,
          text: current.text(range).split('\n').sort().join('\n'),
        })),
      (current) =>
        current.selections.map((range) => ({
          range,
          text: [...new Set(current.text(range).split('\n'))].join('\n'),
        })),
    ]);

    expect(capability._text()).toBe('a\nb\nc');
  });

  it('joins the stages into one undo step', async () => {
    const { editor, capability } = open('aaa bbb ccc');

    await editor.editStages([
      () => [{ range: span(0, 0, 0, 3), text: 'x' }],
      () => [{ range: span(0, 2, 0, 5), text: 'y' }],
      () => [{ range: span(0, 4, 0, 6), text: 'z' }],
    ]);

    // Open, add, close: the user-facing contract is one undo for the whole
    // transformation pipeline, not one undo per internal stage.
    expect(capability.undoStops).toEqual(['before', 'none', 'after']);
  });

  it('is its own step when there is only one stage', async () => {
    const { editor, capability } = open('aaa');

    await editor.editStages([() => [{ range: span(0, 0, 0, 3), text: 'x' }]]);

    expect(capability.undoStops).toEqual(['both']);
  });

  it('stops at the first refusal rather than applying later stages', async () => {
    const { editor, capability } = open('aaa bbb');
    capability._refuseNextEdit();
    const ran: number[] = [];

    await expect(
      editor.editStages([
        () => {
          ran.push(1);
          return [{ range: span(0, 0, 0, 3), text: 'x' }];
        },
        () => {
          ran.push(2);
          return [{ range: span(0, 4, 0, 7), text: 'y' }];
        },
      ])
    ).resolves.toBe(false);

    // Stage 2 would have been computed against a document stage 1 never changed.
    expect(ran).toEqual([1]);
    expect(capability._text()).toBe('aaa bbb');
  });

  it('skips a stage with nothing to do without breaking the grouping', async () => {
    const { editor, capability } = open('aaa bbb');

    await editor.editStages([
      () => [{ range: span(0, 0, 0, 3), text: 'x' }],
      () => [],
      () => [{ range: span(0, 2, 0, 5), text: 'z' }],
    ]);

    expect(capability.undoStops).toEqual(['before', 'after']);
  });

  /**
   * A boundary belongs to the first and last stage that *edits*, not to the
   * first and last in the list — a stage is free to decide it has nothing to
   * do. Losing either one merges this call's work with whatever the user did
   * next to it, so a single undo takes back more than the command ever changed.
   */
  describe('when the stage at an end has nothing to do', () => {
    it('still opens the step, from the first stage that edits', async () => {
      const { editor, capability } = open('aaa bbb');

      await editor.editStages([
        () => [],
        () => [{ range: span(0, 0, 0, 3), text: 'x' }],
        () => [{ range: span(0, 2, 0, 5), text: 'z' }],
      ]);

      expect(capability.undoStops).toEqual(['before', 'after']);
    });

    it('still closes the step, after the last stage that edits', async () => {
      const { editor, capability } = open('aaa bbb');

      await editor.editStages([
        () => [{ range: span(0, 0, 0, 3), text: 'x' }],
        () => [{ range: span(0, 2, 0, 5), text: 'z' }],
        () => [],
      ]);

      expect(capability.undoStops).toEqual(['before', 'none', 'after']);
    });

    it('closes the step even when the only stage that edits is in the middle', async () => {
      const { editor, capability } = open('aaa bbb');

      await editor.editStages([() => [], () => [{ range: span(0, 0, 0, 3), text: 'x' }], () => []]);

      expect(capability.undoStops).toEqual(['before', 'after']);
    });

    it('opens nothing at all when no stage edits', async () => {
      const { editor, capability } = open('aaa bbb');

      await expect(editor.editStages([() => [], () => []])).resolves.toBe(true);

      expect(capability.undoStops).toEqual([]);
      expect(capability._text()).toBe('aaa bbb');
    });
  });

  it('accepts an async stage', async () => {
    const { editor, capability } = open('aaa', [span(0, 0, 0, 3)]);

    await editor.editStages([
      (current) => Promise.resolve(current.selections.map((range) => ({ range, text: 'x' }))),
    ]);

    expect(capability._text()).toBe('x');
  });

  it('does nothing for an empty stage list', async () => {
    const { editor, capability } = open('aaa');

    await expect(editor.editStages([])).resolves.toBe(true);

    expect(capability.undoStops).toEqual([]);
  });
});
