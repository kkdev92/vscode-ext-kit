# fixtures

Two throwaway extensions that exist only to run this framework inside a real
VS Code and report what happened. **Neither is published, and neither ships in
the npm package** — `files` in the root `package.json` is `dist`, `src`,
`README.md`, `CHANGELOG.md`, `LICENSE`, so an installed copy of the kit contains
none of this.

They are committed rather than kept locally because CI runs them from a clean
checkout. Remove the directory and two jobs fail immediately.

## Why they exist

Everything under `tests/` runs against fakes and a stand-in for the `vscode`
module. That proves the wiring is what we think it is; it cannot prove VS Code
agrees. **A fake is written by the same person who wrote the assumption it
encodes, so the two agree by construction.**

That is not hypothetical here. `registerTextEditorCommand` turned out to
discard whatever the handler returns and to log a rejection rather than
propagate it — while the framework's fake awaited the handler and propagated
both. Every unit test passed. Only a real host showed the difference.

So the rule: when a behaviour depends on what VS Code does *with* what the
framework hands it, rather than on what it hands back, it belongs here.

## The two lanes

### `extension-host/` — desktop

```bash
npm run test:eh                    # from the repository root
VSCODE_VERSION=1.134.0 npm run test:eh
```

Launches a real VS Code (Electron), activates the fixture, invokes a command,
and shuts down. The fixture writes ordered markers to a scratch file — one per
lifecycle event, `activate:start` through `deactivate:end` — and `run-test.mjs`
asserts the ordering afterwards.

What it settles, and nothing else can:

- **`context.subscriptions` is disposed while `deactivate()` is still
  pending**, not after it resolves. This contradicts what the API's shape
  suggests, and it is the reason `beginStop()` has to be idempotent and
  state-guarded rather than relying on ordering. The whole single-cleanup-owner
  design rests on this measurement.
- A hosted service starts before activation completes and stops between the
  start and end of deactivation.
- Cleanup runs **exactly once** even though the failsafe fires mid-shutdown.
- A command's return value survives the extension-host boundary.
- **A webview view is not re-resolved by ordinary hide/show.** Reading VS
  Code's source suggests a view is rebuilt whenever it becomes visible, and the
  framework gives each resolve its own RPC channel on that basis. Measured on
  1.132.0 desktop, neither closing the sidebar nor switching view containers
  ends the incarnation: the same webview comes back and the provider is asked
  once. The per-incarnation teardown is therefore for the paths that retire the
  pane, not for hide/show — and this lane reports which of the two a given
  version does, failing only if a second incarnation appears while the first
  one's channel is still open.

It also prints a runtime probe — Node version, `AbortSignal.any`,
`Symbol.dispose`, `DisposableStack` — which is where the `lib` settings are
checked against what the host actually provides.

CI runs **stable only**. VS Code updates itself, so an extension published today
runs on current stable; pinning effort to an older build spends it on a
configuration almost nobody is in. `xvfb-run` is needed on Linux either way,
because VS Code is an Electron app and wants a display.

### `web-extension/` — browser / worker

```bash
npm run test:web
```

Runs the framework in a headless Chromium worker via `@vscode/test-web`. The
worker has no `node:` builtins at all, so this is the lane that catches one
sneaking into the dependency graph — its `tsconfig.json` deliberately sets
`types: ["vscode"]` with no `"node"`, so such an import fails the typecheck
before it ever reaches a browser.

An uncaught error inside the worker rejects the run, so reaching the end is the
pass condition. It prints the same runtime probe with `uiKind: 'web'`. Note the
probe **records** what this browser offers; the framework must not depend on any
of it, because the engine is whichever browser the user happens to have.

## Why each has its own `package.json`

VS Code loads an extension by reading a manifest, so anything it activates needs
one. These are the smallest manifests that will activate: a name, an engine
range, an entry point and a single probe command.

This is **not** an npm workspace. The manifests are never installed, never
published (`private: true`, publisher `ext-kit-fixtures`), and their versions
are `0.0.0` because nothing reads them.

## Layout

```
extension-host/
  package.json        the manifest VS Code reads
  tsconfig.json       typechecked by `npm run typecheck`
  build.mjs           bundles to CJS with `vscode` external, as a real extension ships
  run-test.mjs        launches VS Code, then asserts the marker ordering
  src/extension.ts    activate/deactivate, writing a marker at each step
  src/markers.ts      appends to the file the driver reads
  src/test/index.ts   runs inside the host; VS Code's `extensionTestsPath` entry

web-extension/        the same shape, bundled for the browser
```

`out/` is build output and `.vscode-test*/` holds the downloaded VS Code; both
are gitignored. A cached download makes the desktop lane runnable offline.

## Adding a case

Prefer a unit test. Come here only when the answer depends on VS Code itself —
and when you do, assert the observable fact rather than what you believe the API
promises. The point of this directory is to find out where those two differ.
