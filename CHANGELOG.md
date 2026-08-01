# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
From 1.0.0 onward this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Pre-1.0 releases followed it in spirit; their breaking changes are marked **Breaking**.

## [2.1.0] - 2026-08-01

The rest of the first downstream adopter's report: the places where the library
worked as documented but made the caller write the boilerplate, or reach past it
for the raw API. Nothing here is breaking, though `withSteps` now reports a
cancellation it previously threw.

### Added

- **`@kkdev92/vscode-ext-kit/testing/vitest-config`** exports
  `vscodeExtKitVitestConfig`, a mergeable Vitest config that is the entire
  setup:

  ```ts
  export default mergeConfig(vscodeExtKitVitestConfig, defineConfig({ /* yours */ }));
  ```

  It pairs `resolve.alias` (pointing `vscode` at the new
  `@kkdev92/vscode-ext-kit/testing/vitest`, which re-exports the mock as the
  named exports `import * as vscode` reads) with the `server.deps.inline` entry
  that keeps this kit from being externalized. Both halves are required and each
  fails confusingly alone, which is why they now ship together. Unlike
  `vi.mock('vscode', ...)`, an alias also reaches a prebuilt `dist/` bundle, so
  `activate()` can be tested for real. `@kkdev92/vscode-ext-kit/testing` itself
  stays runner-agnostic; only the two new subpaths import `vitest` (declared as
  an optional peer).
- **`@kkdev92/vscode-ext-kit/webview-client`** ships the webview-side end of
  `createWebviewRpc` — previously a 51-line reference implementation in a JSDoc
  comment that every adopter copied into their webview bundle by hand, untyped
  and frozen at whatever version they copied. `createWebviewRpcClient<S>()` is
  written against the same `WebviewRpcSchema` as the host (both sides now build
  on a shared, vscode-free `protocol.ts`), so the contract cannot drift, and it
  mirrors the host's semantics: `request` with `timeoutMs`/`signal` whose
  cancellation propagates across the wire, `onRequest` handlers with an
  aborting `ctx.signal`, `emit`/`onEvent`, and `dispose`. Pass
  `{ vscodeApi: acquireVsCodeApi() }` when your webview already acquired the
  API — VS Code allows exactly one call — or omit it and the client acquires it.
  Wire compatibility is pinned by loopback tests running the published client
  against the published host in both directions.
- **`@kkdev92/vscode-ext-kit/format`** exposes the vscode-free `Intl` core
  (`pluralFor`, `formatNumberFor`, `formatDateFor`, `formatRelativeTimeFor`,
  `getOrCreateCached`) as a subpath alongside `./timing` and `./retry`. These
  existed but were only reachable through the root barrel, which drags in
  `vscode` — defeating the point for a webview bundle.
- **`./package.json` is exported**, so `require('@kkdev92/vscode-ext-kit/package.json')`
  works for build scripts that bake the resolved version into a bundle. Node's
  ESM resolver rejects any subpath an `exports` map doesn't list, so this needed
  saying explicitly.
- **`PickOptions` gained `buttons`, `onTriggerButton`, and `onTriggerItemButton`.**
  `toPickButton` shipped in 2.0.0 with nowhere to use it: `pickOne`/`pickMany`
  resolve with the selection and exposed no trigger event, so a press could not
  be handled without abandoning them for a raw `createQuickPick`. Both handlers
  receive the live `QuickPick`, so a row action can rewrite `items`, set `busy`,
  or `hide()`. Passing any of the three routes the picker through
  `createQuickPick`, as `prompt` already did. `PickOptions` is now generic in the
  item type (`PickOptions<T>`, defaulting to `vscode.QuickPickItem`) so
  `onTriggerItemButton`'s `item` is typed; existing bare `PickOptions`
  annotations still compile.
- **`SimpleTreeDataProvider.addItem(item, { parentId?, index? })`** inserts at a
  position instead of appending. Introducing a group that has to stay on top — a
  "Favorites" node — previously meant `setItems`, which rebuilds the tree and
  collapses all of it. `index` is clamped, so `0` is always first and anything
  past the end appends. The `addItem(item, parentId)` form is unchanged.
