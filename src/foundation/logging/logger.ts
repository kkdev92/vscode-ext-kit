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
 * How much a logger from {@link filterLogger} passes on: the entries at this
 * level and above, or none at all for `silent`.
 */
export type LogThreshold = LogEntry['level'] | 'silent';

const RANK: Readonly<Record<LogThreshold, number>> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  silent: 5,
};

/**
 * A logger that passes on to `logger` only the entries at `threshold` or above,
 * and none at all when it is `silent`.
 *
 * This is for an extension's own log-level setting. VS Code filters a log
 * channel by the level the user picks, with `Developer: Set Log Level` or in
 * the Output panel, and the API gives an extension no way to change that
 * level. A setting of the extension's own can therefore only make the log
 * quieter than the channel already is, and this is how it does.
 *
 * `threshold` may be a function, read on every entry, so that a logger made
 * once — by a service when it is constructed, say — follows the setting as it
 * changes. A threshold that throws, or that is not one of the six, lets every
 * entry through: a broken filter must not hide the log, and logging must not
 * fail the work that logged. Children from `withFields` keep the threshold.
 *
 * @example
 * ```ts
 * module.services.singleton(Renderer, {
 *   inject: { log: Log, settings: Settings.token },
 *   create: ({ log, settings }) =>
 *     new Renderer(filterLogger(log, () => settings.read().values.logLevel)),
 * });
 * ```
 */
export function filterLogger(
  logger: Logger,
  threshold: LogThreshold | (() => LogThreshold)
): Logger {
  const read = typeof threshold === 'function' ? threshold : (): LogThreshold => threshold;
  const passes = (level: LogEntry['level']): boolean => {
    let floor: number | undefined;
    try {
      const current: unknown = read();
      floor =
        typeof current === 'string' && Object.hasOwn(RANK, current)
          ? RANK[current as LogThreshold]
          : undefined;
    } catch {
      return true;
    }
    return floor === undefined || RANK[level] >= floor;
  };

  return {
    trace: (message, fields) => {
      if (passes('trace')) {
        logger.trace(message, fields);
      }
    },
    debug: (message, fields) => {
      if (passes('debug')) {
        logger.debug(message, fields);
      }
    },
    info: (message, fields) => {
      if (passes('info')) {
        logger.info(message, fields);
      }
    },
    warn: (message, fields) => {
      if (passes('warn')) {
        logger.warn(message, fields);
      }
    },
    error: (message, error, fields) => {
      if (passes('error')) {
        logger.error(message, error, fields);
      }
    },
    withFields: (fields) => filterLogger(logger.withFields(fields), read),
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
