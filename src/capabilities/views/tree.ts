/**
 * VS Code-independent tree models and provider state.
 *
 * Public surface: applications either subclass {@link BaseTreeDataProvider} for
 * computed/lazy data or use {@link SimpleTreeDataProvider} for an in-memory
 * mutable tree. Both implement the `TreeDataSource` port consumed by the
 * adapter. {@link withPagination} and drag-and-drop types are optional helpers.
 *
 * Managed state: the base provider caches children by globally unique item id
 * and owns its change emitters. The simple provider replaces that cache with
 * explicit id/parent/children indices so lookups and localized mutations do
 * not walk or rebuild the whole tree.
 *
 * Ownership: `module.treeViews.add` records a disposable provider before the
 * native view registration, so LIFO teardown removes the view before releasing
 * the provider it calls. A provider instantiated outside a module declaration
 * is caller-owned and must be disposed explicitly.
 */
import { createEmitter } from '../../foundation/internal/emitter.js';
import type { Emitter } from '../../foundation/internal/emitter.js';
import { TreeItemCollapsible } from '../../foundation/platform/ports.js';
import type {
  CommandLike,
  TreeItemChecked,
  MarkdownLike,
  PlatformRegistration,
  ResourceUri,
  TreeDataSource,
  TreeDragAndDrop,
  TreeItemIcon,
  TreeItemLike,
} from '../../foundation/platform/ports.js';

/** Data for a tree item. */
export interface TreeItemData<T = unknown> {
  /**
   * Unique identifier. Must be unique across the *entire* tree, not just among
   * siblings; providers use it as a cache/index key and do not repair
   * duplicates.
   */
  id: string;
  /** Display label. */
  label: string;
  /** Secondary label. */
  description?: string;
  /** Tooltip text. */
  tooltip?: string | MarkdownLike;
  /**
   * Icon. A bare string is a theme icon id, which covers almost every case:
   * `icon: 'folder'`.
   */
  icon?: TreeItemIcon;
  /**
   * The resource this item represents. Setting this enables file-icon-theme
   * icons (when `icon` is unset) and built-in file commands such as
   * "Copy Path" in the item's context menu.
   */
  resourceUri?: ResourceUri;
  /**
   * Checkbox state, for a view that shows checkboxes.
   *
   * Toggling in the UI is reported through
   * {@link BaseTreeDataProvider.onDidChangeCheckboxState}, which the host wires
   * up for any view declared with `module.treeViews.add`.
   */
  checkboxState?: TreeItemChecked;
  /** Context value for when clauses. */
  contextValue?: string;
  /** Collapsible state. */
  collapsibleState?: TreeItemCollapsible;
  /** Command to execute on click. */
  command?: CommandLike;
  /** Custom data. */
  data?: T;
}

/** A single checkbox toggle reported by {@link BaseTreeDataProvider.onDidChangeCheckboxState}. */
export interface TreeCheckboxChange<T> {
  /** The item whose checkbox was toggled. */
  item: T;
  /** `true` when checked, `false` when unchecked. */
  checked: boolean;
}

/**
 * Abstract base class for tree data providers.
 *
 * A class on purpose, against this codebase's factory-function default,
 * because subclassing *is* the interface: a provider is defined by what its
 * `getRoots`/`getChildrenOf` overrides return, and a factory taking those two
 * as callbacks would be the same thing with more ceremony.
 *
 * @example
 * ```typescript
 * class FileTreeProvider extends BaseTreeDataProvider<FileItem> {
 *   async getRoots(): Promise<FileItem[]> {
 *     return [{ id: 'src', label: 'src', collapsibleState: TreeItemCollapsible.Collapsed }];
 *   }
 *   async getChildrenOf(element: FileItem): Promise<FileItem[]> {
 *     return listChildren(element);
 *   }
 * }
 * ```
 */
