// Drives a real VS Code Extension Host, then asserts the shutdown ordering the
// framework's design depends on.
//
// The ordering claim (deactivate() is awaited to completion, and only then are
// context.subscriptions disposed) came from reading VS Code's source. This checks
// it against the shipped product, on whichever version is under test.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

import { runTests } from '@vscode/test-electron';

const here = import.meta.dirname;
const extensionDevelopmentPath = resolve(here);
const extensionTestsPath = resolve(here, 'out/test/index.js');

const scratch = mkdtempSync(join(tmpdir(), 'ext-kit-eh-'));
const markerFile = join(scratch, 'markers.log');
const workspace = join(scratch, 'workspace');
writeFileSync(markerFile, '', 'utf8');

const version = process.env['VSCODE_VERSION'] ?? 'stable';

/** Fails with the full marker log, which is the only useful diagnostic here. */
function fail(message, markers) {
  throw new Error(`${message}\n\nmarkers:\n${markers.map((m) => `  ${m}`).join('\n')}`);
}

try {
  await runTests({
    version,
    extensionDevelopmentPath,
    extensionTestsPath,
    // A clean, trusted, extension-free host: the fixture must be the only thing
    // affecting the ordering under test.
    launchArgs: [
      workspace,
      '--disable-extensions',
      '--disable-workspace-trust',
      '--disable-gpu',
      '--no-sandbox',
      `--user-data-dir=${join(scratch, 'user-data')}`,
    ],
    extensionTestsEnv: { VSCODE_EXT_KIT_MARKERS: markerFile },
  });

  const markers = readFileSync(markerFile, 'utf8').split('\n').filter(Boolean);
  const index = (name) => markers.findIndex((entry) => entry.startsWith(name));

  const probe = markers.find((entry) => entry.startsWith('probe:'));
  if (probe !== undefined) {
    process.stdout.write(`runtime probe: ${probe.slice('probe:'.length)}\n`);
  }

  for (const required of [
    'activate:start',
    'activate:end',
    'hosted:start',
    'command:invoked',
    'test:done',
    'deactivate:start',
    'hosted:stop',
    'deactivate:end',
  ]) {
    if (index(required) === -1) {
      fail(`missing marker "${required}"`, markers);
    }
  }

  if (index('hosted:start') > index('activate:end')) {
    fail('hosted service started after activation completed', markers);
  }
  if (index('hosted:stop') < index('deactivate:start')) {
    fail('hosted service stopped before deactivate began', markers);
  }
  if (index('hosted:stop') > index('deactivate:end')) {
    fail('hosted service stopped after deactivate finished', markers);
  }

  // MEASURED, and it contradicts what VS Code's source suggested: the
  // subscriptions are disposed *while* deactivate() is still pending, not after
  // it resolves. So the failsafe is NOT a no-op by virtue of ordering.
  //
  // What has to hold is therefore stronger and order-independent: whenever the
  // failsafe fires, cleanup must still happen exactly once and deactivate must
  // still run to completion. That is what a state-guarded, idempotent
  // beginStop()/stop() buys, and it is what is asserted here.
  const count = (name) => markers.filter((entry) => entry.startsWith(name)).length;

  const subscription = index('subscription:dispose');
  if (subscription === -1) {
    process.stdout.write('note: context.subscriptions were not disposed before exit\n');
  } else if (subscription < index('deactivate:end')) {
    process.stdout.write(
      'observed: context.subscriptions disposed DURING deactivate() ' +
        '(the failsafe fires mid-flight, so it must be idempotent)\n'
    );
  } else {
    process.stdout.write('observed: context.subscriptions disposed after deactivate() finished\n');
  }

  if (count('hosted:stop') !== 1) {
    fail(
      `hosted service stopped ${String(count('hosted:stop'))} times; the failsafe firing ` +
        'during deactivate must not run cleanup twice',
      markers
    );
  }
  if (count('deactivate:end') !== 1) {
    fail('deactivate() did not run to completion exactly once', markers);
  }
  process.stdout.write(
    'confirmed: cleanup ran exactly once and deactivate() completed, ' +
      'despite the failsafe firing during it\n'
  );

  // The webview view lifecycle. Whether closing the sidebar tears the webview
  // down is the workbench's decision and could differ by version or window
  // state, so a second resolve is reported rather than required — failing on it
  // would make this lane flaky for a reason that is not the framework's. What
  // IS required: if a second incarnation did appear, the first one's channel
  // must be closed. Otherwise every show/hide cycle leaks one.
  if (index('view:resolve:1') === -1) {
    fail('the declared webview view was never resolved by the real host', markers);
  }
  const report = markers.find((entry) => entry.startsWith('view:report:'));
  if (index('view:resolve:2') === -1) {
    process.stdout.write(
      `note: this host kept one webview view incarnation across hide/show (${String(report)})\n`
    );
  } else if (report === 'view:report:2:closed') {
    process.stdout.write(
      'confirmed: hiding the view ended its incarnation and the framework ' +
        "closed that incarnation's RPC channel\n"
    );
  } else {
    fail(
      "a second view incarnation was resolved but the first one's RPC channel is still " +
        `open, so each show/hide cycle leaks one (${String(report)})`,
      markers
    );
  }

  // The tree view's change-event bridge. `createTreeView` reads the provider's
  // `onDidChangeTreeData`, which the adapter serves from an emitter fed by a
  // subscription on the source; both are adapter-owned and must go with the
  // view. The fixture's source counts the subscriptions it hands out and the
  // ones it gets back, so an adapter that forgets to unsubscribe shows up as
  // `taken 1, released 0` — which is exactly what 4.0.0 did.
  const tree = markers.find((entry) => entry.startsWith('tree:subscription:'));
  if (tree === undefined) {
    fail('the tree source never reported its change-event subscriptions', markers);
  }
  const [, , taken, released] = tree.split(':');
  if (taken !== '1' || released !== '1') {
    fail(
      `tree change-event subscription: taken ${taken}, released ${released}; ` +
        'the adapter must release exactly what it took',
      markers
    );
  }
  process.stdout.write(
    'confirmed: the tree change-event subscription was released with the view\n'
  );

  process.stdout.write(`extension host contract OK (VS Code ${version})\n`);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
