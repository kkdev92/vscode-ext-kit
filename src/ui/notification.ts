import * as vscode from 'vscode';

// ============================================
// Types
// ============================================

/**
 * Options for notification display.
 */
export interface NotificationOptions {
  /** Show as modal dialog */
  modal?: boolean;
  /** Detail text (only for modal) */
  detail?: string;
}

/**
 * An action button for notifications.
 */
export interface NotificationAction<T = string> {
  /** Button title */
  title: string;
  /** Value returned when clicked */
  value: T;
  /** Whether this is the close affordance */
  isCloseAffordance?: boolean;
}

// ============================================
// Show Notifications
// ============================================

/**
 * Shows an information notification.
 *
 * @param message - The message to display
 * @param options - Notification options
 * @returns Promise that resolves when dismissed
 *
 * @example
 * ```typescript
 * await showInfo('Operation completed successfully');
 * ```
 */
export function showInfo(message: string, options?: NotificationOptions): Promise<void>;

/**
 * Shows an information notification with action buttons.
 *
 * @param message - The message to display
 * @param options - Notification options
 * @param actions - Action button labels
 * @returns Promise that resolves with the selected action or undefined
 *
 * @example
 * ```typescript
 * const result = await showInfo('File changed', {}, 'Reload', 'Ignore');
 * if (result === 'Reload') {
 *   // handle reload
 * }
 * ```
 */
export function showInfo<T extends string>(
  message: string,
  options: NotificationOptions,
  ...actions: T[]
): Promise<T | undefined>;

export async function showInfo<T extends string>(
  message: string,
  options: NotificationOptions = {},
  ...actions: T[]
): Promise<T | undefined | void> {
  if (actions.length === 0) {
    await vscode.window.showInformationMessage(message, { modal: options.modal });
    return;
  }

  const messageOptions: vscode.MessageOptions = {
    modal: options.modal,
    detail: options.detail,
  };

  return vscode.window.showInformationMessage(message, messageOptions, ...actions);
}

/**
 * Shows a warning notification.
 *
 * @param message - The message to display
 * @param options - Notification options
 * @returns Promise that resolves when dismissed
 *
 * @example
 * ```typescript
 * await showWarn('This action may take a while');
 * ```
 */
export function showWarn(message: string, options?: NotificationOptions): Promise<void>;

/**
 * Shows a warning notification with action buttons.
 *
 * @param message - The message to display
 * @param options - Notification options
 * @param actions - Action button labels
 * @returns Promise that resolves with the selected action or undefined
 */
export function showWarn<T extends string>(
  message: string,
  options: NotificationOptions,
  ...actions: T[]
): Promise<T | undefined>;

export async function showWarn<T extends string>(
  message: string,
  options: NotificationOptions = {},
  ...actions: T[]
): Promise<T | undefined | void> {
  if (actions.length === 0) {
    await vscode.window.showWarningMessage(message, { modal: options.modal });
    return;
  }

  const messageOptions: vscode.MessageOptions = {
    modal: options.modal,
    detail: options.detail,
  };

  return vscode.window.showWarningMessage(message, messageOptions, ...actions);
}

/**
 * Shows an error notification.
 *
 * @param message - The message to display
 * @param options - Notification options
 * @returns Promise that resolves when dismissed
 *
 * @example
 * ```typescript
 * await showError('Failed to save file');
 * ```
 */
export function showError(message: string, options?: NotificationOptions): Promise<void>;

/**
 * Shows an error notification with action buttons.
 *
 * @param message - The message to display
 * @param options - Notification options
 * @param actions - Action button labels
 * @returns Promise that resolves with the selected action or undefined
 */
export function showError<T extends string>(
  message: string,
  options: NotificationOptions,
  ...actions: T[]
): Promise<T | undefined>;

export async function showError<T extends string>(
  message: string,
  options: NotificationOptions = {},
  ...actions: T[]
): Promise<T | undefined | void> {
  if (actions.length === 0) {
    await vscode.window.showErrorMessage(message, { modal: options.modal });
    return;
  }

  const messageOptions: vscode.MessageOptions = {
    modal: options.modal,
    detail: options.detail,
  };

  return vscode.window.showErrorMessage(message, messageOptions, ...actions);
}

// ============================================
// Confirm Dialog
// ============================================

/**
 * Options for confirm dialog.
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
}

/**
 * Shows a Yes/No confirmation dialog.
 *
 * @param message - The message to display
 * @param options - Confirmation options
 * @returns Promise that resolves to true if Yes was clicked, false otherwise
 *
 * @example
 * ```typescript
 * const confirmed = await confirm('Delete this file?');
 * if (confirmed) {
 *   // delete file
 * }
 * ```
 */
export async function confirm(message: string, options: ConfirmOptions = {}): Promise<boolean> {
  const { yesText = 'Yes', noText = 'No', modal = true, detail } = options;

  const messageOptions: vscode.MessageOptions = {
    modal,
    detail,
  };

  const result = await vscode.window.showWarningMessage(message, messageOptions, yesText, noText);

  return result === yesText;
}

// ============================================
// Show With Actions
// ============================================

/**
 * Shows a notification with custom action buttons.
 *
 * @param type - Notification type: 'info', 'warn', or 'error'
 * @param message - The message to display
 * @param actions - Array of action objects with title and value
 * @param options - Notification options
 * @returns Promise that resolves with the selected action's value or undefined
 *
 * @example
 * ```typescript
 * const action = await showWithActions('warn', 'Unsaved changes', [
 *   { title: 'Save', value: 'save' },
 *   { title: 'Discard', value: 'discard' },
 *   { title: 'Cancel', value: 'cancel', isCloseAffordance: true },
 * ]);
 *
 * switch (action) {
 *   case 'save':
 *     await save();
 *     break;
 *   case 'discard':
 *     discard();
 *     break;
 * }
 * ```
 */
export async function showWithActions<T>(
  type: 'info' | 'warn' | 'error',
  message: string,
  actions: NotificationAction<T>[],
  options: NotificationOptions = {}
): Promise<T | undefined> {
  const messageOptions: vscode.MessageOptions = {
    modal: options.modal,
    detail: options.detail,
  };

  // Convert actions to MessageItem format
  const items: vscode.MessageItem[] = actions.map((action) => ({
    title: action.title,
    isCloseAffordance: action.isCloseAffordance,
  }));

  let result: vscode.MessageItem | undefined;

  switch (type) {
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

  if (!result) {
    return undefined;
  }

  // Find the action with matching title and return its value
  const selectedAction = actions.find((action) => action.title === result.title);
  return selectedAction?.value;
}
