/**
 * Pure provider-state unit suite for tree caching, indexing, mutation,
 * collapsible state, parent lookup, and pagination. It intentionally avoids a
 * `vscode` runtime; adapter event translation and application ownership are
 * separate contracts. Failures point to provider invariants or refresh scope.
 */
import { describe, expect, it } from 'vitest';

import {
  BaseTreeDataProvider,
  LOAD_MORE_ID,
  SimpleTreeDataProvider,
  withPagination,
} from '../../../src/capabilities/views/tree.js';
import type { TreeItemData } from '../../../src/capabilities/views/tree.js';
import { TreeItemCollapsible } from '../../../src/foundation/platform/ports.js';

type Item = TreeItemData & { children?: Item[] };
const item = (id: string, children?: Item[]): Item => ({
  id,
  label: id,
  ...(children === undefined ? {} : { children }),
});

describe('BaseTreeDataProvider', () => {
  class CountingProvider extends BaseTreeDataProvider<TreeItemData> {
    calls: string[] = [];
    getRoots(): TreeItemData[] {
      return [{ id: 'root', label: 'root' }];
    }
    getChildrenOf(element: TreeItemData): TreeItemData[] {
      this.calls.push(element.id);
      const childId = `${element.id}.child`;
      return element.id.length > 12 ? [] : [{ id: childId, label: childId }];
    }
  }

  it('caches children per element and serves the cache on re-query', async () => {
    const provider = new CountingProvider();
    const root = { id: 'root', label: 'root' };

    await provider.getChildren(root);
    await provider.getChildren(root);
    expect(provider.calls).toEqual(['root']);
  });

  it('evicts the whole cached subtree on a scoped refresh', async () => {
    const provider = new CountingProvider();
    const root = { id: 'root', label: 'root' };
    const [child] = await provider.getChildren(root);
    await provider.getChildren(child);
    provider.calls.length = 0;

    provider.refresh(root);
    await provider.getChildren(root);
    await provider.getChildren(child);
    // Both levels were re-fetched: the grandchild cache did not survive.
    expect(provider.calls).toEqual(['root', 'root.child']);
  });

  /**
   * A refresh while a load is in flight is ordinary — a watcher fires while the
   * user is expanding a node. If the load then cached what it had already
   * fetched, the platform's next query would be served pre-refresh children
   * from a cache that had just been cleared, which is exactly what the refresh
   * was for.
   */
  it('does not let a load that started before a refresh repopulate the cache', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    class SlowProvider extends BaseTreeDataProvider<TreeItemData> {
      calls = 0;
      generation = 'before';
      getRoots(): TreeItemData[] {
        return [{ id: 'root', label: 'root' }];
      }
      async getChildrenOf(): Promise<TreeItemData[]> {
        this.calls += 1;
        const label = this.generation;
        await gate;
        return [{ id: 'child', label }];
      }
    }

    const provider = new SlowProvider();
    const root = { id: 'root', label: 'root' };

    const inFlight = provider.getChildren(root);
    provider.refresh();
    provider.generation = 'after';
    release();

    // The in-flight query still gets an answer — it is the best one available
    // for the question that was asked.
    await expect(inFlight).resolves.toEqual([{ id: 'child', label: 'before' }]);

    // But the next query goes back to the source rather than being handed the
    // superseded copy.
    await expect(provider.getChildren(root)).resolves.toEqual([{ id: 'child', label: 'after' }]);
    expect(provider.calls).toBe(2);
  });

  it('maps item data onto the TreeItem and answers empty after dispose', async () => {
    const provider = new CountingProvider();
    const rendered = provider.getTreeItem({
      id: 'x',
      label: 'X',
      description: 'desc',
      contextValue: 'ctx',
      collapsibleState: TreeItemCollapsible.Expanded,
      command: { command: 'cmd', title: 't' },
    });
    expect(rendered).toMatchObject({
      id: 'x',
      label: 'X',
      description: 'desc',
      contextValue: 'ctx',
      collapsibleState: 2,
    });

    provider.dispose();
    await expect(provider.getChildren()).resolves.toEqual([]);
  });
});

