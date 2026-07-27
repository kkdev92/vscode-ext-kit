import * as vscode from 'vscode';

// ============================================
// Types
// ============================================

/**
 * A {@link vscode.QuickPickItem} carrying a strongly-typed value, separating
 * what is *displayed* (label/description/detail/icon) from what the caller
 * actually wants back. Build these with {@link toPickItem} rather than by
 * hand.
 */
export interface PickItem<T> extends vscode.QuickPickItem {
  /** The value associated with this item, returned to the caller on selection. */
  value: T;
}

/** Display options accepted by {@link toPickItem}. */
export interface PickItemDisplay {
  /** A human-readable string which is rendered prominently. */
  label: string;
  /** A human-readable string which is rendered less prominently on the same line. */
  description?: string;
  /** A human-readable string which is rendered less prominently on a separate line. */
  detail?: string;
  /** A codicon name (e.g. `'file'`) or a {@link vscode.ThemeIcon} to show next to the label. */
  icon?: string | vscode.ThemeIcon;
  /** Whether this item is initially selected (only honored by `pickMany`). */
  picked?: boolean;
  /** Keeps the item visible even when filtered out by the user's typed input. */
  alwaysShow?: boolean;
  /** Inline buttons rendered on this item (only shown via the `Thenable`-items code path; see {@link pickOne}). */
  buttons?: readonly vscode.QuickInputButton[];
  /**
   * A resource URI. When set, VS Code derives the label/description/icon
   * from the file (name, path, and file-icon-theme icon) for any of those
   * fields left unset (VS Code 1.108+; ignored on older hosts).
   */
  resourceUri?: vscode.Uri;
}

// ============================================
// Item helpers
// ============================================

/**
 * Builds a type-safe {@link PickItem} from a value and its display options.
 * Keeps the value your code cares about separate from the label string the
 * user sees, so callers never need to parse a label back into data.
 *
 * @param value - The value to return when this item is selected
 * @param display - Label, description, icon, and other display options
 * @returns A `QuickPickItem` carrying `value`
 *
 * @example
 * ```typescript
 * const items = [
 *   toPickItem('feature', { label: 'Feature', description: 'New feature' }),
 *   toPickItem('fix', { label: 'Bug Fix', description: 'Fix a bug', icon: 'bug' }),
 * ];
 * const selected = await pickOne(items);
 * if (selected) {
 *   console.log(selected.value); // 'feature' | 'fix', not a label string
 * }
 * ```
 */
export function toPickItem<T>(value: T, display: PickItemDisplay): PickItem<T> {
  return {
    value,
    label: display.label,
    description: display.description,
    detail: display.detail,
    iconPath: typeof display.icon === 'string' ? new vscode.ThemeIcon(display.icon) : display.icon,
    picked: display.picked,
    alwaysShow: display.alwaysShow,
    buttons: display.buttons,
    resourceUri: display.resourceUri,
  };
}

/**
 * Creates a non-selectable separator for grouping items in a QuickPick list
 * (`QuickPickItemKind.Separator`). Mix these into the array passed to
 * {@link pickOne}/{@link pickMany}.
 *
 * @param label - Text shown on the separator (default: empty)
 * @returns A `QuickPickItem` that renders as a visual group divider
 *
 * @example
 * ```typescript
 * const items = [
 *   toPickSeparator('Recent'),
 *   toPickItem('a', { label: 'A' }),
 *   toPickSeparator('All'),
 *   toPickItem('b', { label: 'B' }),
 * ];
 * ```
 */
export function toPickSeparator(label = ''): vscode.QuickPickItem {
  return { label, kind: vscode.QuickPickItemKind.Separator };
}

// ============================================
// Internal: Thenable-items engine
// ============================================

function isThenable<T>(value: unknown): value is Thenable<T> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}

/** Applies the subset of `QuickPickOptions` that map onto `QuickPick<T>` properties (naming differs between the two APIs — e.g. `placeHolder` vs `placeholder`). */
function applyQuickPickOptions<T extends vscode.QuickPickItem>(
  quickPick: vscode.QuickPick<T>,
  opts: vscode.QuickPickOptions | undefined
): void {
  quickPick.title = opts?.title;
  quickPick.placeholder = opts?.placeHolder;
  quickPick.matchOnDescription = opts?.matchOnDescription ?? false;
  quickPick.matchOnDetail = opts?.matchOnDetail ?? false;
  quickPick.ignoreFocusOut = opts?.ignoreFocusOut ?? false;
}

