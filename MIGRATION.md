# Migrating from 0.x to 1.0

Version 1.0 is a ground-up redesign focused on type safety, performance and
testability. It is intentionally **not** backwards compatible. This guide maps
every 0.x API to its 1.0 replacement.

The API surface aside, note the host requirement: since 2.0 it is VS Code
`^1.125.0`, where 0.5 and 1.x declared `^1.96.0` (see the CHANGELOG for why).
Node `>=22` for development. The library still has zero runtime dependencies.

## The 5-minute version

Most extensions only need this:

```typescript
// 0.x
const logger = createLogger('MyExt', { level: 'info' });
context.subscriptions.push(logger);
registerCommands(context, logger, {
  'myext.hello': () => showInfo('Hello!'),
});

// 1.0 — one call wires logger + error handling + commands
const kit = createExtensionKit<'myext.hello'>(context, 'MyExt');
kit.registerCommands({
  'myext.hello': () => showInfo('Hello!'),
});
```

Everything the kit does is also available as standalone functions — the kit is
optional sugar, not a framework.

## Logger

| 0.x | 1.0 |
| --- | --- |
| `logger.info('msg', arg1, arg2)` (printf-style varargs) | `logger.info('msg', { key: value })` (structured fields) |
| `logger.error('msg', err)` (varargs) | `logger.error(err, { ... })` — first argument is `unknown`, so a `catch (error)` binding passes straight through; put any extra context in the fields object |
| Hand-formatted `[INFO] [timestamp]` lines | Native `LogOutputChannel` (timestamps/colors/level dropdown come from VS Code) |
| `timestamp` option | Removed — VS Code renders timestamps in `'log'` mode; `'plain'` mode always includes them |
| `telemetryReporter` (custom interface) + `redactStackPaths` | `telemetry: vscode.TelemetrySender` — wrapped with `env.createTelemetryLogger`, which scrubs PII natively |
| — | `logger.child('scope')` prefixes messages with `[scope]` |
| — | `logger.level` getter, `Symbol.dispose` support |

The library-side `level` gate now defaults to `'trace'` (pass-through) because
the Output panel filters by the user-selected level. Set `channelMode: 'plain'`
to restore fully self-controlled filtering.

## Error handling: safeExecute → run

| 0.x | 1.0 |
| --- | --- |
| `safeExecute(logger, name, fn, opts)` | `run(logger, name, fn, opts)` |
| `trySafeExecute(...)` → `Result<T>` | `tryRun(...)` → `Result<T>` |
| `SafeExecuteOptions` | `RunOptions` |

New behavior:

- `fn` receives an `AbortSignal`.
- `vscode.CancellationError` / `AbortError` are **cancellations**, not errors:
  logged at debug level, no error toast, never rethrown (even with
  `rethrow: true`), and marked `cancelled: true` on the `Result` failure branch.
- `Result` gained helpers: `ok`, `err`, `unwrap`, `unwrapOr`, `mapResult`,
  `mapResultErr`.

## Commands

- `registerCommands` / `registerTextEditorCommands` now **return**
  `Record<CommandId, vscode.Disposable>` for selective disposal.
- Pass a command-ID union for compile-time checking:
  `registerCommands<'a.x' | 'a.y'>(...)` — typos and missing keys fail to build.
- `RegisterCommandsOptions.wrapWithSafeExecute` → `wrap`.
- `CommandHandler` accepts precisely-typed handlers
  (`(uri: vscode.Uri) => void`) that 0.x wrongly rejected.

## Config

The stringly-typed helpers are gone; configuration is now schema-driven.

```typescript
// 0.x
const level = getSetting<string>('myExt', 'logLevel', 'info');
onConfigChange('myExt', () => { /* re-read everything */ });

// 1.0
const config = defineConfigSchema('myExt', {
  logLevel: field(s.enum('trace', 'debug', 'info', 'warn', 'error'), 'info'),
  maxItems: field(s.number({ min: 1, integer: true }), 50),
});
config.get('logLevel');                    // 'trace' | 'debug' | ... — validated, cached
config.onDidChange('logLevel', (v) => logger.setLevel(v));
await config.set('maxItems', 100);
```

