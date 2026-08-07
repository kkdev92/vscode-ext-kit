/**
 * In-process Test Host integration suite for module-declared webview views,
 * command-opened panels, and panel restoration. It protects lazy resolve,
 * dependency injection, per-incarnation RPC identity, duplicate preflight, and
 * application ownership. HTML/protocol mechanics remain in focused unit
 * suites.
 */
import { describe, expect, it } from 'vitest';

import { compileApplication } from '../../../src/foundation/application/plan.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import { serviceToken } from '../../../src/foundation/services/token.js';
import { Webviews } from '../../../src/capabilities/views/webview/host.js';
import type {
  ManagedWebview,
  ManagedWebviewPanel,
} from '../../../src/capabilities/views/webview/host.js';
import { createTestHost } from '../../../src/testing/test-host.js';

describe('declared webview views', () => {
  it('registers at activation and fills in when the user reveals it', async () => {
    const module = defineModule('sidebar', (builder): undefined => {
      builder.webviews.addView<ManagedWebview>({
        id: 'sample.sidebar',
        options: { enableScripts: true },
        resolve: (view) => {
          view.setHtml('<p>sidebar</p>');
        },
      });
      return undefined;
    });
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });

    await host.start();

    // Registered, but not yet resolved: VS Code asks for the content the first
    // time the user opens the view, not at activation.
    expect(host.webviews.views[0]).toMatchObject({
      id: 'sample.sidebar',
      options: { enableScripts: true },
      html: '',
    });

    await host.webviews.views[0]?._reveal();
    expect(host.webviews.views[0]?.html).toBe('<p>sidebar</p>');

    await host.stop();
    expect(host.webviews.views[0]?.registered).toBe(false);
    expect(host.leaks()).toEqual({ registrations: 0, resources: 0, commands: [] });
  });

  it('injects declared dependencies', async () => {
    interface Greeter {
      greeting(): string;
    }
    const Greeter = serviceToken<Greeter>('sample.greeter');

    const module = defineModule('sidebar', (builder): undefined => {
      builder.services.singleton(Greeter, () => ({ greeting: () => 'hello' }));
      builder.webviews.addView<{ greeter: typeof Greeter }, ManagedWebview>({
        id: 'sample.sidebar',
        inject: { greeter: Greeter },
        resolve: (view, { greeter }) => {
          view.setHtml(`<p>${greeter.greeting()}</p>`);
        },
      });
      return undefined;
    });
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();

    await host.webviews.views[0]?._reveal();

    expect(host.webviews.views[0]?.html).toBe('<p>hello</p>');
    await host.stop();
  });

  it('renders a template through the capability', async () => {
    const module = defineModule('sidebar', (builder): undefined => {
      builder.webviews.addView<ManagedWebview>({
        id: 'sample.sidebar',
        resolve: async (view) => {
          await view.setHtmlFromTemplate('media/sidebar.html', { title: 'Projects' });
        },
      });
      return undefined;
    });
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    host.webviews._addFile('media/sidebar.html', '<h1>{{title}}</h1>');
    await host.start();

    await host.webviews.views[0]?._reveal();

    expect(host.webviews.views[0]?.html).toBe('<h1>Projects</h1>');
    await host.stop();
  });

  it('gives each resolve its own RPC channel', async () => {
    const seen: unknown[] = [];
    const module = defineModule('sidebar', (builder): undefined => {
      builder.webviews.addView<ManagedWebview>({
        id: 'sample.sidebar',
        resolve: (view) => {
          seen.push(view.rpc);
        },
      });
      return undefined;
    });
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();

    const view = host.webviews.views[0];
    await view?._reveal();
    view?._hide();
    await view?._reveal();

    // A view torn down and re-revealed is a different webview; a shared channel
    // would post into the dead one.
    expect(view?.resolveCount).toBe(2);
    expect(seen[0]).not.toBe(seen[1]);
    await host.stop();
  });

  /**
   * The other half of "its own RPC channel": owning one is only correct if it
   * also ends. Hiding a view destroys it, and the next reveal builds a new one,
   * so a channel that outlives its incarnation means a user who opens and
   * closes a sidebar accumulates one live message subscription — and one map of
   * requests that can never be answered — per cycle.
   */
  it('closes an incarnation channel when the view goes away', async () => {
    const channels: ManagedWebview['rpc'][] = [];
    const module = defineModule('sidebar', (builder): undefined => {
      builder.webviews.addView<ManagedWebview>({
        id: 'sample.sidebar',
        resolve: (view) => {
          channels.push(view.rpc);
        },
      });
      return undefined;
    });
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();

    const view = host.webviews.views[0];
    await view?._reveal();
    const first = channels[0];
    // A request made just before the view disappears must not hang forever.
    const stranded = first?.request('anything', undefined);

    view?._hide();

    await expect(stranded).rejects.toThrow(/disposed/);
    await expect(first?.request('anything', undefined)).rejects.toThrow(/disposed/);

    // Closing one does not close the next: revealing again produces a fresh
    // channel rather than reusing the one just torn down.
    await view?._reveal();
    expect(channels).toHaveLength(2);
    expect(channels[1]).not.toBe(first);

    await host.stop();
  });

  it('closes an incarnation channel still on screen when the application stops', async () => {
    const channels: ManagedWebview['rpc'][] = [];
    const module = defineModule('sidebar', (builder): undefined => {
      builder.webviews.addView<ManagedWebview>({
        id: 'sample.sidebar',
        resolve: (view) => {
          channels.push(view.rpc);
        },
      });
      return undefined;
    });
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();
    await host.webviews.views[0]?._reveal();

    // Nothing fires `onDidDispose` for a view that outlives us, so shutdown has
    // to close what is still open itself.
    await host.stop();

    await expect(channels[0]?.request('anything', undefined)).rejects.toThrow(/disposed/);
  });

  it('rejects two views claiming the same id', () => {
    const first = defineModule('a', (builder): undefined => {
      builder.webviews.addView({ id: 'same', resolve: () => undefined });
      return undefined;
    });
    const second = defineModule('b', (builder): undefined => {
      builder.webviews.addView({ id: 'same', resolve: () => undefined });
      return undefined;
    });

    expect(() => compileApplication({ name: 'sample', modules: [first, second] })).toThrow(
      /registered more than once/
    );
  });

  it('rejects a view depending on a service nobody registered', () => {
    const Missing = serviceToken<{ x: number }>('sample.missing');
    const module = defineModule('sidebar', (builder): undefined => {
      builder.webviews.addView({
        id: 'sample.sidebar',
        inject: { missing: Missing },
        resolve: () => undefined,
      });
      return undefined;
    });

    expect(() => compileApplication({ name: 'sample', modules: [module] })).toThrow(
      /sample\.missing/
    );
  });
});

