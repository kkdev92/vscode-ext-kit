# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
From 1.0.0 onward this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Pre-1.0 releases followed it in spirit; their breaking changes are marked **Breaking**.

## [Unreleased]

### Added

- **`describePlan(plan)` turns a compiled plan into JSON.** The framework
  already knows exactly what an extension registers — that is what compiling
  declarations before running them is for — but an `ApplicationPlan` holds
  factories, handlers and token objects, so the answer was locked inside it.
  The description carries module ids, service tokens and the edges between
  them, command ids and titles, settings keys and defaults, watcher globs and
  view ids, and nothing callable.

  It is deterministic and in declaration order, so the output is worth
  committing: a diff means a declaration changed. That is the review question
  `git diff` on a large module rarely answers directly, and it is the same
  document a manifest cross-check or a dependency diagram wants.

- **A shutdown that runs out of budget now says what was holding it.** The
  `application.shutdownTimeout` diagnostic carried a phase name and nothing
  else, which left the only question that matters unanswered: which hosted
  service, which operation, which scope. Its `details` now carry the phase, the
  budget, how long it waited, the hosted service inside its own `stop`, the
  services still up, the operations that never settled and the resource scope
  tree — ids, names and counts, never an argument or a payload.

- **`createTestHost().inspect()` says what a failed leak assertion could not.**
  `leaks()` reports three counts; when one is not zero the next question is
  which module or operation still holds something, and there was no way to ask.
  `inspect()` answers it: the scope trees, the hosted services still up, the
  operations that never settled.

  `leaks()` itself is deliberately unchanged. Adding the fields there was the
  obvious move and it broke the first extension it was tried on: the guide
  tells you to assert on the whole object, `toEqual` sees a new field, and the
  test fails for a reason that has nothing to do with the extension. A separate
  method costs one call and breaks nobody.

- **`RegistrationScope` and `ResourceScope` gained `inspect()`**, returning a
  `ScopeInspection` — name, entry count, attached children. This is what both
  of the above are built on, and it is safe to call at any point, including
  during disposal.

- **`onDiagnostic` is documented.** It has been part of `defineExtension` since
  3.0.0 and appeared in no guide; the guide now has a Diagnostics section
  listing the events and what they are useful for.

## [4.0.1] - 2026-08-29

**A patch to the tree-view adapter, plus four corrections to what the project
says about itself.** The public API is unchanged — the emitted `.d.ts` files
differ from `4.0.0` in comments only. The one behaviour change is that a
custom `TreeDataSource`'s `dispose()` now runs once instead of twice; the
shipped providers never noticed the difference.

### Fixed

- **The tree-view adapter now releases the change-event bridge it builds, and
  no longer disposes the provider.** To serve `onDidChangeTreeData` in the
  shape VS Code reads, the adapter subscribes to the source and fires a
  `vscode.EventEmitter`; in 4.0.0 it kept neither the subscription nor the
  emitter, so disposing the view released the native view and left both
  behind. It also called the source's `dispose()` — while the module scope
  already owned the provider, as the port and `TreeViewCollection` both said —
  so every module-declared provider was disposed twice. The shipped
  `BaseTreeDataProvider` clears its listeners and is idempotent, which is why
  nothing noticed; a custom source need not be either. The registration now
  releases exactly what the adapter created (view, checkbox listener,
  subscription, emitter), once, and leaves the source to its owner. The adapter
  suite pins each of those, the application suite pins "one provider disposal,
  after the view", and the desktop fixture measures the subscription against a
  real host: it reported `taken 1, released 0` on the 4.0.0 adapter.

- **`createSecretAccessor`'s JSDoc said writes were not validated. They are**,
  and the suite has pinned it (`failed validation on write`); the comment and
  the code have disagreed since both arrived in 3.0.0. The interface comments
  now say what the code does: validation in both directions, and nothing the
  schema produced in any report.

