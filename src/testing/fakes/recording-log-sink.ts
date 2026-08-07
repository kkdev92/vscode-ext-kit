/**
 * Lossless in-memory log sink for assertions. Entries are retained by reference
 * exactly as received; unlike the VS Code sink, this does not serialize fields,
 * render stacks, filter levels or redact secrets.
 */
import type { LogEntry, LogSink } from '../../foundation/logging/logger.js';

/** A log sink that keeps everything it receives, for assertions. */
export interface RecordingLogSink {
  /** The sink to pass to the application. */
  readonly sink: LogSink;
  /** Everything recorded so far, in order. */
  readonly entries: readonly LogEntry[];
  /** Entries at one level. */
  at(level: LogEntry['level']): readonly LogEntry[];
  /** Discards recorded entries. */
  clear(): void;
}

/**
 * Creates a recording log sink.
 *
 * @example
 * ```ts
 * const logs = createRecordingLogSink();
 * logs.sink({
 *   level: 'warn',
 *   message: 'using cached data',
 *   fields: { moduleId: 'projects' },
 * });
 * expect(logs.at('warn')).toHaveLength(1);
 * ```
 */
export function createRecordingLogSink(): RecordingLogSink {
  const entries: LogEntry[] = [];

  return {
    sink: (entry) => {
      entries.push(entry);
    },
    get entries(): readonly LogEntry[] {
      return entries;
    },
    at(level: LogEntry['level']): readonly LogEntry[] {
      return entries.filter((entry) => entry.level === level);
    },
    clear(): void {
      entries.length = 0;
    },
  };
}
