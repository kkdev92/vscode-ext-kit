import type * as vscode from 'vscode';

import { defineCommandContract, defineExtension, defineModule } from '../../../dist/index.js';
import type { ManagedWebview } from '../../../dist/index.js';
import { mark } from './markers.js';

const Probe = defineCommandContract<readonly [], string>({
  id: 'extKitFixture.probe',
  title: 'Probe',
});

const ViewReport = defineCommandContract<readonly [], string>({
  id: 'extKitFixture.viewReport',
  title: 'View Report',
});

/** One entry per incarnation of the webview view, oldest first. */
const channels: {
  request(method: string, params: unknown, options?: unknown): Promise<unknown>;
}[] = [];

const fixtureModule = defineModule('fixture', (module): undefined => {
  module.commands.handle(Probe, (context) => {
    mark('command:invoked');
    // Returned across the real extension-host boundary so the driver can check
    // that a handler's value reaches `executeCommand`.
    return context.id;
  });

  module.hostedServices.add({
    id: 'fixture.service',
    start: () => {
      mark('hosted:start');
    },
    stop: () => {
      mark('hosted:stop');
    },
  });

  // The framework gives each resolve its own RPC channel and closes it when
  // that incarnation ends, on the premise that VS Code re-resolves a view after
  // tearing it down. This measures the premise instead of assuming it — a fake
  // would agree with whatever the framework believes.
  //
  // MEASURED on 1.132.0 desktop: hiding the view does NOT end its incarnation.
  // Closing the sidebar and switching view containers both keep the same
  // webview, and the provider is asked once. So the per-incarnation teardown is
  // for the paths that do retire the pane, not for ordinary hide/show. The
  // driver reports what it saw and fails only if a second incarnation appears
  // while the first one's channel is still open.
  module.webviews.addView<ManagedWebview>({
    id: 'extKitFixture.sidebar',
    resolve: (view): undefined => {
      channels.push(view.rpc);
      mark(`view:resolve:${String(channels.length)}`);
      view.setHtml(
        `<!doctype html><html lang="en"><body>incarnation ${String(channels.length)}</body></html>`
      );
      return undefined;
    },
  });

  // Reports what the real host did to the view, from inside the extension where
  // the channels can actually be probed.
  module.commands.handle(ViewReport, async () => {
    const first = channels[0];
    if (first === undefined) {
      return 'never-resolved';
    }
    // A live channel would simply wait — nothing in the page answers — so the
    // timeout is how "still open" is told apart from "closed".
    const outcome = await first.request('ping', undefined, { timeoutMs: 250 }).then(
      () => 'answered',
      (error: unknown) => (error instanceof Error ? error.message : String(error))
    );
    return `${String(channels.length)}:${/disposed/iu.test(outcome) ? 'closed' : 'open'}`;
  });

  return undefined;
});

const app = defineExtension({ name: 'Ext Kit Fixture', modules: [fixtureModule] });

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // A subscription of our own, to observe when VS Code disposes
  // context.subscriptions relative to deactivate().
  context.subscriptions.push({
    dispose: () => {
      mark('subscription:dispose');
    },
  });

  mark('activate:start');
  await app.activate(context);
  mark('activate:end');
}

export async function deactivate(): Promise<void> {
  mark('deactivate:start');
  await app.deactivate();
  // A real await, so "deactivate is awaited" is actually being tested rather
  // than accidentally satisfied by a synchronous return.
  await new Promise<void>((resolve) => setTimeout(resolve, 50));
  mark('deactivate:end');
}
