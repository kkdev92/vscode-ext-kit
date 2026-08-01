import * as vscode from 'vscode';

// ============================================
// Types
// ============================================

/**
 * An edit operation to apply to a document.
 */
export interface EditOperation {
  /** Range to replace */
  range: vscode.Range;
  /** Text to insert */
  text: string;
}

/**
 * Location info for a document, returned by {@link getFilePath}.
 */
export interface FilePathInfo {
  /**
   * `Uri.fsPath` of the document. Populated for `file`, Remote-SSH/WSL/Codespaces
   * (`vscode-remote`), and virtual file systems (`vscode-vfs`) alike — treat it as
   * an identity/display string rather than a locally-openable path unless
   * `uri.scheme === 'file'`.
   */
  fsPath: string;
  /**
   * The document's full URI, including scheme. Use this (rather than `fsPath`
   * alone) whenever the scheme matters, e.g. to detect remote or virtual
   * file systems.
   */
  uri: vscode.Uri;
}

/**
 * A single text replacement targeting one file, for use with {@link applyWorkspaceEdits}.
 */
export interface WorkspaceEditEntry {
  /** Target document URI. */
  uri: vscode.Uri;
  /** Range to replace. */
  range: vscode.Range;
  /** Replacement text. */
  newText: string;
}

/**
 * Options for {@link applyWorkspaceEdits}.
 */
export interface ApplyWorkspaceEditsOptions {
  /** Human-readable label shown in the Undo stack and refactor-preview UI. Applied to every entry. */
  label?: string;
  /** Whether the editor should prompt the user to confirm before applying. Applied to every entry (default: false). */
  needsConfirmation?: boolean;
  /** Marks the whole edit as a refactoring; passed through to `workspace.applyEdit`'s own metadata. */
  isRefactoring?: boolean;
  /** Checked between entries so a very large batch can be aborted early. */
  token?: vscode.CancellationToken;
}

// ============================================
// Text Operations
// ============================================

/**
 * Applies multiple edit operations atomically.
 *
 * @param editor - The text editor
 * @param edits - Array of edit operations
 * @returns true if all edits were applied successfully
 *
 * @example
 * ```typescript
 * await applyEdits(editor, [
 *   { range: new vscode.Range(0, 0, 0, 5), text: 'NEW' },
 *   { range: new vscode.Range(1, 0, 1, 10), text: 'REPLACED' },
 * ]);
 * ```
 */
export async function applyEdits(
  editor: vscode.TextEditor,
  edits: EditOperation[]
): Promise<boolean> {
  return editor.edit((editBuilder) => {
    for (const edit of edits) {
      editBuilder.replace(edit.range, edit.text);
    }
  });
}

/**
 * Replaces text in a specific range.
 *
 * @param editor - The text editor
 * @param range - Range to replace
 * @param text - New text
 * @returns true if edit was applied successfully
 *
 * @example
 * ```typescript
 * const range = new vscode.Range(0, 0, 0, 5);
 * await replaceText(editor, range, 'hello');
 * ```
 */
export async function replaceText(
  editor: vscode.TextEditor,
  range: vscode.Range,
  text: string
): Promise<boolean> {
  return applyEdits(editor, [{ range, text }]);
}

/**
 * Gets the text of the primary selection.
 *
 * @param editor - The text editor
 * @returns Selected text, or empty string if no selection
 *
 * @example
 * ```typescript
 * const selected = getSelectedText(editor);
 * console.log(`Selected: ${selected}`);
 * ```
 */
export function getSelectedText(editor: vscode.TextEditor): string {
  const selection = editor.selection;
  if (selection.isEmpty) {
    return '';
  }
  return editor.document.getText(selection);
}

/**
 * Gets text from all selections.
 *
 * @param editor - The text editor
 * @returns Array of selected texts
 *
 * @example
 * ```typescript
 * const selections = getAllSelectedText(editor);
 * console.log(`${selections.length} selections`);
 * ```
 */
