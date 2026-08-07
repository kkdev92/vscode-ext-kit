/**
 * Takes a point-in-time snapshot of the VS Code host facts used by runtime
 * preflight. It intentionally exposes data, not the `vscode.env` and
 * `vscode.workspace` namespaces, so compatibility policy remains testable in
 * the foundation layer.
 */
import * as vscode from 'vscode';

import type { EnvironmentCapability, HostEnvironment } from '../../foundation/platform/ports.js';

/**
 * The real environment capability, backed by `vscode.env` and `vscode.workspace`.
 *
 * Read when the host asks rather than cached at module load. Trust and workspace
 * folders are session state, and module evaluation may happen before activation
 * establishes the environment the application will actually run in.
 *
 * @example
 * ```ts
 * const environment = createVSCodeEnvironmentCapability();
 * ```
 */
export function createVSCodeEnvironmentCapability(): EnvironmentCapability {
  return {
    read(): HostEnvironment {
      const folders = vscode.workspace.workspaceFolders ?? [];
      return {
        uiKind: vscode.env.uiKind === vscode.UIKind.Web ? 'web' : 'desktop',
        remoteName: vscode.env.remoteName,
        isTrusted: vscode.workspace.isTrusted,
        workspaceFolderCount: folders.length,
        // A mixed workspace is considered virtual-capable if any folder uses a
        // non-file scheme. This conservative answer prevents a module requiring
        // local file-system semantics from being enabled for only part of the
        // workspace.
        hasVirtualWorkspace: folders.some((folder) => folder.uri.scheme !== 'file'),
      };
    },
  };
}
