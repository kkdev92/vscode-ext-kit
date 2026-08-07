/**
 * Promise-based QuickPick/InputBox helpers above the quick-input platform port.
 *
 * Each invocation owns one native control plus every listener it installs.
 * Accept, hide, abort, async item failure, and validation failure converge on a
 * guarded settlement path that detaches listeners before disposing the UI.
 * User dismissal and operation cancellation resolve `undefined`; failures in
 * item loading or validation reject.
 *
 * The display builders at the end of this file are pure data helpers. They
 * intentionally return structural icon/button values, keeping consumer models
 * and unit tests independent of a `vscode` runtime.
 */
import type {
  PlatformRegistration,
  QuickInputButtonLike,
  ResourceUri,
  QuickInputCapability,
  QuickPickItemLike,
  QuickPickLike,
} from '../../foundation/platform/ports.js';
import { debounce } from '../std/timing.js';

/**
 * A quick pick item carrying a strongly-typed value, separating what is
 * *displayed* (label/description/detail/icon) from what the caller actually
 * wants back. Build these with `toPickItem` rather than by hand.
 */
export interface PickItem<T> extends QuickPickItemLike {
  /** The value associated with this item, returned to the caller on selection. */
  readonly value: T;
}

/** `vscode.QuickPickItemKind.Separator` — a stable public API constant. */
const SEPARATOR_KIND = -1;

/**
 * Creates a non-selectable separator for grouping items in a QuickPick list.
 * Mix these into the array passed to `pickOne`/`pickMany`.
 *
 * @param label - Text shown on the separator (default: empty)
 * @returns An item that renders as a visual group divider
 *
 * @example
 * ```ts
 * const items = [
 *   toPickSeparator('Recent'),
 *   toPickItem('a', { label: 'A' }),
 *   toPickSeparator('All'),
 *   toPickItem('b', { label: 'B' }),
 * ];
 * ```
 */
export function toPickSeparator(label = ''): QuickPickItemLike {
  return { label, kind: SEPARATOR_KIND };
}

/** Options accepted by {@link pickOne} and {@link pickMany}. */
export interface PickOptions<T extends QuickPickItemLike = QuickPickItemLike> {
  /** Title shown at the top of the picker. */
  readonly title?: string;
  /** Placeholder text shown in the empty filter box. */
  readonly placeHolder?: string;
  /** Instructional text shown below the filter box and above the items. */
  readonly prompt?: string;
  /** Include item descriptions when filtering (default: false). */
  readonly matchOnDescription?: boolean;
  /** Include item details when filtering (default: false). */
  readonly matchOnDetail?: boolean;
  /** Keep the picker open when focus moves elsewhere (default: false). */
  readonly ignoreFocusOut?: boolean;
  /**
   * Called whenever the highlighted item changes. Runs inside the platform
   * event callback: handle expected errors locally, because a thrown exception
   * is not converted into a rejected pick promise.
   */
  readonly onDidSelectItem?: (item: T) => unknown;
  /**
   * Buttons shown in the picker's title bar. Build them with `toPickButton`
   * and handle presses with {@link onTriggerButton}.
   */
  readonly buttons?: readonly QuickInputButtonLike[];
  /**
   * Called when one of {@link buttons} is pressed. The picker stays open —
   * call `picker.hide()` to dismiss it, which resolves the pick with
   * `undefined`. Compare `button` by identity against the one you built.
   * Handle expected errors locally; callback exceptions propagate from the
   * platform event rather than settling the pick promise.
   */
  readonly onTriggerButton?: (button: QuickInputButtonLike, picker: QuickPickLike<T>) => void;
  /**
   * Called when an inline button on an item is pressed. The picker stays
   * open, so a row-level action can update the list in place.
   * Callback exceptions follow the same platform-event behavior as
   * {@link PickOptions.onTriggerButton}.
   *
   * @example
   * ```ts
   * const remove = toPickButton('trash', { tooltip: 'Delete' });
   * const chosen = await pickOne(ui, keys.map((key) =>
   *   ({ ...toPickItem(key, { label: key }), buttons: [remove] })), {
   *   onTriggerItemButton: (_button, item, picker) => {
   *     picker.items = picker.items.filter((candidate) => candidate !== item);
   *   },
   * });
   * ```
   */
  readonly onTriggerItemButton?: (
    button: QuickInputButtonLike,
    item: T,
    picker: QuickPickLike<T>
  ) => void;
  /**
   * Cancels the pick: aborting hides the picker and resolves `undefined`.
   * Pass an operation's `context.signal` so an open picker never outlives
   * the operation that showed it.
   */
  readonly signal?: AbortSignal;
}

