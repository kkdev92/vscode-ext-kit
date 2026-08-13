# Contributing to vscode-ext-kit

Thanks for your interest. This document covers the parts of this repo that are
not obvious from the code.

## Two branches, two codebases

- **v3** (`main`, `feat/v3-foundation`) — the extension _application framework_.
  This is what you are looking at.
- **v2** (`v2-maintenance`) — the shipped `2.x` utility library. Still `latest`
  on npm and still takes bug fixes. It is not present on the v3 line; recover a
  file with `git checkout v2-maintenance -- <path>`.

A change belongs on one line or the other. A v2 bug fix does not port to v3 by
copying the file: v3's shape is different.

## Setup

Node `>=22.12.0` (24 LTS is what CI publishes with), npm 10+, git.

```bash
git clone https://github.com/kkdev92/vscode-ext-kit.git
cd vscode-ext-kit
npm install
npm run hooks     # optional: installs the pre-commit hook
npm run quality
```

`hooks` is a separate step rather than `prepare` on purpose. npm lists a
dependency's `prepare` script among the ones it wants permission to run, so
leaving it there put "vscode-ext-kit wants to run husky" in front of every
consumer installing the package — for a hook that only means anything in this
repo.

## Commands

```bash
npm run build           # tsc -b tsconfig.build.json (framework + mock kit)
npm run typecheck       # build, then src+tests, then the README samples
npm test                # vitest run
npm run test:coverage   # the same suite, with the coverage gate
npm run lint            # type-aware ESLint over src + tests, --max-warnings 0
npm run format          # prettier
npm run knip            # dead code
npm run verify:package  # pack, install into a throwaway consumer, import every subpath
npm run quality         # typecheck + lint + test:coverage + knip — the gate CI runs
```

`tsc -b --noEmit` does not work (TS6310: project references need `composite`, and
`--noEmit` propagates through the graph). That is why `typecheck` builds and then
type-checks separately.

## Layout

`src/` is four layers, and the boundaries are enforced by
`tests/import-graph.test.ts` rather than by convention:

```
src/
  foundation/     the v3 architecture core: plan, host, scopes, services,
                  modules, operations, settings, capability ports
  capabilities/   the APIs carried over from v2, running on the foundation:
                  core utilities, storage, secrets, UI, views, workspace
  vscode/         the real adapters — the only place that may import `vscode`
                  at runtime, plus `defineExtension`, the composition root
  testing/        the published test surface: Test Host, fakes, mock kit
```

Rules the import-graph test holds:

- `foundation` and `capabilities` import neither `src/vscode/**` nor
  `src/testing/**`, and never name `vscode`.
- `foundation -> capabilities` is allowed only from `application/application.ts`,
  `application/plan.ts` and `modules/definition.ts` — the three places that
  aggregate capability registrations into a plan. A fourth is a design decision,
  not a drive-by import.
- Only the `vscode` layer names `vscode`; the mock kit's two files may reference
  its _types_ only.

`tests/` mirrors `src/`: a test lives at the path of the code it exercises.
Contract suites sit next to the port they pin.

## Invariants

Break one of these and the review will ask you to undo it:

- **`host.stop()` is the only cleanup path.** `context.subscriptions` gets one
  synchronous failsafe. Never park framework registrations on it — VS Code
  disposes `context.subscriptions` _while_ `deactivate()` is still pending, so
  safety comes from the failsafe being state-guarded and idempotent, not from
  ordering.
- **Module callbacks are synchronous and side-effect free.** A returned thenable
  is rejected at runtime.
- **Service factories are synchronous.** Async initialisation belongs in a hosted
  service.
- **Preflight catches structural errors before binding**: duplicate ids, missing,
  circular and captive dependencies.
- **A command's result and its rejection both reach the caller.** Presentation is
  VS Code's job.
- **Invalid setting values are never silently replaced.** Strict fails; lenient
  falls back _and_ records a diagnostic.

## Adding a capability

There is one way in per ability, and a new one has to arrive the same way:

1. **A port** in `foundation/platform/ports.ts`, describing only what the
   service actually calls. Plain data where the platform will let you — a port
   that mirrors a `vscode` class is a port you cannot fake.
2. **A service or a declaration** in `capabilities/`, vscode-free, reached
   through a token (`Notifications`, `Editors`, …) or a module collection
   (`module.treeViews.add`, …).
3. **An adapter** in `vscode/`, doing translation and nothing else.
4. **A fake** in `testing/fakes/`, and **a contract suite** both sides run.

What not to do: add a standalone `doTheThing()` alongside the declaration. Two
entry points make a reader guess, and the guess is what produces code that
half-works. If a helper seems to need one, that is usually a sign the service is
missing a method.

## Tests

**New behaviour needs a test, and so does a fix.** Pure logic goes in the suite
that mirrors its path under `tests/`; anything that depends on what VS Code
actually does with a handler belongs in `fixtures/extension-host`.

A test is worth having only if it fails when the behaviour is wrong. Two habits
this repo enforces:

- **Prove the detector.** When you fix a bug, check that the new test fails
  against the unfixed code. Several suites carry a comment recording what they
  caught.
- **Do not implement the same rule twice and call it verification.** The settings
  `affects` contract suite runs VS Code's own algorithm on the adapter side and
  the plain rule on the fake side, precisely so one wrong idea cannot satisfy
  both.

Fakes and real adapters share one contract suite. A fake that drifts fails the
build; that is the whole reason the Test Host is trustworthy.

Coverage has per-layer floors (`vitest.config.ts`), not just a global number:
`foundation` and the fakes are held near their current mid-90s, the adapter layer
lower because the Extension Host lane is what really exercises it.

## Commits and pull requests

Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`,
`ci:`). The body is worth writing: say what was wrong, what the failure looked
like, and how you know it is fixed.

Before opening a PR: `npm run quality`, plus `npm run verify:package` if you
touched `exports`, `files`, or anything about `dist`'s shape.

If you change a public API, update the README — the samples under `docs/samples/`
are compiled by `npm run typecheck` and compared to the README character for
character, so a stale README fails the suite.

## Reporting issues

Include the package version, VS Code version, Node version, whether it is the
desktop or web extension host, what you expected, and what happened. A failing
test against the Test Host is the fastest possible bug report.

## License

By contributing you agree that your contributions are licensed under the MIT
License.
