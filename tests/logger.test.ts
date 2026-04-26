import * as os from 'node:os';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { createLogger } from '../src/logger.js';

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createLogger', () => {
    it('should create a logger with OutputChannel', () => {
      const logger = createLogger('TestExtension');

      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('TestExtension');
      expect(logger).toBeDefined();
      expect(typeof logger.trace).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.dispose).toBe('function');
    });

    it('should log trace messages when level is trace', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'trace' });
      logger.trace('Trace message');

      expect(mockChannel.appendLine).toHaveBeenCalledWith(
        expect.stringMatching(/\[TRACE\].*Trace message/)
      );
    });

    it('should not log trace messages when level is debug', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'debug' });
      logger.trace('Trace message');

      expect(mockChannel.appendLine).not.toHaveBeenCalled();
    });

    it('should log info messages when level is info or lower', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'info' });
      logger.info('Test message');

      expect(mockChannel.appendLine).toHaveBeenCalledWith(
        expect.stringMatching(/\[INFO\].*Test message/)
      );
    });

    it('should not log debug messages when level is info', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'info' });
      logger.debug('Debug message');

      expect(mockChannel.appendLine).not.toHaveBeenCalled();
    });

    it('should log debug messages when level is debug', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'debug' });
      logger.debug('Debug message');

      expect(mockChannel.appendLine).toHaveBeenCalledWith(
        expect.stringMatching(/\[DEBUG\].*Debug message/)
      );
    });

    it('should log warn messages', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'info' });
      logger.warn('Warning message');

      expect(mockChannel.appendLine).toHaveBeenCalledWith(
        expect.stringMatching(/\[WARN\].*Warning message/)
      );
    });

    it('should show output channel on error when showOnError is true', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { showOnError: true });
      logger.error('Error message');

      expect(mockChannel.appendLine).toHaveBeenCalledWith(
        expect.stringMatching(/\[ERROR\].*Error message/)
      );
      expect(mockChannel.show).toHaveBeenCalledWith(true);
    });

    it('should not show output channel on error when showOnError is false', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { showOnError: false });
      logger.error('Error message');

      expect(mockChannel.appendLine).toHaveBeenCalledWith(
        expect.stringMatching(/\[ERROR\].*Error message/)
      );
      expect(mockChannel.show).not.toHaveBeenCalled();
    });

    it('should include timestamp when timestamp option is true', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { timestamp: true });
      logger.info('Test message');

      expect(mockChannel.appendLine).toHaveBeenCalledWith(
        expect.stringMatching(/\[INFO\] \[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\] Test message/)
      );
    });

    it('should not include timestamp when timestamp option is false', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { timestamp: false });
      logger.info('Test message');

      expect(mockChannel.appendLine).toHaveBeenCalledWith('[INFO] Test message');
    });

    it('should format Error objects with stack trace', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { timestamp: false });
      const error = new Error('Test error');
      logger.error('Operation failed', error);

      expect(mockChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'));
      expect(mockChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Operation failed'));
      expect(mockChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Test error'));
    });

    it('should format object meta as JSON', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { timestamp: false });
      const meta = { key: 'value', num: 42 };
      logger.info('Test message', meta);

      expect(mockChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('[INFO]'));
      expect(mockChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('"key": "value"'));
    });

    it('should handle multiple arguments', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { timestamp: false });
      logger.info('Test message', 'arg1', 42, { key: 'value' });

      expect(mockChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('[INFO]'));
      expect(mockChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Test message'));
      expect(mockChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('arg1'));
      expect(mockChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('42'));
    });

    it('should handle Error object as first argument to error()', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { timestamp: false });
      const error = new Error('Direct error');
      logger.error(error);

      expect(mockChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('[ERROR]'));
      expect(mockChannel.appendLine).toHaveBeenCalledWith(expect.stringContaining('Direct error'));
    });
  });

  describe('setLevel', () => {
    it('should change log level dynamically', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'info' });

      // Initially, debug should not be logged
      logger.debug('Debug 1');
      expect(mockChannel.appendLine).not.toHaveBeenCalled();

      // Change level to debug
      logger.setLevel('debug');
      logger.debug('Debug 2');
      expect(mockChannel.appendLine).toHaveBeenCalledWith(
        expect.stringMatching(/\[DEBUG\].*Debug 2/)
      );
    });

    it('should suppress all logs when level is silent', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'info' });
      logger.setLevel('silent');

      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warn');
      logger.error('Error');

      expect(mockChannel.appendLine).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should dispose the output channel', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension');
      logger.dispose();

      expect(mockChannel.dispose).toHaveBeenCalled();
    });
  });

  describe('configSection', () => {
    it('should read initial level from VSCode config', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      // Mock getConfiguration to return config with 'debug' level
      const mockConfig = {
        get: vi.fn().mockReturnValue('debug'),
        has: vi.fn(),
        inspect: vi.fn(),
        update: vi.fn(),
      };
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as unknown as vscode.WorkspaceConfiguration);

      const logger = createLogger('TestExtension', {
        level: 'info', // fallback
        configSection: 'myExtension.logLevel',
      });

      // Should log debug because config returns 'debug'
      logger.debug('Debug message');
      expect(mockChannel.appendLine).toHaveBeenCalledWith(
        expect.stringMatching(/\[DEBUG\].*Debug message/)
      );
    });

    it('should use fallback level when config returns undefined', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      // Mock getConfiguration to return undefined
      const mockConfig = {
        get: vi.fn().mockReturnValue(undefined),
        has: vi.fn(),
        inspect: vi.fn(),
        update: vi.fn(),
      };
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as unknown as vscode.WorkspaceConfiguration);

      const logger = createLogger('TestExtension', {
        level: 'info', // fallback
        configSection: 'myExtension.logLevel',
      });

      // Should not log debug because fallback is 'info'
      logger.debug('Debug message');
      expect(mockChannel.appendLine).not.toHaveBeenCalled();
    });

    it('should register config change listener', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      createLogger('TestExtension', {
        configSection: 'myExtension.logLevel',
      });

      expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalled();
    });

    it('should not register config change listener without configSection', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      vi.mocked(vscode.workspace.onDidChangeConfiguration).mockClear();

      createLogger('TestExtension', { level: 'info' });

      expect(vscode.workspace.onDidChangeConfiguration).not.toHaveBeenCalled();
    });

    it('should update level when config changes', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      // Mock config that will change its return value
      let configValue = 'info';
      const mockConfig = {
        get: vi.fn(() => configValue),
        has: vi.fn(),
        inspect: vi.fn(),
        update: vi.fn(),
      };
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig as unknown as vscode.WorkspaceConfiguration);

      // Capture the config change callback
      let configChangeCallback: ((e: vscode.ConfigurationChangeEvent) => void) | undefined;
      vi.mocked(vscode.workspace.onDidChangeConfiguration).mockImplementation((callback) => {
        configChangeCallback = callback as (e: vscode.ConfigurationChangeEvent) => void;
        return { dispose: vi.fn() };
      });

      const logger = createLogger('TestExtension', {
        level: 'error', // fallback
        configSection: 'myExtension.logLevel',
      });

      // Initially debug should not be logged (level is 'info')
      logger.debug('Debug 1');
      expect(mockChannel.appendLine).not.toHaveBeenCalled();

      // Simulate config change to 'debug'
      configValue = 'debug';
      configChangeCallback?.({
        affectsConfiguration: (section: string) => section === 'myExtension.logLevel',
      } as vscode.ConfigurationChangeEvent);

      // Now debug should be logged
      logger.debug('Debug 2');
      expect(mockChannel.appendLine).toHaveBeenCalledWith(
        expect.stringMatching(/\[DEBUG\].*Debug 2/)
      );
    });

    it('should dispose config listener on dispose', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const mockDispose = vi.fn();
      vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({
        dispose: mockDispose,
      });

      const logger = createLogger('TestExtension', {
        configSection: 'myExtension.logLevel',
      });

      logger.dispose();

      expect(mockDispose).toHaveBeenCalled();
      expect(mockChannel.dispose).toHaveBeenCalled();
    });
  });

  describe('showOnErrorThrottleMs', () => {
    it('throttles channel.show within the configured window', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const dateNowSpy = vi.spyOn(Date, 'now');

      const logger = createLogger('TestExtension', { showOnErrorThrottleMs: 5000 });

      dateNowSpy.mockReturnValue(1_000);
      logger.error('first');
      dateNowSpy.mockReturnValue(2_000);
      logger.error('second'); // 1s later, should be throttled
      dateNowSpy.mockReturnValue(4_999);
      logger.error('third'); // still inside the 5s window

      expect(mockChannel.show).toHaveBeenCalledTimes(1);

      dateNowSpy.mockReturnValue(7_000); // 6s after first → outside window
      logger.error('fourth');

      expect(mockChannel.show).toHaveBeenCalledTimes(2);

      dateNowSpy.mockRestore();
    });

    it('shows on every error when throttle is 0 (default)', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension');

      logger.error('a');
      logger.error('b');
      logger.error('c');

      expect(mockChannel.show).toHaveBeenCalledTimes(3);
    });
  });

  describe('redactStackPaths', () => {
    it('redacts the OS home directory from telemetry stack/message', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const homedir = os.homedir();
      // Skip on the unlikely environment where homedir() returns ''.
      if (!homedir) return;

      const reporter = {
        sendTelemetryEvent: vi.fn(),
        sendTelemetryErrorEvent: vi.fn(),
      };

      const error = new Error(`failed reading ${homedir}/secret.txt`);
      error.stack = `Error: boom\n    at fn (${homedir}/code/file.ts:10:5)`;

      const logger = createLogger('TestExtension', {
        telemetryReporter: reporter,
        redactStackPaths: true,
      });
      logger.error(error);

      expect(reporter.sendTelemetryErrorEvent).toHaveBeenCalledTimes(1);
      const props = reporter.sendTelemetryErrorEvent.mock.calls[0]![1];
      expect(props.errorStack).toContain('~/code/file.ts');
      expect(props.errorStack).not.toContain(homedir);
      expect(props.errorMessage).toContain('~/secret.txt');
      expect(props.errorMessage).not.toContain(homedir);
    });

    it('leaves telemetry properties untouched when redactStackPaths is false', () => {
      const mockChannel = vscode.window.createOutputChannel('Test');
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const homedir = os.homedir();
      if (!homedir) return;

      const reporter = {
        sendTelemetryEvent: vi.fn(),
        sendTelemetryErrorEvent: vi.fn(),
      };

      const error = new Error('boom');
      error.stack = `Error: boom\n    at fn (${homedir}/code/file.ts:10:5)`;

      const logger = createLogger('TestExtension', { telemetryReporter: reporter });
      logger.error(error);

      const props = reporter.sendTelemetryErrorEvent.mock.calls[0]![1];
      expect(props.errorStack).toContain(homedir);
    });
  });
});
