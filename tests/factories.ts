import { vi } from 'vitest';
import type * as vscode from 'vscode';
import type { Logger } from '../src/types.js';

/**
 * Creates a mock Logger instance for testing.
 * All methods are vi.fn() mocks that can be asserted against.
 */
export function createMockLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    setLevel: vi.fn(),
    dispose: vi.fn(),
  };
}

/**
 * Creates a mock ExtensionContext for testing.
 */
export function createMockExtensionContext(): {
  subscriptions: vscode.Disposable[];
} {
  return {
    subscriptions: [],
  };
}
