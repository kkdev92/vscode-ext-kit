import { vi } from 'vitest';
import type * as vscode from 'vscode';
import type { Logger } from '../src/core/types.js';

/**
 * Creates a mock Logger instance for testing.
 * All methods are vi.fn() mocks that can be asserted against.
 * `child()` returns the same mock so scoped calls stay observable.
 */
export function createMockLogger(): Logger {
  const logger: Logger = {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn((): Logger => logger),
    setLevel: vi.fn(),
    level: 'info',
    dispose: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  };
  return logger;
}

/**
 * Creates a mock ExtensionContext for testing.
 *
 * Only `subscriptions` is backed by a real array; the rest of the interface
 * is intentionally absent and reached through a single cast here, so call
 * sites stay cast-free and type-check against the real `ExtensionContext`.
 */
export function createMockExtensionContext(): vscode.ExtensionContext & {
  subscriptions: vscode.Disposable[];
} {
  const context = { subscriptions: [] as vscode.Disposable[] };
  return context as unknown as vscode.ExtensionContext & {
    subscriptions: vscode.Disposable[];
  };
}
