import assert from 'node:assert/strict';

import * as vscode from 'vscode';

import { mark } from '../markers.js';

/**
 * Entry point for `extensionTestsPath`.
 *
 * No test framework: VS Code awaits this function, and the process exits when it
 * resolves, which is exactly the shutdown the marker file is there to capture.
 */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension('ext-kit-fixtures.extension-host');
  assert.ok(extension, 'fixture extension was not found by VS Code');

  await extension.activate();
  assert.equal(extension.isActive, true, 'extension did not activate');

  // The framework registered this through the real capability, and the handler's
  // return value has to survive the real executeCommand round trip.
  const result = await vscode.commands.executeCommand<string>('extKitFixture.probe');
  assert.match(
    result ?? '',
    /^command:extKitFixture\.probe#\d+$/,
    `unexpected command result: ${String(result)}`
  );

  // A rejection from a handler must reach the caller rather than being swallowed.
  await assert.rejects(
    () => Promise.resolve(vscode.commands.executeCommand('extKitFixture.doesNotExist')),
    'executing an unregistered command should reject'
  );

  // A webview view through its real lifecycle. The framework gives each
  // incarnation its own RPC channel and closes it with that incarnation — a
  // claim about what VS Code does with a view, which only VS Code can settle.
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 600));

  await vscode.commands.executeCommand('extKitFixture.sidebar.focus');
  await settle();
  // Two ways to take the view off screen, because they are not the same thing
  // to the workbench: closing the sidebar merely hides it, while moving to
  // another container can retire the pane behind it.
  await vscode.commands.executeCommand('workbench.action.closeSidebar');
  await settle();
  await vscode.commands.executeCommand('workbench.view.scm');
  await settle();
  await vscode.commands.executeCommand('workbench.view.extensions');
  await settle();
  await vscode.commands.executeCommand('extKitFixture.sidebar.focus');
  await settle();

  mark(`view:report:${await vscode.commands.executeCommand<string>('extKitFixture.viewReport')}`);

  // Answers S-1/S-2: what the runtime actually offers in this host.
  const globals = globalThis as {
    DisposableStack?: unknown;
    AsyncDisposableStack?: unknown;
  };
  mark(
    `probe:${JSON.stringify({
      vscode: vscode.version,
      node: process.version,
      abortSignalAny: typeof AbortSignal.any,
      abortSignalTimeout: typeof AbortSignal.timeout,
      symbolDispose: typeof (Symbol as { dispose?: symbol }).dispose,
      symbolAsyncDispose: typeof (Symbol as { asyncDispose?: symbol }).asyncDispose,
      disposableStack: typeof globals.DisposableStack,
      asyncDisposableStack: typeof globals.AsyncDisposableStack,
      uiKind: vscode.env.uiKind === vscode.UIKind.Web ? 'web' : 'desktop',
      remoteName: vscode.env.remoteName ?? 'local',
    })}`
  );

  mark('test:done');
}