describe('SimpleTreeDataProvider', () => {
  it('computes collapsible states and preserves an explicit Expanded', async () => {
    const provider = new SimpleTreeDataProvider<Item>([
      {
        ...item('open', [item('open.a')]),
        collapsibleState: TreeItemCollapsible.Expanded,
      },
      item('closed', [item('closed.a')]),
      item('leaf'),
    ]);

    const roots = await provider.getChildren();
    expect(roots.map((root) => root.collapsibleState)).toEqual([2, 1, 0]);
  });

  it('keeps Expanded across setChildren, promotes on arrival, demotes when emptied', () => {
    const provider = new SimpleTreeDataProvider<Item>([
      {
        ...item('root', [item('root.a')]),
        collapsibleState: TreeItemCollapsible.Expanded,
      },
      item('bare'),
    ]);

    provider.setChildren('root', [item('root.b')]);
    expect(provider.findItem('root')?.collapsibleState).toBe(2);

    provider.setChildren('bare', [item('bare.a')]);
    expect(provider.findItem('bare')?.collapsibleState).toBe(1);

    provider.setChildren('root', []);
    expect(provider.findItem('root')?.collapsibleState).toBe(0);

    provider.addItem(item('root.c'), 'root');
    expect(provider.findItem('root')?.collapsibleState).toBe(1);
    provider.removeItem('root.c');
    expect(provider.findItem('root')?.collapsibleState).toBe(0);
  });

  it('adds at a clamped index without rebuilding the tree', async () => {
    const provider = new SimpleTreeDataProvider<Item>([item('a'), item('b')]);

    provider.addItem(item('first'), { index: 0 });
    provider.addItem(item('last'), { index: 99 });
    provider.addItem(item('clamped'), { index: -5 });
    expect((await provider.getChildren()).map((entry) => entry.id)).toEqual([
      'clamped',
      'first',
      'a',
      'b',
      'last',
    ]);

    const parentForm = provider.addItem(item('nested'), { parentId: 'a', index: 0 });
    expect(parentForm).toBe(true);
    expect(provider.getChildrenOf(provider.findItem('a') as Item).map((c) => c.id)).toEqual([
      'nested',
    ]);

    expect(provider.addItem(item('orphan'), { parentId: 'missing' })).toBe(false);
  });

  it('supports the string parentId form, update, remove and find', async () => {
    const provider = new SimpleTreeDataProvider<Item>([item('a', [item('a.1')])]);

    expect(provider.addItem(item('a.2'), 'a')).toBe(true);
    expect(provider.updateItem('a.1', { label: 'renamed' })).toBe(true);
    expect(provider.findItem('a.1')?.label).toBe('renamed');
    expect(provider.updateItem('ghost', { label: 'x' })).toBe(false);

    expect(provider.removeItem('a.1')).toBe(true);
    expect(provider.findItem('a.1')).toBeUndefined();
    expect(provider.removeItem('ghost')).toBe(false);

    // Nested indices answer reveal's parent chain.
    const child = provider.findItem('a.2') as Item;
    expect(provider.getParentOf(child)?.id).toBe('a');

    expect((await provider.getChildren(provider.findItem('a'))).map((c) => c.id)).toEqual(['a.2']);
  });

  it('replaces everything on setItems and deindexes the old tree', () => {
    const provider = new SimpleTreeDataProvider<Item>([item('old', [item('old.child')])]);
    provider.setItems([item('new')]);

    expect(provider.findItem('old')).toBeUndefined();
    expect(provider.findItem('old.child')).toBeUndefined();
    expect(provider.findItem('new')).toBeDefined();
  });

  it('never mutates the caller-supplied items', () => {
    const original = item('a', [item('a.1')]);
    new SimpleTreeDataProvider<Item>([original]);
    expect(original.collapsibleState).toBeUndefined();
  });
});

describe('withPagination', () => {
  it('returns the list unchanged when it fits the page', () => {
    const items = [item('a'), item('b')];
    expect(withPagination(items, 2)).toBe(items);
  });

  it('caps at pageSize and appends the load-more sentinel', () => {
    const paged = withPagination([item('a'), item('b'), item('c')], 2);
    expect(paged.map((entry) => entry.id)).toEqual(['a', 'b', LOAD_MORE_ID]);
    // A theme icon is a bare string now; the adapter turns it into a ThemeIcon.
    expect(paged[2]).toMatchObject({ label: 'Load more…', icon: 'ellipsis' });
  });

  it('puts a command on the placeholder so the row is clickable', () => {
    const command = { command: 'ext.loadMore', title: 'Load more' };
    const paged = withPagination([item('a'), item('b')], 1, { command: command });
    expect(paged[1]).toMatchObject({ id: LOAD_MORE_ID, command });
  });

  it('accepts a bare string as the label shorthand', () => {
    const paged = withPagination([item('a'), item('b')], 1, 'More…');
    expect(paged[1]).toMatchObject({ id: LOAD_MORE_ID, label: 'More…' });
  });
});
