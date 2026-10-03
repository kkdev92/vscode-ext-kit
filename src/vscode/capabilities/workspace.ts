import * as vscode from 'vscode';

import type { WorkspaceCapability } from '../../foundation/platform/ports.js';

/**
 * The workspace folders, straight from `vscode.workspace`.
 *
 * Nothing is converted. A `vscode.WorkspaceFolder` already has the port's
 * shape, and which folder a resource belongs to — nesting, letter case, a
 * remote or virtual file system — is VS Code's to decide, so it is asked rather
 * than re-derived here. Every call reads the workspace as it is now.
 */
export function createVSCodeWorkspaceCapability(): WorkspaceCapability {
  return {
    folders: () => vscode.workspace.workspaceFolders ?? [],
    folderOf: (uri) => vscode.workspace.getWorkspaceFolder(uri as vscode.Uri),
    relativePath: (uri, includeFolderName) =>
      vscode.workspace.asRelativePath(uri as vscode.Uri, includeFolderName),
    onDidChangeFolders: (listener) =>
      vscode.workspace.onDidChangeWorkspaceFolders(() => {
        listener();
      }),
  };
}
