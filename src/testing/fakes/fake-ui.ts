/**
 * Focused recording fakes for notification, progress, status-bar and language-
 * status ports. They expose requested state and scripted responses, not
 * workbench rendering, accessibility output, focus, user timing or theme
 * resolution. Adapter and Extension Host tests remain authoritative for those.
 */
import type {
  AccessibilityInformationLike,
  CancellationTokenLike,
  CommandLinkLike,
  LanguageSelectorLike,
  LanguageStatusCapability,
  LanguageStatusItemHandle,
  NotificationActionLike,
  NotificationCapability,
  NotificationSeverity,
  PlatformRegistration,
  ProgressArea,
  ProgressCapability,
  ProgressReporterLike,
  StatusBarCapability,
  StatusBarItemHandle,
  TooltipLike,
} from '../../foundation/platform/ports.js';

/** One recorded `show` call. */
export interface ShownNotification {
  readonly severity: NotificationSeverity;
  readonly message: string;
  readonly modal: boolean;
  readonly detail: string | undefined;
  readonly actionTitles: readonly string[];
}

/**
 * A fake message capability that records what was shown and answers from a
 * scripted queue.
 */
export interface FakeNotifications extends NotificationCapability {
  /** Every message shown, in order. */
  readonly shown: readonly ShownNotification[];
  /**
   * Queues the answer for the next `show`: the index of the "clicked" action,
   * or `undefined` for a dismissal. Unqueued shows resolve `undefined`.
   */
  _respondWith(index: number | undefined): void;
  /** Makes the next `show` reject, simulating a platform failure. */
  _failNext(error: Error): void;
}

/**
 * Creates a fake notification capability.
 *
 * @example
 * ```ts
 * const notifications = createFakeNotifications();
 * notifications._respondWith(1); // "click" the second action
 * const choice = await notifications.show('info', 'Changed', {}, [
 *   { title: 'Reload' },
 *   { title: 'Ignore' },
 * ]);
 * expect(choice).toBe(1);
 * ```
 */
export function createFakeNotifications(): FakeNotifications {
  const shown: ShownNotification[] = [];
  const responses: (number | undefined)[] = [];
  let nextFailure: Error | undefined;

  return {
    shown,
    _respondWith(index: number | undefined): void {
      responses.push(index);
    },
    _failNext(error: Error): void {
      nextFailure = error;
    },
    show(
      severity: NotificationSeverity,
      message: string,
      options: { readonly modal?: boolean | undefined; readonly detail?: string | undefined },
      actions: readonly NotificationActionLike[]
    ): Promise<number | undefined> {
      if (nextFailure !== undefined) {
        const failure = nextFailure;
        nextFailure = undefined;
        return Promise.reject(failure);
      }
      shown.push({
        severity,
        message,
        modal: options.modal ?? false,
        detail: options.detail,
        actionTitles: actions.map((action) => action.title),
      });
      const index = responses.shift();
      // An out-of-range script counts as a dismissal, like Escape would. This
      // includes negative values: no invalid index may cross the port and be
      // mistaken for an action position by the caller.
      const inRange = index !== undefined && index >= 0 && index < actions.length;
      return Promise.resolve(inRange ? index : undefined);
    },
  };
}

/** One recorded progress session. */
export interface FakeProgressRun {
  readonly title: string;
  readonly location: ProgressArea;
  readonly cancellable: boolean;
  /** Every `report` call, in order. */
  readonly reports: readonly { message?: string | undefined; increment?: number | undefined }[];
  /** Trips the token handed to the task, like the user's cancel button. */
  cancel(): void;
}

/**
 * A fake progress capability that starts tasks immediately and records sessions.
 * Cancellation flips the structural token and notifies listeners; it does not
 * interrupt a task that chooses not to observe that token.
 */
export interface FakeProgress extends ProgressCapability {
  /** Every session, in start order. The task may still be running. */
  readonly runs: readonly FakeProgressRun[];
}

/**
 * Creates a fake progress capability.
 *
 * The task runs immediately on the calling stack; cancel mid-task via
 * `runs[i].cancel()` from inside a step.
 */
export function createFakeProgress(): FakeProgress {
  const runs: FakeProgressRun[] = [];

  return {
    runs,
    run<T>(
      options: {
        readonly title: string;
        readonly location: ProgressArea;
        readonly cancellable: boolean;
      },
      task: (reporter: ProgressReporterLike, token: CancellationTokenLike) => Promise<T>
    ): Promise<T> {
      const reports: { message?: string | undefined; increment?: number | undefined }[] = [];
      let cancellationRequested = false;
      const listeners = new Set<() => void>();

      const token: CancellationTokenLike = {
        get isCancellationRequested(): boolean {
          return cancellationRequested;
        },
        onCancellationRequested(listener: () => void): PlatformRegistration {
          listeners.add(listener);
          return {
            dispose(): void {
              listeners.delete(listener);
            },
          };
        },
      };

      runs.push({
        title: options.title,
        location: options.location,
        cancellable: options.cancellable,
        reports,
        cancel(): void {
          if (cancellationRequested) {
            return;
          }
          cancellationRequested = true;
          for (const listener of [...listeners]) {
            listener();
          }
        },
      });

      const reporter: ProgressReporterLike = {
        report(update): void {
          reports.push({ ...update });
        },
      };

      return task(reporter, token);
    },
  };
}

