/**
 * @packageDocumentation
 * Higher-level test fixtures built on top of {@link createVSCodeMock}'s
 * building blocks: a `Logger` fixture matching this library's own
 * `Logger` type, and a full `vscode.ExtensionContext` fixture.
 *
 * Both factories declare their real return type (`Logger`,
 * `vscode.ExtensionContext`) so a missing or mistyped field is caught by
 * `tsc`, not discovered at runtime — the exact gap that let this
 * library's own test suite carry two non-equivalent `ExtensionContext`
 * mocks and a `Logger` mock missing `trace` before this module existed.
 */
import type * as vscode from 'vscode';
import type { Logger } from '../core/types.js';
import type { MockFrameworkLike } from './types.js';
import { createMockMemento, createMockSecretStorage, createMockUri } from './vscodeMock.js';

/**
 * Creates a mock {@link Logger} for testing. Every method is a mock
 * function that can be asserted against; `child()` returns the same mock
 * so scoped calls stay observable through the parent.
 *
 * @example
 * ```ts
 * import { vi } from 'vitest';
 * import { createMockLogger } from '@kkdev92/vscode-ext-kit/testing';
 *
 * const logger = createMockLogger(vi);
 * activate(context, logger);
 * expect(logger.info).toHaveBeenCalledWith('activated');
 * ```
 */
export function createMockLogger(framework: MockFrameworkLike): Logger {
  const { fn } = framework;
  const logger: Logger = {
    trace: fn(),
    debug: fn(),
    info: fn(),
    warn: fn(),
    error: fn(),
    child: fn((): Logger => logger),
    setLevel: fn(),
    level: 'info',
    dispose: fn(),
    [Symbol.dispose]: fn(),
  };
  return logger;
}

/**
 * Creates a mock `vscode.ExtensionContext` for testing: a real (empty)
 * `subscriptions` array, working `globalState`/`workspaceState` mementos
 * and `secrets` storage, and plausible placeholder values for the
 * remaining read-only fields.
 *
 * `vscode.Uri` has a private constructor, and a couple of nested shapes
 * (`Extension<any>`, `GlobalEnvironmentVariableCollection`) are
 * approximated rather than fully implemented — there is no real extension
 * host in a unit test. Both are collapsed into the single documented cast
 * below, so callers receive a properly typed `vscode.ExtensionContext`
 * without having to cast at every call site themselves.
 *
 * @example
 * ```ts
 * import { vi } from 'vitest';
 * import { createMockExtensionContext } from '@kkdev92/vscode-ext-kit/testing';
 *
 * const context = createMockExtensionContext(vi);
 * activate(context);
 * expect(context.subscriptions).toHaveLength(1);
 * ```
 */
export function createMockExtensionContext(framework: MockFrameworkLike): vscode.ExtensionContext {
  const { fn } = framework;
  const Uri = createMockUri(framework);
  const extensionUri = Uri.file('/mock/extension');

  const context = {
    subscriptions: [] as vscode.Disposable[],
    globalState: createMockMemento(framework),
    workspaceState: createMockMemento(framework),
    secrets: createMockSecretStorage(framework),
    extensionUri,
    extensionPath: '/mock/extension',
    storagePath: '/mock/storage',
    globalStoragePath: '/mock/global-storage',
    logPath: '/mock/log',
    extensionMode: 1, // vscode.ExtensionMode.Production
    extension: {
      id: 'mock.extension',
      extensionUri,
      extensionPath: '/mock/extension',
      isActive: true,
      packageJSON: {},
      extensionKind: 1, // vscode.ExtensionKind.UI
      exports: undefined,
      activate: fn(),
    },
    environmentVariableCollection: {
      persistent: false,
      description: undefined,
      replace: fn(),
      append: fn(),
      prepend: fn(),
      get: fn(),
      forEach: fn(),
      delete: fn(),
      clear: fn(),
      getScoped: fn(),
      [Symbol.iterator]: fn(),
    },
    asAbsolutePath: fn((path: string) => `/mock/extension/${path}`),
    storageUri: Uri.file('/mock/storage'),
    globalStorageUri: Uri.file('/mock/global-storage'),
    logUri: Uri.file('/mock/log'),
    languageModelAccessInformation: {
      onDidChange: fn(() => ({ dispose: fn() })),
      canSendRequest: fn(),
    },
  };

  return context as unknown as vscode.ExtensionContext;
}