| 0.x | 1.0 |
| --- | --- |
| `getConfig(prefix)` | `defineConfigSchema(section, fields)` (raw access: `vscode.workspace.getConfiguration`) |
| `getSetting(prefix, key, default)` | `config.get(key)` (validated) / `config.tryGet(key)` (`Result` with issues) |
| `setSetting(prefix, key, value, target)` | `config.set(key, value, target?)` |
| `onConfigChange(prefix, cb)` | `config.onDidChange(key, cb)` (per key) / `config.onDidChangeAny(cb)` (per section) |
| — | `watchSetting(section, key, default)` — live `value` + `onDidChange` pair |
| — | `config.inspect(key)`, `config.checkPackageJsonSync(context)` |

Schemas use the built-in zero-dependency `s.*` builders or any Standard
Schema v1 library with synchronous validation (zod, valibot, ...).

## Storage

- Values are stored in a single envelope key (one `memento.update` per write
  instead of two; version lives inside the envelope). **0.x stored values are
  not read back** — treat 1.0 as a fresh store or write a one-off migration.
- `migrate()` failures no longer crash `get()` — the default value wins.
- New: TTL (`ttlMs`), `syncable` (Settings Sync via `setKeysForSync`),
  `tryGet()`, typed `onDidChange`, optional schema validation.
- New `createSecretStore(context)`: multi-key secret management, including
  `keys()` (`SecretStorage.keys`, stable since VS Code 1.105 — below this
  library's `^1.125.0` floor, so it is called directly with no feature
  detection). `createSecretStorage` (single key) remains.

## UI

### pick / input

- `pickOne` / `pickMany` are rebuilt on `createQuickPick`: items may be a
  `Thenable` (busy spinner shown automatically), separators via
  `toPickSeparator()`, and value/display separation via `PickItem<T>` /
  `toPickItem(value, display)` — the resolved **value** is returned instead of
  the item object.
- `inputText` is unchanged apart from a new `ignoreFocusOut` option.

### wizard

The declarative step array is replaced by a type-accumulating fluent builder:

```typescript
// 1.0
const result = await wizard()
  .step('type', quickpickStep({
    items: () => [
      toPickItem('feature', { label: 'Feature' }),
      toPickItem('fix', { label: 'Bug Fix' }),
    ],
  }))
  .step('name', inputStep({
    prompt: 'Branch name',
    validate: (v) => (/^[a-z0-9-]+$/.test(v) ? undefined : 'lowercase only'),
  }))
  .optionalStep('description', inputStep({ prompt: 'Description' }), {
    skip: (s) => s.type === 'fix',
  })
  .run({ title: 'Create Branch' });

if (result.ok) {
  // result.value: { type: 'feature' | 'fix'; name: string; description?: string }
  // — exact shape, no casts
} else {
  // result.error.atKey: where the user left; result.error.state: answers so far
}
```

Improvements over 0.x: per-step titles work (native `step`/`totalSteps`
replaces the title hack), async items with automatic `busy`, async debounced
`validate`, `branch()` for dynamic flows, back-navigation drops state from
abandoned branches, `ignoreFocusOut` defaults to true, and the completed
state needs no `as` cast.

### notification

- `showInfo` / `showWarn` / `showError` absorb `showWithActions` (removed):
  actions are object maps resolved **by reference**, so duplicate labels work.
- `confirm()` gains `severity` and a `remember` ("don't ask again") option
  backed by a `Memento`, and distinguishes explicit "No" from Escape.
- `NotificationOptions` / `NotificationAction` → `NotifyOptions` / `NotifyAction`.

### statusbar / language status

