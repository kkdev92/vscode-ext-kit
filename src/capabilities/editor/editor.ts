/**
 * Text-editor models above the minimal editor platform port.
 *
 * Public surface: {@link EditorService} resolves the currently focused editor
 * and applies cross-file edits; {@link ActiveEditor} offers read, selection,
 * offset, and edit helpers for one platform editor. `toActiveEditor` is shared
 * with text-editor command binding so both entry paths have identical behavior.
 *
 * State and ownership: the service owns no editor or document. Every
 * `editors.active` access asks the adapter again, but an `ActiveEditor` already
 * captured by a caller continues to refer to that one editor. Re-read
 * `editors.active` after an `await` when focus changes matter.
 *
 * Host boundary: positions and offsets use UTF-16 code units like VS Code.
 * URIs may use remote or virtual schemes, edits can be refused with `false`,
 * and adapter failures reject. Batch offset conversion checks an optional
 * signal cooperatively; editor mutations themselves use the platform's
 * cancellation/error semantics.
 */
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
import { serviceToken } from '../../foundation/services/token.js';
import type { ServiceToken } from '../../foundation/services/token.js';
import {
  buildLineStartOffsets,
  lineCharacterToOffset,
  offsetToLineCharacter,
} from '../workspace/text-math.js';

/** Where a document lives. */
export interface DocumentLocation {
  /**
   * The document's `fsPath`. Populated for local files, Remote-SSH/WSL/
   * Codespaces (`vscode-remote`) and virtual file systems (`vscode-vfs`) alike,
   * so treat it as an identity or display string unless `uri.scheme` is
   * `'file'`.
   */
  readonly fsPath: string;
  /** The full URI, scheme included. Check this when the scheme matters. */
  readonly uri: WatchedUri;
}

/**
 * One stage of a grouped edit.
 *
 * Receives the editor as it stands after the previous stage, and returns the
 * replacements that stage wants.
 */
export type EditStage = (
  editor: ActiveEditor
) => readonly TextEdit[] | Promise<readonly TextEdit[]>;

/**
 * Everything an extension does to the editor the user is looking at.
 *
 * Obtained from {@link EditorService.active}, so the "is there an editor?"
 * question is answered once, at the top of a handler, instead of by every
 * function separately.
 */
export interface ActiveEditor {
  /** The document's language id, e.g. `'typescript'`. */
  readonly languageId: string;
  /** Number of lines in the document. */
  readonly lineCount: number;
  /** The current selections, primary first. */
  readonly selections: readonly TextRange[];

  /**
   * Where the document lives, or undefined for an `untitled:` document, which
   * has no path at all.
   *
   * @example
   * ```ts
   * const location = editor.location();
   * if (location?.uri.scheme === 'file') { ... }
   * ```
   */
  location(): DocumentLocation | undefined;

  /** The whole document text, or just a span of it. */
  text(range?: TextRange): string;

  /**
   * The primary selection's text, or `''` when nothing is selected.
   *
   * @example
   * ```ts
   * const word = editor.selectedText();
   * ```
   */
  selectedText(): string;

  /** Every non-empty selection's text, in selection order. */
  selectedTexts(): readonly string[];

  /** A line's text, or `''` when the line does not exist. */
  line(line: number): string;

  /** The text of the line the cursor is on. */
  currentLine(): string;

  /**
   * Replaces spans, as one undo step.
   *
   * The whole batch is resolved against the document as it stands when the call
   * starts, so the ranges do not shift out from under each other.
   * Resolves `false` when the platform refuses the edit and rejects on an
   * adapter failure.
   *
   * @example
   * ```ts
   * await editor.edit([{ range, text: 'replacement' }]);
   * ```
   */
  edit(edits: readonly TextEdit[], options?: TextEditOptions): Promise<boolean>;

