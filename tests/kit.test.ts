import { describe, it, expect, vi } from 'vitest';
import * as vscode from 'vscode';
import { createExtensionKit } from '../src/core/kit.js';
import { createMockExtensionContext } from './factories.js';

type Mock = ReturnType<typeof vi.fn>;

function lastChannel(): { info: Mock; dispose: Mock } {
  const results = vi.mocked(vscode.window.createOutputChannel).mock.results;
  return results[results.length - 1]!.value as never;
}

describe('createExtensionKit', () => {
  it('creates a logger channel named after the extension', () => {
    const context = createMockExtensionContext();

    const kit = createExtensionKit(context, 'MyExtension');

    expect(vscode.window.createOutputChannel).toHaveBeenCalledWith('MyExtension', { log: true });
    kit.logger.info('hello');
    expect(lastChannel().info).toHaveBeenCalledWith('hello');
  });

  it('registers itself in context.subscriptions', () => {
    const context = createMockExtensionContext();

    const kit = createExtensionKit(context, 'X');

    expect(context.subscriptions).toContain(kit);
    expect(context.subscriptions).toHaveLength(1);
  });

  it('kit.run reports failures through the kit logger', async () => {
    const context = createMockExtensionContext();
    const kit = createExtensionKit(context, 'X');
    const errorSpy = vi.spyOn(kit.logger, 'error');

    const value = await kit.run('Do thing', () => {
      throw new Error('kaput');
    });

    expect(value).toBeUndefined();
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Do thing failed: kaput'),
      expect.anything()
    );
    expect(vscode.window.showErrorMessage).toHaveBeenCalled();
  });

  it('kit.tryRun returns a Result', async () => {
    const context = createMockExtensionContext();
    const kit = createExtensionKit(context, 'X');

    const result = await kit.tryRun('Compute', () => 7);

    expect(result).toEqual({ ok: true, value: 7 });
  });

  it('registers commands into the kit scope, not context.subscriptions', () => {
    const context = createMockExtensionContext();
    const kit = createExtensionKit<'x.a' | 'x.b'>(context, 'X');

    const commands = kit.registerCommands({ 'x.a': vi.fn() });

    expect(vscode.commands.registerCommand).toHaveBeenCalledWith('x.a', expect.any(Function));
    expect(commands['x.a']).toBeDefined();
    // Only the kit itself lives in context.subscriptions.
    expect(context.subscriptions).toHaveLength(1);
    // 1 logger + 1 command
    expect(kit.disposables.size).toBe(2);
  });

  it('allows registering command subsets across multiple calls', () => {
    const context = createMockExtensionContext();
    const kit = createExtensionKit<'x.a' | 'x.b'>(context, 'X');

    kit.registerCommands({ 'x.a': vi.fn() });
    kit.registerCommands({ 'x.b': vi.fn() });

    expect(vscode.commands.registerCommand).toHaveBeenCalledTimes(2);
  });

  it('registers text editor commands through the kit', () => {
    const context = createMockExtensionContext();
    const kit = createExtensionKit(context, 'X');

    kit.registerTextEditorCommands({ 'x.edit': vi.fn() });

    expect(vscode.commands.registerTextEditorCommand).toHaveBeenCalledWith(
      'x.edit',
      expect.any(Function)
    );
  });

  it('kit.executeCommand delegates to vscode', async () => {
    const context = createMockExtensionContext();
    const kit = createExtensionKit(context, 'X');
    vi.mocked(vscode.commands.executeCommand).mockResolvedValueOnce('ok');

    const result = await kit.executeCommand<string>('a.command');

    expect(result).toBe('ok');
  });

  it('dispose tears down the logger and all registered commands', () => {
    const context = createMockExtensionContext();
    const kit = createExtensionKit(context, 'X');
    kit.registerCommands({ 'x.a': vi.fn() });
    const commandDisposable = vi.mocked(vscode.commands.registerCommand).mock.results[0]!.value as {
      dispose: Mock;
    };

    kit.dispose();

    expect(lastChannel().dispose).toHaveBeenCalledTimes(1);
    expect(commandDisposable.dispose).toHaveBeenCalledTimes(1);
  });

  it('supports Symbol.dispose', () => {
    const context = createMockExtensionContext();
    const kit = createExtensionKit(context, 'X');

    kit[Symbol.dispose]();

    expect(lastChannel().dispose).toHaveBeenCalledTimes(1);
  });

  it('forwards default command options from the kit options', async () => {
    const context = createMockExtensionContext();
    const kit = createExtensionKit(context, 'X', {
      commands: { commandErrorMessage: (id) => `Custom ${id}` },
    });

    kit.registerCommands({
      'x.fail': () => {
        throw new Error('e');
      },
    });
    const registered = vi.mocked(vscode.commands.registerCommand).mock.results[0]!.value as {
      _callback: (...args: unknown[]) => unknown;
    };
    await registered._callback();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('Custom x.fail')
    );
  });
});