- **`withPagination(items, pageSize, { label?, command?, iconPath? })`** can put a
  `command` on the "Load more…" row, making it clickable. Without one the row
  stays inert and `getChildrenOf` matches `LOAD_MORE_ID` itself, as before —
  every caller was writing the same `.map()` to graft a command on. A bare string
  third argument still means `{ label }`.
- **`createVSCodeMock` covers the APIs an extension reaches for and the kit
  itself never calls**: `version` (the top-level one — `TextDocument.version` is
  a document revision and was the only `version` present), `ColorThemeKind`,
  `TextEditorRevealType`, `window.activeColorTheme`,
  `window.onDidChangeActiveColorTheme`, `window.showOpenDialog`, and
  `window.showSaveDialog`. `window._setColorTheme(kind)` is the test hook that
  switches theme *and* notifies listeners. Theme detection plus a change
  listener is close to universal in extensions that render anything, and none of
  it was mockable.
- **`MockFn` describes more of `vi.fn`/`jest.fn`**: `mock.results` (the only way
  to assert on the object a factory mock *returned*, e.g. the channel from
  `window.createOutputChannel`), plus `mockReturnValueOnce`,
  `mockResolvedValueOnce`, `mockRejectedValue`, `mockRejectedValueOnce`, and
  `mockImplementationOnce`. Both runners already had all of these; the interface
  simply didn't mention them, so a test using one didn't typecheck. `results`
  includes the `'incomplete'` variant both runners emit for an in-flight call.

### Fixed

- **`resolvePositionsBatch`/`resolveOffsetsBatch` recognize the same line
  breaks as VS Code.** The one-pass line-start table split on `\n` only, but
  VS Code's text buffer also treats a lone `\r` as a line terminator — so on a
  document containing a bare carriage return, the batch helpers disagreed with
  `TextDocument.positionAt`/`offsetAt` about every position after it, producing
  ranges that edit the wrong text. LF and CRLF documents were always correct
  and are unchanged.
- **File-watcher ignore globs are anchored.** `*.log` compiled to an unanchored
  regex that also matched inside `x.log.txt` and `foo.logs`, silently swallowing
  their events. Glob patterns now match a whole path segment at the end of the
  path, as glob semantics say they should; `**/`-style patterns behave as
  before.
- **Settled requests detach their abort listeners.** `retry`'s inter-attempt
  wait and both webview RPC endpoints (`request` on the host and the client)
  registered an `abort` listener on the caller's `AbortSignal` and never
  removed it on the success path — an `AbortController` reused across many
  operations accumulated one dead listener per call for as long as it stayed
  un-aborted. `toAbortSignal` had the same shape (one token listener per call)
  and now memoizes one bridge signal per token via a `WeakMap`, so repeated
  calls return the same `AbortSignal` instead of stacking listeners on a token
  that may never fire.
- **Typed storage reads pre-kit plain values instead of `undefined`.** A value
  stored before this kit was adopted isn't wrapped in the kit's storage
  envelope; `get()` read `.value` off it anyway, returning `undefined` on a
  non-nullable `T` while `has()` said `true` — adopting typed storage over
  existing extension state silently read back nothing. A non-envelope value now
  reads as **schema version 0**: `migrations[0]` can convert it, and without one
  it flows into validation unchanged. Either way it's re-persisted in envelope
  form after the first read.

### Changed

- **`engines.node` raised from `>=22.0.0` to `>=22.12.0`** — the honest floor:
  consuming this native-ESM package from a CommonJS extension without a bundler
  relies on `require(esm)`, which Node stabilized in 22.12. ESM/bundled
  consumers were fine on 22.0, but the field describes what every supported
  consumption mode needs. README now documents the bundler-free CJS path.
