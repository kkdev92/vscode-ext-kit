/**
 * @packageDocumentation
 * Higher-level `vscode.ExtensionContext` fixture built from
 * {@link createVSCodeMock}'s memento, secret-storage and URI building blocks.
 *
 * The factory exposes the real `vscode.ExtensionContext` return type for caller
 * convenience. A deliberate cast covers synthetic nested values, so this type
 * is not proof that every Extension Host member is implemented. The logger
 * fixture lives in `mock-logger.ts`.
 */
import type * as vscode from 'vscode';
import type { MockFrameworkLike } from './mock-types.js';
import { createMockMemento, createMockSecretStorage, createMockUri } from './vscode-mock.js';

/**
 * Creates a focused `vscode.ExtensionContext` fixture for activation-unit
 * tests: a real (empty) `subscriptions` array, working
 * `globalState`/`workspaceState` mementos and `secrets` storage, and plausible
 * placeholders for members used by this kit.
 *
 * The returned value is assignable to the supported `@types/vscode` shape, but
 * it is not a complete runtime implementation. Paths are placeholders,
 * mementos/secrets are in-memory, extension metadata is synthetic, and
 * environment-variable/language-model members are spies. Prefer
 * `createTestHost` when code only needs the framework plan; use this fixture
 * for a direct `activate(context)` boundary.
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