export abstract class BaseTreeDataProvider<T extends TreeItemData> implements TreeDataSource<T> {
  /**
   * Emits invalidation requests consumed by the adapter. Protected so a
   * specialized provider can expose richer refresh methods without replacing
   * the public event contract.
   */
  protected readonly _onDidChangeTreeData: Emitter<T | undefined> = createEmitter<T | undefined>();
  /** Event the platform subscribes to; emit through {@link refresh}. */
  readonly onDidChangeTreeData: (
    listener: (element: T | undefined) => void
  ) => PlatformRegistration = (listener) => this._onDidChangeTreeData.event(listener);

  private readonly _onDidChangeCheckboxState = createEmitter<TreeCheckboxChange<T>[]>();
  /**
   * Fires when the user (un)checks a checkbox in the tree. The host bridges
   * the native event for any view declared with `module.treeViews.add`, so
   * there is nothing to wire up.
   */
  readonly onDidChangeCheckboxState: (
    listener: (changes: TreeCheckboxChange<T>[]) => void
  ) => PlatformRegistration = (listener) => this._onDidChangeCheckboxState.event(listener);

  private readonly _cache = new Map<string, T[]>();
  /**
   * Bumped whenever the cache is invalidated, so a load that was already in
   * flight can tell that its answer is out of date.
   */
  private _generation = 0;
  protected _disposed = false;

  /**
   * Gets the root elements of the tree.
   * Override this method to provide root items.
   */
  abstract getRoots(): T[] | Promise<T[]>;

  /**
   * Gets the children of an element.
   * Override this method to provide child items.
   *
   * @param element - Parent element
   */
  abstract getChildrenOf(element: T): T[] | Promise<T[]>;

  /**
   * Gets the parent of an element.
   * Override this method to support `TreeView.reveal()`.
   *
   * @param element - Child element
   */
  getParentOf?(element: T): T | undefined | Promise<T | undefined>;

  /**
   * Refreshes the tree view.
   *
   * Passing a specific `element` (rather than `undefined`) is the
   * partial-update path: VS Code only re-fetches that element's own
   * `getTreeItem()` rendering and its children, leaving the rest of the
   * tree's scroll position, selection, and expand/collapse state untouched.
   *
   * @param element - Specific element to refresh, or undefined for the entire tree
   */
  refresh(element?: T): void {
    this._generation += 1;
    if (element) {
      this._evictCachedSubtree(element.id);
    } else {
      this._cache.clear();
    }
    this._onDidChangeTreeData.fire(element);
  }

  /**
   * Notifies listeners that the given items' checkbox state changed. The host
   * calls this; an application normally only listens.
   *
   * @param changes - The items that were checked or unchecked
   */
  reportCheckboxChange(
    changes: readonly { readonly element: T; readonly checked: boolean }[]
  ): void {
    this._onDidChangeCheckboxState.fire(
      changes.map(({ element, checked }) => ({ item: element, checked }))
    );
  }

  /**
   * Evicts an element's cached children and, transitively, every cached
   * descendant. Evicting only the element itself would let VS Code re-render
   * the subtree with stale grandchildren served from cache.
   */
  private _evictCachedSubtree(id: string, seen: Set<string> = new Set()): void {
    if (seen.has(id)) {
      return;
    }
    seen.add(id);

    const children = this._cache.get(id);
    this._cache.delete(id);
    if (children) {
      for (const child of children) {
        this._evictCachedSubtree(child.id, seen);
      }
    }
  }

  /**
   * Clears the internal child cache without emitting an invalidation event.
   * Call {@link refresh} when the platform must immediately query again.
   */
  clearCache(): void {
    this._generation += 1;
    this._cache.clear();
  }

  /**
   * Renders one element.
   *
   * An element already *is* the row's data, so this normalises rather than
   * builds: it fills in the collapsible state and hands back plain data the
   * adapter turns into the platform's `TreeItem`. Override it to render an
   * element differently from how it is stored.
   *
   * @param element - Tree item data
   */
  getTreeItem(element: T): TreeItemLike {
    return { ...element, collapsibleState: element.collapsibleState ?? TreeItemCollapsible.None };
  }

