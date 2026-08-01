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
  /**
   * Inline buttons rendered on this item. Build them with
   * {@link toPickButton}.
   *
   * **Not usable through {@link pickOne}/{@link pickMany}.** Those resolve
   * with the selection and nothing else, so there is no way to subscribe to
   * `onDidTriggerItemButton` and a press can never be handled — the buttons
   * would render as dead pixels. Drive `vscode.window.createQuickPick`
   * yourself when you need item buttons; this field exists so items built
   * with {@link toPickItem} can be fed to such a picker unchanged.
   */
  buttons?: readonly vscode.QuickInputButton[];
  /**
   * A resource URI. When set, VS Code derives the label/description/icon
   * from the file (name, path, and file-icon-theme icon) for any of those
   * fields left unset.
   */
  resourceUri?: vscode.Uri;
}

/** Options accepted by {@link toPickButton}. */
export interface PickButtonOptions {
  /** Tooltip shown when hovering over the button. */
  tooltip?: string;
  /**
   * Where the button is rendered (default: the title bar).
   *
   * Ignored for buttons attached to an item via
   * {@link PickItemDisplay.buttons} — VS Code always renders those inline on
   * the item itself.
   */
  location?: vscode.QuickInputButtonLocation;
  /**
   * Makes this a toggle button with the given initial checked state.
   *
   * VS Code updates `checked` **in place** on the returned button before
   * firing its trigger event, so read the state back off the same button
   * object inside the handler rather than tracking it separately.
   */
  toggled?: boolean;
}

/** Options accepted by {@link pickOne} and {@link pickMany}. */
export interface PickOptions extends vscode.QuickPickOptions {
  /**
   * Instructional text shown below the filter box and above the items.
   *
   * Setting this routes the picker through `createQuickPick` (the same path
   * used for async items), because `showQuickPick` has no prompt. That path
   * does not honor {@link vscode.QuickPickOptions.onDidSelectItem}.
   */
  prompt?: string;
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

/**
 * Builds a {@link vscode.QuickInputButton}, accepting a codicon name in place
 * of a hand-built {@link vscode.ThemeIcon} the same way {@link toPickItem}
 * does for item icons.
 *
 * Handling a press means subscribing to `onDidTriggerButton` /
 * `onDidTriggerItemButton`, which only a `QuickPick`/`InputBox` you own
 * exposes — so buttons belong to pickers driven through
 * `vscode.window.createQuickPick`, not to {@link pickOne}/{@link pickMany}
 * (which resolve with the selection alone).
 *
 * @param icon - A codicon name (e.g. `'refresh'`) or an explicit icon path
 * @param opts - Tooltip, render location, and toggle state
 * @returns A button usable as a `QuickPick`/`InputBox` button or a
 *   {@link PickItemDisplay.buttons} entry
 *
 * @example
 * ```typescript
 * // A plain title-bar button.
 * const refresh = toPickButton('refresh', { tooltip: 'Reload the list' });
 *
 * // A toggle rendered inside the input box. VS Code flips `checked` for you.
 * const showHidden = toPickButton('eye', {
 *   tooltip: 'Show hidden files',
 *   location: vscode.QuickInputButtonLocation.Input,
 *   toggled: false,
 * });
 *
 * quickPick.buttons = [refresh, showHidden];
 * quickPick.onDidTriggerButton((button) => {
 *   if (button === showHidden) {
 *     refilter(showHidden.toggle?.checked ?? false);
 *   }
 * });
 * ```
 */
export function toPickButton(
  icon: string | vscode.IconPath,
  opts: PickButtonOptions = {}
): vscode.QuickInputButton {
  return {
    iconPath: typeof icon === 'string' ? new vscode.ThemeIcon(icon) : icon,
    tooltip: opts.tooltip,
    location: opts.location,
    // Attach `toggle` only when one was asked for — its presence is what makes
    // a button a toggle, and `toggled: false` still has to produce one.
    ...(opts.toggled === undefined ? {} : { toggle: { checked: opts.toggled } }),
  };
}

// ============================================
// Internal: createQuickPick engine
// ============================================

function isThenable<T>(value: unknown): value is Thenable<T> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}

