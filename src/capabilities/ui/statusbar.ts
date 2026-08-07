import type {
  AccessibilityInformationLike,
  CommandLinkLike,
  PlatformRegistration,
  StatusBarCapability,
  StatusBarItemHandle,
  TooltipLike,
} from '../../foundation/platform/ports.js';

/** Options for creating a status bar item. */
export interface StatusBarItemOptions {
  /** Display text. Supports `$(icon-name)` codicon syntax. */
  readonly text: string;
  /** Command to execute on click. */
  readonly command?: string | CommandLinkLike;
  /** Tooltip text. */
  readonly tooltip?: TooltipLike;
  /** Alignment chosen when the native item is created (default: `'left'`). */
  readonly alignment?: 'left' | 'right';
  /** Creation-time priority (higher = closer to the alignment edge). */
  readonly priority?: number;
  /** Background color (`'warning'` or `'error'`). */
  readonly backgroundColor?: 'warning' | 'error';
  /** Accessibility information. */
  readonly accessibilityInformation?: AccessibilityInformationLike;
  /** Creation-time visibility (default: `true`). */
  readonly visible?: boolean;
}

/**
 * A managed status bar item with helper methods.
 *
 * Every method is a no-op once the item is disposed — an async task finishing
 * late may still call `update()` without throwing into a torn-down UI.
 */
export interface ManagedStatusBarItem {
  /**
   * Updates the text and optionally the tooltip.
   *
   * @param text - New text to display
   * @param tooltip - Optional new tooltip
   */
  update(text: string, tooltip?: string): void;

  /**
   * Sets mutable presentation properties at once: text, tooltip, command,
   * background color, and accessibility information. `alignment`, `priority`,
   * and `visible` are creation-time options; use {@link show}/{@link hide} for
   * visibility.
   *
   * @param options - Properties to update
   */
  set(options: Partial<StatusBarItemOptions>): void;

  /** Shows the status bar item. */
  show(): void;

  /** Hides the status bar item. */
  hide(): void;

  /**
   * Shows a spinner with optional text.
   *
   * @param text - Optional text to display next to spinner
   */
  showSpinner(text?: string): void;

  /** Hides the spinner and restores the previous text. */
  hideSpinner(): void;

  /**
   * Reference-counted busy indicator: each `setBusy(true)` must be balanced by
   * a `setBusy(false)` before the spinner stops. Two overlapping operations can
   * mark the item busy without the first one's finish blanking the second's
   * spinner. Independent of {@link showSpinner}, which is a plain on/off flag.
   */
  setBusy(busy: boolean): void;

  /**
   * Shows `text` for a while, then goes back to whatever the item said before.
   *
   * A state the item passes through rather than a second item created for one
   * message, so a "Saved." cannot outlive the item that reported it — and two
   * flashes in a row cannot leave two of them stacked in the corner.
   * Early-dismiss handles are guarded by displayed text; when two consecutive
   * flashes use identical text, treat the earlier handle as superseded rather
   * than disposing it.
   *
   * @param text - What to show
   * @param durationMs - How long for
   * @returns A handle that ends the message early. Idempotent.
   *
   * @example
   * ```ts
   * status.flash('$(check) Saved', 3000);
   * ```
   */
  flash(text: string, durationMs?: number): { dispose(): void };

  /** Releases the underlying platform item. Idempotent. */
  dispose(): void;
}

/**
 * Creates a managed status bar item over an already-created platform handle.
 *
 * The spinner is a state machine, not a text swap: `baseText` is the logical
 * "current" text set by `update()`/`set()`, and a spinner override supplied to
 * `showSpinner(text)` shadows it only while the spinner shows. A text update
 * arriving *during* the spinner replaces the base text and keeps spinning —
 * progress like "Processing 42%" is never silently clobbered.
 *
 * @example
 * ```ts
 * const item = createManagedStatusBarItem(handle, { text: '$(check) Ready' });
 * item.showSpinner('Processing...');
 * item.update('Processing 42%'); // spinner keeps spinning, label updates
 * item.hideSpinner(); // back to 'Processing 42%'
 * ```
 */
