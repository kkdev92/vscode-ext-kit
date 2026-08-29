/**
 * The plan, projected to JSON.
 *
 * What this suite is really protecting is the boundary: nothing callable and
 * nothing opaque may cross it, and the same modules must always produce the
 * same document. A tool that diffs this output is only useful if a diff means
 * a declaration changed, rather than a map having been iterated in a different
 * order.
 */
import { describe, expect, it } from 'vitest';

import { compileApplication } from '../../../src/foundation/application/plan.js';
import { describePlan } from '../../../src/foundation/application/describe.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import { ModuleCompatibility } from '../../../src/foundation/modules/compatibility.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import { serviceToken } from '../../../src/foundation/services/token.js';
import { defineSettings, setting } from '../../../src/foundation/settings/definition.js';
import { Log } from '../../../src/foundation/logging/token.js';
import { Notifications } from '../../../src/capabilities/ui/notifications.js';
import { defineSecret, defineStorage } from '../../../src/capabilities/storage/definition.js';
import { defineStatusBarItem } from '../../../src/capabilities/ui/definition.js';
import { s } from '../../../src/capabilities/core/schema.js';

interface Repository {
  count(): number;
}
const Repository = serviceToken<Repository>('projects.repository');
const Clock = serviceToken<{ now(): number }>('projects.clock');
// Transient, and nothing long-lived depends on it: a singleton that did would
// capture it for the application's lifetime, and preflight rejects that.
const Session = serviceToken<{ id: string }>('projects.session');

const Refresh = defineCommandContract<readonly [force: boolean], number>(
  { id: 'sample.refresh', title: 'Refresh', category: 'Sample' },
  { args: { validate: (value) => ({ ok: true, value: value as readonly [boolean] }) } }
);
const Reformat = defineCommandContract<readonly [], void>({
  id: 'sample.reformat',
  title: 'Reformat',
});

const Settings = defineSettings({
  section: 'sample.projects',
  values: {
    enabled: setting.boolean({ default: true, scope: 'resource' }),
    mode: setting.enum({ values: ['fast', 'thorough'], default: 'fast' }),
  },
});

const Recent = defineStorage<readonly string[]>({
  key: 'sample.recent',
  scope: 'global',
  syncable: true,
  defaultValue: [],
  version: 3,
  migrations: { 2: (old) => old, 1: (old) => old },
  ttlMs: 60_000,
  legacyKeys: ['sample.history'],
});

const Token = defineSecret<{ value: string }>({
  key: 'sample.token',
  schema: s.object({ value: s.string() }),
});

const Status = defineStatusBarItem({
  id: 'sample.status',
  text: 'Sample',
  alignment: 'right',
  priority: 10,
});

/** One module of every declaration kind, so the projection is exercised whole. */
const everything = defineModule(
  'projects',
  { uses: { log: Log }, compatibility: ModuleCompatibility.WebSafe, requires: { trust: true } },
  (module): undefined => {
    module.services.singleton(Repository, {
      inject: { clock: Clock },
      create: () => ({ count: () => 0 }),
    });
    module.services.singleton(Clock, () => ({ now: () => 0 }));
    module.services.transient(Session, () => ({ id: 'one' }));

    module.commands.handle(Refresh, {
      inject: { repository: Repository },
      execute: () => 1,
    });
    module.commands.handleTextEditor(Reformat, () => undefined);

    module.settings.add(Settings);
    module.storage.add(Recent);
    module.secrets.add(Token);
    module.statusBar.add(Status);

    module.hostedServices.add({ id: 'projects.index', start: () => undefined });
    module.hostedServices.background({ id: 'projects.poll', run: () => undefined });

    module.fileWatchers.add({
      id: 'projects.manifests',
      patterns: [
        '**/package.json',
        { baseUri: { scheme: 'file', path: '/w', toString: () => 'file:///w' }, pattern: '*.md' },
      ],
      ignorePatterns: ['**/node_modules/**'],
      events: ['change'],
      debounceDelay: 250,
      inject: { notify: Notifications },
      handle: () => undefined,
    });

    module.treeViews.add({ id: 'sample.tree', resolveProvider: () => ({}) });
    module.webviews.addView({ id: 'sample.panel', resolve: () => undefined });
    module.webviews.restorePanel({ viewType: 'sample.preview', restore: () => undefined });
    module.raw.register({ id: 'sample.raw', bind: () => undefined });

    return undefined;
  }
);

const plan = compileApplication({ name: 'sample', modules: [everything] });

