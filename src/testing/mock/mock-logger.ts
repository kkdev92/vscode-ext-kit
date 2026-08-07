/**
 * @packageDocumentation
 * A `Logger` fixture matching this library's own `Logger` type. Lives apart
 * from the other mock factories so it can type against `../logging/logger.js`
 * without dragging the main project into the mock kit's project graph.
 */
import type { Logger } from '../../foundation/logging/logger.js';
import type { MockFrameworkLike } from './mock-types.js';

/**
 * Creates a mock {@link Logger} for interaction tests. Every method is a mock
 * function that can be asserted against; `withFields()` returns the same mock
 * so scoped calls stay observable through the parent.
 *
 * Because fields are not accumulated, this fixture cannot prove structured-log
 * enrichment. Use `createRecordingLogSink` with the real logger pipeline when
 * field merging, levels or error entries are the behavior under test.
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
    withFields: fn((): Logger => logger),
  };
  return logger;
}
