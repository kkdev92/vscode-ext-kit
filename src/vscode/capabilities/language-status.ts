/**
 * Language-status adapter. Definitions use stable string severities and plain
 * selector/command data; this file maps those values to VS Code's nominal enum
 * and item object without moving item ownership out of the application host.
 */
import * as vscode from 'vscode';

import type {
  LanguageSelectorLike,
  LanguageStatusCapability,
  LanguageStatusItemFields,
  LanguageStatusItemHandle,
} from '../../foundation/platform/ports.js';
import type { LanguageStatusItemSeverity } from '../../capabilities/ui/language-status.js';

function toSeverity(
  severity: LanguageStatusItemSeverity | undefined
): vscode.LanguageStatusSeverity {
  switch (severity) {
    case 'warn':
      return vscode.LanguageStatusSeverity.Warning;
    case 'error':
      return vscode.LanguageStatusSeverity.Error;
    case 'info':
    case undefined:
      return vscode.LanguageStatusSeverity.Information;
  }
}

/**
 * Applies only fields present in a patch.
 *
 * `undefined` means “leave the previous native value alone”, not “clear it”.
 * That patch invariant is shared with the status-bar adapter and its fakes; add
 * an explicit clear representation to the port if clearing becomes necessary.
 */
function applyFields(item: vscode.LanguageStatusItem, fields: LanguageStatusItemFields): void {
  if (fields.name !== undefined) {
    item.name = fields.name;
  }
  if (fields.text !== undefined) {
    item.text = fields.text;
  }
  if (fields.detail !== undefined) {
    item.detail = fields.detail;
  }
  if (fields.command !== undefined) {
    item.command = fields.command as vscode.Command;
  }
  if (fields.severity !== undefined) {
    item.severity = toSeverity(fields.severity);
  }
  if (fields.busy !== undefined) {
    item.busy = fields.busy;
  }
  if (fields.accessibilityInformation !== undefined) {
    // Structurally identical; the cast only reconciles exactOptionalPropertyTypes.
    item.accessibilityInformation =
      fields.accessibilityInformation as vscode.AccessibilityInformation;
  }
}

/**
 * The real language status capability, backed by
 * `vscode.languages.createLanguageStatusItem`.
 * The returned handle is intentionally smaller than the native item: callers
 * can patch or dispose it, but cannot retain a VS Code object outside the
 * framework's lifecycle.
 */
export function createVSCodeLanguageStatusCapability(): LanguageStatusCapability {
  return {
    createItem(id: string, selector: LanguageSelectorLike): LanguageStatusItemHandle {
      const item = vscode.languages.createLanguageStatusItem(
        id,
        selector as vscode.DocumentSelector
      );
      return {
        patch: (fields) => {
          applyFields(item, fields);
        },
        dispose: () => {
          item.dispose();
        },
      };
    },
  };
}
