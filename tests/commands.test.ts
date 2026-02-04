import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { registerCommands, registerTextEditorCommands, executeCommand } from '../src/commands.js';
import type { Logger } from '../src/types.js';
import { createMockLogger, createMockExtensionContext } from './factories.js';

describe('registerCommands', () => {
  let mockContext: ReturnType<typeof createMockExtensionContext>;
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = createMockExtensionContext();
    mockLogger = createMockLogger();
  });

  describe('command registration', () => {
    it('should register commands with vscode.commands.registerCommand', () => {
      const handlers = {
        'test.command1': vi.fn(),
        'test.command2': vi.fn(),
      };

      registerCommands(mockContext, mockLogger, handlers);

      expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(2);
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'test.command1',
        expect.any(Function)
      );
      expect(vscode.commands.registerCommand).toHaveBeenCalledWith(
        'test.command2',
        expect.any(Function)
      );
    });

    it('should add disposables to context.subscriptions', () => {
      const handlers = {
        'test.command1': vi.fn(),
        'test.command2': vi.fn(),
      };

      registerCommands(mockContext, mockLogger, handlers);

      expect(mockContext.subscriptions).toHaveLength(2);
      expect(mockContext.subscriptions[0]).toHaveProperty('dispose');
    });
  });

  describe('safeExecute wrapping', () => {
    it('should wrap handlers with safeExecute by default', async () => {
      const error = new Error('Handler error');
      const handlers = {
        'test.failing': () => {
          throw error;
        },
      };

      registerCommands(mockContext, mockLogger, handlers);

      // Get the wrapped handler that was registered
      const call = vi.mocked(vscode.commands.registerCommand).mock.calls[0];
      const wrappedHandler = call?.[1] as ((...args: unknown[]) => Promise<unknown>) | undefined;
      expect(wrappedHandler).toBeDefined();

      // Execute the wrapped handler - it should not throw
      const result = await wrappedHandler!();

      expect(result).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
      expect(vscode.window.showErrorMessage).toHaveBeenCalled();
    });

    it('should pass arguments to the handler', async () => {
      const handler = vi.fn().mockReturnValue('result');
      const handlers = {
        'test.withArgs': handler,
      };

      registerCommands(mockContext, mockLogger, handlers);

      const call = vi.mocked(vscode.commands.registerCommand).mock.calls[0];
      const wrappedHandler = call?.[1] as ((...args: unknown[]) => Promise<unknown>) | undefined;
      await wrappedHandler!('arg1', 'arg2', 123);

      expect(handler).toHaveBeenCalledWith('arg1', 'arg2', 123);
    });

    it('should return handler result on success', async () => {
      const handlers = {
        'test.success': () => 'success result',
      };

      registerCommands(mockContext, mockLogger, handlers);

      const call = vi.mocked(vscode.commands.registerCommand).mock.calls[0];
      const wrappedHandler = call?.[1] as (() => Promise<unknown>) | undefined;
      const result = await wrappedHandler!();

      expect(result).toBe('success result');
    });
  });

  describe('wrapWithSafeExecute option', () => {
    it('should not wrap when wrapWithSafeExecute is false', () => {
      const handler = vi.fn();
      const handlers = {
        'test.unwrapped': handler,
      };

      registerCommands(mockContext, mockLogger, handlers, {
        wrapWithSafeExecute: false,
      });

      const call = vi.mocked(vscode.commands.registerCommand).mock.calls[0];
      const registeredHandler = call?.[1];

      // Should be the same function reference
      expect(registeredHandler).toBe(handler);
    });

    it('should throw errors when not wrapped', () => {
      const error = new Error('Direct error');
      const handlers = {
        'test.throwing': () => {
          throw error;
        },
      };

      registerCommands(mockContext, mockLogger, handlers, {
        wrapWithSafeExecute: false,
      });

      const call = vi.mocked(vscode.commands.registerCommand).mock.calls[0];
      const registeredHandler = call?.[1] as () => void;

      expect(() => registeredHandler()).toThrow('Direct error');
    });
  });

  describe('commandErrorMessage option', () => {
    it('should use custom error message generator', async () => {
      const handlers = {
        'myext.doSomething': () => {
          throw new Error('fail');
        },
      };

      registerCommands(mockContext, mockLogger, handlers, {
        commandErrorMessage: (id) => `Custom error for ${id}`,
      });

      const call = vi.mocked(vscode.commands.registerCommand).mock.calls[0];
      const wrappedHandler = call?.[1] as (() => Promise<unknown>) | undefined;
      await wrappedHandler!();

      expect(mockLogger.error).toHaveBeenCalledWith(
        expect.stringContaining('Custom error for myext.doSomething'),
        expect.any(Error)
      );
    });
  });

  describe('async handlers', () => {
    it('should handle async handlers correctly', async () => {
      const handlers = {
        'test.async': async () => {
          await Promise.resolve();
          return 'async result';
        },
      };

      registerCommands(mockContext, mockLogger, handlers);

      const call = vi.mocked(vscode.commands.registerCommand).mock.calls[0];
      const wrappedHandler = call?.[1] as (() => Promise<unknown>) | undefined;
      const result = await wrappedHandler!();

      expect(result).toBe('async result');
    });

    it('should catch async errors', async () => {
      const handlers = {
        'test.asyncError': async () => {
          await Promise.resolve();
          throw new Error('async error');
        },
      };

      registerCommands(mockContext, mockLogger, handlers);

      const call = vi.mocked(vscode.commands.registerCommand).mock.calls[0];
      const wrappedHandler = call?.[1] as (() => Promise<unknown>) | undefined;
      const result = await wrappedHandler!();

      expect(result).toBeUndefined();
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('empty handlers', () => {
    it('should handle empty handlers object', () => {
      registerCommands(mockContext, mockLogger, {});

      expect(vscode.commands.registerCommand).not.toHaveBeenCalled();
      expect(mockContext.subscriptions).toHaveLength(0);
    });
  });
});

describe('registerTextEditorCommands', () => {
  let mockContext: ReturnType<typeof createMockExtensionContext>;
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockContext = createMockExtensionContext();
    mockLogger = createMockLogger();
  });

  it('should register text editor commands with vscode.commands.registerTextEditorCommand', () => {
    const handlers = {
      'test.editorCommand1': vi.fn(),
      'test.editorCommand2': vi.fn(),
    };

    registerTextEditorCommands(mockContext, mockLogger, handlers);

    expect(vscode.commands.registerTextEditorCommand).toHaveBeenCalledTimes(2);
    expect(vscode.commands.registerTextEditorCommand).toHaveBeenCalledWith(
      'test.editorCommand1',
      expect.any(Function)
    );
    expect(vscode.commands.registerTextEditorCommand).toHaveBeenCalledWith(
      'test.editorCommand2',
      expect.any(Function)
    );
  });

  it('should add disposables to context.subscriptions', () => {
    const handlers = {
      'test.editorCommand': vi.fn(),
    };

    registerTextEditorCommands(mockContext, mockLogger, handlers);

    expect(mockContext.subscriptions).toHaveLength(1);
    expect(mockContext.subscriptions[0]).toHaveProperty('dispose');
  });

  it('should pass editor, edit, and args to handler', async () => {
    const handler = vi.fn();
    const handlers = {
      'test.editorCommand': handler,
    };

    registerTextEditorCommands(mockContext, mockLogger, handlers);

    const call = vi.mocked(vscode.commands.registerTextEditorCommand).mock.calls[0];
    const wrappedHandler = call?.[1] as (
      editor: unknown,
      edit: unknown,
      ...args: unknown[]
    ) => unknown;

    const mockEditor = { document: {} };
    const mockEdit = { replace: vi.fn() };

    await wrappedHandler(mockEditor, mockEdit, 'arg1', 'arg2');

    expect(handler).toHaveBeenCalledWith(mockEditor, mockEdit, 'arg1', 'arg2');
  });

  it('should handle errors gracefully when wrapped', async () => {
    const handlers = {
      'test.failing': () => {
        throw new Error('Handler error');
      },
    };

    registerTextEditorCommands(mockContext, mockLogger, handlers);

    const call = vi.mocked(vscode.commands.registerTextEditorCommand).mock.calls[0];
    const wrappedHandler = call?.[1] as (editor: unknown, edit: unknown) => Promise<unknown>;

    // Should not throw
    const result = await wrappedHandler({}, {});

    expect(result).toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('should not wrap when wrapWithSafeExecute is false', () => {
    const handler = vi.fn();
    const handlers = {
      'test.unwrapped': handler,
    };

    registerTextEditorCommands(mockContext, mockLogger, handlers, {
      wrapWithSafeExecute: false,
    });

    const call = vi.mocked(vscode.commands.registerTextEditorCommand).mock.calls[0];
    const registeredHandler = call?.[1];

    expect(registeredHandler).toBe(handler);
  });

  it('should handle empty handlers object', () => {
    registerTextEditorCommands(mockContext, mockLogger, {});

    expect(vscode.commands.registerTextEditorCommand).not.toHaveBeenCalled();
    expect(mockContext.subscriptions).toHaveLength(0);
  });
});

describe('executeCommand', () => {
  let mockLogger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = createMockLogger();
  });

  it('should execute command and return result', async () => {
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue('result');

    const result = await executeCommand<string>(mockLogger, 'test.command');

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith('test.command');
    expect(result).toBe('result');
  });

  it('should pass arguments to command', async () => {
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue(undefined);

    await executeCommand(mockLogger, 'test.command', 'arg1', 'arg2', 123);

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'test.command',
      'arg1',
      'arg2',
      123
    );
  });

  it('should log debug messages', async () => {
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue('done');

    await executeCommand(mockLogger, 'test.command');

    expect(mockLogger.debug).toHaveBeenCalledWith('Executing command: test.command');
    expect(mockLogger.debug).toHaveBeenCalledWith('Command test.command completed');
  });

  it('should handle errors gracefully', async () => {
    vi.mocked(vscode.commands.executeCommand).mockRejectedValue(new Error('Command failed'));

    const result = await executeCommand(mockLogger, 'test.failing');

    expect(result).toBeUndefined();
    expect(mockLogger.error).toHaveBeenCalled();
  });

  it('should return typed result', async () => {
    const mockData = { id: 1, name: 'test' };
    vi.mocked(vscode.commands.executeCommand).mockResolvedValue(mockData);

    const result = await executeCommand<{ id: number; name: string }>(mockLogger, 'test.getData');

    expect(result).toEqual(mockData);
  });
});
