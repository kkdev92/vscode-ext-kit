import * as vscode from 'vscode';

// ============================================
// Types
// ============================================

/**
 * Data for a tree item.
 */
export interface TreeItemData<T = unknown> {
  /** Unique identifier */
  id: string;
  /** Display label */
  label: string;
  /** Secondary label */
  description?: string;
  /** Tooltip text */
  tooltip?: string | vscode.MarkdownString;
  /** Icon */
  iconPath?: vscode.ThemeIcon | vscode.Uri | { light: vscode.Uri; dark: vscode.Uri };
  /** Context value for when clauses */
  contextValue?: string;
  /** Collapsible state */
  collapsibleState?: vscode.TreeItemCollapsibleState;
  /** Command to execute on click */
  command?: vscode.Command;
  /** Custom data */
  data?: T;
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
  protected readonly _onDidChangeTreeData = new vscode.EventEmitter<T | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private _cache = new Map<string, T[]>();
  private _disposed = false;

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
   * Override this method to support reveal functionality.
   *
   * @param element - Child element
   */
  getParentOf?(element: T): T | undefined | Promise<T | undefined>;

  /**
   * Refreshes the tree view.
   *
   * @param element - Specific element to refresh, or undefined for entire tree
   */
  refresh(element?: T): void {
    if (element) {
      this._cache.delete(element.id);
    } else {
      this._cache.clear();
    }
    this._onDidChangeTreeData.fire(element);
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
  }
}

// ============================================
// SimpleTreeDataProvider
// ============================================

/**
 * A simple tree data provider with static data.
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
 * ```
 */
export class SimpleTreeDataProvider<
  T extends TreeItemData & { children?: T[] },
> extends BaseTreeDataProvider<T> {
  private _roots: T[];
  private _itemsById = new Map<string, T>();
  private _normalizedRoots: T[] = [];
  private _normalizedChildrenById = new Map<string, T[]>();

  constructor(items: T[] = []) {
    super();
    this._roots = items;
    this._rebuildIndex();
  }

  /**
   * Sets the tree items.
   *
   * @param items - New tree items
   */
  setItems(items: T[]): void {
    this._roots = items;
    this._rebuildIndex();
    this.refresh();
  }

  /**
   * Adds an item to the root.
   *
   * @param item - Item to add
   */
  addItem(item: T): void {
    this._roots.push(item);
    this._rebuildIndex();
    this.refresh();
  }

  /**
   * Removes an item by id.
   *
   * @param id - Item id to remove
   */
  removeItem(id: string): void {
    this._roots = this._roots.filter((item) => item.id !== id);
    this._rebuildIndex();
    this.refresh();
  }

  /**
   * Finds an item by id.
   *
   * @param id - Item id
   * @returns The original item (with its `children`) or undefined.
   */
  findItem(id: string): T | undefined {
    return this._itemsById.get(id);
  }

  getRoots(): T[] {
    return this._normalizedRoots;
  }

  getChildrenOf(element: T): T[] {
    return this._normalizedChildrenById.get(element.id) ?? [];
  }

  /**
   * Walks the tree once and pre-computes:
   * - `_itemsById`: O(1) findItem lookup
   * - `_normalizedRoots` / `_normalizedChildrenById`: stable arrays returned
   *   to VS Code so the same reference is handed back across calls when the
   *   underlying data has not changed.
   */
  private _rebuildIndex(): void {
    this._itemsById.clear();
    this._normalizedChildrenById.clear();

    const normalize = (item: T): T => ({
      ...item,
      collapsibleState:
        item.children && item.children.length > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
    });

    const walk = (items: T[]): T[] =>
      items.map((item) => {
        this._itemsById.set(item.id, item);
        if (item.children && item.children.length > 0) {
          this._normalizedChildrenById.set(item.id, walk(item.children));
        }
        return normalize(item);
      });

    this._normalizedRoots = walk(this._roots);
  }
}

// ============================================
// createTreeView
// ============================================

/**
 * Creates a tree view and registers it with the extension context.
 *
 * @param context - Extension context
 * @param viewId - View identifier (must match package.json contribution)
 * @param provider - Tree data provider
 * @param options - Tree view options
 * @returns The created tree view
 *
 * @example
 * ```typescript
 * const provider = new MyTreeDataProvider();
 * const treeView = createTreeView(context, 'myext.explorer', provider, {
 *   showCollapseAll: true,
 *   canSelectMany: false,
 * });
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

  return treeView;
}