  /**
   * Gets children of an element or root elements.
   *
   * @param element - Parent element, or undefined for root
   */
  async getChildren(element?: T): Promise<T[]> {
    if (this._disposed) {
      return [];
    }

    if (!element) {
      return this.getRoots();
    }

    const cached = this._cache.get(element.id);
    if (cached) {
      return cached;
    }

    // A refresh while this load is in flight invalidates its answer. Caching it
    // anyway would put pre-refresh children back into a cache that was just
    // cleared, and the platform's next query would be served the stale copy —
    // which is exactly the situation a refresh exists to end. The children are
    // still returned to *this* caller: they are the best answer available for
    // the query that asked, and the refresh has already told the platform to
    // ask again.
    const generation = this._generation;
    const children = await this.getChildrenOf(element);
    if (generation === this._generation) {
      this._cache.set(element.id, children);
    }
    return children;
  }

  /**
   * Gets the parent of an element.
   *
   * @param element - Child element
   */
  getParent(element: T): T | undefined | Promise<T | undefined> {
    if (this.getParentOf) {
      return this.getParentOf(element);
    }
    return undefined;
  }

  /**
   * Releases emitters and cached data. Idempotent through the emitter
   * implementation; subsequent child reads return an empty list.
   */
  dispose(): void {
    this._disposed = true;
    this._cache.clear();
    this._onDidChangeTreeData.dispose();
    this._onDidChangeCheckboxState.dispose();
  }
}

/** Options for the object form of {@link SimpleTreeDataProvider.addItem}. */
export interface AddItemOptions {
  /** Existing item id to nest under. Omit to add at the root. */
  parentId?: string;
  /**
   * Position among the siblings. Clamped to the list, so `0` is always first
   * and a value past the end appends. Omit to append.
   */
  index?: number;
}

/**
 * Splices `item` into `list` at `index`, treating an out-of-range or omitted
 * index as "append" so callers never have to bounds-check a position they
 * computed.
 */
function insertAt<T>(list: T[], item: T, index: number | undefined): void {
  if (index === undefined || index >= list.length) {
    list.push(item);
    return;
  }
  list.splice(Math.max(0, index), 0, item);
}

/**
 * Brings a parent's `collapsibleState` in line with whether it still has
 * children, without discarding a state the caller chose deliberately. A node
 * built as `Expanded` stays expanded across partial updates — collapsing it
 * would defeat the point of a scoped refresh — and `Collapsed` is only ever
 * assigned to a node that had no children at all.
 */
function reconcileCollapsibleState(parent: TreeItemData, hasChildren: boolean): void {
  if (!hasChildren) {
    parent.collapsibleState = TreeItemCollapsible.None;
  } else if (parent.collapsibleState === TreeItemCollapsible.None) {
    parent.collapsibleState = TreeItemCollapsible.Collapsed;
  }
}

/**
 * A simple tree data provider backed by an in-memory item tree.
 *
 * Maintains its own id → item / id → parent / id → children indices, so
 * every lookup (`findItem`, `getParentOf`, and the mutators below) is O(1)
 * plus the size of the affected subtree — never a full-tree walk. Mutators
 * refresh only the affected node (see {@link BaseTreeDataProvider.refresh}),
 * so unrelated parts of the tree keep their scroll position and
 * expand/collapse state.
 *
 * Treat items returned by this provider as read-only and mutate through its
 * methods. The provider exposes stored objects to satisfy the platform
 * contract; external mutation would bypass indices and refresh events.
 *
 * @example
 * ```typescript
 * const provider = new SimpleTreeDataProvider([
 *   { id: '1', label: 'Item 1', children: [{ id: '1.1', label: 'Child 1' }] },
 *   { id: '2', label: 'Item 2' },
 * ]);
 *
 * module.treeViews.add({ id: 'myext.tree', resolveProvider: () => provider });
 *
 * provider.addItem({ id: '1.2', label: 'Child 2' }, '1');
 * provider.updateItem('1.1', { label: 'Renamed' });
 * provider.removeItem('1.1');
 * ```
 */
