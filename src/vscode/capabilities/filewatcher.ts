/**
 * File-watcher adapter. It translates only pattern construction and native
 * event/disposal shapes; filtering, debouncing, ignore rules and operation
 * handling belong to the managed watcher above this port.
 */
import * as vscode from 'vscode';

import type {
  FileWatcherCapability,
  FileWatcherHandle,
  RelativePatternLike,
} from '../../foundation/platform/ports.js';

/**
 * The real file-watching capability, backed by
 * `vscode.workspace.createFileSystemWatcher`.
 *
 * A relative pattern carries an opaque base URI through the port. Rebuild the
 * nominal `RelativePattern` here rather than teaching the capability layer how
 * VS Code represents it. The returned handle owns the native watcher; the
 * application registration scope owns that handle.
 *
 * @example
 * ```ts
 * const capability = createVSCodeFileWatcherCapability();
 * ```
 */
export function createVSCodeFileWatcherCapability(): FileWatcherCapability {
  return {
    watch(
      pattern: string | RelativePatternLike,
      options: {
        readonly ignoreCreateEvents: boolean;
        readonly ignoreChangeEvents: boolean;
        readonly ignoreDeleteEvents: boolean;
      }
    ): FileWatcherHandle {
      const globPattern: vscode.GlobPattern =
        typeof pattern === 'string'
          ? pattern
          : new vscode.RelativePattern(pattern.baseUri as vscode.Uri, pattern.pattern);

      const watcher = vscode.workspace.createFileSystemWatcher(
        globPattern,
        options.ignoreCreateEvents,
        options.ignoreChangeEvents,
        options.ignoreDeleteEvents
      );

      return {
        onDidCreate: (listener) => watcher.onDidCreate(listener),
        onDidChange: (listener) => watcher.onDidChange(listener),
        onDidDelete: (listener) => watcher.onDidDelete(listener),
        dispose: () => {
          watcher.dispose();
        },
      };
    },
  };
}
