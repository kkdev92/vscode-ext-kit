# Migrating from 2.x

2.x is a utility library: you call its helpers from your own `activate()`. 3.x
and 4.x are a framework: it owns activation and deactivation, and you hand it
modules. Everything 2.x could do, 4.x can do — the shapes changed, because there
is now one way in per ability rather than a standalone function _and_ a
declaration. This page is the order to do the work in. The old-to-new table for
every removed helper is in the [3.0.0-alpha.1 changelog](../CHANGELOG.md#300-alpha1---2026-08-08)
and is not repeated here.

Migrate straight to 4.x. The API is the one 3.0.0 exposed; 4.0.0 raised the
VS Code floor and changed nothing else. Before you start, your extension needs
what the [platform requirements](../README.md#platform-requirements) list:
`engines.vscode` of `^1.134.0` or later, ESM, and `ESNext.Disposable` plus an
`AbortSignal` lib in `tsconfig`. Typed storage keeps the 2.x envelope, so there
is no data migration; values a 2.x build wrote are read as they are.

## The starting point

Every step below works through an inventory like this one: an `activate` that
builds state, registers things, pushes each disposable onto
`context.subscriptions`, and reads configuration where it happens to need it.
Nothing about it is wrong. The point of the migration is that after it, none of
this file is yours to maintain.

<!-- sample: docs/samples/migration-before.ts -->

```ts
import * as vscode from 'vscode';

// The shape most extensions start from, and the one 2.x helpers were called
// from: an `activate` that registers everything, pushes each disposable onto
// `context.subscriptions`, and reads configuration wherever it happens to be
// needed. Nothing here is wrong. It is the inventory the steps work through.

let index: Map<string, number> | undefined;
let timer: ReturnType<typeof setInterval> | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  // Async initialisation, awaited before anything is registered.
  index = await buildIndex();

  // A command that reads a setting at call time.
  context.subscriptions.push(
    vscode.commands.registerCommand('sample.countProjects', () => {
      const limit = vscode.workspace.getConfiguration('sample').get<number>('limit', 10);
      return Math.min(index?.size ?? 0, limit);
    })
  );

  // A watcher that keeps the index fresh, three callbacks at a time.
  const watcher = vscode.workspace.createFileSystemWatcher('**/*.project.json');
  watcher.onDidCreate((uri) => index?.set(uri.fsPath, Date.now()));
  watcher.onDidChange((uri) => index?.set(uri.fsPath, Date.now()));
  watcher.onDidDelete((uri) => index?.delete(uri.fsPath));
  context.subscriptions.push(watcher);

  // A periodic job on a timer, disposed by hand.
  timer = setInterval(() => {
    void buildIndex().then((fresh) => (index = fresh));
  }, 30_000);
  context.subscriptions.push({ dispose: () => clearInterval(timer) });

  // A provider this package has no model for.
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      { scheme: 'file' },
      { provideHover: () => new vscode.Hover(`${String(index?.size ?? 0)} projects`) }
    )
  );
}

export function deactivate(): void {
  index = undefined;
}

async function buildIndex(): Promise<Map<string, number>> {
  const files = await vscode.workspace.findFiles('**/*.project.json', '**/node_modules/**');
  return new Map(files.map((file) => [file.fsPath, Date.now()]));
}
```

## 1. Inventory `activate`

List what the extension does at activation, one line per item. The grep that
finds most of it:

```bash
grep -rn "subscriptions.push\|getConfiguration\|globalState\|workspaceState\|secrets\.\|setInterval\|setTimeout\|onDid" src
```

Add the module-level `let`s, everything `activate` awaits, and every `vscode.*`
call that runs outside a handler. If 2.x helpers are in use, each is one line too
— `createExtensionKit`, `safeExecute`, `withProgress`, `createTypedStorage`,
`createFileWatcher`, the picker functions. The list is the migration's scope,
and the unit of every later commit.

## 2. Classify each item

Each line is one of these, and the classification decides which declaration it
becomes:

| It is…                                                                    | It becomes…                                                                                            |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| a command                                                                 | `defineCommandContract` + `module.commands.handle`                                                     |
| state built at activation                                                 | a service: `serviceToken` + `module.services.singleton`                                                |
| something awaited before the extension is usable                          | a hosted service `start`                                                                               |
| a loop or timer                                                           | `module.hostedServices.background`, with `context.delay`                                               |
| a file system watcher                                                     | `module.fileWatchers.add`                                                                              |
| a configuration read                                                      | `defineSettings` + `module.settings.add`, injected under `Settings.token`                              |
| a memento or secret                                                       | `defineStorage` / `defineSecret`, injected under their tokens                                          |
| a notification, picker, progress or status message                        | the `Notifications`, `QuickInput`, `StatusBar` tokens, or `context.notify` / `.ask` / `.progress`      |
| a tree view, webview view or panel restorer                               | `module.treeViews.add`, `module.webviews.addView`, `module.webviews.restorePanel`                      |
| a status bar or language status item                                      | `defineStatusBarItem` / `defineLanguageStatusItem`                                                     |
| an editor operation                                                       | the `Editors` token (`editors.active`)                                                                 |
| anything else the platform registers — a provider, a URI handler          | `module.raw.register`, with the disposable under `registrations.own`                                   |

Two things stop being items: `context.subscriptions.push` (the host owns what
it registered) and whatever `deactivate` cleaned up by hand (the host unwinds
it, in reverse order, inside a shutdown budget).

## 3. Move it into a module — as it is, first

The framework owns `activate`, so there is no half-way state where some
registrations are declared and the rest still live in your `activate`. The
fastest safe path is to move _everything_ first and improve it afterwards:

1. Create one module. Wrap each existing registration in `module.raw.register`,
   with the disposable it produced under `registrations.own(...)` and the state
   it needs behind a service. The [escape hatch](guide.md#the-escape-hatch)
   shows the shape.
2. Replace `activate` and `deactivate` with the framework's:
   `export const app = defineExtension({ name, modules: [...] })`, then
   `export const activate = app.activate` and
   `export const deactivate = app.deactivate`.
3. Run the extension. Activation and cleanup are now the host's, every
   registration rolls back if a later one fails, and `deactivate` unwinds all of
   it — before a single declaration has been written.

From here each step is a small commit: take one raw registration, turn it into
the declaration step 2 named, run the tests, move on. The extension works at
every commit.

## 4. Async initialisation becomes a hosted service

Anything `activate` awaited before registering — building an index, opening a
connection — goes into a hosted service's `start`. Activation awaits it, and a
throw rolls the whole activation back rather than leaving a half-activated
extension behind. Service factories stay synchronous, so resolution cannot
deadlock; the async part is the hosted service's.

A timer or loop becomes `module.hostedServices.background`: the host tracks it,
`context.signal` aborts it on shutdown, and `context.delay` returns early so a
sleeping loop cannot hold the shutdown budget. The `setInterval` handle and the
disposable that cleared it both disappear.

## 5. Direct subscriptions become owned scopes

A `createFileSystemWatcher` with three callbacks becomes one
`module.fileWatchers.add`, delivering debounced, deduplicated batches that each
run as an operation — with a logger, a cancellation signal and a resource scope
of their own. A configuration read becomes a declaration whose accessor is
injected, so the key, type, default and contribution scope are stated once and
`package.json` is checked against them. A memento becomes `defineStorage`, and
its existing values are read as they are.

Everything that still needs the raw API subscribes inside `raw.register`, under
`registrations.own(...)`. Nothing is pushed onto `context.subscriptions` any
more, by you or by anything you declared.

This is the inventory above after steps 3 to 5:

<!-- sample: docs/samples/migration-after.ts -->

```ts
import {
  defineCommandContract,
  defineExtension,
  defineModule,
  defineSettings,
  serviceToken,
  setting,
  type OperationContext,
} from '@kkdev92/vscode-ext-kit';

// The inventory, declared. Each registration says what it is and what it needs;
// when it is disposed is no longer its concern. Nothing in this file imports
// `vscode`, which is what lets a test run this exact plan on fakes.

interface ProjectIndex {
  count(): number;
  touch(path: string): void;
  forget(path: string): void;
  prune(olderThanMs: number): void;
}
const ProjectIndex = serviceToken<ProjectIndex>('sample.projectIndex');

// The setting the command read ad hoc, declared once: key, type, default and
// contribution scope, with package.json checked against it.
export const Settings = defineSettings({
  section: 'sample',
  values: { limit: setting.number({ default: 10, minimum: 1 }) },
});

// The command's id, arguments and result, fixed for every caller.
export const CountProjects = defineCommandContract<readonly [], number>({
  id: 'sample.countProjects',
});

export const projectsModule = defineModule('projects', (module): undefined => {
  module.settings.add(Settings);

  // The module-level `let index` becomes a service: built by the container,
  // owned by it, and replaceable in a test.
  module.services.singleton(ProjectIndex, () => {
    const seen = new Map<string, number>();
    return {
      count: () => seen.size,
      touch: (path) => void seen.set(path, Date.now()),
      forget: (path) => void seen.delete(path),
      prune: (olderThanMs) => {
        const cutoff = Date.now() - olderThanMs;
        for (const [path, at] of seen) {
          if (at < cutoff) seen.delete(path);
        }
      },
    };
  });

  module.commands.handle(CountProjects, {
    inject: { index: ProjectIndex, settings: Settings.token },
    execute: (_context: OperationContext, _args, { index, settings }) =>
      Math.min(index.count(), settings.read().values.limit),
  });

  // The watcher, its three callbacks collapsed into one debounced batch that
  // runs as an operation.
  module.fileWatchers.add({
    id: 'projects.files',
    patterns: ['**/*.project.json'],
    ignorePatterns: ['**/node_modules/**'],
    inject: { index: ProjectIndex },
    handle: (_context: OperationContext, events, { index }) => {
      for (const event of events) {
        if (event.type === 'delete') index.forget(event.uri.fsPath);
        else index.touch(event.uri.fsPath);
      }
    },
  });

  // The `setInterval` becomes a background hosted service. The host tracks it,
  // `context.delay` returns early on shutdown, and there is no handle to clear.
  module.hostedServices.background({
    id: 'projects.prune',
    inject: { index: ProjectIndex },
    run: async (context, { index }) => {
      while (!context.signal.aborted) {
        await context.delay(30_000);
        if (context.signal.aborted) return;
        index.prune(24 * 60 * 60 * 1000);
      }
    },
  });

  return undefined;
});

// Preflight runs here, at import time. `activate` and `deactivate` are the
// framework's: `deactivate` is the one cleanup path, and `activate` puts a
// single synchronous failsafe on `context.subscriptions`. Nothing else is
// pushed there, by you or by anything you declared.
export const app = defineExtension({ name: 'Sample', modules: [projectsModule] });
export const activate = app.activate;
export const deactivate = app.deactivate;
```

The hover provider is missing from it on purpose. It is the one thing the
framework has no model for, so it stays a raw registration — and the next step
is about where that lives.

## 6. Isolate the escape hatch

Whatever is left in `raw.register` belongs in its own module file. The reason is
the `import * as vscode` at the top of that file: a module that carries one
cannot be imported where no VS Code exists, and a unit test is exactly that
place. Keep the modules that need the platform apart from the ones that do not,
and the plan a test loads is the plan that ships, minus the file it cannot load.

A raw registration still shows up in the compiled plan, rolls back with the
module, and unwinds through `deactivate`. What it does not get is a fake: the
[escape hatch](guide.md#the-escape-hatch) section says what that costs.

## 7. Run the production plan in the Test Host

`createTestHost({ plan: app.plan })` starts the plan you export — not a
rebuild of it for testing — against one fake per capability port. Execute a
command through `host.application.commands.execute`, override one singleton to
isolate a feature, and assert `host.leaks()` after `host.stop()`: a registration
or resource left behind is the bug that used to surface as a stale listener two
releases later. [Testing](guide.md#testing) walks through it.

If a module you load imports `vscode` (step 6 is why you might not), point
Vitest's `resolve.alias` at `@kkdev92/vscode-ext-kit/testing/vitest`, or merge
`vscodeExtKitVitestConfig` from `@kkdev92/vscode-ext-kit/testing/vitest-config`.

## 8. Check the manifest against the plan

`package.json` cannot be generated from the source — VS Code reads it before any
code runs, and it carries titles and descriptions only a person can write — but
the overlap is mechanical: command ids, setting keys, types, defaults, enum
values, scopes, view ids. `assertManifestMatches`, from
`@kkdev92/vscode-ext-kit/testing`, compares the two and names every disagreement
at once, with the JSON to paste. [Keeping package.json
honest](guide.md#keeping-packagejson-honest) has the test. Run it now: a
migration that renamed a section or fixed a default is exactly when the two
drift.

`npx vscode-ext-kit plan ./dist/extension.js --check` is the same idea one level
up — preflight, from the command line, against the built entry.

## 9. Add an Extension Host lane

Unit tests on fakes answer most questions. The ones they cannot — does the
extension activate in a real host, does `deactivate` run inside VS Code's
deadline, does a text editor command behave as the platform actually calls it —
need the real thing. This repository's [fixtures](../fixtures/README.md) show
the two lanes, desktop and web, and how a case asserts an observable fact rather
than what the API is believed to promise. A single case that activates the
migrated extension and runs one command is enough to start with; the real
extensions built on this package each found something there that no unit test
saw.

## What you can delete afterwards

- Every `context.subscriptions.push`, and the `deactivate` body that mirrored
  it.
- Module-level `let`s that held state between `activate` and the handlers.
  They are services now.
- Error presentation around command handlers. A result and a rejection both
  reach the caller; the Command Palette already shows the dialog.
- `CancellationToken` plumbing. `context.signal` combines the operation's own
  cancellation with the user's, and everything that took a token takes a
  signal.
