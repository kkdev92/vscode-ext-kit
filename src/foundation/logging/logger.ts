/** Structured, sink-defined fields attached to a log entry. */
export interface LogFields {
  readonly [key: string]: unknown;
}

/**
 * Structured logger.
 *
 * There is no ambient/current logger: a logger is always passed explicitly, and
 * `withFields` returns an immutable child rather than mutating shared state.
 * Per-call fields override fields inherited from the logger. Logging is
 * best-effort: a throwing sink is isolated from the work being logged.
 *
 * @example
 * ```ts
 * const scoped = logger.withFields({ moduleId: 'projects' });
 * scoped.info('refreshed', { updated: 3 });
 * ```
 */
export interface Logger {
  trace(message: string, fields?: LogFields): void;
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, error?: unknown, fields?: LogFields): void;
  /** Returns an immutable child logger with `fields` merged into every entry. */
  withFields(fields: LogFields): Logger;
}

/** One entry as handed to a {@link LogSink}. */
export interface LogEntry {
  readonly level: 'trace' | 'debug' | 'info' | 'warn' | 'error';
  readonly message: string;
  readonly fields: LogFields;
  readonly error?: unknown;
}

/**
 * Receives log entries synchronously. Exceptions are swallowed by the Logger;
 * a sink must not be used as a control-flow or delivery-guaranteed channel.
 */
export type LogSink = (entry: LogEntry) => void;

/**
 * Creates a logger that forwards entries to a sink.
 *
 * @example
 * ```ts
 * const entries: LogEntry[] = [];
 * const logger = createLogger((entry) => entries.push(entry));
 * ```
 */
export function createLogger(sink: LogSink, fields: LogFields = {}): Logger {
  const emit = (
    level: LogEntry['level'],
    message: string,
    extra: LogFields | undefined,
    error?: unknown
  ): void => {
    const merged: LogFields = extra === undefined ? fields : { ...fields, ...extra };
    try {
      sink({ level, message, fields: merged, ...(error === undefined ? {} : { error }) });
    } catch {
      // Observability must never interfere: a broken (or already-disposed)
      // sink cannot be allowed to fail the work that merely tried to log.
    }
  };

  return {
    trace: (message, extra) => emit('trace', message, extra),
    debug: (message, extra) => emit('debug', message, extra),
    info: (message, extra) => emit('info', message, extra),
    warn: (message, extra) => emit('warn', message, extra),
    error: (message, error, extra) => emit('error', message, extra, error),
    withFields: (extra) => createLogger(sink, { ...fields, ...extra }),
  };
}

/**
 * A logger that discards everything. The default when no sink is configured, so
 * the framework never needs a `console` fallback.
 *
 * @example
 * ```ts
 * const logger = createNoopLogger();
 * logger.info('safe even without a configured sink');
 * ```
 */
export function createNoopLogger(): Logger {
  const noop = (): void => undefined;
  const logger: Logger = {
    trace: noop,
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    withFields: () => logger,
  };
  return logger;
}
