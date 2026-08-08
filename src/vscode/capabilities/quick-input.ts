/**
 * Thin adapter for stateful QuickPick/InputBox instances.
 *
 * The managed quick-input service above this port owns listener cleanup,
 * re-entrant hide/dispose behavior and result semantics. Keep this adapter thin
 * so that the fake can exercise that policy through the same structural API.
 */
import * as vscode from 'vscode';

import type {
  InputBoxLike,
  QuickInputButtonLike,
  QuickInputCapability,
  QuickPickItemLike,
  QuickPickLike,
} from '../../foundation/platform/ports.js';

/**
 * The real quick-input capability, backed by `vscode.window.createQuickPick`/
 * `createInputBox` and `QuickInputButtons.Back`.
 * Returned instances are native and must eventually be disposed. The managed
 * quick-input service owns each one until its interaction settles; this adapter
 * only constructs the controls and does not add independent scope ownership.
 */
export function createVSCodeQuickInputCapability(): QuickInputCapability {
  return {
    createQuickPick<T extends QuickPickItemLike>(): QuickPickLike<T> {
      // The runtime object is generic-free; the cast reconciles the port's
      // structural item type with vscode's nominal QuickPickItem constraint.
      return vscode.window.createQuickPick<vscode.QuickPickItem>() as unknown as QuickPickLike<T>;
    },
    createInputBox(): InputBoxLike {
      return vscode.window.createInputBox();
    },
    // A getter, not a value. Every adapter is built at activation whether the
    // extension declares quick input or not, and this was the only one that
    // read a `vscode` value while doing so — which made
    // `vscode.QuickInputButtons` something a test double had to supply for an
    // extension that never opens a quick pick.
    get backButton(): QuickInputButtonLike {
      return vscode.QuickInputButtons.Back;
    },
  };
}
