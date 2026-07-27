import type * as vscode from 'vscode';
import { createLogger } from './logger.js';
import { DisposableCollection } from './disposable.js';
import { run, tryRun, type RunOptions } from './run.js';
import { executeCommand, registerCommandMap, registerTextEditorCommandMap } from './commands.js';
import type { Result } from './result.js';
import type {
  Logger,
  LoggerOptions,
  CommandHandler,
  TextEditorCommandHandler,
  RegisterCommandsOptions,
} from './types.js';

export interface ExtensionKitOptions {
  /** Options forwarded to the kit's {@link createLogger} */
  logger?: LoggerOptions;
  /** Default options for every registerCommands call made through the kit */
  commands?: RegisterCommandsOptions;
}

/**
 * A thin wiring facade over the core primitives. It owns a logger and a
 * disposable scope, and exposes logger-bound versions of `run`/`tryRun`/
 * command registration so the logger doesn't have to be threaded through
 * every call.
 *
 * The kit deliberately does NOT aggregate the rest of the library (config,
 * storage, UI, ...) — those modules stay standalone imports so tree-shaking
 * and type inference keep working. The kit is sugar for the core, not a
 * framework.
 */
export interface ExtensionKit<TCommandId extends string = string> extends vscode.Disposable {
  readonly context: vscode.ExtensionContext;
  readonly logger: Logger;
  /**
   * The kit's disposable scope. Everything added here (plus the logger and
   * all commands registered through the kit) is torn down by `kit.dispose()`
   * — which the extension host calls automatically on deactivate, because
   * the kit registers itself in `context.subscriptions`.
   */
  readonly disposables: DisposableCollection;

  /** {@link run} bound to the kit's logger. */
  run<T>(
    name: string,
    fn: (signal: AbortSignal) => Promise<T> | T,
    opts?: RunOptions
  ): Promise<T | undefined>;
  /** {@link tryRun} bound to the kit's logger. */
  tryRun<T>(
    name: string,
    fn: (signal: AbortSignal) => Promise<T> | T,
    opts?: Omit<RunOptions, 'rethrow'>
  ): Promise<Result<T>>;

  /**
   * Registers commands into the kit's disposable scope. Keys are checked
   * against `TCommandId`; each call may register any subset.
   */
  registerCommands<K extends TCommandId>(
    handlers: Record<K, CommandHandler>,
    opts?: RegisterCommandsOptions
  ): Record<K, vscode.Disposable>;
  registerTextEditorCommands<K extends TCommandId>(
    handlers: Record<K, TextEditorCommandHandler>,
    opts?: RegisterCommandsOptions
  ): Record<K, vscode.Disposable>;
  executeCommand<T = unknown>(command: string, ...args: unknown[]): Promise<T | undefined>;

  [Symbol.dispose](): void;
}

/**
 * Creates an {@link ExtensionKit}: one call in `activate()` wires up a
 * logger, a disposable scope, and logger-bound error handling.
 *
 * The kit registers itself in `context.subscriptions`, so no manual push is
 * needed.
 *
 * @example
 * ```typescript
 * export function activate(context: vscode.ExtensionContext) {
 *   const kit = createExtensionKit<'myext.hello' | 'myext.sync'>(context, 'MyExtension');
 *
 *   kit.registerCommands({
 *     'myext.hello': () => showInfo('Hello!'),
 *     'myext.sync': () => kit.run('Sync', (signal) => sync(signal)),
 *   });
 *
 *   kit.logger.info('activated');
 * }
 * ```
 */
export function createExtensionKit<TCommandId extends string = string>(
  context: vscode.ExtensionContext,
  name: string,
  opts: ExtensionKitOptions = {}
): ExtensionKit<TCommandId> {
  const logger = createLogger(name, opts.logger);
  const disposables = new DisposableCollection();
  disposables.add(logger);

  const kit: ExtensionKit<TCommandId> = {
    context,
    logger,
    disposables,
    run: (name, fn, o) => run(logger, name, fn, o),
    tryRun: (name, fn, o) => tryRun(logger, name, fn, o),
    registerCommands: (handlers, o) =>
      registerCommandMap(disposables, logger, handlers, { ...opts.commands, ...o }),
    registerTextEditorCommands: (handlers, o) =>
      registerTextEditorCommandMap(disposables, logger, handlers, { ...opts.commands, ...o }),
    executeCommand: (command, ...args) => executeCommand(logger, command, ...args),
    dispose: () => disposables.dispose(),
    [Symbol.dispose]: () => disposables.dispose(),
  };

  context.subscriptions.push(kit);
  return kit;
}