function isThenable<T>(value: unknown): value is Thenable<T> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}

/**
 * Shows a quick pick and settles exactly once.
 *
 * Disposing a *visible* quick pick makes VS Code fire `onDidHide`, so every
 * exit path re-enters the hide handler. The promise is claimed before tearing
 * down — without this guard an async item rejection loses the race to
 * `onDidHide`'s `resolve(undefined)` and the error is swallowed.
 */
function pickFromQuickPick<T extends QuickPickItemLike>(
  capability: QuickInputCapability,
  items: readonly T[] | Thenable<readonly T[]>,
  opts: PickOptions<T> | undefined,
  many: boolean
): Promise<T | T[] | undefined> {
  if (opts?.signal?.aborted === true) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve, reject) => {
    const quickPick = capability.createQuickPick<T>();
    const registrations: PlatformRegistration[] = [];
    let removeAbortListener: (() => void) | undefined;
    let settled = false;

    const settle = (outcome: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      outcome();
      // Listeners are detached explicitly rather than trusting dispose() to
      // drop them, so no adapter can leak a subscription per pick.
      for (const registration of registrations) {
        registration.dispose();
      }
      removeAbortListener?.();
      quickPick.dispose();
    };

    quickPick.title = opts?.title;
    quickPick.placeholder = opts?.placeHolder;
    quickPick.prompt = opts?.prompt;
    quickPick.matchOnDescription = opts?.matchOnDescription ?? false;
    quickPick.matchOnDetail = opts?.matchOnDetail ?? false;
    quickPick.ignoreFocusOut = opts?.ignoreFocusOut ?? false;
    quickPick.canSelectMany = many;
    if (opts?.buttons !== undefined) {
      quickPick.buttons = opts.buttons;
    }

    registrations.push(
      quickPick.onDidAccept(() => {
        settle(() => {
          resolve(many ? [...quickPick.selectedItems] : quickPick.selectedItems[0]);
        });
      }),
      quickPick.onDidHide(() => {
        settle(() => {
          resolve(undefined);
        });
      })
    );

    // Handing the picker to the callback is what makes buttons useful at all:
    // a press usually has to mutate the list it was pressed in (drop the row,
    // refresh it, mark it busy) and only the live picker can do that.
    const { onTriggerButton, onTriggerItemButton, onDidSelectItem } = opts ?? {};
    if (onTriggerButton !== undefined) {
      registrations.push(
        quickPick.onDidTriggerButton((button) => {
          onTriggerButton(button, quickPick);
        })
      );
    }
    if (onTriggerItemButton !== undefined) {
      registrations.push(
        quickPick.onDidTriggerItemButton((event) => {
          onTriggerItemButton(event.button, event.item, quickPick);
        })
      );
    }
    if (onDidSelectItem !== undefined) {
      registrations.push(
        quickPick.onDidChangeActive((active) => {
          if (active[0] !== undefined) {
            onDidSelectItem(active[0]);
          }
        })
      );
    }

    if (opts?.signal !== undefined) {
      const signal = opts.signal;
      const onAbort = (): void => {
        // hide() fires onDidHide, which settles with undefined.
        quickPick.hide();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => {
        signal.removeEventListener('abort', onAbort);
      };
    }

    if (!isThenable<readonly T[]>(items)) {
      // Assign before show() so a synchronous list never flashes empty, and
      // never raise `busy` for a list that is already here.
      quickPick.items = items;
      quickPick.show();
      return;
    }

    quickPick.busy = true;
    quickPick.show();

    items.then(
      (resolved) => {
        if (settled) {
          return;
        }
        quickPick.items = resolved;
        quickPick.busy = false;
      },
      (error: unknown) => {
        settle(() => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      }
    );
  });
}

