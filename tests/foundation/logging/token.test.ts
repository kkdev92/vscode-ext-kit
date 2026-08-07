/**
 * Application/Test Host integration tests for the synthetic `Log` service.
 * They prove preflight registration and logger identity across service and
 * Operation paths; logger formatting and sink isolation belong to logger and
 * lifecycle tests.
 */
import { describe, expect, it } from 'vitest';

import { compileApplication } from '../../../src/foundation/application/plan.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import { Log } from '../../../src/foundation/logging/token.js';
import { defineModule } from '../../../src/foundation/modules/definition.js';
import { serviceToken } from '../../../src/foundation/services/token.js';
import { createTestHost } from '../../../src/testing/test-host.js';

interface Store {
  readonly ready: boolean;
}

const StoreToken = serviceToken<Store>('sample.store');
const Touch = defineCommandContract<readonly [], boolean>({ id: 'sample.touch' });

/**
 * A service has no OperationContext at construction time, so `Log` is its path
 * to the same root logger from which Operation loggers are derived.
 */
describe('Log token', () => {
  it('hands a service the logger operations derive from', async () => {
    const module = defineModule('sample', (builder): undefined => {
      builder.services.singleton(StoreToken, {
        inject: { log: Log },
        create: ({ log }) => {
          log.withFields({ service: 'store' }).warn('stored data was unusable');
          return { ready: true };
        },
      });
      builder.commands.handle(Touch, {
        inject: { store: StoreToken },
        execute: (_context, _args, { store }) => store.ready,
      });
      return undefined;
    });

    const host = createTestHost({
      plan: compileApplication({ name: 'sample', modules: [module] }),
    });
    await host.start();
    try {
      await expect(host.application.commands.execute(Touch)).resolves.toBe(true);

      const warning = host.logs.at('warn')[0];
      expect(warning?.message).toBe('stored data was unusable');
      // Tagged by the service, so an entry says where it came from.
      expect(warning?.fields).toMatchObject({ service: 'store' });
    } finally {
      await host.stop();
    }
  });

  it('passes preflight without any module registering it', () => {
    const module = defineModule('sample', (builder): undefined => {
      builder.commands.handle(Touch, {
        inject: { log: Log },
        execute: (_context, _args, { log }) => {
          log.info('touched');
          return true;
        },
      });
      return undefined;
    });

    // A framework token missing from preflight's provided set rejects an
    // otherwise valid application.
    expect(() => compileApplication({ name: 'sample', modules: [module] })).not.toThrow();
  });

  it('is injected under a stable token id', () => {
    expect(Log.id).toBe('framework.log');
  });
});
