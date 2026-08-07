import type { CommandContract } from '../../foundation/commands/contract.js';
import type { CommandCapability } from '../../foundation/platform/ports.js';
import { serviceToken } from '../../foundation/services/token.js';
import type { ServiceToken } from '../../foundation/services/token.js';

/**
 * Invoking commands — the platform's, and the application's own.
 *
 * Registering is the other direction and belongs to a module
 * (`module.commands.handle`); this is only for calling one. Most of what an
 * extension reaches for beyond the framework's models is a built-in command —
 * `workbench.action.openSettings`, `setContext`, `vscode.open` — and routing
 * those through the same capability the framework registers against keeps them
 * out of the fakes' blind spot.
 *
 * @example
 * ```ts
 * module.commands.handle(ShowSetting, {
 *   inject: { commands: Commands },
 *   execute: async (_context, _args, { commands }) => {
 *     await commands.execute('workbench.action.openSettings', 'sample.timeout');
 *   },
 * });
 * ```
 */
export interface CommandsService {
  /**
   * Runs a command by id, resolving with what it returned and rejecting with
   * what it threw.
   *
   * Untyped on purpose: an id typed as a bare string is a *platform* command,
   * whose signature the framework cannot know. For the application's own
   * commands use {@link CommandsService.invoke}, which does know.
   * Arguments and results cross the platform command boundary unchanged; this
   * method performs no runtime validation.
   *
   * @param id - Command id
   * @param args - Arguments, passed through untouched
   */
  execute<T = void>(id: string, ...args: readonly unknown[]): Promise<T>;

  /**
   * Runs one of the application's own commands, typed by its contract.
   *
   * The contract carries the argument tuple and the result type, so a changed
   * signature fails to compile at every call site rather than at runtime in
   * whichever one the user hits first.
   *
   * @example
   * ```ts
   * const count = await commands.invoke(Refresh, true);
   * ```
   */
  invoke<TArgs extends readonly unknown[], TResult>(
    contract: CommandContract<TArgs, TResult>,
    ...args: TArgs
  ): Promise<TResult>;
}

/** Injects the application's {@link CommandsService}. */
export const Commands: ServiceToken<CommandsService> =
  serviceToken<CommandsService>('framework.commands');

/**
 * Builds the command-invoking service over a capability.
 *
 * @example
 * ```ts
 * const commands = createCommandsService(capability);
 * await commands.execute('workbench.action.reloadWindow');
 * ```
 */
export function createCommandsService(capability: CommandCapability): CommandsService {
  return {
    execute<T = void>(id: string, ...args: readonly unknown[]): Promise<T> {
      return capability.execute<T>(id, ...args);
    },

    invoke<TArgs extends readonly unknown[], TResult>(
      contract: CommandContract<TArgs, TResult>,
      ...args: TArgs
    ): Promise<TResult> {
      return capability.execute<TResult>(contract.descriptor.id, ...args);
    },
  };
}