describe('panels opened from a handler', () => {
  const OpenPreview = defineCommandContract<readonly [], string>({ id: 'sample.openPreview' });

  const previewModule = defineModule('preview', (builder): undefined => {
    builder.commands.handle(OpenPreview, {
      inject: { webviews: Webviews },
      execute: async (_context, _args, { webviews }) => {
        const panel = webviews.openPanel({ viewType: 'sample.preview', title: 'Preview' });
        await panel.setHtmlFromTemplate('media/preview.html', { title: 'Preview' });
        return 'opened';
      },
    });
    return undefined;
  });

  it('opens a panel and closes it with the application', async () => {
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [previewModule] }),
    });
    host.webviews._addFile('media/preview.html', '<h1>{{title}}</h1>');
    await host.start();

    await expect(host.application.commands.execute(OpenPreview)).resolves.toBe('opened');
    expect(host.webviews.panels[0]?.html).toBe('<h1>Preview</h1>');
    expect(host.webviews.panels[0]?.disposed).toBe(false);

    await host.stop();

    // The service is container-owned, so a panel cannot outlive the extension
    // that opened it.
    expect(host.webviews.panels[0]?.disposed).toBe(true);
    expect(host.leaks()).toEqual({ registrations: 0, resources: 0, commands: [] });
  });
});

describe('panel restoration', () => {
  it('brings a panel back after a window reload', async () => {
    const module = defineModule('preview', (builder): undefined => {
      builder.webviews.restorePanel<ManagedWebviewPanel, { title: string }>({
        viewType: 'sample.preview',
        restore: (panel, state) => {
          panel.setHtml(`<h1>${state.title}</h1>`);
        },
      });
      return undefined;
    });
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();

    const restored = await host.webviews.serializers[0]?._restore({ title: 'Restored' });

    expect(host.webviews.serializers[0]?.viewType).toBe('sample.preview');
    expect(restored?.html).toBe('<h1>Restored</h1>');

    await host.stop();
    expect(host.webviews.serializers[0]?.registered).toBe(false);
  });

  it('rejects two restorers for the same view type', () => {
    const first = defineModule('a', (builder): undefined => {
      builder.webviews.restorePanel({ viewType: 'same', restore: () => undefined });
      return undefined;
    });
    const second = defineModule('b', (builder): undefined => {
      builder.webviews.restorePanel({ viewType: 'same', restore: () => undefined });
      return undefined;
    });

    expect(() => compileApplication({ name: 'sample', modules: [first, second] })).toThrow(
      /registered more than once/
    );
  });
});
