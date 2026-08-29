import * as vscode from 'vscode';

// The shape most extensions start from, and the one 2.x helpers were called
// from: an `activate` that registers everything, pushes each disposable onto
// `context.subscriptions`, and reads configuration wherever it happens to be
// needed. Nothing here is wrong. It is the inventory the steps work through.

let index: Map<string, number> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Async initialisation, awaited before anything is registered.
  index = await buildIndex();

  // A command that reads a setting at call time.
  context.subscriptions.push(
    vscode.commands.registerCommand('sample.countProjects', () => {
      const limit = vscode.workspace.getConfiguration('sample').get<number>('limit', 10);
      return Math.min(index?.size ?? 0, limit);
    })
  );

  // A watcher that keeps the index fresh, three callbacks at a time.
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.project.json');
  watcher.onDidCreate((uri) => index?.set(uri.fsPath, Date.now()));
  watcher.onDidChange((uri) => index?.set(uri.fsPath, Date.now()));
  watcher.onDidDelete((uri) => index?.delete(uri.fsPath));
  context.subscriptions.push(watcher);

  // A periodic job on a timer, disposed by hand.
  timer = setInterval(() => {
    void buildIndex().then((fresh) => (index = fresh));
  }, 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // A provider this package has no model for.
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: 'file' },
      { provideHover: () => new vscode.Hover(`${String(index?.size ?? 0)} projects`) }
    )
  );
}

export function deactivate(): void {
  index = undefined;
}

async function buildIndex(): Promise<Map<string, number>> {
  const files = await vscode.workspace.findFiles('**/*.project.json', '**/node_modules/**');
  return new Map(files.map((file) => [file.fsPath, Date.now()]));
}
