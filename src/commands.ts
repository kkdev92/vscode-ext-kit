import * as vscode from 'vscode';
import type {
  Logger,
  CommandHandler,
  TextEditorCommandHandler,
  RegisterCommandsOptions,
} from './types.js';
import { safeExecute } from './safeExecute.js';

/**
 * Executes a VS Code command with logging and error handling.
 *
 * @param logger - Logger instance for command execution logging
 * @param command - The command ID to execute
 * @param args - Arguments to pass to the command
 * @returns The command result, or undefined if execution fails
 *
 * @example
 * ```typescript
 * // Execute a built-in command
 * await executeCommand(logger, 'workbench.action.openSettings');
 *
 * // Execute with arguments
 * const result = await executeCommand<string>(
 *   logger,
 *   'vscode.executeFormatDocumentProvider',
 *   document.uri
 * );
 *
 * // Execute and handle result
 * const files = await executeCommand<vscode.Uri[]>(
 *   logger,
 *   'vscode.openFolder'
 * );
 * if (files) {
 *   // Process files
 * }
 * ```
 */
export async function executeCommand<T = unknown>(
  logger: Logger,
  command: string,
  ...args: unknown[]
): Promise<T | undefined> {
  logger.debug(`Executing command: ${command}`);
  return safeExecute<T>(logger, `Execute: ${command}`, async () => {
    const result = await vscode.commands.executeCommand<T>(command, ...args);
    logger.debug(`Command ${command} completed`);
    return result;
  });
}

/**
 * Registers multiple commands with unified error handling.
 * All registered commands are automatically added to context.subscriptions.
 *
 * @param ctx - VS Code ExtensionContext
 * @param logger - Logger instance for error logging
 * @param handlers - Object mapping command IDs to handler functions
 * @param opts - Options for command registration
 *
 * @example
 * ```typescript
 * registerCommands(context, logger, {
 *   'myExtension.helloWorld': () => {
 *     vscode.window.showInformationMessage('Hello World!');
 *   },
 *   'myExtension.doSomething': async (arg1, arg2) => {
 *     // Errors are automatically caught, logged, and shown to user
 *     await performAction(arg1, arg2);
 *   },
 * });
 *
 * // Without safeExecute wrapping (handle errors yourself)
 * registerCommands(context, logger, handlers, {
 *   wrapWithSafeExecute: false,
 * });
 * ```
 */
export function registerCommands(
  ctx: vscode.ExtensionContext,
  logger: Logger,
  handlers: Record<string, CommandHandler>,
  opts: RegisterCommandsOptions = {}
): void {
  const { wrapWithSafeExecute = true, commandErrorMessage } = opts;

  for (const [commandId, handler] of Object.entries(handlers)) {
    const wrappedHandler = wrapWithSafeExecute
      ? async (...args: unknown[]): Promise<unknown> => {
          const actionName = commandErrorMessage?.(commandId) ?? `Command: ${commandId}`;
          return safeExecute(logger, actionName, () => handler(...args));
        }
      : handler;

    const disposable = vscode.commands.registerCommand(commandId, wrappedHandler);
    ctx.subscriptions.push(disposable);
  }
}

/**
 * Registers multiple text editor commands with unified error handling.
 * Text editor commands have access to the active text editor and edit builder.
 * All registered commands are automatically added to context.subscriptions.
 *
 * @param ctx - VS Code ExtensionContext
 * @param logger - Logger instance for error logging
 * @param handlers - Object mapping command IDs to handler functions
 * @param opts - Options for command registration
 *
 * @example
 * ```typescript
 * registerTextEditorCommands(context, logger, {
 *   'myExtension.reverseSelection': (editor, edit) => {
 *     for (const selection of editor.selections) {
 *       const text = editor.document.getText(selection);
 *       edit.replace(selection, text.split('').reverse().join(''));
 *     }
 *   },
 *   'myExtension.insertTimestamp': (editor, edit) => {
 *     edit.insert(editor.selection.active, new Date().toISOString());
 *   },
 * });
 * ```
 */
export function registerTextEditorCommands(
  ctx: vscode.ExtensionContext,
  logger: Logger,
  handlers: Record<string, TextEditorCommandHandler>,
  opts: RegisterCommandsOptions = {}
): void {
  const { wrapWithSafeExecute = true, commandErrorMessage } = opts;

  for (const [commandId, handler] of Object.entries(handlers)) {
    const wrappedHandler = wrapWithSafeExecute
      ? (
          editor: vscode.TextEditor,
          edit: vscode.TextEditorEdit,
          ...args: unknown[]
        ): void | Promise<void> => {
          const actionName = commandErrorMessage?.(commandId) ?? `Command: ${commandId}`;
          return safeExecute(logger, actionName, () => handler(editor, edit, ...args));
        }
      : handler;

    const disposable = vscode.commands.registerTextEditorCommand(commandId, wrappedHandler);
    ctx.subscriptions.push(disposable);
  }
}
