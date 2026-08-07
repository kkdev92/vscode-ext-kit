import type { StatusBarCapability } from '../../foundation/platform/ports.js';
import { serviceToken } from '../../foundation/services/token.js';
import type { ServiceToken } from '../../foundation/services/token.js';

/**
 * Short-lived status bar messages.
 *
 * Distinct from `defineStatusBarItem`, which declares an item the extension
 * *owns* and keeps updating — a sync indicator, a line count. This is for the
 * other case: "Copied.", "History cleared." — text that appears, says one
 * thing, and goes away. Flashing that through a declared item would clobber
 * whatever the item was showing, and declaring an item per message would leave
 * the caller disposing it on a timer.
 *
 * @example
 * ```ts
 * module.commands.handle(Copy, {
 *   inject: { status: StatusBar },
 *   execute: async (_context, _args, { status }) => {
 *     await copy();
 *     status.flash('$(clippy) Copied');
 *   },
 * });
 * ```
 */
export interface StatusBarService {
  /**
   * Shows `text` for a while, then removes it.
   *
   * A second flash replaces the first rather than queueing behind it: the newer
   * message is the current truth, and a queue would show stale text.
   * Early-dismiss handles are guarded by displayed text; when two consecutive
   * flashes use identical text, treat the earlier handle as superseded rather
   * than disposing it.
   *
   * @param text - What to show. Supports `$(icon)` syntax.
   * @param durationMs - How long to show it. Defaults to 3000 ms.
   * @returns A handle that ends the message early. Idempotent.
   */
  flash(text: string, durationMs?: number): { dispose(): void };
}

/** Injects the application's {@link StatusBarService}. */
export const StatusBar: ServiceToken<StatusBarService> =
  serviceToken<StatusBarService>('framework.statusBar');

/**
 * Builds the transient-message service over a capability.
 *
 * One platform item is created lazily and reused for every message, rather than
 * one per message: the item is what the application owns, and disposing the
 * service takes it with it.
 *
 * @example
 * ```ts
 * const status = createStatusBarService(capability);
 * status.flash('$(check) Saved');
 * ```
 */
export function createStatusBarService(
  capability: StatusBarCapability
): StatusBarService & { dispose(): void } {
  // `showing` records the displayed text so an early-dismiss handle for
  // distinct, superseded text cannot hide the newer message.
  let handle: ReturnType<StatusBarCapability['createItem']> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let showing: string | undefined;
  let disposed = false;

  const hide = (): void => {
    if (timer !== undefined) {
      clearTimeout(timer);
      timer = undefined;
    }
    showing = undefined;
    handle?.hide();
  };

  return {
    flash(text: string, durationMs = 3000): { dispose(): void } {
      if (disposed) {
        return { dispose: (): undefined => undefined };
      }

      // Created on first use: an extension that never flashes anything should
      // not put an item in the status bar at all.
      handle ??= capability.createItem('framework.statusMessage', 'left', -1000);

      if (timer !== undefined) {
        clearTimeout(timer);
      }
      showing = text;
      handle.patch({ text });
      handle.show();

      const end = (): void => {
        if (showing !== text) {
          // Superseded by a later flash; leave that one showing.
          return;
        }
        hide();
      };

      timer = setTimeout(end, durationMs);
      return { dispose: end };
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      // The timer holds this closure; leaving it armed would patch a disposed
      // handle.
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      handle?.dispose();
      handle = undefined;
    },
  };
}
