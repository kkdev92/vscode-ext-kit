import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { createLogger } from '../../src/core/logger.js';

type Mock = ReturnType<typeof vi.fn>;

interface ChannelMock {
  trace: Mock;
  debug: Mock;
  info: Mock;
  warn: Mock;
  error: Mock;
  appendLine: Mock;
  show: Mock;
  dispose: Mock;
}

/** Returns the channel produced by the most recent createOutputChannel call. */
function lastChannel(): ChannelMock {
  const results = vi.mocked(vscode.window.createOutputChannel).mock.results;
  return results[results.length - 1]!.value as unknown as ChannelMock;
}

describe('createLogger — log mode (default)', () => {
  it('creates a LogOutputChannel', () => {
    createLogger('TestExtension');

    expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('TestExtension', {
      log: true,
    });
  });

  it('delegates each level to the channel without manual prefixes', () => {
    const logger = createLogger('Test');
    const channel = lastChannel();

    logger.trace('t');
    logger.debug('d');
    logger.info('i');
    logger.warn('w');
    logger.error('e');

    expect(channel.trace).toHaveBeenCalledWith('t');
    expect(channel.debug).toHaveBeenCalledWith('d');
    expect(channel.info).toHaveBeenCalledWith('i');
    expect(channel.warn).toHaveBeenCalledWith('w');
    expect(channel.error).toHaveBeenCalledWith('e');
    expect(channel.appendLine).not.toHaveBeenCalled();
  });

  it('defaults to pass-through (trace) so the Output panel does the filtering', () => {
    const logger = createLogger('Test');
    const channel = lastChannel();

    logger.trace('visible');

    expect(channel.trace).toHaveBeenCalledWith('visible');
  });

  it('applies an explicit level gate on top of the channel', () => {
    const logger = createLogger('Test', { level: 'warn' });
    const channel = lastChannel();

    logger.info('hidden');
    logger.warn('shown');

    expect(channel.info).not.toHaveBeenCalled();
    expect(channel.warn).toHaveBeenCalledWith('shown');
  });

  it('serializes structured fields as JSON', () => {
    const logger = createLogger('Test');
    const channel = lastChannel();

    logger.info('sync done', { files: 3, ok: true });

    expect(channel.info).toHaveBeenCalledWith('sync done {"files":3,"ok":true}');
  });

  it('survives circular fields', () => {
    const logger = createLogger('Test');
    const channel = lastChannel();
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;

    logger.info('msg', circular);

    expect(channel.info).toHaveBeenCalledWith(expect.stringContaining('[Circular]'));
  });

  it('logs Error objects with their stack', () => {
    const logger = createLogger('Test');
    const channel = lastChannel();
    const error = new Error('kaboom');

    logger.error(error);

    const logged = channel.error.mock.calls[0]![0] as string;
    expect(logged).toContain('kaboom');
    expect(logged).toContain(error.stack!.split('\n')[1]!.trim());
  });

  describe('error() accepts unknown', () => {
    // `error()` takes `unknown` so a `catch (error)` binding needs no
    // normalization at the call site; these cover what non-Error values render as.
    it('passes a string through unchanged', () => {
      const logger = createLogger('Test');
      const channel = lastChannel();

      logger.error('plain string');

      expect(channel.error).toHaveBeenCalledWith('plain string');
    });

    it.each([
      ['a number', 42, '42'],
      ['a boolean', false, 'false'],
      ['null', null, 'null'],
      ['undefined', undefined, 'undefined'],
      ['a bigint', 7n, '7'],
    ])('stringifies %s', (_label, input, expected) => {
      const logger = createLogger('Test');
      const channel = lastChannel();

      logger.error(input);

      expect(channel.error).toHaveBeenCalledWith(expected);
    });

    it('stringifies a symbol without throwing', () => {
      const logger = createLogger('Test');
      const channel = lastChannel();

      logger.error(Symbol('boom'));

      expect(channel.error).toHaveBeenCalledWith('Symbol(boom)');
    });

    it('serializes a plain object as JSON instead of [object Object]', () => {
      const logger = createLogger('Test');
      const channel = lastChannel();

      logger.error({ code: 'ENOENT', path: '/tmp/x' });

      expect(channel.error).toHaveBeenCalledWith('{"code":"ENOENT","path":"/tmp/x"}');
    });

    it('serializes a null-prototype object without throwing', () => {
      const logger = createLogger('Test');
      const channel = lastChannel();
      const bare = Object.create(null) as Record<string, unknown>;
      bare['reason'] = 'no prototype';

      // `String(bare)` would throw "Cannot convert object to primitive value".
      expect(() => logger.error(bare)).not.toThrow();
      expect(channel.error).toHaveBeenCalledWith('{"reason":"no prototype"}');
    });

    it('uses the type tag for non-plain objects', () => {
      const logger = createLogger('Test');
      const channel = lastChannel();

      logger.error([1, 2]);

      expect(channel.error).toHaveBeenCalledWith('[object Array]');
    });

    it('reports a non-Error value to telemetry wrapped in an Error', () => {
      const sender: vscode.TelemetrySender = { sendEventData: vi.fn(), sendErrorData: vi.fn() };
      const logger = createLogger('Test', { telemetry: sender });

      logger.error(404);

      const results = vi.mocked(vscode.env.createTelemetryLogger).mock.results;
      const telemetry = results[results.length - 1]!.value as unknown as {
        logError: ReturnType<typeof vi.fn>;
      };
      const [reported] = telemetry.logError.mock.calls[0]!;
      expect(reported).toBeInstanceOf(Error);
      expect((reported as Error).message).toBe('404');
    });
  });

  it('silent level suppresses everything', () => {
    const logger = createLogger('Test', { level: 'silent' });
    const channel = lastChannel();

    logger.error('nope');

    expect(channel.error).not.toHaveBeenCalled();
    expect(channel.show).not.toHaveBeenCalled();
  });
});

