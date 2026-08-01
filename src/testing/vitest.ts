/**
 * @packageDocumentation
 * A ready-made stand-in for the `vscode` module itself, for Vitest users.
 *
 * `vi.mock('vscode', () => createVSCodeMock(vi))` covers the common case, but
 * it only applies to modules Vite transforms. Point Vitest's `resolve.alias` at
 * this module instead and *every* importer resolves to the same mock —
 * including a built `dist/` bundle you want to `activate()` for real, which is
 * the one thing `vi.mock` cannot reach.
 *
 * The alias needs `server.deps.inline` alongside it — Vitest externalizes
 * `node_modules` by default and loads them through Node's ESM loader, which
 * never sees Vite's aliases, so the kit's own `import * as vscode` would fail
 * to resolve. Rather than restating both halves in every project, spread the
 * ready-made config:
 *
 * ```ts
 * // vitest.config.ts
 * import { defineConfig, mergeConfig } from 'vitest/config';
 * import { vscodeExtKitVitestConfig } from '@kkdev92/vscode-ext-kit/testing/vitest-config';
 *
 * export default mergeConfig(
 *   vscodeExtKitVitestConfig,
 *   defineConfig({ test: { clearMocks: true } })
 * );
 * ```
 *
 * Unlike {@link ../testing/index.js `@kkdev92/vscode-ext-kit/testing`} — which
 * takes an injected `{ fn }` and works with any runner — this module imports
 * `vi` directly, because an aliased module is resolved before any test file
 * runs and so has no chance to be handed a framework. That's also why the mock
 * is built from `vi.fn()` rather than a hand-rolled spy: only a real `vi.fn()`
 * is tracked by `clearMocks`/`restoreMocks`, and a mock the runner doesn't know
 * about would silently leak call history between tests.
 *
 * Jest users should keep using `@kkdev92/vscode-ext-kit/testing` and write the
 * three-line equivalent of this file themselves, re-exporting
 * `createVSCodeMock(jest)`.
 *
 * One consequence of aliasing: this module is evaluated once per test file, so
 * the mock is shared by every test in that file. `clearMocks: true` resets call
 * history between tests, but a field a test assigns itself (say
 * `window.activeTextEditor`) persists — restore those in an `afterEach`, or use
 * the standalone builders from `@kkdev92/vscode-ext-kit/testing` for a fixture
 * scoped to one test.
 */
import { vi } from 'vitest';
import { createVSCodeMock } from './vscodeMock.js';

const mock = createVSCodeMock(vi);

// Re-exported individually, because `import * as vscode from 'vscode'` reads
// named exports — a default export alone would leave every `vscode.window`
// call in the code under test undefined.
export const {
  version,
  LogLevel,
  ProgressLocation,
  ConfigurationTarget,
  StatusBarAlignment,
  TreeItemCollapsibleState,
  TreeItemCheckboxState,
  QuickPickItemKind,
  QuickInputButtons,
  QuickInputButtonLocation,
  LanguageStatusSeverity,
  ViewColumn,
  ColorThemeKind,
  TextEditorRevealType,
  EventEmitter,
  TreeItem,
  ThemeIcon,
  ThemeColor,
  MarkdownString,
  DataTransfer,
  DataTransferItem,
  CancellationError,
  Position,
  Range,
  Selection,
  RelativePattern,
  Uri,
  Disposable,
  WorkspaceEdit,
  window,
  commands,
  workspace,
  languages,
  env,
  l10n,
} = mock;

/**
 * The whole mock as one object, for assertions that would otherwise need a
 * dozen imports:
 *
 * ```ts
 * import vscodeMock from '@kkdev92/vscode-ext-kit/testing/vitest';
 * expect(vscodeMock.commands.registerCommand).toHaveBeenCalledTimes(3);
 * ```
 *
 * It's the same object the named exports come from, so either style observes
 * the same calls.
 */
export default mock;