  /**
   * Runs stages in order, as a single undo step.
   *
   * Each stage is handed the editor *after* the previous stage landed, which is
   * the difference from {@link ActiveEditor.edit}: one batch resolves every
   * replacement against the original document, so it cannot express "sort the
   * lines, then dedupe what sorting produced".
   *
   * Without this, a three-stage pipeline is either three undos or three edits
   * computed against a document that no longer looks like that.
   * Stops and resolves `false` at the first refused stage; a thrown/rejected
   * stage or adapter failure rejects.
   *
   * @example
   * ```ts
   * await editor.editStages(
   *   pipeline.map((stage) => (current) =>
   *     current.selections.map((range) => ({ range, text: stage(current.text(range)) }))
   *   )
   * );
   * ```
   */
  editStages(stages: readonly EditStage[]): Promise<boolean>;

  /** Replaces one span. */
  replace(range: TextRange, text: string): Promise<boolean>;

  /** Inserts text at the cursor. */
  insertAtCursor(text: string): Promise<boolean>;

  /**
   * Rewrites the primary selection. False when nothing is selected, so a
   * command can bail without checking first.
   *
   * @example
   * ```ts
   * await editor.transformSelection((text) => text.toUpperCase());
   * ```
   */
  transformSelection(transform: (text: string) => string): Promise<boolean>;

  /**
   * Rewrites every non-empty selection as one undo step. False when nothing is
   * selected.
   */
  transformSelections(transform: (text: string, index: number) => string): Promise<boolean>;

  /** Moves the cursor and scrolls it into view. */
  moveCursor(position: TextPosition): void;

  /** Selects a span and scrolls it into view. */
  select(range: TextRange): void;

  /** Selects a whole line. Does nothing when the line does not exist. */
  selectLine(line: number): void;

  /**
   * Selects the word at the cursor, using the platform's word definition unless
   * `pattern` overrides it. False when the cursor is not on a word.
   *
   * @example
   * ```ts
   * if (editor.selectWord(/[\w-]+/)) {
   *   const kebab = editor.selectedText();
   * }
   * ```
   */
  selectWord(pattern?: RegExp): boolean;

  /**
   * Builds a span from two document offsets — the shape a regex match gives
   * you.
   *
   * @example
   * ```ts
   * const match = /TODO:/.exec(editor.text());
   * const range = editor.rangeOfOffsets(match.index, match.index + match[0].length);
   * ```
   */
  rangeOfOffsets(startOffset: number, endOffset: number): TextRange;

  /** The text between two document offsets. */
  textOfOffsets(startOffset: number, endOffset: number): string;

  /**
   * Resolves many offsets to positions in a single pass over the document,
   * rather than one lookup each. Out-of-range offsets clamp to the document.
   *
   * `signal` is checked between lookups so a large batch stops promptly.
   *
   * @example
   * ```ts
   * const offsets = [...text.matchAll(/TODO:/g)].map((m) => m.index);
   * const positions = editor.positionsAt(offsets, context.signal);
   * ```
   */
  positionsAt(offsets: readonly number[], signal?: AbortSignal): readonly TextPosition[];

  /**
   * Resolves many positions to offsets in a single pass — the inverse of
   * {@link ActiveEditor.positionsAt}. Out-of-range *lines* clamp; out-of-range
   * characters do not, so pass positions already valid for the document.
   */
  offsetsAt(positions: readonly TextPosition[], signal?: AbortSignal): readonly number[];
}

/**
 * Reading and editing text.
 *
 * @example
 * ```ts
 * module.commands.handle(Upper, {
 *   inject: { editors: Editors },
 *   execute: async (_context, _args, { editors }) => {
 *     const editor = editors.active;
 *     if (editor === undefined) return false;
 *     return editor.transformSelection((text) => text.toUpperCase());
 *   },
 * });
 * ```
 */
export interface EditorService {
  /**
   * The editor focused at the moment this property is read, or undefined when
   * none is. Read again after an `await` if the current focus matters.
   */
  readonly active: ActiveEditor | undefined;

