/**
 * Stateful QuickPick/InputBox fakes for TestHost and capability tests.
 *
 * They model the lifecycle edges framework code depends on—show, hide,
 * re-entrant disposal, subscription removal and scripted user events. They do
 * not model workbench rendering, focus timing, filtering/scoring, keyboard
 * navigation or VS Code's validation UI. Use an Extension Host test when one of
 * those platform behaviors is the subject.
 */
import type {
  InputBoxLike,
  PlatformRegistration,
  QuickInputButtonLike,
  QuickInputCapability,
  QuickPickItemLike,
  QuickPickLike,
} from '../../foundation/platform/ports.js';

/** Small idempotent event registry shared by both stateful controls. */
class Listeners<T> {
  private readonly listeners = new Set<(event: T) => void>();

  add(listener: (event: T) => void): PlatformRegistration {
    this.listeners.add(listener);
    return {
      dispose: () => {
        this.listeners.delete(listener);
      },
    };
  }

  fire(event: T): void {
    for (const listener of [...this.listeners]) {
      listener(event);
    }
  }

  get size(): number {
    return this.listeners.size;
  }
}

/** A scriptable quick pick using the managed service's hide/dispose model. */
export interface FakeQuickPick<
  T extends QuickPickItemLike = QuickPickItemLike,
> extends QuickPickLike<T> {
  /** Whether `show()` has been called and the input not yet hidden. */
  readonly visible: boolean;
  /** Whether `dispose()` has been called. */
  readonly disposed: boolean;
  /** Number of listeners still attached, across all events. */
  readonly listenerCount: number;
  /** Sets the selection and fires `onDidAccept`, like the user pressing Enter. */
  _accept(selected?: readonly T[]): void;
  /** Fires `onDidHide`, like the user pressing Escape. */
  _hide(): void;
  /** Sets the active (highlighted) items and fires `onDidChangeActive`. */
  _setActive(active: readonly T[]): void;
  /** Sets the filter text and fires `onDidChangeValue`. */
  _type(value: string): void;
  /** Fires `onDidTriggerButton` with the given button. */
  _triggerButton(button: QuickInputButtonLike): void;
  /** Fires `onDidTriggerItemButton` for a button on an item. */
  _triggerItemButton(button: QuickInputButtonLike, item: T): void;
}

/** A scriptable input box using the managed service's hide/dispose model. */
export interface FakeInputBox extends InputBoxLike {
  readonly visible: boolean;
  readonly disposed: boolean;
  readonly listenerCount: number;
  /** Sets the value and fires `onDidChangeValue`, like the user typing. */
  _type(value: string): void;
  /** Fires `onDidAccept`, like the user pressing Enter. */
  _accept(): void;
  /** Fires `onDidHide`, like the user pressing Escape. */
  _hide(): void;
  /** Fires `onDidTriggerButton` with the given button. */
  _triggerButton(button: QuickInputButtonLike): void;
}

/**
 * A fake quick-input capability that records every quick pick and input box
 * it creates and lets tests drive them through `_`-prefixed controls.
 */
export interface FakeQuickInput extends QuickInputCapability {
  /** Every quick pick created, in order, including disposed ones. */
  readonly quickPicks: readonly FakeQuickPick[];
  /** Every input box created, in order, including disposed ones. */
  readonly inputBoxes: readonly FakeInputBox[];
}

/**
 * Creates a fake quick-input capability.
 *
 * Deliberately makes hide delivery synchronous: `hide()` on a visible input
 * fires `onDidHide`, and disposing a visible input first follows that hide
 * path. This pins the re-entrant cleanup edge the managed service is designed
 * to tolerate. The public VS Code contract says disposal first hides a visible
 * input and forbids later access; this fake's exact callback timing and its
 * behavior after disposal are deterministic test choices, not extra platform
 * guarantees.
 *
 * Note what cannot be checked here. The real capability hands back
 * `vscode.window.createQuickPick()` untouched, so a suite comparing this fake
 * against the adapter would only prove structural agreement. Rendering, event
 * scheduling and behavior outside the public lifecycle contract require a real
 * Extension Host.
 *
 * @example
 * ```ts
 * const ui = createFakeQuickInput();
 * const pick = ui.createQuickPick<{ label: string }>();
 * pick.items = [{ label: 'One' }, { label: 'Two' }];
 * let accepted = false;
 * pick.onDidAccept(() => { accepted = true; });
 * ui.quickPicks[0]?._accept([pick.items[1]!]);
 * expect(accepted).toBe(true);
 * ```
 */
