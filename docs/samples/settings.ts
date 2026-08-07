import {
  defineCommandContract,
  defineModule,
  defineSettings,
  setting,
  SettingsValidationPolicy,
  type OperationContext,
} from '@kkdev92/vscode-ext-kit';

// One declaration fixes the keys, their types, their defaults and the
// contribution scope VS Code needs in package.json.
const ProjectSettings = defineSettings({
  section: 'sample.projects',
  policy: SettingsValidationPolicy.Lenient,
  values: {
    enabled: setting.boolean({ default: true, scope: 'resource' }),
    limit: setting.number({ default: 10, minimum: 1, maximum: 500 }),
    mode: setting.enum({ values: ['fast', 'thorough'], default: 'fast' }),
    exclude: setting.stringArray({ default: ['**/node_modules/**'] }),
  },
});

export const DescribeSettings = defineCommandContract<readonly [], string>({
  id: 'sample.describeSettings',
});

export const settingsModule = defineModule('settings', (module): undefined => {
  module.settings.add(ProjectSettings);

  module.commands.handle(DescribeSettings, {
    // The accessor is injectable under the definition's own token.
    inject: { settings: ProjectSettings.token },
    execute: (_context: OperationContext, _args, { settings }) => {
      // A read takes a scope, because VS Code resolves a different effective
      // value per resource and per language. `mode` is typed as the union.
      const values = settings.read().values;
      return `${values.mode}/${String(values.limit)}`;
    },
  });

  // A hosted service owns what it starts: `stop` runs in reverse declaration
  // order, inside the shutdown budget, and is the only place this subscription
  // is released.
  let subscription: { dispose(): void } | undefined;
  module.hostedServices.add({
    id: 'settings.watcher',
    inject: { settings: ProjectSettings.token },
    start: (context, { settings }) => {
      // Fires only when *this* key's effective value actually changed — a
      // sibling key moving in the same section does not wake it.
      subscription = settings.watch('enabled', undefined, (enabled) => {
        context.logger.info('projects toggled', { enabled });
      });
    },
    stop: () => {
      subscription?.dispose();
      subscription = undefined;
    },
  });

  return undefined;
});