/** Applies the subset of `PickOptions` that map onto `QuickPick<T>` properties (naming differs between the two APIs — e.g. `placeHolder` vs `placeholder`). */
function applyQuickPickOptions<T extends vscode.QuickPickItem>(
  quickPick: vscode.QuickPick<T>,
  opts: PickOptions | undefined
): void {
  quickPick.title = opts?.title;
  quickPick.placeholder = opts?.placeHolder;
  quickPick.prompt = opts?.prompt;
  quickPick.matchOnDescription = opts?.matchOnDescription ?? false;
  quickPick.matchOnDetail = opts?.matchOnDetail ?? false;
  quickPick.ignoreFocusOut = opts?.ignoreFocusOut ?? false;
}

/**
 * Shows a `createQuickPick`-based picker — the path taken whenever
 * `showQuickPick` cannot express what was asked for (async items, or a
 * `prompt`). Async items open the picker immediately in a `busy` state and
 * populate once they resolve. Hiding (Escape, blur without `ignoreFocusOut`)
 * settles the returned promise with `undefined`.
 */
function pickFromQuickPick<T extends vscode.QuickPickItem>(
  items: readonly T[] | Thenable<readonly T[]>,
  opts: PickOptions | undefined,
  many: boolean
): Promise<T | T[] | undefined> {
  return new Promise((resolve, reject) => {
    const quickPick = vscode.window.createQuickPick<T>();
    let settled = false;

    // Disposing a *visible* quick pick makes VS Code fire `onDidHide`, so every
    // exit path re-enters the hide handler. Claim the promise before tearing
    // down — without this guard the rejection below loses the race to
    // `onDidHide`'s `resolve(undefined)` and the error is swallowed. Same
    // shape as `wizard.ts`'s `finish`/`fail`.
    const settle = (outcome: () => void): void => {
      if (settled) return;
      settled = true;
      outcome();
      quickPick.dispose();
    };

    applyQuickPickOptions(quickPick, opts);
    quickPick.canSelectMany = many;

    quickPick.onDidAccept(() => {
      settle(() => resolve(many ? [...quickPick.selectedItems] : quickPick.selectedItems[0]));
    });
    quickPick.onDidHide(() => {
      settle(() => resolve(undefined));
    });

    if (!isThenable<readonly T[]>(items)) {
      // Assign before `show()` so a synchronous list never flashes empty, and
      // never raise `busy` for a list that is already here.
      quickPick.items = items;
      quickPick.show();
      return;
    }

    quickPick.busy = true;
    quickPick.show();

    items.then(
      (resolved) => {
        // A no-op if the user already dismissed the picker: VS Code ignores
        // property writes on a disposed quick input rather than throwing.
        quickPick.items = resolved;
        quickPick.busy = false;
      },
      (error: unknown) => {
        settle(() => reject(error));
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
 *
 * // `prompt` adds a line of instructional text above the list.
 * const target = await pickOne(items, { prompt: 'This cannot be undone.' });
 * ```
 */
export async function pickOne<T extends vscode.QuickPickItem>(
  items: readonly T[] | Thenable<readonly T[]>,
  opts?: PickOptions
): Promise<T | undefined> {
  if (isThenable<readonly T[]>(items) || opts?.prompt !== undefined) {
    return (await pickFromQuickPick(items, opts, false)) as T | undefined;
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
  opts?: PickOptions
): Promise<T[] | undefined> {
  if (isThenable<readonly T[]>(items) || opts?.prompt !== undefined) {
    return (await pickFromQuickPick(items, opts, true)) as T[] | undefined;
  }
  return vscode.window.showQuickPick(items, { ...opts, canPickMany: true }) as Promise<
    T[] | undefined
  >;
}
