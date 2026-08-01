import * as vscode from 'vscode';

// ============================================
// Types
// ============================================

/**
 * Data for a tree item.
 */
export interface TreeItemData<T = unknown> {
  /** Unique identifier. Must be unique across the *entire* tree, not just among siblings. */
  id: string;
  /** Display label */
  label: string;
  /** Secondary label */
  description?: string;
  /** Tooltip text */
  tooltip?: string | vscode.MarkdownString;
  /** Icon */
  iconPath?: vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri };
  /**
   * The resource this item represents. Setting this enables file-icon-theme
   * icons (when `iconPath` is unset) and built-in file commands such as
   * "Copy Path" in the item's context menu.
   */
  resourceUri?: vscode.Uri;
  /**
   * Checkbox state. Reuses `vscode.TreeItem`'s own field type so this stays
   * in sync with whatever the pinned `@types/vscode` version supports
   * (currently a plain state, or `{ state, tooltip, accessibilityInformation }`).
   *
   * Requires VS Code 1.80+. Toggling in the UI is reported through
   * {@link BaseTreeDataProvider.onDidChangeCheckboxState} (wired up
   * automatically by {@link createTreeView}).
   */
  checkboxState?: vscode.TreeItem['checkboxState'];
  /** Context value for when clauses */
  contextValue?: string;
  /** Collapsible state */
  collapsibleState?: vscode.TreeItemCollapsibleState;
  /** Command to execute on click */
  command?: vscode.Command;
  /** Custom data */
  data?: T;
}

/**
 * A single checkbox toggle reported by {@link BaseTreeDataProvider.onDidChangeCheckboxState}.
 */
export interface TreeCheckboxChange<T> {
  /** The item whose checkbox was toggled. */
  item: T;
  /** `true` when checked, `false` when unchecked. */
  checked: boolean;
}

// ============================================
// BaseTreeDataProvider
// ============================================

/**
 * Abstract base class for tree data providers.
 *
 * @example
 * ```typescript
 * interface FileItem extends TreeItemData<{ path: string }> {}
 *
 * class FileTreeProvider extends BaseTreeDataProvider<FileItem> {
 *   async getRoots(): Promise<FileItem[]> {
 *     return [
 *       {
 *         id: 'src',
 *         label: 'src',
 *         iconPath: new vscode.ThemeIcon('folder'),
 *         collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
 *         data: { path: '/src' },
 *       },
 *     ];
 *   }
 *
 *   async getChildrenOf(element: FileItem): Promise<FileItem[]> {
 *     const files = await readdir(element.data!.path);
 *     return files.map(file => ({
 *       id: file,
 *       label: file,
 *       iconPath: new vscode.ThemeIcon('file'),
 *       data: { path: join(element.data!.path, file) },
 *     }));
 *   }
 * }
 *
 * const provider = new FileTreeProvider();
 * const treeView = createTreeView(context, 'myext.files', provider);
 * ```
 */
export abstract class BaseTreeDataProvider<T extends TreeItemData>
  implements vscode.TreeDataProvider<T>, vscode.Disposable
{
  protected readonly _onDidChangeTreeData = new vscode.EventEmitter<T | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private readonly _onDidChangeCheckboxState = new vscode.EventEmitter<TreeCheckboxChange<T>[]>();
  /**
   * Fires when the user (un)checks a checkbox in the tree. Bridged
   * automatically from the native `TreeView.onDidChangeCheckboxState` by
   * {@link createTreeView} — you don't need to wire this up yourself as
   * long as the view was created through it.
   */
  readonly onDidChangeCheckboxState = this._onDidChangeCheckboxState.event;

  private _cache = new Map<string, T[]>();
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
    if (element) {
      this._evictCachedSubtree(element.id);
    } else {
      this._cache.clear();
    }
    this._onDidChangeTreeData.fire(element);
  }

  /**
   * Notifies listeners that the given items' checkbox state changed.
   * Normally called for you by {@link createTreeView}'s bridging; call it
   * directly only if you're driving a `TreeView` without going through
   * `createTreeView`.
   *
   * @param changes - The items that were checked or unchecked
   */
  fireCheckboxChange(changes: TreeCheckboxChange<T>[]): void {
    this._onDidChangeCheckboxState.fire(changes);
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
   * Clears the internal cache.
   */
  clearCache(): void {
    this._cache.clear();
  }

  /**
   * Creates a TreeItem from element data.
   *
   * @param element - Tree item data
   */
  getTreeItem(element: T): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      element.collapsibleState ?? vscode.TreeItemCollapsibleState.None
    );

    item.id = element.id;
    item.description = element.description;
    item.tooltip = element.tooltip;
    item.iconPath = element.iconPath;
    item.resourceUri = element.resourceUri;
    item.checkboxState = element.checkboxState;
    item.contextValue = element.contextValue;
    item.command = element.command;

    return item;
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

    // Root elements
    if (!element) {
      return this.getRoots();
    }

    // Check cache
    const cached = this._cache.get(element.id);
    if (cached) {
      return cached;
    }

    // Get children and cache
    const children = await this.getChildrenOf(element);
    this._cache.set(element.id, children);
    return children;
  }

  /**
   * Gets the parent of an element.
   *
   * @param element - Child element
   */
  getParent(element: T): vscode.ProviderResult<T> {
    if (this.getParentOf) {
      return this.getParentOf(element);
    }
    return undefined;
  }

  /**
   * Disposes of the provider.
   */
  dispose(): void {
    this._disposed = true;
    this._cache.clear();
    this._onDidChangeTreeData.dispose();
    this._onDidChangeCheckboxState.dispose();
  }
}

