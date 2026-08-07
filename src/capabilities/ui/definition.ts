import { frozenCopy, frozenIfArray } from '../../foundation/internal/immutable.js';
import type { LanguageSelectorLike } from '../../foundation/platform/ports.js';
import { serviceToken } from '../../foundation/services/token.js';
import type { ServiceToken } from '../../foundation/services/token.js';
import type { LanguageStatusItemOptions, ManagedLanguageStatusItem } from './language-status.js';
import type { ManagedStatusBarItem, StatusBarItemOptions } from './statusbar.js';

/**
 * Options for {@link defineStatusBarItem}. `id` must be unique across the
 * compiled application; duplicate declarations fail preflight.
 */
export interface DefineStatusBarItemOptions extends StatusBarItemOptions {
  /** Unique identifier for the status bar item. */
  readonly id: string;
}

/** A declared status bar item, whose controller is injectable under `token`. */
export interface StatusBarItemDefinition extends DefineStatusBarItemOptions {
  /** Token the {@link ManagedStatusBarItem} controller is registered under. */
  readonly token: ServiceToken<ManagedStatusBarItem>;
}

/**
 * Declares a status bar item as part of the application model.
 *
 * The item is created when the application activates — visible immediately,
 * without anything having to inject it first — and disposed when the
 * application stops. Handlers inject the controller under `definition.token`
 * to update it.
 *
 * @example
 * ```ts
 * export const SyncStatus = defineStatusBarItem({
 *   id: 'sample.syncStatus',
 *   text: '$(cloud) Idle',
 *   command: 'sample.sync',
 * });
 *
 * module.statusBar.add(SyncStatus);
 *
 * module.commands.handle(Sync, {
 *   inject: { status: SyncStatus.token },
 *   execute: async (context, _args, { status }) => {
 *     status.setBusy(true);
 *     try {
 *       await doSync(context.signal);
 *       status.update('$(check) Synced');
 *     } finally {
 *       status.setBusy(false);
 *     }
 *   },
 * });
 * ```
 */
export function defineStatusBarItem(options: DefineStatusBarItemOptions): StatusBarItemDefinition {
  // Frozen container; `command`, `tooltip` and `accessibilityInformation` are
  // platform payloads and pass through as they are.
  return Object.freeze({
    ...frozenCopy(options),
    token: serviceToken<ManagedStatusBarItem>(`statusBar:${options.id}`),
  });
}

/**
 * Options for {@link defineLanguageStatusItem}. `id` must be unique across the
 * compiled application; duplicate declarations fail preflight.
 */
export interface DefineLanguageStatusItemOptions extends LanguageStatusItemOptions {
  /** Unique identifier for the item. */
  readonly id: string;
  /** Editors whose language matches this selector show the item. */
  readonly selector: LanguageSelectorLike;
}

/** A declared language status item, whose controller is injectable under `token`. */
export interface LanguageStatusItemDefinition extends DefineLanguageStatusItemOptions {
  /** Token the {@link ManagedLanguageStatusItem} controller is registered under. */
  readonly token: ServiceToken<ManagedLanguageStatusItem>;
}

/**
 * Declares a language status item as part of the application model.
 *
 * Created at activation, disposed with the application, injectable under
 * `definition.token` — the same lifecycle as {@link defineStatusBarItem}.
 *
 * @example
 * ```ts
 * export const LintStatus = defineLanguageStatusItem({
 *   id: 'sample.eslint',
 *   selector: { language: 'typescript' },
 *   name: 'ESLint',
 *   text: '$(check) No issues',
 * });
 *
 * module.languageStatus.add(LintStatus);
 * ```
 */
export function defineLanguageStatusItem(
  options: DefineLanguageStatusItemOptions
): LanguageStatusItemDefinition {
  return Object.freeze({
    ...frozenCopy(options),
    // A selector may be a list, which would otherwise stay mutable.
    selector: frozenIfArray(options.selector),
    token: serviceToken<ManagedLanguageStatusItem>(`languageStatus:${options.id}`),
  });
}
