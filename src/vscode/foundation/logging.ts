/**
 * Final formatting boundary between structured framework logs and VS Code's
 * `LogOutputChannel`. Field enrichment and error association happen before this
 * sink; this file preserves level and renders fields. VS Code owns display-level
 * filtering and persistence for the channel.
 */
import type * as vscode from 'vscode';

import type { LogSink } from '../../foundation/logging/logger.js';

/**
 * Renders log fields as JSON, and never throws while doing it.
 *
 * Plain `JSON.stringify` throws on a circular reference and on a `BigInt`, and
 * propagates whatever a getter on the value throws. The logger swallows a sink
 * exception, so none of that can fail the work that logged — but it does mean
 * the entry is dropped whole, message included, precisely when the state was
 * interesting enough to contain a cycle. A line that says less is far better
 * than one that never appears.
 *
 * So each hazard is handled, and the whole call is guarded as a last resort.
 *
 * One deliberate imprecision: an object reached twice is rendered as
 * `[Circular]` even when the second path is a sibling rather than an ancestor.
 * Tracking true ancestry would need a full walk; for a log line, naming the
 * repeat is enough.
 */
function renderFields(fields: Readonly<Record<string, unknown>>): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(fields, (_key, value: unknown) => {
      if (typeof value === 'bigint') {
        return `${value.toString()}n`;
      }
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      return value;
    });
  } catch {
    return '{"fields":"<unserializable>"}';
  }
}

/**
 * Routes log entries to a `LogOutputChannel`, preserving the framework level so
 * users can rely on VS Code's filtering and persisted log output.
 *
 * Fields are appended as JSON instead of interpolated individually. This keeps
 * one deterministic representation for both humans and tests. Callers must
 * still avoid secrets: formatting at the sink is not redaction.
 *
 * @example
 * ```ts
 * const channel = vscode.window.createOutputChannel('Sample', { log: true });
 * const app = createApplication({ plan, capabilities, logSink: createLogChannelSink(channel) });
 * ```
 */
export function createLogChannelSink(channel: vscode.LogOutputChannel): LogSink {
  return (entry) => {
    const hasFields = Object.keys(entry.fields).length > 0;
    const message = hasFields ? `${entry.message} ${renderFields(entry.fields)}` : entry.message;

    switch (entry.level) {
      case 'trace':
        channel.trace(message);
        return;
      case 'debug':
        channel.debug(message);
        return;
      case 'info':
        channel.info(message);
        return;
      case 'warn':
        channel.warn(message);
        return;
      case 'error':
        // The channel renders an Error with its stack; keep the message as
        // context when the cause is not an Error.
        if (entry.error instanceof Error) {
          channel.error(entry.error, message);
        } else {
          channel.error(message);
        }
        return;
    }
  };
}