/**
 * Shows a `createQuickPick`-based picker for items that resolve
 * asynchronously: the picker opens immediately in a `busy` state, then
 * populates once `items` resolves. Resolving with `undefined` (Escape,
 * blur without `ignoreFocusOut`) settles the returned promise with
 * `undefined`.
 */
function pickFromThenable<T extends vscode.QuickPickItem>(
  items: Thenable<readonly T[]>,
  opts: vscode.QuickPickOptions | undefined,
  many: boolean
): Promise<T | T[] | undefined> {
  return new Promise((resolve, reject) => {
    const quickPick = vscode.window.createQuickPick<T>();
    applyQuickPickOptions(quickPick, opts);
    quickPick.canSelectMany = many;

    quickPick.onDidAccept(() => {
      const value = many ? [...quickPick.selectedItems] : quickPick.selectedItems[0];
      resolve(value);
      quickPick.dispose();
    });
    quickPick.onDidHide(() => {
      resolve(undefined);
      quickPick.dispose();
    });

    quickPick.busy = true;
    quickPick.show();

    items.then(
      (resolved) => {
        quickPick.items = resolved;
        quickPick.busy = false;
      },
      (error: unknown) => {
        quickPick.dispose();
        reject(error);
      }
    );
  });
}

// ============================================
// pickOne / pickMany
// ============================================

/**
 * Shows a QuickPick for single item selection.
 *
 * `items` may be a plain array (delegates straight to
 * {@link vscode.window.showQuickPick}) or a `Thenable`/`Promise`, in which
 * case the picker opens immediately with a busy indicator while the items
 * resolve — useful when building the list requires an API call or file
 * system scan.
 *
 * @param items - Items to display, or a promise that resolves to them
 * @param opts - QuickPick options
 * @returns Selected item or undefined if cancelled
 *
 * @example
 * ```typescript
 * const items = [
 *   toPickItem(1, { label: 'Option 1', description: 'First option' }),
 *   toPickItem(2, { label: 'Option 2', description: 'Second option' }),
 * ];
 * const selected = await pickOne(items, { placeHolder: 'Select an option' });
 * if (selected) {
 *   console.log(selected.value);
 * }
 *
 * // Async items: the picker shows a busy spinner while `fetchBranches` runs.
 * const branch = await pickOne(fetchBranches().then((names) => names.map((n) => toPickItem(n, { label: n }))));
 * ```
 */
export async function pickOne<T extends vscode.QuickPickItem>(
  items: readonly T[] | Thenable<readonly T[]>,
  opts?: vscode.QuickPickOptions
): Promise<T | undefined> {
  if (isThenable<readonly T[]>(items)) {
    return (await pickFromThenable(items, opts, false)) as T | undefined;
  }
  return vscode.window.showQuickPick(items, { ...opts, canPickMany: false }) as Promise<
    T | undefined
  >;
}

/**
 * Shows a QuickPick for multiple item selection.
 *
 * `items` may be a plain array (delegates straight to
 * {@link vscode.window.showQuickPick}) or a `Thenable`/`Promise`, in which
 * case the picker opens immediately with a busy indicator while the items
 * resolve.
 *
 * @param items - Items to display, or a promise that resolves to them
 * @param opts - QuickPick options
 * @returns Array of selected items or undefined if cancelled
 *
 * @example
 * ```typescript
 * const items = [
 *   toPickItem('a', { label: 'Feature A', picked: true }),
 *   toPickItem('b', { label: 'Feature B' }),
 * ];
 * const selected = await pickMany(items, { placeHolder: 'Select features' });
 * if (selected && selected.length > 0) {
 *   console.log('Selected:', selected.map((s) => s.value));
 * }
 * ```
 */
export async function pickMany<T extends vscode.QuickPickItem>(
  items: readonly T[] | Thenable<readonly T[]>,
  opts?: vscode.QuickPickOptions
): Promise<T[] | undefined> {
  if (isThenable<readonly T[]>(items)) {
    return (await pickFromThenable(items, opts, true)) as T[] | undefined;
  }
  return vscode.window.showQuickPick(items, { ...opts, canPickMany: true }) as Promise<
    T[] | undefined
  >;
}
