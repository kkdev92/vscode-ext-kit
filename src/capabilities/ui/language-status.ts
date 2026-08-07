import type {
  AccessibilityInformationLike,
  CommandLinkLike,
  LanguageStatusItemHandle,
} from '../../foundation/platform/ports.js';

/** Severity shown on a language status item's icon (mirrors the notification vocabulary). */
export type LanguageStatusItemSeverity = 'info' | 'warn' | 'error';

/**
 * Options accepted by both `createLanguageStatusItem`/`defineLanguageStatusItem`
 * (as the initial state) and {@link ManagedLanguageStatusItem.update} (as a
 * partial patch, minus `text`, which `update` takes as its own first argument).
 */
export interface LanguageStatusItemOptions {
  /** Short name shown in the "Language Status" hover, e.g. `'ESLint'`. */
  readonly name: string;
  /** The text to show for the entry. Supports `$(icon-name)` codicon syntax. */
  readonly text: string;
  /** Optional human-readable detail, shown below `text` in the hover. */
  readonly detail?: string;
  /** Command invoked when the item is clicked. */
  readonly command?: CommandLinkLike;
  /** Icon/severity shown next to the item (default: `'info'`). */
  readonly severity?: LanguageStatusItemSeverity;
  /** Shows a busy indicator (default: `false`). */
  readonly busy?: boolean;
  /** Accessibility information used when a screen reader interacts with this item. */
  readonly accessibilityInformation?: AccessibilityInformationLike;
}

/**
 * Additional fields accepted by {@link ManagedLanguageStatusItem.update}.
 * The method's first argument is authoritative for displayed text; a `text`
 * property present through structural typing is ignored.
 */
export type LanguageStatusItemUpdate = Partial<Omit<LanguageStatusItemOptions, 'name'>>;

/**
 * A managed language status item with a single `update()` entry point,
 * mirroring `ManagedStatusBarItem`'s shape. Methods are no-ops after
 * `dispose()`.
 */
export interface ManagedLanguageStatusItem {
  /**
   * Updates the text and optionally any other property.
   * `name` and the selector identify the item and cannot be changed after
   * creation. Calls after disposal are ignored.
   *
   * @param text - New text to display
   * @param opts - Other properties to update (detail, severity, busy, command, accessibility)
   */
  update(text: string, opts?: LanguageStatusItemUpdate): void;

  /** Releases the underlying platform item. Idempotent. */
  dispose(): void;
}

/**
 * Creates a managed language status item over an already-created platform handle.
 *
 * Unlike a regular status bar item, a language status item is shown only while
 * the active editor's language matches the selector it was created with, in the
 * dedicated "Language Status" area — useful for linter/formatter state, active
 * toolchain version, or other per-language status that shouldn't compete for
 * space in the general status bar.
 *
 * @example
 * ```ts
 * const status = createManagedLanguageStatusItem(handle, {
 *   name: 'ESLint',
 *   text: '$(check) No issues',
 * });
 * status.update('$(warning) 3 problems', { severity: 'warn' });
 * ```
 */
export function createManagedLanguageStatusItem(
  handle: LanguageStatusItemHandle,
  options: LanguageStatusItemOptions
): ManagedLanguageStatusItem {
  let disposed = false;

  handle.patch({
    name: options.name,
    text: options.text,
    severity: options.severity ?? 'info',
    busy: options.busy ?? false,
    ...(options.detail === undefined ? {} : { detail: options.detail }),
    ...(options.command === undefined ? {} : { command: options.command }),
    ...(options.accessibilityInformation === undefined
      ? {}
      : { accessibilityInformation: options.accessibilityInformation }),
  });

  return {
    update(text: string, opts: LanguageStatusItemUpdate = {}): void {
      if (disposed) {
        return;
      }
      handle.patch({
        text,
        ...(opts.detail === undefined ? {} : { detail: opts.detail }),
        ...(opts.command === undefined ? {} : { command: opts.command }),
        ...(opts.severity === undefined ? {} : { severity: opts.severity }),
        ...(opts.busy === undefined ? {} : { busy: opts.busy }),
        ...(opts.accessibilityInformation === undefined
          ? {}
          : { accessibilityInformation: opts.accessibilityInformation }),
      });
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      handle.dispose();
    },
  };
}