/** One fake status bar item and everything ever set on it. */
export interface FakeStatusBarItem {
  readonly id: string;
  readonly alignment: 'left' | 'right';
  readonly priority: number | undefined;
  text: string | undefined;
  tooltip: TooltipLike | undefined;
  command: string | CommandLinkLike | undefined;
  backgroundColor: 'warning' | 'error' | undefined;
  accessibilityInformation: AccessibilityInformationLike | undefined;
  visible: boolean;
  disposed: boolean;
}

/**
 * A fake status-bar capability that records every item it creates. Patch
 * semantics match the port: omitted fields retain their previous value.
 */
export interface FakeStatusBar extends StatusBarCapability {
  /** Every item created, in order, including disposed ones. */
  readonly items: readonly FakeStatusBarItem[];
}

/** Creates a fake status bar capability. */
export function createFakeStatusBar(): FakeStatusBar {
  const items: FakeStatusBarItem[] = [];

  return {
    items,
    createItem(
      id: string,
      alignment: 'left' | 'right',
      priority: number | undefined
    ): StatusBarItemHandle {
      const item: FakeStatusBarItem = {
        id,
        alignment,
        priority,
        text: undefined,
        tooltip: undefined,
        command: undefined,
        backgroundColor: undefined,
        accessibilityInformation: undefined,
        visible: false,
        disposed: false,
      };
      items.push(item);
      return {
        patch(fields): void {
          if (fields.text !== undefined) {
            item.text = fields.text;
          }
          if (fields.tooltip !== undefined) {
            item.tooltip = fields.tooltip;
          }
          if (fields.command !== undefined) {
            item.command = fields.command;
          }
          if (fields.backgroundColor !== undefined) {
            item.backgroundColor = fields.backgroundColor;
          }
          if (fields.accessibilityInformation !== undefined) {
            item.accessibilityInformation = fields.accessibilityInformation;
          }
        },
        show(): void {
          item.visible = true;
        },
        hide(): void {
          item.visible = false;
        },
        dispose(): void {
          item.disposed = true;
          item.visible = false;
        },
      };
    },
  };
}

/** One fake language status item and everything ever set on it. */
export interface FakeLanguageStatusItem {
  readonly id: string;
  readonly selector: LanguageSelectorLike;
  name: string | undefined;
  text: string | undefined;
  detail: string | undefined;
  command: CommandLinkLike | undefined;
  severity: 'info' | 'warn' | 'error' | undefined;
  busy: boolean;
  accessibilityInformation: AccessibilityInformationLike | undefined;
  disposed: boolean;
}

/**
 * A fake language-status capability that records every item it creates. It
 * stores selectors as supplied but does not evaluate them against documents.
 */
export interface FakeLanguageStatus extends LanguageStatusCapability {
  /** Every item created, in order, including disposed ones. */
  readonly items: readonly FakeLanguageStatusItem[];
}

/** Creates a fake language status capability. */
export function createFakeLanguageStatus(): FakeLanguageStatus {
  const items: FakeLanguageStatusItem[] = [];

  return {
    items,
    createItem(id: string, selector: LanguageSelectorLike): LanguageStatusItemHandle {
      const item: FakeLanguageStatusItem = {
        id,
        selector,
        name: undefined,
        text: undefined,
        detail: undefined,
        command: undefined,
        severity: undefined,
        busy: false,
        accessibilityInformation: undefined,
        disposed: false,
      };
      items.push(item);
      return {
        patch(fields): void {
          if (fields.name !== undefined) {
            item.name = fields.name;
          }
          if (fields.text !== undefined) {
            item.text = fields.text;
          }
          if (fields.detail !== undefined) {
            item.detail = fields.detail;
          }
          if (fields.command !== undefined) {
            item.command = fields.command;
          }
          if (fields.severity !== undefined) {
            item.severity = fields.severity;
          }
          if (fields.busy !== undefined) {
            item.busy = fields.busy;
          }
          if (fields.accessibilityInformation !== undefined) {
            item.accessibilityInformation = fields.accessibilityInformation;
          }
        },
        dispose(): void {
          item.disposed = true;
        },
      };
    },
  };
}
