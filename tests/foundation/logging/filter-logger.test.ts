/**
 * `filterLogger`, which an extension's own log-level setting is applied with.
 *
 * VS Code filters a log channel by the level the user picks and gives an
 * extension no way to change it, so a setting of the extension's own can only
 * make the log quieter. These pin what passes at each threshold, that a
 * threshold read from a setting follows it as it changes, and that a threshold
 * which cannot answer hides nothing.
 */
import { describe, expect, it } from 'vitest';

import {
  createLogger,
  filterLogger,
  type LogThreshold,
  type Logger,
} from '../../../src/foundation/logging/logger.js';
import { createRecordingLogSink } from '../../../src/testing/fakes/recording-log-sink.js';

function logEveryLevel(logger: Logger): void {
  logger.trace('t');
  logger.debug('d');
  logger.info('i');
  logger.warn('w');
  logger.error('e');
}

describe('filterLogger', () => {
  it('passes the entries at the threshold and above, and none for silent', () => {
    const thresholds = ['trace', 'debug', 'info', 'warn', 'error', 'silent'] as const;
    const passed = thresholds.map((threshold) => {
      const logs = createRecordingLogSink();
      logEveryLevel(filterLogger(createLogger(logs.sink), threshold));
      return [threshold, logs.entries.map((entry) => entry.level)];
    });

    expect(Object.fromEntries(passed)).toEqual({
      trace: ['trace', 'debug', 'info', 'warn', 'error'],
      debug: ['debug', 'info', 'warn', 'error'],
      info: ['info', 'warn', 'error'],
      warn: ['warn', 'error'],
      error: ['error'],
      silent: [],
    });
  });

  it('hands on the message, fields and error unchanged', () => {
    const logs = createRecordingLogSink();
    const failure = new Error('boom');
    const logger = filterLogger(createLogger(logs.sink, { app: 'sample' }), 'warn');

    logger.warn('slow', { ms: 900 });
    logger.error('failed', failure, { step: 2 });

    expect(logs.entries).toEqual([
      { level: 'warn', message: 'slow', fields: { app: 'sample', ms: 900 } },
      { level: 'error', message: 'failed', fields: { app: 'sample', step: 2 }, error: failure },
    ]);
  });

  it('keeps the threshold in a child from withFields', () => {
    const logs = createRecordingLogSink();
    const child = filterLogger(createLogger(logs.sink), 'warn').withFields({ moduleId: 'm' });

    logEveryLevel(child);

    expect(logs.entries.map((entry) => [entry.level, entry.fields])).toEqual([
      ['warn', { moduleId: 'm' }],
      ['error', { moduleId: 'm' }],
    ]);
  });

  it('reads a threshold function on every entry, so a changed setting applies at once', () => {
    const logs = createRecordingLogSink();
    let setting: LogThreshold = 'error';
    const logger = filterLogger(createLogger(logs.sink), () => setting);
    // Made before the change, as a service holding a child would be.
    const child = logger.withFields({ moduleId: 'm' });

    logger.info('before');
    setting = 'info';
    logger.info('after');
    child.info('child after');

    expect(logs.entries.map((entry) => entry.message)).toEqual(['after', 'child after']);
  });

  it('lets everything through, without throwing, when the threshold cannot be read', () => {
    const logs = createRecordingLogSink();
    const logger = filterLogger(createLogger(logs.sink), () => {
      throw new Error('the settings are gone');
    });

    expect(() => {
      logEveryLevel(logger);
    }).not.toThrow();
    expect(logs.entries).toHaveLength(5);
  });

  it('lets everything through for a threshold that is not one of the six', () => {
    // A value that arrives untyped -- a setting edited by hand, a cast -- must
    // not silence the log by accident, including names every object inherits.
    const values: readonly unknown[] = [
      'verbose',
      'WARN',
      '',
      3,
      undefined,
      'toString',
      '__proto__',
    ];
    const passed = values.map((value) => {
      const logs = createRecordingLogSink();
      logEveryLevel(filterLogger(createLogger(logs.sink), () => value as LogThreshold));
      return logs.entries.length;
    });

    expect(passed).toEqual(values.map(() => 5));
  });
});
