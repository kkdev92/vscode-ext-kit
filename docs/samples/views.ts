import {
  BaseTreeDataProvider,
  defineCommandContract,
  defineModule,
  serviceToken,
  TreeItemCollapsible,
  Webviews,
  type ManagedWebview,
  type TreeItemData,
} from '@kkdev92/vscode-ext-kit';

interface FileNode extends TreeItemData {
  readonly path: string;
}

// A provider is plain logic: no `vscode` import, so a test drives it directly
// instead of through a mock of the platform.
class FileTree extends BaseTreeDataProvider<FileNode> {
  getRoots(): FileNode[] {
    return [
      {
        id: 'src',
        label: 'src',
        path: '/src',
        // A bare string is a theme icon id, which covers almost every row.
        icon: 'folder',
        collapsibleState: TreeItemCollapsible.Collapsed,
      },
    ];
  }

  getChildrenOf(element: FileNode): FileNode[] {
    return [
      {
        id: `${element.id}/index.ts`,
        label: 'index.ts',
        path: `${element.path}/index.ts`,
        icon: 'file',
      },
    ];
  }
}

const Tree = serviceToken<FileTree>('sample.fileTree');

export const OpenPreview = defineCommandContract<readonly [], void>({ id: 'sample.openPreview' });

export const viewsModule = defineModule('views', (module): undefined => {
  module.services.singleton(Tree, () => new FileTree());

  // Created at activation and disposed with the application. The view is
  // disposed before the provider it renders, so nothing renders into a
  // half-torn-down tree.
  module.treeViews.add({
    id: 'sample.files',
    inject: { tree: Tree },
    resolveProvider: ({ tree }) => tree,
    options: { showCollapseAll: true },
  });

  // A webview view is registered now and filled in when the user first opens
  // it — which is when VS Code asks for its content.
  module.webviews.addView<ManagedWebview>({
    id: 'sample.sidebar',
    options: { enableScripts: true },
    resolve: async (view) => {
      await view.setHtmlFromTemplate('media/sidebar.html', {
        title: 'Projects',
        cspSource: view.cspSource,
      });
    },
  });

  // A panel is opened from a handler through the injected service, and the
  // service is container-owned: a panel cannot outlive the extension.
  module.commands.handle(OpenPreview, {
    inject: { webviews: Webviews },
    execute: async (_context, _args, { webviews }) => {
      const panel = webviews.openPanel({ viewType: 'sample.preview', title: 'Preview' });
      await panel.setHtmlFromTemplate('media/preview.html', { title: 'Preview' });
    },
  });

  return undefined;
});
