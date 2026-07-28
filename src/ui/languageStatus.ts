import * as vscode from 'vscode';

// ============================================
// Types
// ============================================

/** Severity shown on a language status item's icon (mirrors `notification`'s `'info' | 'warn' | 'error'` vocabulary). */
export type LanguageStatusItemSeverity = 'info' | 'warn' | 'error';

/**
 * Options accepted by both {@link createLanguageStatusItem} (as the initial
 * state) and {@link ManagedLanguageStatusItem.update} (as a partial patch,
 * minus `text`, which `update` takes as its own first argument).
 */
export interface LanguageStatusItemOptions {
  /** Short name shown in the "Language Status" hover, e.g. `'ESLint'`. */
  name: string;
  /** The text to show for the entry. Supports `$(icon-name)` codicon syntax. */
  text: string;
  /** Optional human-readable detail, shown below `text` in the hover. */
  detail?: string;
  /** Command invoked when the item is clicked. */
  command?: vscode.Command;
  /** Icon/severity shown next to the item (default: `'info'`). */
  severity?: LanguageStatusItemSeverity;
  /** Shows a busy indicator (default: `false`). */
  busy?: boolean;
  /** Accessibility information used when a screen reader interacts with this item. */
  accessibilityInformation?: vscode.AccessibilityInformation;
}

/** A patch applied by {@link ManagedLanguageStatusItem.update}; every field is optional. */
export type LanguageStatusItemUpdate = Partial<Omit<LanguageStatusItemOptions, 'name'>>;

/**
 * A managed language status item with a single `update()` entry point,
 * mirroring {@link createStatusBarItem}'s `ManagedStatusBarItem` shape.
 */
export interface ManagedLanguageStatusItem extends vscode.Disposable {
  /**
   * Updates the text and optionally any other property.
   *
   * @param text - New text to display
   * @param opts - Other properties to update (detail, severity, busy, command, accessibility)
   */
  update(text: string, opts?: LanguageStatusItemUpdate): void;

  /** The underlying VS Code LanguageStatusItem. */
  readonly native: vscode.LanguageStatusItem;
}

function toSeverity(
  severity: LanguageStatusItemSeverity | undefined
): vscode.LanguageStatusSeverity {
  switch (severity) {
    case 'warn':
      return vscode.LanguageStatusSeverity.Warning;
    case 'error':
      return vscode.LanguageStatusSeverity.Error;
    default:
      return vscode.LanguageStatusSeverity.Information;
  }
}

// ============================================
// createLanguageStatusItem
// ============================================

/**
 * Creates a managed language status item (`vscode.languages.createLanguageStatusItem`,
 * finalized in VS Code 1.65+).
 *
 * Unlike a regular status bar item, a language status item is shown only
 * while the active editor's language matches `selector`, in the dedicated
 * "Language Status" area — useful for linter/formatter state, active
 * toolchain version, or other per-language status that shouldn't compete
 * for space in the general status bar.
 *
 * @param id - Unique identifier for the item
 * @param selector - Editors whose language matches this selector show the item
 * @param options - Initial name, text, and other display options
 * @returns A managed language status item with an `update()` helper
 *
 * @example
 * ```typescript
 * const status = createLanguageStatusItem('myext.eslint', { language: 'typescript' }, {
 *   name: 'ESLint',
 *   text: '$(check) No issues',
 * });
 * context.subscriptions.push(status);
 *
 * // Later, after a lint run:
 * status.update('$(warning) 3 problems', { severity: 'warn' });
 * ```
 */
export function createLanguageStatusItem(
  id: string,
  selector: vscode.DocumentSelector,
  options: LanguageStatusItemOptions
): ManagedLanguageStatusItem {
  const item = vscode.languages.createLanguageStatusItem(id, selector);

  item.name = options.name;
  item.text = options.text;
  item.detail = options.detail;
  item.command = options.command;
  item.severity = toSeverity(options.severity);
  item.busy = options.busy ?? false;
  if (options.accessibilityInformation !== undefined) {
    item.accessibilityInformation = options.accessibilityInformation;
  }

  return {
    update(text: string, opts: LanguageStatusItemUpdate = {}): void {
      item.text = text;
      if (opts.detail !== undefined) {
        item.detail = opts.detail;
      }
      if (opts.command !== undefined) {
        item.command = opts.command;
      }
      if (opts.severity !== undefined) {
        item.severity = toSeverity(opts.severity);
      }
      if (opts.busy !== undefined) {
        item.busy = opts.busy;
      }
      if (opts.accessibilityInformation !== undefined) {
        item.accessibilityInformation = opts.accessibilityInformation;
      }
    },

    get native(): vscode.LanguageStatusItem {
      return item;
    },

    dispose(): void {
      item.dispose();
    },
  };
}
