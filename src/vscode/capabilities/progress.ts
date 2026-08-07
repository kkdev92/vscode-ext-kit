/**
 * Progress adapter. It keeps the framework's string-valued location and small
 * reporter/token ports independent from VS Code's enums and `Thenable` types.
 */
import * as vscode from 'vscode';

import type {
  CancellationTokenLike,
  ProgressArea,
  ProgressCapability,
  ProgressReporterLike,
} from '../../foundation/platform/ports.js';

function toLocation(area: ProgressArea): vscode.ProgressLocation {
  switch (area) {
    case 'window':
      return vscode.ProgressLocation.Window;
    case 'source-control':
      return vscode.ProgressLocation.SourceControl;
    case 'notification':
      return vscode.ProgressLocation.Notification;
  }
}

/**
 * The real progress capability, backed by `vscode.window.withProgress`.
 *
 * Cancellation is advisory: the native token is forwarded unchanged through
 * its structural port, and the task must observe it. This adapter must not turn
 * a cancel request into an exception on the task's behalf.
 */
export function createVSCodeProgressCapability(): ProgressCapability {
  return {
    run<T>(
      options: {
        readonly title: string;
        readonly location: ProgressArea;
        readonly cancellable: boolean;
      },
      task: (reporter: ProgressReporterLike, token: CancellationTokenLike) => Promise<T>
    ): Promise<T> {
      // Normalize VS Code's Thenable to a native Promise at the port boundary.
      return Promise.resolve(
        vscode.window.withProgress(
          {
            location: toLocation(options.location),
            title: options.title,
            cancellable: options.cancellable,
          },
          (progress, token) => task(progress, token)
        )
      );
    },
  };
}
