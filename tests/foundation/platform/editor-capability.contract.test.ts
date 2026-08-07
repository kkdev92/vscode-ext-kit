/**
 * Shared EditorCapability contract for the fake and VS Code adapter, followed by
 * adapter-only identity/conversion checks. The independent class-based `vscode`
 * stand-in catches plain-data/platform-object leaks; change this file whenever
 * the editor port, fake semantics or adapter conversion changes.
 */
import { describe, expect, it, vi } from 'vitest';

import type { EditorCapability, TextRange } from '../../../src/foundation/platform/ports.js';

/**
 * A stand-in for `vscode.window.activeTextEditor` and the text model behind it.
 *
 * Deliberately built a different way than the fake: the document here is an
 * array of lines and the positions are real classes with `instanceof`, which is
 * how VS Code actually models it — the fake keeps a flat string and computes
 * offsets. Two implementations that disagree cannot both pass this suite, which
 * is the point: a helper shared by both sides would let one wrong idea satisfy
 * the suite twice and prove nothing.
 *
 * The classes matter beyond style. `TextEditorEdit.replace` validates with
 * `instanceof Range`, so this stand-in throws on a plain object exactly as the
 * real API does — that is what proves the adapter converts.
 */
const vscodeMock = vi.hoisted(() => {
  // Fields are declared and assigned rather than declared as constructor
  // parameters: `erasableSyntaxOnly` is on repo-wide, and parameter properties
  // are not erasable.
  class Position {
    readonly line: number;
    readonly character: number;
    constructor(line: number, character: number) {
      this.line = line;
      this.character = character;
    }
  }
  class Range {
    readonly start: Position;
    readonly end: Position;
    constructor(start: Position, end: Position) {
      this.start = start;
      this.end = end;
    }
  }
  class Selection extends Range {
    readonly anchor: Position;
    readonly active: Position;
    constructor(anchor: Position, active: Position) {
      // A real Selection orders start/end however the user dragged; anchor and
      // active keep the direction. Modelling that here is what makes the
      // right-to-left case a genuine check rather than a restatement.
      const forwards =
        anchor.line < active.line ||
        (anchor.line === active.line && anchor.character <= active.character);
      super(forwards ? anchor : active, forwards ? active : anchor);
      this.anchor = anchor;
      this.active = active;
    }
  }

  interface Edit {
    readonly range: Range;
    readonly text: string;
  }

  const state = {
    /** The document text, terminators and all. */
    text: '',
    languageId: 'typescript',
    uri: { scheme: 'file', path: '/workspace/sample.ts', fsPath: '/workspace/sample.ts' },
    selections: [] as Selection[],
    revealed: [] as Range[],
    hasEditor: true,
    refuseNext: false,
    editCalls: 0,
    undoStops: [] as [boolean, boolean][],
  };

  const text = (): string => state.text;

  /**
   * The document's lines with the offset each begins at.
   *
   * All three terminators, matching VS Code's own piece tree — a model that
   * split on `\n` alone would agree for LF and CRLF documents and disagree on
   * anything containing a bare carriage return. Derived with a regex split
   * rather than the char-by-char scan `buildLineStartOffsets` uses, so the two
   * sides of this suite reach the same answer by different routes.
   */
  const lines = (): { readonly body: string; readonly start: number }[] => {
    const out: { body: string; start: number }[] = [];
    let start = 0;
    const terminators = /\r\n|\n|\r/g;
    for (const match of state.text.matchAll(terminators)) {
      out.push({ body: state.text.slice(start, match.index), start });
      start = match.index + match[0].length;
    }
    out.push({ body: state.text.slice(start), start });
    return out;
  };

  const offsetOf = (at: Position): number => {
    const table = lines();
    const line = Math.max(0, Math.min(at.line, table.length - 1));
    const start = table[line]?.start ?? 0;
    return Math.max(0, Math.min(start + at.character, state.text.length));
  };

  const applyEdits = (edits: readonly Edit[]): void => {
    // Resolve every range against the document as it stands, then rebuild in
    // one pass with a running delta -- a different route to the same "the batch
    // sees the original document" rule the fake reaches by sorting.
    const resolved = edits
      .map((edit) => ({
        from: offsetOf(edit.range.start),
        to: offsetOf(edit.range.end),
        text: edit.text,
      }))
      .sort((a, b) => a.from - b.from);
    let out = '';
    let cursor = 0;
    const source = text();
    for (const edit of resolved) {
      out += source.slice(cursor, edit.from) + edit.text;
      cursor = edit.to;
    }
    out += source.slice(cursor);
    state.text = out;
  };

  const editor = {
    get document() {
      return {
        uri: state.uri,
        languageId: state.languageId,
        get lineCount(): number {
          return lines().length;
        },
        getText(range?: Range): string {
          if (range === undefined) {
            return text();
          }
          if (!(range instanceof Range)) {
            throw new Error('Unrecognized location');
          }
          return text().slice(offsetOf(range.start), offsetOf(range.end));
        },
        lineAt(line: number) {
          const body = lines()[line]?.body ?? '';
          return {
            text: body,
            range: new Range(new Position(line, 0), new Position(line, body.length)),
          };
        },
        getWordRangeAtPosition(at: Position, pattern?: RegExp): Range | undefined {
          const body = lines()[at.line]?.body;
          if (body === undefined) {
            return undefined;
          }
          const source = pattern ?? /[A-Za-z0-9_]+/;
          const scanner = new RegExp(source.source, `${source.flags.replace('g', '')}g`);
          let match = scanner.exec(body);
          while (match !== null) {
            const from = match.index;
            const to = from + match[0].length;
            if (at.character >= from && at.character <= to) {
              return new Range(new Position(at.line, from), new Position(at.line, to));
            }
            match = scanner.exec(body);
          }
          return undefined;
        },
      };
    },
    get selections(): Selection[] {
      return state.selections;
    },
    set selections(next: Selection[]) {
      for (const selection of next) {
        if (!(selection instanceof Selection)) {
          throw new Error('Unrecognized selection');
        }
      }
      state.selections = next;
    },
    edit(
      build: (builder: unknown) => void,
      options?: { undoStopBefore: boolean; undoStopAfter: boolean }
    ): Promise<boolean> {
      state.editCalls += 1;
      state.undoStops.push([options?.undoStopBefore ?? true, options?.undoStopAfter ?? true]);
      if (state.refuseNext) {
        state.refuseNext = false;
        return Promise.resolve(false);
      }
      const pending: Edit[] = [];
      build({
        replace(range: Range, value: string): void {
          // The real builder rejects anything that is not one of its classes.
          if (!(range instanceof Range)) {
            throw new Error('Unrecognized location');
          }
          pending.push({ range, text: value });
        },
      });
      applyEdits(pending);
      return Promise.resolve(true);
    },
    revealRange(range: Range): void {
      if (!(range instanceof Range)) {
        throw new Error('Unrecognized location');
      }
      state.revealed.push(range);
    },
  };

  const workspaceEdits: unknown[] = [];
  class WorkspaceEdit {
    readonly entries: { uri: unknown; range: Range; text: string; metadata: unknown }[] = [];
    replace(uri: unknown, range: Range, newText: string, metadata?: unknown): void {
      if (!(range instanceof Range)) {
        throw new Error('Unrecognized location');
      }
      this.entries.push({ uri, range, text: newText, metadata });
    }
  }

  return {
    state,
    workspaceEdits,
    setText: (value: string): void => {
      state.text = value;
    },
    module: {
      Position,
      Range,
      Selection,
      WorkspaceEdit,
      window: {
        get activeTextEditor(): typeof editor | undefined {
          return state.hasEditor ? editor : undefined;
        },
      },
      workspace: {
        applyEdit(edit: WorkspaceEdit, options?: unknown): Promise<boolean> {
          workspaceEdits.push({ entries: edit.entries, options });
          return Promise.resolve(true);
        },
      },
    },
  };
});