- **`WebviewRpcSchema` and `WebviewRpcRequestOptions` moved to a shared,
  vscode-free `protocol.ts`** so the new webview client is typed against the
  exact same contract as the host. Both are re-exported from their previous
  home — every existing import keeps working.
- **`withSteps` reports mid-step cancellation as `cancelled` instead of
  throwing.** Only the gap *between* steps was checked, so a step handed
  `toAbortSignal(token)` — the usage the JSDoc recommends — rejected with an
  `AbortError` that passed straight through, leaving `result.cancelled` false and
  forcing callers to write both a `cancelled` branch and a `try`/`catch` with
  `isCancellation()`. Cancellation now always comes back as
  `{ completed: false, cancelled: true }` with the results gathered so far,
  matching `run`/`tryRun` and `wizard`. A `vscode.CancellationError` thrown by a
  step is treated the same way, and any other error still propagates. Code that
  only caught the rejection will now see a `completed: false` result rather than
  an exception.

## [2.0.1] - 2026-08-01

Fixes found by the first downstream adopter to migrate a full extension onto
2.0.0. Two real bugs, and documentation that sent readers the wrong way.

### Fixed

- **`withTimeout` no longer strands a caller's promise.** Passing an
  already-aborted `options.signal` made it throw synchronously before attaching
  any handler to a promise-form `operation` — and that promise was created back
  at the call site, during argument evaluation. If it later rejected (a worker
  exiting, say), nothing was there to catch it and the extension host logged an
  unhandled rejection. Its rejection is now claimed before the throw.
  Function-form operations were never affected and still aren't started when the
  signal is already aborted.
- **`SimpleTreeDataProvider` stops collapsing nodes you asked to be expanded.**
  A `collapsibleState` of `Expanded` now survives `setChildren` and `addItem`,
  and is honored when passed to the constructor, `setItems`, or either of those
  mutators — previously all three paths overwrote it with `Collapsed`, so a group
  built expanded either never opened or folded shut on every partial update. A
  parent that had no children is still promoted to `Collapsed` when children
  arrive, and still drops to `None` when its last one goes away.

### Documentation

- `WebviewRpcSchema`'s `webviewRequests`/`hostRequests` docs described the
  wrong direction. Both fields are named after the side that *answers* the
  request (`webviewRequests` are sent with `rpc.request`, `hostRequests` bound
  with `rpc.onRequest`) — the types always worked this way. The convention, and
  why it differs from the send-direction naming used for events, is now spelled
  out on the interface and in the README.
- `PickItemDisplay.buttons` and `toPickButton` now say plainly that item buttons
  cannot be handled through `pickOne`/`pickMany`, which resolve with the
  selection and expose no trigger event. Use `vscode.window.createQuickPick`
  directly. (Making them work through `pickOne` is tracked for a later release.)
- README states the `^1.125.0` VS Code requirement up front, notes that the floor
  propagates to dependents, and explains the `@types/vscode` lag behind the
  weekly VS Code release line.
- MIGRATION.md claimed `createSecretStore`'s `keys()` was feature-detected. It
  isn't, and doesn't need to be: `SecretStorage.keys` has been stable since
  1.105, well under this library's floor.

## [2.0.0] - 2026-07-31

Follows the current VS Code release line. `engines.vscode` and the
`@types/vscode` the library compiles against are now the same version, which is
what keeps the declared floor honest — and raising the floor is what makes the
VS Code APIs added since 1.96 usable without feature detection.

Major rather than minor: raising `engines.vscode` cascades to every extension
that depends on this library.

### Added

- **`toPickButton(icon, opts?)`** builds a `vscode.QuickInputButton`, accepting a
  codicon name in place of a hand-built `ThemeIcon` exactly as `toPickItem` does
  for item icons. `opts.location` places the button in the title bar, inline, or
  inside the input box (`QuickInputButtonLocation`, stable since 1.109);
  `opts.toggled` makes it an on/off toggle (`QuickInputButton.toggle`, also
  1.109). VS Code flips `toggle.checked` in place on the button you passed it
  before firing the trigger event, so read the state back off the same object.
  Note that `location` is ignored for buttons attached to an item via
  `PickItemDisplay.buttons` — VS Code always renders those inline.
