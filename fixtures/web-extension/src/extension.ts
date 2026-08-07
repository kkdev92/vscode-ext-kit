import type * as vscode from 'vscode';

import {
  defineCommandContract,
  defineExtension,
  defineModule,
  defineSettings,
  setting,
} from '../../../dist/index.js';

const Probe = defineCommandContract<readonly [], string>({
  id: 'extKitWebFixture.probe',
  title: 'Probe',
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