export function createFakeQuickInput(): FakeQuickInput {
  const quickPicks: FakeQuickPick[] = [];
  const inputBoxes: FakeInputBox[] = [];

  return {
    quickPicks,
    inputBoxes,
    backButton: { iconPath: 'arrow-left', tooltip: 'Back' },

    createQuickPick<T extends QuickPickItemLike>(): QuickPickLike<T> {
      const accept = new Listeners<void>();
      const hide = new Listeners<void>();
      const changeValue = new Listeners<string>();
      const changeActive = new Listeners<readonly T[]>();
      const triggerButton = new Listeners<QuickInputButtonLike>();
      const triggerItemButton = new Listeners<{
        readonly button: QuickInputButtonLike;
        readonly item: T;
      }>();

      let visible = false;
      let disposed = false;
      let items: readonly T[] = [];
      let activeItems: readonly T[] = [];
      let selectedItems: readonly T[] = [];

      const fireHideIfVisible = (): void => {
        if (visible) {
          visible = false;
          hide.fire(undefined);
        }
      };

      const quickPick: FakeQuickPick<T> = {
        title: undefined,
        step: undefined,
        totalSteps: undefined,
        placeholder: undefined,
        prompt: undefined,
        value: '',
        canSelectMany: false,
        matchOnDescription: false,
        matchOnDetail: false,
        ignoreFocusOut: false,
        busy: false,
        enabled: true,
        buttons: [],

        get items(): readonly T[] {
          return items;
        },
        set items(next: readonly T[]) {
          // A disposed control must not be reused. Ignoring this write keeps a
          // stale test reference from mutating the fake's recorded final items;
          // VS Code deliberately leaves post-disposal access unspecified.
          if (!disposed) {
            items = next;
          }
        },
        get activeItems(): readonly T[] {
          return activeItems;
        },
        get selectedItems(): readonly T[] {
          return selectedItems;
        },
        get visible(): boolean {
          return visible;
        },
        get disposed(): boolean {
          return disposed;
        },
        get listenerCount(): number {
          return (
            accept.size +
            hide.size +
            changeValue.size +
            changeActive.size +
            triggerButton.size +
            triggerItemButton.size
          );
        },

        onDidAccept: (listener) => accept.add(listener),
        onDidHide: (listener) => hide.add(listener),
        onDidChangeValue: (listener) => changeValue.add(listener),
        onDidChangeActive: (listener) => changeActive.add(listener),
        onDidTriggerButton: (listener) => triggerButton.add(listener),
        onDidTriggerItemButton: (listener) => triggerItemButton.add(listener),

        show(): void {
          if (!disposed) {
            visible = true;
          }
        },
        hide(): void {
          fireHideIfVisible();
        },
        dispose(): void {
          if (disposed) {
            return;
          }
          // A visible input fires onDidHide on the way out, which means a
          // hide listener runs *during* disposal. Code that disposes from its
          // own hide handler re-enters here, so the guard above matters.
          fireHideIfVisible();
          disposed = true;
        },

        _accept(selected?: readonly T[]): void {
          if (selected !== undefined) {
            selectedItems = selected;
          }
          accept.fire(undefined);
        },
        _hide(): void {
          fireHideIfVisible();
        },
        _setActive(active: readonly T[]): void {
          activeItems = active;
          changeActive.fire(active);
        },
        _type(next: string): void {
          quickPick.value = next;
          changeValue.fire(next);
        },
        _triggerButton(button: QuickInputButtonLike): void {
          triggerButton.fire(button);
        },
        _triggerItemButton(button: QuickInputButtonLike, item: T): void {
          triggerItemButton.fire({ button, item });
        },
      };

      quickPicks.push(quickPick);
      return quickPick;
    },

    createInputBox(): InputBoxLike {
      const accept = new Listeners<void>();
      const hide = new Listeners<void>();
      const changeValue = new Listeners<string>();
      const triggerButton = new Listeners<QuickInputButtonLike>();

      let visible = false;
      let disposed = false;

      const fireHideIfVisible = (): void => {
        if (visible) {
          visible = false;
          hide.fire(undefined);
        }
      };

      const inputBox: FakeInputBox = {
        title: undefined,
        step: undefined,
        totalSteps: undefined,
        prompt: undefined,
        placeholder: undefined,
        password: false,
        value: '',
        validationMessage: undefined,
        ignoreFocusOut: false,
        busy: false,
        enabled: true,
        buttons: [],

        get visible(): boolean {
          return visible;
        },
        get disposed(): boolean {
          return disposed;
        },
        get listenerCount(): number {
          return accept.size + hide.size + changeValue.size + triggerButton.size;
        },

        onDidAccept: (listener) => accept.add(listener),
        onDidHide: (listener) => hide.add(listener),
        onDidChangeValue: (listener) => changeValue.add(listener),
        onDidTriggerButton: (listener) => triggerButton.add(listener),

        show(): void {
          if (!disposed) {
            visible = true;
          }
        },
        hide(): void {
          fireHideIfVisible();
        },
        dispose(): void {
          if (disposed) {
            return;
          }
          fireHideIfVisible();
          disposed = true;
        },

        _type(next: string): void {
          inputBox.value = next;
          changeValue.fire(next);
        },
        _accept(): void {
          accept.fire(undefined);
        },
        _hide(): void {
          fireHideIfVisible();
        },
        _triggerButton(button: QuickInputButtonLike): void {
          triggerButton.fire(button);
        },
      };

      inputBoxes.push(inputBox);
      return inputBox;
    },
  };
}