// ============================================
// SimpleTreeDataProvider
// ============================================

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
    parent.collapsibleState = vscode.TreeItemCollapsibleState.None;
  } else if (parent.collapsibleState === vscode.TreeItemCollapsibleState.None) {
    parent.collapsibleState = vscode.TreeItemCollapsibleState.Collapsed;
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
 * @example
 * ```typescript
 * const provider = new SimpleTreeDataProvider([
 *   { id: '1', label: 'Item 1', children: [
 *     { id: '1.1', label: 'Child 1' },
 *     { id: '1.2', label: 'Child 2' },
 *   ]},
 *   { id: '2', label: 'Item 2' },
 * ]);
 *
 * const treeView = createTreeView(context, 'myext.tree', provider);
 *
 * // Reveal now works because SimpleTreeDataProvider implements getParentOf.
 * await treeView.reveal(provider.findItem('1.1')!, { select: true, expand: true });
 *
 * provider.addItem({ id: '1.3', label: 'Child 3' }, '1'); // nested add
 * provider.updateItem('1.1', { label: 'Renamed' });
 * provider.removeItem('1.2'); // now works for nested ids too
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
      parent.collapsibleState = vscode.TreeItemCollapsibleState.None;
      this._childrenById.delete(parent.id);
    }

    this.refresh(parent);
    return true;
  }

  /**
   * Finds an item by id anywhere in the tree.
   *
   * @param id - Item id
   * @returns The original item (with its `children`) or undefined.
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
  override async getChildren(element?: T): Promise<T[]> {
    if (this._disposed) {
      return [];
    }
    if (element === undefined) {
      return this._roots;
    }
    return this._childrenById.get(element.id) ?? [];
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
        ? (item.collapsibleState ?? vscode.TreeItemCollapsibleState.Collapsed)
        : vscode.TreeItemCollapsibleState.None,
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

// ============================================
// Pagination helper
// ============================================

/** Sentinel id used by {@link withPagination}'s "Load more…" placeholder. */
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
  command?: vscode.Command;
  /**
   * Icon for the placeholder item.
   * @default a `ThemeIcon('ellipsis')`
   */
  iconPath?: TreeItemData['iconPath'];
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
 * @param pageSize - Maximum number of real items to show before paginating
 * @param options - Placeholder label, command, and icon. A bare string is
 *   accepted in place of the object as shorthand for `{ label }`.
 *
 * @example
 * ```typescript
 * class HugeDirProvider extends BaseTreeDataProvider<FileItem> {
 *   async getChildrenOf(element: FileItem): Promise<FileItem[]> {
 *     const allFiles = await listFiles(element.data!.path);
 *     return withPagination(allFiles, this.pageSize, {
 *       label: l10n.t('Load more…'),
 *       command: { command: 'myext.loadMore', title: l10n.t('Load more…') },
 *     });
 *   }
 * }
 *
 * // Inert placeholder — handle LOAD_MORE_ID yourself
 * return withPagination(allFiles, 500);
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
  const { label = 'Load more…', command, iconPath } = resolved;
  const sentinel = {
    id: LOAD_MORE_ID,
    label,
    iconPath: iconPath ?? new vscode.ThemeIcon('ellipsis'),
    ...(command === undefined ? {} : { command }),
  } as unknown as T;
  return [...items.slice(0, pageSize), sentinel];
}

// ============================================
// Drag and drop helper
// ============================================

/**
 * Options for {@link createDragAndDropController}.
 */