export function createManagedStatusBarItem(
  handle: StatusBarItemHandle,
  options: StatusBarItemOptions
): ManagedStatusBarItem {
  let baseText = options.text;
  let spinnerOverrideText: string | undefined;
  let isShowingSpinner = false;
  let busyCount = 0;
  let disposed = false;
  let flashText: string | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;
  /** Identifies the current flash, so an earlier one cannot end a later one. */
  let flashGeneration = 0;

  /** Re-renders the text from the current base/spinner state. Every text
   * mutation goes through here so the spinner icon and the logical text
   * never fight over the platform item directly. */
  function render(): void {
    // A flash outranks the spinner: it is the more recent, more specific thing
    // the user asked to see, and it goes away on its own.
    if (flashText !== undefined) {
      handle.patch({ text: flashText });
      return;
    }
    if (isShowingSpinner || busyCount > 0) {
      const label = spinnerOverrideText ?? baseText.replace(/^\$\([^)]+\)\s*/, '');
      handle.patch({ text: `$(sync~spin) ${label}` });
    } else {
      handle.patch({ text: baseText });
    }
  }

  applyOptions(handle, options);
  render();

  if (options.visible ?? true) {
    handle.show();
  }

  return {
    update(text: string, tooltip?: string): void {
      if (disposed) {
        return;
      }
      baseText = text;
      spinnerOverrideText = undefined;
      render();
      if (tooltip !== undefined) {
        handle.patch({ tooltip });
      }
    },

    set(patch: Partial<StatusBarItemOptions>): void {
      if (disposed) {
        return;
      }
      applyOptions(handle, patch);
      if (patch.text !== undefined) {
        baseText = patch.text;
        spinnerOverrideText = undefined;
        render();
      }
    },

    show(): void {
      if (!disposed) {
        handle.show();
      }
    },

    hide(): void {
      if (!disposed) {
        handle.hide();
      }
    },

    showSpinner(text?: string): void {
      if (disposed) {
        return;
      }
      isShowingSpinner = true;
      if (text !== undefined) {
        spinnerOverrideText = text;
      }
      render();
    },

    hideSpinner(): void {
      if (disposed || !isShowingSpinner) {
        return;
      }
      isShowingSpinner = false;
      spinnerOverrideText = undefined;
      render();
    },

    setBusy(busy: boolean): void {
      if (disposed) {
        return;
      }
      busyCount = busy ? busyCount + 1 : Math.max(0, busyCount - 1);
      render();
    },

    flash(text: string, durationMs = 3000): { dispose(): void } {
      if (disposed) {
        return { dispose: (): undefined => undefined };
      }

      // A second flash replaces the first rather than queueing: the later
      // message is the current truth, and a queue would show stale text.
      if (flashTimer !== undefined) {
        clearTimeout(flashTimer);
      }
      flashText = text;
      // Which flash this is, not what it says. Comparing the text would make
      // two flashes of the same message indistinguishable, so the first one's
      // timer or `dispose()` would clear the second one's display — and the
      // same message twice in a row is the common case, not the exotic one.
      flashGeneration += 1;
      const generation = flashGeneration;
      render();

      const end = (): void => {
        if (flashGeneration !== generation) {
          // Already superseded by a later flash; leave that one showing.
          return;
        }
        if (flashTimer !== undefined) {
          clearTimeout(flashTimer);
          flashTimer = undefined;
        }
        flashText = undefined;
        render();
      };

      flashTimer = setTimeout(end, durationMs);
      return { dispose: end };
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      // The timer holds a reference to this item; leaving it armed would fire
      // a render against a disposed handle.
      if (flashTimer !== undefined) {
        clearTimeout(flashTimer);
        flashTimer = undefined;
      }
      handle.dispose();
    },
  };
}

/**
 * Applies options to a status bar item.
 *
 * `text` is deliberately not handled here — `createManagedStatusBarItem`'s
 * `render()` owns it exclusively so spinner state never gets clobbered by a
 * plain option assignment.
 */
function applyOptions(handle: StatusBarItemHandle, options: Partial<StatusBarItemOptions>): void {
  // Alignment and priority belong to capability.createItem(), and visibility
  // is controlled through show()/hide(). Only platform-mutable presentation
  // fields are patched here.
  handle.patch({
    ...(options.tooltip === undefined ? {} : { tooltip: options.tooltip }),
    ...(options.command === undefined ? {} : { command: options.command }),
    ...(options.backgroundColor === undefined ? {} : { backgroundColor: options.backgroundColor }),
    ...(options.accessibilityInformation === undefined
      ? {}
      : { accessibilityInformation: options.accessibilityInformation }),
  });
}

// Each call gets its own status bar item id. With one fixed id, two
// overlapping messages share a single platform item, and whichever timeout
// fires first disposes the item out from under the message still on screen.
let statusMessageSequence = 0;

/**
 * Shows a temporary status bar message that automatically disappears.
 *
 * Safe to call without keeping the returned disposable — the message disposes
 * itself via `timeout` — but hold onto it and dispose early if the message
 * should not outlive a shorter-lived feature.
 *
 * @param capability - The status bar surface to render on
 * @param text - The message to display
 * @param timeout - Time in milliseconds before disappearing (default: 5000)
 * @returns A disposable to manually dismiss the message
 *
 * @example
 * ```ts
 * const message = createStatusMessage(capability, 'Processing...');
 * await doWork();
 * message.dispose();
 * ```
 */
export function createStatusMessage(
  capability: StatusBarCapability,
  text: string,
  timeout: number = 5000
): PlatformRegistration {
  statusMessageSequence += 1;
  const handle = capability.createItem(
    `vscode-ext-kit.statusMessage.${String(statusMessageSequence)}`,
    'left',
    -1000
  );
  handle.patch({ text });
  handle.show();

  let disposed = false;
  const timeoutId = setTimeout(() => {
    if (!disposed) {
      disposed = true;
      handle.dispose();
    }
  }, timeout);

  return {
    dispose(): void {
      if (!disposed) {
        disposed = true;
        clearTimeout(timeoutId);
        handle.dispose();
      }
    },
  };
}
