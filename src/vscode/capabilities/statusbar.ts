/**
 * Status-bar adapter. It maps stable framework values to VS Code theme values
 * and keeps the native mutable item behind a patch/show/hide/dispose handle.
 */
import * as vscode from 'vscode';

import type {
  StatusBarCapability,
  StatusBarItemFields,
  StatusBarItemHandle,
} from '../../foundation/platform/ports.js';

function applyFields(item: vscode.StatusBarItem, fields: StatusBarItemFields): void {
  // Patch semantics: omitted fields retain their native value. Do not replace
  // these guards with unconditional assignments unless the port gains an
  // explicit representation for clearing a field.
  if (fields.text !== undefined) {
    item.text = fields.text;
  }
  if (fields.tooltip !== undefined) {
    // A real MarkdownString satisfies the structural tooltip type and must
    // reach VS Code untouched; the cast puts the type back after the port
    // erased it.
    item.tooltip = fields.tooltip as string | vscode.MarkdownString;
  }
  if (fields.command !== undefined) {
    item.command = fields.command as string | vscode.Command;
  }
  if (fields.backgroundColor !== undefined) {
    item.backgroundColor =
      fields.backgroundColor === 'warning'
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : new vscode.ThemeColor('statusBarItem.errorBackground');
  }
  if (fields.accessibilityInformation !== undefined) {
    // Structurally identical; the cast only reconciles exactOptionalPropertyTypes.
    item.accessibilityInformation =
      fields.accessibilityInformation as vscode.AccessibilityInformation;
  }
}

/**
 * The real status bar capability, backed by `vscode.window.createStatusBarItem`.
 * The application scope owns the returned handle, so a module should never add
 * the native item to `ExtensionContext.subscriptions` itself.
 */
export function createVSCodeStatusBarCapability(): StatusBarCapability {
  return {
    createItem(
      id: string,
      alignment: 'left' | 'right',
      priority: number | undefined
    ): StatusBarItemHandle {
      const item = vscode.window.createStatusBarItem(
        id,
        alignment === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right,
        priority
      );
      return {
        patch: (fields) => {
          applyFields(item, fields);
        },
        show: () => {
          item.show();
        },
        hide: () => {
          item.hide();
        },
        dispose: () => {
          item.dispose();
        },
      };
    },
  };
}
