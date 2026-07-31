import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import {
  createMockExtensionContext as createMockExtensionContextWith,
  createMockTreeView as createMockTreeViewWith,
  TreeItemCollapsibleState,
  ThemeIcon,
} from '../../src/testing/index.js';
import {
  BaseTreeDataProvider,
  SimpleTreeDataProvider,
  createTreeView,
  createDragAndDropController,
  withPagination,
  LOAD_MORE_ID,
  type TreeItemData,
} from '../../src/views/treeview.js';

// Thin local re-binds so the rest of this file — written against the
// pre-testing-kit factories — doesn't need a `vi` argument at every call site.
const createMockExtensionContext = () => createMockExtensionContextWith(vi);
const createMockTreeView = <T = unknown>() => createMockTreeViewWith<T>(vi);

// Get the mocked window namespace so tests can override createTreeView's
// return value with a listener-capturing mock (needed for checkbox bridging).
const mockedWindow = vscode.window as unknown as {
  createTreeView: ReturnType<typeof vi.fn>;
};

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
      expect(roots[0]!.label).toBe('Item 1');
      expect(roots[1]!.label).toBe('Item 2');
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
      expect(children[0]!.label).toBe('Child 1');
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

    it('evicts cached descendants when refreshing an element', async () => {
      const provider = new TestProvider();
      const parent: TestItem = { id: '1', label: 'Parent' };
      const child: TestItem = { id: '1.1', label: 'Child' };
      provider.setRoots([parent]);
      provider.setChildren('1', [child]);
      provider.setChildren('1.1', [{ id: '1.1.1', label: 'Grandchild' }]);

      // Populate cache for both levels
      await provider.getChildren(parent);
      await provider.getChildren(child);

      provider.refresh(parent);

      // VS Code re-requests the whole subtree after the event fires; the
      // grandchildren must not be served from the stale cache.
      const getChildrenOfSpy = vi.spyOn(provider, 'getChildrenOf');
      await provider.getChildren(parent);
      await provider.getChildren(child);

      expect(getChildrenOfSpy).toHaveBeenCalledTimes(2);
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
      const resourceUri = vscode.Uri.file('/test/file.ts');
      const element: TestItem = {
        id: 'test',
        label: 'Test Item',
        description: 'Description',
        tooltip: 'Tooltip',
        iconPath: new ThemeIcon('file'),
        resourceUri,
        checkboxState: vscode.TreeItemCheckboxState.Checked,
        contextValue: 'testContext',
        collapsibleState: TreeItemCollapsibleState.Collapsed,
      };

      const treeItem = provider.getTreeItem(element);

      expect(treeItem.id).toBe('test');
      expect(treeItem.label).toBe('Test Item');
      expect(treeItem.description).toBe('Description');
      expect(treeItem.tooltip).toBe('Tooltip');
      expect(treeItem.resourceUri).toBe(resourceUri);
      expect(treeItem.checkboxState).toBe(vscode.TreeItemCheckboxState.Checked);
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

    it('fires onDidChangeCheckboxState via fireCheckboxChange', () => {
      const provider = new TestProvider();
      const listener = vi.fn();
      const item: TestItem = { id: '1', label: 'Item' };

      provider.onDidChangeCheckboxState(listener);
      provider.fireCheckboxChange([{ item, checked: true }]);

      expect(listener).toHaveBeenCalledWith([{ item, checked: true }]);
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
      expect(children[0]!.label).toBe('Child 1');
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

      expect(roots[0]!.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      expect(roots[1]!.collapsibleState).toBe(TreeItemCollapsibleState.None);
    });

    it('returns [] for getChildren after dispose', async () => {
      const provider = new SimpleTreeDataProvider<SimpleItem>([{ id: '1', label: 'Item' }]);

      provider.dispose();

      expect(await provider.getChildren()).toEqual([]);
    });

    it('sets items', async () => {
      const provider = new SimpleTreeDataProvider<SimpleItem>([]);

      provider.setItems([{ id: '1', label: 'New Item' }]);
      const roots = await provider.getChildren();

      expect(roots).toHaveLength(1);
      expect(roots[0]!.label).toBe('New Item');
    });

    it('refreshes the whole tree on setItems', () => {
      const provider = new SimpleTreeDataProvider<SimpleItem>([]);
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.setItems([{ id: '1', label: 'New Item' }]);

      expect(listener).toHaveBeenCalledWith(undefined);
    });

    describe('getParentOf / reveal support', () => {
      it('returns undefined for a root item', () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([{ id: '1', label: 'Root' }]);
        const root = provider.findItem('1')!;

        expect(provider.getParentOf(root)).toBeUndefined();
      });

      it('returns the parent for a nested item', () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([
          {
            id: '1',
            label: 'Parent',
            children: [{ id: '1.1', label: 'Child' }],
          },
        ]);
        const child = provider.findItem('1.1')!;
        const parent = provider.findItem('1')!;

        expect(provider.getParentOf(child)).toBe(parent);
      });

      it('resolves parents through the base getParent bridge (what TreeView.reveal relies on)', () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([
          {
            id: '1',
            label: 'Parent',
            children: [{ id: '1.1', label: 'Child' }],
          },
        ]);
        const child = provider.findItem('1.1')!;

        // BaseTreeDataProvider.getParent() delegates to getParentOf when present.
        // Before the fix, SimpleTreeDataProvider had no getParentOf at all, so
        // this returned undefined unconditionally and TreeView.reveal() would
        // throw ("no parent" is fatal for reveal in real VS Code).
        expect(provider.getParent(child)).toBeDefined();
        expect((provider.getParent(child) as SimpleItem).id).toBe('1');
      });

      it('returns undefined for a grandchild-to-root lookup that skips a level incorrectly (sanity)', () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([
          {
            id: '1',
            label: 'Parent',
            children: [
              { id: '1.1', label: 'Child', children: [{ id: '1.1.1', label: 'Grandchild' }] },
            ],
          },
        ]);
        const grandchild = provider.findItem('1.1.1')!;
        const child = provider.findItem('1.1')!;

        expect(provider.getParentOf(grandchild)).toBe(child);
      });
    });

    describe('addItem', () => {
      it('adds a root item and refreshes the whole tree', async () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([{ id: '1', label: 'Item 1' }]);
        const listener = vi.fn();
        provider.onDidChangeTreeData(listener);

        const ok = provider.addItem({ id: '2', label: 'Item 2' });
        const roots = await provider.getChildren();

        expect(ok).toBe(true);
        expect(roots).toHaveLength(2);
        expect(listener).toHaveBeenCalledWith(undefined);
      });

      it('adds a nested item under an existing parent and refreshes only that parent', async () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([{ id: '1', label: 'Parent' }]);
        const listener = vi.fn();
        provider.onDidChangeTreeData(listener);

        const ok = provider.addItem({ id: '1.1', label: 'Child' }, '1');
        const parent = provider.findItem('1')!;
        const children = await provider.getChildren(parent);

        expect(ok).toBe(true);
        expect(children).toHaveLength(1);
        expect(children[0]!.label).toBe('Child');
        expect(listener).toHaveBeenCalledWith(parent);
        // Parent must flip from a leaf to collapsible now that it has a child.
        expect(parent.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
      });

      it('returns false for an unknown parentId and does not modify the tree', () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([{ id: '1', label: 'Item' }]);

        const ok = provider.addItem({ id: '2', label: 'Orphan' }, 'nonexistent');

        expect(ok).toBe(false);
        expect(provider.findItem('2')).toBeUndefined();
      });

      it('indexes items added with inline nested children', () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([]);

        provider.addItem({
          id: 'a',
          label: 'A',
          children: [{ id: 'a.1', label: 'A.1' }],
        });

        expect(provider.findItem('a.1')).toBeDefined();
        expect(provider.getParentOf(provider.findItem('a.1')!)?.id).toBe('a');
      });
    });

    describe('setChildren', () => {
      it('replaces a parent’s children wholesale and refreshes just that parent', async () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([
          { id: '1', label: 'Parent', children: [{ id: '1.1', label: 'Old' }] },
        ]);
        const listener = vi.fn();
        provider.onDidChangeTreeData(listener);

        const ok = provider.setChildren('1', [{ id: '1.2', label: 'New' }]);
        const parent = provider.findItem('1')!;
        const children = await provider.getChildren(parent);

        expect(ok).toBe(true);
        expect(children.map((c) => c.id)).toEqual(['1.2']);
        expect(provider.findItem('1.1')).toBeUndefined(); // de-indexed
        expect(listener).toHaveBeenCalledWith(parent);
      });

      it('replaces the roots when parentId is undefined', async () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([{ id: '1', label: 'Old root' }]);

        const ok = provider.setChildren(undefined, [{ id: '2', label: 'New root' }]);
        const roots = await provider.getChildren();

        expect(ok).toBe(true);
        expect(roots.map((r) => r.id)).toEqual(['2']);
      });

      it('sets the parent back to a leaf when replaced with an empty array', () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([
          { id: '1', label: 'Parent', children: [{ id: '1.1', label: 'Child' }] },
        ]);

        provider.setChildren('1', []);

        expect(provider.findItem('1')!.collapsibleState).toBe(TreeItemCollapsibleState.None);
      });

      it('returns false for an unknown parentId', () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([]);

        expect(provider.setChildren('nonexistent', [{ id: 'x', label: 'X' }])).toBe(false);
      });
    });

    describe('updateItem', () => {
      it('merges the patch into the existing item and refreshes it', () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([{ id: '1', label: 'Old label' }]);
        const listener = vi.fn();
        provider.onDidChangeTreeData(listener);

        const ok = provider.updateItem('1', { label: 'New label', description: 'desc' });
        const item = provider.findItem('1')!;

        expect(ok).toBe(true);
        expect(item.label).toBe('New label');
        expect(item.description).toBe('desc');
        expect(listener).toHaveBeenCalledWith(item);
      });

      it('does not touch children or position', async () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([
          { id: '1', label: 'Parent', children: [{ id: '1.1', label: 'Child' }] },
        ]);

        provider.updateItem('1', { label: 'Renamed' });
        const parent = provider.findItem('1')!;
        const children = await provider.getChildren(parent);

        expect(children).toHaveLength(1);
        expect(children[0]!.id).toBe('1.1');
      });

      it('returns false for an unknown id', () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([]);

        expect(provider.updateItem('nonexistent', { label: 'X' })).toBe(false);
      });

      it('updates checkboxState', () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([{ id: '1', label: 'Item' }]);

        provider.updateItem('1', { checkboxState: vscode.TreeItemCheckboxState.Checked });

        expect(provider.findItem('1')!.checkboxState).toBe(vscode.TreeItemCheckboxState.Checked);
      });
    });

    describe('removeItem', () => {
      it('removes a root item', async () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([
          { id: '1', label: 'Item 1' },
          { id: '2', label: 'Item 2' },
        ]);

        const ok = provider.removeItem('1');
        const roots = await provider.getChildren();

        expect(ok).toBe(true);
        expect(roots).toHaveLength(1);
        expect(roots[0]!.id).toBe('2');
      });

      it('removes a deeply nested item (regression: used to be silently ignored)', async () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([
          {
            id: '1',
            label: 'Parent',
            children: [
              { id: '1.1', label: 'Child 1', children: [{ id: '1.1.1', label: 'Grandchild' }] },
              { id: '1.2', label: 'Child 2' },
            ],
          },
        ]);

        const ok = provider.removeItem('1.1.1');

        expect(ok).toBe(true);
        expect(provider.findItem('1.1.1')).toBeUndefined();
        const child1 = provider.findItem('1.1')!;
        expect(await provider.getChildren(child1)).toHaveLength(0);
        // Siblings at every level must be untouched.
        expect(provider.findItem('1.2')).toBeDefined();
      });

      it('de-indexes an entire removed subtree, not just its own id', () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([
          {
            id: '1',
            label: 'Parent',
            children: [
              { id: '1.1', label: 'Child', children: [{ id: '1.1.1', label: 'Grandchild' }] },
            ],
          },
        ]);

        provider.removeItem('1.1');

        expect(provider.findItem('1.1')).toBeUndefined();
        expect(provider.findItem('1.1.1')).toBeUndefined();
      });

      it('refreshes only the former parent, not the whole tree', () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([
          { id: '1', label: 'Parent', children: [{ id: '1.1', label: 'Child' }] },
        ]);
        const listener = vi.fn();
        provider.onDidChangeTreeData(listener);

        provider.removeItem('1.1');

        expect(listener).toHaveBeenCalledWith(provider.findItem('1'));
        expect(listener).not.toHaveBeenCalledWith(undefined);
      });

      it('flips the former parent back to a leaf once its last child is removed', () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([
          { id: '1', label: 'Parent', children: [{ id: '1.1', label: 'Only child' }] },
        ]);

        provider.removeItem('1.1');

        expect(provider.findItem('1')!.collapsibleState).toBe(TreeItemCollapsibleState.None);
      });

      it('returns false and does nothing for an unknown id', () => {
        const provider = new SimpleTreeDataProvider<SimpleItem>([{ id: '1', label: 'Item' }]);

        expect(provider.removeItem('nonexistent')).toBe(false);
        expect(provider.findItem('1')).toBeDefined();
      });
    });

    it('finds an item by id anywhere in the tree', () => {
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
  // withPagination
  // ============================================

  describe('withPagination', () => {
    type Item = TreeItemData;

    it('returns items unchanged when within the page size', () => {
      const items: Item[] = [
        { id: '1', label: 'A' },
        { id: '2', label: 'B' },
      ];

      expect(withPagination(items, 5)).toEqual(items);
    });

    it('caps the list and appends a load-more placeholder when over the page size', () => {
      const items: Item[] = Array.from({ length: 5 }, (_, i) => ({
        id: String(i),
        label: String(i),
      }));

      const paged = withPagination(items, 3);

      expect(paged).toHaveLength(4);
      expect(paged.slice(0, 3)).toEqual(items.slice(0, 3));
      expect(paged[3]!.id).toBe(LOAD_MORE_ID);
    });

    it('uses a custom load-more label', () => {
      const items: Item[] = Array.from({ length: 3 }, (_, i) => ({
        id: String(i),
        label: String(i),
      }));

      const paged = withPagination(items, 1, 'More…');

      expect(paged[1]!.label).toBe('More…');
    });
  });

  // ============================================
  // createDragAndDropController
  // ============================================

  describe('createDragAndDropController', () => {
    type Item = TreeItemData;

    it('exposes the configured mime type as both drag and drop types', () => {
      const controller = createDragAndDropController<Item>({
        mimeType: 'application/vnd.code.tree.test',
        onDrop: vi.fn(),
      });

      expect(controller.dropMimeTypes).toEqual(['application/vnd.code.tree.test']);
      expect(controller.dragMimeTypes).toEqual(['application/vnd.code.tree.test']);
    });

    it('round-trips dragged item ids through handleDrag/handleDrop', async () => {
      const onDrop = vi.fn();
      const mimeType = 'application/vnd.code.tree.test';
      const controller = createDragAndDropController<Item>({ mimeType, onDrop });
      const source: Item[] = [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ];
      const dataTransfer = new vscode.DataTransfer();

      controller.handleDrag?.(source, dataTransfer, {} as never);
      await controller.handleDrop?.({ id: 'target', label: 'Target' }, dataTransfer, {} as never);

      expect(onDrop).toHaveBeenCalledWith(['a', 'b'], { id: 'target', label: 'Target' });
    });

    it('does nothing when the drop has no matching mime type entry', async () => {
      const onDrop = vi.fn();
      const controller = createDragAndDropController<Item>({
        mimeType: 'application/vnd.code.tree.test',
        onDrop,
      });
      const dataTransfer = new vscode.DataTransfer();

      await controller.handleDrop?.(undefined, dataTransfer, {} as never);

      expect(onDrop).not.toHaveBeenCalled();
    });

    it('reports target as undefined when dropped on the root', async () => {
      const onDrop = vi.fn();
      const mimeType = 'application/vnd.code.tree.test';
      const controller = createDragAndDropController<Item>({ mimeType, onDrop });
      const dataTransfer = new vscode.DataTransfer();
      dataTransfer.set(mimeType, new vscode.DataTransferItem(JSON.stringify(['a'])));

      await controller.handleDrop?.(undefined, dataTransfer, {} as never);

      expect(onDrop).toHaveBeenCalledWith(['a'], undefined);
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

    it('supports setting a badge on the returned native TreeView', () => {
      const context = createMockExtensionContext();
      const provider = new SimpleTreeDataProvider([]);

      const treeView = createTreeView(context as never, 'test.view', provider);
      treeView.badge = { value: 3, tooltip: '3 pending' };

      expect(treeView.badge).toEqual({ value: 3, tooltip: '3 pending' });
    });

    it('bridges native checkbox toggles to BaseTreeDataProvider.onDidChangeCheckboxState', () => {
      const context = createMockExtensionContext();
      const provider = new SimpleTreeDataProvider([{ id: '1', label: 'Item' }]);
      const mockTreeView = createMockTreeView();
      mockedWindow.createTreeView.mockReturnValue(mockTreeView);

      const listener = vi.fn();
      provider.onDidChangeCheckboxState(listener);
      createTreeView(context as never, 'test.view', provider);

      const item = provider.findItem('1')!;
      mockTreeView._fireCheckboxState([[item, vscode.TreeItemCheckboxState.Checked]]);

      expect(listener).toHaveBeenCalledWith([{ item, checked: true }]);
    });

    it('reports unchecked as checked: false through the checkbox bridge', () => {
      const context = createMockExtensionContext();
      const provider = new SimpleTreeDataProvider([{ id: '1', label: 'Item' }]);
      const mockTreeView = createMockTreeView();
      mockedWindow.createTreeView.mockReturnValue(mockTreeView);

      const listener = vi.fn();
      provider.onDidChangeCheckboxState(listener);
      createTreeView(context as never, 'test.view', provider);

      const item = provider.findItem('1')!;
      mockTreeView._fireCheckboxState([[item, vscode.TreeItemCheckboxState.Unchecked]]);

      expect(listener).toHaveBeenCalledWith([{ item, checked: false }]);
    });

    it('does not bridge checkbox events for a plain (non-Base) TreeDataProvider', () => {
      const context = createMockExtensionContext();
      const mockTreeView = createMockTreeView();
      mockedWindow.createTreeView.mockReturnValue(mockTreeView);
      const plainProvider: vscode.TreeDataProvider<TreeItemData> = {
        getChildren: () => [],
        getTreeItem: (element) => new vscode.TreeItem(element.label),
      };

      // Must not throw even though there's no fireCheckboxChange to call.
      expect(() => createTreeView(context as never, 'test.view', plainProvider)).not.toThrow();
      expect(() =>
        mockTreeView._fireCheckboxState([[{ id: '1', label: 'x' } as TreeItemData, 1]])
      ).not.toThrow();
    });
  });
});
