/**
 * Port-level editor fake backed by one in-memory text document.
 *
 * Text and range arithmetic are real enough to exercise feature logic, while
 * workbench concerns remain out of scope: there is no dirty/version state,
 * language service, undo implementation, concurrent edit conflict, file system
 * or rendered viewport. Cross-file edits are recorded, not applied.
 */
import { buildLineStartOffsets } from '../../capabilities/workspace/text-math.js';
import type {
  ActiveTextEditor,
  EditorCapability,
  TextEdit,
  TextEditOptions,
  TextPosition,
  TextRange,
  WatchedUri,
  WorkspaceEditOptions,
  WorkspaceTextEdit,
} from '../../foundation/platform/ports.js';

/** A cross-file edit as the fake recorded it. */
export interface RecordedWorkspaceEdit {
  readonly edits: readonly WorkspaceTextEdit[];
  readonly options: WorkspaceEditOptions;
}

/**
 * In-memory editor capability for deterministic feature tests.
 * Methods prefixed with `_` are test controls, never production port members.
 */
export interface FakeEditor extends EditorCapability {
  /** Opens a document, making it the active editor. */
  _open(options: {
    readonly text: string;
    readonly uri?: string;
    readonly languageId?: string;
    readonly selections?: readonly TextRange[];
  }): void;
  /** Closes the active editor, so `active` reads undefined. */
  _close(): void;
  /** The document's current text, including every edit applied so far. */
  _text(): string;
  /** Makes the next `applyEdits` resolve false, as a refused edit does. */
  _refuseNextEdit(): void;
  /** Every span revealed, in order. */
  readonly revealed: readonly TextRange[];
  /**
   * The undo boundary each applied batch asked for, in order.
   *
   * A grouped edit is `['before', 'none', …, 'after']`; a lone one is
   * `['both']`. There is no in-memory undo stack to observe, so this is how a
   * test checks that a pipeline is one step rather than several.
   */
  readonly undoStops: readonly NonNullable<TextEditOptions['undoStop']>[];
  /** Every cross-file edit requested, in order. */
  readonly workspaceEdits: readonly RecordedWorkspaceEdit[];
}

const position = (line: number, character: number): TextPosition => ({ line, character });

/**
 * Puts a range's ends in document order.
 *
 * `vscode.Selection.start`/`end` are always ordered however the user dragged,
 * so a fake that stored a right-to-left selection as given would let code pass
 * here and misbehave against the real editor.
 */
function ordered(range: TextRange): TextRange {
  const { start, end } = range;
  const startsFirst =
    start.line < end.line || (start.line === end.line && start.character <= end.character);
  return startsFirst ? { start, end } : { start: end, end: start };
}

/** Builds a fake `WatchedUri` from a `scheme:path` string. */
function fakeDocumentUri(raw: string): WatchedUri {
  const separator = raw.indexOf(':');
  const scheme = separator === -1 ? 'file' : raw.slice(0, separator);
  const path = separator === -1 ? raw : raw.slice(separator + 1);
  return { scheme, path, fsPath: path, toString: () => `${scheme}://${path}` };
}

/**
 * Creates a fake editor capability over an in-memory document.
 *
 * The active document is a real string that same-document edits rewrite, so a test exercises
 * the service's own offset and range arithmetic rather than a recording of the
 * calls it made. Line endings are honoured as written: pass `\r\n` text and the
 * offsets come out with `\r\n` semantics. Workspace edits are only recorded;
 * asserting their application belongs in an adapter/Extension Host test.
 *
 * @example
 * ```ts
 * const editors = createFakeEditor();
 * editors._open({ text: 'hello world', selections: [{ start: {line:0,character:0}, end: {line:0,character:5} }] });
 * ```
 */
