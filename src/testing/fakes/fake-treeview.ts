/**
 * Recording implementation of the tree-view port.
 *
 * It proves which source/options the application registered and whether the
 * registration was released. It does not render rows or emulate workbench
 * selection, reveal, drag/drop, checkbox, refresh scheduling or visibility;
 * drive the vscode-free source directly or use adapter/Extension Host tests.
 */
import type {
  PlatformRegistration,
  TreeDataSource,
  TreeViewCapability,
  TreeViewOptionsLike,
} from '../../foundation/platform/ports.js';

/** One fake tree view registration. */
export interface FakeTreeView {
  readonly id: string;
  /**
   * The source handed to the platform, exactly as resolved.
   *
   * Drivable directly: a source is vscode-free, so a test can call
   * `getChildren`, `getTreeItem` and `reportCheckboxChange` on it without a
   * view existing at all.
   */
  readonly source: TreeDataSource<never>;
  readonly options: TreeViewOptionsLike;
  readonly disposed: boolean;
}

/** A fake tree view capability that records every view it creates. */
export interface FakeTreeViews extends TreeViewCapability {
  /** Every view created, in order, including disposed ones. */
  readonly views: readonly FakeTreeView[];
}

/**
 * Creates a fake tree-view registry.
 * Disposed records stay in `views` as history; inspect `disposed` for liveness.
 */
export function createFakeTreeViews(): FakeTreeViews {
  const views: (FakeTreeView & { disposed: boolean })[] = [];

  return {
    views,
    create(
      id: string,
      source: TreeDataSource<never>,
      options: TreeViewOptionsLike
    ): PlatformRegistration {
      const view = { id, source, options, disposed: false };
      views.push(view);
      return {
        dispose(): void {
          view.disposed = true;
        },
      };
    },
  };
}
