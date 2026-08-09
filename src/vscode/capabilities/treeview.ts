/**
 * Tree-view adapter. Providers and rows stay vscode-free; this file creates the
 * nominal `TreeItem`, Event and drag/drop objects the workbench requires.
 *
 * Keep provider behavior (pagination, loading, identity) in the capability
 * layer. Tests here should cover translation and native wiring only, while
 * provider tests run without a VS Code mock.
 */
import * as vscode from 'vscode';

import type {
  PlatformRegistration,
  TreeDataSource,
  TreeItemIcon,
  TreeItemLike,
  TreeViewCapability,
  TreeViewOptionsLike,
} from '../../foundation/platform/ports.js';

/**
 * The real tree view surface, backed by `vscode.window.createTreeView`.
 *
 * Everything above the port describes a row as plain data; VS Code wants a
 * `TreeItem` instance and a `TreeDataProvider` shape. This adapter is where
 * those two meet, and it is the only file in the tree stack that imports
 * `vscode`.
 */

/** Rehydrates each supported plain icon variant as the native representation. */
function toIconPath(icon: TreeItemIcon): NonNullable<vscode.TreeItem['iconPath']> {
  if (typeof icon === 'string') {
    return new vscode.ThemeIcon(icon);
  }
  if ('id' in icon) {
    return icon.color === undefined
      ? new vscode.ThemeIcon(icon.id)
      : new vscode.ThemeIcon(icon.id, new vscode.ThemeColor(icon.color));
  }
  if ('uri' in icon) {
    return icon.uri as vscode.Uri;
  }
  return { light: icon.light as vscode.Uri, dark: icon.dark as vscode.Uri };
}

/**
 * Builds a fresh platform `TreeItem` from a row of plain data.
 * Optional properties remain absent when omitted, preserving the port's
 * absent-versus-supplied distinction at the adapter boundary.
 */
function toTreeItem(row: TreeItemLike): vscode.TreeItem {
  const item = new vscode.TreeItem(row.label, row.collapsibleState);

  item.id = row.id;
  // A fresh TreeItem: skipping an absent field is identical to assigning
  // undefined, and exactOptionalPropertyTypes rejects the assignment form.
  if (row.description !== undefined) {
    item.description = row.description;
  }
  if (row.tooltip !== undefined) {
    item.tooltip = typeof row.tooltip === 'string' ? row.tooltip : row.tooltip.value;
  }
  if (row.icon !== undefined) {
    item.iconPath = toIconPath(row.icon);
  }
  if (row.resourceUri !== undefined) {
    item.resourceUri = row.resourceUri as vscode.Uri;
  }
  if (row.checkboxState !== undefined) {
    item.checkboxState = row.checkboxState;
  }
  if (row.contextValue !== undefined) {
    item.contextValue = row.contextValue;
  }
  if (row.command !== undefined) {
    item.command = {
      command: row.command.command,
      title: row.command.title,
      ...(row.command.tooltip === undefined ? {} : { tooltip: row.command.tooltip }),
      ...(row.command.arguments === undefined ? {} : { arguments: [...row.command.arguments] }),
    };
  }

  return item;
}

/** Wraps a vscode-free source in the shape VS Code's tree view expects. */
function toTreeDataProvider<T>(source: TreeDataSource<T>): vscode.TreeDataProvider<T> {
  const provider: vscode.TreeDataProvider<T> = {
    getTreeItem: (element) => toTreeItem(source.getTreeItem(element)),
    getChildren: (element) => source.getChildren(element),
    ...(source.getParent === undefined
      ? {}
      : { getParent: (element: T) => source.getParent?.(element) }),
  };

  if (source.onDidChangeTreeData !== undefined) {
    // Bridged through a VS Code emitter because the platform reads
    // `onDidChangeTreeData` as its own Event, not as a plain subscribe function.
    const emitter = new vscode.EventEmitter<T | undefined>();
    source.onDidChangeTreeData((element) => {
      emitter.fire(element);
    });
    provider.onDidChangeTreeData = emitter.event;
  }

  return provider;
}

