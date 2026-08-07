import type { QuickInputCapability, QuickPickItemLike } from '../../foundation/platform/ports.js';
import { serviceToken } from '../../foundation/services/token.js';
import type { ServiceToken } from '../../foundation/services/token.js';
import { inputText, pickMany, pickOne } from './quick-input.js';
import type { InputTextOptions, PickOptions } from './quick-input.js';
import { createWizard } from './wizard.js';
import type { WizardBuilder } from './wizard.js';

/**
 * Asking the user for something.
 *
 * One service rather than four free functions taking a capability, for the same
 * reason as {@link Localization} and {@link Editors}: every member needs the
 * same platform surface, and threading it through each call is bookkeeping the
 * caller should not be doing.
 *
 * Every interactive call accepts the operation's signal (wizard calls take it
 * at `run()`), so a control can close when the command is cancelled or the
 * application stops — not only when the user presses Escape.
 *
 * @example
 * ```ts
 * module.commands.handle(Sync, {
 *   inject: { ask: QuickInput },
 *   execute: async (context, _args, { ask }) => {
 *     const target = await ask.one(items, { title: 'Sync what?', signal: context.signal });
 *     if (target === undefined) return false;
 *     return sync(target.value);
 *   },
 * });
 * ```
 */
export interface QuickInputService {
  /**
   * Shows a quick pick for one choice. Resolves undefined when dismissed.
   *
   * `items` may be a promise, in which case the picker opens immediately with
   * a busy indicator while the list resolves — worth doing when building it
   * means a file scan or an API call.
   */
  one<T extends QuickPickItemLike>(
    items: readonly T[] | Promise<readonly T[]>,
    options?: PickOptions<T>
  ): Promise<T | undefined>;

  /** Shows a quick pick for several choices. Resolves undefined when dismissed. */
  many<T extends QuickPickItemLike>(
    items: readonly T[] | Promise<readonly T[]>,
    options?: PickOptions<T>
  ): Promise<T[] | undefined>;

  /**
   * Shows an input box. Resolves undefined when dismissed/aborted and rejects
   * when validation throws or rejects.
   */
  text(options: InputTextOptions): Promise<string | undefined>;

  /**
   * Starts a multi-step wizard, with a working Back button between steps.
   *
   * @example
   * ```ts
   * const result = await ask
   *   .wizard()
   *   .step('name', inputStep({ prompt: 'Project name' }))
   *   .step('kind', quickpickStep({ items: kinds }))
   *   .run({ signal: context.signal });
   * ```
   */
  wizard(): WizardBuilder<Record<never, never>>;
}

/**
 * Injects the application's {@link QuickInputService}.
 *
 * @example
 * ```ts
 * inject: { ask: QuickInput }
 * ```
 */
export const QuickInput: ServiceToken<QuickInputService> =
  serviceToken<QuickInputService>('framework.quickInput');

/**
 * Builds the quick input service over a capability.
 *
 * @example
 * ```ts
 * const ask = createQuickInputService(capability);
 * const chosen = await ask.one(items);
 * ```
 */
export function createQuickInputService(capability: QuickInputCapability): QuickInputService {
  return {
    one: (items, options) => pickOne(capability, items, options),
    many: (items, options) => pickMany(capability, items, options),
    text: (options) => inputText(capability, options),
    wizard: () => createWizard(capability),
  };
}
