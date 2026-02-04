import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { getConfig, getSetting, setSetting, onConfigChange } from '../src/config.js';

describe('Config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getConfig', () => {
    it('should call workspace.getConfiguration with prefix', () => {
      getConfig('myExtension');

      expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('myExtension');
    });

    it('should return WorkspaceConfiguration object', () => {
      const config = getConfig('myExtension');

      expect(config).toBeDefined();
      expect(typeof config.get).toBe('function');
    });
  });

  describe('getSetting', () => {
    it('should return default value when setting is not defined', () => {
      const result = getSetting('myExtension', 'notExists', 'defaultValue');

      expect(result).toBe('defaultValue');
    });

    it('should return undefined when no default provided and setting not defined', () => {
      const result = getSetting('myExtension', 'notExists');

      expect(result).toBeUndefined();
    });

    it('should return configured value', () => {
      const mockConfig = vscode.workspace.getConfiguration('myExtension');
      vi.mocked(mockConfig.get).mockReturnValue('configuredValue');
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig);

      getSetting('myExtension', 'mySetting', 'default');

      expect(mockConfig.get).toHaveBeenCalledWith('mySetting', 'default');
    });

    it('should work with different types', () => {
      const mockConfig = vscode.workspace.getConfiguration('myExtension');
      vi.mocked(mockConfig.get).mockReturnValue(42);
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig);

      getSetting<number>('myExtension', 'timeout', 5000);

      expect(mockConfig.get).toHaveBeenCalledWith('timeout', 5000);
    });
  });

  describe('setSetting', () => {
    it('should update setting with Global target by default', async () => {
      const mockConfig = vscode.workspace.getConfiguration('myExtension');
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig);

      await setSetting('myExtension', 'mySetting', 'newValue');

      expect(mockConfig.update).toHaveBeenCalledWith(
        'mySetting',
        'newValue',
        vscode.ConfigurationTarget.Global
      );
    });

    it('should update setting with specified target', async () => {
      const mockConfig = vscode.workspace.getConfiguration('myExtension');
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig);

      await setSetting(
        'myExtension',
        'mySetting',
        'newValue',
        vscode.ConfigurationTarget.Workspace
      );

      expect(mockConfig.update).toHaveBeenCalledWith(
        'mySetting',
        'newValue',
        vscode.ConfigurationTarget.Workspace
      );
    });

    it('should handle different value types', async () => {
      const mockConfig = vscode.workspace.getConfiguration('myExtension');
      vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(mockConfig);

      await setSetting('myExtension', 'timeout', 10000);
      expect(mockConfig.update).toHaveBeenCalledWith('timeout', 10000, expect.any(Number));

      await setSetting('myExtension', 'enabled', true);
      expect(mockConfig.update).toHaveBeenCalledWith('enabled', true, expect.any(Number));

      await setSetting('myExtension', 'options', { key: 'value' });
      expect(mockConfig.update).toHaveBeenCalledWith(
        'options',
        { key: 'value' },
        expect.any(Number)
      );
    });
  });

  describe('onConfigChange', () => {
    it('should register configuration change listener', () => {
      const callback = vi.fn();

      onConfigChange('myExtension', callback);

      expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalled();
    });

    it('should return disposable', () => {
      const callback = vi.fn();

      const disposable = onConfigChange('myExtension', callback);

      expect(disposable).toHaveProperty('dispose');
    });

    it('should call callback when configuration changes for prefix', () => {
      const callback = vi.fn();
      let registeredHandler: ((e: vscode.ConfigurationChangeEvent) => void) | undefined;

      vi.mocked(vscode.workspace.onDidChangeConfiguration).mockImplementation((handler) => {
        registeredHandler = handler as (e: vscode.ConfigurationChangeEvent) => void;
        return { dispose: vi.fn() };
      });

      onConfigChange('myExtension', callback);

      // Simulate configuration change that affects the prefix
      const mockEvent = {
        affectsConfiguration: vi.fn((section: string) => section === 'myExtension'),
      };
      registeredHandler?.(mockEvent as unknown as vscode.ConfigurationChangeEvent);

      expect(callback).toHaveBeenCalled();
    });

    it('should not call callback when configuration changes for different prefix', () => {
      const callback = vi.fn();
      let registeredHandler: ((e: vscode.ConfigurationChangeEvent) => void) | undefined;

      vi.mocked(vscode.workspace.onDidChangeConfiguration).mockImplementation((handler) => {
        registeredHandler = handler as (e: vscode.ConfigurationChangeEvent) => void;
        return { dispose: vi.fn() };
      });

      onConfigChange('myExtension', callback);

      // Simulate configuration change that doesn't affect the prefix
      const mockEvent = {
        affectsConfiguration: vi.fn((section: string) => section === 'otherExtension'),
      };
      registeredHandler?.(mockEvent as unknown as vscode.ConfigurationChangeEvent);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('input validation', () => {
    describe('getConfig', () => {
      it('should throw on empty prefix', () => {
        expect(() => getConfig('')).toThrow('prefix must be a non-empty string');
      });

      it('should throw on whitespace-only prefix', () => {
        expect(() => getConfig('   ')).toThrow('prefix must be a non-empty string');
      });
    });

    describe('getSetting', () => {
      it('should throw on empty prefix', () => {
        expect(() => getSetting('', 'key')).toThrow('prefix must be a non-empty string');
      });

      it('should throw on empty key', () => {
        expect(() => getSetting('myExtension', '')).toThrow('key must be a non-empty string');
      });

      it('should throw on whitespace-only key', () => {
        expect(() => getSetting('myExtension', '   ')).toThrow('key must be a non-empty string');
      });
    });

    describe('setSetting', () => {
      it('should throw on empty prefix', async () => {
        await expect(setSetting('', 'key', 'value')).rejects.toThrow(
          'prefix must be a non-empty string'
        );
      });

      it('should throw on empty key', async () => {
        await expect(setSetting('myExtension', '', 'value')).rejects.toThrow(
          'key must be a non-empty string'
        );
      });
    });

    describe('onConfigChange', () => {
      it('should throw on empty prefix', () => {
        expect(() => onConfigChange('', vi.fn())).toThrow('prefix must be a non-empty string');
      });

      it('should throw on whitespace-only prefix', () => {
        expect(() => onConfigChange('   ', vi.fn())).toThrow('prefix must be a non-empty string');
      });
    });
  });
});
