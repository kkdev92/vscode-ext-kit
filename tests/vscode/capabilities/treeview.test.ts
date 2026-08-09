import { describe, expect, it, vi } from 'vitest';

import type { TreeDataSource, TreeItemLike } from '../../../src/foundation/platform/ports.js';

/**
 * A stand-in for the tree view corner of `vscode`.
 *
 * Only the adapter is exercised here — the provider logic moved to
 * tests/capabilities/views/tree.test.ts, where it needs no mock at all. What is
 * left to check is the translation: plain rows in, platform `TreeItem`s out.
 *
 * Update this suite when the tree port gains a field/event or the adapter starts
 * using another nominal VS Code value. Provider algorithms belong in the
 * vscode-free capability suite; actual workbench rendering belongs in the
 * Extension Host lane.
 */
const vscodeMock = vi.hoisted(() => {
  class EventEmitter<T> {
    private readonly listeners = new Set<(event: T) => void>();
    event = (listener: (event: T) => void): { dispose(): void } => {
      this.listeners.add(listener);
      return {
        dispose: (): void => {
          this.listeners.delete(listener);
        },
      };
    };
    fire(event: T): void {
      for (const listener of [...this.listeners]) {
        listener(event);
      }
    }
    dispose(): void {
      this.listeners.clear();
    }
  }

  class TreeItem {
    // `declare` rather than a field declaration: an emitted class field would
    // be defined as `undefined` at construction. This stand-in must preserve
    // the distinction between adapter omission and an explicit assignment.
    declare id?: string;
    declare description?: string | boolean;
    declare tooltip?: unknown;
    declare iconPath?: unknown;
    declare resourceUri?: unknown;
    declare checkboxState?: unknown;
    declare command?: unknown;
    declare contextValue?: string;
    label: unknown;
    collapsibleState?: number | undefined;
    constructor(label: unknown, collapsibleState?: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  }

  class ThemeIcon {
    readonly id: string;
    readonly color: unknown;
    constructor(id: string, color?: unknown) {
      this.id = id;
      this.color = color;
    }
  }

  class ThemeColor {
    readonly id: string;
    constructor(id: string) {
      this.id = id;
    }
  }

  class DataTransferItem {
    readonly value: unknown;
    constructor(value: unknown) {
      this.value = value;
    }
    asString(): Promise<string> {
      return Promise.resolve(String(this.value));
    }
  }

  interface CreatedView {
    viewId: string;
    options: Record<string, unknown>;
    view: { dispose(): void; disposed: boolean };
    checkboxEmitter: EventEmitter<unknown>;
  }
  const createdViews: CreatedView[] = [];

  return {
    createdViews,
    module: {
      EventEmitter,
      TreeItem,
      ThemeIcon,
      ThemeColor,
      DataTransferItem,
      TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
      TreeItemCheckboxState: { Unchecked: 0, Checked: 1 },
      window: {
        createTreeView(viewId: string, options: Record<string, unknown>) {
          const checkboxEmitter = new EventEmitter<unknown>();
          const view = {
            onDidChangeCheckboxState: checkboxEmitter.event,
            disposed: false,
            dispose(): void {
              view.disposed = true;
            },
          };
          createdViews.push({ viewId, options, view, checkboxEmitter });
          return view;
        },
      },
    },
  };
});

vi.mock('vscode', () => vscodeMock.module);

const { createVSCodeTreeViewCapability } =
  await import('../../../src/vscode/capabilities/treeview.js');

interface Row {
  readonly id: string;
}

/** A minimal source: enough to drive the adapter, no provider logic involved. */
function sourceOf(
  render: (element: Row) => TreeItemLike,
  extra: Partial<TreeDataSource<Row>> = {}
): TreeDataSource<Row> {
  return {
    getTreeItem: render,
    getChildren: () => [{ id: 'a' }],
    ...extra,
  };
}

/** Creates a view and returns what the platform was handed. */
function create(source: TreeDataSource<Row>, options = {}) {
  vscodeMock.createdViews.length = 0;
  const registration = createVSCodeTreeViewCapability().create(
    'sample.tree',
    source as TreeDataSource<never>,
    options
  );
  const created = vscodeMock.createdViews[0];
  if (created === undefined) {
    throw new Error('no view was created');
  }
  const provider = created.options['treeDataProvider'] as {
    getTreeItem(element: Row): InstanceType<typeof vscodeMock.module.TreeItem>;
    getChildren(element?: Row): unknown;
    getParent?(element: Row): unknown;
    onDidChangeTreeData?: (listener: (element: Row | undefined) => void) => { dispose(): void };
  };
  return { registration, created, provider };
}

describe('rendering a row', () => {
  it('carries every field onto the platform TreeItem', () => {
    const uri = { scheme: 'file', path: '/a.ts', toString: () => 'file:///a.ts' };
    const { provider } = create(
      sourceOf(() => ({
        id: 'x',
        label: 'X',
        description: 'desc',
        tooltip: 'hover',
        contextValue: 'ctx',
        collapsibleState: 2,
        checkboxState: 1,
        resourceUri: uri,
        command: { command: 'ext.run', title: 'Run', arguments: [1] },
      }))
    );

    const item = provider.getTreeItem({ id: 'x' });

    expect(item).toMatchObject({
      id: 'x',
      label: 'X',
      description: 'desc',
      tooltip: 'hover',
      contextValue: 'ctx',
      collapsibleState: 2,
      checkboxState: 1,
      resourceUri: uri,
      command: { command: 'ext.run', title: 'Run', arguments: [1] },
    });
  });

  it('leaves an absent field absent rather than setting it to undefined', () => {
    const { provider } = create(sourceOf(() => ({ id: 'x', label: 'X' })));

    const item = provider.getTreeItem({ id: 'x' });

    // Check own shape, not merely value: `item.description === undefined`
    // cannot distinguish omission from an explicit assignment.
    expect('description' in item).toBe(false);
    expect('command' in item).toBe(false);
  });

  it('turns a bare string icon into a ThemeIcon', () => {
    const { provider } = create(sourceOf(() => ({ id: 'x', label: 'X', icon: 'folder' })));

    expect(provider.getTreeItem({ id: 'x' }).iconPath).toBeInstanceOf(vscodeMock.module.ThemeIcon);
    expect(provider.getTreeItem({ id: 'x' }).iconPath).toMatchObject({ id: 'folder' });
  });

  it('carries an icon colour through', () => {
    const { provider } = create(
      sourceOf(() => ({ id: 'x', label: 'X', icon: { id: 'error', color: 'errorForeground' } }))
    );

    expect(provider.getTreeItem({ id: 'x' }).iconPath).toMatchObject({
      id: 'error',
      color: { id: 'errorForeground' },
    });
  });

  it('passes an image uri and a light/dark pair straight through', () => {
    const light = { scheme: 'file', path: '/l.svg', toString: () => 'file:///l.svg' };
    const dark = { scheme: 'file', path: '/d.svg', toString: () => 'file:///d.svg' };

    expect(
      create(sourceOf(() => ({ id: 'x', label: 'X', icon: { uri: light } }))).provider.getTreeItem({
        id: 'x',
      }).iconPath
    ).toBe(light);
    expect(
      create(sourceOf(() => ({ id: 'x', label: 'X', icon: { light, dark } }))).provider.getTreeItem(
        {
          id: 'x',
        }
      ).iconPath
    ).toEqual({ light, dark });
  });

  it('flattens a markdown tooltip to its text', () => {
    const { provider } = create(
      sourceOf(() => ({ id: 'x', label: 'X', tooltip: { value: '**bold**' } }))
    );

    expect(provider.getTreeItem({ id: 'x' }).tooltip).toBe('**bold**');
  });
});

describe('wiring the view', () => {
  it('forwards the declared options', () => {
    const { created } = create(
      sourceOf(() => ({ id: 'x', label: 'X' })),
      {
        showCollapseAll: true,
        canSelectMany: true,
      }
    );

    expect(created.viewId).toBe('sample.tree');
    expect(created.options).toMatchObject({ showCollapseAll: true, canSelectMany: true });
  });

  it('omits getParent when the source has none, so reveal is honestly unsupported', () => {
    const withoutParent = create(sourceOf(() => ({ id: 'x', label: 'X' })));
    // Absent, not undefined: VS Code decides whether reveal is available by
    // whether the provider has the method at all.
    expect('getParent' in withoutParent.provider).toBe(false);

    const withParent = create(
      sourceOf(() => ({ id: 'x', label: 'X' }), { getParent: () => undefined })
    );
    expect('getParent' in withParent.provider).toBe(true);
  });

  it('bridges the source change event into the platform event', () => {
    let notify: ((element: Row | undefined) => void) | undefined;
    const { provider } = create(
      sourceOf(() => ({ id: 'x', label: 'X' }), {
        onDidChangeTreeData: (listener) => {
          notify = listener;
          return { dispose: () => undefined };
        },
      })
    );

    const seen: (Row | undefined)[] = [];
    provider.onDidChangeTreeData?.((element) => seen.push(element));
    notify?.({ id: 'a' });
    notify?.(undefined);

    expect(seen).toEqual([{ id: 'a' }, undefined]);
  });

  it('reports checkbox toggles back to the source', () => {
    const changes: unknown[] = [];
    const { created } = create(
      sourceOf(() => ({ id: 'x', label: 'X' }), {
        reportCheckboxChange: (next) => changes.push(...next),
      })
    );

    created.checkboxEmitter.fire({
      items: [
        [{ id: 'a' }, 1],
        [{ id: 'b' }, 0],
      ],
    });

    expect(changes).toEqual([
      { element: { id: 'a' }, checked: true },
      { element: { id: 'b' }, checked: false },
    ]);
  });

  it('wires no checkbox bridge when the source does not want one', () => {
    const { created } = create(sourceOf(() => ({ id: 'x', label: 'X' })));

    // Firing must not throw, and nothing should be listening.
    expect(() => created.checkboxEmitter.fire({ items: [] })).not.toThrow();
  });

  it('builds the drag controller from the declaration', async () => {
    const dropped: { ids: readonly string[]; target: Row | undefined }[] = [];
    const { created } = create(
      sourceOf(() => ({ id: 'x', label: 'X' })),
      {
        dragAndDrop: {
          mimeType: 'application/vnd.code.tree.sample',
          onDrop: (ids: readonly string[], target: Row | undefined) => {
            dropped.push({ ids, target });
          },
        },
      }
    );

    const controller = created.options['dragAndDropController'] as {
      dropMimeTypes: string[];
      dragMimeTypes: string[];
      handleDrag(source: Row[], transfer: { set(mime: string, item: unknown): void }): void;
      handleDrop(
        target: Row | undefined,
        transfer: { get(mime: string): { asString(): Promise<string> } | undefined }
      ): Promise<void>;
    };
    expect(controller.dropMimeTypes).toEqual(['application/vnd.code.tree.sample']);

    const carried = new Map<string, unknown>();
    controller.handleDrag([{ id: 'a' }, { id: 'b' }], {
      set: (mime, item) => carried.set(mime, item),
    });
    await controller.handleDrop(
      { id: 'target' },
      {
        get: (mime) => carried.get(mime) as { asString(): Promise<string> } | undefined,
      }
    );

    // Only ids cross the drag; that is what survives its serialization.
    expect(dropped).toEqual([{ ids: ['a', 'b'], target: { id: 'target' } }]);
  });

  it('ignores a drop payload that is not a list of ids', async () => {
    // `handleDrag` writes this payload, but nothing guarantees the drop came
    // from there: the mime type is the extension's own declared string, and any
    // producer that writes it lands here. `onDrop` promises `readonly string[]`,
    // so a payload that is not one must not reach it with the types lying.
    for (const payload of ['not json', '"a string"', '42', 'null', '{"ids":["a"]}', '["a",1]']) {
      const dropped: unknown[] = [];
      const { created } = create(
        sourceOf(() => ({ id: 'x', label: 'X' })),
        {
          dragAndDrop: {
            mimeType: 'application/vnd.code.tree.sample',
            onDrop: (ids: readonly string[]) => dropped.push(ids),
          },
        }
      );
      const controller = created.options['dragAndDropController'] as {
        handleDrop(
          target: Row | undefined,
          transfer: { get(mime: string): { asString(): Promise<string> } | undefined }
        ): Promise<void>;
      };

      await expect(
        controller.handleDrop(undefined, {
          get: () => ({ asString: () => Promise.resolve(payload) }),
        })
      ).resolves.toBeUndefined();

      expect(dropped, `payload ${payload} reached onDrop`).toEqual([]);
    }
  });

  it('accepts an empty id list, which is a valid drop', async () => {
    const dropped: unknown[] = [];
    const { created } = create(
      sourceOf(() => ({ id: 'x', label: 'X' })),
      {
        dragAndDrop: {
          mimeType: 'application/vnd.code.tree.sample',
          onDrop: (ids: readonly string[]) => dropped.push(ids),
        },
      }
    );
    const controller = created.options['dragAndDropController'] as {
      handleDrop(
        target: Row | undefined,
        transfer: { get(mime: string): { asString(): Promise<string> } | undefined }
      ): Promise<void>;
    };

    await controller.handleDrop(undefined, {
      get: () => ({ asString: () => Promise.resolve('[]') }),
    });

    expect(dropped).toEqual([[]]);
  });

  it('does nothing on a drop carrying no payload for its mime type', async () => {
    const dropped: unknown[] = [];
    const { created } = create(
      sourceOf(() => ({ id: 'x', label: 'X' })),
      {
        dragAndDrop: {
          mimeType: 'application/vnd.code.tree.sample',
          onDrop: () => dropped.push(1),
        },
      }
    );
    const controller = created.options['dragAndDropController'] as {
      handleDrop(target: undefined, transfer: { get(): undefined }): Promise<void>;
    };

    await controller.handleDrop(undefined, { get: () => undefined });

    expect(dropped).toEqual([]);
  });
});

describe('disposal', () => {
  it('disposes the view and the source it renders', () => {
    const disposed: string[] = [];
    const { registration, created } = create(
      sourceOf(() => ({ id: 'x', label: 'X' }), {
        dispose: () => disposed.push('source'),
      })
    );

    registration.dispose();

    expect(created.view.disposed).toBe(true);
    expect(disposed).toEqual(['source']);
  });

  it('tolerates a source with no dispose', () => {
    const { registration } = create(sourceOf(() => ({ id: 'x', label: 'X' })));

    expect(() => registration.dispose()).not.toThrow();
  });
});
