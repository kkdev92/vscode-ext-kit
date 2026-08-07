import * as vscode from 'vscode';

/** Minimal assertion helper: `node:assert` is not available in a worker. */
function check(condition: boolean, message: string): asserts condition {
  if (!condition) {
    throw new Error(`web fixture: ${message}`);
  }
}

interface FixtureExports {
  readonly trace: readonly string[];
}

/**
 * Entry point for `extensionTestsPath` in the browser host.
 *
 * Answers the question the desktop lane cannot: does the runtime core actually
 * load and run in a Web Worker, and which modern runtime features are present
 * there? The worker's engine is the user's browser, which VS Code does not pin.
 */
export async function run(): Promise<void> {
  const extension = vscode.extensions.getExtension<FixtureExports>(
    'ext-kit-fixtures.web-extension'
  );
  check(extension !== undefined, 'extension was not found by VS Code');

  const exports = await extension.activate();
  check(extension.isActive, 'extension did not activate in the web host');

  // Confirms we really are in the browser/worker host and not the desktop one.
  check(vscode.env.uiKind === vscode.UIKind.Web, 'expected the Web UI kind');

  const result = await vscode.commands.executeCommand<string>('extKitWebFixture.probe');
  check(
    /^command:extKitWebFixture\.probe#\d+$/.test(result ?? ''),
    `command result did not cross the worker boundary: ${String(result)}`
  );

  const trace = exports.trace;
  check(trace.includes('activate:start'), 'activation did not begin');
  check(trace.includes('activate:end'), 'activation did not complete');
  check(trace.includes('hosted:start'), 'hosted service did not start');
  // Settings resolved through the real VS Code configuration service, in a worker.
  check(trace.includes('command:true'), `settings default was not read: ${trace.join(', ')}`);

  const globals = globalThis as {
    DisposableStack?: unknown;
    AsyncDisposableStack?: unknown;
  };
  const probe = {
    vscode: vscode.version,
    uiKind: 'web',
    abortSignalAny: typeof AbortSignal.any,
    abortSignalTimeout: typeof AbortSignal.timeout,
    symbolDispose: typeof (Symbol as { dispose?: symbol }).dispose,
    symbolAsyncDispose: typeof (Symbol as { asyncDispose?: symbol }).asyncDispose,
    disposableStack: typeof globals.DisposableStack,
    asyncDisposableStack: typeof globals.AsyncDisposableStack,
    aggregateError: typeof AggregateError,
  };

  // The worker console is forwarded to the driver's stdout, which is the only way
  // to report out of here. This records what the harness browser offers; the
  // framework must not *depend* on any of it, because the worker engine is
  // whatever browser the user happens to have.
  console.log(`EXT_KIT_WEB_PROBE ${JSON.stringify(probe)}`);
  console.log('EXT_KIT_WEB_OK');
}
