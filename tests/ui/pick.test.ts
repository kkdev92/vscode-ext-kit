import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import {
  pickOne,
  pickMany,
  toPickItem,
  toPickSeparator,
  toPickButton,
  type PickItem,
} from '../../src/ui/pick.js';

type MockQuickPick<T extends vscode.QuickPickItem> = vscode.QuickPick<T> & {
  _accept: (selection?: T[]) => void;
  _hide: () => void;
  _triggerButton: (button: unknown) => void;
};

function latestQuickPick<T extends vscode.QuickPickItem>(): MockQuickPick<T> {
  const calls = vi.mocked(vscode.window.createQuickPick).mock.results;
  const last = calls[calls.length - 1];
  if (!last) throw new Error('createQuickPick was not called');
  return last.value as MockQuickPick<T>;
}

describe('pick', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('toPickItem', () => {
    it('builds a QuickPickItem carrying the value', () => {
      const item = toPickItem(42, { label: 'Answer', description: 'desc', detail: 'det' });
      expect(item).toMatchObject({
        value: 42,
        label: 'Answer',
        description: 'desc',
        detail: 'det',
      });
    });

    it('converts a string icon name to a ThemeIcon', () => {
      const item = toPickItem('x', { label: 'X', icon: 'file' });
      expect(item.iconPath).toBeInstanceOf(vscode.ThemeIcon);
      expect((item.iconPath as vscode.ThemeIcon).id).toBe('file');
    });

    it('passes an explicit ThemeIcon through unchanged', () => {
      const icon = new vscode.ThemeIcon('bug');
      const item = toPickItem('x', { label: 'X', icon });
      expect(item.iconPath).toBe(icon);
    });

    it('leaves iconPath undefined when no icon is given', () => {
      const item = toPickItem('x', { label: 'X' });
      expect(item.iconPath).toBeUndefined();
    });

    it('carries picked/alwaysShow/buttons/resourceUri through', () => {
      const uri = vscode.Uri.file('/a/b.ts');
      const button: vscode.QuickInputButton = { iconPath: new vscode.ThemeIcon('eye') };
      const item = toPickItem('x', {
        label: 'X',
        picked: true,
        alwaysShow: true,
        buttons: [button],
        resourceUri: uri,
      });
      expect(item.picked).toBe(true);
      expect(item.alwaysShow).toBe(true);
      expect(item.buttons).toEqual([button]);
      expect(item.resourceUri).toBe(uri);
    });
  });

  describe('toPickSeparator', () => {
    it('creates a non-selectable separator item', () => {
      const sep = toPickSeparator('Group');
      expect(sep).toEqual({ label: 'Group', kind: vscode.QuickPickItemKind.Separator });
    });

    it('defaults to an empty label', () => {
      expect(toPickSeparator().label).toBe('');
    });
  });

  describe('toPickButton', () => {
    it('converts a string icon name to a ThemeIcon', () => {
      const button = toPickButton('refresh', { tooltip: 'Reload' });

      expect(button.iconPath).toBeInstanceOf(vscode.ThemeIcon);
      expect((button.iconPath as vscode.ThemeIcon).id).toBe('refresh');
      expect(button.tooltip).toBe('Reload');
    });

    it('passes an explicit icon path through unchanged', () => {
      const icon = new vscode.ThemeIcon('eye');
      expect(toPickButton(icon).iconPath).toBe(icon);
    });

    it('carries the render location through', () => {
      const button = toPickButton('eye', {
        location: vscode.QuickInputButtonLocation.Input,
      });

      expect(button.location).toBe(vscode.QuickInputButtonLocation.Input);
    });

    it('omits toggle entirely for a non-toggle button', () => {
      const button = toPickButton('refresh');

      expect(button.toggle).toBeUndefined();
      expect('toggle' in button).toBe(false);
    });

    it('creates a toggle for toggled: false, not just toggled: true', () => {
      // `toggle`'s presence is what makes a button a toggle, so an initially
      // unchecked toggle must still get the object.
      const off = toPickButton('eye', { toggled: false });
      const on = toPickButton('eye', { toggled: true });

      expect(off.toggle).toEqual({ checked: false });
      expect(on.toggle).toEqual({ checked: true });
    });

    it('exposes a mutable checked flag, matching how VS Code flips it in place', () => {
      const button = toPickButton('eye', { toggled: false });

      // VS Code mutates `checked` on the extension's own object before firing
      // the trigger event; callers read it back off the same button.
      button.toggle!.checked = true;

      expect(button.toggle?.checked).toBe(true);
    });
  });

  describe('pickOne', () => {
    it('delegates to showQuickPick with canPickMany: false for plain array items', async () => {
      const items = [toPickItem(1, { label: 'One' }), toPickItem(2, { label: 'Two' })];

      await pickOne(items);

      expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
        items,
        expect.objectContaining({ canPickMany: false })
      );
      expect(vscode.window.createQuickPick).not.toHaveBeenCalled();
    });

    it('returns the selected item', async () => {
      const items = [toPickItem(1, { label: 'One' })];
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(items[0]);

      const result = await pickOne(items);

      expect(result).toBe(items[0]);
    });

    it('returns undefined when cancelled', async () => {
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

      const result = await pickOne([toPickItem(1, { label: 'One' })]);

      expect(result).toBeUndefined();
    });

    it('passes options through to showQuickPick', async () => {
      const items = [toPickItem(1, { label: 'One' })];

      await pickOne(items, { placeHolder: 'Pick one', title: 'T' });

      expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
        items,
        expect.objectContaining({ placeHolder: 'Pick one', title: 'T', canPickMany: false })
      );
    });

    describe('with Thenable items', () => {
      it('opens immediately with busy: true, then populates once items resolve', async () => {
        let resolveItems!: (items: PickItem<number>[]) => void;
        const itemsPromise = new Promise<PickItem<number>[]>((resolve) => {
          resolveItems = resolve;
        });

        const resultPromise = pickOne(itemsPromise, { placeHolder: 'Loading...' });

        const quickPick = latestQuickPick<PickItem<number>>();
        expect(quickPick.busy).toBe(true);
        expect(quickPick.show).toHaveBeenCalled();
        expect(quickPick.placeholder).toBe('Loading...');

        const resolvedItems = [toPickItem(1, { label: 'One' })];
        resolveItems(resolvedItems);
        await Promise.resolve();
        await Promise.resolve();

        expect(quickPick.items).toEqual(resolvedItems);
        expect(quickPick.busy).toBe(false);

        quickPick._accept([resolvedItems[0] as PickItem<number>]);
        await expect(resultPromise).resolves.toBe(resolvedItems[0]);
      });

      it('resolves undefined when hidden before accepting', async () => {
        const itemsPromise = Promise.resolve([toPickItem(1, { label: 'One' })]);

        const resultPromise = pickOne(itemsPromise);
        const quickPick = latestQuickPick<PickItem<number>>();

        quickPick._hide();

        await expect(resultPromise).resolves.toBeUndefined();
        expect(quickPick.dispose).toHaveBeenCalled();
      });

      it('rejects if the items promise rejects, even though tearing down fires onDidHide', async () => {
        // Regression guard: disposing a *visible* quick pick makes VS Code fire
        // `onDidHide`, whose handler resolves with `undefined`. Without a
        // settled-guard that hide wins the race and the rejection is silently
        // swallowed — the caller sees a plain cancellation instead of the error.
        const failure = new Error('boom');
        const itemsPromise = Promise.reject(failure);

        const resultPromise = pickOne(itemsPromise);
        const quickPick = latestQuickPick<PickItem<number>>();

        await expect(resultPromise).rejects.toBe(failure);
        expect(quickPick.dispose).toHaveBeenCalled();
      });
    });

    describe('with a prompt', () => {
      it('routes a plain array through createQuickPick, since showQuickPick has no prompt', async () => {
        const items = [toPickItem(1, { label: 'One' })];

        const resultPromise = pickOne(items, { prompt: 'Cannot be undone.' });

        expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
        const quickPick = latestQuickPick<PickItem<number>>();
        expect(quickPick.prompt).toBe('Cannot be undone.');

        quickPick._accept([items[0] as PickItem<number>]);
        await expect(resultPromise).resolves.toBe(items[0]);
      });

      it('assigns a synchronous list before show() and never raises busy', async () => {
        const items = [toPickItem(1, { label: 'One' })];

        const resultPromise = pickOne(items, { prompt: 'Pick' });
        const quickPick = latestQuickPick<PickItem<number>>();

        expect(quickPick.busy).toBe(false);
        expect(quickPick.items).toEqual(items);
        expect(quickPick.show).toHaveBeenCalled();

        quickPick._hide();
        await expect(resultPromise).resolves.toBeUndefined();
      });

      it('still uses showQuickPick when no prompt is given', async () => {
        await pickOne([toPickItem(1, { label: 'One' })], { placeHolder: 'p' });

        expect(vscode.window.showQuickPick).toHaveBeenCalled();
        expect(vscode.window.createQuickPick).not.toHaveBeenCalled();
      });
    });
  });

  describe('pickMany', () => {
    it('delegates to showQuickPick with canPickMany: true for plain array items', async () => {
      const items = [toPickItem(1, { label: 'One' }), toPickItem(2, { label: 'Two' })];

      await pickMany(items);

      expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
        items,
        expect.objectContaining({ canPickMany: true })
      );
    });

    it('returns an array of selected items', async () => {
      const items = [toPickItem(1, { label: 'One' }), toPickItem(2, { label: 'Two' })];
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(items as never);

      const result = await pickMany(items);

      expect(result).toEqual(items);
    });

    it('returns undefined when cancelled', async () => {
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

      const result = await pickMany([toPickItem(1, { label: 'One' })]);

      expect(result).toBeUndefined();
    });

    describe('with Thenable items', () => {
      it('selects multiple items via the busy QuickPick', async () => {
        const items = [toPickItem(1, { label: 'One' }), toPickItem(2, { label: 'Two' })];
        const itemsPromise = Promise.resolve(items);

        const resultPromise = pickMany(itemsPromise);
        const quickPick = latestQuickPick<PickItem<number>>();
        expect(quickPick.canSelectMany).toBe(true);

        await Promise.resolve();
        await Promise.resolve();

        quickPick._accept(items);
        await expect(resultPromise).resolves.toEqual(items);
      });
    });

    it('routes through createQuickPick with canSelectMany when a prompt is given', async () => {
      const items = [toPickItem(1, { label: 'One' }), toPickItem(2, { label: 'Two' })];

      const resultPromise = pickMany(items, { prompt: 'Choose any' });

      expect(vscode.window.showQuickPick).not.toHaveBeenCalled();
      const quickPick = latestQuickPick<PickItem<number>>();
      expect(quickPick.prompt).toBe('Choose any');
      expect(quickPick.canSelectMany).toBe(true);
      expect(quickPick.items).toEqual(items);

      quickPick._accept(items);
      await expect(resultPromise).resolves.toEqual(items);
    });
  });
});