vi.mock('vscode', () => vscodeMock.module);

const { createVSCodeEditorCapability } = await import('../../../src/vscode/capabilities/editor.js');
const { createFakeEditor } = await import('../../../src/testing/fakes/fake-editor.js');

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

/**
 * One document carrying all three line terminators, which is where line
 * arithmetic written against a single newline goes wrong.
 *
 * Built from char codes rather than written literally: a raw CR in a source
 * file is invisible in review, and the first formatter to touch the file
 * rewrites it into something that no longer tests anything.
 */
const CR = String.fromCharCode(13);
const LF = String.fromCharCode(10);
const MIXED_TERMINATORS = `alpha${CR}beta${CR}${LF}gamma${LF}delta`;

/** Everything a test needs to drive one implementation of the port. */
interface Harness {
  readonly capability: EditorCapability;
  open(text: string, selections?: readonly TextRange[]): void;
  close(): void;
  text(): string;
  revealed(): readonly TextRange[];
}

/**
 * One suite, run against every implementation of the port. A fake that drifts
 * from the adapter fails here.
 */
function describeEditorCapability(name: string, makeHarness: () => Harness): void {
  describe(name, () => {
    it('reports no active editor when none is open', () => {
      const harness = makeHarness();
      harness.close();

      expect(harness.capability.active).toBeUndefined();
    });

    it('describes the open document', () => {
      const harness = makeHarness();
      harness.open('one\ntwo\nthree');

      const active = harness.capability.active;
      expect(active?.languageId).toBe('typescript');
      expect(active?.lineCount).toBe(3);
      expect(active?.uri.fsPath).toBe('/workspace/sample.ts');
    });

    it('returns the whole text, and a span of it', () => {
      const harness = makeHarness();
      harness.open('one\ntwo\nthree');

      expect(harness.capability.active?.getText()).toBe('one\ntwo\nthree');
      expect(harness.capability.active?.getText(span(1, 0, 1, 3))).toBe('two');
      expect(harness.capability.active?.getText(span(0, 1, 2, 2))).toBe('ne\ntwo\nth');
    });

    it('gives a line range that stops before the terminator', () => {
      const harness = makeHarness();
      harness.open('one\ntwo\nthree');

      expect(harness.capability.active?.lineRange(1)).toEqual(span(1, 0, 1, 3));
      expect(harness.capability.active?.lineRange(2)).toEqual(span(2, 0, 2, 5));
    });

    it('has no range for a line outside the document', () => {
      const harness = makeHarness();
      harness.open('one\ntwo');

      expect(harness.capability.active?.lineRange(2)).toBeUndefined();
      expect(harness.capability.active?.lineRange(-1)).toBeUndefined();
    });

    it('finds the word at a position', () => {
      const harness = makeHarness();
      harness.open('const value = 1;');

      expect(harness.capability.active?.wordRangeAt(at(0, 8))).toEqual(span(0, 6, 0, 11));
    });

    it('counts a position at either edge of a word as on it', () => {
      const harness = makeHarness();
      harness.open('const value = 1;');

      expect(harness.capability.active?.wordRangeAt(at(0, 6))).toEqual(span(0, 6, 0, 11));
      expect(harness.capability.active?.wordRangeAt(at(0, 11))).toEqual(span(0, 6, 0, 11));
    });

    it('honours a custom word pattern', () => {
      const harness = makeHarness();
      harness.open('use kebab-case-name here');

      expect(harness.capability.active?.wordRangeAt(at(0, 8), /[\w-]+/)).toEqual(span(0, 4, 0, 19));
    });

    it('has no word range where there is no word', () => {
      const harness = makeHarness();
      harness.open('a   b');

      expect(harness.capability.active?.wordRangeAt(at(0, 2))).toBeUndefined();
    });

    it('applies a single replacement', async () => {
      const harness = makeHarness();
      harness.open('hello world');

      await expect(
        harness.capability.active?.applyEdits([{ range: span(0, 0, 0, 5), text: 'goodbye' }])
      ).resolves.toBe(true);

      expect(harness.text()).toBe('goodbye world');
    });

    it('resolves a batch against the document as it was', async () => {
      const harness = makeHarness();
      harness.open('aaa bbb ccc');

      await harness.capability.active?.applyEdits([
        { range: span(0, 0, 0, 3), text: 'xxxxxx' },
        { range: span(0, 8, 0, 11), text: 'y' },
      ]);

      expect(harness.text()).toBe('xxxxxx bbb y');
    });

    it('treats an empty replacement as a deletion', async () => {
      const harness = makeHarness();
      harness.open('hello world');

      await harness.capability.active?.applyEdits([{ range: span(0, 5, 0, 11), text: '' }]);

      expect(harness.text()).toBe('hello');
    });

    it('accepts an empty batch without touching the document', async () => {
      const harness = makeHarness();
      harness.open('unchanged');

      await expect(harness.capability.active?.applyEdits([])).resolves.toBe(true);

      expect(harness.text()).toBe('unchanged');
    });

    it('edits across a line break', async () => {
      const harness = makeHarness();
      harness.open('one\ntwo\nthree');

      await harness.capability.active?.applyEdits([{ range: span(0, 1, 2, 2), text: '-' }]);

      expect(harness.text()).toBe('o-ree');
    });

    it('replaces the selections and reads them back', () => {
      const harness = makeHarness();
      harness.open('one\ntwo\nthree');

      harness.capability.active?.select([span(1, 0, 1, 3), span(2, 0, 2, 5)]);

      expect(harness.capability.active?.selections).toEqual([span(1, 0, 1, 3), span(2, 0, 2, 5)]);
    });

    it('ignores an empty selection list rather than leaving the editor with none', () => {
      const harness = makeHarness();
      harness.open('one', [span(0, 0, 0, 3)]);

      harness.capability.active?.select([]);

      expect(harness.capability.active?.selections).toEqual([span(0, 0, 0, 3)]);
    });

    it('orders a right-to-left selection', () => {
      // vscode.Selection.start/end are ordered however the user dragged. A
      // fake that stored it as given would let code pass here and misbehave
      // against the real editor.
      const harness = makeHarness();
      harness.open('hello world', [span(0, 5, 0, 0)]);

      expect(harness.capability.active?.selections[0]).toEqual(span(0, 0, 0, 5));
      expect(harness.capability.active?.getText(span(0, 0, 0, 5))).toBe('hello');
    });

    it('agrees with the document across CR-only, CRLF and LF breaks', () => {
      // Three terminator styles in one file, which is where line
      // arithmetic written against a single newline goes wrong. Every
      // line's range still has to land on its own text.
      const harness = makeHarness();
      harness.open(MIXED_TERMINATORS);

      const active = harness.capability.active;
      const lines = [0, 1, 2, 3].map((line) => {
        const range = active?.lineRange(line);
        return range === undefined ? undefined : active?.getText(range);
      });

      expect(lines).toEqual(['alpha', 'beta', 'gamma', 'delta']);
    });

    it('stops assembling a cross-file edit once the caller gives up', async () => {
      const harness = makeHarness();
      const uri = {
        scheme: 'file',
        path: '/a.ts',
        fsPath: '/a.ts',
        toString: () => 'file:///a.ts',
      };
      const controller = new AbortController();
      controller.abort();

      await expect(
        harness.capability.applyWorkspaceEdit([{ uri, range: span(0, 0, 0, 1), text: 'x' }], {
          signal: controller.signal,
        })
      ).rejects.toThrow();
    });

    it('reveals a span', () => {
      const harness = makeHarness();
      harness.open('one\ntwo');

      harness.capability.active?.reveal(span(1, 0, 1, 3));

      expect(harness.revealed()).toEqual([span(1, 0, 1, 3)]);
    });
  });
}

