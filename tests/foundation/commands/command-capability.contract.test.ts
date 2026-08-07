/**
 * Shared CommandCapability contract for the testing fake and VS Code adapter,
 * plus adapter-only editor conversion checks. The hoisted `vscode` stand-in is
 * intentionally independent from the fake; change this file when the port
 * contract or either implementation's boundary mapping changes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CommandCapability } from '../../../src/foundation/platform/ports.js';

// A stand-in for the `vscode.commands` behavior this adapter depends on:
// registering a duplicate id throws, an unknown id rejects, a plain command
// handler is awaited, and both its value and rejection reach the caller.
//
// This proves the adapter maps onto that contract. It does NOT prove VS Code
// itself behaves this way -- that is what the Extension Host lane is for.
const vscodeMock = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  /** The `vscode.TextEditor` shape the adapter's conversion reads. */
  const stubTextEditor = (): unknown => ({
    document: {
      uri: { scheme: 'file', path: '/a.txt', fsPath: '/a.txt', toString: () => 'file:///a.txt' },
      languageId: 'plaintext',
      lineCount: 1,
      getText: () => 'hello',
      lineAt: () => ({
        range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
      }),
      getWordRangeAtPosition: () => undefined,
    },
    selections: [{ start: { line: 0, character: 1 }, end: { line: 0, character: 4 } }],
  });
  return {
    handlers,
    module: {
      commands: {
        registerCommand(id: string, callback: (...args: unknown[]) => unknown) {
          if (handlers.has(id)) {
            throw new Error(`command '${id}' already exists`);
          }
          handlers.set(id, callback);
          return {
            dispose(): void {
              handlers.delete(id);
            },
          };
        },
        registerTextEditorCommand(
          id: string,
          callback: (editor: unknown, edit: unknown, ...args: unknown[]) => unknown
        ) {
          if (handlers.has(id)) {
            throw new Error(`command '${id}' already exists`);
          }
          // VS Code injects the focused editor and an edit builder. The
          // mock stands in a `vscode.TextEditor`-shaped pair, because the
          // adapter now converts the editor rather than passing it through.
          handlers.set(id, (...args: unknown[]) =>
            callback(stubTextEditor(), { kind: 'stub-edit' }, ...args)
          );
          return {
            dispose(): void {
              handlers.delete(id);
            },
          };
        },
        async executeCommand(id: string, ...args: unknown[]): Promise<unknown> {
          const handler = handlers.get(id);
          if (handler === undefined) {
            throw new Error(`command '${id}' not found`);
          }
          return await handler(...args);
        },
      },
    },
  };
});

vi.mock('vscode', () => vscodeMock.module);

const { createVSCodeCommandCapability } =
  await import('../../../src/vscode/foundation/commands.js');
const { createFakeCommands } = await import('../../../src/testing/fakes/fake-commands.js');

/**
 * One suite, run against every implementation of the port. A fake that drifts
 * from the adapter fails here.
 */
function describeCommandCapability(name: string, create: () => CommandCapability): void {
  describe(name, () => {
    beforeEach(() => {
      vscodeMock.handlers.clear();
    });

    it('delivers the handler return value to the caller', async () => {
      const capability = create();
      capability.register('test.value', () => 42);

      await expect(capability.execute<number>('test.value')).resolves.toBe(42);
    });

    it('awaits a handler that returns a promise', async () => {
      const capability = create();
      capability.register('test.async', async () => {
        await Promise.resolve();
        return 'done';
      });

      await expect(capability.execute<string>('test.async')).resolves.toBe('done');
    });

    it('passes arguments through unchanged', async () => {
      const capability = create();
      capability.register('test.args', (...args) => args);

      await expect(capability.execute('test.args', 1, 'two', { three: true })).resolves.toEqual([
        1,
        'two',
        { three: true },
      ]);
    });

    it('propagates a synchronous throw as a rejection', async () => {
      const capability = create();
      const failure = new Error('handler failed');
      capability.register('test.throw', () => {
        throw failure;
      });

      await expect(capability.execute('test.throw')).rejects.toBe(failure);
    });

    it('propagates a rejected promise', async () => {
      const capability = create();
      const failure = new Error('async failure');
      capability.register('test.reject', () => Promise.reject(failure));

      await expect(capability.execute('test.reject')).rejects.toBe(failure);
    });

    it('throws when the same id is registered twice', () => {
      const capability = create();
      capability.register('test.duplicate', () => undefined);

      expect(() => capability.register('test.duplicate', () => undefined)).toThrow(
        /already exists/
      );
    });

    it('shares one id namespace between plain and text editor commands', () => {
      const capability = create();
      capability.register('test.shared', () => undefined);
      expect(() => capability.registerTextEditor('test.shared', () => undefined)).toThrow(
        /already exists/
      );

      const registration = capability.registerTextEditor('test.editorOnly', () => undefined);
      expect(() => capability.register('test.editorOnly', () => undefined)).toThrow(
        /already exists/
      );
      registration.dispose();
      capability.register('test.editorOnly', () => undefined);
    });

    it('rejects an unregistered id', async () => {
      const capability = create();
      await expect(capability.execute('test.missing')).rejects.toBeInstanceOf(Error);
    });

    it('unregisters on dispose, and allows re-registration afterwards', async () => {
      const capability = create();
      const registration = capability.register('test.dispose', () => 'first');

      registration.dispose();
      await expect(capability.execute('test.dispose')).rejects.toBeInstanceOf(Error);

      capability.register('test.dispose', () => 'second');
      await expect(capability.execute<string>('test.dispose')).resolves.toBe('second');
    });

    it('resolves undefined for a handler that returns nothing', async () => {
      const capability = create();
      capability.register('test.void', () => undefined);

      await expect(capability.execute('test.void')).resolves.toBeUndefined();
    });
  });
}

describeCommandCapability('FakeCommands', () => createFakeCommands());
describeCommandCapability('VS Code adapter', () => createVSCodeCommandCapability());

/**
 * Adapter-only, because the conversion only exists there.
 *
 * The fake is handed the port already and passes it straight through, which
 * `tests/foundation/commands/texteditor-command.test.ts` covers on the test
 * host. Asserting the *same* conversion on both sides would let one wrong idea
 * satisfy both implementations and still look verified.
 */
describe('VS Code adapter, text editor commands', () => {
  beforeEach(() => {
    vscodeMock.handlers.clear();
  });

  it('hands the handler the editor port, not the raw vscode editor', async () => {
    const capability = createVSCodeCommandCapability();
    let seen: unknown;
    capability.registerTextEditor('test.editor', (editor, args) => {
      seen = { text: editor.getText(), languageId: editor.languageId, args };
      return 'ok';
    });

    await expect(capability.execute<string>('test.editor', 7)).resolves.toBe('ok');
    expect(seen).toEqual({ text: 'hello', languageId: 'plaintext', args: [7] });
  });

  it('converts the selections into plain ranges', async () => {
    const capability = createVSCodeCommandCapability();
    let selections: unknown;
    capability.registerTextEditor('test.selections', (editor) => {
      selections = editor.selections;
      return undefined;
    });

    await capability.execute('test.selections');
    expect(selections).toEqual([
      { start: { line: 0, character: 1 }, end: { line: 0, character: 4 } },
    ]);
  });
});
