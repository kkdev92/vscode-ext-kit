import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createMockExtensionContext,
  TreeItemCollapsibleState,
  ThemeIcon,
} from './mocks/vscode.js';
import {
  BaseTreeDataProvider,
  SimpleTreeDataProvider,
  createTreeView,
  type TreeItemData,
} from '../src/treeview.js';

describe('treeview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ============================================
  // BaseTreeDataProvider
  // ============================================

  describe('BaseTreeDataProvider', () => {
    type TestItem = TreeItemData<{ value: number }>;

    class TestProvider extends BaseTreeDataProvider<TestItem> {
      private roots: TestItem[] = [];
      private childrenMap = new Map<string, TestItem[]>();

      setRoots(items: TestItem[]): void {
        this.roots = items;
      }

      setChildren(parentId: string, children: TestItem[]): void {
        this.childrenMap.set(parentId, children);
      }

      getRoots(): TestItem[] {
        return this.roots;
      }

      getChildrenOf(element: TestItem): TestItem[] {
        return this.childrenMap.get(element.id) || [];
      }
    }

    it('provides root elements', async () => {
      const provider = new TestProvider();
      provider.setRoots([
        { id: '1', label: 'Item 1' },
        { id: '2', label: 'Item 2' },
      ]);

      const roots = await provider.getChildren();

      expect(roots).toHaveLength(2);
      expect(roots[0].label).toBe('Item 1');
      expect(roots[1].label).toBe('Item 2');
    });

    it('provides child elements', async () => {
      const provider = new TestProvider();
      const parent: TestItem = { id: '1', label: 'Parent' };
      provider.setRoots([parent]);
      provider.setChildren('1', [
        { id: '1.1', label: 'Child 1' },
        { id: '1.2', label: 'Child 2' },
      ]);

      const children = await provider.getChildren(parent);

      expect(children).toHaveLength(2);
      expect(children[0].label).toBe('Child 1');
    });

    it('caches children', async () => {
      const provider = new TestProvider();
      const parent: TestItem = { id: '1', label: 'Parent' };
      provider.setRoots([parent]);
      provider.setChildren('1', [{ id: '1.1', label: 'Child' }]);

      const getChildrenOfSpy = vi.spyOn(provider, 'getChildrenOf');

      await provider.getChildren(parent);
      await provider.getChildren(parent);

      expect(getChildrenOfSpy).toHaveBeenCalledTimes(1);
    });

    it('refreshes and clears cache', async () => {
      const provider = new TestProvider();
      const parent: TestItem = { id: '1', label: 'Parent' };
      provider.setRoots([parent]);
      provider.setChildren('1', [{ id: '1.1', label: 'Child' }]);

      await provider.getChildren(parent);
      provider.refresh(parent);

      const getChildrenOfSpy = vi.spyOn(provider, 'getChildrenOf');
      await provider.getChildren(parent);

      expect(getChildrenOfSpy).toHaveBeenCalledTimes(1);
    });

    it('refreshes entire tree', async () => {
      const provider = new TestProvider();
      const item1: TestItem = { id: '1', label: 'Item 1' };
      const item2: TestItem = { id: '2', label: 'Item 2' };
      provider.setRoots([item1, item2]);
      provider.setChildren('1', [{ id: '1.1', label: 'Child 1' }]);
      provider.setChildren('2', [{ id: '2.1', label: 'Child 2' }]);

      await provider.getChildren(item1);
      await provider.getChildren(item2);

      provider.refresh();

      const getChildrenOfSpy = vi.spyOn(provider, 'getChildrenOf');
      await provider.getChildren(item1);
      await provider.getChildren(item2);

      expect(getChildrenOfSpy).toHaveBeenCalledTimes(2);
    });

    it('clears cache', () => {
      const provider = new TestProvider();
      const parent: TestItem = { id: '1', label: 'Parent' };
      provider.setRoots([parent]);
      provider.setChildren('1', [{ id: '1.1', label: 'Child' }]);

      provider.clearCache();

      // No assertion needed, just checking it doesn't throw
    });

    it('fires onDidChangeTreeData event', () => {
      const provider = new TestProvider();
      const listener = vi.fn();

      provider.onDidChangeTreeData(listener);
      provider.refresh();

      expect(listener).toHaveBeenCalledWith(undefined);
    });

    it('fires onDidChangeTreeData with specific element', () => {
      const provider = new TestProvider();
      const listener = vi.fn();
      const item: TestItem = { id: '1', label: 'Item' };

      provider.onDidChangeTreeData(listener);
      provider.refresh(item);

      expect(listener).toHaveBeenCalledWith(item);
    });

    it('creates TreeItem from element', () => {
      const provider = new TestProvider();
      const element: TestItem = {
        id: 'test',
        label: 'Test Item',
        description: 'Description',
        tooltip: 'Tooltip',
        iconPath: new ThemeIcon('file'),
        contextValue: 'testContext',
        collapsibleState: TreeItemCollapsibleState.Collapsed,
      };

      const treeItem = provider.getTreeItem(element);

      expect(treeItem.id).toBe('test');
      expect(treeItem.label).toBe('Test Item');
      expect(treeItem.description).toBe('Description');
      expect(treeItem.tooltip).toBe('Tooltip');
      expect(treeItem.contextValue).toBe('testContext');
      expect(treeItem.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
    });

    it('disposes properly', async () => {
      const provider = new TestProvider();
      provider.setRoots([{ id: '1', label: 'Item' }]);

      provider.dispose();

      const children = await provider.getChildren();
      expect(children).toEqual([]);
    });

    it('returns undefined for getParent by default', () => {
      const provider = new TestProvider();
      const item: TestItem = { id: '1', label: 'Item' };

      expect(provider.getParent(item)).toBeUndefined();
    });
  });

  // ============================================
  // SimpleTreeDataProvider
  // ============================================

  describe('SimpleTreeDataProvider', () => {
    interface SimpleItem extends TreeItemData {
      children?: SimpleItem[];
    }

    it('provides static items', async () => {
      const provider = new SimpleTreeDataProvider<SimpleItem>([
        { id: '1', label: 'Item 1' },
        { id: '2', label: 'Item 2' },
      ]);

      const roots = await provider.getChildren();

      expect(roots).toHaveLength(2);
    });

    it('provides children', async () => {
      const provider = new SimpleTreeDataProvider<SimpleItem>([
        {
          id: '1',
          label: 'Parent',
          children: [
            { id: '1.1', label: 'Child 1' },
            { id: '1.2', label: 'Child 2' },
          ],
        },
      ]);

      const roots = await provider.getChildren();
      const children = await provider.getChildren(roots[0]);

      expect(children).toHaveLength(2);
      expect(children[0].label).toBe('Child 1');
    });

    it('sets collapsible state for items with children', async () => {
      const provider = new SimpleTreeDataProvider<SimpleItem>([
        {
          id: '1',
          label: 'Parent',
          children: [{ id: '1.1', label: 'Child' }],
        },
        { id: '2', label: 'Leaf' },
      ]);

      const roots = await provider.getChildren();

      expect(roots[0].collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect(roots[1].collapsibleState).toBe(TreeItemCollapsibleState.None);
    });

    it('sets items', async () => {
      const provider = new SimpleTreeDataProvider<SimpleItem>([]);

      provider.setItems([{ id: '1', label: 'New Item' }]);
      const roots = await provider.getChildren();

      expect(roots).toHaveLength(1);
      expect(roots[0].label).toBe('New Item');
    });

    it('adds item', async () => {
      const provider = new SimpleTreeDataProvider<SimpleItem>([{ id: '1', label: 'Item 1' }]);

      provider.addItem({ id: '2', label: 'Item 2' });
      const roots = await provider.getChildren();

      expect(roots).toHaveLength(2);
    });

    it('removes item', async () => {
      const provider = new SimpleTreeDataProvider<SimpleItem>([
        { id: '1', label: 'Item 1' },
        { id: '2', label: 'Item 2' },
      ]);

      provider.removeItem('1');
      const roots = await provider.getChildren();

      expect(roots).toHaveLength(1);
      expect(roots[0].id).toBe('2');
    });

    it('finds item by id', () => {
      const provider = new SimpleTreeDataProvider<SimpleItem>([
        {
          id: '1',
          label: 'Parent',
          children: [{ id: '1.1', label: 'Child' }],
        },
      ]);

      const item = provider.findItem('1.1');

      expect(item).toBeDefined();
      expect(item?.label).toBe('Child');
    });

    it('returns undefined for non-existent item', () => {
      const provider = new SimpleTreeDataProvider<SimpleItem>([]);

      const item = provider.findItem('nonexistent');

      expect(item).toBeUndefined();
    });

    it('returns empty array for item without children', async () => {
      const provider = new SimpleTreeDataProvider<SimpleItem>([{ id: '1', label: 'Leaf' }]);

      const roots = await provider.getChildren();
      const children = await provider.getChildren(roots[0]);

      expect(children).toEqual([]);
    });
  });

  // ============================================
  // createTreeView
  // ============================================

  describe('createTreeView', () => {
    it('creates tree view with provider', () => {
      const context = createMockExtensionContext();
      const provider = new SimpleTreeDataProvider([]);

      const treeView = createTreeView(context as never, 'test.view', provider);

      expect(treeView).toBeDefined();
    });

    it('passes options to tree view', () => {
      const context = createMockExtensionContext();
      const provider = new SimpleTreeDataProvider([]);

      const treeView = createTreeView(context as never, 'test.view', provider, {
        showCollapseAll: true,
        canSelectMany: true,
      });

      expect(treeView).toBeDefined();
    });

    it('adds tree view to subscriptions', () => {
      const context = createMockExtensionContext();
      const provider = new SimpleTreeDataProvider([]);

      createTreeView(context as never, 'test.view', provider);

      expect(context.subscriptions.length).toBeGreaterThanOrEqual(1);
    });

    it('adds disposable provider to subscriptions', () => {
      const context = createMockExtensionContext();
      const provider = new SimpleTreeDataProvider([]);

      createTreeView(context as never, 'test.view', provider);

      expect(context.subscriptions.some((s) => s === provider)).toBe(true);
    });
  });
});