/**
 * Shows a QuickPick for single item selection.
 *
 * `items` may be a plain array or a `Thenable`/`Promise`, in which case the
 * picker opens immediately with a busy indicator while the items resolve —
 * useful when building the list requires an API call or file system scan.
 *
 * @param capability - The quick-input surface (inject {@link QuickInput}, or
 *   use the standalone `pickOne` re-export bound to VS Code)
 * @param items - Items to display, or a promise that resolves to them
 * @param opts - QuickPick options
 * @returns Selected item or undefined if cancelled
 *
 * @example
 * ```ts
 * const selected = await pickOne(ui, [
 *   toPickItem(1, { label: 'Option 1' }),
 *   toPickItem(2, { label: 'Option 2' }),
 * ], { placeHolder: 'Select an option', signal: context.signal });
 * if (selected) {
 *   console.log(selected.value);
 * }
 * ```
 */
export async function pickOne<T extends QuickPickItemLike>(
  capability: QuickInputCapability,
  items: readonly T[] | Thenable<readonly T[]>,
  opts?: PickOptions<T>
): Promise<T | undefined> {
  return (await pickFromQuickPick(capability, items, opts, false)) as T | undefined;
}

/**
 * Shows a QuickPick for multiple item selection.
 *
 * @param capability - The quick-input surface (inject {@link QuickInput}, or
 *   use the standalone `pickMany` re-export bound to VS Code)
 * @param items - Items to display, or a promise that resolves to them
 * @param opts - QuickPick options
 * @returns Array of selected items or undefined if cancelled
 *
 * @example
 * ```ts
 * const selected = await pickMany(ui, [
 *   toPickItem('a', { label: 'Feature A', picked: true }),
 *   toPickItem('b', { label: 'Feature B' }),
 * ]);
 * ```
 */
export async function pickMany<T extends QuickPickItemLike>(
  capability: QuickInputCapability,
  items: readonly T[] | Thenable<readonly T[]>,
  opts?: PickOptions<T>
): Promise<T[] | undefined> {
  return (await pickFromQuickPick(capability, items, opts, true)) as T[] | undefined;
}

/** Options for {@link inputText}. */
export interface InputTextOptions {
  /** Prompt text to display. */
  readonly prompt: string;
  /** Placeholder text. */
  readonly placeHolder?: string;
  /** Initial value. */
  readonly value?: string;
  /** Password input mode. */
  readonly password?: boolean;
  /**
   * Validation function. May be asynchronous. A non-empty message blocks
   * acceptance; a thrown/rejected error rejects {@link inputText}.
   */
  readonly validate?: (value: string) => string | undefined | Promise<string | undefined>;
  /**
   * Keep the input box open when focus moves elsewhere (default: `false`,
   * matching `vscode.window.showInputBox`'s own default).
   */
  readonly ignoreFocusOut?: boolean;
  /** Cancels the input: aborting hides the box and resolves `undefined`. */
  readonly signal?: AbortSignal;
}

/** Live validation debounce, matching what VS Code applies to `showInputBox`. */
const VALIDATE_DEBOUNCE_MS = 100;

/**
 * Shows an InputBox for text input with optional validation.
 *
 * The value is validated as the user types (debounced) and once more,
 * without debouncing, when they accept; acceptance is blocked while the
 * validator returns a message.
 *
 * @param capability - The quick-input surface (inject {@link QuickInput}, or
 *   use the standalone `inputText` re-export bound to VS Code)
 * @param opts - InputBox options including prompt, placeholder, and validation
 * @returns User input string or undefined if cancelled
 *
 * @example
 * ```ts
 * const name = await inputText(ui, {
 *   prompt: 'Enter your name',
 *   validate: (value) => (value.length < 2 ? 'Name must be at least 2 characters' : undefined),
 * });
 * ```
 */
