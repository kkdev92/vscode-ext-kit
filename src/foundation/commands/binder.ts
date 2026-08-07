import type { Logger } from '../logging/logger.js';
import { runOperation } from '../operations/executor.js';
import { OperationKind } from '../operations/context.js';
import { validationError } from '../operations/errors.js';
import type { ActiveTextEditor, CommandCapability, ProgressCapability } from '../platform/ports.js';
import type { RegistrationScope } from '../resources/registration-scope.js';
import type { ResourceScope } from '../resources/resource-scope.js';
import type { ServiceContainer } from '../services/container.js';
import type { ServiceToken } from '../services/token.js';
import { resolveInjected } from '../services/container.js';
import { toValidator } from './contract.js';
import type { CommandContract } from './contract.js';
import type { CommandDefinition, TextEditorCommandDefinition } from './definition.js';

/**
 * Dependencies required to bind compiled command definitions for one Module.
 * Registration ownership and Operation resource ownership are separate so Host
 * stop can close command ingress synchronously before draining async work.
 */
export interface BindCommandsOptions {
  /** Handlers to register. */
  readonly commands: readonly CommandDefinition[];
  /** Text editor command handlers to register. */
  readonly textEditorCommands?: readonly TextEditorCommandDefinition[] | undefined;
  /** Platform surface to register against. */
  readonly capability: CommandCapability;
  /** Owns the registrations so stopping removes them synchronously. */
  readonly registrations: RegistrationScope;
  /** Parent of each invocation's operation scope. */
  readonly resources: ResourceScope;
  /** Aborts when the application begins stopping. */
  readonly applicationSignal: AbortSignal;
  /** Base logger. */
  readonly logger: Logger;
  /** Container used to resolve handler dependencies per invocation. */
  readonly services: ServiceContainer;
  /** Progress UI for `context.progress`. Absent means headless. */
  readonly progress?: ProgressCapability | undefined;
  /** Receives `operation.*` diagnostics. */
  readonly onDiagnostic?:
    ((event: string, details: Readonly<Record<string, unknown>>) => void) | undefined;
  /**
   * Turns the editor port into whatever a text editor handler is promised.
   *
   * Supplied by the application rather than built here: the wrapper lives in
   * the capability layer, and only the application may reach into it.
   */
  readonly toEditor: (editor: ActiveTextEditor) => unknown;
  /** The services every handler's context carries without being asked. */
  readonly standard?: Readonly<Record<string, ServiceToken<unknown>>> | undefined;
}

/**
 * Registers command handlers against a capability.
 *
 * Each invocation gets an operation: an id, a composed signal, its own resource
 * scope, a scoped logger and error classification. The handler's return value and
 * its rejection both reach the caller unchanged for plain commands, which is
 * what makes those commands usable programmatically. A text editor command
 * starts the same Operation pipeline, but its platform callback has a `void`
 * result contract and does not expose that Operation promise to the invoker.
 *
 * Error *presentation* is left to VS Code: the Command Palette shows a dialog and
 * a keybinding shows a warning, so notifying here would double-report.
 *
 * @example
 * ```ts
 * bindCommands({
 *   commands: plan.commands,
 *   capability,
 *   registrations,
 *   resources,
 *   applicationSignal: signal,
 *   logger,
 *   services: container,
 * });
 * ```
 */
export function bindCommands(options: BindCommandsOptions): void {
  for (const definition of options.commands) {
    const contract = definition.contract;
    const id = contract.descriptor.id;
    const validator = contract.args === undefined ? undefined : toValidator(contract.args);

    const registration = options.capability.register(id, (...rawArgs: readonly unknown[]) => {
      let args: readonly unknown[] = rawArgs;

      // Untrusted callers (palette, keybinding, menu, other extensions) are
      // validated before a handler starts, on the synchronous path.
      if (validator !== undefined) {
        const outcome = validator.validate(rawArgs);
        if (!outcome.ok) {
          throw validationError({
            code: 'COMMAND_ARGUMENTS_INVALID',
            message: `Invalid arguments for "${id}".`,
            details: { commandId: id, issues: outcome.issues },
          });
        }
        args = outcome.value;
      }

      return runOperation(
        {
          kind: OperationKind.Command,
          name: id,
          applicationSignal: options.applicationSignal,
          parentResources: options.resources,
          logger: options.logger,
          services: options.services,
          ...(options.progress === undefined ? {} : { progress: options.progress }),
          ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
          ...(options.standard === undefined ? {} : { standard: options.standard }),
        },
        (context) =>
          definition.execute(
            context,
            args,
            resolveInjected(definition.dependencies, context.services)
          )
      );
    });

    options.registrations.own(registration);
  }

  for (const definition of options.textEditorCommands ?? []) {
    const contract = definition.contract;
    const id = contract.descriptor.id;
    const validator = contract.args === undefined ? undefined : toValidator(contract.args);

    const registration = options.capability.registerTextEditor(
      id,
      (editor: ActiveTextEditor, rawArgs: readonly unknown[]) => {
        let args: readonly unknown[] = rawArgs;
        if (validator !== undefined) {
          const outcome = validator.validate(rawArgs);
          if (!outcome.ok) {
            throw validationError({
              code: 'COMMAND_ARGUMENTS_INVALID',
              message: `Invalid arguments for "${id}".`,
              details: { commandId: id, issues: outcome.issues },
            });
          }
          args = outcome.value;
        }

        return runOperation(
          {
            kind: OperationKind.Command,
            name: id,
            applicationSignal: options.applicationSignal,
            parentResources: options.resources,
            logger: options.logger,
            services: options.services,
            ...(options.progress === undefined ? {} : { progress: options.progress }),
            ...(options.onDiagnostic === undefined ? {} : { onDiagnostic: options.onDiagnostic }),
            ...(options.standard === undefined ? {} : { standard: options.standard }),
          },
          (context) =>
            definition.execute(
              context,
              options.toEditor(editor),
              args,
              resolveInjected(definition.dependencies, context.services)
            )
        );
      }
    );

    options.registrations.own(registration);
  }
}

/** Invokes commands with argument and result types intact. */
export interface CommandExecutor {
  /**
   * Invokes a command through its contract. This provides compile-time argument
   * and result types; runtime validation still occurs only when the registered
   * contract declares an `args` validator.
   *
   * @example
   * ```ts
   * const result = await commands.execute(RefreshProjects, { force: true });
   * ```
   */
  execute<TArgs extends readonly unknown[], TResult>(
    contract: CommandContract<TArgs, TResult>,
    ...args: TArgs
  ): Promise<TResult>;
}

/**
 * Creates a typed command executor over a capability.
 *
 * Type safety covers calls made this way. Raw `vscode.commands.executeCommand`,
 * keybindings and menus are runtime input, which is what a contract's `args`
 * validator is for.
 *
 * @example
 * ```ts
 * const commands = createCommandExecutor(capability);
 * await commands.execute(RefreshProjects, { force: true });
 * ```
 */
export function createCommandExecutor(capability: CommandCapability): CommandExecutor {
  return {
    execute<TArgs extends readonly unknown[], TResult>(
      contract: CommandContract<TArgs, TResult>,
      ...args: TArgs
    ): Promise<TResult> {
      return capability.execute<TResult>(contract.descriptor.id, ...args);
    },
  };
}