  /**
   * Applies replacements across any number of files as one transaction. The
   * files need not be open, which is what separates this from
   * {@link ActiveEditor.edit}.
   * Resolves `false` when the workspace edit is refused and rejects on an
   * adapter failure.
   *
   * @example
   * ```ts
   * await editors.editFiles(
   *   matches.map((m) => ({ uri: m.uri, range: m.range, text: m.replacement })),
   *   { label: 'Rename symbol across files' }
   * );
   * ```
   */
  editFiles(edits: readonly WorkspaceTextEdit[], options?: WorkspaceEditOptions): Promise<boolean>;
}

/** Injects the application's {@link EditorService}. */
export const Editors: ServiceToken<EditorService> =
  serviceToken<EditorService>('framework.editors');

/** True when a range covers no characters at all. */
function isEmptyRange(range: TextRange): boolean {
  return range.start.line === range.end.line && range.start.character === range.end.character;
}

/** Throws the way an aborted operation should, without importing the host's error. */
function throwIfAborted(signal: AbortSignal | undefined): void {
  signal?.throwIfAborted();
}

/**
 * Builds the editor API over one platform editor.
 *
 * Exported because a text editor command is handed a specific editor rather
 * than the focused one, and both routes have to produce the same shape.
 */
export function toActiveEditor(active: ActiveTextEditor): ActiveEditor {
  /**
   * Line-start offsets for the document as it reads right now.
   *
   * Rebuilt per batch rather than cached: an edit between two calls would make
   * a cached table silently wrong, and wrong offsets corrupt a document.
   */
  const lineStarts = (): { readonly starts: readonly number[]; readonly length: number } => {
    const text = active.getText();
    return { starts: buildLineStartOffsets(text), length: text.length };
  };

  const nonEmptySelections = (): readonly TextRange[] =>
    active.selections.filter((selection) => !isEmptyRange(selection));

  const editor: ActiveEditor = {
    get languageId(): string {
      return active.languageId;
    },
    get lineCount(): number {
      return active.lineCount;
    },
    get selections(): readonly TextRange[] {
      return active.selections;
    },

    location(): DocumentLocation | undefined {
      const uri = active.uri;
      return uri.scheme === 'untitled' ? undefined : { fsPath: uri.fsPath, uri };
    },

    text: (range) => active.getText(range),

    selectedText(): string {
      const primary = active.selections[0];
      return primary === undefined || isEmptyRange(primary) ? '' : active.getText(primary);
    },

    selectedTexts: () => nonEmptySelections().map((selection) => active.getText(selection)),

    line(line): string {
      const range = active.lineRange(line);
      return range === undefined ? '' : active.getText(range);
    },

    currentLine(): string {
      const primary = active.selections[0];
      return primary === undefined ? '' : editor.line(primary.start.line);
    },

    edit: (edits, options) => active.applyEdits(edits, options),

    async editStages(stages): Promise<boolean> {
      if (stages.length === 0) {
        return true;
      }
      // The undo boundaries are placed by position: the first call opens the
      // step, the last closes it, and the ones between add to it. Knowing the
      // whole list up front is what makes that possible -- a caller looping by
      // hand cannot say "no stop after this" without knowing whether more is
      // coming.
      //
      // "First" and "last" mean the first and last stage that *edits*, not the
      // first and last in the list. A stage is free to decide it has nothing to
      // do, and one that does so at either end used to take its boundary with
      // it: the step then never opened or never closed, and a single undo
      // swallowed whatever the user did before or after.
      //
      // Each stage runs in order because a later one reads the document the
      // earlier ones produced, so a stage's edits must land before the next one
      // is asked. The final stage in the list closes the step on its own batch,
      // which is the usual shape and costs nothing extra. When that stage turns
      // out to have nothing to do, the step is closed afterwards by an empty
      // batch carrying only the boundary.
      const finalIndex = stages.length - 1;
      let opened = false;
      let closed = false;
      let refused = false;

      for (const [index, stage] of stages.entries()) {
        const edits = await stage(editor);
        if (edits.length === 0) {
          continue;
        }

        const isFinal = index === finalIndex;
        const accepted = await active.applyEdits(edits, {
          undoStop: isFinal ? (opened ? 'after' : 'both') : opened ? 'none' : 'before',
        });
        opened = true;
        closed = isFinal;
        if (!accepted) {
          // Stop at the first refusal: continuing would apply later stages to a
          // document the earlier ones never changed. Whatever did land still
          // needs its step closed, which happens below.
          refused = true;
          break;
        }
      }

      if (opened && !closed) {
        // Left open, the user's next edit would join this step, and one undo
        // would take back more than this call ever did.
        await active.applyEdits([], { undoStop: 'after' });
      }
      // Nothing opened means every stage declined, which is not a failure.
      return !refused;
    },

    replace: (range, text) => active.applyEdits([{ range, text }]),

    insertAtCursor(text): Promise<boolean> {
      const primary = active.selections[0];
      if (primary === undefined) {
        return Promise.resolve(false);
      }
      // An insert is a replacement of the empty range at the cursor.
      const cursor = { start: primary.start, end: primary.start };
      return active.applyEdits([{ range: cursor, text }]);
    },

    transformSelection(transform): Promise<boolean> {
      const primary = active.selections[0];
      if (primary === undefined || isEmptyRange(primary)) {
        return Promise.resolve(false);
      }
      return active.applyEdits([{ range: primary, text: transform(active.getText(primary)) }]);
    },

    transformSelections(transform): Promise<boolean> {
      const selections = nonEmptySelections();
      if (selections.length === 0) {
        return Promise.resolve(false);
      }
      return active.applyEdits(
        selections.map((selection, index) => ({
          range: selection,
          text: transform(active.getText(selection), index),
        }))
      );
    },

    moveCursor(position): void {
      const range = { start: position, end: position };
      active.select([range]);
      active.reveal(range);
    },

    select(range): void {
      active.select([range]);
      active.reveal(range);
    },

    selectLine(line): void {
      const range = active.lineRange(line);
      if (range !== undefined) {
        editor.select(range);
      }
    },

    selectWord(pattern): boolean {
      const primary = active.selections[0];
      if (primary === undefined) {
        return false;
      }
      const range = active.wordRangeAt(primary.start, pattern);
      if (range === undefined) {
        return false;
      }
      editor.select(range);
      return true;
    },

    rangeOfOffsets(startOffset, endOffset): TextRange {
      const { starts, length } = lineStarts();
      return {
        start: offsetToLineCharacter(starts, length, startOffset),
        end: offsetToLineCharacter(starts, length, endOffset),
      };
    },

    textOfOffsets: (startOffset, endOffset) =>
      active.getText(editor.rangeOfOffsets(startOffset, endOffset)),

    positionsAt(offsets, signal): readonly TextPosition[] {
      if (offsets.length === 0) {
        return [];
      }
      throwIfAborted(signal);
      const { starts, length } = lineStarts();
      const positions: TextPosition[] = [];
      for (const offset of offsets) {
        throwIfAborted(signal);
        positions.push(offsetToLineCharacter(starts, length, offset));
      }
      return positions;
    },

    offsetsAt(positions, signal): readonly number[] {
      if (positions.length === 0) {
        return [];
      }
      throwIfAborted(signal);
      const { starts } = lineStarts();
      const offsets: number[] = [];
      for (const position of positions) {
        throwIfAborted(signal);
        offsets.push(lineCharacterToOffset(starts, position));
      }
      return offsets;
    },
  };

  return editor;
}

/**
 * Builds the editor service over a capability.
 *
 * @example
 * ```ts
 * const editors = createEditorService(capability);
 * editors.active?.selectedText();
 * ```
 */
export function createEditorService(capability: EditorCapability): EditorService {
  return {
    get active(): ActiveEditor | undefined {
      // Resolved per access: the focused editor changes while an application
      // runs, so a captured one would go stale between two awaits.
      const active = capability.active;
      return active === undefined ? undefined : toActiveEditor(active);
    },

    editFiles: (edits, options) => capability.applyWorkspaceEdit(edits, options),
  };
}
