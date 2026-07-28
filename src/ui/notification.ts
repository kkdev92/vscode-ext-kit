import * as vscode from 'vscode';

// ============================================
// Types
// ============================================

/**
 * An action button for {@link showInfo}/{@link showWarn}/{@link showError}.
 * `title` is what the user sees; `value` is what the caller gets back —
 * keeping the two separate means a localized/dynamic label never has to
 * double as the code's branching key.
 */
export interface NotifyAction<T> {
  /** Button label shown to the user. */
  title: string;
  /** Value returned to the caller when this button is clicked. */
  value: T;
  /** Whether this action is used when the user dismisses the dialog (e.g. Escape) on a modal. */
  isCloseAffordance?: boolean;
}

/**
 * Options for {@link showInfo}/{@link showWarn}/{@link showError}.
 *
 * `T` is inferred from `actions` — omit it entirely for a plain
 * notification with no buttons, whose result is always `undefined`.
 */
export interface NotifyOptions<T = never> {
  /** Show as a modal dialog instead of a toast notification. */
  modal?: boolean;
  /** Human-readable detail text. Only rendered when `modal: true` — VS Code silently ignores it otherwise. */
  detail?: string;
  /** Action buttons. Omit for a plain notification. */
  actions?: readonly NotifyAction<T>[];
}

/** A `MessageItem` that carries the caller's original `value` by reference, so no title-based lookup is needed to recover it. */
type ActionItem<T> = vscode.MessageItem & { readonly value: T };

// ============================================
// Show Notifications
// ============================================

async function show<T>(
  kind: 'info' | 'warn' | 'error',
  message: string,
  options: NotifyOptions<T>
): Promise<T | undefined> {
  const items: ActionItem<T>[] = (options.actions ?? []).map((action) => ({
    title: action.title,
    isCloseAffordance: action.isCloseAffordance,
    value: action.value,
  }));
  const messageOptions: vscode.MessageOptions = { modal: options.modal, detail: options.detail };

  let result: ActionItem<T> | undefined;
  switch (kind) {
    case 'info':
      result = await vscode.window.showInformationMessage(message, messageOptions, ...items);
      break;
    case 'warn':
      result = await vscode.window.showWarningMessage(message, messageOptions, ...items);
      break;
    case 'error':
      result = await vscode.window.showErrorMessage(message, messageOptions, ...items);
      break;
  }
  // VS Code resolves with the exact item object it was given, so the
  // value travels back by reference — no fragile title-string lookup
  // (this is what let two same-titled actions return the wrong value
  // in the pre-1.0 `showWithActions`).
  return result?.value;
}

/**
 * Shows an information notification, optionally with action buttons.
 *
 * @param message - The message to display
 * @param options - Modal/detail/action options
 * @returns The clicked action's `value`, or `undefined` if dismissed (or if there were no actions at all)
 *
 * @example
 * ```typescript
 * // Plain notification
 * await showInfo('Operation completed successfully');
 *
 * // With actions — the return type is inferred as 'reload' | 'ignore' | undefined
 * const action = await showInfo('File changed on disk', {
 *   actions: [
 *     { title: 'Reload', value: 'reload' as const },
 *     { title: 'Ignore', value: 'ignore' as const },
 *   ],
 * });
 * if (action === 'reload') {
 *   // ...
 * }
 * ```
 */
export function showInfo<T = never>(
  message: string,
  options: NotifyOptions<T> = {}
): Promise<T | undefined> {
  return show('info', message, options);
}

/**
 * Shows a warning notification, optionally with action buttons.
 *
 * @param message - The message to display
 * @param options - Modal/detail/action options
 * @returns The clicked action's `value`, or `undefined` if dismissed (or if there were no actions at all)
 *
 * @example
 * ```typescript
 * const action = await showWarn('Unsaved changes', {
 *   actions: [
 *     { title: 'Save', value: 'save' as const },
 *     { title: 'Discard', value: 'discard' as const },
 *     { title: 'Cancel', value: 'cancel' as const, isCloseAffordance: true },
 *   ],
 * });
 * ```
 */
export function showWarn<T = never>(
  message: string,
  options: NotifyOptions<T> = {}
): Promise<T | undefined> {
  return show('warn', message, options);
}

/**
 * Shows an error notification, optionally with action buttons.
 *
 * @param message - The message to display
 * @param options - Modal/detail/action options
 * @returns The clicked action's `value`, or `undefined` if dismissed (or if there were no actions at all)
 *
 * @example
 * ```typescript
 * const action = await showError('Failed to save file', {
 *   detail: String(error),
 *   actions: [{ title: 'Retry', value: 'retry' as const }],
 * });
 * ```
 */
export function showError<T = never>(
  message: string,
  options: NotifyOptions<T> = {}
): Promise<T | undefined> {
  return show('error', message, options);
}

// ============================================
// Confirm Dialog
// ============================================

/**
 * Options for {@link confirm}.
 */
export interface ConfirmOptions {
  /** Text for Yes button (default: 'Yes') */
  yesText?: string;
  /** Text for No button (default: 'No') */
  noText?: string;
  /** Show as modal dialog (default: true) */
  modal?: boolean;
  /** Detail text for modal */
  detail?: string;
  /**
   * Icon/dialog severity (default: `'warn'`). Not every confirmation is
   * about a destructive action — use `'info'` for a plain yes/no question.
   */
  severity?: 'info' | 'warn' | 'error';
  /**
   * When set, adds a "Don't Ask Again" button. Choosing it persists to
   * `remember.memento` under `remember.key`, and every subsequent call with
   * the same memento/key resolves to `true` immediately without prompting.
   * VS Code's own `window.show*Message` has no native checkbox for
   * extensions — this is the button-plus-persistence pattern extensions
   * commonly build by hand.
   */
  remember?: { memento: vscode.Memento; key: string };
}

const DONT_ASK_AGAIN = "Don't Ask Again";

/**
 * Shows a Yes/No confirmation dialog.
 *
 * @param message - The message to display
 * @param options - Confirmation options
 * @returns `true` if Yes was clicked (or previously remembered), `false` for No *or* dismissal (Escape)
 *
 * @example
 * ```typescript
 * const confirmed = await confirm('Delete this file?');
 * if (confirmed) {
 *   // delete file
 * }
 *
 * // With "don't ask again", persisted in global state
 * const proceed = await confirm('Enable experimental feature?', {
 *   severity: 'info',
 *   remember: { memento: context.globalState, key: 'myext.confirmedExperimental' },
 * });
 * ```
 */
export async function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const {
    yesText = 'Yes',
    noText = 'No',
    modal = true,
    detail,
    severity = 'warn',
    remember,
  } = options;

  if (remember && remember.memento.get(remember.key) === true) {
    return true;
  }

  const messageOptions: vscode.MessageOptions = { modal, detail };
  const actions = remember ? [yesText, noText, DONT_ASK_AGAIN] : [yesText, noText];

  const native =
    severity === 'info'
      ? vscode.window.showInformationMessage
      : severity === 'error'
        ? vscode.window.showErrorMessage
        : vscode.window.showWarningMessage;

  const result = await native(message, messageOptions, ...actions);

  if (remember && result === DONT_ASK_AGAIN) {
    await remember.memento.update(remember.key, true);
    return true;
  }
  return result === yesText;
}
