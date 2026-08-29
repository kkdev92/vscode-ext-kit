# @kkdev92/vscode-ext-kit

[![npm version](https://img.shields.io/npm/v/@kkdev92/vscode-ext-kit)](https://www.npmjs.com/package/@kkdev92/vscode-ext-kit)
[![CI](https://github.com/kkdev92/vscode-ext-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/kkdev92/vscode-ext-kit/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg)](https://www.typescriptlang.org/)
[![OpenSSF Best Practices](https://www.bestpractices.dev/projects/14048/badge)](https://www.bestpractices.dev/projects/14048)

An application framework for VS Code extensions. You declare what your extension
is made of; the framework validates that declaration before touching VS Code,
runs it, and tears it down through exactly one path.
_Built for extensions big enough that "what does this thing actually register?"
has stopped being obvious._

> **Status:** `4.0.1` — the current release. It is `3.0.0` with the VS Code
> floor raised to `^1.134.0` and a fix in the tree-view adapter; the API is
> unchanged. 2.x was a utility library with a different shape; it continues on
> `v2-maintenance` and anything pinned to `^2.x` is unaffected. See
> [Coming from 2.x](#coming-from-2x).

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Why vscode-ext-kit](#why-vscode-ext-kit)
- [Usage](#usage)
- [What Is Guaranteed](#what-is-guaranteed)
- [Known Limitations](#known-limitations)
- [How It Works](#how-it-works)
- [Coming from 2.x](#coming-from-2x)
- [Platform Requirements](#platform-requirements)
- [Troubleshooting](#troubleshooting)
- [Security and Privacy](#security-and-privacy)
- [Contributing](#contributing)
- [Support & Maintenance Policy](#support--maintenance-policy)
- [License](#license)
- [Acknowledgments](#acknowledgments)

---

## Features

- **Declare, Then Run**: Commands, services, settings, storage, secrets, watchers and views are data; compiling them produces an immutable plan — `describePlan` hands you that plan as JSON, to diff in a review or feed to a tool
- **Preflight Before VS Code**: Duplicate ids, a missing service, a dependency cycle, a captive dependency — all rejected at import time, before a single API call
- **One Cleanup Owner**: `deactivate` is the only teardown path; `context.subscriptions` gets one synchronous failsafe and nothing else
- **Every Unit of Work Is an Operation**: A command invocation or a watcher batch arrives with an id, a logger, a combined `AbortSignal`, a progress session and a resource scope
- **A vscode-free Core**: Your real plan runs on fakes in a unit test, and the same code runs in the web extension host
- **Typed End to End**: Command arguments, settings, stored values and webview messages all carry their types to the call site
- **Zero Runtime Dependencies**: No Node built-ins, no polyfills, native ESM

---

## Installation

```bash
npm install @kkdev92/vscode-ext-kit
```

Subpaths, all ESM:

| Import                                          | What It Is                                                                          |
| ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| `@kkdev92/vscode-ext-kit`                       | the framework and the capability APIs                                               |
| `@kkdev92/vscode-ext-kit/testing`               | Test Host, one fake per capability, and the `vscode` mock kit                       |
| `@kkdev92/vscode-ext-kit/testing/vitest`        | a `vscode` stand-in for Vitest's `resolve.alias` (needs the optional `vitest` peer) |
| `@kkdev92/vscode-ext-kit/testing/vitest-config` | the matching Vitest config to merge                                                 |
| `@kkdev92/vscode-ext-kit/webview-client`        | the browser side of the typed webview RPC                                           |
| `@kkdev92/vscode-ext-kit/timing`                | `debounce` `throttle` `withTimeout` `withTiming` `measureTime`                      |
| `@kkdev92/vscode-ext-kit/retry`                 | retry with backoff, jitter and a per-attempt `AbortSignal`                          |
| `@kkdev92/vscode-ext-kit/format`                | `Intl` date/number/relative-time/plural formatting                                  |

The last three are also on the root barrel. They have their own subpaths because
the root imports `vscode` and a webview bundle cannot.

---

## Quick Start

Two files. The first is your `extension.ts`:

<!-- sample: docs/samples/extension.ts -->

```ts
import { defineExtension } from '@kkdev92/vscode-ext-kit';

import { CountProjects, projectsModule } from './commands-and-services.js';

// Preflight runs here, at import time: duplicate ids, a missing service, a cycle
// or a captive dependency fail before VS Code is touched at all.
// Exported so a test can run this exact plan on fakes -- see testing.ts.
export const app = defineExtension({
  name: 'Sample',
  modules: [projectsModule],
});

// `activate` registers one synchronous failsafe on `context.subscriptions`;
// `deactivate` is the single cleanup path. Nothing else needs disposing by hand.
export const activate = app.activate;
export const deactivate = app.deactivate;

// Typed invocation from anywhere: the contract fixes the arguments and the
// result, and both the value and any rejection reach this caller.
export const countProjects = (): Promise<number> => app.commands.execute(CountProjects);
```

The second is the module it names:

<!-- sample: docs/samples/commands-and-services.ts -->

```ts
import {
  defineCommandContract,
  defineModule,
  serviceToken,
  type OperationContext,
} from '@kkdev92/vscode-ext-kit';

// A service is an interface plus a token. The token carries the type, so
// injection sites need no casts and a missing registration is a compile error.
interface ProjectIndex {
  count(): number;
  rebuild(signal: AbortSignal): Promise<number>;
}
export const ProjectIndex = serviceToken<ProjectIndex>('sample.projectIndex');

// A command contract names the id once and fixes the argument and result types
// for every caller.
export const CountProjects = defineCommandContract<readonly [], number>({
  id: 'sample.countProjects',
});
export const Rebuild = defineCommandContract<readonly [force: boolean], number>({
  id: 'sample.rebuild',
});

export const projectsModule = defineModule('projects', (module): undefined => {
  module.services.singleton(ProjectIndex, () => {
    let known = 0;
    return {
      count: () => known,
      rebuild: async (signal) => {
        // Cooperative cancellation: the operation's signal aborts on stop,
        // caller cancellation and timeout alike.
        for (let step = 0; step < 10 && !signal.aborted; step += 1) {
          known += 1;
        }
        return known;
      },
    };
  });

  module.commands.handle(CountProjects, {
    inject: { index: ProjectIndex },
    execute: (_context: OperationContext, _args, { index }) => index.count(),
  });

  module.commands.handle(Rebuild, {
    inject: { index: ProjectIndex },
    execute: async (context: OperationContext, [force], { index }) => {
      context.logger.info('rebuilding', { force });
      return index.rebuild(context.signal);
    },
  });

  return undefined;
});
```

That is a complete extension: a service, two commands with typed arguments and
results, cancellation, and structured logging. Add `sample.countProjects` and
`sample.rebuild` to `contributes.commands` in your `package.json` and they appear
in the Command Palette.

Two things that are easy to miss. A service factory is synchronous on purpose —
asynchronous setup belongs in a hosted service, so resolving a service can never
deadlock. And a command's return value **and** its rejection both reach the
caller: the framework does not toast errors for you, because the Command Palette
already shows a dialog and a keybinding already warns.

See the **[Guide](docs/guide.md)** for settings, storage, secrets, hosted
services, watchers, editor commands, UI, views, testing and the escape hatch.

---

## Why vscode-ext-kit

A VS Code extension starts as one `activate()` function, and for a while that is
the right shape. Past a certain size it stops being one: registrations pile onto
`context.subscriptions`, half of them are pushed and half are forgotten, setup
order becomes load-bearing without anyone deciding that it should be, and the
answer to "what does this extension register?" is "read `activate()` and hope".

The usual next step is a folder of helper functions. That tidies the file
without changing the shape — the helpers still reach for `vscode` directly, so
none of it runs in a unit test, and the lifecycle is still whatever order the
calls happen to be in.

This package takes a different route. An extension is a **declaration**:
modules describe what exists, and the framework validates that description
before VS Code is touched, runs it, and unwinds it through one path.

- Mistakes that are knowable up front — a duplicate id, a missing service, a
  dependency cycle — fail at import, not on the day someone runs the command
- Nothing is disposed by hand, so nothing is forgotten
- Handlers receive their capabilities instead of importing them, which is what
  makes a real extension runnable in a test with no VS Code loaded
- There is one way in per ability, so there is no question of which of four
  functions to reach for

---

## Usage

Every ability is reached through a declaration or an injected token.

**A module declares:**

| Declaration                                          | Registers                                                       |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| `module.commands.handle` / `.handleTextEditor`       | a command; the second hands the handler an `ActiveEditor`       |
| `module.services.singleton` / `.transient`           | a service, against a `serviceToken`                             |
| `module.hostedServices.add` / `.background`          | long-lived work with a lifecycle                                |
| `module.settings.add`                                | a `defineSettings` group                                        |
| `module.storage.add` / `module.secrets.add`          | a `defineStorage` / `defineSecret`                              |
| `module.fileWatchers.add`                            | a debounced, batched watcher                                    |
| `module.statusBar.add` / `module.languageStatus.add` | a declared UI item                                              |
| `module.treeViews.add`                               | a tree view, from a `BaseTreeDataProvider`                      |
| `module.webviews.addView` / `.restorePanel`          | a webview view, or a panel restorer                             |
| `module.raw.register`                                | any VS Code API with no model here, still owned and rolled back |

**A handler injects:**

| Token                       | Gives You                                                                 |
| --------------------------- | ------------------------------------------------------------------------- |
| `Notifications`             | `info` `warn` `error` `confirm`                                           |
| `QuickInput`                | `one` `many` `text` `wizard`                                              |
| `Editors`                   | the active editor, and cross-file edits                                   |
| `Localization`              | `t` `plural` `number` `date` `relativeTime`, in the host's language       |
| `Commands`                  | invoking a command, this extension's or the platform's                    |
| `Webviews`                  | `openPanel`                                                               |
| `Secrets`                   | secrets the _user_ names: `get` `set` `delete` `keys`                     |
| `StatusBar`                 | `flash` — a short-lived message with no item of its own                   |
| `FileWatchers`              | `watch`, for a glob known only at runtime                                 |
| `Operations`                | `run`, for work that did not start in a handler                           |
| `Log`                       | a logger for a service, which has no operation to borrow one from         |
| a definition's own `.token` | the settings accessor, typed storage, secret or UI controller it declared |

`notify`, `ask`, `l10n`, `editors`, `commands` and `status` are on every
handler's `context` without being declared — they resolve the same tokens an
`inject` would. `context` also carries `id`, `logger`, `signal`, `progress`
(`run` and weighted `steps`), `resources` and `services`.

Values you pass around: `ok` `err` `unwrap` `mapResult` and the `s.*` schema
builders; `FrameworkError` with `userError` / `validationError` / `classifyError`
/ `isCancellation`; `DisposableCollection` and `createScope`.

Full signatures live in the `.d.ts` files and the JSDoc on each export; a
generated API reference is not built yet.

---

## What Is Guaranteed

- `stop()` runs exactly once, and only after `start()` completed or failed
- Framework-owned resources unwind in reverse order, synchronous registrations first
- A failed activation rolls back everything the framework created
- A command's result and its rejection both reach the caller
- The plan is immutable: mutating a definition after compilation cannot change what runs
- Fakes and real adapters satisfy the same contract suite

---

## Known Limitations

Stated plainly, because a framework that is vague about its boundaries gets
trusted for things it cannot do.

- **Nothing unwinds on a crash**: If the extension host is killed, `deactivate` never runs — persist what matters when the operation that produced it completes, not during shutdown
- **The shutdown budget is shared and hard**: VS Code races _every_ extension's deactivation against 5 seconds and then exits; the framework's own budget (3 s by default) sits inside that, and past it pending work is abandoned rather than awaited — the `application.shutdownTimeout` diagnostic names what was still holding on
- **Rollback covers what the framework owns**: registrations, the services it created, resources placed in one of its scopes, started hosted services — it cannot un-write a file or un-send a request
- **Leak detection has the same boundary**: it sees what the framework tracks, and nothing else
- **Cancellation is cooperative**: aborting a signal asks a handler to stop; one that ignores its signal keeps running, and the framework cannot terminate it
- **The Test Host does not reproduce VS Code**: it renders no UI, interprets no contribution point, and does not substitute a direct `import "vscode"`
- **No editor events yet**: `Editors` hands you the active editor and cross-file edits, but there is no `onDidChangeActive` / `onDidChangeSelection` / `onDidChangeDocument`; subscribing means reaching for `vscode` directly and disposing by hand, which is the one place the single-cleanup-owner rule leaks
- **No log-level filtering, deliberately**: the framework writes to a `LogOutputChannel` and VS Code owns the level — per channel, persisted, in the Output panel. An extension cannot raise its own channel's level, so a `logLevel` setting of your own can only ever make the log quieter
- **No generated API reference yet**, and no step-by-step migration guide from 2.x

---

## How It Works

```text
   defineModule(...)          pure data: no VS Code, no side effects
          |
          v
   compileApplication()       preflight: ids, service graph, scopes
          |
          v
   ApplicationPlan            immutable, deeply frozen
          |
          v
   ApplicationHost            state machine; start / stop exactly once
          |
          v
   capability ports  ------>  real adapters  |  fakes (Test Host)
```

The split at the bottom is the point: the plan above it never learns which side
it is running on, so the plan a test runs is the plan that ships.

Four ideas carry the whole design.

**A module is a value.** Its callback runs once, synchronously, with no side
effects, and produces a frozen description. Anything that needs to _happen_
happens later, in a hosted service or a handler.

**Preflight is not a linter.** It runs inside `defineExtension`, at module import
time, and refuses to produce a plan it cannot run.

**Every unit of work is an operation.** A command invocation, a watcher batch:
each gets an id, a logger, a combined `AbortSignal`, a progress session and a
resource scope that is disposed when the work settles.

**Ownership is explicit.** The host owns registrations and declared UI; the
container owns singletons and disposes them in reverse creation order; an
operation owns what it resolved. `deactivate()` unwinds all of it, once.

---

## Coming from 2.x

2.x is a **utility library**: you call its helpers from your own `activate()`.
3.x is a **framework**: it owns activation and deactivation, and you hand it
modules. Everything 2.x could do, 3.x can do — the shapes changed, because there
is now one way in per ability rather than a standalone function _and_ a
declaration.

Three consequences worth knowing before you port:

- **You no longer push to `context.subscriptions`**: the host owns what it registered, and `deactivate` unwinds all of it
- **A capability arrives by injection, not by import**: that is what makes a handler runnable in a test with no VS Code loaded
- **Cancellation is a signal**: anything that took a `CancellationToken` takes an `AbortSignal`, and `context.signal` already combines the operation's own cancellation with the user's

Typed storage keeps 2.x's envelope format, so values written by a 2.x build are
read by a 3.x build, and the mock kit is unchanged.

The [CHANGELOG](CHANGELOG.md) carries the full old-to-new mapping.

---

## Platform Requirements

|                  |                                                                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code          | `^1.134.0` — your extension declares the same `engines.vscode`; CI tests stable                                                       |
| Extension hosts  | desktop and web, both covered by CI                                                                                                   |
| Node (to build)  | `>=22.12.0`                                                                                                                           |
| Module format    | **ESM only** — `require()` of any subpath fails by design; bundle as extensions normally do                                           |
| TypeScript `lib` | `ESNext.Disposable` (the public types name `Symbol.dispose`) and one of `DOM` / `WebWorker` / `@types/node` (they name `AbortSignal`) |
| TypeScript       | 6.0.x is what this repo builds with; 7.x compiles the package in a non-blocking CI lane                                               |

The floor is `1.134.0` because that is the newest `@types/vscode` there is, so it
is the newest API this package can name at all. The two move together: `vsce`
refuses to package an extension whose `@types/vscode` outruns its
`engines.vscode`, and raising only the types would let code compile against an
API the declared floor does not have. VS Code updates itself and CI tests stable,
so treat the floor as a formality rather than a tested target.
`scripts/verify-package.mjs` checks the `lib` requirements against the packed
`.d.ts` files on every CI run, so that row is verified rather than remembered.

---

## Troubleshooting

- **`ERR_REQUIRE_ESM` or `require() of ES Module`**: the package is ESM only, by design; bundle your extension with esbuild/webpack/rollup, which is what VS Code extensions normally do anyway
- **`Symbol.dispose` or `AbortSignal` is not defined in the types**: add `ESNext.Disposable` and one of `DOM` / `WebWorker` / `@types/node` to `lib` — see [Platform Requirements](#platform-requirements)
- **An error at import time, before anything ran**: that is preflight, and it is working; the message names the duplicate id, the missing service or the cycle, and `problems` on the error carries each one as a code a script can act on
- **A command is greyed out in the Command Palette**: that is `enablement` / `commandPalette` `when` in your `package.json`, not something this package controls
- **A text editor command's result is `undefined`**: VS Code runs those handlers fire-and-forget and discards what they return; use `module.commands.handle` with `Editors.active` when the caller needs the result
- **`vscode` cannot be resolved in tests**: point Vitest's `resolve.alias` at `@kkdev92/vscode-ext-kit/testing/vitest`, or merge `vscodeExtKitVitestConfig`

---

## Security and Privacy

- **No Telemetry**: the package collects no usage data and makes no network requests
- **No Credentials of Its Own**: it holds none, and reads none
- **Secrets Stay Out of Diagnostics**: a secret's value never reaches a log, a diagnostic or an error message — a schema failure reports the key, the vendor and an issue count, never a message, a path or a value
- **Webview Messages Are Untrusted Input**: envelopes are validated before they touch state, and the CSP helper puts a nonce in `script-src` rather than the webview's own source
- **Untrusted Workspaces**: a module declares what it requires, and runtime preflight refuses to activate a module whose requirements this host does not meet

For vulnerability reporting, see [SECURITY.md](SECURITY.md).

---

## Contributing

Contributions are welcome — thank you for helping make this better 🙌
Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

`npm run quality` is the gate: formatting, typecheck, lint, tests with per-layer
coverage floors, and dead-code detection. Two more lanes run the framework in a
real desktop Extension Host and a real browser worker.

If you're planning a larger change, opening an issue first is appreciated. One
thing to know about direction: adding a second way to do something that already
has one is the change most likely to be turned down.

---

## Support & Maintenance Policy

This is a personal project maintained in spare time. It is active, but support
is best-effort: I'll do my best to review issues and PRs, and releases may be a
bit slow sometimes — thank you for your patience.

`4.0.1` is the current release and holds `latest` on npm, so a fresh
`npm install` gets the framework. `2.x` continues on `v2-maintenance` and still
takes bug fixes; anything pinned to `^2.x` resolves there and is unaffected.
Breaking changes are listed in the [CHANGELOG](CHANGELOG.md).

Helpful things when reporting bugs:

- VS Code version, OS, and whether it is the desktop or web extension host
- The smallest module definition that reproduces the issue
- Whether it fails at import (preflight), at activation, or at runtime

Security-related reports should follow [SECURITY.md](SECURITY.md).
Really appreciate you using it 💛

---

## License

[MIT](LICENSE)

---

## Acknowledgments

- Built on the [VS Code Extension API](https://code.visualstudio.com/api); this
  is a third-party project, not affiliated with or endorsed by Microsoft
- Validation follows [Standard Schema](https://standardschema.dev/), so Zod,
  Valibot, ArkType and friends work without an adapter
- Tested with [Vitest](https://vitest.dev/),
  [`@vscode/test-electron`](https://github.com/microsoft/vscode-test) and
  [`@vscode/test-web`](https://github.com/microsoft/vscode-test-web)