- **Two comments claimed `ResourceScope.own` does not await an asynchronous
  `dispose`.** It does — that is the whole reason it is separate from
  `RegistrationScope`, which is the one that rejects a thenable.
  `descriptors.ts` and `thenable.ts` now agree with `resource-scope.ts`.

- **The 4.0.0 entry below claims `verify:package` asserts zero runtime
  dependencies. It did not.** The package had none — `dependencies` is simply
  absent — but nothing checked, so the sentence was true by luck rather than
  by test. The script now asserts it twice: on the manifest about to be packed
  and on the copy the throwaway consumer installs.

- CONTRIBUTING listed three `foundation -> capabilities` aggregation points;
  the import-graph test allows four, the fourth being a type-only import from
  `operations/context.ts`. The document now matches the test.

## [4.0.0] - 2026-08-29

**A floor raise, essentially.** The public API is what `3.0.0` exposed — no
additions, no removals, no signature changes — and the one implementation change
below is behaviour-preserving. The major is here because `engines.vscode` moved,
which cascades to every extension built on this package, and that is what a
major is for. The previous floor raise shipped the same way, as `2.0.0`.

If your extension already declares `^1.134.0` or later, upgrading is a version
number and nothing more. If it does not, raise it in the same commit — `vsce`
will refuse to package otherwise, which is the whole subject of this release.
`^3.x` pins keep resolving to `3.0.0`, which stays supported.

### Changed

- **Breaking:** `engines.vscode` raised from `^1.125.0` to `^1.134.0`, in step
  with `@types/vscode` moving to `~1.134.0`. Extensions built on this package
  inherit the floor and must declare at least `^1.134.0` themselves.

  The two versions move together on purpose. `vsce` refuses to package an
  extension whose `@types/vscode` is newer than its `engines.vscode`
  (`validateVSCodeTypesCompatibility`, compared on major and minor only), and
  the reason behind that check applies here even though this package is a
  library and never meets `vsce`: types above the floor let code compile
  against an API the declared minimum does not have. Raising only the types is
  what a grouped dependency update proposes by default, and it is why this
  entry exists rather than a lockfile-only bump.

  DefinitelyTyped had been lagging the stable channel badly — `1.125.0` was the
  newest type package for months against a stable line already past 1.131. It
  has since caught up to `1.134.0`, one release behind the current 1.135.

- Dev dependencies, measured across the whole `3.0.0`→`4.0.0` span rather than
  per pull request: `vitest` and `@vitest/coverage-v8` 4.1.10 → 4.1.11, `eslint`
  10.8.0 → 10.9.0, `typescript-eslint` 8.66.0 → 8.67.0, `@types/node` 26.1.2 →
  26.2.0, `knip` 6.31.0 → 6.32.2. All within the declared ranges, so only the
  lockfile moves. **TypeScript stays on 6.0** — `typescript-eslint` declares
  `typescript >=4.8.4 <6.1.0`, so 7.x would break type-aware linting outright.

- A development-scope advisory (`nanoid`, high, transitive through vitest) was
  cleared. It never shipped: the published package has zero runtime
  dependencies, which `verify:package` asserts on every run.

- The Extension Host and web fixtures declare `^1.134.0` to match, and the
  `VSCODE_VERSION` example in `fixtures/README.md` moves off 1.131.0, which
  would no longer activate them.

### Fixed

- **A quadratic regex is gone from the fake file watcher.** `/\/+$/`, stripping
  trailing separators, made the engine retry the greedy `\/+` from every position
  before `$` rejected it — quadratic in the number of separators, and CodeQL
  flags it as `js/polynomial-redos`. **It was not a vulnerability here**: the
  input is a `RelativePattern` the *test author* constructed, and nothing
  untrusted reaches a fake. It is fixed because `src/testing/` is published code
  and the defect is real regardless of who can reach it. Counting backwards is
  linear and reads better than the regex did; behaviour is identical.

- **`SECURITY.md` listed the wrong supported versions.** It still described
  `3.0.0-alpha.x` as "not published to npm yet" and `2.1.x` as holding `latest`
  — both untrue since 3.0.0 shipped on 2026-08-08 and took the tag. The table
  now names 4.0.x, 3.0.x and 2.1.x.

