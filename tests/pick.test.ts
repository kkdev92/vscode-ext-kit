import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { pickOne, pickMany, toPickItem, toPickSeparator, type PickItem } from '../src/ui/pick.js';

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

      it('rejects if the items promise rejects', async () => {
        const failure = new Error('boom');
        const itemsPromise = Promise.reject(failure);

        const resultPromise = pickOne(itemsPromise);

        await expect(resultPromise).rejects.toBe(failure);
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
  });
});