export function createFakeEditor(): FakeEditor {
  interface Document {
    text: string;
    uri: WatchedUri;
    languageId: string;
    selections: readonly TextRange[];
  }

  let open: Document | undefined;
  let refuseNextEdit = false;
  const revealed: TextRange[] = [];
  const workspaceEdits: RecordedWorkspaceEdit[] = [];
  const undoStops: NonNullable<TextEditOptions['undoStop']>[] = [];

  /** Offset of a position in `text`, clamped to the document. */
  const offsetOf = (text: string, at: TextPosition): number => {
    const starts = buildLineStartOffsets(text);
    const line = Math.max(0, Math.min(at.line, starts.length - 1));
    return Math.max(0, Math.min((starts[line] ?? 0) + at.character, text.length));
  };

  const lineRangeOf = (text: string, line: number): TextRange | undefined => {
    const starts = buildLineStartOffsets(text);
    if (line < 0 || line >= starts.length) {
      return undefined;
    }
    const start = starts[line] ?? 0;
    // A line's range stops before its terminator, as `TextLine.range` does.
    // All three terminators, because `buildLineStartOffsets` counts all three
    // (VS Code's piece tree does too): stripping only `\r?\n` left a lone CR
    // inside the line body, so a CR-delimited document reported line text and
    // line ranges that disagreed with the real editor.
    const nextStart = starts[line + 1];
    const end = nextStart === undefined ? text.length : nextStart;
    const body = text.slice(start, end).replace(/\r\n$|\n$|\r$/, '');
    return { start: position(line, 0), end: position(line, body.length) };
  };

  /** VS Code's default word definition, near enough for a fake. */
  const DEFAULT_WORD = /[A-Za-z0-9_]+/g;

  const active = (document: Document): ActiveTextEditor => ({
    uri: document.uri,
    languageId: document.languageId,
    get lineCount(): number {
      return buildLineStartOffsets(document.text).length;
    },
    get selections(): readonly TextRange[] {
      return document.selections;
    },

    getText(range): string {
      if (range === undefined) {
        return document.text;
      }
      const from = offsetOf(document.text, range.start);
      const to = offsetOf(document.text, range.end);
      return document.text.slice(Math.min(from, to), Math.max(from, to));
    },

    lineRange: (line) => lineRangeOf(document.text, line),

    wordRangeAt(at, pattern): TextRange | undefined {
      const line = lineRangeOf(document.text, at.line);
      if (line === undefined) {
        return undefined;
      }
      const lineText = document.text.slice(
        offsetOf(document.text, line.start),
        offsetOf(document.text, line.end)
      );
      const source = pattern ?? DEFAULT_WORD;
      // A caller's pattern need not be global; matchAll requires it to be.
      const scanner = new RegExp(
        source.source,
        source.flags.includes('g') ? source.flags : `${source.flags}g`
      );
      for (const match of lineText.matchAll(scanner)) {
        const from = match.index;
        const to = from + match[0].length;
        // Inclusive at both ends: a cursor sitting just after a word is still
        // "on" it, which is what VS Code does.
        if (at.character >= from && at.character <= to) {
          return { start: position(at.line, from), end: position(at.line, to) };
        }
      }
      return undefined;
    },

    applyEdits(edits: readonly TextEdit[], options?: TextEditOptions): Promise<boolean> {
      if (refuseNextEdit) {
        refuseNextEdit = false;
        return Promise.resolve(false);
      }
      // Recorded rather than acted on: undo grouping is a platform behaviour
      // with no in-memory equivalent, and a test that cares asserts on what the
      // service asked for.
      undoStops.push(options?.undoStop ?? 'both');
      // Applied back to front so an earlier edit's offsets stay valid, which is
      // how VS Code resolves a batch against the document it started from.
      const resolved = edits
        .map((edit) => ({
          from: offsetOf(document.text, edit.range.start),
          to: offsetOf(document.text, edit.range.end),
          text: edit.text,
        }))
        .sort((a, b) => b.from - a.from);
      for (const edit of resolved) {
        const from = Math.min(edit.from, edit.to);
        const to = Math.max(edit.from, edit.to);
        document.text = document.text.slice(0, from) + edit.text + document.text.slice(to);
      }
      return Promise.resolve(true);
    },

    select(selections): void {
      if (selections.length > 0) {
        document.selections = selections.map(ordered);
      }
    },

    reveal(range): void {
      revealed.push(range);
    },
  });

  return {
    get active(): ActiveTextEditor | undefined {
      return open === undefined ? undefined : active(open);
    },

    applyWorkspaceEdit(edits, options = {}): Promise<boolean> {
      // Checked per entry, like the adapter, so a huge batch the caller has
      // given up on stops early. Reported as a rejection rather than a
      // synchronous throw: a promise-returning function that throws inline
      // forces every caller to write both a try/catch and a .catch.
      for (let index = 0; index < edits.length; index += 1) {
        if (options.signal?.aborted === true) {
          return Promise.reject(options.signal.reason as Error);
        }
      }
      workspaceEdits.push({ edits: [...edits], options });
      return Promise.resolve(true);
    },

    _open(options): void {
      open = {
        text: options.text,
        uri: fakeDocumentUri(options.uri ?? 'file:/workspace/sample.ts'),
        languageId: options.languageId ?? 'typescript',
        selections: (options.selections ?? [{ start: position(0, 0), end: position(0, 0) }]).map(
          ordered
        ),
      };
    },

    _close(): void {
      open = undefined;
    },

    _text(): string {
      return open?.text ?? '';
    },

    _refuseNextEdit(): void {
      refuseNextEdit = true;
    },

    revealed,
    workspaceEdits,
    undoStops,
  };
}
