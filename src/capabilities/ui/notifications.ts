import type {
  NotificationCapability,
  NotificationSeverity,
} from '../../foundation/platform/ports.js';
import { serviceToken } from '../../foundation/services/token.js';
import type { ServiceToken } from '../../foundation/services/token.js';

/**
 * Where a "yes, and stop asking" answer is kept.
 *
 * Shaped so a `TypedStorage<boolean>` from `defineStorage` satisfies it
 * directly: the acknowledgement is persisted state, and it belongs in the same
 * declaration as everything else the extension stores.
 */
export interface RememberedChoice {
  /** The stored answer. Anything but `true` means ask again. */
  get(): boolean | undefined;
  /** Records the affirmative acknowledgement; async persistence is awaited. */
  set(value: boolean): void | Promise<void>;
}

/**
 * An action button for {@link NotificationService.info} and friends.
 * `title` is what the user sees; `value` is what the caller gets back —
 * keeping the two separate means a localized/dynamic label never has to
 * double as the code's branching key.
 */
export interface NotifyAction<T> {
  /** Button label shown to the user. */
  readonly title: string;
  /** Value returned to the caller when this button is clicked. */
  readonly value: T;
  /** Whether this action is used when the user dismisses the dialog (e.g. Escape) on a modal. */
  readonly isCloseAffordance?: boolean;
}

/**
 * Options for {@link NotificationService.info}/`warn`/`error`.
 *
 * `T` is inferred from `actions` — omit it entirely for a plain
 * notification with no buttons, whose result is always `undefined`.
 */
export interface NotifyOptions<T = never> {
  /** Show as a modal dialog instead of a toast notification. */
  readonly modal?: boolean;
  /** Human-readable detail text. Only rendered when `modal: true` — VS Code silently ignores it otherwise. */
  readonly detail?: string;
  /** Action buttons. Omit for a plain notification. */
  readonly actions?: readonly NotifyAction<T>[];
}

/** Options for {@link NotificationService.confirm}. */
export interface ConfirmOptions {
  /** Text for the affirmative button (default: English `'Yes'`). Localize for user-facing UI. */
  readonly yesText?: string;
  /** Text for the negative button (default: English `'No'`). Localize for user-facing UI. */
  readonly noText?: string;
  /** Show as a modal dialog (default: `true`). */
  readonly modal?: boolean;
  /** Detail text for a modal. */
  readonly detail?: string;
  /**
   * Icon/dialog severity (default: `'warn'`). Not every confirmation is
   * about a destructive action — use `'info'` for a plain yes/no question.
   */
  readonly severity?: NotificationSeverity;
  /**
   * When set, adds a third button that answers yes *and* stops asking.
   * Choosing it writes `true` to `remember`, and every subsequent call with
   * the same store resolves to `true` immediately without prompting.
   *
   * The default label says so — `'Yes, Always'`, not `"Don't Ask Again"`.
   * The two are not the same promise: the second reads as "stop bothering me"
   * while doing the opposite of what a dismissal does, which is the worst place
   * for a button to be ambiguous. Override it with {@link rememberText} to
   * localize or to word it for a specific action.
   *
   * VS Code's own `window.show*Message` has no native checkbox for extensions
   * — this is the button-plus-persistence pattern extensions build by hand.
   *
   * A storage declared with `defineStorage<boolean>` satisfies this, which is
   * where the acknowledgement belongs: it is persisted state like any other,
   * with a key and a schema you can read in one place.
   *
   * @example
   * ```ts
   * const AcknowledgedMd5 = defineStorage<boolean>({
   *   key: 'sample.acknowledgedMd5',
   *   scope: 'global',
   *   defaultValue: false,
   * });
   *
   * await notify.confirm('MD5 is not collision resistant.', { remember: acknowledged });
   * ```
   */
  readonly remember?: RememberedChoice;
  /**
   * Text for the remembering button (default: English `'Yes, Always'`).
   * Localize for user-facing UI. Ignored without {@link remember}.
   */
  readonly rememberText?: string;
}

/**
 * Severity-tagged notifications and confirmation dialogs.
 *
 * Reached through the {@link Notifications} token, or straight off a handler's
 * `context.notify` — the same instance either way.
 *
 * Every member resolves to what the *user* chose, not to a string: an action
 * carries its own `value`, so branching on the result needs no comparison
 * against a label that a translation will change.
 */
export interface NotificationService {
  /** Shows an information notification, optionally with action buttons. */
  info<T = never>(message: string, options?: NotifyOptions<T>): Promise<T | undefined>;
  /** Shows a warning notification, optionally with action buttons. */
  warn<T = never>(message: string, options?: NotifyOptions<T>): Promise<T | undefined>;
  /** Shows an error notification, optionally with action buttons. */
  error<T = never>(message: string, options?: NotifyOptions<T>): Promise<T | undefined>;
  /**
   * Shows a Yes/No confirmation dialog.
   *
   * @returns `true` if Yes was clicked (or previously remembered), `false` for
   * No *or* dismissal (Escape)
   */
  confirm(message: string, options?: ConfirmOptions): Promise<boolean>;
}