- `update()` / `set()` no longer destroy an active spinner.
- `showStatusMessage` uses a unique id per call.
- New `createLanguageStatusItem` wrapper.

### progress

- `withSteps(options, ...steps)` takes steps as rest arguments — per-step
  result tuples infer without `as const`.

## TreeView

- `SimpleTreeDataProvider` implements `getParent` — **`reveal()` now works** —
  and `removeItem` / `setChildren` / `updateItem` are nested-aware, firing
  element-scoped refreshes instead of full-tree redraws.
- New: checkbox events (`onDidChangeCheckboxState`), `createDragAndDropController`,
  `withPagination` / `LOAD_MORE_ID` for lazy loading, `TreeItemData.resourceUri`
  / `checkboxState`.

## Webview

Naming unified (`WebView` → `Webview`) and the module was split:

| 0.x | 1.0 |
| --- | --- |
| `createWebViewPanel` | `createWebviewPanel` |
| `ManagedWebViewPanel` | `ManagedWebviewPanel` (now carries `.rpc`) |
| `WebViewOptions` (`retainContext`) | `WebviewOptions` (`retainContextWhenHidden`) |
| `createWebViewHtml` | `createWebviewHtml` |
| — | `createWebviewRpc` — typed request/response + events over `postMessage`, with `AbortSignal`/timeout; in-flight requests reject when the panel closes |
| — | `registerWebviewView` (sidebar views), `registerWebviewPanelSerializer` (restore) |

`generateCSP` defaults flipped to safe: inline styles and https images are now
**opt-in** (`allowInlineStyles` / `allowAnyHttpsImages`), and `mediaSrc` /
`workerSrc` were added.

## Editor / FileWatcher

- `getFilePath` no longer requires `scheme === 'file'` — Remote-SSH / WSL /
  Codespaces documents work. It returns `{ fsPath, uri } | undefined`.
- Removed thin wrappers (use the raw property instead): `getLineCount`,
  `getDocumentText`, `isDirty`, `getLanguageId`.
- New: `applyWorkspaceEdits`, `applyEditsGrouped` (undo-stop control),
  `rangeFromOffsets`, `getTextInOffsetRange`, `resolvePositionsBatch`,
  `resolveOffsetsBatch`.
- FileWatcher: `patterns` accepts `vscode.RelativePattern` entries, unwanted
  event kinds are no longer subscribed natively, and `maxBatchSize` flushes
  large bursts immediately.

## std (timing / retry) and l10n

- `debounce` / `throttle`: new `leading` / `trailing` / `maxWait` / `signal`
  options and `flush()` / `pending()` helpers.
- New `withTimeout` + `TimeoutError`.
- `retry`: `signal` / `timeoutMs` options; exhaustion throws
  `RetryExhaustedError` carrying `.attempts` / `.history` / `.cause`;
  **`jitter` now defaults to `'full'`** (pass `jitter: 'none'` for 0.x timing).
- `t()` was removed — use `l10n.t()` (the bare name broke
  `@vscode/l10n-dev` static extraction). Formatting helpers are unchanged and
  also available vscode-free from the format core.
- Webview bundles can import `@kkdev92/vscode-ext-kit/timing` and
  `.../retry` directly — these subpaths contain no `vscode` import.

## Testing your extension (new)

The mock suite this library uses for its own 700+ tests is now public:

```typescript
// tests/setup.ts
import { vi } from 'vitest';
import { createVSCodeMock } from '@kkdev92/vscode-ext-kit/testing';

vi.mock('vscode', () => createVSCodeMock(vi));
```

Works with any framework exposing `fn()` (vitest, jest, bun:test).

Vitest users can skip the setup file entirely as of 2.1.0 by merging
`vscodeExtKitVitestConfig` from
`@kkdev92/vscode-ext-kit/testing/vitest-config`, which also reaches a prebuilt
bundle that `vi.mock` cannot. See the README's "Testing Your Extension"
section for both approaches.
