# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
This project is pre-1.0: while it follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
in spirit, breaking changes may land in minor releases and are marked **Breaking**.

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

[0.5.0]: https://github.com/kkdev92/vscode-ext-kit/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/kkdev92/vscode-ext-kit/compare/v0.3.1...v0.4.0
[0.3.1]: https://github.com/kkdev92/vscode-ext-kit/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/kkdev92/vscode-ext-kit/compare/v0.2.2...v0.3.0
[0.2.2]: https://github.com/kkdev92/vscode-ext-kit/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/kkdev92/vscode-ext-kit/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/kkdev92/vscode-ext-kit/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/kkdev92/vscode-ext-kit/releases/tag/v0.1.2
