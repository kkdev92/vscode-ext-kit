/**
 * @packageDocumentation
 * Public `./testing` entry point.
 *
 * Prefer the highest-level seam that reaches the code under test:
 *
 * - `createTestHost` for framework modules and their production plan;
 * - a focused port fake for one capability or service;
 * - `createVSCodeMock` only for code that directly imports `vscode`.
 *
 * This package never imports `vscode` at runtime. The low-level mock uses only
 * `import type`, so ordinary unit tests do not require an Extension Host. That
 * convenience is not a compatibility guarantee: platform rendering, host
 * scheduling and unimplemented VS Code members still belong in Extension Host
 * tests.
 */

export { createFakeCommands } from './fakes/fake-commands.js';
export type { FakeCommands } from './fakes/fake-commands.js';

export { createFakeEnvironment } from './fakes/fake-environment.js';
export type { FakeEnvironment } from './fakes/fake-environment.js';

export { createFakeWebviews } from './fakes/fake-webview.js';
export type {
  FakeWebviewPanel,
  FakeWebviewSerializer,
  FakeWebviewView,
  FakeWebviews,
} from './fakes/fake-webview.js';

export { createFakeEditor } from './fakes/fake-editor.js';
export type { FakeEditor, RecordedWorkspaceEdit } from './fakes/fake-editor.js';

export { createFakeLocalization } from './fakes/fake-localization.js';
export type { FakeLocalization } from './fakes/fake-localization.js';

export { createFakeSettings } from './fakes/fake-settings.js';
export type {
  FakeSettings,
  FakeSettingsPlacement,
  FakeSettingsTier,
} from './fakes/fake-settings.js';

export { createTestHost } from './test-host.js';
export type { CreateTestHostOptions, LeakReport, ServiceOverrides, TestHost } from './test-host.js';
export type { ApplicationInspection } from '../foundation/application/application.js';

// Manifest and source remain separate because VS Code consumes contributions
// before activation. This assertion makes source declarations authoritative
// only for their mechanical overlap; human-facing manifest text stays manual.
export { assertManifestMatches, diffManifest } from './manifest.js';
export type { DeclaredContributions, ManifestMismatch } from './manifest.js';

export { createFakeMemento, createFakeSecrets, createFakeStorage } from './fakes/fake-storage.js';
export type { FakeMemento, FakeSecrets, FakeStorage } from './fakes/fake-storage.js';

export { createFakeFileWatchers, fakeUri } from './fakes/fake-filewatcher.js';
export type { FakeFileWatchers } from './fakes/fake-filewatcher.js';

export { createFakeTreeViews } from './fakes/fake-treeview.js';
export type { FakeTreeView, FakeTreeViews } from './fakes/fake-treeview.js';

export { createFakeQuickInput } from './fakes/fake-quick-input.js';
export type { FakeInputBox, FakeQuickInput, FakeQuickPick } from './fakes/fake-quick-input.js';

export {
  createFakeLanguageStatus,
  createFakeNotifications,
  createFakeProgress,
  createFakeStatusBar,
} from './fakes/fake-ui.js';
export type {
  FakeLanguageStatus,
  FakeLanguageStatusItem,
  FakeNotifications,
  FakeProgress,
  FakeProgressRun,
  FakeStatusBar,
  FakeStatusBarItem,
  ShownNotification,
} from './fakes/fake-ui.js';

export { createRecordingLogSink } from './fakes/recording-log-sink.js';
export type { RecordingLogSink } from './fakes/recording-log-sink.js';

// --- Partial stand-in for direct `vscode` imports ---------------------------
// This is deliberately lower-level than TestHost. It implements the subset
// documented by its builders, not the whole VS Code API. Factories accept the
// runner's `vi`/`jest` object instead of importing one, keeping the main testing
// entry point runner-neutral.
export { createVSCodeMock } from './mock/vscode-mock.js';

export {
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
  UIKind,
  ColorThemeKind,
  TextEditorRevealType,
} from './mock/vscode-mock.js';

export {
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
  Disposable,
  WorkspaceEdit,
} from './mock/vscode-mock.js';
export type { MockWorkspaceEditEntry, MockTextLine } from './mock/vscode-mock.js';

export {
  createMockUri,
  createMockQuickPick,
  createMockInputBox,
  createMockTreeView,
  createMockWebview,
  createMockWebviewPanel,
  createMockWebviewView,
  createMockWebviewViewResolveContext,
  createMockFileSystemWatcher,
  createMockStatusBarItem,
  createMockLogOutputChannel,
  createMockOutputChannel,
  createMockCancellationToken,
  createMockMemento,
  createMockSecretStorage,
  createMockWorkspaceConfiguration,
  createMockTextDocument,
  createMockTextEditor,
} from './mock/vscode-mock.js';

export { createMockExtensionContext } from './mock/mock-factories.js';
export { createMockLogger } from './mock/mock-logger.js';
export type { MockFn, MockFnCreator, MockFrameworkLike } from './mock/mock-types.js';
