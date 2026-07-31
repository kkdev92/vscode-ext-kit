import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import {
  registerCommands,
  registerTextEditorCommands,
  executeCommand,
} from '../../src/core/commands.js';
import { createMockLogger, createMockExtensionContext } from '../factories.js';

type RegisteredCommand = {
  dispose: ReturnType<typeof vi.fn>;
  _callback: (...args: unknown[]) => unknown;
};

/** Returns the callback + disposable captured by the registerCommand mock. */
function captured(index = 0): RegisteredCommand {
  const results = vi.mocked(vscode.commands.registerCommand).mock.results;
  return results[index]!.value as RegisteredCommand;
}

function capturedEditor(index = 0): {
  dispose: ReturnType<typeof vi.fn>;
  _callback: (editor: unknown, edit: unknown, ...args: unknown[]) => unknown;
} {
  const results = vi.mocked(vscode.commands.registerTextEditorCommand).mock.results;
  return results[index]!.value as never;
}

describe('registerCommands', () => {
  it('registers every handler and pushes disposables to subscriptions', () => {
    const context = createMockExtensionContext();
    const logger = createMockLogger();

    registerCommands(context, logger, {
      'ext.one': vi.fn(),
      'ext.two': vi.fn(),
    });

    expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(2);
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith('ext.one', expect.any(Function));
    expect(vscode.commands.registerCommand).toHaveBeenCalledWith('ext.two', expect.any(Function));
    expect(context.subscriptions).toHaveLength(2);
  });

  it('returns a map of command id to disposable for selective disposal', () => {
    const context = createMockExtensionContext();
    const logger = createMockLogger();

    const commands = registerCommands<'ext.a' | 'ext.b'>(context, logger, {
      'ext.a': vi.fn(),
      'ext.b': vi.fn(),
    });

    expect(Object.keys(commands)).toEqual(['ext.a', 'ext.b']);
    commands['ext.a'].dispose();
    expect(captured(0).dispose).toHaveBeenCalledTimes(1);
    expect(captured(1).dispose).not.toHaveBeenCalled();
  });

  it('accepts precisely-typed handlers like the raw API does', () => {
    const context = createMockExtensionContext();
    const logger = createMockLogger();

    // Compile-time check: a (uri: vscode.Uri) => void handler must be accepted.
    registerCommands(context, logger, {
      'ext.open': (uri: vscode.Uri) => uri.fsPath,
    });

    expect(vscode.commands.registerCommand).toHaveBeenCalledWith('ext.open', expect.any(Function));
  });

  it('invokes the handler with the original arguments', async () => {
    const context = createMockExtensionContext();
    const logger = createMockLogger();
    const handler = vi.fn().mockReturnValue('done');

    registerCommands(context, logger, { 'ext.run': handler });
    await captured()._callback('a', 42);

    expect(handler).toHaveBeenCalledWith('a', 42);
  });

  it('wraps handlers so thrown errors are logged and shown', async () => {
    const context = createMockExtensionContext();
    const logger = createMockLogger();
    const error = new Error('handler blew up');

    registerCommands(context, logger, {
      'ext.fail': () => {
        throw error;
      },
    });
    await captured()._callback();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Command: ext.fail failed: handler blew up'),
      expect.objectContaining({ error })
    );
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('uses commandErrorMessage for the action name', async () => {
    const context = createMockExtensionContext();
    const logger = createMockLogger();

    registerCommands(
      context,
      logger,
      {
        'ext.fail': () => {
          throw new Error('x');
        },
      },
      { commandErrorMessage: (id) => `Running ${id}` }
    );
    await captured()._callback();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Running ext.fail')
    );
  });

  it('registers the raw handler when wrap is false', () => {
    const context = createMockExtensionContext();
    const logger = createMockLogger();
    const handler = vi.fn();

    registerCommands(context, logger, { 'ext.raw': handler }, { wrap: false });

    expect(captured()._callback).toBe(handler);
  });
});

describe('registerTextEditorCommands', () => {
  it('registers handlers and returns the disposable map', () => {
    const context = createMockExtensionContext();
    const logger = createMockLogger();

    const commands = registerTextEditorCommands(context, logger, {
      'ext.edit': vi.fn(),
    });

    expect(vscode.commands.registerTextEditorCommand).toHaveBeenCalledWith(
      'ext.edit',
      expect.any(Function)
    );
    expect(context.subscriptions).toHaveLength(1);
    expect(commands['ext.edit']).toBeDefined();
  });

  it('passes editor, edit and args through to the handler', async () => {
    const context = createMockExtensionContext();
    const logger = createMockLogger();
    const handler = vi.fn();
    const editor = { document: {} };
    const edit = { replace: vi.fn() };

    registerTextEditorCommands(context, logger, { 'ext.edit': handler });
    await capturedEditor()._callback(editor, edit, 'extra');

    expect(handler).toHaveBeenCalledWith(editor, edit, 'extra');
  });

  it('wraps errors like registerCommands', async () => {
    const context = createMockExtensionContext();
    const logger = createMockLogger();

    registerTextEditorCommands(context, logger, {
      'ext.fail': () => {
        throw new Error('editor fail');
      },
    });
    await capturedEditor()._callback({}, {});

    expect(logger.error).toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});

describe('executeCommand', () => {
  it('delegates to vscode.commands.executeCommand and returns the result', async () => {
    const logger = createMockLogger();
    vi.mocked(vscode.commands.executeCommand).mockResolvedValueOnce('result');

    const result = await executeCommand<string>(logger, 'workbench.action.reload', 1, 'two');

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'workbench.action.reload',
      1,
      'two'
    );
    expect(result).toBe('result');
  });

  it('logs before and after execution', async () => {
    const logger = createMockLogger();

    await executeCommand(logger, 'some.command');

    expect(logger.debug).toHaveBeenCalledWith('Executing command: some.command');
    expect(logger.debug).toHaveBeenCalledWith('Command some.command completed');
  });

  it('returns undefined and notifies when the command rejects', async () => {
    const logger = createMockLogger();
    vi.mocked(vscode.commands.executeCommand).mockRejectedValueOnce(new Error('nope'));

    const result = await executeCommand(logger, 'broken.command');

    expect(result).toBeUndefined();
    expect(logger.error).toHaveBeenCalled();
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });
});