export class SimpleTreeDataProvider<
  T extends TreeItemData & { children?: T[] },
> extends BaseTreeDataProvider<T> {
  private _roots: T[] = [];
  private readonly _itemsById = new Map<string, T>();
  private readonly _parentById = new Map<string, string | undefined>();
  private readonly _childrenById = new Map<string, T[]>();

  constructor(items: T[] = []) {
    super();
    this.setItems(items);
  }

  /**
   * Replaces the entire tree and refreshes it in full — there is no single
   * element to scope a partial refresh to when every root is being replaced.
   * Use {@link setChildren}, {@link addItem}, {@link updateItem}, or
   * {@link removeItem} for localized changes.
   *
   * @param items - New tree items
   */
  setItems(items: T[]): void {
    this._itemsById.clear();
    this._parentById.clear();
    this._childrenById.clear();
    this._roots = items.map((item) => this._normalize(item, undefined));
    this.refresh();
  }

  /**
   * Replaces the children of `parentId` (or the roots, when `parentId` is
   * `undefined`) wholesale. Only `parentId`'s subtree is refreshed.
   *
   * @param parentId - Parent whose children to replace, or undefined for the roots
   * @param children - The new children
   * @returns `false` if `parentId` doesn't refer to a known item
   */
  setChildren(parentId: string | undefined, children: T[]): boolean {
    const parent = parentId !== undefined ? this._itemsById.get(parentId) : undefined;
    if (parentId !== undefined && !parent) {
      return false;
    }

    const oldContainer = parentId !== undefined ? this._childrenById.get(parentId) : this._roots;
    if (oldContainer) {
      for (const old of oldContainer) {
        this._deindex(old.id);
      }
    }

    const normalized = children.map((child) => this._normalize(child, parentId));
    if (parentId === undefined) {
      this._roots = normalized;
    } else {
      this._childrenById.set(parentId, normalized);
    }
    if (parent) {
      reconcileCollapsibleState(parent, normalized.length > 0);
    }

    this.refresh(parent);
    return true;
  }

  /**
   * Adds an item under the root, or under an existing item when `parentId`
   * is given. Only the affected parent (or the whole tree, for a new root)
   * is refreshed — sibling nodes keep their expand/collapse and selection
   * state.
   *
   * @param item - Item to add (may itself carry nested `children`)
   * @param parentId - Existing item id to nest under; omit to add at the root
   * @returns `false` if `parentId` was given but doesn't refer to a known item
   */
  addItem(item: T, parentId?: string): boolean;
  /**
   * Adds an item at a chosen position, rather than at the end.
   *
   * This is the way to introduce a group that has to stay on top — a
   * "Favorites" node, say — without going through {@link setItems}, which
   * rebuilds the tree and collapses all of it.
   *
   * @param item - Item to add (may itself carry nested `children`)
   * @param options - `parentId` to nest under (omit for the root) and `index`
   *   to insert at; `index` is clamped to the sibling list, so `0` always
   *   means first and anything past the end appends
   * @returns `false` if `parentId` was given but doesn't refer to a known item
   *
   * @example
   * ```typescript
   * // Keep the favorites group pinned above everything else.
   * provider.addItem({ id: 'favorites', label: 'Favorites', children }, { index: 0 });
   * ```
   */
  addItem(item: T, options: AddItemOptions): boolean;
  addItem(item: T, parentIdOrOptions?: string | AddItemOptions): boolean {
    const { parentId, index } =
      typeof parentIdOrOptions === 'string'
        ? { parentId: parentIdOrOptions, index: undefined }
        : { parentId: parentIdOrOptions?.parentId, index: parentIdOrOptions?.index };
    const parent = parentId !== undefined ? this._itemsById.get(parentId) : undefined;
    if (parentId !== undefined && !parent) {
      return false;
    }

    const normalized = this._normalize(item, parentId);
    if (parentId === undefined) {
      insertAt(this._roots, normalized, index);
    } else {
      const siblings = this._childrenById.get(parentId) ?? [];
      insertAt(siblings, normalized, index);
      this._childrenById.set(parentId, siblings);
      if (parent) {
        reconcileCollapsibleState(parent, true);
      }
    }

    this.refresh(parent);
    return true;
  }

  /**
   * Updates an existing item's own display fields in place (not its
   * position or `children` — use {@link setChildren} for that). Refreshes
   * just that item.
   *
   * @param id - Item id to update
   * @param patch - Fields to merge into the existing item
   * @returns `false` if `id` doesn't refer to a known item
   */
  updateItem(id: string, patch: Partial<Omit<T, 'id' | 'children'>>): boolean {
    const existing = this._itemsById.get(id);
    if (!existing) {
      return false;
    }
    Object.assign(existing, patch);
    this.refresh(existing);
    return true;
  }

  /**
   * Removes an item by id, searching the *entire* tree (not just the root
   * level). Only the removed item's former parent (or the whole tree, for a
   * removed root) is refreshed.
   *
   * @param id - Item id to remove
   * @returns `false` if `id` doesn't refer to a known item
   */
  removeItem(id: string): boolean {
    const parentId = this._parentById.get(id);
    const container = parentId !== undefined ? this._childrenById.get(parentId) : this._roots;
    if (!container) {
      return false;
    }
    const index = container.findIndex((it) => it.id === id);
    if (index === -1) {
      return false;
    }

    container.splice(index, 1);
    this._deindex(id);

    const parent = parentId !== undefined ? this._itemsById.get(parentId) : undefined;
    if (parent && container.length === 0) {
      parent.collapsibleState = TreeItemCollapsible.None;
      this._childrenById.delete(parent.id);
    }

    this.refresh(parent);
    return true;
  }

  /**
   * Finds an item by id anywhere in the tree.
   *
   * @param id - Item id
   * @returns The provider-owned normalized item, or undefined. It is a shallow
   *   copy of the object originally supplied.
   */
  findItem(id: string): T | undefined {
    return this._itemsById.get(id);
  }

  /**
   * Returns the parent of `element`, enabling `TreeView.reveal()`.
   *
   * @param element - Child element
   */
  override getParentOf(element: T): T | undefined {
    const parentId = this._parentById.get(element.id);
    return parentId !== undefined ? this._itemsById.get(parentId) : undefined;
  }

  /**
   * Returns children directly from the internal index — bypassing
   * {@link BaseTreeDataProvider}'s cache, which would otherwise duplicate
   * data this class already indexes in O(1) lookups.
   */
  override getChildren(element?: T): Promise<T[]> {
    if (this._disposed) {
      return Promise.resolve([]);
    }
    if (element === undefined) {
      return Promise.resolve(this._roots);
    }
    return Promise.resolve(this._childrenById.get(element.id) ?? []);
  }

  getRoots(): T[] {
    return this._roots;
  }

  getChildrenOf(element: T): T[] {
    return this._childrenById.get(element.id) ?? [];
  }

  /**
   * Recursively indexes `item` (and any inline `children` it carries) and
   * returns a normalized copy — a shallow copy whose `collapsibleState` is
   * computed from whether it has children, so callers never have to set that
   * field themselves. An explicit `collapsibleState` on an item that does
   * have children is honored rather than overwritten: `Expanded` is a
   * deliberate choice, and only the caller knows which groups should start
   * open. A childless item is always `None` — there would be nothing behind
   * the twistie. The copy is what gets stored and returned to VS Code; the
   * caller's original object is never mutated.
   */
  private _normalize(item: T, parentId: string | undefined): T {
    const children = item.children;
    const hasChildren = children !== undefined && children.length > 0;
    const normalized: T = {
      ...item,
      collapsibleState: hasChildren
        ? (item.collapsibleState ?? TreeItemCollapsible.Collapsed)
        : TreeItemCollapsible.None,
    };

    this._itemsById.set(normalized.id, normalized);
    this._parentById.set(normalized.id, parentId);
    if (children && children.length > 0) {
      this._childrenById.set(
        normalized.id,
        children.map((child) => this._normalize(child, normalized.id))
      );
    }
    return normalized;
  }

  /** Removes `id` and, recursively, every descendant from all indices. */
  private _deindex(id: string): void {
    const children = this._childrenById.get(id);
    this._itemsById.delete(id);
    this._parentById.delete(id);
    this._childrenById.delete(id);
    if (children) {
      for (const child of children) {
        this._deindex(child.id);
      }
    }
  }
}