describe('createLogger — plain mode', () => {
  it('creates a regular OutputChannel', () => {
    createLogger('Test', { channelMode: 'plain' });

    expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('Test');
  });

  it('formats level prefix and ISO timestamp manually', () => {
    const logger = createLogger('Test', { channelMode: 'plain', level: 'info' });
    const channel = lastChannel();

    logger.info('hello');

    expect(channel.appendLine).toHaveBeenCalledWith(
      expect.stringMatching(/^\[INFO\] \[\d{4}-\d{2}-\d{2}T[\d:.]+Z\] hello$/)
    );
  });

  it('defaults the gate to info', () => {
    const logger = createLogger('Test', { channelMode: 'plain' });
    const channel = lastChannel();

    logger.debug('hidden');
    logger.info('shown');

    expect(channel.appendLine).toHaveBeenCalledTimes(1);
    expect(channel.appendLine).toHaveBeenCalledWith(expect.stringContaining('shown'));
  });
});

describe('child loggers', () => {
  it('prefixes messages with the scope', () => {
    const logger = createLogger('Test');
    const channel = lastChannel();

    logger.child('git').info('status');

    expect(channel.info).toHaveBeenCalledWith('[git] status');
  });

  it('composes nested scopes with a colon', () => {
    const logger = createLogger('Test');
    const channel = lastChannel();

    logger.child('sync').child('push').debug('go');

    expect(channel.debug).toHaveBeenCalledWith('[sync:push] go');
  });

  it('shares the level state with the root', () => {
    const logger = createLogger('Test');
    const channel = lastChannel();
    const child = logger.child('scope');

    logger.setLevel('error');
    child.info('hidden');
    expect(channel.info).not.toHaveBeenCalled();

    child.setLevel('info');
    logger.info('now visible');
    expect(channel.info).toHaveBeenCalledWith('now visible');
  });

  it('child dispose is a no-op; only the root disposes the channel', () => {
    const logger = createLogger('Test');
    const channel = lastChannel();

    logger.child('scope').dispose();
    expect(channel.dispose).not.toHaveBeenCalled();

    logger.dispose();
    expect(channel.dispose).toHaveBeenCalledTimes(1);
  });
});

describe('setLevel / level', () => {
  it('exposes the current level and updates dynamically', () => {
    const logger = createLogger('Test', { level: 'info' });
    const channel = lastChannel();

    expect(logger.level).toBe('info');

    logger.setLevel('error');
    expect(logger.level).toBe('error');

    logger.warn('hidden');
    expect(channel.warn).not.toHaveBeenCalled();
  });
});

