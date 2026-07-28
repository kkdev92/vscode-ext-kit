import * as vscode from 'vscode';
import type { Logger, LoggerOptions, LogLevel } from './types.js';

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  silent: 5,
};

const LOG_LEVEL_PREFIX: Record<Exclude<LogLevel, 'silent'>, string> = {
  trace: 'TRACE',
  debug: 'DEBUG',
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
};

/**
 * Renders a non-Error thrown value as a message. `String(value)` throws for
 * null-prototype objects and symbols, and yields a useless `[object Object]`
 * for plain objects, so both cases fall back to JSON.
 */
function stringifyErrorInput(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined || typeof value !== 'object') {
    try {
      return String(value);
    } catch {
      return safeStringify(value);
    }
  }
  const asString = Object.prototype.toString.call(value);
  return asString === '[object Object]' ? safeStringify(value) : asString;
}

/** Circular-safe JSON serialization for structured log fields. */
function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(value, (_key, v: unknown) => {
      if (typeof v === 'object' && v !== null) {
        if (seen.has(v)) return '[Circular]';
        seen.add(v);
      }
      if (typeof v === 'bigint') return v.toString();
      if (v instanceof Error) return { name: v.name, message: v.message, stack: v.stack };
      return v;
    });
  } catch {
    return '[Unserializable]';
  }
}

/**
 * Creates a logger backed by a VS Code output channel.
 *
 * By default this uses a {@link vscode.LogOutputChannel} (`channelMode: 'log'`),
 * so timestamps, level colors, the Output panel level dropdown and
 * `Developer: Set Log Level` all work natively, and the library-side level
 * gate defaults to pass-through (`'trace'`). Use `channelMode: 'plain'` when
 * the extension must control visibility itself (e.g. a "collect verbose
 * logs" support command).
 *
 * @param name - Channel name shown in the Output panel
 * @param opts - Logger options
 *
 * @example
 * ```typescript
 * const logger = createLogger('MyExtension');
 * context.subscriptions.push(logger);
 *
 * logger.info('activated', { workspaceFolders: 2 });
 * logger.error(new Error('sync failed'), { retry: 3 });
 *
 * const gitLogger = logger.child('git');
 * gitLogger.debug('spawn', { args: ['status'] }); // → [git] spawn {"args":["status"]}
 * ```
 */
export function createLogger(name: string, opts: LoggerOptions = {}): Logger {
  const {
    level: initialLevel,
    configSection,
    channelMode = 'log',
    showOnError = true,
    showOnErrorThrottleMs = 0,
    telemetry,
  } = opts;

  const isLogMode = channelMode === 'log';
  const defaultLevel: LogLevel = initialLevel ?? (isLogMode ? 'trace' : 'info');

  const channel = isLogMode
    ? vscode.window.createOutputChannel(name, { log: true })
    : vscode.window.createOutputChannel(name);

  const telemetryLogger = telemetry ? vscode.env.createTelemetryLogger(telemetry) : undefined;

  const readConfiguredLevel = (): LogLevel =>
    (configSection
      ? vscode.workspace.getConfiguration().get<LogLevel>(configSection)
      : undefined) ?? defaultLevel;

  // Mutable state shared by the root logger and all children.
  const state = {
    level: readConfiguredLevel(),
    lastShownAt: Number.NEGATIVE_INFINITY,
    disposed: false,
  };

  const configListener = configSection
    ? vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration(configSection)) {
          state.level = readConfiguredLevel();
        }
      })
    : undefined;

  const shouldLog = (level: Exclude<LogLevel, 'silent'>): boolean =>
    LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[state.level];

  function emit(
    level: Exclude<LogLevel, 'silent'>,
    scope: string | undefined,
    message: string,
    fields?: Record<string, unknown>
  ): void {
    const scoped = scope ? `[${scope}] ${message}` : message;
    const line = fields ? `${scoped} ${safeStringify(fields)}` : scoped;
    if (isLogMode) {
      (channel as vscode.LogOutputChannel)[level](line);
    } else {
      channel.appendLine(`[${LOG_LEVEL_PREFIX[level]}] [${new Date().toISOString()}] ${line}`);
    }
  }

  function makeLogger(scope: string | undefined, isRoot: boolean): Logger {
    const logger: Logger = {
      trace(message, fields) {
        if (shouldLog('trace')) emit('trace', scope, message, fields);
      },
      debug(message, fields) {
        if (shouldLog('debug')) emit('debug', scope, message, fields);
      },
      info(message, fields) {
        if (shouldLog('info')) emit('info', scope, message, fields);
      },
      warn(message, fields) {
        if (shouldLog('warn')) emit('warn', scope, message, fields);
      },
      error(input, fields) {
        if (!shouldLog('error')) return;
        // `input` is `unknown` so a `catch` binding can be passed straight in:
        // Errors keep their stack, everything else is stringified.
        const error = input instanceof Error ? input : undefined;
        const message = error ? error.message : stringifyErrorInput(input);
        const text = error?.stack ? `${message}\n${error.stack}` : message;
        emit('error', scope, text, fields);

        if (showOnError) {
          const now = Date.now();
          if (showOnErrorThrottleMs <= 0 || now - state.lastShownAt >= showOnErrorThrottleMs) {
            channel.show(true);
            state.lastShownAt = now;
          }
        }

        telemetryLogger?.logError(error ?? new Error(message), {
          ...fields,
          ...(scope ? { scope } : undefined),
        });
      },
      child(childScope: string): Logger {
        return makeLogger(scope ? `${scope}:${childScope}` : childScope, false);
      },
      setLevel(level: LogLevel): void {
        state.level = level;
      },
      get level(): LogLevel {
        return state.level;
      },
      dispose(): void {
        // Children never own the channel; only the root tears down.
        if (!isRoot || state.disposed) return;
        state.disposed = true;
        configListener?.dispose();
        telemetryLogger?.dispose();
        channel.dispose();
      },
      [Symbol.dispose](): void {
        logger.dispose();
      },
    };
    return logger;
  }

  return makeLogger(undefined, true);
}
