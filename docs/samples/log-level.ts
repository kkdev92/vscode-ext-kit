import {
  Log,
  defineModule,
  defineSettings,
  filterLogger,
  serviceToken,
  setting,
} from '@kkdev92/vscode-ext-kit';

// VS Code filters the extension's log channel by the level the user picks with
// `Developer: Set Log Level`, and the API gives the extension no way to change
// it. A setting of the extension's own can therefore only make the log quieter
// -- `silent` included -- and `filterLogger` is how it does.
const LogSettings = defineSettings({
  section: 'sample',
  values: {
    logLevel: setting.enum({
      values: ['trace', 'debug', 'info', 'warn', 'error', 'silent'],
      default: 'info',
    }),
  },
});

interface Indexer {
  rebuild(): void;
}
const Indexer = serviceToken<Indexer>('sample.indexer');

export const indexingModule = defineModule('indexing', (module): undefined => {
  module.settings.add(LogSettings);

  module.services.singleton(Indexer, {
    inject: { log: Log, settings: LogSettings.token },
    create: ({ log, settings }) => {
      // A function rather than a value: it is read on every entry, so a service
      // built once still follows the setting when the user changes it.
      const logger = filterLogger(log, () => settings.read().values.logLevel);
      return {
        rebuild: () => {
          logger.debug('rebuilding the index');
        },
      };
    },
  });

  return undefined;
});
