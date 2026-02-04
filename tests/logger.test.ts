import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { createLogger } from '../src/logger.js';

describe('Logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createLogger', () => {
    it('should create a logger with LogOutputChannel', () => {
      const logger = createLogger('TestExtension');

      expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('TestExtension', {
        log: true,
      });
      expect(logger).toBeDefined();
      expect(typeof logger.trace).toBe('function');
      expect(typeof logger.debug).toBe('function');
      expect(typeof logger.info).toBe('function');
      expect(typeof logger.warn).toBe('function');
      expect(typeof logger.error).toBe('function');
      expect(typeof logger.dispose).toBe('function');
    });

    it('should log trace messages when level is trace', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'trace' });
      logger.trace('Trace message');

      expect(mockChannel.trace).toHaveBeenCalledWith(expect.stringContaining('Trace message'));
    });

    it('should not log trace messages when level is debug', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'debug' });
      logger.trace('Trace message');

      expect(mockChannel.trace).not.toHaveBeenCalled();
    });

    it('should log info messages when level is info or lower', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'info' });
      logger.info('Test message');

      expect(mockChannel.info).toHaveBeenCalledWith(expect.stringContaining('Test message'));
    });

    it('should not log debug messages when level is info', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'info' });
      logger.debug('Debug message');

      expect(mockChannel.debug).not.toHaveBeenCalled();
    });

    it('should log debug messages when level is debug', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'debug' });
      logger.debug('Debug message');

      expect(mockChannel.debug).toHaveBeenCalledWith(expect.stringContaining('Debug message'));
    });

    it('should log warn messages', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'info' });
      logger.warn('Warning message');

      expect(mockChannel.warn).toHaveBeenCalledWith(expect.stringContaining('Warning message'));
    });

    it('should show output channel on error when showOnError is true', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { showOnError: true });
      logger.error('Error message');

      expect(mockChannel.error).toHaveBeenCalled();
      expect(mockChannel.show).toHaveBeenCalledWith(true);
    });

    it('should not show output channel on error when showOnError is false', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { showOnError: false });
      logger.error('Error message');

      expect(mockChannel.error).toHaveBeenCalled();
      expect(mockChannel.show).not.toHaveBeenCalled();
    });

    it('should include timestamp when timestamp option is true', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { timestamp: true });
      logger.info('Test message');

      expect(mockChannel.info).toHaveBeenCalledWith(
        expect.stringMatching(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\] Test message/)
      );
    });

    it('should not include timestamp when timestamp option is false', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { timestamp: false });
      logger.info('Test message');

      expect(mockChannel.info).toHaveBeenCalledWith('Test message');
    });

    it('should format Error objects with stack trace', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { timestamp: false });
      const error = new Error('Test error');
      logger.error('Operation failed', error);

      expect(mockChannel.error).toHaveBeenCalledWith(expect.stringContaining('Operation failed'));
      expect(mockChannel.error).toHaveBeenCalledWith(expect.stringContaining('Test error'));
    });

    it('should format object meta as JSON', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { timestamp: false });
      const meta = { key: 'value', num: 42 };
      logger.info('Test message', meta);

      expect(mockChannel.info).toHaveBeenCalledWith(expect.stringContaining('"key": "value"'));
    });

    it('should handle multiple arguments', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { timestamp: false });
      logger.info('Test message', 'arg1', 42, { key: 'value' });

      expect(mockChannel.info).toHaveBeenCalledWith(expect.stringContaining('Test message'));
      expect(mockChannel.info).toHaveBeenCalledWith(expect.stringContaining('arg1'));
      expect(mockChannel.info).toHaveBeenCalledWith(expect.stringContaining('42'));
    });

    it('should handle Error object as first argument to error()', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { timestamp: false });
      const error = new Error('Direct error');
      logger.error(error);

      expect(mockChannel.error).toHaveBeenCalledWith(expect.stringContaining('Direct error'));
    });
  });

  describe('setLevel', () => {
    it('should change log level dynamically', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'info' });

      // Initially, debug should not be logged
      logger.debug('Debug 1');
      expect(mockChannel.debug).not.toHaveBeenCalled();

      // Change level to debug
      logger.setLevel('debug');
      logger.debug('Debug 2');
      expect(mockChannel.debug).toHaveBeenCalledWith(expect.stringContaining('Debug 2'));
    });

    it('should suppress all logs when level is silent', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension', { level: 'info' });
      logger.setLevel('silent');

      logger.debug('Debug');
      logger.info('Info');
      logger.warn('Warn');
      logger.error('Error');

      expect(mockChannel.debug).not.toHaveBeenCalled();
      expect(mockChannel.info).not.toHaveBeenCalled();
      expect(mockChannel.warn).not.toHaveBeenCalled();
      expect(mockChannel.error).not.toHaveBeenCalled();
    });
  });

  describe('dispose', () => {
    it('should dispose the output channel', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      const logger = createLogger('TestExtension');
      logger.dispose();

      expect(mockChannel.dispose).toHaveBeenCalled();
    });
  });

  describe('configSection', () => {
    it('should read initial level from VSCode config', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
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
      expect(mockChannel.debug).toHaveBeenCalledWith(expect.stringContaining('Debug message'));
    });

    it('should use fallback level when config returns undefined', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
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
      expect(mockChannel.debug).not.toHaveBeenCalled();
    });

    it('should register config change listener', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      createLogger('TestExtension', {
        configSection: 'myExtension.logLevel',
      });

      expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalled();
    });

    it('should not register config change listener without configSection', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
      vi.mocked(vscode.window.createOutputChannel).mockReturnValue(mockChannel);

      vi.mocked(vscode.workspace.onDidChangeConfiguration).mockClear();

      createLogger('TestExtension', { level: 'info' });

      expect(vscode.workspace.onDidChangeConfiguration).not.toHaveBeenCalled();
    });

    it('should update level when config changes', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
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
      expect(mockChannel.debug).not.toHaveBeenCalled();

      // Simulate config change to 'debug'
      configValue = 'debug';
      configChangeCallback?.({
        affectsConfiguration: (section: string) => section === 'myExtension.logLevel',
      } as vscode.ConfigurationChangeEvent);

      // Now debug should be logged
      logger.debug('Debug 2');
      expect(mockChannel.debug).toHaveBeenCalledWith(expect.stringContaining('Debug 2'));
    });

    it('should dispose config listener on dispose', () => {
      const mockChannel = vscode.window.createOutputChannel('Test', { log: true });
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
});