/** Injects the application's {@link NotificationService}. */
export const Notifications: ServiceToken<NotificationService> =
  serviceToken<NotificationService>('framework.notifications');

/** Options for {@link createNotifier}. */
export interface CreateNotifierOptions {
  /**
   * When it returns `true`, nothing is shown: `info`/`warn`/`error` resolve
   * `undefined` and `confirm` resolves `false`. The application wires this to
   * "the host is stopping", so teardown never races a dialog.
   */
  readonly isSuppressed?: (() => boolean) | undefined;
  /**
   * Receives `notification.*` diagnostics (suppressions, remembered skips).
   * Details currently include the notification message; treat this as local
   * diagnostic data, not telemetry-safe data, unless the caller redacts it.
   */
  readonly onDiagnostic?:
    ((event: string, details: Readonly<Record<string, unknown>>) => void) | undefined;
}

/**
 * Default label for the remembering button.
 *
 * It says what pressing it does. `"Don't Ask Again"` — the phrase this pattern
 * is usually built with — reads as a dismissal while storing consent, and a
 * button on a confirmation dialog is the last place to let those two blur.
 */
const ALWAYS = 'Yes, Always';

/**
 * Creates a {@link NotificationService} over a capability.
 *
 * The clicked action resolves by *position*: the capability reports which item
 * object the platform handed back, so two actions sharing a title still return
 * their own `value`. Matching on the title instead would hand the caller
 * whichever one happened to be first, and "Overwrite … Overwrite" is exactly
 * the dialog where that matters.
 *
 * Platform display failures reject to the caller. User dismissal is not a
 * failure: action notifications resolve `undefined`, and confirmations resolve
 * `false`. Suppression follows the same conservative result.
 *
 * @example
 * ```ts
 * const notifier = createNotifier(capability);
 * const action = await notifier.info('File changed on disk', {
 *   actions: [
 *     { title: 'Reload', value: 'reload' as const },
 *     { title: 'Ignore', value: 'ignore' as const },
 *   ],
 * });
 * ```
 */
export function createNotifier(
  capability: NotificationCapability,
  options: CreateNotifierOptions = {}
): NotificationService {
  const suppressed = (): boolean => options.isSuppressed?.() === true;

  async function show<T>(
    severity: NotificationSeverity,
    message: string,
    notifyOptions: NotifyOptions<T>
  ): Promise<T | undefined> {
    if (suppressed()) {
      options.onDiagnostic?.('notification.suppressed', { severity, message });
      return undefined;
    }
    const actions = notifyOptions.actions ?? [];
    const index = await capability.show(
      severity,
      message,
      {
        ...(notifyOptions.modal === undefined ? {} : { modal: notifyOptions.modal }),
        ...(notifyOptions.detail === undefined ? {} : { detail: notifyOptions.detail }),
      },
      actions.map((action) => ({
        title: action.title,
        ...(action.isCloseAffordance === undefined
          ? {}
          : { isCloseAffordance: action.isCloseAffordance }),
      }))
    );
    return index === undefined ? undefined : actions[index]?.value;
  }

  return {
    info: (message, notifyOptions = {}) => show('info', message, notifyOptions),
    warn: (message, notifyOptions = {}) => show('warn', message, notifyOptions),
    error: (message, notifyOptions = {}) => show('error', message, notifyOptions),

    async confirm(message: string, confirmOptions: ConfirmOptions = {}): Promise<boolean> {
      const {
        yesText = 'Yes',
        noText = 'No',
        modal = true,
        detail,
        severity = 'warn',
        remember,
        rememberText = ALWAYS,
      } = confirmOptions;

      // Anything other than exactly `true` — including a value another writer
      // put in the same place — means "ask". A stored invalid value must never
      // silently authorize the action.
      if (remember !== undefined && remember.get() === true) {
        options.onDiagnostic?.('notification.confirmSkipped', { message });
        return true;
      }

      if (suppressed()) {
        options.onDiagnostic?.('notification.suppressed', { severity, message });
        return false;
      }

      const actions: { title: string }[] = [{ title: yesText }, { title: noText }];
      if (remember !== undefined) {
        actions.push({ title: rememberText });
      }

      const index = await capability.show(
        severity,
        message,
        { modal, ...(detail === undefined ? {} : { detail }) },
        actions
      );

      if (remember !== undefined && index === 2) {
        await remember.set(true);
        return true;
      }
      return index === 0;
    },
  };
}