- **`prompt` on `pickOne`/`pickMany`** (new `PickOptions`, extending
  `vscode.QuickPickOptions`) shows instructional text below the filter box and
  above the items (`QuickPick.prompt`, stable since 1.108). `showQuickPick` has
  no prompt, so passing one routes the picker through `createQuickPick` — the
  same path async items already take. That path does not honor
  `onDidSelectItem`. A synchronous list is assigned before `show()` and never
  raises `busy`, so it does not flash empty.
- `createVSCodeMock` gained `QuickInputButtonLocation` and `secrets.keys()`.

### Changed

- **Breaking:** `engines.vscode` raised from `^1.96.0` to `^1.125.0`. Extensions
  depending on this library must raise their own `engines.vscode` to match.
  `^1.125.0` is a minimum, so hosts on the current 1.131 line are covered.
- `@types/vscode` stays at `~1.125.0` — the newest published type package.
  Note that VS Code moved from monthly to weekly releases in March 2026 and
  DefinitelyTyped no longer publishes a package per release, so `@types/vscode`
  trails the stable channel (1.125 was published 2026-06-17 against a 1.131
  stable). The floor tracks the types, not the stable channel.

### Fixed

- **`pickOne`/`pickMany` swallowed the error when an async item list rejected.**
  Disposing a *visible* quick pick makes VS Code fire `onDidHide`
  (`ExtHostQuickInput.dispose` calls `_fireDidHide`), so the teardown on the
  rejection path re-entered the hide handler and resolved the promise with
  `undefined` before `reject` ran. Callers saw a plain cancellation instead of
  the failure. The exit paths now claim the promise before tearing down, the
  same way `wizard.ts` already did. `createVSCodeMock`'s `hide()`/`dispose()`
  were inert, which is why no test caught this; they now fire `onDidHide` on a
  visible quick input like the real API, so the whole class of bug is testable.
- **The declared `^1.96.0` floor had been inaccurate since 1.0.0.** The UI/views
  redesign added `resourceUri` to `PickItemDisplay`/`toPickItem`, but
  `QuickPickItem.resourceUri` only exists from VS Code **1.108** — building the
  library against `@types/vscode@1.96.0` fails with `TS2353`. On hosts older than
  1.108 the property was silently dropped, so `resourceUri` quietly did nothing
  rather than failing loudly. Because `engines.vscode` now matches the types the
  library compiles against, the compiler enforces the floor and this class of
  drift cannot recur unnoticed.

### Removed

- `SecretStore.keys()` no longer feature-detects `SecretStorage.keys()` at call
  time. That API is stable from VS Code ~1.105, which the new floor guarantees,
  so the runtime probe and its `requires VS Code 1.105+` rejection are gone —
  calls that previously rejected on old hosts now just work. `SecretStore.keys()`
  never resolved to a wrong value, so no behavior change on supported hosts.
- The wizard's `QuickPickStepConfig.prompt` no longer feature-detects
  `QuickPick.prompt`. It was already accepted and silently dropped on hosts
  below 1.108; the new floor guarantees it, so it is assigned directly.

## [1.1.0] - 2026-07-28

Fixes and additions from the first real 1.0 adoption, all reported from a
downstream extension's migration. Two of them made the published package
harder to use than the source tree suggested.

### Fixed

- **The documented test setup did not work for consumers.** Vitest
  externalizes `node_modules`, so `vi.mock('vscode', ...)` never reached the
  kit's own `import * as vscode from 'vscode'` and any test touching a kit
  function failed with `Cannot find package 'vscode'`. The README's
  `vitest.config.ts` example now includes the required
  `server.deps.inline: ['@kkdev92/vscode-ext-kit']`, with an explanation of
  why it is mandatory rather than a workaround.
