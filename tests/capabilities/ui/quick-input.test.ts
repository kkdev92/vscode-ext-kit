/**
 * Unit/lifecycle suite for promise-based QuickPick and InputBox helpers against
 * the observable fake. It protects single settlement, listener teardown,
 * asynchronous loading/validation, button callbacks, and abort-as-dismissal.
 * Reentrant hide failures point to cleanup ordering in the helper, not UI DI.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  inputText,
  pickMany,
  pickOne,
  toPickSeparator,
} from '../../../src/capabilities/ui/quick-input.js';
import { createFakeQuickInput } from '../../../src/testing/fakes/fake-quick-input.js';
import type { PickItem } from '../../../src/capabilities/ui/quick-input.js';

afterEach(() => {
  vi.useRealTimers();
});

const items: PickItem<string>[] = [
  { label: 'Alpha', value: 'a' },
  { label: 'Beta', value: 'b' },
];

describe('pickOne / pickMany', () => {
  it('resolves the accepted item and applies the display options', async () => {
    const ui = createFakeQuickInput();
    const pending = pickOne(ui, items, {
      title: 'Choose',
      placeHolder: 'type to filter',
      prompt: 'One of these',
      matchOnDescription: true,
      ignoreFocusOut: true,
    });

    const quickPick = ui.quickPicks[0];
    expect(quickPick).toMatchObject({
      title: 'Choose',
      placeholder: 'type to filter',
      prompt: 'One of these',
      matchOnDescription: true,
      ignoreFocusOut: true,
      canSelectMany: false,
      visible: true,
    });
    quickPick?._accept([items[1] as PickItem<string>]);

    await expect(pending).resolves.toBe(items[1]);
    expect(quickPick?.disposed).toBe(true);
  });

  it('resolves all selected items for pickMany', async () => {
    const ui = createFakeQuickInput();
    const pending = pickMany(ui, items);

    expect(ui.quickPicks[0]?.canSelectMany).toBe(true);
    ui.quickPicks[0]?._accept(items);
    await expect(pending).resolves.toEqual(items);
  });

  it('resolves undefined when the user hides the picker', async () => {
    const ui = createFakeQuickInput();
    const pending = pickOne(ui, items);
    ui.quickPicks[0]?._hide();
    await expect(pending).resolves.toBeUndefined();
  });

  it('settles exactly once when accept and hide race', async () => {
    const ui = createFakeQuickInput();
    const pending = pickOne(ui, items);
    const quickPick = ui.quickPicks[0];

    quickPick?._accept([items[0] as PickItem<string>]);
    // The dispose inside settle fires onDidHide reentrantly; a later manual
    // hide must also be a no-op.
    quickPick?._hide();

    await expect(pending).resolves.toBe(items[0]);
  });

  it('detaches every listener once settled', async () => {
    const ui = createFakeQuickInput();
    const pending = pickOne(ui, items, {
      onTriggerButton: () => undefined,
      onTriggerItemButton: () => undefined,
      onDidSelectItem: () => undefined,
    });
    const quickPick = ui.quickPicks[0];
    expect(quickPick?.listenerCount).toBeGreaterThan(0);

    quickPick?._accept([items[0] as PickItem<string>]);
    await pending;
    expect(quickPick?.listenerCount).toBe(0);
  });

  it('renders a separator item', () => {
    expect(toPickSeparator('Recent')).toEqual({ label: 'Recent', kind: -1 });
    expect(toPickSeparator()).toEqual({ label: '', kind: -1 });
  });

  describe('async items', () => {
    it('opens busy, then populates once the items resolve', async () => {
      const ui = createFakeQuickInput();
      let resolveItems: (value: readonly PickItem<string>[]) => void = () => undefined;
      const pending = pickOne(
        ui,
        new Promise<readonly PickItem<string>[]>((resolve) => {
          resolveItems = resolve;
        })
      );

      const quickPick = ui.quickPicks[0];
      expect(quickPick?.busy).toBe(true);
      expect(quickPick?.items).toEqual([]);

      resolveItems(items);
      await Promise.resolve();
      expect(quickPick?.busy).toBe(false);
      expect(quickPick?.items).toEqual(items);

      quickPick?._accept([items[0] as PickItem<string>]);
      await expect(pending).resolves.toBe(items[0]);
    });

    it('propagates an item-list rejection instead of swallowing it in the hide reentry', async () => {
      const ui = createFakeQuickInput();
      const pending = pickOne(ui, Promise.reject(new Error('fetch failed')));

      await expect(pending).rejects.toThrow('fetch failed');
      // The picker was visible when the rejection disposed it, so onDidHide
      // fired reentrantly — and must not have turned the failure into
      // undefined.
      expect(ui.quickPicks[0]?.disposed).toBe(true);
    });

    it('ignores items resolving after the user already dismissed', async () => {
      const ui = createFakeQuickInput();
      let resolveItems: (value: readonly PickItem<string>[]) => void = () => undefined;
      const pending = pickOne(
        ui,
        new Promise<readonly PickItem<string>[]>((resolve) => {
          resolveItems = resolve;
        })
      );

      ui.quickPicks[0]?._hide();
      await expect(pending).resolves.toBeUndefined();

      resolveItems(items);
      await Promise.resolve();
      expect(ui.quickPicks[0]?.items).toEqual([]);
    });
  });

  describe('buttons and selection callbacks', () => {
    it('reports title-bar button presses with the live picker', async () => {
      const ui = createFakeQuickInput();
      const refresh = { iconPath: 'refresh', tooltip: 'Refresh' };
      const pressed: unknown[] = [];

      const pending = pickOne(ui, items, {
        buttons: [refresh],
        onTriggerButton: (button, picker) => {
          pressed.push(button);
          picker.items = [{ label: 'Gamma', value: 'c' }];
        },
      });
      const quickPick = ui.quickPicks[0];
      expect(quickPick?.buttons).toEqual([refresh]);

      quickPick?._triggerButton(refresh);
      // Identity, and the picker stays open and mutable.
      expect(pressed[0]).toBe(refresh);
      expect(quickPick?.visible).toBe(true);
      expect(quickPick?.items.map((item) => item.label)).toEqual(['Gamma']);

      quickPick?._hide();
      await pending;
    });

    it('reports item button presses with the item they belong to', async () => {
      const ui = createFakeQuickInput();
      const remove = { iconPath: 'trash' };
      const removed: string[] = [];

      const pending = pickOne(ui, items, {
        onTriggerItemButton: (_button, item, picker) => {
          removed.push(item.value);
          picker.items = picker.items.filter((candidate) => candidate !== item);
        },
      });
      const quickPick = ui.quickPicks[0];

      quickPick?._triggerItemButton(remove, items[0] as PickItem<string>);
      expect(removed).toEqual(['a']);
      expect(quickPick?.items).toEqual([items[1]]);

      quickPick?._hide();
      await pending;
    });

    it('maps active-item changes onto onDidSelectItem', async () => {
      const ui = createFakeQuickInput();
      const seen: string[] = [];
      const pending = pickOne(ui, items, {
        onDidSelectItem: (item) => seen.push(item.value),
      });

      ui.quickPicks[0]?._setActive([items[1] as PickItem<string>]);
      expect(seen).toEqual(['b']);

      ui.quickPicks[0]?._hide();
      await pending;
    });
  });

  describe('signal', () => {
    it('resolves undefined immediately for an already-aborted signal, creating no UI', async () => {
      const ui = createFakeQuickInput();
      const controller = new AbortController();
      controller.abort();

      await expect(pickOne(ui, items, { signal: controller.signal })).resolves.toBeUndefined();
      expect(ui.quickPicks).toHaveLength(0);
    });

    it('hides the picker when the signal aborts mid-flight', async () => {
      const ui = createFakeQuickInput();
      const controller = new AbortController();
      const pending = pickOne(ui, items, { signal: controller.signal });

      controller.abort();
      await expect(pending).resolves.toBeUndefined();
      expect(ui.quickPicks[0]?.disposed).toBe(true);
    });
  });
});

describe('inputText', () => {
  it('resolves the typed value on accept', async () => {
    const ui = createFakeQuickInput();
    const pending = inputText(ui, {
      prompt: 'Name?',
      placeHolder: 'e.g. Ada',
      value: 'seed',
      password: true,
      ignoreFocusOut: true,
    });

    const inputBox = ui.inputBoxes[0];
    expect(inputBox).toMatchObject({
      prompt: 'Name?',
      placeholder: 'e.g. Ada',
      value: 'seed',
      password: true,
      ignoreFocusOut: true,
      visible: true,
    });

    inputBox?._type('Ada');
    inputBox?._accept();
    await expect(pending).resolves.toBe('Ada');
    expect(inputBox?.disposed).toBe(true);
    expect(inputBox?.listenerCount).toBe(0);
  });

  it('resolves undefined on hide', async () => {
    const ui = createFakeQuickInput();
    const pending = inputText(ui, { prompt: 'Name?' });
    ui.inputBoxes[0]?._hide();
    await expect(pending).resolves.toBeUndefined();
  });

  it('debounces live validation and discards stale results', async () => {
    vi.useFakeTimers();
    const ui = createFakeQuickInput();
    const validated: string[] = [];
    const pending = inputText(ui, {
      prompt: 'Branch',
      validate: (value) => {
        validated.push(value);
        return value.includes(' ') ? 'No spaces' : undefined;
      },
    });
    const inputBox = ui.inputBoxes[0];

    inputBox?._type('a');
    inputBox?._type('a b');
    // Only the last value within the debounce window is validated.
    await vi.advanceTimersByTimeAsync(100);
    expect(validated).toEqual(['a b']);
    expect(inputBox?.validationMessage).toBe('No spaces');

    inputBox?._type('ab');
    await vi.advanceTimersByTimeAsync(100);
    expect(inputBox?.validationMessage).toBeUndefined();

    inputBox?._accept();
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toBe('ab');
  });

  it('blocks accept while the validator returns a message', async () => {
    const ui = createFakeQuickInput();
    const pending = inputText(ui, {
      prompt: 'Branch',
      validate: (value) => (value.length < 2 ? 'Too short' : undefined),
    });
    const inputBox = ui.inputBoxes[0];

    inputBox?._type('x');
    inputBox?._accept();
    await Promise.resolve();
    expect(inputBox?.validationMessage).toBe('Too short');
    expect(inputBox?.disposed).toBe(false);

    inputBox?._type('xy');
    inputBox?._accept();
    await expect(pending).resolves.toBe('xy');
  });

  it('propagates a validator failure instead of resolving undefined', async () => {
    const ui = createFakeQuickInput();
    const pending = inputText(ui, {
      prompt: 'Branch',
      validate: () => Promise.reject(new Error('lookup failed')),
    });

    ui.inputBoxes[0]?._accept();
    await expect(pending).rejects.toThrow('lookup failed');
    expect(ui.inputBoxes[0]?.disposed).toBe(true);
  });

  it('honours an abort signal', async () => {
    const ui = createFakeQuickInput();
    const controller = new AbortController();
    const pending = inputText(ui, { prompt: 'Name?', signal: controller.signal });

    controller.abort();
    await expect(pending).resolves.toBeUndefined();

    controller.abort();
    await expect(
      inputText(ui, { prompt: 'again', signal: controller.signal })
    ).resolves.toBeUndefined();
    expect(ui.inputBoxes).toHaveLength(1);
  });
});
