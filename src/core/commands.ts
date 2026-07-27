import * as vscode from 'vscode';
import type {
  Logger,
  CommandHandler,
  TextEditorCommandHandler,
  RegisterCommandsOptions,
} from './types.js';
import { run } from './run.js';

/** Anything that can own disposables: `context.subscriptions`, a DisposableCollection, ... */
export interface DisposableSink {
  push(...disposables: vscode.Disposable[]): unknown;
}

/** Shared implementation for {@link registerCommands} and the kit variant. */
export function registerCommandMap<TCommandId extends string>(
  sink: DisposableSink,
  logger: Logger,
  handlers: Record<TCommandId, CommandHandler>,
  opts: RegisterCommandsOptions = {}
): Record<TCommandId, vscode.Disposable> {
  const { wrap = true, commandErrorMessage } = opts;
  const result = {} as Record<TCommandId, vscode.Disposable>;

  for (const [commandId, handler] of Object.entries(handlers) as [TCommandId, CommandHandler][]) {
    const wrapped = wrap
      ? (...args: unknown[]): Promise<unknown> => {
          const actionName = commandErrorMessage?.(commandId) ?? `Command: ${commandId}`;
          return run(logger, actionName, () => handler(...args));
        }
      : handler;

    const disposable = vscode.commands.registerCommand(commandId, wrapped);
    sink.push(disposable);
    result[commandId] = disposable;
  }

  return result;
}

/** Shared implementation for {@link registerTextEditorCommands} and the kit variant. */
export function registerTextEditorCommandMap<TCommandId extends string>(
  sink: DisposableSink,
  logger: Logger,
  handlers: Record<TCommandId, TextEditorCommandHandler>,
  opts: RegisterCommandsOptions = {}
): Record<TCommandId, vscode.Disposable> {
  const { wrap = true, commandErrorMessage } = opts;
  const result = {} as Record<TCommandId, vscode.Disposable>;

  for (const [commandId, handler] of Object.entries(handlers) as [
    TCommandId,
    TextEditorCommandHandler,
  ][]) {
    const wrapped = wrap
      ? (
          editor: vscode.TextEditor,
          edit: vscode.TextEditorEdit,
          ...args: unknown[]
        ): void | Promise<void> => {
          const actionName = commandErrorMessage?.(commandId) ?? `Command: ${commandId}`;
          return run(logger, actionName, () => handler(editor, edit, ...args)) as Promise<void>;
        }
      : handler;

    const disposable = vscode.commands.registerTextEditorCommand(commandId, wrapped);
    sink.push(disposable);
    result[commandId] = disposable;
  }

  return result;
}

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
 * await executeCommand(logger, 'workbench.action.openSettings');
 *
 * const result = await executeCommand<string>(
 *   logger,
 *   'vscode.executeFormatDocumentProvider',
 *   document.uri
 * );
 * ```
 */
export async function executeCommand<T = unknown>(
  logger: Logger,
  command: string,
  ...args: unknown[]
): Promise<T | undefined> {
  logger.debug(`Executing command: ${command}`);
  return run<T>(logger, `Execute: ${command}`, async () => {
    const result = await vscode.commands.executeCommand<T>(command, ...args);
    logger.debug(`Command ${command} completed`);
    return result;
  });
}

/**
 * Registers multiple commands with unified error handling.
 * All registered commands are added to `context.subscriptions`.
 *
 * Pass a command-ID union as the type parameter to get compile-time
 * checking of every key — typos and missing commands both fail to build.
 * The union can be handwritten or generated from `package.json` by tools
 * like `vscode-ext-gen`.
 *
 * @returns A map of command ID to its Disposable, for selective disposal
 *
 * @example
 * ```typescript
 * type MyCommandId = 'myext.hello' | 'myext.openSettings';
 *
 * const commands = registerCommands<MyCommandId>(context, logger, {
 *   'myext.hello': (uri: vscode.Uri) => showInfo(`Hello ${uri.fsPath}`),
 *   'myext.openSettings': () => executeCommand(logger, 'workbench.action.openSettings'),
 * });
 *
 * commands['myext.hello'].dispose(); // disable a single command later
 * ```
 */
export function registerCommands<TCommandId extends string = string>(
  ctx: vscode.ExtensionContext,
  logger: Logger,
  handlers: Record<TCommandId, CommandHandler>,
  opts: RegisterCommandsOptions = {}
): Record<TCommandId, vscode.Disposable> {
  return registerCommandMap(ctx.subscriptions, logger, handlers, opts);
}

/**
 * Registers multiple text editor commands with unified error handling.
 * Text editor commands receive the active editor and an edit builder.
 * All registered commands are added to `context.subscriptions`.
 *
 * @returns A map of command ID to its Disposable, for selective disposal
 *
 * @example
 * ```typescript
 * registerTextEditorCommands(context, logger, {
 *   'myext.reverseSelection': (editor, edit) => {
 *     for (const selection of editor.selections) {
 *       const text = editor.document.getText(selection);
 *       edit.replace(selection, text.split('').reverse().join(''));
 *     }
 *   },
 * });
 * ```
 */
export function registerTextEditorCommands<TCommandId extends string = string>(
  ctx: vscode.ExtensionContext,
  logger: Logger,
  handlers: Record<TCommandId, TextEditorCommandHandler>,
  opts: RegisterCommandsOptions = {}
): Record<TCommandId, vscode.Disposable> {
  return registerTextEditorCommandMap(ctx.subscriptions, logger, handlers, opts);
}