- **Published sourcemaps pointed at files that were not shipped.** `dist`
  carries 74 `.js.map`/`.d.ts.map` files whose `sources` resolve to `../src`,
  but `src` was not in `files`. Consumers inlining the package saw a
  `Sourcemap ... points to missing source files` warning per module, and
  Go-to-Definition stopped at the `.d.ts`. `src` is now published, so both
  debugging and Go-to-Definition land on the real TypeScript.
- **`createVSCodeMock` was missing `workspace.applyEdit`**, which this
  library itself calls from `applyWorkspaceEdits`/`applyEditsGrouped` — so
  testing consumer code that used those helpers failed with
  `vscode.workspace.applyEdit is not a function`.
- `npm run build` now cleans `dist` first. Stale 0.x output (19 flat
  `*.d.ts` files whose sources no longer exist) survived rebuilds and
  misrepresented the API when read locally. Published tarballs were never
  affected (`prepublishOnly` already cleaned).

### Added

- **`s.nullable(inner)`** — accepts `null` in addition to the inner schema,
  mirroring `s.optional`. VS Code settings commonly declare
  `"type": ["string", "null"]` with a `null` default to mean "unset", which
  `s.optional` (which admits `undefined`) does not cover:
  `field(s.nullable(s.enum('compact', 'wide')), null)`.
- **`Logger.error` accepts `unknown`** — a `catch (error)` binding can be
  passed straight through (`catch (error) { logger.error(error, { file }) }`)
  instead of being normalized at every call site. `Error` instances keep
  their stack; anything else is stringified safely.
- **Mock coverage for the APIs extensions actually use**:
  `window.activeTextEditor` / `visibleTextEditors` (both directly assignable
  for test setup), `window.onDidChangeActiveTextEditor` /
  `onDidChangeTextEditorSelection` / `showTextDocument`,
  `workspace.workspaceFolders` / `getWorkspaceFolder` / `asRelativePath` /
  `openTextDocument` / `onDidChangeTextDocument` / `onDidSaveTextDocument`,
  and `env.clipboard`. Extending a namespace by hand is no longer the price
  of testing an ordinary extension.
- **A consumer smoke test** (`npm run test:smoke`, plus a CI job): packs the
  tarball, installs it into a throwaway project configured exactly as the
  README documents, then typechecks and runs tests against the *published*
  artifact — asserting the `vscode` mock reaches the kit's internals, all four
  entry points resolve, and no sourcemap warnings appear. Both packaging bugs
  above were invisible to the existing suite because it only ever tests
  `src/`.
- **A meta test** asserting every `vscode.*` member this library calls exists
  on `createVSCodeMock`, so a missing mock (like `applyEdit`) fails here
  rather than in a consumer's test run.
- `.gitattributes` normalizing line endings to LF, so `format:check` stops
  failing on Windows checkouts (`core.autocrlf` produced CRLF while Prettier
  is configured for LF).

## [1.0.0] - 2026-07-28

A ground-up redesign for type safety, performance and testability.
**Not backwards compatible with 0.x** — see [MIGRATION.md](MIGRATION.md) for a
complete 0.x → 1.0 mapping. Requirements are unchanged (VS Code `^1.96.0`,
zero runtime dependencies).

### Added

- **`createExtensionKit`** — one call in `activate()` wires a logger, a
  disposable scope, and logger-bound `run`/`tryRun`/command registration.
- **Schema-driven config**: `defineConfigSchema` + `field` + built-in
  Standard Schema-compatible `s.*` validators (or bring zod/valibot).
  Validated & cached reads, per-key change events, `watchSetting`,
  `checkPackageJsonSync`.
- **Typed webview RPC**: `createWebviewRpc` (request/response + events over
  `postMessage`, `AbortSignal`/timeout, auto-reject on panel close), plus
  `registerWebviewView` (sidebar) and `registerWebviewPanelSerializer`.
- **Wizard fluent builder**: type-accumulating `wizard().step(...).optionalStep(...)
  .branch(...).run(...)` returning `Result` with the exact answered shape —
  async items (auto busy), async debounced validation, native back button and
  step counter.