export function getAllSelectedText(editor: vscode.TextEditor): string[] {
  return editor.selections
    .filter((selection) => !selection.isEmpty)
    .map((selection) => editor.document.getText(selection));
}

/**
 * Inserts text at the current cursor position.
 *
 * @param editor - The text editor
 * @param text - Text to insert
 * @returns true if edit was applied successfully
 *
 * @example
 * ```typescript
 * await insertAtCursor(editor, 'Hello, World!');
 * ```
 */
export async function insertAtCursor(editor: vscode.TextEditor, text: string): Promise<boolean> {
  return editor.edit((editBuilder) => {
    editBuilder.insert(editor.selection.active, text);
  });
}

/**
 * Checks whether `lineNumber` is a valid, addressable line in `document`.
 * Shared by {@link getLine} and {@link selectLine} so the bounds check lives
 * in exactly one place.
 */
function isValidLine(document: vscode.TextDocument, lineNumber: number): boolean {
  return lineNumber >= 0 && lineNumber < document.lineCount;
}

/**
 * Gets the text of a specific line.
 *
 * @param editor - The text editor
 * @param lineNumber - Zero-based line number
 * @returns Line text, or empty string if line doesn't exist
 *
 * @example
 * ```typescript
 * const line = getLine(editor, 0);
 * console.log(`First line: ${line}`);
 * ```
 */
export function getLine(editor: vscode.TextEditor, lineNumber: number): string {
  if (!isValidLine(editor.document, lineNumber)) {
    return '';
  }
  return editor.document.lineAt(lineNumber).text;
}

/**
 * Gets the text of the current line (cursor position).
 *
 * @param editor - The text editor
 * @returns Current line text
 *
 * @example
 * ```typescript
 * const currentLine = getCurrentLine(editor);
 * ```
 */
export function getCurrentLine(editor: vscode.TextEditor): string {
  return editor.document.lineAt(editor.selection.active.line).text;
}

/**
 * Transforms the selected text using a function.
 *
 * @param editor - The text editor
 * @param transform - Function to transform the text
 * @returns true if transformation was applied successfully
 *
 * @example
 * ```typescript
 * // Convert selection to uppercase
 * await transformSelection(editor, text => text.toUpperCase());
 *
 * // Wrap selection in quotes
 * await transformSelection(editor, text => `"${text}"`);
 * ```
 */
export async function transformSelection(
  editor: vscode.TextEditor,
  transform: (text: string) => string
): Promise<boolean> {
  const selection = editor.selection;
  if (selection.isEmpty) {
    return false;
  }

  const transformed = transform(editor.document.getText(selection));
  return applyEdits(editor, [{ range: selection, text: transformed }]);
}

/**
 * Transforms all selections using a function.
 *
 * @param editor - The text editor
 * @param transform - Function to transform each selection
 * @returns true if all transformations were applied successfully
 *
 * @example
 * ```typescript
 * // Convert all selections to lowercase
 * await transformAllSelections(editor, text => text.toLowerCase());
 * ```
 */
export async function transformAllSelections(
  editor: vscode.TextEditor,
  transform: (text: string, index: number) => string
): Promise<boolean> {
  const selections = editor.selections.filter((s) => !s.isEmpty);
  if (selections.length === 0) {
    return false;
  }

  const edits = selections.map((selection, index) => ({
    range: selection,
    text: transform(editor.document.getText(selection), index),
  }));
  return applyEdits(editor, edits);
}

// ============================================
// Cursor and Selection
// ============================================

/**
 * Moves the cursor to a specific position.
 *
 * @param editor - The text editor
 * @param position - Position to move to
 *
 * @example
 * ```typescript
 * moveCursor(editor, new vscode.Position(10, 0));
 * ```
 */
export function moveCursor(editor: vscode.TextEditor, position: vscode.Position): void {
  const newSelection = new vscode.Selection(position, position);
  editor.selection = newSelection;
  editor.revealRange(new vscode.Range(position, position));
}

