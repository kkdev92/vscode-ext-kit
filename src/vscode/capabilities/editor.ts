/**
 * Editor adapter: converts nominal VS Code values to the framework's plain,
 * vscode-free editor port and back again.
 *
 * Keep conversions at this boundary. Returning a native `TextEditor`, `Range`
 * or `WorkspaceEdit` would make feature code untestable without the Extension
 * Host and would let VS Code object identity become part of the public contract.
 */
import * as vscode from 'vscode';

import type {
  ActiveTextEditor,
  EditorCapability,
  TextEdit,
  TextEditOptions,
  TextPosition,
  TextRange,
  WorkspaceEditOptions,
  WorkspaceTextEdit,
} from '../../foundation/platform/ports.js';

/**
 * The real editor surface, backed by `vscode.window.activeTextEditor` and
 * `vscode.workspace.applyEdit`.
 *
 * This adapter converts in both directions rather than passing objects through,
 * because the public API expects its nominal `Position` and `Range` values, not
 * the port's plain `{ line, character }` and `{ start, end }` records. The
 * conversion happens once here so everything above the port speaks plain data.
 */

/** Rehydrates a plain position as the nominal class required by VS Code APIs. */
function toPosition(position: TextPosition): vscode.Position {
  return new vscode.Position(position.line, position.character);
}

/** Rehydrates both endpoints; never cast a plain port range to this class. */
function toRange(range: TextRange): vscode.Range {
  return new vscode.Range(toPosition(range.start), toPosition(range.end));
}

/**
 * Narrows a VS Code range to plain data.
 *
 * Copied field by field rather than handed over: a `vscode.Range` carries
 * methods and identity a caller should not come to depend on, and the copy is
 * what makes `toEqual` in a test mean what it looks like it means.
 */
function fromRange(range: vscode.Range): TextRange {
  return {
    start: { line: range.start.line, character: range.start.character },
    end: { line: range.end.line, character: range.end.character },
  };
}

/**
 * Converts one `vscode.TextEditor` into the editor port.
 *
 * Shared with the command adapter, which is handed a specific editor rather
 * than the focused one: a text editor command and `Editors.active` have to
 * produce the same thing, or a feature would behave differently depending on
 * how its command happened to be declared.
 */
export function wrapActive(editor: vscode.TextEditor): ActiveTextEditor {
  const document = editor.document;

  return {
    // Uri is the deliberate exception to the plain-data copy: the port treats
    // it as opaque and later adapters must hand the same platform value back.
    uri: document.uri,
    languageId: document.languageId,
    lineCount: document.lineCount,

    get selections(): readonly TextRange[] {
      return editor.selections.map(fromRange);
    },

    getText: (range) => document.getText(range === undefined ? undefined : toRange(range)),

    lineRange(line): TextRange | undefined {
      if (line < 0 || line >= document.lineCount) {
        return undefined;
      }
      return fromRange(document.lineAt(line).range);
    },

    wordRangeAt(position, pattern): TextRange | undefined {
      const range = document.getWordRangeAtPosition(toPosition(position), pattern);
      return range === undefined ? undefined : fromRange(range);
    },

    applyEdits(edits: readonly TextEdit[], options?: TextEditOptions): Promise<boolean> {
      // An empty batch that asks for a boundary is a boundary request: VS Code
      // places the stop even though the edit itself changes nothing, and that
      // is how a run of batches closes its undo step after the fact. Without an
      // explicit stop there is genuinely nothing to do, and calling `edit` for
      // it would place the default stops on both sides of a no-op.
      if (edits.length === 0 && options?.undoStop === undefined) {
        return Promise.resolve(true);
      }
      // One call: VS Code resolves every replacement against the document as it
      // was when the call started, which is what makes a batch atomic.
      //
      // The undo stops are what let several batches be joined into one step.
      // VS Code takes them per call, so "no stop after this one" is how a
      // caller says "more is coming".
      const stop = options?.undoStop ?? 'both';
      return Promise.resolve(
        editor.edit(
          (builder) => {
            for (const edit of edits) {
              builder.replace(toRange(edit.range), edit.text);
            }
          },
          {
            undoStopBefore: stop === 'both' || stop === 'before',
            undoStopAfter: stop === 'both' || stop === 'after',
          }
        )
      );
    },

    select(selections): void {
      const next = selections.map(
        (range) => new vscode.Selection(toPosition(range.start), toPosition(range.end))
      );
      if (next.length > 0) {
        editor.selections = next;
      }
      // An empty list is ignored because VS Code requires at least one primary
      // selection; keeping the current selection is the least surprising port
      // behavior and matches the fake.
    },

    reveal(range): void {
      editor.revealRange(toRange(range));
    },
  };
}

/**
 * Creates the real editor capability.
 *
 * This object does not subscribe to editor events or retain an editor. `active`
 * is read on every access so a focus change cannot leave callers with a stale
 * wrapper unless they deliberately keep the returned snapshot themselves.
 *
 * @example
 * ```ts
 * const capability = createVSCodeEditorCapability();
 * capability.active?.getText();
 * ```
 */
export function createVSCodeEditorCapability(): EditorCapability {
  return {
    get active(): ActiveTextEditor | undefined {
      const editor = vscode.window.activeTextEditor;
      return editor === undefined ? undefined : wrapActive(editor);
    },

    // `async` so an abort surfaces as a rejection rather than a synchronous
    // throw from a function whose type says it returns a promise.
    async applyWorkspaceEdit(
      edits: readonly WorkspaceTextEdit[],
      options: WorkspaceEditOptions = {}
    ): Promise<boolean> {
      const { label, needsConfirmation, isRefactoring } = options;
      // VS Code's metadata contract requires a label whenever confirmation is
      // specified. The port permits either field independently, so fill the
      // neutral counterpart here instead of leaking that platform quirk upward.
      const metadata: vscode.WorkspaceEditEntryMetadata | undefined =
        label !== undefined || needsConfirmation !== undefined
          ? { label: label ?? '', needsConfirmation: needsConfirmation ?? false }
          : undefined;

      const edit = new vscode.WorkspaceEdit();
      for (const entry of edits) {
        // Checked per entry: assembling a hundred thousand replacements the
        // caller has already given up on helps nobody.
        options.signal?.throwIfAborted();
        // The port carries the platform's own Uri through opaquely, the way
        // `SettingsScope.resource` and `RelativePatternLike.baseUri` already do:
        // a caller gets one from `editors.active.location()` or `Uri.file`, and
        // nothing above the port constructs one.
        edit.replace(entry.uri as vscode.Uri, toRange(entry.range), entry.text, metadata);
      }

      return vscode.workspace.applyEdit(
        edit,
        isRefactoring === undefined ? undefined : { isRefactoring }
      );
    },
  };
}
