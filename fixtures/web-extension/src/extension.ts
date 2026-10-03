import type * as vscode from 'vscode';

import {
  Workspace,
  defineCommandContract,
  defineExtension,
  defineModule,
  defineSettings,
  setting,
} from '../../../dist/index.js';
import type { WatchedUri } from '../../../dist/index.js';

const Probe = defineCommandContract<readonly [], string>({
  id: 'extKitWebFixture.probe',
  title: 'Probe',
});

const WorkspaceReport = defineCommandContract<readonly [WatchedUri], string>({
  id: 'extKitWebFixture.workspaceReport',
  title: 'Workspace Report',
});

const WebSettings = defineSettings({
  section: 'extKitWebFixture',
  values: {
    enabled: setting.boolean({ default: true, scope: 'resource' }),
  },
});

/** Recorded in-process; the worker has no filesystem to write markers to. */
const trace: string[] = [];

/**
 * What the test sees as `extension.exports`.
 *
 * VS Code exposes whatever `activate()` *returns*, not the module's exports, so
 * the trace has to be handed back explicitly.
 */
export interface FixtureExports {
  readonly trace: readonly string[];
}

const fixtureModule = defineModule('fixture', (module): undefined => {
  module.settings.add(WebSettings);

  module.commands.handle(Probe, {
    inject: { settings: WebSettings.token },
    execute: (context, _args, { settings }) => {
      trace.push(`command:${String(settings.read().get('enabled'))}`);
      return context.id;
    },
  });

  module.hostedServices.add({
    id: 'fixture.service',
    start: () => {
      trace.push('hosted:start');
    },
    stop: () => {
      trace.push('hosted:stop');
    },
  });

  // What the Workspace service answers about a resource, for the test to set
  // beside what VS Code answers itself.
  module.commands.handle(WorkspaceReport, {
    inject: { workspace: Workspace },
    execute: (_context, [uri], { workspace }) => {
      const folders = workspace.folders();
      const first = folders[0];
      return JSON.stringify({
        folders: folders.map(
          (folder) => `${String(folder.index)}:${folder.name}:${folder.uri.toString()}`
        ),
        folderOf: workspace.folderOf(uri)?.name ?? null,
        relativePath: workspace.relativePath(uri),
        withName: workspace.relativePath(uri, true),
        withoutName: workspace.relativePath(uri, false),
        folderItself: first === undefined ? null : workspace.relativePath(first.uri),
      });
    },
  });

  return undefined;
});

const app = defineExtension({ name: 'Ext Kit Web Fixture', modules: [fixtureModule] });

export async function activate(context: vscode.ExtensionContext): Promise<FixtureExports> {
  trace.push('activate:start');
  await app.activate(context);
  trace.push('activate:end');
  return { trace };
}

export function deactivate(): Promise<void> {
  trace.push('deactivate:start');
  return app.deactivate();
}