## [3.0.0] - 2026-08-08

The 3.x line leaves prerelease. Nothing in the API changed from
`3.0.0-alpha.3` — this release moves the `latest` dist-tag, which is the part
that was still pending.

**`npm install @kkdev92/vscode-ext-kit` now installs the framework.** 2.x was a
utility library with a different shape; it continues on `v2-maintenance`, and
anything pinned to `^2.x` resolves exactly as it did. Only a fresh, unpinned
install changes.

### What arrived across the alphas

Read [3.0.0-alpha.1](#300-alpha1---2026-08-07) for the shape of the thing — an
immutable plan, compiled and validated before VS Code is touched, run by a host
that owns one cleanup path. The two alphas after it were consumer-driven, and
what they fixed says something about how this was built:

- [3.0.0-alpha.2](#300-alpha2---2026-08-08) — a setting that means "unset", and
  the other half of the workspace-trust API. The first found a real bug in the
  extension that motivated it on its first run: two settings the manifest
  declared as `"integer"` while the code had always accepted null and documented
  it as "no limit".
- [3.0.0-alpha.3](#300-alpha3---2026-08-08) — declaring what `activate` resolves
  to, so an extension that publishes an API stops keeping a mutable module
  variable and hoping a hosted service filled it.

Every one of those came from migrating a real extension, not from reviewing this
repository. Three now run on it, each verified in a real Extension Host.

### Fixed

- **A tree view's drop payload is checked rather than cast.** `handleDrop`
  parsed the data transfer and asserted `string[]`. `handleDrag` writes that
  payload, but the mime type is the extension's own declared string and any
  producer that writes it lands in the handler — so a number, `null` or an array
  of objects could reach `onDrop`, which promises `readonly string[]`. Found by
  a whole-codebase security review; filed as robustness rather than a
  vulnerability, since the impact lives in consumer code.

## [3.0.0-alpha.3] - 2026-08-08

Three gaps a third migration found. What is *not* here is as deliberate: two
other candidates were rejected on the line between what the framework owes an
extension and what an extension owes itself.

### Added

- **`defineExtension({ exports })`.** Some extensions publish an API — the
  built-in Markdown preview reads `extendMarkdownIt` off one, and anything else
  reads `extensions.getExtension(id).exports`. VS Code takes that value from
  whatever `activate` resolves to, and it is normally built from services, which
  do not exist until the application has started. Without a declaration the only
  way to produce one was a mutable module variable that a hosted service filled
  and `activate` read back. `exports` is that declaration: the framework builds
  the value after every hosted service has started, from the same instances
  everything else got, and resolves `activate` to it. Not a way to reach the
  container — the framework resolves it, and a service stays reachable only
  where it was declared.

### Changed

- **The `vscode` mock accepts `setContext`.** It is a VS Code built-in that no
  extension registers, so rejecting it as an unknown command was the mock lying
  about the platform — and mirroring a setting into a `when` clause is common
  enough that every such extension would have had to work around it. Narrow on
  purpose: other built-ins still reject, because they have effects a mock cannot
  stand in for and resolving `undefined` would let a test claim it did something
  it never did.

### Fixed

- **The quick-input adapter no longer reads `vscode` while being built.** Every
  capability adapter is constructed at activation whether the extension declares
  that capability or not, and this was the only one that read a `vscode` value
  doing so (`QuickInputButtons.Back`) — which made it something every test double
  had to supply, including for extensions that never open a quick pick. It is a
  getter now.

### Considered and rejected

- **A log-level floor in the framework.** Two extensions have hand-written the
  same thirty lines, which normally argues for moving it — but a
  `LogOutputChannel` is the platform's answer and the level belongs to the user,
  per channel, persisted, in the Output panel. Both of those extensions kept a
  `logLevel` setting from before that was true. Making it cheap to keep a setting
  that duplicates a platform control is not something the framework should do.
- **`isDisposable` matching functions.** A function carrying `dispose` is not
  disposed by the container, silently. Widening the check would blur a contract
  that is currently one shape and clear, and the case that raised it — a
  debounced callback — is better owned by a hosted service, which is where it
  ended up. No consumer has actually shipped the shape.

## [3.0.0-alpha.2] - 2026-08-08

Both of these came from migrating a second extension onto this. Neither showed
up in this repository's own tests, because neither is something the framework
uses itself — they are only reachable from the consumer side.

They are worth the release on their own, but the way the first one landed is the
better argument for it: once `assertManifestMatches` could compare a nullable
setting, the first run against that extension found two settings whose manifest
declared `"integer"` while the code had always accepted null and documented it
as "no limit". A feature the extension shipped, that its settings editor would
not let anyone use.

### Added

- **`setting.nullable`.** A setting that means "unset" is an ordinary VS Code
  pattern and none of the builders could express it. The manifest has to declare
  `["integer", "null"]` before the settings editor will accept a null default —
  VS Code reports `"type": "string"` with `"default": null` as an error — and a
  spec whose `validate` rejects null makes every lenient read of a cleared
  setting fall back to the default. The two halves have to move together, which
  is why this is a builder rather than a note in the docs. It wraps any spec:
  the default carries over unless you pass one, and an enumerated spec gains
  `null` at the front, where `enumDescriptions` expects it.
- **`workspace.onDidGrantWorkspaceTrust` on the `vscode` mock.** With
  `isTrusted` alone, an extension that declines to read something in an
  untrusted window has no way to notice when trust is granted. The host is
  restarted only if some extension's *enablement* changes, and an extension that
  declared `untrustedWorkspaces.supported` was already enabled — so it is
  re-activated only if some other extension happens to flip, which it cannot
  count on. These two are the whole stable trust API; the rest of that surface
  is proposed.

### Changed

- **`SettingSpec.type` accepts a list**, as JSON Schema does, and the new
  `SettingValueType` includes `'null'`. Only `assertManifestMatches` read this
  field, and it now compares types as a set — `["string","null"]` and
  `["null","string"]` are the same schema, and a reorder is not worth failing a
  build over. `enum` stays order-sensitive, because `enumDescriptions` pairs
  with it positionally.

### Fixed

- **`assertManifestMatches` could not agree with a nullable setting.** It
  compared `type` with `!==`, so an array never matched whatever the source
  said, and the first extension to declare one had to normalise its manifest
  before the check would run at all. The pasteable JSON it prints carries the
  union too, which matters because that JSON is what it tells the reader to
  copy.

## [3.0.0-alpha.1] - 2026-08-08

**A different kind of package.** 2.x is a utility library you call from your own
`activate()`. 3.x is an application framework that owns activation and
deactivation, and that you hand modules to. The capability APIs came across; the
application shape did not.

Published on the **`next`** dist-tag. `latest` stays on 2.x, which continues on
`v2-maintenance`, so nothing installs this by accident:
`npm install @kkdev92/vscode-ext-kit@next`.

There is no `3.0.0-alpha.0` on npm. Its tag exists and its release workflow
failed before publishing anything — release tags are immutable here, so the fix
took the next number rather than the same one.

Every v2 capability has an equivalent here, and an existing extension has been
migrated onto it end to end — commands, views, webviews, settings, storage,
secrets and all — and verified in a real Extension Host. That migration is where
most of what follows comes from: it found abilities the framework could not
express, ceremony it was making the consumer write, and defects none of the
framework's own tests could see.

### Added

- **`defineExtension` / `defineModule` / `compileApplication`.** A module declares
  commands, services, hosted services, settings, storage, secrets, file watchers,
  status bar and language status items, tree views, and raw registrations, as
  data. `compileApplication` validates the whole declaration -- duplicate ids,
  missing services, dependency cycles, captive dependencies -- and produces a
  deeply immutable plan. Preflight runs at import time, before any VS Code API
  call.
- **`ApplicationHost`.** A state machine with one cleanup path: `stop()` runs
  exactly once, unwinds framework-owned resources in reverse order, and holds a
  shutdown budget (3s by default) inside VS Code's 5s race.
- **Operations.** Every command invocation and watcher batch runs with an id, a
  logger carrying its fields, a combined `AbortSignal`, a progress session, and a
  resource scope disposed when the work settles.
- **Two scope kinds.** `RegistrationScope` (synchronous) and `ResourceScope`
  (asynchronous, LIFO, error-aggregating), because VS Code never awaits an async
  `dispose()`.
- **A dependency container.** Singleton and transient lifetimes, synchronous
  factories, container-owned disposal in reverse creation order.
- **Capability ports.** The core is vscode-free; the real API lives behind ports
  in `src/vscode/`.
- **`@kkdev92/vscode-ext-kit/testing` grew a Test Host.** `createTestHost` runs a
  _production_ plan against fakes, with singleton overrides and leak assertions.
  Every fake and its real adapter share one contract suite.
- **Typed settings.** `defineSettings` + `setting.*` fix keys, types, defaults and
  contribution scope in one declaration; reads take a scope; `watch` fires only
  when a key's effective value actually changed.
- **Declared storage and secrets.** `defineStorage` (versioned, validated,
  migrated, optionally syncable) and `defineSecret`, both injectable under their
  own token.
- **A module can declare an ambient service set.** `defineModule` takes a
  `{ uses }` options object, and every handler in the module receives that set
  merged under its own `inject`. A name in both is a definition-time error
  rather than a shadowing rule. Services are excluded, because a service's
  dependencies _are_ the graph preflight validates. `Injected<typeof uses>`
  names the resulting shape, so the bundle a feature receives is derived rather
  than hand-written.
- **Six services on every handler's context**, without declaring them:
  `notify`, `ask`, `l10n`, `editors`, `commands` and `status`. Not a second way
  in — `context.notify` resolves the same token an `inject` would, out of the
  same container, exactly as `context.logger` already did. They are lazy and
  non-enumerable, so an application that never notifies builds no notifier and
  a spread of the context resolves nothing.
- **`Commands`, `FileWatchers` and `Operations` tokens**, for the runtime half
  of three abilities that already had a declaration: invoking a command as
  opposed to registering one, a glob the user just typed as opposed to a
  declared one, and work that did not start in a handler.
- **`assertManifestMatches`**, published so a consumer can keep `package.json`
  in step with what `src` declares. It names every disagreement at once and
  prints the JSON to paste; it found four real drifts the first time it ran
  against a migrated extension.
- **`Log`**, for a service that has no operation to take `context.logger` from.

### Changed

- **Typed storage keeps 2.x's envelope format**, so values written by a 2.x build
  are read by a 3.x build.
- **Errors are not presented for you.** A command's result and its rejection both
  reach the caller; the Command Palette already shows a dialog and a keybinding
  already warns.
- **One way in per ability.** Every capability is reached through a declaration
  or an injected token, never through both a standalone function and a
  declaration. `Notifications`, `QuickInput`, `Editors`, `Localization` and
  `Webviews` are services; status bar items, language status items, tree views,
  webview views, watchers, settings, storage and secrets are declarations. The
  root export is 74 values, down from 164.
- **A declaration and a runtime token are not two ways in.**
  `module.fileWatchers.add` is for a glob known when the code is written;
  `FileWatchers.watch` is for one the user just typed. Same split as
  `defineStatusBarItem` against `StatusBar.flash`, and `context.progress`
  against `Operations.run`. Each pair is one ability with a definition-time and
  a runtime entry.
- **A text editor command receives an `ActiveEditor`** — the same object
  `Editors.active` returns — so a feature works under either declaration.
- **Usability outranks a design line that costs the consumer something.** Three
  lines moved on that basis: the pure helpers (`debounce`, `retry`, the
  formatters) are on the root barrel as well as their subpaths, because the
  subpaths exist for webview bundles that cannot import the root at all;
  `toPickItem` and `toPickButton` turn out to be vscode-free, since VS Code
  recognises a theme icon by its `id`; and `status` belongs in the standard
  context set, because `StatusBar.flash` is exactly what a handler body says to
  the user.
- **`confirm`'s remembering button says what it does.** The default label is
  `'Yes, Always'`, not `"Don't Ask Again"` — pressing it answers yes _and_
  records consent to every later call, and a dismissal-sounding label on a
  confirmation dialog is the last place for that to blur. `rememberText`
  overrides it, like `yesText` and `noText`.
- **Storage and secrets validate before they store.** The read side is lenient
  by design, so an unchecked write failed nowhere at all: the value was simply
  gone the next time anyone looked. A schema that coerces has its output stored,
  so the next read agrees with the write.
- **A webview's `script-src` drops `cspSource` once a nonce is supplied.**
  Source expressions and nonces are alternatives in CSP Level 3 — a script
  matching either one runs — so keeping both let anything under
  `localResourceRoots` execute with no nonce, which is the whole guarantee the
  nonce exists for. VS Code's own webviews emit `script-src 'nonce-x'` alone.
- **Services get a logger**, instead of being handed a raw memento to build one
  from, and can inject a declared storage, setting or secret like a handler can.
- **Editor access is `Editors`**, replacing 20 free functions that each took a
  `vscode.TextEditor`. `editors.active` answers the "is there an editor?"
  question once, at the top of a handler.
- **Tree providers moved onto the foundation.** `BaseTreeDataProvider` and
  `SimpleTreeDataProvider` are vscode-free, a row is plain data, and an icon is
  a theme icon id (`icon: 'folder'`). The adapter builds the platform's
  `TreeItem`.
- **Webviews are declared or injected.** `module.webviews.addView` for a view,
  `module.webviews.restorePanel` for a panel that survives a window reload, and
  the `Webviews` token for opening one from a handler.
- **Cancellation is an `AbortSignal` everywhere.** Anything that took a
  `CancellationToken` — retry attempts, batch resolution, progress steps — takes
  a signal, and `context.signal` already combines the operation's cancellation
  with the user's.
- **`./ui` is retired.** Its contents were the vscode-bound picker functions,
  which the `QuickInput` service replaces.
- **ESM only, explicitly.** `require()` of any subpath fails, and CI proves it
  against the packed tarball rather than asserting it in prose.
- **Consumers need `ESNext.Disposable` and an `AbortSignal` lib** (`DOM`,
  `WebWorker` or `@types/node`) in `lib`. The public types name both.
- **`vitest` is declared as an optional peer dependency**, for the
  `./testing/vitest` subpath.

### Removed

The application shape v2 implied is gone: `createExtensionKit`, `safeExecute`
and the manual `context.subscriptions` bookkeeping they required.
`defineExtension`, operations and `host.stop()` replace them.

The standalone helpers went with it. Every ability survives; the way in changed:

| Removed                                                                                                                                                                                                     | Now                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `showInfo` `showWarn` `showError` `confirm`                                                                                                                                                                 | `Notifications` token                               |
| `withProgress` `withSteps`                                                                                                                                                                                  | `context.progress.run` / `.steps`                   |
| `pickOne` `pickMany` `inputText` `wizard`                                                                                                                                                                   | `QuickInput` token                                  |
| `createStatusBarItem`                                                                                                                                                                                       | `defineStatusBarItem` + token                       |
| `showStatusMessage` `createStatusMessage`                                                                                                                                                                   | `StatusBar` token: `flash`                          |
| `createSecretStore`                                                                                                                                                                                         | `Secrets` token                                     |
| `applyEditsGrouped`                                                                                                                                                                                         | `editors.active.editStages`                         |
| `createLanguageStatusItem`                                                                                                                                                                                  | `defineLanguageStatusItem` + token                  |
| `createFileWatcher` `watchFile`                                                                                                                                                                             | `module.fileWatchers.add`                           |
| `createTreeView` `createDragAndDropController`                                                                                                                                                              | `module.treeViews.add`, with `dragAndDrop` declared |
| `createWebviewPanel` `registerWebviewView` `registerWebviewPanelSerializer` `loadHtmlTemplate`                                                                                                              | `Webviews` token / `module.webviews.*`              |
| the 20 editor functions                                                                                                                                                                                     | `Editors` token                                     |
| `l10n` `plural` `formatDate` `formatNumber` `formatRelativeTime` `getLanguage` `isLanguage`                                                                                                                 | `Localization` token                                |
| `createTypedStorage` `createGlobalStorage` `createWorkspaceStorage` `createSecret*`                                                                                                                         | `defineStorage` / `defineSecret` + token            |
| `createNotifier` `createProgressRunner` `createManagedStatusBarItem` `createManagedLanguageStatusItem` `createManagedFileWatcher` `createWizard` `createSettingsAccessor`                                   | built by the host                                   |
| `createApplication` `compileApplication` `createApplicationHost` `runtimePreflight`, the scope constructors, the logger factories, the host state machine, and the nine `createVSCode*Capability` factories | `defineExtension`                                   |

Three more arrived after a trial migration of a real extension found that v3
could not express them: `Secrets`, for secrets the _user_ names (`defineSecret`
declares a key the extension knows about at definition time, which is a
different ability); `StatusBar.flash`, for a message with no item of its own;
and `editors.active.editStages`, for several edits in order that land as one
undo step.

Two abilities were rebuilt on the v3 side _before_ their v2 form was removed,
rather than dropped: weighted multi-step progress is `context.progress.steps`,
which still reports cancellation as a value rather than a thrown error, and the
transient status message is `status.flash`, which is a state the existing item
passes through instead of a second item created and disposed on a timer.

`listStorageKeys` has no v3 equivalent and is simply gone: a declared storage
knows its own key.

### Fixed

Findings from a full source and test review, each with a regression test:
deactivation ownership and the shutdown deadline, deep plan immutability, webview
RPC envelope validation before any state change, Standard Schema v1 conformance
with a synchronous-only gate, secret redaction in schema failures, atomic
legacy-key storage migration, file watcher construction rollback, per-attempt
retry signals, single-key setting watches, and the fidelity of the fakes and the
mock kit (settings `affects` semantics, listener removal, watcher pattern
routing).

A second, independent read of the whole tree turned up these, each re-verified
against the source before it was changed:

- **`ResourceScope.own` discarded a `dispose()` that returned a promise.**
  `Registration.dispose` is typed `unknown`, and TypeScript accepts a
  promise-returning method wherever `void` is expected, so such a resource
  arrived without a complaint and its teardown was never awaited. The cleanup
  now hands the promise back to be awaited in place. `RegistrationScope` refuses
  one outright — closing ingress synchronously is its whole purpose.
- **`setKeysForSync` ran before runtime preflight.** It writes to persistent
  storage and survives a failed activation, so an application that then refused
  to start left the platform holding a claim nothing backed. Preflight now runs
  first, before anything in activation touches VS Code.
- **Module rollback stopped at its first failing phase.** Both scopes are
  detached until the module commits, so a registration whose `dispose()` threw
  took the module's resources with it — and replaced the activation error with
  the cleanup error. Each phase is attempted independently, and the cause
  propagates while the consequence is reported.
- **A declared webview view's RPC channel had no teardown path.** Each resolve
  built one and nothing closed it. It is now owned for exactly as long as its
  incarnation, and whatever is still on screen when the module unbinds is closed
  with it.
- **`request()` on the webview RPC could throw synchronously** — the
  `postMessage` call is evaluated as an argument, so a disposed webview escaped
  the method as an exception where the signature promises a promise, stranding
  the entry it had already placed in `pending`.
- **Undo boundaries belonged to the first and last stage in the list**, not to
  the first and last that actually edit. A stage that decided it had nothing to
  do took its boundary with it, and one undo swallowed whatever the user did
  next to it.
- **A tree load that started before a refresh repopulated the cache** it had
  just been cleared from, so the next query was served pre-refresh children. The
  trigger is ordinary: a watcher fires while a node is expanding.
- **Three things were identified by what they said rather than by which they
  were**: a status flash by its text (so the same message twice let the first
  handle clear the second), a debounce `maxWait` timer by an overwritten handle
  (leaving the old one armed to fire a trailing invocation), and an RPC handler
  registration by its method name (so disposing a registration you had just
  replaced silently unregistered the replacement — fixed on both endpoints).
- **A log line was dropped whole when its fields could not be serialized.**
  Circular references, `BigInt` and throwing getters all make `JSON.stringify`
  throw; the entry now survives with less in it.
- **The recommended Vitest alias omitted `UIKind` and `extensions`.**
  `import * as vscode` reads named exports, and the environment adapter reads
  `vscode.UIKind.Web` during preflight — so activating through the documented
  path threw on every application while every unit test passed. A test now
  derives the required set from the adapter sources.
- **The mock kit had no `languages` provider registrations.** `createTestHost`
  binds a plan's managed raw registrations like anything else, so an application
  registering a hover provider could not start at all.
- Narrower: `isThenable` missed a callable thenable, and the injected dependency
  record was built on `Object.prototype`, where a dependency named `__proto__`
  would have changed the prototype instead of becoming a property.

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
  export default mergeConfig(vscodeExtKitVitestConfig, defineConfig({/* yours */}));
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
  switches theme _and_ notifies listeners. Theme detection plus a change
  listener is close to universal in extensions that render anything, and none of
  it was mockable.
- **`MockFn` describes more of `vi.fn`/`jest.fn`**: `mock.results` (the only way
  to assert on the object a factory mock _returned_, e.g. the channel from
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
- **File-watcher batches reach every listener even when one unsubscribes
  mid-delivery.** `flushNow` iterated the live listener array, so a listener
  disposing itself (a one-shot subscription) shifted the array and skipped the
  next listener for that batch. Delivery now goes to a snapshot — the same
  contract VS Code's own `EventEmitter` has.
- **The testing kit's value classes now match the real `vscode` semantics**
  (each verified against the microsoft/vscode implementation): `Range`
  normalizes a reversed start/end pair by swapping (so a reversed `Selection`
  exposes its `active` position as `start`, like the host does);
  `EventEmitter.fire` delivers to a listener snapshot; QuickPick/InputBox
  subscription `dispose()` actually unhooks the listener (it was a recorded
  no-op); `Uri.joinPath` resolves `.`/`..` segments — which `watchFile()`'s
  own parent-directory pattern relies on — and `Uri.parse` extracts the scheme
  instead of hardcoding `file`. Each divergence let a test pass against
  behavior the extension host would never produce.
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
  throwing.** Only the gap _between_ steps was checked, so a step handed
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
  wrong direction. Both fields are named after the side that _answers_ the
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
  Disposing a _visible_ quick pick makes VS Code fire `onDidHide`
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
  README documents, then typechecks and runs tests against the _published_
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

[Unreleased]: https://github.com/kkdev92/vscode-ext-kit/compare/v4.0.1...HEAD
[4.0.1]: https://github.com/kkdev92/vscode-ext-kit/compare/v4.0.0...v4.0.1
[4.0.0]: https://github.com/kkdev92/vscode-ext-kit/compare/v3.0.0...v4.0.0
[3.0.0]: https://github.com/kkdev92/vscode-ext-kit/compare/v3.0.0-alpha.3...v3.0.0
[3.0.0-alpha.3]: https://github.com/kkdev92/vscode-ext-kit/compare/v3.0.0-alpha.2...v3.0.0-alpha.3
[3.0.0-alpha.2]: https://github.com/kkdev92/vscode-ext-kit/compare/v3.0.0-alpha.1...v3.0.0-alpha.2
[3.0.0-alpha.1]: https://github.com/kkdev92/vscode-ext-kit/compare/v2.1.0...v3.0.0-alpha.1
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
