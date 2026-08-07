/**
 * Adapts command registration and invocation at the `vscode.commands`
 * boundary. Argument validation, operation creation, logging and ownership are
 * deliberately absent here: the foundation binder applies those policies so
 * the fake and real adapters execute the same pipeline.
 */
import * as vscode from 'vscode';

import type {
  ActiveTextEditor,
  CommandCapability,
  PlatformRegistration,
} from '../../foundation/platform/ports.js';
import { wrapActive } from '../capabilities/editor.js';

/**
 * The real command capability, backed by `vscode.commands`.
 *
 * Creating this object performs no VS Code call; registration is delayed until
 * the application host owns a registration scope. Never retain handlers here:
 * the native disposable is the source of truth for whether an id is live.
 *
 * @example
 * ```ts
 * const capability = createVSCodeCommandCapability();
 * ```
 */
export function createVSCodeCommandCapability(): CommandCapability {
  return {
    register(id: string, handler: (...args: readonly unknown[]) => unknown): PlatformRegistration {
      // Do not catch here. The binder owns error classification/logging, and
      // executeCommand must observe the original return value or rejection.
      return vscode.commands.registerCommand(id, (...args: unknown[]) => handler(...args));
    },

    registerTextEditor(
      id: string,
      handler: (editor: ActiveTextEditor, args: readonly unknown[]) => unknown
    ): PlatformRegistration {
      return vscode.commands.registerTextEditorCommand(
        id,
        // The same wrapper `active` goes through, so a handler sees one editor
        // shape whichever way its command was declared. The `TextEditorEdit`
        // VS Code offers as the second callback argument is dropped: it is a
        // nominal platform value valid only while this callback executes, while
        // an operation-wrapped handler may continue asynchronously.
        (editor: vscode.TextEditor, _edit: vscode.TextEditorEdit, ...args: unknown[]) =>
          handler(wrapActive(editor), args)
      );
    },

    async execute<T>(id: string, ...args: readonly unknown[]): Promise<T> {
      // `@types/vscode` at the supported floor declares `executeCommand<T>` as
      // `Thenable<T>`, so no cast is needed here. A command with no result
      // resolves undefined, which a contract declares as `TResult = void`.
      return await vscode.commands.executeCommand<T>(id, ...args);
    },
  };
}
