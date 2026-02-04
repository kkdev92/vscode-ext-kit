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

// ============================================
// Text Operations
// ============================================

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
  return editor.edit((editBuilder) => {
    editBuilder.replace(range, text);
  });
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
  if (lineNumber < 0 || lineNumber >= editor.document.lineCount) {
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

  const text = editor.document.getText(selection);
  const transformed = transform(text);

  return editor.edit((editBuilder) => {
    editBuilder.replace(selection, transformed);
  });
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

  return editor.edit((editBuilder) => {
    selections.forEach((selection, index) => {
      const text = editor.document.getText(selection);
      const transformed = transform(text, index);
      editBuilder.replace(selection, transformed);
    });
  });
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
  if (lineNumber < 0 || lineNumber >= editor.document.lineCount) {
    return;
  }
  const line = editor.document.lineAt(lineNumber);
  selectRange(editor, line.range);
}

/**
 * Selects the word at the current cursor position.
 *
 * @param editor - The text editor
 * @returns true if a word was selected
 *
 * @example
 * ```typescript
 * if (selectWord(editor)) {
 *   const word = getSelectedText(editor);
 * }
 * ```
 */
export function selectWord(editor: vscode.TextEditor): boolean {
  const position = editor.selection.active;
  const wordRange = editor.document.getWordRangeAtPosition(position);

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
 * Gets the total number of lines in the document.
 *
 * @param editor - The text editor
 * @returns Number of lines
 */
export function getLineCount(editor: vscode.TextEditor): number {
  return editor.document.lineCount;
}

/**
 * Gets the entire document text.
 *
 * @param editor - The text editor
 * @returns Full document text
 */
export function getDocumentText(editor: vscode.TextEditor): string {
  return editor.document.getText();
}

/**
 * Gets the file path of the document.
 *
 * @param editor - The text editor
 * @returns File path, or undefined for untitled documents
 */
export function getFilePath(editor: vscode.TextEditor): string | undefined {
  return editor.document.uri.scheme === 'file' ? editor.document.uri.fsPath : undefined;
}

/**
 * Checks if the document has unsaved changes.
 *
 * @param editor - The text editor
 * @returns true if document is dirty
 */
export function isDirty(editor: vscode.TextEditor): boolean {
  return editor.document.isDirty;
}

/**
 * Gets the language ID of the document.
 *
 * @param editor - The text editor
 * @returns Language identifier (e.g., 'typescript', 'javascript')
 */
export function getLanguageId(editor: vscode.TextEditor): string {
  return editor.document.languageId;
}