- **`@kkdev92/vscode-ext-kit/testing`**: the vscode mock suite behind this
  library's own test suite, published as a framework-agnostic testing kit
  (`createVSCodeMock(vi)`, typed `createMockExtensionContext`, per-API mock
  builders). Works with vitest/jest/bun:test.
- **Subpath exports** `./timing` and `./retry` — vscode-free modules that
  webview bundles can import directly.
- Logger: `child(scope)` loggers, structured fields, `level` getter.
- Commands: compile-time command-ID checking via
  `registerCommands<'a.x' | 'a.y'>`, per-command `Disposable` map returns.
- Storage: TTL, Settings Sync (`syncable`), typed `onDidChange`, `tryGet`,
  multi-key `createSecretStore` with feature-detected `keys()`.
- Editor: `applyWorkspaceEdits`, `applyEditsGrouped`, offset/position batch
  utilities. TreeView: checkbox events, drag & drop helper, pagination
  helper. UI: `createLanguageStatusItem`, pick separators, `PickItem`
  value/display separation. std: `withTimeout`, debounce/throttle
  `leading`/`maxWait`/`flush`/`pending`/`signal`, retry `signal`/`timeoutMs`/
  `RetryExhaustedError`. `DisposableCollection` supports `using`
  (`Symbol.dispose`); new `createScope`.

### Changed

- **Breaking:** Logger uses a native `LogOutputChannel` by default and takes
  structured fields instead of printf varargs; telemetry goes through
  `vscode.TelemetrySender` (custom `TelemetryReporter` and `redactStackPaths`
  removed). The last Node API import is gone — the library no longer uses
  any Node built-in.
- **Breaking:** `safeExecute`/`trySafeExecute` → `run`/`tryRun` with
  cancellation classification: `CancellationError`/`AbortError` produce no
  error toast, log at debug level, mark `cancelled: true`, and are never
  rethrown.
- **Breaking:** config helpers (`getConfig`/`getSetting`/`setSetting`/
  `onConfigChange`) replaced by the schema API; notification
  `showWithActions` merged into `showInfo`/`showWarn`/`showError` with
  reference-resolved action maps; `WebView*` renamed to `Webview*`;
  `t()` → `l10n.t()`; editor thin wrappers (`getLineCount`/`getDocumentText`/
  `isDirty`/`getLanguageId`) removed; `getFilePath` returns
  `{ fsPath, uri }` and supports remote schemes.
- **Breaking:** storage envelope format (one write per set, version inside
  the envelope) — 0.x stored values are not read back; retry `jitter`
  defaults to `'full'`; CSP defaults flipped to safe (inline styles / https
  images opt-in).
- `src/` reorganized into domain folders; tests are now type-checked
  (`tsc -p tsconfig.tests.json` runs in `npm run typecheck`).

### Fixed

- `CommandHandler` rejected precisely-typed handlers the raw API accepts.
- Wizard `step.title` was ignored whenever step numbers were shown.
- Status bar `update()`/`set()` destroyed an active spinner;
  `showStatusMessage` reused one hardcoded item id across calls.
- `showWithActions` resolved actions by title string and broke on duplicate
  titles.
- Storage wrote every value twice (value + version keys, non-atomic).
- `SimpleTreeDataProvider.reveal()` could never work (no `getParent`);
  `removeItem` only worked at the root level.
- File watcher subscribed to event kinds it then filtered out, and deduped
  pending events in O(n) per event.
- Logger `migrate`-style config listener leaks and `DisposableCollection`
  add-after-dispose throwing instead of disposing.

## [0.5.0] - 2026-07-28

Maintenance release. The library's runtime behavior is unchanged — the work is in
platform support, toolchain currency, and release supply chain.

### Changed

- **Breaking:** `engines.node` raised from `>=20.0.0` to `>=22.0.0`. Node.js 20
  reached end of life on 2026-04-30. Node 24 (Active LTS) is recommended.
