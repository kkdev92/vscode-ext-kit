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
 *
 * Ownership: the registration returned by `create` releases everything this
 * adapter built for a view — the native view, the checkbox listener and the
 * change-event bridge — and nothing else. The source itself belongs to whoever
 * resolved it; for a module-declared view that is the module scope, which owns
 * the provider ahead of the view so the view unwinds first.
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

/**
 * A provider in VS Code's shape, plus the bridge it needed to get there.
 *
 * The bridge — the subscription taken on the source and the emitter the
 * platform listens to — is adapter-owned: nothing above the port knows it
 * exists, so nothing above the port can release it. It is handed back beside
 * the provider and dies with the view registration.
 */
interface TreeDataProviderBridge<T> {
  readonly provider: vscode.TreeDataProvider<T>;
  dispose(): void;
}

/** Wraps a vscode-free source in the shape VS Code's tree view expects. */
function toTreeDataProvider<T>(source: TreeDataSource<T>): TreeDataProviderBridge<T> {
  const provider: vscode.TreeDataProvider<T> = {
    getTreeItem: (element) => toTreeItem(source.getTreeItem(element)),
    getChildren: (element) => source.getChildren(element),
    ...(source.getParent === undefined
      ? {}
      : { getParent: (element: T) => source.getParent?.(element) }),
  };

  if (source.onDidChangeTreeData === undefined) {
    return { provider, dispose: () => undefined };
  }

  // Bridged through a VS Code emitter because the platform reads
  // `onDidChangeTreeData` as its own Event, not as a plain subscribe function.
  const emitter = new vscode.EventEmitter<T | undefined>();
  const subscription = source.onDidChangeTreeData((element) => {
    emitter.fire(element);
  });
  provider.onDidChangeTreeData = emitter.event;

  return {
    provider,
    dispose(): void {
      // The subscription first, so nothing the source fires from here on
      // reaches an emitter that is about to go; then the emitter itself.
      subscription.dispose();
      emitter.dispose();
    },
  };
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
      const dataProvider = toTreeDataProvider(typed);

      const treeView = vscode.window.createTreeView(viewId, {
        treeDataProvider: dataProvider.provider,
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
      const checkboxBridge =
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

      // Everything this adapter created, and nothing it did not. The source is
      // deliberately left alone: the port makes provider disposal the caller's
      // responsibility, and the application already owns the provider in the
      // module scope — disposing it here as well made every provider go twice.
      let disposed = false;
      return {
        dispose(): void {
          if (disposed) {
            return;
          }
          disposed = true;
          checkboxBridge?.dispose();
          treeView.dispose();
          dataProvider.dispose();
        },
      };
    },
  };
}