/**
 * Sentinel id used by {@link withPagination}'s "Load more…" placeholder.
 *
 * A single fixed id, which is also its limitation: `TreeItem.id` must be
 * unique across a whole tree, so only one level of one tree can show the
 * placeholder at a time. Paginating two sibling branches at once needs ids of
 * your own.
 */
export const LOAD_MORE_ID = '__loadMore__';

/** Options for {@link withPagination}'s placeholder row. */
export interface PaginationOptions {
  /**
   * Label for the placeholder item.
   * @default 'Load more…'
   */
  label?: string;
  /**
   * Command run when the row is clicked — pass one and the row becomes
   * clickable, which is what makes pagination work without the caller
   * matching on {@link LOAD_MORE_ID} by hand.
   *
   * Your handler is responsible for widening the page (raise the `pageSize`
   * you pass in, or track an offset) and refreshing the parent.
   */
  command?: CommandLike;
  /**
   * Icon for the placeholder item.
   * @default a `ThemeIcon('ellipsis')`
   */
  icon?: TreeItemIcon;
}

/**
 * Caps a children array at `pageSize`, appending a "Load more…" placeholder
 * item when there's more data than that.
 *
 * Useful when a lazily-loaded node (e.g. a directory with tens of thousands
 * of files) would otherwise force VS Code to serialize an enormous array
 * across the extension host boundary in one call.
 *
 * Pass a `command` and the placeholder is clickable on its own. Without one
 * it's inert, and `getChildrenOf` has to recognize
 * `element.id === LOAD_MORE_ID` itself.
 *
 * @param items - The full list of children for this level
 * @param pageSize - Positive maximum number of real items to show before
 *   paginating. The helper does not normalize invalid sizes.
 * @param options - Placeholder label, command, and icon. A bare string is
 *   accepted in place of the object as shorthand for `{ label }`.
 *
 * @example
 * ```typescript
 * return withPagination(allFiles, 500, {
 *   label: l10n.t('Load more…'),
 *   command: { command: 'myext.loadMore', title: l10n.t('Load more…') },
 * });
 * ```
 */