export function inputText(
  capability: QuickInputCapability,
  opts: InputTextOptions
): Promise<string | undefined> {
  if (opts.signal?.aborted === true) {
    return Promise.resolve(undefined);
  }

  return new Promise((resolve, reject) => {
    const inputBox = capability.createInputBox();
    const registrations: PlatformRegistration[] = [];
    let removeAbortListener: (() => void) | undefined;
    let settled = false;

    const settle = (outcome: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      debouncedValidate.cancel();
      outcome();
      for (const registration of registrations) {
        registration.dispose();
      }
      removeAbortListener?.();
      inputBox.dispose();
    };

    inputBox.prompt = opts.prompt;
    inputBox.placeholder = opts.placeHolder;
    inputBox.password = opts.password ?? false;
    inputBox.ignoreFocusOut = opts.ignoreFocusOut ?? false;
    if (opts.value !== undefined) {
      inputBox.value = opts.value;
    }

    const debouncedValidate = debounce((value: string) => {
      try {
        Promise.resolve(opts.validate?.(value)).then(
          (message) => {
            // Discard a stale result if the value moved on while this
            // validation was in flight.
            if (settled || inputBox.value !== value) {
              return;
            }
            inputBox.validationMessage = message;
          },
          (error: unknown) => {
            settle(() => {
              reject(error instanceof Error ? error : new Error(String(error)));
            });
          }
        );
      } catch (error) {
        settle(() => {
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      }
    }, VALIDATE_DEBOUNCE_MS);

    if (opts.validate !== undefined) {
      registrations.push(
        inputBox.onDidChangeValue((value) => {
          debouncedValidate(value);
        })
      );
    }

    registrations.push(
      inputBox.onDidAccept(() => {
        const value = inputBox.value;
        if (opts.validate === undefined) {
          settle(() => {
            resolve(value);
          });
          return;
        }
        debouncedValidate.cancel();
        inputBox.enabled = false;
        inputBox.busy = true;
        try {
          Promise.resolve(opts.validate(value)).then(
            (message) => {
              if (settled) {
                return;
              }
              inputBox.enabled = true;
              inputBox.busy = false;
              if (message !== undefined && message !== '') {
                inputBox.validationMessage = message;
                return;
              }
              settle(() => {
                resolve(value);
              });
            },
            (error: unknown) => {
              settle(() => {
                reject(error instanceof Error ? error : new Error(String(error)));
              });
            }
          );
        } catch (error) {
          settle(() => {
            reject(error instanceof Error ? error : new Error(String(error)));
          });
        }
      }),
      inputBox.onDidHide(() => {
        settle(() => {
          resolve(undefined);
        });
      })
    );

    if (opts.signal !== undefined) {
      const signal = opts.signal;
      const onAbort = (): void => {
        inputBox.hide();
      };
      signal.addEventListener('abort', onAbort, { once: true });
      removeAbortListener = () => {
        signal.removeEventListener('abort', onAbort);
      };
    }

    inputBox.show();
  });
}

/** Display options accepted by {@link toPickItem}. */
export interface PickItemDisplay {
  /** A human-readable string which is rendered prominently. */
  readonly label: string;
  /** A human-readable string which is rendered less prominently on the same line. */
  readonly description?: string;
  /** A human-readable string which is rendered less prominently on a separate line. */
  readonly detail?: string;
  /**
   * A codicon name (e.g. `'file'`), or an already-built icon.
   *
   * A name becomes `{ id }`, which is what a `vscode.ThemeIcon` is —
   * VS Code recognises one by its `id`, not by its constructor, so this needs
   * no platform call and the helper stays callable in a unit test.
   */
  readonly icon?: string | { readonly id: string };
  /** Whether this item is initially selected (only honored by `pickMany`). */
  readonly picked?: boolean;
  /** Keeps the item visible even when filtered out by the user's typed input. */
  readonly alwaysShow?: boolean;
  /**
   * Inline buttons rendered on this item. Build them with
   * {@link toPickButton} and handle presses with
   * `PickOptions.onTriggerItemButton` — without a handler they render
   * but do nothing.
   */
  readonly buttons?: readonly QuickInputButtonLike[];
  /**
   * A resource URI. When set, VS Code derives the label/description/icon
   * from the file (name, path, and file-icon-theme icon) for any of those
   * fields left unset.
   */
  readonly resourceUri?: ResourceUri;
}

/**
 * Builds a type-safe {@link PickItem} from a value and its display options.
 * Keeps the value your code cares about separate from the label string the
 * user sees, so callers never need to parse a label back into data.
 *
 * @param value - The value to return when this item is selected
 * @param display - Label, description, icon, and other display options
 * @returns A quick pick item carrying `value`
 *
 * @example
 * ```typescript
 * const items = [
 *   toPickItem('feature', { label: 'Feature', description: 'New feature' }),
 *   toPickItem('fix', { label: 'Bug Fix', description: 'Fix a bug', icon: 'bug' }),
 * ];
 * const selected = await pickOne(items);
 * if (selected) {
 *   console.log(selected.value); // 'feature' | 'fix', not a label string
 * }
 * ```
 */
export function toPickItem<T>(value: T, display: PickItemDisplay): PickItem<T> {
  return {
    value,
    label: display.label,
    ...(display.description === undefined ? {} : { description: display.description }),
    ...(display.detail === undefined ? {} : { detail: display.detail }),
    ...(display.icon === undefined
      ? {}
      : {
          iconPath: typeof display.icon === 'string' ? { id: display.icon } : display.icon,
        }),
    ...(display.picked === undefined ? {} : { picked: display.picked }),
    ...(display.alwaysShow === undefined ? {} : { alwaysShow: display.alwaysShow }),
    ...(display.buttons === undefined ? {} : { buttons: display.buttons }),
    ...(display.resourceUri === undefined ? {} : { resourceUri: display.resourceUri }),
  };
}

/** Options accepted by {@link toPickButton}. */
export interface PickButtonOptions {
  /** Tooltip shown when hovering over the button. */
  readonly tooltip?: string;
  /**
   * Where the button is rendered (default: the title bar).
   *
   * Ignored for buttons attached to an item via
   * {@link PickItemDisplay.buttons} — VS Code always renders those inline on
   * the item itself.
   */
  readonly location?: number;
  /**
   * Makes this a toggle button with the given initial checked state.
   *
   * VS Code updates `checked` **in place** on the returned button before
   * firing its trigger event, so read the state back off the same button
   * object inside the handler rather than tracking it separately.
   */
  readonly toggled?: boolean;
}

/**
 * Builds a {@link QuickInputButtonLike}, accepting a codicon name in place
 * of a hand-built theme icon the same way {@link toPickItem}
 * does for item icons.
 *
 * Pass the result to `PickOptions.buttons` (title bar) or
 * {@link PickItemDisplay.buttons} (inline on a row), and handle presses with
 * `PickOptions.onTriggerButton` / `PickOptions.onTriggerItemButton`.
 * A button with no handler renders but does nothing.
 *
 * @param icon - A codicon name (e.g. `'refresh'`) or an explicit icon path
 * @param opts - Tooltip, render location, and toggle state
 * @returns A button usable as a QuickPick/InputBox button or an item button
 *
 * @example
 * ```typescript
 * const refresh = toPickButton('refresh', { tooltip: 'Reload the list' });
 * const chosen = await pickOne(items, {
 *   buttons: [refresh],
 *   onTriggerButton: (button, picker) => {
 *     if (button === refresh) picker.items = reload();
 *   },
 * });
 * ```
 */
export function toPickButton(
  icon: string | { readonly id: string },
  opts: PickButtonOptions = {}
): QuickInputButtonLike {
  return {
    iconPath: typeof icon === 'string' ? { id: icon } : icon,
    ...(opts.tooltip === undefined ? {} : { tooltip: opts.tooltip }),
    ...(opts.location === undefined ? {} : { location: opts.location }),
    // Attach `toggle` only when one was asked for — its presence is what makes
    // a button a toggle, and `toggled: false` still has to produce one.
    ...(opts.toggled === undefined ? {} : { toggle: { checked: opts.toggled } }),
  };
}
