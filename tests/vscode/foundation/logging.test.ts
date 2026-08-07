/**
 * Formatting boundary between structured log entries and a `LogOutputChannel`.
 * It protects level routing, field rendering and — the reason this suite
 * exists — that no shape of field can make a log line disappear. Channel
 * behaviour itself belongs to VS Code.
 */
import { describe, expect, it, vi } from 'vitest';

import type { LogEntry } from '../../../src/foundation/logging/logger.js';
import { createLogChannelSink } from '../../../src/vscode/foundation/logging.js';

function createChannel() {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

/** The sink only reads these five members of a `LogOutputChannel`. */
const sinkFor = (channel: ReturnType<typeof createChannel>) =>
  createLogChannelSink(channel as unknown as Parameters<typeof createLogChannelSink>[0]);

const entry = (fields: LogEntry['fields']): LogEntry => ({
  level: 'info',
  message: 'refreshed',
  fields,
});

describe('createLogChannelSink', () => {
  it('appends fields as JSON, and omits the suffix when there are none', () => {
    const channel = createChannel();
    const sink = sinkFor(channel);

    sink(entry({ count: 3 }));
    sink(entry({}));

    expect(channel.info).toHaveBeenNthCalledWith(1, 'refreshed {"count":3}');
    expect(channel.info).toHaveBeenNthCalledWith(2, 'refreshed');
  });

  it('routes each level to the matching channel method', () => {
    const channel = createChannel();
    const sink = sinkFor(channel);

    for (const level of ['trace', 'debug', 'info', 'warn'] as const) {
      sink({ ...entry({}), level });
    }

    expect(channel.trace).toHaveBeenCalledTimes(1);
    expect(channel.debug).toHaveBeenCalledTimes(1);
    expect(channel.warn).toHaveBeenCalledTimes(1);
  });

  it('gives the channel the Error itself, so it can render a stack', () => {
    const channel = createChannel();
    const failure = new Error('boom');

    sinkFor(channel)({ level: 'error', message: 'failed', fields: {}, error: failure });

    expect(channel.error).toHaveBeenCalledWith(failure, 'failed');
  });

  /**
   * The logger swallows a sink exception, so a `JSON.stringify` that throws
   * cannot fail the work that logged. What it does instead is drop the entry
   * whole — message included — exactly when the state was interesting enough to
   * contain a cycle. These fields all make plain `JSON.stringify` throw.
   */
  describe('a field JSON cannot represent', () => {
    it('does not take the log line with it', () => {
      const channel = createChannel();
      const sink = sinkFor(channel);

      const cyclic: Record<string, unknown> = { name: 'root' };
      cyclic['self'] = cyclic;
      sink(entry({ cyclic }));

      const [message] = channel.info.mock.calls[0] ?? [];
      expect(message).toContain('refreshed');
      expect(message).toContain('"name":"root"');
      expect(message).toContain('[Circular]');
    });

    it('renders a bigint rather than failing on it', () => {
      const channel = createChannel();

      sinkFor(channel)(entry({ size: 9007199254740993n }));

      expect(channel.info).toHaveBeenCalledWith('refreshed {"size":"9007199254740993n"}');
    });

    it('survives a getter that throws', () => {
      const channel = createChannel();
      const hostile = {
        get boom(): never {
          throw new Error('do not read me');
        },
      };

      sinkFor(channel)(entry({ hostile }));

      // The fields are lost, which is the point: the line still arrives.
      expect(channel.info).toHaveBeenCalledWith('refreshed {"fields":"<unserializable>"}');
    });
  });
});
