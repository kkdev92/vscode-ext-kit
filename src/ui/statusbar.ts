import * as vscode from 'vscode';

// ============================================
// Types
// ============================================

/**
 * Options for creating a status bar item.
 */
export interface StatusBarItemOptions {
  /** Display text */
  text: string;
  /** Command to execute on click */
  command?: string | vscode.Command;
  /** Tooltip text */
  tooltip?: string | vscode.MarkdownString;
  /** Alignment (default: 'left') */
  alignment?: 'left' | 'right';
  /** Priority (higher = closer to edge) */
  priority?: number;
  /** Background color ('warning' or 'error') */
  backgroundColor?: 'warning' | 'error';
  /** Accessibility information */
  accessibilityInformation?: vscode.AccessibilityInformation;
  /** Initial visibility (default: true) */
  visible?: boolean;
}

/**
 * A managed status bar item with helper methods.
 */
export interface ManagedStatusBarItem extends vscode.Disposable {
  /**
   * Updates the text and optionally the tooltip.
   *
   * @param text - New text to display
   * @param tooltip - Optional new tooltip
   */
  update(text: string, tooltip?: string): void;

  /**
   * Sets multiple properties at once.
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

  /**
   * Hides the spinner and restores the previous text.
   */
  hideSpinner(): void;

  /** The underlying VS Code StatusBarItem */
  readonly native: vscode.StatusBarItem;
}

// ============================================
// createStatusBarItem
// ============================================

/**
 * Creates a managed status bar item.
 *
 * @param id - Unique identifier for the status bar item
 * @param options - Status bar item options
 * @returns A managed status bar item with helper methods
 *
 * @example
 * ```typescript
 * const statusItem = createStatusBarItem('myext.status', {
 *   text: '$(sync) Syncing',
 *   tooltip: 'Click to sync',
 *   command: 'myext.sync',
 *   alignment: 'left',
 *   priority: 100,
 * });
 * context.subscriptions.push(statusItem);
 *
 * // Update later
 * statusItem.update('$(check) Synced', 'Last sync: just now');
 *
 * // Show spinner during operation
 * statusItem.showSpinner('Processing...');
 * await doWork();
 * statusItem.hideSpinner();
 * ```
 */
export function createStatusBarItem(
  id: string,
  options: StatusBarItemOptions
): ManagedStatusBarItem {
  const { alignment = 'left', priority, visible = true } = options;

  const vscodeAlignment =
    alignment === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right;

  const item = vscode.window.createStatusBarItem(id, vscodeAlignment, priority);

  // `baseText` is the logical "current" text, set by update()/set()/the
  // constructor. `spinnerOverrideText` is a one-shot label supplied to
  // showSpinner(text) that overrides it for as long as the spinner is
  // showing — until the next update()/set() call reclaims priority, which
  // is what lets callers report progress ("Processing 42%") *while* the
  // spinner keeps spinning instead of it being silently clobbered (see
  // render() below, and the "spinner + update()" tests).
  let baseText = options.text;
  let spinnerOverrideText: string | undefined;
  let isShowingSpinner = false;

  /** Re-renders `item.text` from the current base/spinner state. Every text
   * mutation goes through here so the spinner icon and the logical text
   * never fight over `item.text` directly. */
  function render(): void {
    if (isShowingSpinner) {
      const label = spinnerOverrideText ?? baseText.replace(/^\$\([^)]+\)\s*/, '');
      item.text = `$(sync~spin) ${label}`;
    } else {
      item.text = baseText;
    }
  }

  // Apply initial options
  applyOptions(item, options);
  render();

  if (visible) {
    item.show();
  }

  const managedItem: ManagedStatusBarItem = {
    update(text: string, tooltip?: string): void {
      baseText = text;
      spinnerOverrideText = undefined;
      render();
      if (tooltip !== undefined) {
        item.tooltip = tooltip;
      }
    },

    set(opts: Partial<StatusBarItemOptions>): void {
      applyOptions(item, opts);
      if (opts.text !== undefined) {
        baseText = opts.text;
        spinnerOverrideText = undefined;
        render();
      }
    },

    show(): void {
      item.show();
    },

    hide(): void {
      item.hide();
    },

    showSpinner(text?: string): void {
      isShowingSpinner = true;
      if (text !== undefined) {
        spinnerOverrideText = text;
      }
      render();
    },

    hideSpinner(): void {
      if (isShowingSpinner) {
        isShowingSpinner = false;
        spinnerOverrideText = undefined;
        render();
      }
    },

    get native(): vscode.StatusBarItem {
      return item;
    },

    dispose(): void {
      item.dispose();
    },
  };

  return managedItem;
}

/**
 * Applies options to a status bar item.
 *
 * `text` is deliberately not handled here — `createStatusBarItem`'s
 * `render()` owns it exclusively so spinner state (see the "spinner"
 * fields/tests) never gets clobbered by a plain option assignment.
 */
function applyOptions(item: vscode.StatusBarItem, options: Partial<StatusBarItemOptions>): void {
  if (options.tooltip !== undefined) {
    item.tooltip = options.tooltip;
  }

  if (options.command !== undefined) {
    item.command = options.command;
  }

  if (options.backgroundColor !== undefined) {
    item.backgroundColor =
      options.backgroundColor === 'warning'
        ? new vscode.ThemeColor('statusBarItem.warningBackground')
        : new vscode.ThemeColor('statusBarItem.errorBackground');
  }

  if (options.accessibilityInformation !== undefined) {
    item.accessibilityInformation = options.accessibilityInformation;
  }
}

// ============================================
// showStatusMessage
// ============================================

// Each call gets its own status bar item id. Reusing one fixed id across
// calls (the pre-1.0 behavior) meant two overlapping messages — e.g.
// `showStatusMessage('Saving...')` immediately followed by another call for
// an unrelated operation — shared one VS Code-side item, so either call's
// timeout-driven dispose() could tear down the *other* call's still-visible
// message.
let statusMessageSequence = 0;

/**
 * Shows a temporary status bar message that automatically disappears.
 *
 * Safe to call without keeping the returned disposable — the message
 * disposes itself via `timeout` — but hold onto it and dispose early (or
 * push it to `context.subscriptions`) if the message should not outlive a
 * shorter-lived feature or the extension's own deactivation.
 *
 * @param text - The message to display
 * @param timeout - Time in milliseconds before disappearing (default: 5000)
 * @returns A disposable to manually dismiss the message
 *
 * @example
 * ```typescript
 * // Fire-and-forget: self-dismisses after 3s
 * showStatusMessage('File saved!', 3000);
 *
 * // Or manually dismiss (e.g. once a long task actually finishes)
 * const disposable = showStatusMessage('Processing...');
 * await doWork();
 * disposable.dispose();
 * ```
 */
export function showStatusMessage(text: string, timeout: number = 5000): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(
    `vscode-ext-kit.statusMessage.${++statusMessageSequence}`,
    vscode.StatusBarAlignment.Left,
    -1000
  );
  item.text = text;
  item.show();

  const timeoutId = setTimeout(() => {
    item.dispose();
  }, timeout);

  return new vscode.Disposable(() => {
    clearTimeout(timeoutId);
    item.dispose();
  });
}