export interface TreeDragAndDropOptions<T extends TreeItemData> {
  /**
   * MIME type used to carry dragged item ids. Recommended format:
   * `application/vnd.code.tree.<viewid-lowercase>`.
   */
  mimeType: string;
  /**
   * Called after a drop with the dragged items' **ids** — ids are all that
   * reliably survive serialization across the drag, so resolve them
   * yourself (e.g. via `provider.findItem(id)`). Fire
   * `onDidChangeTreeData`/call the provider's own mutators for anything
   * that needs to be redrawn; this callback does not do that for you.
   *
   * @param sourceIds - Ids of the dragged items
   * @param target - The item dropped onto, or undefined when dropped on the root
   */
  onDrop(sourceIds: string[], target: T | undefined): void | Promise<void>;
}

/**
 * Builds a type-safe `vscode.TreeDragAndDropController` for reordering or
 * moving items within (or between) trees that share the same `mimeType`.
 * Requires VS Code 1.66+. Pass the result as `dragAndDropController` in
 * {@link createTreeView}'s options.
 *
 * @param options - MIME type and drop handler
 *
 * @example
 * ```typescript
 * const provider = new SimpleTreeDataProvider<FileItem>(initialItems);
 * const dragAndDropController = createDragAndDropController<FileItem>({
 *   mimeType: 'application/vnd.code.tree.myextFiles',
 *   onDrop(sourceIds, target) {
 *     for (const id of sourceIds) {
 *       const item = provider.findItem(id);
 *       if (item) {
 *         provider.removeItem(id);
 *         provider.addItem(item, target?.id);
 *       }
 *     }
 *   },
 * });
 *
 * createTreeView(context, 'myext.files', provider, { dragAndDropController });
 * ```
 */
export function createDragAndDropController<T extends TreeItemData>(
  options: TreeDragAndDropOptions<T>
): vscode.TreeDragAndDropController<T> {
  return {
    dropMimeTypes: [options.mimeType],
    dragMimeTypes: [options.mimeType],
    handleDrag(source, dataTransfer) {
      dataTransfer.set(
        options.mimeType,
        new vscode.DataTransferItem(JSON.stringify(source.map((item) => item.id)))
      );
    },
    async handleDrop(target, dataTransfer) {
      const transferItem = dataTransfer.get(options.mimeType);
      if (!transferItem) {
        return;
      }
      const raw = await transferItem.asString();
      const sourceIds = JSON.parse(raw) as string[];
      await options.onDrop(sourceIds, target);
    },
  };
}

// ============================================
// createTreeView
// ============================================

/**
 * Creates a tree view and registers it with the extension context.
 *
 * When `provider` is a {@link BaseTreeDataProvider}, its
 * {@link BaseTreeDataProvider.onDidChangeCheckboxState} is automatically
 * bridged from the native `TreeView.onDidChangeCheckboxState` event.
 *
 * @param context - Extension context
 * @param viewId - View identifier (must match package.json contribution)
 * @param provider - Tree data provider
 * @param options - Tree view options (including e.g. `dragAndDropController`
 *   from {@link createDragAndDropController}, or `manageCheckboxStateManually`)
 * @returns The created tree view
 *
 * @example
 * ```typescript
 * const provider = new MyTreeDataProvider();
 * const treeView = createTreeView(context, 'myext.explorer', provider, {
 *   showCollapseAll: true,
 *   canSelectMany: false,
 * });
 *
 * // The returned TreeView is the real vscode.TreeView, so its badge and
 * // checkbox-change event both just work:
 * treeView.badge = { value: 3, tooltip: '3 pending' };
 * treeView.onDidChangeCheckboxState((e) => console.log(e.items));
 * ```
 */
export function createTreeView<T extends TreeItemData>(
  context: vscode.ExtensionContext,
  viewId: string,
  provider: vscode.TreeDataProvider<T>,
  options?: Omit<vscode.TreeViewOptions<T>, 'treeDataProvider'>
): vscode.TreeView<T> {
  const treeView = vscode.window.createTreeView(viewId, {
    treeDataProvider: provider,
    ...options,
  });

  context.subscriptions.push(treeView);

  if ('dispose' in provider && typeof provider.dispose === 'function') {
    context.subscriptions.push(provider as vscode.Disposable);
  }

  if (provider instanceof BaseTreeDataProvider) {
    context.subscriptions.push(
      treeView.onDidChangeCheckboxState((e) => {
        provider.fireCheckboxChange(
          e.items.map(([item, state]) => ({
            item,
            checked: state === vscode.TreeItemCheckboxState.Checked,
          }))
        );
      })
    );
  }

  return treeView;
}
