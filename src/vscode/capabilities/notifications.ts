/**
 * Notification adapter. The capability layer owns policy (deduplication,
 * remembered decisions and diagnostics); this file performs the final mapping
 * to the three VS Code severity-specific message functions.
 */
import * as vscode from 'vscode';

import type {
  NotificationActionLike,
  NotificationCapability,
  NotificationSeverity,
} from '../../foundation/platform/ports.js';

/**
 * The real message capability, backed by `vscode.window.show*Message`.
 *
 * VS Code resolves with the exact item object it was given, so the chosen
 * action's index is recovered by reference rather than by matching its title.
 * A title lookup would return the wrong action whenever two actions share a
 * localized label. Returning an index also keeps native `MessageItem` identity
 * from crossing the port.
 */
export function createVSCodeNotificationCapability(): NotificationCapability {
  return {
    async show(
      severity: NotificationSeverity,
      message: string,
      options: { readonly modal?: boolean | undefined; readonly detail?: string | undefined },
      actions: readonly NotificationActionLike[]
    ): Promise<number | undefined> {
      const items: vscode.MessageItem[] = actions.map((action) => ({
        title: action.title,
        ...(action.isCloseAffordance === undefined
          ? {}
          : { isCloseAffordance: action.isCloseAffordance }),
      }));
      const messageOptions: vscode.MessageOptions = {
        ...(options.modal === undefined ? {} : { modal: options.modal }),
        ...(options.detail === undefined ? {} : { detail: options.detail }),
      };

      let result: vscode.MessageItem | undefined;
      switch (severity) {
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
      if (result === undefined) {
        return undefined;
      }
      const index = items.indexOf(result);
      // Be defensive about a host or mock returning an object that was not in
      // the offered list. Treat it as dismissal rather than exposing `-1` as a
      // valid action index.
      return index === -1 ? undefined : index;
    },
  };
}