/**
 * Selects a range of text.
 *
 * @param editor - The text editor
 * @param range - Range to select
 *
 * @example
 * ```typescript
 * selectRange(editor, new vscode.Range(0, 0, 5, 0));
 * ```
 */
export function selectRange(editor: vscode.TextEditor, range: vscode.Range): void {
  editor.selection = new vscode.Selection(range.start, range.end);
  editor.revealRange(range);
}

/**
 * Selects the entire line at the given line number.
 *
 * @param editor - The text editor
 * @param lineNumber - Zero-based line number
 *
 * @example
 * ```typescript
 * selectLine(editor, 5);
 * ```
 */
export function selectLine(editor: vscode.TextEditor, lineNumber: number): void {
  if (!isValidLine(editor.document, lineNumber)) {
    return;
  }
  const line = editor.document.lineAt(lineNumber);
  selectRange(editor, line.range);
}

/**
 * Selects the word at the current cursor position.
 *
 * @param editor - The text editor
 * @param regex - Custom word pattern (forwarded to `TextDocument.getWordRangeAtPosition`).
 *   Defaults to VS Code's built-in word definition when omitted — pass one to
 *   treat e.g. kebab-case (`/[\w-]+/`) as a single word.
 * @returns true if a word was selected
 *
 * @example
 * ```typescript
 * if (selectWord(editor)) {
 *   const word = getSelectedText(editor);
 * }
 *
 * // Select a kebab-case token as one word
 * selectWord(editor, /[\w-]+/);
 * ```
 */
export function selectWord(editor: vscode.TextEditor, regex?: RegExp): boolean {
  const position = editor.selection.active;
  const wordRange = editor.document.getWordRangeAtPosition(position, regex);

  if (!wordRange) {
    return false;
  }

  selectRange(editor, wordRange);
  return true;
}

// ============================================
// Document Info
// ============================================

/**
 * Gets the location of the document backing an editor.
 *
 * Works for any scheme with a meaningful `fsPath` — local files (`file`),
 * Remote-SSH/WSL/Codespaces (`vscode-remote`), and virtual file systems
 * (`vscode-vfs`) alike. Only `untitled` documents (which have no real path
 * at all) return `undefined`.
 *
 * @param editor - The text editor
 * @returns The document's `fsPath`/`uri`, or undefined for untitled documents
 *
 * @example
 * ```typescript
 * const location = getFilePath(editor);
 * if (location) {
 *   // Works whether the file is local, over Remote-SSH/WSL, or a Codespace.
 *   console.log(location.uri.scheme, location.fsPath);
 * }
 * ```
 */
export function getFilePath(editor: vscode.TextEditor): FilePathInfo | undefined {
  const { uri } = editor.document;
  if (uri.scheme === 'untitled') {
    return undefined;
  }
  return { fsPath: uri.fsPath, uri };
}

// ============================================
// Offset / Position Utilities
// ============================================

/**
 * Builds a table of the absolute offset where each line starts, in one pass
 * over the document text. Backs {@link resolvePositionsBatch} and
 * {@link resolveOffsetsBatch} so resolving many offsets/positions costs one
 * document scan instead of one internal lookup per item.
 *
 * Line breaks are `\r\n`, `\n`, and a lone `\r` — the same three VS Code's
 * own text buffer recognizes (`createLineStartsFast` in the piece tree).
 * Splitting on `\n` alone would agree with `TextDocument.positionAt` for LF
 * and CRLF documents but silently disagree on any document containing a bare
 * carriage return.
 */
function buildLineStartOffsets(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code === 13 /* '\r' */) {
      if (i + 1 < text.length && text.charCodeAt(i + 1) === 10 /* '\n' */) {
        i++; // \r\n is a single break
      }
      starts.push(i + 1);
    } else if (code === 10 /* '\n' */) {
      starts.push(i + 1);
    }
  }
  return starts;
}

/** Binary-searches `lineStarts` for the line containing `offset`. */
function findLineForOffset(lineStarts: readonly number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }
  return low;
}

