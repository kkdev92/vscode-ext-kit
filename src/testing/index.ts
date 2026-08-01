/**
 * @packageDocumentation
 * `@kkdev92/vscode-ext-kit/testing` — a framework-injected mock kit for the
 * `vscode` module, published as a subpath export so extension authors can
 * unit test code that imports `vscode` without a running extension host.
 *
 * This subpath has zero runtime dependencies, including on `vitest`/`jest`
 * themselves: every factory takes a {@link MockFrameworkLike} (typically
 * `vi` or `jest`) instead of importing one.
 *
 * @example
 * ```ts
 * // tests/setup.ts
 * import { vi } from 'vitest';
 * import { createVSCodeMock } from '@kkdev92/vscode-ext-kit/testing';
 *
 * vi.mock('vscode', () => createVSCodeMock(vi));
 * ```
 *
 * @example
 * ```ts
 * import { describe, it, expect, vi } from 'vitest';
 * import * as vscode from 'vscode';
 * import { createMockExtensionContext, createMockLogger } from '@kkdev92/vscode-ext-kit/testing';
 * import { activate } from '../src/extension.js';
 *
 * describe('myExtension', () => {
 *   it('registers the hello command', () => {
 *     const context = createMockExtensionContext(vi);
 *     const logger = createMockLogger(vi);
 *
 *     activate(context, logger);
 *
 *     expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
 *       'myext.hello',
 *       expect.any(Function)
 *     );
 *   });
 * });
 * ```
 *
 * @module @kkdev92/vscode-ext-kit/testing
 */

// ============================================
// vscode module mock (enums, value classes, namespaces)
// ============================================
export { createVSCodeMock } from './vscodeMock.js';

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
  ColorThemeKind,
  TextEditorRevealType,
} from './vscodeMock.js';

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
} from './vscodeMock.js';
export type { MockWorkspaceEditEntry, MockTextLine } from './vscodeMock.js';

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
} from './vscodeMock.js';

// ============================================
// Higher-level fixtures (Logger, ExtensionContext)
// ============================================
export { createMockLogger, createMockExtensionContext } from './factories.js';

// ============================================
// Framework-injection types
// ============================================
export type { MockFrameworkLike, MockFn, MockFnCreator } from './types.js';