/**
 * Reads a drop payload back into the ids `onDrop` is promised.
 *
 * Returns `undefined` for anything else — malformed JSON, or JSON that is not
 * an array of strings — because a drop this controller cannot make sense of is
 * better ignored than reported: the user dragged something, and a dialog about
 * a data-transfer payload would explain nothing they can act on.
 */
function parseSourceIds(raw: string): readonly string[] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!Array.isArray(parsed) || !parsed.every((id) => typeof id === 'string')) {
    return undefined;
  }
  return parsed;
}

/**
 * Builds the platform's drag-and-drop controller from declared intent.
 * Only stable element ids cross the serialized data-transfer boundary; object
 * identity and service instances must never be placed in a drag payload.
 */
function toDragAndDropController<T>(
  declared: NonNullable<TreeViewOptionsLike['dragAndDrop']>,
  identify: (element: T) => string
): vscode.TreeDragAndDropController<T> {
  return {
    dropMimeTypes: [declared.mimeType],
    dragMimeTypes: [declared.mimeType],
    handleDrag(source, dataTransfer): void {
      dataTransfer.set(
        declared.mimeType,
        new vscode.DataTransferItem(JSON.stringify(source.map(identify)))
      );
    },
    async handleDrop(target, dataTransfer): Promise<void> {
      const transferItem = dataTransfer.get(declared.mimeType);
      if (transferItem === undefined) {
        return;
      }
      // Checked rather than cast. `handleDrag` above writes this payload, but
      // nothing guarantees the drop came from there — the mime type is the
      // extension's own declared string, and any producer that writes it lands
      // here. `onDrop` promises `readonly string[]`, so a payload that is not
      // one is dropped rather than handed on with the types lying about it.
      const sourceIds = parseSourceIds(await transferItem.asString());
      if (sourceIds === undefined) {
        return;
      }
      await (declared as { onDrop(ids: readonly string[], target: T | undefined): unknown }).onDrop(
        sourceIds,
        target
      );
    },
  };
}

/**
 * Creates the real tree view capability.
 *
 * @example
 * ```ts
 * const capability = createVSCodeTreeViewCapability();
 * const registration = capability.create('myext.tree', source, {});
 * ```
 */
export function createVSCodeTreeViewCapability(): TreeViewCapability {
  return {
    create(
      viewId: string,
      source: TreeDataSource<never>,
      options: TreeViewOptionsLike
    ): PlatformRegistration {
      const typed = source as TreeDataSource<{ id: string }>;
      const treeDataProvider = toTreeDataProvider(typed);

      const treeView = vscode.window.createTreeView(viewId, {
        treeDataProvider,
        ...(options.showCollapseAll === undefined
          ? {}
          : { showCollapseAll: options.showCollapseAll }),
        ...(options.canSelectMany === undefined ? {} : { canSelectMany: options.canSelectMany }),
        ...(options.manageCheckboxStateManually === undefined
          ? {}
          : { manageCheckboxStateManually: options.manageCheckboxStateManually }),
        ...(options.dragAndDrop === undefined
          ? {}
          : {
              dragAndDropController: toDragAndDropController(
                options.dragAndDrop,
                (element: { id: string }) => element.id
              ),
            }),
      });

      // The checkbox event only exists on the native view, so the source cannot
      // observe it without this. A source that does not care simply omits the
      // hook and nothing is wired.
      const bridge =
        typed.reportCheckboxChange === undefined
          ? undefined
          : treeView.onDidChangeCheckboxState((event) => {
              typed.reportCheckboxChange?.(
                event.items.map(([element, state]) => ({
                  element,
                  checked: state === vscode.TreeItemCheckboxState.Checked,
                }))
              );
            });

      return {
        dispose(): void {
          bridge?.dispose();
          treeView.dispose();
          source.dispose?.();
        },
      };
    },
  };
}