/**
 * Builds a Range from a pair of document offsets, composing two
 * `TextDocument.positionAt` lookups into the Range callers actually need
 * for `editBuilder`/`WorkspaceEdit` calls.
 *
 * @param document - The text document
 * @param startOffset - Start offset (inclusive)
 * @param endOffset - End offset (exclusive)
 * @returns A Range spanning the two offsets
 *
 * @example
 * ```typescript
 * const match = /TODO:/.exec(document.getText());
 * if (match) {
 *   const range = rangeFromOffsets(document, match.index, match.index + match[0].length);
 * }
 * ```
 */
export function rangeFromOffsets(
  document: vscode.TextDocument,
  startOffset: number,
  endOffset: number
): vscode.Range {
  return new vscode.Range(document.positionAt(startOffset), document.positionAt(endOffset));
}

/**
 * Gets the text between two document offsets — composes {@link rangeFromOffsets}
 * with `TextDocument.getText` for the common "I have offsets from a regex match"
 * case, without the caller reaching for `positionAt` directly.
 *
 * @param document - The text document
 * @param startOffset - Start offset (inclusive)
 * @param endOffset - End offset (exclusive)
 * @returns The text between the two offsets
 *
 * @example
 * ```typescript
 * const snippet = getTextInOffsetRange(document, match.index, match.index + match[0].length);
 * ```
 */
export function getTextInOffsetRange(
  document: vscode.TextDocument,
  startOffset: number,
  endOffset: number
): string {
  return document.getText(rangeFromOffsets(document, startOffset, endOffset));
}

/**
 * Resolves many offsets to Positions in a single pass over the document,
 * instead of calling `TextDocument.positionAt` once per offset. Intended for
 * cases like "convert every regex match in a large document to a Range",
 * where the number of lookups can be large.
 *
 * Out-of-range offsets are clamped to `[0, document length]`, matching
 * `TextDocument.positionAt`'s own behavior.
 *
 * @param document - The text document
 * @param offsets - Offsets to resolve, in any order; duplicates are fine
 * @param token - Optional cancellation token, checked between lookups for large batches
 * @returns Positions in the same order as `offsets`
 * @throws `vscode.CancellationError` if `token` is (or becomes) cancelled
 *
 * @example
 * ```typescript
 * const offsets = [...text.matchAll(/TODO:/g)].map((m) => m.index);
 * const positions = resolvePositionsBatch(document, offsets);
 * ```
 */
