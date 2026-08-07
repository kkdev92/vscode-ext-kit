import {
  defineCommandContract,
  defineModule,
  defineSecret,
  defineStorage,
  s,
  type OperationContext,
} from '@kkdev92/vscode-ext-kit';

// Versioned, validated, migrated. A value written by an older build is upgraded
// on read and re-persisted; anything that fails validation falls back to
// `defaultValue` and is reported through `tryGet()` rather than thrown.
const RecentProjects = defineStorage({
  key: 'sample.recentProjects',
  scope: 'global',
  syncable: true,
  defaultValue: [] as readonly string[],
  schema: s.array(s.string()),
  version: 2,
  migrations: {
    // Version 0 is a plain value written before this kit was adopted.
    0: (old) => (typeof old === 'string' ? [old] : []),
    1: (old) => (Array.isArray(old) ? old.filter((entry) => typeof entry === 'string') : []),
  },
});

// A secret's value never appears in a log, a diagnostic or an error message --
// only its key does.
const ApiToken = defineSecret({ key: 'sample.apiToken' });

export const Remember = defineCommandContract<readonly [path: string], number>({
  id: 'sample.remember',
});

export const storageModule = defineModule('storage', (module): undefined => {
  module.storage.add(RecentProjects);
  module.secrets.add(ApiToken);

  module.commands.handle(Remember, {
    inject: { recent: RecentProjects.token, token: ApiToken.token },
    execute: async (_context: OperationContext, [path], { recent, token }) => {
      const next = [path, ...recent.get().filter((entry) => entry !== path)].slice(0, 10);
      await recent.set(next);

      // `read()` resolves to undefined when unset, so an absent secret is not an
      // error to handle at every call site.
      const secret = await token.read();
      return secret === undefined ? next.length : next.length + 1;
    },
  });

  return undefined;
});
