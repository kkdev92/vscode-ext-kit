import type { OperationContext } from '../operations/context.js';
import type { ServiceMap } from '../services/token.js';
import type { CommandContract } from './contract.js';

/**
 * A registered command handler, normalised so the binder does not care whether
 * the author declared dependencies.
 */
export interface CommandDefinition {
  /** The contract this handler satisfies. */
  readonly contract: CommandContract<readonly unknown[], unknown>;
  /** Declared dependencies, resolved per invocation. */
  readonly dependencies: ServiceMap;
  /** Normalised handler. */
  readonly execute: (
    context: OperationContext,
    args: readonly unknown[],
    injected: Readonly<Record<string, unknown>>
  ) => unknown;
  /** Module that registered this handler. */
  readonly moduleId: string;
}

/**
 * A registered text editor command handler. The adapter converts the focused
 * platform editor before it crosses this boundary; its normalized value remains
 * opaque to foundation and is typed by the Module API above this definition.
 */
export interface TextEditorCommandDefinition {
  /** The contract this handler satisfies. */
  readonly contract: CommandContract<readonly unknown[], unknown>;
  /** Declared dependencies, resolved per invocation. */
  readonly dependencies: ServiceMap;
  /** Normalised handler. */
  readonly execute: (
    context: OperationContext,
    editor: unknown,
    args: readonly unknown[],
    injected: Readonly<Record<string, unknown>>
  ) => unknown;
  /** Module that registered this handler. */
  readonly moduleId: string;
}