export function withPagination<T extends TreeItemData>(
  items: T[],
  pageSize: number,
  options: PaginationOptions | string = {}
): T[] {
  if (items.length <= pageSize) {
    return items;
  }
  const resolved: PaginationOptions = typeof options === 'string' ? { label: options } : options;
  const { label = 'Load more…', command, icon } = resolved;
  const sentinel = {
    id: LOAD_MORE_ID,
    label,
    icon: icon ?? 'ellipsis',
    ...(command === undefined ? {} : { command }),
  } as unknown as T;
  return [...items.slice(0, pageSize), sentinel];
}

/**
 * Declares drag-and-drop for a tree view.
 *
 * Handed to `module.treeViews.add` as `options.dragAndDrop`; the adapter builds
 * the platform's controller from it. Only ids cross the drag, because ids are
 * what reliably survive its serialisation.
 *
 * @example
 * ```ts
 * module.treeViews.add({
 *   id: 'myext.files',
 *   resolveProvider: () => provider,
 *   options: {
 *     dragAndDrop: {
 *       mimeType: 'application/vnd.code.tree.myextfiles',
 *       onDrop(sourceIds, target) {
 *         for (const id of sourceIds) {
 *           const item = provider.findItem(id);
 *           if (item) {
 *             provider.removeItem(id);
 *             provider.addItem(item, target?.id);
 *           }
 *         }
 *       },
 *     },
 *   },
 * });
 * ```
 */
export type TreeDragAndDropOptions<T extends TreeItemData> = TreeDragAndDrop<T>;
