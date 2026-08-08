import { describe, expect, it, vi } from 'vitest';

/**
 * Composition-root adapter suite.
 *
 * It pins what `defineExtension` adds to the activation context, activation
 * rollback, and the invariant that logging outlives asynchronous shutdown even
 * if VS Code disposes context subscriptions first. The foundation host's state
 * machine is tested elsewhere; this file changes when production capability
 * construction or the VS Code activation/deactivation boundary changes.
 */
const vscodeMock = vi.hoisted(() => {
  const channels: {
    name: string;
    disposed: boolean;
    lines: string[];
    dispose(): void;
  }[] = [];

  const makeChannel = (name: string) => {
    const log = (line: string): void => {
      if (channel.disposed) {
        throw new Error('Channel has been closed');
      }
      channel.lines.push(line);
    };
    const channel = {
      name,
      disposed: false,
      lines: [] as string[],
      trace: log,
      debug: log,
      info: log,
      warn: log,
      error: log,
      dispose(): void {
        channel.disposed = true;
      },
    };
    channels.push(channel);
    return channel;
  };

  return {
    channels,
    module: {
      UIKind: { Desktop: 1, Web: 2 },
      QuickInputButtons: { Back: { iconPath: 'back' } },
      env: { uiKind: 1, remoteName: undefined },
      workspace: { isTrusted: true, workspaceFolders: [] },
      window: {
        createOutputChannel: (name: string) => makeChannel(name),
      },
    },
  };
});

vi.mock('vscode', () => vscodeMock.module);

const { defineExtension } = await import('../../../src/vscode/foundation/extension.js');

function makeContext() {
  const subscriptions: { dispose(): unknown }[] = [];
  return { subscriptions } as never;
}

describe('defineExtension boundary', () => {
  it('puts exactly one entry on context.subscriptions: the failsafe', async () => {
    vscodeMock.channels.length = 0;
    const app = defineExtension({ name: 'Sample', modules: [] });
    const context = makeContext();

    await app.activate(context);
    const { subscriptions } = context as unknown as { subscriptions: { dispose(): unknown }[] };
    expect(subscriptions).toHaveLength(1);
    // The channel exists but is NOT parked on subscriptions.
    expect(vscodeMock.channels).toHaveLength(1);
    expect(vscodeMock.channels[0]?.disposed).toBe(false);

    await app.deactivate();
  });

  it('keeps the log channel alive through the whole stop pipeline', async () => {
    vscodeMock.channels.length = 0;
    const app = defineExtension({ name: 'Sample', modules: [] });
    const context = makeContext();
    await app.activate(context);

    // Exercise the hostile-but-supported order: subscriptions disappear while
    // deactivate() is still pending. Ownership must not depend on which callback
    // VS Code happens to settle first.
    const stopping = app.deactivate();
    for (const disposable of (context as unknown as { subscriptions: { dispose(): unknown }[] })
      .subscriptions) {
      disposable.dispose();
    }
    await stopping;

    // The channel outlived the stop pipeline (disposed at the very end),
    // so no shutdown log line ever hit a closed channel.
    expect(vscodeMock.channels[0]?.disposed).toBe(true);
    await expect(app.deactivate()).resolves.toBeUndefined();
  });

  it('disposes the channel when activation fails', async () => {
    vscodeMock.channels.length = 0;
    const { defineModule } = await import('../../../src/foundation/modules/definition.js');
    const bad = defineModule('bad', (builder): undefined => {
      builder.raw.register({
        id: 'bad.bind',
        bind: () => {
          throw new Error('bind failed');
        },
      });
      return undefined;
    });

    const app = defineExtension({ name: 'Sample', modules: [bad] });
    await expect(app.activate(makeContext())).rejects.toThrow('bind failed');
    expect(vscodeMock.channels[0]?.disposed).toBe(true);
  });
});

/**
 * What `activate` resolves to.
 *
 * VS Code reads an extension's API off that value — `extendMarkdownIt` for a
 * markdown plugin, whatever another extension consumes for the rest. It has to
 * be built from services, and services do not exist until the application has
 * started, so without a declaration the only way to get one out is a mutable
 * module variable filled by a hosted service and read afterwards. That is the
 * shape this replaces.
 */
const { defineModule } = await import('../../../src/foundation/modules/definition.js');
const { serviceToken } = await import('../../../src/foundation/services/token.js');

describe('defineExtension exports', () => {
  const Counter = serviceToken<{ next(): number }>('sample.counter');

  const counterModule = defineModule('counter', (module): undefined => {
    module.services.singleton(Counter, () => {
      let value = 0;
      return {
        next: () => {
          value += 1;
          return value;
        },
      };
    });
    return undefined;
  });

  it('resolves activate to the declared value, built from services', async () => {
    const app = defineExtension({
      name: 'Sample',
      modules: [counterModule],
      exports: {
        inject: { counter: Counter },
        create: ({ counter }) => ({ next: (): number => counter.next() }),
      },
    });

    const api = await app.activate(makeContext());

    expect(api.next()).toBe(1);
    expect(api.next()).toBe(2);
    await app.deactivate();
  });

  it('resolves to undefined when nothing is declared', async () => {
    const app = defineExtension({ name: 'Sample', modules: [] });

    await expect(app.activate(makeContext())).resolves.toBeUndefined();

    await app.deactivate();
  });

  it('hands back the same service instance the rest of the application uses', async () => {
    // Not a second container and not a second copy — the point of resolving it
    // through the framework rather than rebuilding it in `activate`.
    let fromHostedService: { next(): number } | undefined;
    const observer = defineModule('observer', (module): undefined => {
      module.hostedServices.add({
        id: 'observer',
        inject: { counter: Counter },
        start: (_context, { counter }) => {
          fromHostedService = counter;
        },
      });
      return undefined;
    });

    const app = defineExtension({
      name: 'Sample',
      modules: [counterModule, observer],
      exports: { inject: { counter: Counter }, create: ({ counter }) => counter },
    });

    const api = await app.activate(makeContext());

    expect(api).toBe(fromHostedService);
    await app.deactivate();
  });

  it('fails activation when building the value throws, and disposes the channel', async () => {
    vscodeMock.channels.length = 0;
    const app = defineExtension({
      name: 'Sample',
      modules: [counterModule],
      exports: {
        inject: { counter: Counter },
        create: (): never => {
          throw new Error('api construction failed');
        },
      },
    });

    await expect(app.activate(makeContext())).rejects.toThrow('api construction failed');
    // Rolled back like any other activation failure.
    expect(vscodeMock.channels[0]?.disposed).toBe(true);
  });
});