- CI now tests on Node 22, 24 and 26 (was 20, 22, 24).
- `engines.vscode` intentionally stays at `^1.96.0`. Every VS Code API this library
  uses was already stable at 1.96, so the floor is not raised for consumers.
- Development dependencies updated to current releases: ESLint 10.8,
  typescript-eslint 8.65, Prettier 3.9.6, Knip 6.29, lint-staged 17, Vitest 4.1.10,
  `@types/vscode` 1.125, `@types/node` 26. TypeScript stays on 6.0.x because
  typescript-eslint does not yet support TypeScript 7.
- `actions/checkout` and `actions/setup-node` upgraded to v7; release workflow gained
  type-check and dead-code gates matching CI.

### Security

- Releases are now published through **npm trusted publishing (OIDC)** with build
  provenance. The release workflow no longer references any repository secret, and
  the long-lived `NPM_TOKEN` has been retired.
- Resolved two high-severity `brace-expansion` denial-of-service advisories
  (GHSA-3jxr-9vmj-r5cp, GHSA-mh99-v99m-4gvg) in the transitive dependency tree.

## [0.4.0] - 2026-06-12

### Changed

- Toolchain modernized to ESLint 10, TypeScript 6 and Knip 6.
- WebView helpers now use portable VS Code APIs; `Intl` formatters in the
  localization helpers are cached; error notifications no longer block the caller.

### Fixed

- File watcher: single-star ignore patterns are matched correctly.
- Tree view: stale subtree cache entries are invalidated.
- Retry: abort listener leak on completion.

## [0.3.1] - 2026-04-26

### Fixed

- Wizard: input steps are accepted on state types that extend
  `Record<string, unknown>`.

## [0.3.0] - 2026-04-26

### Added

- Logger: `channel.show()` is throttled, and home directory paths are redacted from
  telemetry stack traces.
- WebView: CSP options to tighten `style-src` and `img-src`.
- Retry: `maxDelay` and `jitter` options.

### Changed

- **Breaking:** Wizard step types tightened and internal control flow cleaned up.
  The `WizardQuickPickStep` variants are now internal.

### Performance

- Tree view: `SimpleTreeDataProvider` is indexed for O(1) lookups.

### Fixed

- Storage: migrated values are persisted so migrations do not re-run, and rejections
  in the best-effort write-back are handled.
- WebView: template variables are substituted in a single pass.
- Status bar: `showStatusMessage` uses the id form of `createStatusBarItem`.
- Timing: the `logLevel` option is respected on the error path.
- Disposable: disposal continues after an error, and failures are aggregated.

## [0.2.2] - 2026-02-07

### Changed

- Development dependencies updated to latest versions.

## [0.2.1] - 2026-02-07

### Fixed

- Wizard: the promise resolves before disposal, fixing a race condition.

### Documentation

- Added a Code of Conduct and reworked the README for usability.

## [0.2.0] - 2026-02-04

### Changed

- **Breaking:** Logger switched from `LogOutputChannel` to `OutputChannel` to gain
  full control over log levels.

## [0.1.2] - 2026-02-04

Initial public release.

[2.1.0]: https://github.com/kkdev92/vscode-ext-kit/compare/v2.0.1...v2.1.0
[2.0.1]: https://github.com/kkdev92/vscode-ext-kit/compare/v2.0.0...v2.0.1
[2.0.0]: https://github.com/kkdev92/vscode-ext-kit/compare/v1.1.0...v2.0.0
[1.1.0]: https://github.com/kkdev92/vscode-ext-kit/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/kkdev92/vscode-ext-kit/compare/v0.5.0...v1.0.0
[0.5.0]: https://github.com/kkdev92/vscode-ext-kit/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kkdev92/vscode-ext-kit/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/kkdev92/vscode-ext-kit/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kkdev92/vscode-ext-kit/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/kkdev92/vscode-ext-kit/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/kkdev92/vscode-ext-kit/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kkdev92/vscode-ext-kit/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/kkdev92/vscode-ext-kit/releases/tag/v0.1.2
