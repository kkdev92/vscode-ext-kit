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

function formatArgs(args: unknown[]): string {
  if (args.length === 0) return '';
  return (
    ' ' +
    args
      .map((arg) => {
        if (arg instanceof Error) {
          return `\n${arg.stack ?? arg.message}`;
        }
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      })
      .join(' ')
  );
}

function formatTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Creates a logger instance using VS Code's OutputChannel.
 * Log level filtering is handled internally by vscode-ext-kit,
 * giving full control over which messages are displayed.
 *
 * @param extensionName - Name of the extension (displayed in Output panel)
 * @param opts - Logger options
 * @returns Logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger('MyExtension', { level: 'debug' });
 * logger.info('Extension activated');
 * logger.error('Something failed', new Error('details'));
 * context.subscriptions.push(logger);
 * ```
 */
export function createLogger(extensionName: string, opts: LoggerOptions = {}): Logger {
  const {
    level: initialLevel = 'info',
    configSection,
    showOnError = true,
    timestamp = true,
    telemetryReporter,
  } = opts;

  const channel = vscode.window.createOutputChannel(extensionName);

  // Read initial level from VSCode config if configSection is provided
  let currentLevel: LogLevel = configSection
    ? (vscode.workspace.getConfiguration().get<LogLevel>(configSection) ?? initialLevel)
    : initialLevel;

  // Watch for config changes
  let configListener: vscode.Disposable | undefined;
  if (configSection) {
    configListener = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(configSection)) {
        currentLevel =
          vscode.workspace.getConfiguration().get<LogLevel>(configSection) ?? initialLevel;
      }
    });
  }

  const shouldLog = (level: LogLevel): boolean => {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLevel];
  };

  const formatMessage = (message: string): string => {
    if (timestamp) {
      return `[${formatTimestamp()}] ${message}`;
    }
    return message;
  };

  return {
    trace(message: string, ...args: unknown[]): void {
      if (shouldLog('trace')) {
        channel.appendLine(
          `[${LOG_LEVEL_PREFIX.trace}] ${formatMessage(message)}${formatArgs(args)}`
        );
      }
    },

    debug(message: string, ...args: unknown[]): void {
      if (shouldLog('debug')) {
        channel.appendLine(
          `[${LOG_LEVEL_PREFIX.debug}] ${formatMessage(message)}${formatArgs(args)}`
        );
      }
    },

    info(message: string, ...args: unknown[]): void {
      if (shouldLog('info')) {
        channel.appendLine(
          `[${LOG_LEVEL_PREFIX.info}] ${formatMessage(message)}${formatArgs(args)}`
        );
      }
    },

    warn(message: string, ...args: unknown[]): void {
      if (shouldLog('warn')) {
        channel.appendLine(
          `[${LOG_LEVEL_PREFIX.warn}] ${formatMessage(message)}${formatArgs(args)}`
        );
      }
    },

    error(message: string | Error, ...args: unknown[]): void {
      if (shouldLog('error')) {
        const errorMessage = message instanceof Error ? message.message : message;
        const errorArgs = message instanceof Error ? [message, ...args] : args;
        channel.appendLine(
          `[${LOG_LEVEL_PREFIX.error}] ${formatMessage(errorMessage)}${formatArgs(errorArgs)}`
        );
        if (showOnError) {
          channel.show(true);
        }
        // Send telemetry if reporter is configured
        if (telemetryReporter) {
          const properties: Record<string, string> = {
            message: errorMessage,
          };
          const firstError =
            message instanceof Error ? message : args.find((a) => a instanceof Error);
          if (firstError instanceof Error) {
            properties['errorMessage'] = firstError.message;
            properties['errorName'] = firstError.name;
            if (firstError.stack) {
              properties['errorStack'] = firstError.stack;
            }
          }
          telemetryReporter.sendTelemetryErrorEvent('error', properties);
        }
      }
    },

    setLevel(level: LogLevel): void {
      currentLevel = level;
    },

    dispose(): void {
      configListener?.dispose();
      channel.dispose();
    },
  };
}
