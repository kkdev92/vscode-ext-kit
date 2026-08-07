/**
 * Test Host coverage for Module text-editor commands: editor-port delivery,
 * Operation wrapping, dependency injection and the platform-defined
 * fire-and-forget result boundary. Adapter object conversion is tested in the
 * CommandCapability contract suite.
 */
import { describe, expect, it } from 'vitest';

import { compileApplication } from '../../../src/foundation/application/plan.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import type { ActiveTextEditor } from '../../../src/foundation/platform/ports.js';
import { serviceToken } from '../../../src/foundation/services/token.js';
import { createFakeEditor } from '../../../src/testing/fakes/fake-editor.js';
import { createTestHost } from '../../../src/testing/test-host.js';

const Upcase = defineCommandContract<readonly [string], string>({ id: 'sample.upcase' });

/** An editor port with `text` open, as VS Code would hand one to the command. */
function focusedOn(text: string): ActiveTextEditor {
  const editors = createFakeEditor();
  editors._open({ text });
  const active = editors.active;
  if (active === undefined) {
    throw new Error('the fake failed to open a document');
  }
  return active;
}

describe('module.commands.handleTextEditor', () => {
  it('hands the handler the same editor API `Editors.active` returns', async () => {
    const Suffix = serviceToken<{ suffix: string }>('demo.suffix');
    const module = defineModule('editors', (builder): undefined => {
      builder.services.singleton(Suffix, () => ({ suffix: '!' }));
      builder.commands.handleTextEditor(Upcase, {
        inject: { suffix: Suffix },
        execute: (context, editor, [prefix], { suffix }) => {
          expect(context.name).toBe('sample.upcase');
          // The point of the change: an `ActiveEditor`, not a raw
          // `vscode.TextEditor` the module would have to cast and import types
          // for. A feature written against one works with either declaration.
          return `${prefix}${editor.text().toUpperCase()}${suffix.suffix}`;
        },
      });
      return undefined;
    });

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();

    const { settled } = await host.commands.executeTextEditor(
      'sample.upcase',
      focusedOn('abc'),
      '>'
    );
    // The value comes off the handler's own promise, not off the command: VS
    // Code discards a text editor command's result.
    await expect(settled).resolves.toBe('>ABC!');
    expect(host.events).toContain('operation.completed');

    await host.stop();
    expect(host.leaks().commands).toEqual([]);
  });

  it('edits through the editor it was handed', async () => {
    const Shout = defineCommandContract<readonly [], boolean>({ id: 'sample.shout' });
    const module = defineModule('editors', (builder): undefined => {
      builder.commands.handleTextEditor(Shout, (_context, editor) =>
        editor.replace({ start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, 'XYZ')
      );
      return undefined;
    });

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();

    const editors = createFakeEditor();
    editors._open({ text: 'abc' });
    const active = editors.active;
    if (active === undefined) {
      throw new Error('the fake failed to open a document');
    }

    const { settled } = await host.commands.executeTextEditor('sample.shout', active);
    await expect(settled).resolves.toBe(true);
    expect(editors._text()).toBe('XYZ');

    await host.stop();
  });

  /**
   * VS Code's `registerTextEditorCommand` wrapper runs the handler inside
   * `activeTextEditor.edit(...)` and discards what it returned, logging a
   * rejection rather than propagating it. So the invariant "a command's result
   * and its rejection reach the caller" holds for `handle` and *not* for
   * `handleTextEditor`. The fake must preserve that less-capable boundary so
   * Test Host code cannot rely on a result the real invoker never receives.
   */
  it('does not deliver a handler rejection to the invoker', async () => {
    const module = defineModule('editors', (builder): undefined => {
      builder.commands.handleTextEditor(Upcase, () => {
        throw new Error('no editor state');
      });
      return undefined;
    });
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();

    const { settled } = await host.commands.executeTextEditor('sample.upcase', focusedOn(''));
    // The failure is still real and still observable — just not to the caller.
    await expect(settled).rejects.toThrow('no editor state');
    expect(host.events).toContain('operation.failed');
    await host.stop();
  });

  it('shares one id namespace with plain commands at compile time', () => {
    const module = defineModule('editors', (builder): undefined => {
      builder.commands.handle(Upcase, () => 'plain');
      builder.commands.handleTextEditor(Upcase, () => 'editor');
      return undefined;
    });

    expect(() => compileApplication({ name: 'sample', modules: [module] })).toThrow(
      /has handlers in both/
    );
  });

  it('rejects an unregistered text editor command', async () => {
    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [] }),
    });
    await host.start();
    await expect(host.commands.executeTextEditor('missing.command', focusedOn(''))).rejects.toThrow(
      /not found/
    );
    await host.stop();
  });
});