describe('EditorCapability contract', () => {
  describeEditorCapability('FakeEditor', () => {
    const capability = createFakeEditor();
    return {
      capability,
      open: (text, selections) => {
        capability._open({ text, ...(selections === undefined ? {} : { selections }) });
      },
      close: () => {
        capability._close();
      },
      text: () => capability._text(),
      revealed: () => capability.revealed,
    };
  });

  describeEditorCapability('VS Code adapter', () => {
    const capability = createVSCodeEditorCapability();
    return {
      capability,
      open: (text, selections) => {
        vscodeMock.state.hasEditor = true;
        vscodeMock.setText(text);
        vscodeMock.state.revealed.length = 0;
        vscodeMock.state.selections = (selections ?? [span(0, 0, 0, 0)]).map(
          (range) =>
            new vscodeMock.module.Selection(
              new vscodeMock.module.Position(range.start.line, range.start.character),
              new vscodeMock.module.Position(range.end.line, range.end.character)
            )
        );
      },
      close: () => {
        vscodeMock.state.hasEditor = false;
      },
      text: () => vscodeMock.state.text,
      revealed: () =>
        vscodeMock.state.revealed.map((range) => ({
          start: { line: range.start.line, character: range.start.character },
          end: { line: range.end.line, character: range.end.character },
        })),
    };
  });
});