export function resolvePositionsBatch(
  document: vscode.TextDocument,
  offsets: readonly number[],
  token?: vscode.CancellationToken
): vscode.Position[] {
  if (offsets.length === 0) {
    return [];
  }
  if (token?.isCancellationRequested) {
    throw new vscode.CancellationError();
  }

  const text = document.getText();
  const lineStarts = buildLineStartOffsets(text);

  const positions: vscode.Position[] = [];
  for (const rawOffset of offsets) {
    if (token?.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
    const offset = Math.max(0, Math.min(rawOffset, text.length));
    const line = findLineForOffset(lineStarts, offset);
    positions.push(new vscode.Position(line, offset - (lineStarts[line] ?? 0)));
  }
  return positions;
}

/**
 * Resolves many Positions to offsets in a single pass over the document —
 * the inverse of {@link resolvePositionsBatch}, for cases like sorting or
 * measuring distances between a large set of positions (e.g. diagnostics,
 * selections) without calling `TextDocument.offsetAt` once per item.
 *
 * Out-of-range line numbers are clamped to the document's line range;
 * unlike `TextDocument.offsetAt`, out-of-range *characters* are not clamped
 * to the line's actual length, so pass positions already valid for the
 * document.
 *
 * @param document - The text document
 * @param positions - Positions to resolve, in any order; duplicates are fine
 * @param token - Optional cancellation token, checked between lookups for large batches
 * @returns Offsets in the same order as `positions`
 * @throws `vscode.CancellationError` if `token` is (or becomes) cancelled
 *
 * @example
 * ```typescript
 * const offsets = resolveOffsetsBatch(document, diagnostics.map((d) => d.range.start));
 * ```
 */
export function resolveOffsetsBatch(
  document: vscode.TextDocument,
  positions: readonly vscode.Position[],
  token?: vscode.CancellationToken
): number[] {
  if (positions.length === 0) {
    return [];
  }
  if (token?.isCancellationRequested) {
    throw new vscode.CancellationError();
  }

  const lineStarts = buildLineStartOffsets(document.getText());
  const maxLine = lineStarts.length - 1;

  const offsets: number[] = [];
  for (const position of positions) {
    if (token?.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
    const line = Math.max(0, Math.min(position.line, maxLine));
    offsets.push((lineStarts[line] ?? 0) + position.character);
  }
  return offsets;
}

// ============================================
// Workspace Edits
// ============================================

/**
 * Applies multiple `editor.edit()` calls as a single Undo/Redo step.
 *
 * By default, every `editor.edit()` call creates its own undo stop before
 * and after, so calling this module's edit functions back-to-back produces
 * one Undo step per call. This groups a sequence of edit-builder callbacks
 * so only the first adds an undo-stop-before and only the last adds an
 * undo-stop-after — the whole sequence collapses into one Undo from the
 * user's perspective.
 *
 * @param editor - The text editor
 * @param edits - Ordered edit-builder callbacks; each becomes its own `editor.edit()` call
 * @returns true if every edit in the sequence applied successfully
 *
 * @example
 * ```typescript
 * await applyEditsGrouped(editor, [
 *   (eb) => eb.insert(pos1, 'foo'),
 *   (eb) => eb.replace(range2, 'bar'),
 * ]); // looks like a single Undo to the user
 * ```
 */
export async function applyEditsGrouped(
  editor: vscode.TextEditor,
  edits: readonly ((editBuilder: vscode.TextEditorEdit) => void)[]
): Promise<boolean> {
  if (edits.length === 0) {
    return true;
  }

  const lastIndex = edits.length - 1;
  let allApplied = true;
  for (const [index, callback] of edits.entries()) {
    const applied = await editor.edit(callback, {
      undoStopBefore: index === 0,
      undoStopAfter: index === lastIndex,
    });
    allApplied = allApplied && applied;
  }
  return allApplied;
}

/**
 * Applies a set of text edits across one or more files atomically, via
 * `vscode.WorkspaceEdit` + `workspace.applyEdit`. Unlike the `editor.edit()`-based
 * functions in this module, this does not require the target file(s) to be
 * open in a visible editor, and can touch multiple files in one transaction.
 *
 * @param edits - Edits to apply; multiple entries for the same `uri` are all included
 * @param options - Metadata for the edit (label, confirmation, refactoring flag) and an optional cancellation token
 * @returns true if the edit was applied successfully (mirrors `workspace.applyEdit`'s own return value)
 * @throws `vscode.CancellationError` if `options.token` is (or becomes) cancelled
 *
 * @example
 * ```typescript
 * await applyWorkspaceEdits(
 *   matches.map((m) => ({ uri: m.uri, range: m.range, newText: m.replacement })),
 *   { label: 'Rename symbol across files', needsConfirmation: false }
 * );
 * ```
 */
export async function applyWorkspaceEdits(
  edits: readonly WorkspaceEditEntry[],
  options: ApplyWorkspaceEditsOptions = {}
): Promise<boolean> {
  const { label, needsConfirmation, isRefactoring, token } = options;
  const entryMetadata: vscode.WorkspaceEditEntryMetadata | undefined =
    label !== undefined || needsConfirmation !== undefined
      ? { label: label ?? '', needsConfirmation: needsConfirmation ?? false }
      : undefined;

  const edit = new vscode.WorkspaceEdit();
  for (const { uri, range, newText } of edits) {
    if (token?.isCancellationRequested) {
      throw new vscode.CancellationError();
    }
    edit.replace(uri, range, newText, entryMetadata);
  }

  return vscode.workspace.applyEdit(
    edit,
    isRefactoring !== undefined ? { isRefactoring } : undefined
  );
}
