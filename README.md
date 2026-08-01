# @kkdev92/vscode-ext-kit

[![npm version](https://img.shields.io/npm/v/@kkdev92/vscode-ext-kit)](https://www.npmjs.com/package/@kkdev92/vscode-ext-kit)
[![npm downloads](https://img.shields.io/npm/dm/@kkdev92/vscode-ext-kit)](https://www.npmjs.com/package/@kkdev92/vscode-ext-kit)
[![CI](https://github.com/kkdev92/vscode-ext-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/kkdev92/vscode-ext-kit/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue.svg)](https://www.typescriptlang.org/)

A zero-dependency, type-safe utility library for VS Code extension development, published as native ESM.

- **Type-safe by construction** — command IDs, configuration schemas, and multi-step wizards are all checked at compile time, not cast at the call site.
- **Cancellation-aware error handling** — `run`/`tryRun` treat a user pressing Escape (or an aborted `AbortSignal`) as a cancellation, never as an error to toast or rethrow.
- **A public testing kit** — [`@kkdev92/vscode-ext-kit/testing`](#testing-your-extension) mocks the entire `vscode` module, so `activate()` is unit-testable without a running extension host.
- **Typed webview RPC** — [`createWebviewRpc`](#webview) gives webviews an awaitable request/response + event channel over `postMessage`, with timeouts and `AbortSignal` support.
- **Zero runtime dependencies, no Node.js API usage** — works in the web/remote extension host as well as desktop.

> **Requires VS Code `^1.125.0`** (and Node.js `>=22.0.0` to build). This floor
> propagates: an extension depending on this library has to declare the same
> `engines.vscode`, which drops hosts older than roughly June 2026. See
> [Installation](#installation) for the `@types/vscode` caveat that comes with it.

> **Status:** Active (best-effort maintenance)
>
> **Quick Links:** [Installation](#installation) | [Quick Start](#quick-start) | [API Reference](#api-reference) | [Migration from 0.x](#migration-from-0x)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [Extension Kit](#extension-kit)
  - [Logger](#logger)
  - [Error Handling](#error-handling)
  - [Commands](#commands)
  - [Configuration](#configuration)
  - [Storage](#storage)
  - [UI](#ui)
  - [Wizard](#wizard)
  - [Notifications](#notifications)
  - [Status Bar and Language Status](#status-bar-and-language-status)
  - [Progress](#progress)
  - [File Watcher](#file-watcher)
  - [Editor](#editor)
  - [Tree View](#tree-view)
  - [Webview](#webview)
  - [Timing and Retry](#timing-and-retry)
  - [Localization](#localization)
- [Migration from 0.x](#migration-from-0x)
- [Testing Your Extension](#testing-your-extension)
- [Development](#development)
- [Changelog](#changelog)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Features

### Core

- **Extension Kit** — one call wires a logger, a disposable scope, and cancellation-aware error handling
- **Logger** — `LogOutputChannel`-backed structured logging with child scopes and telemetry
- **Error Handling** — `run`/`tryRun` unify logging, user notification, and cancellation
- **Commands** — compile-time checked batch registration, returns per-command `Disposable`s

### Configuration and Storage

- **Config** — schema-validated, cached, observable settings (`defineConfigSchema`)
- **Storage** — versioned/migratable global, workspace, and secret storage with TTL and Settings Sync

### UI Components

- **Pick / Input** — QuickPick and InputBox helpers with async item support
- **Wizard** — type-accumulating multi-step flows with back navigation and branching
- **Notifications** — info/warning/error with reference-resolved action buttons
- **Status Bar / Language Status** — managed items with spinner support
- **Progress** — step-weighted progress with cancellation

### Workspace

- **File Watcher** — debounced, batched file system events
- **Editor** — selection/cursor/offset utilities and multi-file workspace edits
- **Tree View** — cached `TreeDataProvider` with checkboxes, drag & drop, and pagination
- **Webview** — managed panels/views, CSP generation, and a typed `postMessage` RPC channel

### Developer Tools

- **Timing & Retry** — debounce/throttle/timeout/retry, also published as dependency-free `./timing`/`./retry` subpaths
- **Localization** — `vscode.l10n` wrapper, pluralization, and `Intl`-based formatting
- **Testing** — `@kkdev92/vscode-ext-kit/testing` mocks the entire `vscode` module

## Installation

```bash
npm install @kkdev92/vscode-ext-kit
```

> Requires VS Code `^1.125.0` and Node.js `>=22.0.0`. Zero runtime dependencies; the published package uses no Node.js APIs, so it also runs in the web/remote extension host.

Because `engines.vscode` is a floor your own extension inherits, raising it is a
user-visible change for anyone depending on you — set the same `^1.125.0` in your
manifest rather than a lower value you can't honor.

One wrinkle to expect: `@types/vscode` lags the VS Code release line, since
DefinitelyTyped doesn't publish on VS Code's weekly cadence. This library pins
`~1.125.0`, the newest available at release time, and compiles against exactly
the version it declares. If your extension targets a newer host than the types
cover, the API you're reaching for may be absent from the types while being
present at runtime; pin `@types/vscode` to the newest published version and
declare `engines.vscode` to match it.

The published entry points:

| Import | Contents |
| --- | --- |
| `@kkdev92/vscode-ext-kit` | The full API — everything in this document |
| `@kkdev92/vscode-ext-kit/timing` | `debounce`/`throttle`/`withTimeout`/... only, no `vscode` import — safe for a webview bundle |
| `@kkdev92/vscode-ext-kit/retry` | `retry`/`RetryExhaustedError` only, no `vscode` import |
| `@kkdev92/vscode-ext-kit/format` | `pluralFor`/`formatNumberFor`/`formatDateFor`/`formatRelativeTimeFor` — the `Intl` core behind `l10n`, no `vscode` import |
| `@kkdev92/vscode-ext-kit/testing` | `vscode` mocks for unit tests, runner-agnostic — see [Testing Your Extension](#testing-your-extension) |
| `@kkdev92/vscode-ext-kit/testing/vitest` | A ready-made `vscode` module stand-in to alias, for Vitest |
| `@kkdev92/vscode-ext-kit/testing/vitest-config` | The Vitest config that setup needs, as a mergeable value |

`./package.json` is exported too, for build scripts that bake the resolved
version into a bundle.

## Quick Start

```typescript
import * as vscode from 'vscode';
import { createExtensionKit, showInfo } from '@kkdev92/vscode-ext-kit';

export function activate(context: vscode.ExtensionContext) {
  const kit = createExtensionKit<'myext.hello'>(context, 'MyExtension');
  kit.registerCommands({
    'myext.hello': () => showInfo('Hello!'),
  });
}
```

That one call wires a [`Logger`](#logger), a disposable scope, and cancellation-aware [error handling](#error-handling); `kit.registerCommands` adds the commands to that scope and disposes everything — including the logger — when the extension deactivates.

The kit is sugar, not a framework: every module below (config, storage, UI, ...) is a standalone import that works identically without it. Reach for `createLogger`/`run`/`registerCommands` directly if you'd rather wire things up yourself.

## API Reference

Every export below is available from the package root (`@kkdev92/vscode-ext-kit`) unless noted otherwise; see [`src/index.ts`](src/index.ts) for the complete list.

### Extension Kit

One call wires a [`Logger`](#logger), a disposable scope, and logger-bound [error handling](#error-handling) and [command registration](#commands) — the kit registers itself in `context.subscriptions`, so there's nothing to push by hand.

```typescript
import * as vscode from 'vscode';
import { createExtensionKit, showInfo } from '@kkdev92/vscode-ext-kit';

export function activate(context: vscode.ExtensionContext) {
  const kit = createExtensionKit<'myext.hello' | 'myext.sync'>(context, 'MyExtension');

  kit.registerCommands({
    'myext.hello': () => showInfo('Hello!'),
    'myext.sync': () => kit.run('Sync', (signal) => sync(signal)),
  });

  kit.logger.info('activated');
}
```

`ExtensionKit<TCommandId>` exposes:

- `logger` — a [`Logger`](#logger)
- `disposables` — a `DisposableCollection` (see below), disposed along with the logger and every registered command by `kit.dispose()`
- `run` / `tryRun` — [error handling](#error-handling) bound to the kit's logger
- `registerCommands` / `registerTextEditorCommands` / `executeCommand` — [command registration](#commands) bound to the kit's logger and scope
- `dispose()` / `Symbol.dispose` — tears down everything above; called automatically on deactivation

`ExtensionKitOptions` forwards `logger` (`LoggerOptions`) and `commands` (default `RegisterCommandsOptions` applied to every `registerCommands` call made through the kit). The kit deliberately does not wrap config/storage/UI — those stay standalone imports so tree-shaking and type inference keep working; everything else in this document works identically with or without a kit.

`DisposableCollection` (the type of `kit.disposables`) batches disposables with LIFO teardown, aggregated error handling if a `dispose()` throws, and TC39 `using` support (`Symbol.dispose`). `createScope(context)` creates one that's already registered on `context.subscriptions`, useful for grouping one feature's disposables so they can be torn down independently:

```typescript
import { createScope, createStatusBarItem, createFileWatcher } from '@kkdev92/vscode-ext-kit';

const scope = createScope(context);
scope.add(createStatusBarItem('myext.status', { text: 'hi' }));
scope.add(createFileWatcher({ patterns: '**/*.md' }));
// ...later, when the feature is turned off:
scope.dispose();
```

### Logger

`createLogger` builds a logger backed by a native `LogOutputChannel` by default, so timestamps, level colors, the Output panel's level dropdown, and `Developer: Set Log Level` all work without any extra code.

```typescript
import { createLogger } from '@kkdev92/vscode-ext-kit';

const logger = createLogger('MyExtension');
context.subscriptions.push(logger);

logger.info('activated', { workspaceFolders: 2 });
logger.error(new Error('sync failed'), { retry: 3 });

try {
  await sync();
} catch (error) {
  logger.error(error, { retry: 3 }); // `unknown` — catch bindings pass straight through
}

const gitLogger = logger.child('git');
gitLogger.debug('spawn', { args: ['status'] }); // -> [git] spawn {"args":["status"]}

logger.setLevel('warn');
```

`error()`'s first parameter is typed `unknown`, not `string | Error`, so a `catch (error)` binding can be passed straight through — `Error` instances keep their message and stack, anything else is stringified; put structured context in the second argument.

Key `LoggerOptions`:

- `level` — gate applied on top of the channel; defaults to `'trace'` in the default `channelMode: 'log'` (the Output panel's own dropdown already filters), or `'info'` in `'plain'` mode
- `channelMode: 'log' | 'plain'` — `'log'` (default) uses a native `LogOutputChannel`; `'plain'` formats lines by hand, for when the extension must fully control visibility itself (e.g. a "collect verbose logs" command)
- `configSection` — a VS Code setting to read the level from, re-read on every configuration change
- `showOnError` / `showOnErrorThrottleMs` — reveal the channel on `error()`, throttled to avoid popping up repeatedly during an error storm
- `telemetry` — a `vscode.TelemetrySender`, wrapped with `env.createTelemetryLogger` for native PII scrubbing

`logger.child(scope)` returns a `Logger` that prefixes messages with `[scope]` and shares the parent's channel, level, and telemetry; disposing a child is a no-op since only the root owns the channel.

### Error Handling

`run`/`tryRun` are the single place error logging, user notification, and cancellation classification happen — call user-facing operations through one of them instead of a bare `try`/`catch`.

```typescript
import { run, tryRun } from '@kkdev92/vscode-ext-kit';

// Collapses failure to `undefined` — already logged and shown to the user.
const data = await run(logger, 'Fetch data', (signal) => fetchData(signal));
if (data === undefined) return;

// Result-returning variant, for callers that need the error.
const result = await tryRun(logger, 'Fetch data', (signal) => fetch(url, { signal }));
if (result.ok) {
  use(result.value);
} else if (!result.cancelled) {
  fallback(result.error);
}
```

Both receive an `AbortSignal` (aborted once the operation settles or fails) and a `RunOptions`: `userMessage` (custom toast text), `rethrow` (rethrow real errors after logging — cancellations are *never* rethrown), and `silent` (log only, no toast). `isCancellation(error)` recognizes `vscode.CancellationError`, an aborted-signal `AbortError`, or anything named `'Canceled'` — the same classification `run`/`tryRun` use internally.

`Result<T, E = Error>` is `{ ok: true; value: T } | { ok: false; error: E; cancelled: boolean }`, with helpers `ok`, `err`, `unwrap`, `unwrapOr`, `mapResult`, and `mapResultErr`.

Outside `run`/`tryRun` — e.g. a non-user-facing `catch` — [`logger.error`](#logger) takes the caught value directly: its first parameter is `unknown`, not `string | Error`, so there's no normalization step to write by hand.

### Commands

```typescript
import {
  registerCommands,
  registerTextEditorCommands,
  executeCommand,
  showInfo,
} from '@kkdev92/vscode-ext-kit';

type MyCommandId = 'myext.hello' | 'myext.openSettings';

const commands = registerCommands<MyCommandId>(context, logger, {
  'myext.hello': (uri: vscode.Uri) => showInfo(`Hello ${uri.fsPath}`),
  'myext.openSettings': () => executeCommand(logger, 'workbench.action.openSettings'),
});
commands['myext.hello'].dispose(); // disable a single command later

registerTextEditorCommands(context, logger, {
  'myext.reverseSelection': (editor, edit) => {
    for (const selection of editor.selections) {
      const text = editor.document.getText(selection);
      edit.replace(selection, text.split('').reverse().join(''));
    }
  },
});
```

The type parameter is a command-ID union — typos and missing keys fail to build (hand-write it, or generate it from `package.json`). Both functions return `Record<CommandId, vscode.Disposable>` and add every entry to `context.subscriptions`. `RegisterCommandsOptions`: `wrap` (default `true`, wraps each handler with [`run`](#error-handling)) and `commandErrorMessage(id)` (a custom action name used in the error message). `executeCommand(logger, command, ...args)` runs a VS Code command through the same logging/error handling.

### Configuration

```typescript
import { defineConfigSchema, field, s } from '@kkdev92/vscode-ext-kit';

const config = defineConfigSchema('myExt', {
  logLevel: field(s.enum('trace', 'debug', 'info', 'warn', 'error', 'silent'), 'info'),
  maxItems: field(s.number({ min: 1, integer: true }), 50),
});

logger.setLevel(config.get('logLevel')); // validated & cached — never garbage
context.subscriptions.push(
  config.onDidChange('logLevel', (level) => logger.setLevel(level)) // fires only for logLevel
);
await config.set('maxItems', 100);
```

`field(schema, defaultValue, description?)` pairs a [Standard Schema v1](https://standardschema.dev) validator with the value used when a setting is unset or fails validation — either a built-in `s.*` builder (`string`, `number`, `boolean`, `enum`, `array`, `object`, `optional`, `nullable`, `record`, `unknown`, `custom`) or any library with synchronous Standard Schema validation (zod, valibot, ...). `s.nullable(inner)` mirrors `s.optional` for VS Code's `"type": ["string", "null"]` settings pattern, where `null` (not `undefined`) means "unset": `field(s.nullable(s.enum('compact', 'wide')), null)` accepts `'compact'`, `'wide'`, or `null`. `validateSchema(schema, value)` runs a schema directly if you need one outside config/storage.

`TypedConfig` returned by `defineConfigSchema`:

- `get(key, scope?)` — validated read, silently falling back to the default; `tryGet(key, scope?)` reports validation issues instead, as `Result<T, ConfigValidationIssue[]>`
- `getAll(scope?)` — every field at once
- `set(key, value, target?, overrideInLanguage?)`
- `onDidChange(key, listener, scope?)` — fires only when that key changes; `onDidChangeAny(listener)` fires the raw `ConfigurationChangeEvent` for the whole section
- `inspect(key)` — raw `WorkspaceConfiguration.inspect`, typed
- `checkPackageJsonSync(context)` — dev-time check: fully-qualified keys declared in the schema but missing from `package.json`'s `contributes.configuration`

For a single setting too small to warrant a schema, `watchSetting(section, key, defaultValue)` returns a live `{ value, onDidChange }` pair without validation.

### Storage

```typescript
import { createGlobalStorage, createWorkspaceStorage, createSecretStore } from '@kkdev92/vscode-ext-kit';

interface UserPrefs {
  theme: string;
  fontSize: number;
}

const prefs = createGlobalStorage<UserPrefs>(context, 'preferences', {
  defaultValue: { theme: 'dark', fontSize: 14 },
  version: 2,
  migrations: { 1: (old) => ({ ...(old as { theme: string }), fontSize: 14 }) },
  syncable: true, // opts into Settings Sync via setKeysForSync
});
context.subscriptions.push(prefs);

const current = prefs.get();
await prefs.set({ ...current, theme: 'light' });

const recentFiles = createWorkspaceStorage<string[]>(context, 'recentFiles', { defaultValue: [] });

const secrets = createSecretStore(context);
await secrets.set('apiKey', 'sk-...');
secrets.onDidChange((key) => logger.info(`${key} changed`));
```

`StorageOptions<T>`: `defaultValue`, `schema?` (Standard Schema, validated on every read), `version?`/`migrations?` (keyed by the version they migrate *from*; a gap in the chain stops early and defers to validation), and `ttlMs?` (an entry reads back as unset once expired). `GlobalStorageOptions` adds `syncable`. Every write is a single atomic `Memento.update()` (not a value+version pair).

`TypedStorage<T>`: `get()` (never throws, falls back to the default), `tryGet()` (`Result` reporting *why* a fallback happened — migration or validation failure), `set`, `reset`, `has`, `delete`, and `onDidChange` (fires for writes made through this instance).

`createSecretStore(context)` spans every secret the extension owns (`get`/`set`/`delete`/`onDidChange`, plus `keys()` on VS Code 1.105+, feature-detected); `createSecretStorage(context, key)` wraps a single key with the same `onDidChange`. `listStorageKeys(memento, prefix?)` lists keys stored in a `Memento`.

### UI

```typescript
import { pickOne, toPickItem, toPickSeparator, inputText } from '@kkdev92/vscode-ext-kit';

const items = [
  toPickItem('feature', { label: 'Feature', description: 'New feature' }),
  toPickItem('fix', { label: 'Bug Fix', icon: 'bug' }),
];
const selected = await pickOne(items, { placeHolder: 'Select a type' });
if (selected) console.log(selected.value); // 'feature' | 'fix', not a label string

// toPickSeparator inserts a non-selectable group divider between items
await pickOne([toPickSeparator('Recent'), ...items, toPickSeparator('All')]);

// Async items: the picker opens immediately with a busy spinner while this resolves.
const branch = await pickOne(
  fetchBranches().then((names) => names.map((n) => toPickItem(n, { label: n })))
);

// `prompt` adds a line of instructional text above the list.
await pickOne(items, { prompt: 'This rewrites history and cannot be undone.' });

const name = await inputText({
  prompt: 'Enter project name',
  validate: (value) => (/^[a-z-]+$/.test(value) ? undefined : 'Use lowercase letters and hyphens only'),
});
```

`toPickItem(value, display)` separates the returned **value** from what's displayed (`label`/`description`/`detail`/`icon`/`resourceUri`/...); `pickMany` mirrors `pickOne` for multi-selection. Both accept a plain array or a `Thenable` of items, and `PickOptions` adds `prompt` on top of `vscode.QuickPickOptions`. `toPickSeparator(label?)` inserts a non-selectable group divider. `toPickButton(icon, opts?)` builds a `QuickInputButton` — taking a codicon name like `toPickItem` does — with `location` (title / inline / inside the input box) and `toggled` for on/off toggle buttons whose `toggle.checked` VS Code flips in place. Wire presses up through `PickOptions`: `buttons` for the title bar, `onTriggerButton`/`onTriggerItemButton` for the handlers. Both receive the live `QuickPick`, so a row-level action can update the list in place and leave the picker open:

```typescript
const remove = toPickButton('trash', { tooltip: 'Delete' });
const chosen = await pickOne(
  keys.map((key) => ({ ...toPickItem(key, { label: key }), buttons: [remove] })),
  {
    onTriggerItemButton: async (_button, item, picker) => {
      await secrets.delete(item.value);
      picker.items = picker.items.filter((candidate) => candidate !== item);
    },
  }
);
``` `inputText`'s `InputTextOptions` adds `password` and `ignoreFocusOut` to the usual prompt/placeholder/`validate`.

### Wizard

The step-array form is gone — a wizard is now a type-accumulating fluent builder, so `.run()` resolves with an exact, cast-free state shape.

```typescript
import { wizard, quickpickStep, inputStep, toPickItem } from '@kkdev92/vscode-ext-kit';

const result = await wizard()
  .step(
    'type',
    quickpickStep({
      items: () => [
        toPickItem('feature', { label: 'Feature', description: 'New feature' }),
        toPickItem('fix', { label: 'Bug Fix', description: 'Fix a bug' }),
      ],
    })
  )
  .step(
    'name',
    inputStep({
      prompt: 'Branch name',
      validate: (v) => (/^[a-z0-9-]+$/.test(v) ? undefined : 'lowercase only'),
    })
  )
  .optionalStep('description', inputStep({ prompt: 'Description' }), {
    skip: (s) => s.type === 'fix',
  })
  .run({ title: 'Create Branch' });

if (result.ok) {
  // result.value: { type: 'feature' | 'fix'; name: string; description?: string } — exact, no casts
  const { type, name, description } = result.value;
  await createBranch(`${type}/${name}`, description);
} else {
  // Always a cancellation here — an unexpected items/value/validate failure
  // instead rejects .run() as a WizardStepError, it never resolves this branch.
  logger.info(`Wizard cancelled at ${String(result.error.atKey)}`);
}
```

Each `.step(key, def)` (required) / `.optionalStep(key, def, { skip })` (may be skipped) folds its value into the builder's accumulated state type. `.branch((state) => builder)` swaps in an entirely different set of steps based on the state gathered so far. Build steps with `quickpickStep` (items may be async — shows a busy spinner automatically) and `inputStep` (validation may be async, debounced by 100ms while typing). `WizardRunOptions`: `title`, `showStepNumbers` (default `true`), `ignoreFocusOut` (default `true`). A step's `items`/`value`/`validate` callback throwing rejects `.run()` with a `WizardStepError` (`.atKey`, `.cause`) instead of resolving.

### Notifications

```typescript
import { showInfo, showWarn, showError, confirm } from '@kkdev92/vscode-ext-kit';

await showInfo('Operation completed successfully');

// Return type is inferred as 'reload' | 'ignore' | undefined
const action = await showWarn('File changed on disk', {
  actions: [
    { title: 'Reload', value: 'reload' as const },
    { title: 'Ignore', value: 'ignore' as const },
  ],
});

const confirmed = await confirm('Delete this file?', { severity: 'error' });
if (confirmed) await deleteFile();

// "Don't ask again", persisted in global state
const proceed = await confirm('Enable experimental feature?', {
  severity: 'info',
  remember: { memento: context.globalState, key: 'myext.confirmedExperimental' },
});
```

`showInfo`/`showWarn`/`showError` resolve with the clicked action's `value` — matched by reference, not by title, so duplicate labels work — or `undefined` if dismissed. `NotifyOptions`: `modal`, `detail` (rendered only when `modal: true`), `actions: NotifyAction<T>[]`. `confirm`'s `ConfirmOptions`: `yesText`/`noText`, `modal` (default `true`), `detail`, `severity: 'info' | 'warn' | 'error'` (default `'warn'`), and `remember` (adds a "Don't Ask Again" button backed by a `Memento`, and short-circuits future calls).

### Status Bar and Language Status

```typescript
import {
  createStatusBarItem,
  showStatusMessage,
  createLanguageStatusItem,
} from '@kkdev92/vscode-ext-kit';

const statusItem = createStatusBarItem('myext.status', {
  text: '$(sync) Syncing',
  command: 'myext.sync',
  priority: 100,
});
context.subscriptions.push(statusItem);

statusItem.showSpinner('Processing...');
await doWork();
statusItem.hideSpinner();
statusItem.update('$(check) Synced', 'Last sync: just now');

showStatusMessage('File saved!', 3000); // self-dismisses; or hold the Disposable to dismiss early

const eslintStatus = createLanguageStatusItem(
  'myext.eslint',
  { language: 'typescript' },
  { name: 'ESLint', text: '$(check) No issues' }
);
eslintStatus.update('$(warning) 3 problems', { severity: 'warn' });
```

`ManagedStatusBarItem`: `update(text, tooltip?)`, `set(partialOptions)`, `show`/`hide`, `showSpinner(text?)`/`hideSpinner()` (spinner state and text updates no longer clobber each other), and `.native` for the underlying `vscode.StatusBarItem`. `createLanguageStatusItem(id, selector, options)` shows an item only while the active editor's language matches `selector`, in the dedicated Language Status area; its `update(text, opts?)` mirrors the status bar item's shape (`detail`/`severity`/`busy`/`command`).

### Progress

```typescript
import { withProgress, withSteps, toAbortSignal } from '@kkdev92/vscode-ext-kit';

await withProgress(
  'Fetching...',
  async (progress, token) => {
    const response = await fetch(url, { signal: toAbortSignal(token) });
    progress.report({ message: 'Parsing...' });
    return response.json();
  },
  { cancellable: true }
);

const result = await withSteps(
  { title: 'Deploying...', cancellable: true },
  { label: 'Building', task: build, weight: 3 },
  { label: 'Testing', task: runTests, weight: 5 },
  { label: 'Publishing', task: publish, weight: 2 }
);
if (result.cancelled) return;
const [buildResult, testResult, publishResult] = result.results; // each precisely typed
```

`withProgress`'s `ProgressOptions`: `location` (default `vscode.ProgressLocation.Notification`) and `cancellable`. `withSteps` takes steps as **rest arguments** (not an array) so `result.results` infers a precise per-step tuple type without an `as const`; each step's `weight` (default `1`) determines how much of the bar it fills on completion. Cancellation always comes back as `{ completed: false, cancelled: true }` with the results gathered so far — whether the token tripped between steps or a running step rejected because of it — so one `if (result.cancelled)` branch covers both and only real errors throw. `toAbortSignal(token)` bridges a `CancellationToken` to the `AbortSignal` APIs like `fetch` expect.

### File Watcher

```typescript
import * as vscode from 'vscode';
import { createFileWatcher, watchFile } from '@kkdev92/vscode-ext-kit';

const watcher = createFileWatcher({
  patterns: ['**/*.ts', '**/*.tsx'],
  ignorePatterns: ['**/node_modules/**'],
  debounceDelay: 300,
  maxBatchSize: 500, // flush immediately during large bursts (checkout, npm install, ...)
});
watcher.onDidChange((events) => {
  for (const event of events) logger.debug(`${event.type}: ${event.uri.fsPath}`);
});
context.subscriptions.push(watcher);

const configUri = vscode.Uri.file('/path/to/.myconfig');
const configWatcher = watchFile(configUri, () => reloadConfig(), 500);
```

`FileWatcherOptions.patterns` accepts plain glob strings and/or `vscode.RelativePattern` entries — mix bases for multi-root workspaces in one watcher. `events` (default all three) also determines which native `ignore*Events` flags are passed to VS Code, so event kinds nobody asked for are never subscribed to in the first place. Events are deduped per file and delivered as one batched array per debounce window; `pause()`/`resume()`/`isWatching` control delivery without tearing down the native watchers.

### Editor

```typescript
import {
  getSelectedText,
  transformSelection,
  getFilePath,
  applyEditsGrouped,
  applyWorkspaceEdits,
} from '@kkdev92/vscode-ext-kit';

await transformSelection(editor, (text) => text.toUpperCase());

const location = getFilePath(editor); // { fsPath, uri } | undefined — remote/virtual fs aware
if (location) logger.info(location.uri.scheme, { fsPath: location.fsPath });

await applyEditsGrouped(editor, [
  (eb) => eb.insert(pos1, 'foo'),
  (eb) => eb.replace(range2, 'bar'),
]); // collapses to a single Undo step

await applyWorkspaceEdits(
  matches.map((m) => ({ uri: m.uri, range: m.range, newText: m.replacement })),
  { label: 'Rename symbol across files' }
); // multi-file, atomic — does not require the files to be open in an editor
```

Also included: selection/cursor helpers (`getSelectedText`, `getAllSelectedText`, `insertAtCursor`, `getLine`/`getCurrentLine`, `moveCursor`, `selectRange`/`selectLine`/`selectWord`), `replaceText`/`applyEdits`/`transformAllSelections`, and batch offset/position conversion (`rangeFromOffsets`, `getTextInOffsetRange`, `resolvePositionsBatch`, `resolveOffsetsBatch`) that resolve many regex-match offsets in a single document pass instead of one lookup per match. `getFilePath` returns `undefined` only for `untitled` documents — local, Remote-SSH/WSL/Codespaces, and virtual file systems all resolve normally.

### Tree View

```typescript
import * as vscode from 'vscode';
import { BaseTreeDataProvider, createTreeView, withPagination, type TreeItemData } from '@kkdev92/vscode-ext-kit';

interface FileItem extends TreeItemData<{ path: string }> {}

class FileTreeProvider extends BaseTreeDataProvider<FileItem> {
  async getRoots(): Promise<FileItem[]> {
    return [
      {
        id: 'src',
        label: 'src',
        collapsibleState: vscode.TreeItemCollapsibleState.Collapsed,
        data: { path: '/src' },
      },
    ];
  }

  async getChildrenOf(element: FileItem): Promise<FileItem[]> {
    const files = await listFiles(element.data!.path);
    const items: FileItem[] = files.map((f) => ({ id: f, label: f, data: { path: f } }));
    return withPagination(items, 500); // caps at 500 + a "Load more…" sentinel item
  }
}

const treeView = createTreeView(context, 'myext.files', new FileTreeProvider(), {
  showCollapseAll: true,
});
treeView.badge = { value: 3, tooltip: '3 pending' }; // the real vscode.TreeView is returned
```

`BaseTreeDataProvider` caches `getChildrenOf` results per element and refreshes just the affected subtree via `refresh(element?)`; override `getParentOf` to enable `TreeView.reveal()`. `SimpleTreeDataProvider<T>` is a ready-made in-memory implementation (`setItems`/`setChildren`/`addItem`/`updateItem`/`removeItem`/`findItem`, all O(1) plus subtree size, and nested-aware — including `reveal()` support out of the box). A `collapsibleState` you set is respected: a group built `Expanded` stays open across partial updates, and `addItem(item, { parentId?, index? })` can put a node at a position — pinning a "Favorites" group on top without `setItems` rebuilding (and collapsing) the whole tree. Checkbox toggles surface through `onDidChangeCheckboxState` (bridged automatically by `createTreeView`); `createDragAndDropController({ mimeType, onDrop })` builds a `TreeDragAndDropController`; `withPagination(items, pageSize, { label?, command?, iconPath? })` caps a level at `pageSize` and appends a `LOAD_MORE_ID`-tagged sentinel — pass a `command` and the row is clickable, otherwise your `getChildrenOf` recognizes the id itself. A bare string still works in place of the options object.

### Webview

```typescript
import { createWebviewPanel, generateNonce, type WebviewRpcSchema } from '@kkdev92/vscode-ext-kit';

interface MyRpcSchema extends WebviewRpcSchema {
  hostRequests: { save: { params: { content: string }; result: { ok: boolean } } };
  hostEvents: { theme: { kind: 'light' | 'dark' } };
}

const panel = createWebviewPanel<MyRpcSchema>(context, {
  viewType: 'myext.editor',
  title: 'Custom Editor',
  enableScripts: true,
});

await panel.setHtmlFromTemplate('media/editor.html', {
  cspSource: panel.native.webview.cspSource,
  nonce: generateNonce(),
});

panel.rpc.onRequest('save', async ({ content }) => {
  await writeFile(content);
  return { ok: true };
});
panel.rpc.emit('theme', { kind: 'dark' });
```

`createWebviewPanel<S, TIn, TOut>(context, options: WebviewOptions)` returns a `ManagedWebviewPanel`: `setHtml`/`setHtmlFromTemplate`, raw `postMessage`/`onMessage` (prefer `.rpc` for request/response), `onDidChangeViewState`, `onDidDispose`, `reveal`, `asWebviewUri`, and `.native`. `registerWebviewPanelSerializer` restores panels across editor restarts; `registerWebviewView` is the sidebar/panel-view equivalent, resolving to a `ManagedWebviewView` each time VS Code shows the view.

`createWebviewRpc<S>(webview)` — also exposed as `.rpc` on both managed wrappers, or callable directly on any raw `vscode.Webview` (e.g. inside `registerWebviewView`'s resolve callback) — layers a typed, awaitable `request`/`onRequest`/`emit`/`onEvent` channel over the webview's raw `postMessage`. A `WebviewRpcSchema` declares `webviewRequests`/`hostRequests`/`hostEvents`/`webviewEvents`. Request fields are named after the side that **answers** the request — `hostRequests` are the ones you bind with `rpc.onRequest`, `webviewRequests` the ones you send with `rpc.request` — while event fields are named after the side that **sends** them. `request(method, params, { signal?, timeoutMs? })` rejects on timeout, abort, an error response, or the RPC being disposed (e.g. the panel closes) while in flight. This library ships only the extension-host side — copy the small webview-side counterpart from `createWebviewRpc`'s JSDoc example in [`src/views/webview/rpc.ts`](src/views/webview/rpc.ts) into your webview bundle.

`generateCSP(webview, options?)` builds a strict-by-default CSP string — `allowInlineStyles`/`allowAnyHttpsImages` are opt-in, both `false` by default; `generateNonce()` makes a random nonce. `loadHtmlTemplate`/`createWebviewHtml`/`escapeHtml` cover simple `{{variable}}` templating (`{{raw:variable}}` for unescaped, `{{webviewUri:path}}` for resolved URIs) and HTML escaping.

### Timing and Retry

```typescript
import { debounce, throttle, withTimeout, retry, RetryExhaustedError } from '@kkdev92/vscode-ext-kit';

const debouncedSave = debounce(save, 500, { maxWait: 2000 }); // force a flush at least every 2s
onDidChangeTextDocument(() => debouncedSave(editor.document.getText()));

const throttledUpdate = throttle(() => updateVisibleRange(), 100);

const data = await withTimeout((signal) => fetch(url, { signal }), 5000);

try {
  const result = await retry(({ signal }) => fetch(url, { signal }).then((r) => r.json()), {
    maxAttempts: 5,
    timeoutMs: 2000,
  });
} catch (error) {
  if (error instanceof RetryExhaustedError) {
    logger.error(`Gave up after ${error.attempts} attempts`, { history: error.history });
  }
}
```

`debounce`/`throttle` share one timer engine with `leading`/`trailing`/`maxWait`/`signal` options and `cancel()`/`flush()`/`pending()` helpers (`throttle` defaults `leading` to `true`). `withTimeout` races a promise — or an `AbortSignal`-aware function — against a timeout, throwing `TimeoutError`. `retry`'s `jitter` defaults to `'full'` (randomized full-jitter backoff, capped by `maxDelay`); exhaustion throws `RetryExhaustedError` with `.attempts`/`.history`/`.cause`. `withTiming`/`measureTime` measure (and optionally log) elapsed time.

`./timing` and `./retry` are also published as separate subpath exports (`@kkdev92/vscode-ext-kit/timing`, `@kkdev92/vscode-ext-kit/retry`) with no `vscode` import — safe to bundle directly into a webview.

### Localization

```typescript
import { l10n, plural, formatNumber, formatDate, formatRelativeTime } from '@kkdev92/vscode-ext-kit';

l10n.t('Hello, {0}!', userName);
l10n.t({ message: 'Found {0} files', args: [count], comment: 'Status bar text' });

plural(1, { one: '{count} item', other: '{count} items' }); // "1 item"
formatNumber(1234.56, { style: 'currency', currency: 'USD' }); // "$1,234.56"
formatDate(new Date(), { dateStyle: 'long' }); // "February 4, 2026"
formatRelativeTime(-1, 'day'); // "1 day ago"
```

`l10n.t(...)` matches the `l10n.t(...)`/`vscode.l10n.t(...)` callee shape `@vscode/l10n-dev`'s static extractor scans for (the 0.x bare `t()` export did not). `getLanguage()` returns the current display language (`vscode.env.language`); `isLanguage(locale)` checks a prefix match (e.g. `isLanguage('ja')`). `plural`/`formatNumber`/`formatDate`/`formatRelativeTime` use VS Code's current display language via `Intl`; their vscode-free cores (`pluralFor`, `formatNumberFor`, `formatDateFor`, `formatRelativeTimeFor`, each taking an explicit language) are reusable from a webview bundle — import them from `@kkdev92/vscode-ext-kit/format` so the bundle doesn't pull in `vscode` through the root barrel. `getOrCreateCached(cache, key, limit, create)` — the bounded-LRU helper backing all four formatter caches — is exported for reuse in your own code.

## Migration from 0.x

1.0 is a ground-up, intentionally-breaking redesign: `getSetting`/`setSetting`/`onConfigChange`, `safeExecute`/`trySafeExecute`, the wizard's declarative step-array form, `showWithActions`, and the `WebView*`-prefixed names are all gone. See [MIGRATION.md](MIGRATION.md) for the complete 0.x → 1.0 mapping, including the one-call `createExtensionKit` equivalent of the old `createLogger` + `registerCommands` pair.

---

## Testing Your Extension

`@kkdev92/vscode-ext-kit/testing` mocks the entire `vscode` module for unit tests — no running extension host required. It's a separate subpath with no dependencies, and it never imports a test runner: every factory takes a small `{ fn }`-shaped object instead, so the same mocks work with Vitest's `vi`, Jest's `jest`, or a compatible object.

### Setup for Vitest

Merge the shipped config. That's the whole setup — no setup file, and nothing to know about how Vitest resolves `vscode`:

```ts
// vitest.config.ts
import { defineConfig, mergeConfig } from 'vitest/config';
import { vscodeExtKitVitestConfig } from '@kkdev92/vscode-ext-kit/testing/vitest-config';

export default mergeConfig(
  vscodeExtKitVitestConfig,
  defineConfig({
    test: {
      environment: 'node',
      clearMocks: true, // resets call history between tests automatically
    },
  })
);
```

Any test file can now `import * as vscode from 'vscode'` and get the mock, and so can the code under test — including a built `dist/` bundle you want to `activate()` for real.

<details>
<summary>What that config does, and the <code>vi.mock</code> alternative</summary>

Two things have to line up, and each produces a confusing error on its own:

- **`resolve.alias`** maps `vscode` to `@kkdev92/vscode-ext-kit/testing/vitest`, a module that exports `createVSCodeMock(vi)`'s result as named exports (which is what `import * as vscode` reads — a default export alone leaves every `vscode.window` call undefined).
- **`server.deps.inline`** keeps Vitest from externalizing this kit. Externalized packages load through Node's ESM loader, which knows nothing about Vite aliases, so without it the kit's own `import * as vscode from 'vscode'` fails with `Cannot find package 'vscode'` even though your test files resolve it fine.

The older `vi.mock` approach still works and remains the right choice for Jest (and for anyone who wants a fresh mock per test file):

```ts
// tests/setup.ts
import { vi } from 'vitest';
import { createVSCodeMock } from '@kkdev92/vscode-ext-kit/testing';

vi.mock('vscode', () => createVSCodeMock(vi));
```

It needs `setupFiles: ['./tests/setup.ts']` plus the same `server.deps.inline` entry. Note that `vi.mock` only applies to modules Vite transformed, which is why it cannot reach a prebuilt bundle.

Because an alias is evaluated once per test file, the mock is shared across the tests in that file. `clearMocks: true` handles call history; a field a test assigns itself (say `window.activeTextEditor`) should be restored in an `afterEach`, or use the standalone builders below for a fixture scoped to one test.

</details>

### Testing an activation function

`createMockExtensionContext` and `createMockLogger` return values typed as the real `vscode.ExtensionContext` and this library's `Logger` — no `as any`/`as never` needed at the call site.

```ts
import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { createMockExtensionContext, createMockLogger } from '@kkdev92/vscode-ext-kit/testing';
import { activate } from '../src/extension.js';

describe('myExtension', () => {
  it('registers the hello command', () => {
    const context = createMockExtensionContext(vi);
    const logger = createMockLogger(vi);

    activate(context, logger);

    expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
      'myext.hello',
      expect.any(Function)
    );
  });
});
```

### Driving events from a mock

Individual builders (`createMockFileSystemWatcher`, `createMockQuickPick`, `createMockTreeView`, ...) are also exported for tests that want a standalone fixture. Each exposes `_`-prefixed test-driving helpers to simulate the native events VS Code would normally fire:

```ts
import { vi } from 'vitest';
import * as vscode from 'vscode';
import { createMockFileSystemWatcher } from '@kkdev92/vscode-ext-kit/testing';

const watcher = createMockFileSystemWatcher(vi);
vi.mocked(vscode.workspace.createFileSystemWatcher).mockReturnValue(watcher);

// ... code under test registers a listener on watcher.onDidChange ...
watcher._fireChange({ fsPath: '/test/file.ts' });
```

### Overriding or extending the mock

The defaults mirror a freshly started extension host — no open editor, no workspace folder. `activeTextEditor` / `visibleTextEditors` are plain mutable fields (not getters), so override one for a single test by assigning it directly — no need to recompose the `window` namespace:

```ts
import { vi } from 'vitest';
import * as vscode from 'vscode';
import { createMockTextEditor } from '@kkdev92/vscode-ext-kit/testing';

vscode.window.activeTextEditor = createMockTextEditor(vi, 'const x = 1;', 'typescript');
```

To add an API this kit doesn't mock yet, spread the namespace you need inside `vi.mock`'s factory instead of hand-building the whole module:

```ts
import { vi } from 'vitest';
import { createVSCodeMock } from '@kkdev92/vscode-ext-kit/testing';

vi.mock('vscode', () => {
  const base = createVSCodeMock(vi);
  return {
    ...base,
    env: { ...base.env, openExternal: vi.fn().mockResolvedValue(true) },
  };
});
```

---

## Development

### Prerequisites

- Node.js >= 22.22.1 (Node 24 LTS recommended)
- npm >= 10.0.0

### Setup

```bash
git clone https://github.com/kkdev92/vscode-ext-kit.git
cd vscode-ext-kit
npm install
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to dist/ |
| `npm test` | Run tests with Vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Fix ESLint errors |
| `npm run format` | Format code with Prettier |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run knip` | Check for unused code/exports |

### Git Hooks

Pre-commit hooks automatically run:
1. **lint-staged** - Formats and lints staged files
2. **typecheck** - Verifies TypeScript types
3. **test** - Runs the test suite

## Changelog

See [CHANGELOG.md](CHANGELOG.md) for the release history.

---

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

---

## Security

To report a vulnerability, please see [SECURITY.md](SECURITY.md).

---

## License

[MIT](LICENSE)