describe('the VS Code adapter converts at the boundary', () => {
  it('hands the edit builder real Range instances', async () => {
    // The stand-in throws on a plain object, exactly as TextEditorEdit does, so
    // this passing *is* the proof that the adapter converts rather than passing
    // the port's plain data straight through.
    vscodeMock.state.hasEditor = true;
    vscodeMock.setText('hello');

    await expect(
      createVSCodeEditorCapability().active?.applyEdits([{ range: span(0, 0, 0, 5), text: 'bye' }])
    ).resolves.toBe(true);
  });

  it('returns plain data, not the platform objects', () => {
    vscodeMock.state.hasEditor = true;
    vscodeMock.setText('one\ntwo');

    const range = createVSCodeEditorCapability().active?.lineRange(1);

    // A structural compare would pass against a vscode.Range too; the point is
    // that nothing carrying platform identity crosses the port.
    expect(range).toEqual(span(1, 0, 1, 3));
    expect(range).not.toBeInstanceOf(vscodeMock.module.Range);
  });

  it('applies a batch in one call, its own undo step by default', async () => {
    vscodeMock.state.hasEditor = true;
    vscodeMock.setText('aaa bbb');
    vscodeMock.state.editCalls = 0;
    vscodeMock.state.undoStops.length = 0;

    await createVSCodeEditorCapability().active?.applyEdits([
      { range: span(0, 0, 0, 3), text: 'x' },
      { range: span(0, 4, 0, 7), text: 'y' },
    ]);

    // One call is what makes a batch atomic: VS Code resolves every
    // replacement against the document as it was when the call started.
    expect(vscodeMock.state.editCalls).toBe(1);
    expect(vscodeMock.state.undoStops).toEqual([[true, true]]);
  });

  it('places the undo boundary where the caller asked', async () => {
    vscodeMock.state.hasEditor = true;
    vscodeMock.setText('aaa bbb ccc');
    vscodeMock.state.undoStops.length = 0;
    const capability = createVSCodeEditorCapability();

    // What `editStages` emits: open, add, close. Together they are one step.
    await capability.active?.applyEdits([{ range: span(0, 0, 0, 3), text: 'x' }], {
      undoStop: 'before',
    });
    await capability.active?.applyEdits([{ range: span(0, 2, 0, 5), text: 'y' }], {
      undoStop: 'none',
    });
    await capability.active?.applyEdits([{ range: span(0, 4, 0, 6), text: 'z' }], {
      undoStop: 'after',
    });

    expect(vscodeMock.state.undoStops).toEqual([
      [true, false],
      [false, false],
      [false, true],
    ]);
  });

  it('sends both metadata fields or neither', async () => {
    vscodeMock.workspaceEdits.length = 0;
    const uri = { scheme: 'file', path: '/a.ts', fsPath: '/a.ts', toString: () => 'file:///a.ts' };

    await createVSCodeEditorCapability().applyWorkspaceEdit([
      { uri, range: span(0, 0, 0, 1), text: 'x' },
    ]);
    await createVSCodeEditorCapability().applyWorkspaceEdit(
      [{ uri, range: span(0, 0, 0, 1), text: 'x' }],
      { label: 'Rename' }
    );

    const [plain, labelled] = vscodeMock.workspaceEdits as {
      entries: { metadata: unknown }[];
    }[];
    // VS Code rejects a metadata object missing either field.
    expect(plain?.entries[0]?.metadata).toBeUndefined();
    expect(labelled?.entries[0]?.metadata).toEqual({ label: 'Rename', needsConfirmation: false });
  });
});
