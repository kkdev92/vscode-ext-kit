/**
 * In-memory workspace folders for tests.
 *
 * Lookups follow VS Code's rules for what a test usually arranges — `/`-paths
 * under one scheme. The innermost folder wins when folders nest, and a folder
 * itself is looked up from its parent. A resource in no folder comes back as
 * its file system path, and with more than one folder open a relative path
 * starts with the folder's name.
 *
 * Two simplifications, both stated here so a test does not lean on them:
 * letter case is compared exactly, as VS Code does on Linux (on Windows and
 * macOS it ignores case for `file` URIs), and a URI's authority is not
 * compared. The real adapter is checked against VS Code itself in the
 * Extension Host lane.
 */
import type {
  PlatformRegistration,
  ResourceUri,
  WatchedUri,
  WorkspaceCapability,
  WorkspaceFolderLike,
} from '../../foundation/platform/ports.js';
import { fakeUri } from './fake-filewatcher.js';

/** A folder to open: a path, or a URI with an optional name. */
export type FakeWorkspaceFolder = string | { readonly uri: WatchedUri; readonly name?: string };

/** Workspace folders a test arranges. */
export interface FakeWorkspace extends WorkspaceCapability {
  /**
   * Replaces the open folders and fires the change event, the way adding or
   * removing a folder in VS Code does. The folder count runtime preflight reads
   * is the environment's, and stays as it was.
   */
  _setFolders(folders: readonly FakeWorkspaceFolder[]): void;
}

/** A path without its trailing separators, except the root itself. */
function trimmed(path: string): string {
  let end = path.length;
  while (end > 1 && path[end - 1] === '/') {
    end -= 1;
  }
  return path.slice(0, end);
}

function parentOf(path: string): string {
  const cut = path.lastIndexOf('/');
  return cut <= 0 ? '/' : path.slice(0, cut);
}

function contains(folder: string, path: string): boolean {
  return path === folder || path.startsWith(folder === '/' ? '/' : `${folder}/`);
}

function toFolders(folders: readonly FakeWorkspaceFolder[]): readonly WorkspaceFolderLike[] {
  return folders.map((folder, index) => {
    const uri = typeof folder === 'string' ? fakeUri(folder) : folder.uri;
    const path = trimmed(uri.path);
    const name = typeof folder === 'string' ? undefined : folder.name;
    return { uri, name: name ?? path.slice(path.lastIndexOf('/') + 1), index };
  });
}

/**
 * Creates fake workspace folders, one at `/workspace` unless told otherwise.
 *
 * @example
 * ```ts
 * const workspace = createFakeWorkspace(['/repo', '/docs']);
 * workspace.relativePath(fakeUri('/docs/guide.md')); // 'docs/guide.md'
 * workspace._setFolders([]);                          // fires onDidChangeFolders
 * ```
 */
export function createFakeWorkspace(
  folders: readonly FakeWorkspaceFolder[] = ['/workspace']
): FakeWorkspace {
  let current = toFolders(folders);
  const listeners = new Set<{ readonly listener: () => void }>();

  const innermost = (scheme: string, path: string): WorkspaceFolderLike | undefined => {
    let found: WorkspaceFolderLike | undefined;
    for (const folder of current) {
      const folderPath = trimmed(folder.uri.path);
      if (
        folder.uri.scheme === scheme &&
        contains(folderPath, path) &&
        (found === undefined || folderPath.length > trimmed(found.uri.path).length)
      ) {
        found = folder;
      }
    }
    return found;
  };

  return {
    folders: () => current,

    folderOf: (uri: ResourceUri) => innermost(uri.scheme, trimmed(uri.path)),

    relativePath(uri: WatchedUri, includeFolderName?: boolean): string {
      const path = trimmed(uri.path);
      // A folder is looked up from its parent, so a folder nested in another
      // is named relative to the outer one, and one that is not comes back
      // whole.
      const isFolder = current.some(
        (folder) => folder.uri.scheme === uri.scheme && trimmed(folder.uri.path) === path
      );
      const folder = innermost(uri.scheme, isFolder ? parentOf(path) : path);
      if (folder === undefined) {
        return uri.fsPath;
      }
      const folderPath = trimmed(folder.uri.path);
      const relative = path.slice(folderPath === '/' ? 1 : folderPath.length + 1);
      const prefix = includeFolderName ?? current.length > 1;
      return prefix && folder.name !== '' ? `${folder.name}/${relative}` : relative;
    },

    onDidChangeFolders(listener: () => void): PlatformRegistration {
      const entry = { listener };
      listeners.add(entry);
      return {
        dispose: () => {
          listeners.delete(entry);
        },
      };
    },

    _setFolders(next: readonly FakeWorkspaceFolder[]): void {
      current = toFolders(next);
      for (const entry of [...listeners]) {
        entry.listener();
      }
    },
  };
}