describe('showOnError', () => {
  it('shows the channel on error by default', () => {
    const logger = createLogger('Test');
    const channel = lastChannel();

    logger.error('boom');

    expect(channel.show).toHaveBeenCalledWith(true);
  });

  it('does not show when disabled', () => {
    const logger = createLogger('Test', { showOnError: false });
    const channel = lastChannel();

    logger.error('boom');

    expect(channel.show).not.toHaveBeenCalled();
  });

  it('throttles repeated shows within the window', () => {
    vi.useFakeTimers();
    try {
      const logger = createLogger('Test', { showOnErrorThrottleMs: 5000 });
      const channel = lastChannel();

      logger.error('first');
      logger.error('second');
      expect(channel.show).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(5000);
      logger.error('third');
      expect(channel.show).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('configSection', () => {
  it('reads the initial level from configuration', () => {
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({
      get: vi.fn(() => 'error'),
    } as never);

    const logger = createLogger('Test', { configSection: 'myExt.logLevel' });

    expect(logger.level).toBe('error');
  });

  it('follows configuration changes', () => {
    const getMock = vi.fn(() => 'info');
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: getMock } as never);

    const logger = createLogger('Test', { configSection: 'myExt.logLevel' });
    expect(logger.level).toBe('info');

    getMock.mockReturnValue('debug');
    const listener = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls[0]![0];
    listener({ affectsConfiguration: (section: string) => section === 'myExt.logLevel' } as never);

    expect(logger.level).toBe('debug');
  });

  it('ignores unrelated configuration changes', () => {
    const getMock = vi.fn(() => 'info');
    vi.mocked(vscode.workspace.getConfiguration).mockReturnValue({ get: getMock } as never);

    const logger = createLogger('Test', { configSection: 'myExt.logLevel' });

    getMock.mockReturnValue('debug');
    const listener = vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls[0]![0];
    listener({ affectsConfiguration: () => false } as never);

    expect(logger.level).toBe('info');
  });
});

describe('telemetry', () => {
  function createSender(): vscode.TelemetrySender {
    return { sendEventData: vi.fn(), sendErrorData: vi.fn() };
  }

  function lastTelemetryLogger(): { logError: Mock; dispose: Mock } {
    const results = vi.mocked(vscode.env.createTelemetryLogger).mock.results;
    return results[results.length - 1]!.value as unknown as { logError: Mock; dispose: Mock };
  }

  it('wraps the sender with the native TelemetryLogger', () => {
    const sender = createSender();

    createLogger('Test', { telemetry: sender });

    expect(vscode.env.createTelemetryLogger).toHaveBeenCalledWith(sender);
  });

  it('reports errors through logError with fields and scope', () => {
    const sender = createSender();
    const logger = createLogger('Test', { telemetry: sender });
    const error = new Error('boom');

    logger.child('sync').error(error, { attempt: 2 });

    expect(lastTelemetryLogger().logError).toHaveBeenCalledWith(error, {
      attempt: 2,
      scope: 'sync',
    });
  });

  it('wraps string errors in an Error for telemetry', () => {
    const logger = createLogger('Test', { telemetry: createSender() });

    logger.error('plain message');

    const [reported] = lastTelemetryLogger().logError.mock.calls[0]!;
    expect(reported).toBeInstanceOf(Error);
    expect((reported as Error).message).toBe('plain message');
  });

  it('does not report below-error levels to telemetry', () => {
    const logger = createLogger('Test', { telemetry: createSender() });

    logger.warn('just a warning');

    expect(lastTelemetryLogger().logError).not.toHaveBeenCalled();
  });

  it('disposes the telemetry logger with the logger', () => {
    const logger = createLogger('Test', { telemetry: createSender() });

    logger.dispose();

    expect(lastTelemetryLogger().dispose).toHaveBeenCalledTimes(1);
  });
});

describe('dispose', () => {
  it('disposes the channel and config listener once', () => {
    const configDispose = vi.fn();
    vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({
      dispose: configDispose,
    } as never);

    const logger = createLogger('Test', { configSection: 'x.y' });
    const channel = lastChannel();

    logger.dispose();
    logger.dispose();

    expect(channel.dispose).toHaveBeenCalledTimes(1);
    expect(configDispose).toHaveBeenCalledTimes(1);
  });

  it('supports Symbol.dispose (using)', () => {
    const logger = createLogger('Test');
    const channel = lastChannel();

    logger[Symbol.dispose]();

    expect(channel.dispose).toHaveBeenCalledTimes(1);
  });
});