describe('describePlan', () => {
  it('is deterministic and JSON-safe', () => {
    const first = describePlan(plan);
    const second = describePlan(plan);

    expect(first).toEqual(second);
    // The whole point: this can be written to a file, committed and diffed.
    expect(JSON.parse(JSON.stringify(first))).toEqual(first);
  });

  it('carries no function, token object or provider across the boundary', () => {
    const seen = new Set<unknown>();
    const walk = (value: unknown, path: string): void => {
      if (typeof value === 'function') {
        throw new Error(`a function reached the description at ${path}`);
      }
      if (typeof value !== 'object' || value === null || seen.has(value)) {
        return;
      }
      seen.add(value);
      for (const [key, child] of Object.entries(value)) {
        walk(child, `${path}.${key}`);
      }
    };

    expect(() => walk(describePlan(plan), 'description')).not.toThrow();
  });

  it('describes modules with their compatibility and requirements', () => {
    expect(describePlan(plan).modules).toEqual([
      {
        id: 'projects',
        compatibility: 'web-safe',
        requires: { workspace: false, trust: true, localFileSystem: false },
        source: undefined,
      },
    ]);
  });

  it('names service tokens, lifetimes and the edges between them', () => {
    expect(describePlan(plan).services).toEqual([
      {
        token: 'projects.repository',
        lifetime: 'singleton',
        dependencies: { clock: 'projects.clock' },
        moduleId: 'projects',
      },
      {
        token: 'projects.clock',
        lifetime: 'singleton',
        dependencies: {},
        moduleId: 'projects',
      },
      {
        token: 'projects.session',
        lifetime: 'transient',
        dependencies: {},
        moduleId: 'projects',
      },
    ]);
  });

  it('lists what is injectable without being declared', () => {
    // A reader of the graph would otherwise see a command depending on a token
    // that nothing in the plan registers.
    expect(describePlan(plan).frameworkServices).toContain('framework.notifications');
    expect(describePlan(plan).frameworkServices).toContain('framework.log');
  });

  it('separates plain commands from text editor ones and says which validate', () => {
    expect(describePlan(plan).commands).toEqual([
      {
        id: 'sample.refresh',
        title: 'Refresh',
        category: 'Sample',
        textEditor: false,
        validated: true,
        // The module's ambient `uses` is merged in, exactly as preflight sees it.
        dependencies: { log: 'framework.log', repository: 'projects.repository' },
        moduleId: 'projects',
      },
      {
        id: 'sample.reformat',
        title: 'Reformat',
        category: undefined,
        textEditor: true,
        validated: false,
        dependencies: { log: 'framework.log' },
        moduleId: 'projects',
      },
    ]);
  });

  it('says which lifecycle phases a hosted service implements', () => {
    expect(describePlan(plan).hostedServices).toEqual([
      {
        id: 'projects.index',
        start: true,
        run: false,
        stop: false,
        dependencies: { log: 'framework.log' },
        moduleId: 'projects',
      },
      {
        id: 'projects.poll',
        start: false,
        run: true,
        stop: false,
        dependencies: { log: 'framework.log' },
        moduleId: 'projects',
      },
    ]);
  });

  it('describes settings the way the manifest keys them', () => {
    expect(describePlan(plan).settings).toEqual([
      {
        section: 'sample.projects',
        policy: 'lenient',
        values: [
          {
            key: 'sample.projects.enabled',
            type: ['boolean'],
            default: true,
            scope: 'resource',
            enum: undefined,
          },
          {
            key: 'sample.projects.mode',
            type: ['string'],
            default: 'fast',
            scope: 'window',
            enum: ['fast', 'thorough'],
          },
        ],
        moduleId: 'projects',
      },
    ]);
  });

  it('describes storage without carrying the stored shape', () => {
    expect(describePlan(plan).storage).toEqual([
      {
        key: 'sample.recent',
        scope: 'global',
        syncable: true,
        version: 3,
        validated: false,
        ttlMs: 60_000,
        legacyKeys: ['sample.history'],
        // Ascending regardless of the order the migrations were declared in,
        // because a diff of this document must not move when a literal does.
        migratesFrom: [1, 2],
        moduleId: 'projects',
      },
    ]);
  });

  it('names secret keys and never anything else about them', () => {
    // A declared key is metadata the extension's own source states in the
    // clear; a value does not exist at plan time and never could.
    expect(describePlan(plan).secrets).toEqual([
      { key: 'sample.token', validated: true, moduleId: 'projects' },
    ]);
  });

  it('renders both glob spellings, keeping a relative pattern relative', () => {
    expect(describePlan(plan).fileWatchers).toEqual([
      {
        id: 'projects.manifests',
        patterns: ['**/package.json', 'file:///w::*.md'],
        ignorePatterns: ['**/node_modules/**'],
        events: ['change'],
        debounceDelayMs: 250,
        maxWaitMs: undefined,
        maxBatchSize: undefined,
        dependencies: { log: 'framework.log', notify: 'framework.notifications' },
        moduleId: 'projects',
      },
    ]);
  });

  it('describes the UI and view declarations, each keyed by its own id', () => {
    const description = describePlan(plan);

    expect(description.statusBarItems).toEqual([
      { id: 'sample.status', alignment: 'right', priority: 10, moduleId: 'projects' },
    ]);
    expect(description.treeViews).toEqual([
      { id: 'sample.tree', dependencies: { log: 'framework.log' }, moduleId: 'projects' },
    ]);
    expect(description.webviewViews.map((view) => view.id)).toEqual(['sample.panel']);
    // A restorer is keyed by the view type it restores, which is its id here.
    expect(description.webviewSerializers.map((entry) => entry.id)).toEqual(['sample.preview']);
    expect(description.rawRegistrations.map((entry) => entry.id)).toEqual(['sample.raw']);
  });

  it('attributes a declaration to its module even when the declaration does not say', () => {
    // Settings, storage, secrets and UI items carry no moduleId of their own;
    // ownership is recovered from the module that holds them.
    const two = compileApplication({
      name: 'sample',
      modules: [
        defineModule('a', (module): undefined => {
          module.settings.add(Settings);
          return undefined;
        }),
        defineModule('b', (module): undefined => {
          module.storage.add(Recent);
          return undefined;
        }),
      ],
    });
    const description = describePlan(two);

    expect(description.settings[0]?.moduleId).toBe('a');
    expect(description.storage[0]?.moduleId).toBe('b');
  });

  it('reports an empty application without inventing anything', () => {
    const empty = describePlan(compileApplication({ name: 'empty', modules: [] }));

    expect(empty.name).toBe('empty');
    expect(empty.shutdown).toEqual({ timeoutMs: 3_000 });
    expect(empty.modules).toEqual([]);
    expect(empty.commands).toEqual([]);
    // Framework services exist whether or not anything declares a module.
    expect(empty.frameworkServices.length).toBeGreaterThan(0);
  });
});
