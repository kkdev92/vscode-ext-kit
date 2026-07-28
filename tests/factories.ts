import { vi } from 'vitest';
import type * as vscode from 'vscode';
import type { Logger } from '../src/core/types.js';
import {
  createMockLogger as createMockLoggerWith,
  createMockExtensionContext as createMockExtensionContextWith,
} from '../src/testing/index.js';

/**
 * Creates a mock Logger instance for testing.
 * All methods are vi.fn() mocks that can be asserted against.
 * `child()` returns the same mock so scoped calls stay observable.
 */
export function createMockLogger(): Logger {
  return createMockLoggerWith(vi);
}

/**
 * Creates a mock ExtensionContext for testing.
 */
export function createMockExtensionContext(): vscode.ExtensionContext {
  return createMockExtensionContextWith(vi);
}
