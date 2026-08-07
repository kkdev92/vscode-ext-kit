/**
 * Test Host integration tests for lazy standard services on OperationContext.
 * They protect zero-declaration access, non-enumerability and identity with
 * explicit DI tokens; individual capability behavior is tested elsewhere.
 */
import { describe, expect, it } from 'vitest';

import { Notifications } from '../../../src/capabilities/ui/notifications.js';
import { compileApplication } from '../../../src/foundation/application/plan.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import { createTestHost } from '../../../src/testing/test-host.js';

const Ask = defineCommandContract<readonly [], string>({ id: 'sample.ask' });
const Quiet = defineCommandContract<readonly [], string>({ id: 'sample.quiet' });

/**
 * The common services a handler finds on its OperationContext without repeating
 * dependency declarations. They remain lazy aliases for the canonical tokens.
 */
describe('standard services on the operation context', () => {
  it('are there without any inject', async () => {
    const module = defineModule('sample', (builder): undefined => {
      // No `inject`, no `uses`, no service registration.
      builder.commands.handle(Ask, async (context) => {
        await context.notify.info(context.l10n.t('hello'));
        return context.l10n.language;
      });
      return undefined;
    });

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();
    try {
      await expect(host.application.commands.execute(Ask)).resolves.toBe('en');
      expect(host.notifications.shown.map((entry) => entry.message)).toEqual(['hello']);
    } finally {
      await host.stop();
    }
  });

  it('resolve only when touched', async () => {
    const module = defineModule('sample', (builder): undefined => {
      builder.commands.handle(Quiet, (context) => {
        // Reads the context, but none of the standard services.
        return context.name;
      });
      return undefined;
    });

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();
    try {
      await expect(host.application.commands.execute(Quiet)).resolves.toBe('sample.quiet');
      // Laziness is the whole reason these are getters: an application that
      // never notifies must not build a notifier, and one whose capability is
      // missing should only find out if it asks.
      expect(host.notifications.shown).toEqual([]);
    } finally {
      await host.stop();
    }
  });

  it('are not enumerable, so spreading a context resolves nothing', async () => {
    let keys: readonly string[] = [];
    const module = defineModule('sample', (builder): undefined => {
      builder.commands.handle(Quiet, (context) => {
        keys = Object.keys(context);
        return context.name;
      });
      return undefined;
    });

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();
    try {
      await host.application.commands.execute(Quiet);
      expect(keys).not.toContain('notify');
      expect(keys).toContain('logger');
    } finally {
      await host.stop();
    }
  });

  it('reach the same instance an explicit inject would', async () => {
    const Same = defineCommandContract<readonly [], boolean>({ id: 'sample.same' });
    const module = defineModule('sample', (builder): undefined => {
      builder.commands.handle(Same, {
        inject: { notify: Notifications },
        // Not a second way in: `context.notify` resolves the very token the
        // handler declared, out of the same container.
        execute: (context, _args, { notify }) => context.notify === notify,
      });
      return undefined;
    });

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();
    try {
      await expect(host.application.commands.execute(Same)).resolves.toBe(true);
    } finally {
      await host.stop();
    }
  });
});
