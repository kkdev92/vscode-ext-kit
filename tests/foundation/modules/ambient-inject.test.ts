/**
 * Definition, preflight and Test Host coverage for Module-wide `uses` injection.
 * The suite protects name-collision rejection and the invariant that ambient
 * handler dependencies never leak into service factories or hide the service
 * graph.
 */
import { describe, expect, it } from 'vitest';

import { Notifications } from '../../../src/capabilities/ui/notifications.js';
import { compileApplication } from '../../../src/foundation/application/plan.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import { Log } from '../../../src/foundation/logging/token.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import { serviceToken } from '../../../src/foundation/services/token.js';
import { createTestHost } from '../../../src/testing/test-host.js';

const Greet = defineCommandContract<readonly [], string>({ id: 'sample.greet' });
const Count = defineCommandContract<readonly [], number>({ id: 'sample.count' });

const Repository = serviceToken<{ total: number }>('sample.repository');

/**
 * A Module's ambient service set removes repeated handler declarations while
 * keeping the dependency names and tokens visible to preflight.
 */
describe('defineModule uses', () => {
  it('hands every handler the module set, merged under its own inject', async () => {
    const module = defineModule(
      'sample',
      (builder): undefined => {
        builder.services.singleton(Repository, () => ({ total: 3 }));

        // No `inject` at all: the ambient set is the whole point of this shape.
        builder.commands.handle(Greet, (_context, _args, { notify }) => {
          void notify;
          return 'hi';
        });

        // Ambient plus one of its own.
        builder.commands.handle(Count, {
          inject: { repository: Repository },
          execute: (_context, _args, { log, repository }) => {
            log.debug('counting');
            return repository.total;
          },
        });

        return undefined;
      },
      { uses: { notify: Notifications, log: Log } }
    );

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();
    try {
      await expect(host.application.commands.execute(Greet)).resolves.toBe('hi');
      await expect(host.application.commands.execute(Count)).resolves.toBe(3);
      expect(host.logs.at('debug').map((entry) => entry.message)).toContain('counting');
    } finally {
      await host.stop();
    }
  });

  it('rejects a handler that reuses an ambient name', () => {
    expect(() =>
      defineModule(
        'sample',
        (builder): undefined => {
          builder.commands.handle(Greet, {
            // `notify` is already the module's; resolving this by precedence
            // would silently hand the handler the wrong object.
            inject: { notify: Repository },
            execute: () => 'hi',
          });
          return undefined;
        },
        { uses: { notify: Notifications } }
      )
    ).toThrow(/injects "notify".*already declares .* `uses`/s);
  });

  it('leaves the service graph explicit', async () => {
    let injectedKeys: readonly string[] = [];
    const module = defineModule(
      'sample',
      (builder): undefined => {
        builder.services.singleton(Repository, {
          inject: {},
          create: (injected) => {
            injectedKeys = Object.keys(injected);
            return { total: 1 };
          },
        });
        builder.commands.handle(Count, {
          inject: { repository: Repository },
          execute: (_context, _args, { repository }) => repository.total,
        });
        return undefined;
      },
      { uses: { notify: Notifications, log: Log } }
    );

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();
    try {
      await expect(host.application.commands.execute(Count)).resolves.toBe(1);
      // A service's dependencies *are* the architecture: preflight validates
      // them as a graph, and an ambient entry could both hide a dependency and
      // let a service in the ambient set depend on itself.
      expect(injectedKeys).toEqual([]);
    } finally {
      await host.stop();
    }
  });

  it('is still checked by preflight', () => {
    const Missing = serviceToken<object>('sample.missing');
    const module = defineModule(
      'sample',
      (builder): undefined => {
        builder.commands.handle(Greet, () => 'hi');
        return undefined;
      },
      { uses: { missing: Missing } }
    );

    // Declared once for the Module, but no less visible to preflight.
    expect(() => compileApplication({ name: 'sample', modules: [module] })).toThrow(
      /sample\.missing/
    );
  });

  it('accepts the options before the callback, so the body stays flat', async () => {
    // The reason the overload exists: with options last, the call wraps and
    // every line of the module gains a level of indentation for one word.
    const module = defineModule('sample', { uses: { notify: Notifications } }, (builder) => {
      builder.commands.handle(Greet, (_context, _args, { notify }) => {
        void notify;
        return 'hi';
      });
      return undefined;
    });

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();
    try {
      await expect(host.application.commands.execute(Greet)).resolves.toBe('hi');
    } finally {
      await host.stop();
    }
  });

  it('rejects a call with no callback at all', () => {
    expect(() =>
      (defineModule as unknown as (id: string, options: object) => unknown)('sample', {})
    ).toThrow(/without a configure callback/);
  });

  it('changes nothing for a module that declares no set', async () => {
    const module = defineModule('sample', (builder): undefined => {
      builder.commands.handle(Greet, () => 'hi');
      return undefined;
    });

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();
    try {
      await expect(host.application.commands.execute(Greet)).resolves.toBe('hi');
    } finally {
      await host.stop();
    }
  });
});
