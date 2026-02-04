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

  // Store original text for spinner restore
  let originalText = options.text;
  let isShowingSpinner = false;

  // Apply initial options
  applyOptions(item, options);

  if (visible) {
    item.show();
  }

  const managedItem: ManagedStatusBarItem = {
    update(text: string, tooltip?: string): void {
      item.text = text;
      originalText = text;
      if (tooltip !== undefined) {
        item.tooltip = tooltip;
      }
    },

    set(opts: Partial<StatusBarItemOptions>): void {
      applyOptions(item, opts);
      if (opts.text !== undefined) {
        originalText = opts.text;
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
        item.text = `$(sync~spin) ${text}`;
      } else {
        item.text = `$(sync~spin) ${originalText.replace(/^\$\([^)]+\)\s*/, '')}`;
      }
    },

    hideSpinner(): void {
      if (isShowingSpinner) {
        isShowingSpinner = false;
        item.text = originalText;
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
 */
function applyOptions(item: vscode.StatusBarItem, options: Partial<StatusBarItemOptions>): void {
  if (options.text !== undefined) {
    item.text = options.text;
  }

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

/**
 * Shows a temporary status bar message that automatically disappears.
 *
 * @param text - The message to display
 * @param timeout - Time in milliseconds before disappearing (default: 5000)
 * @returns A disposable to manually dismiss the message
 *
 * @example
 * ```typescript
 * // Show a temporary message
 * showStatusMessage('File saved!', 3000);
 *
 * // Or manually dismiss
 * const disposable = showStatusMessage('Processing...');
 * await doWork();
 * disposable.dispose();
 * ```
 */
export function showStatusMessage(text: string, timeout: number = 5000): vscode.Disposable {
  const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, -1000);
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
