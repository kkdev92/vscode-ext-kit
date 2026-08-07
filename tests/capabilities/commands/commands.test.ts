/**
 * Unit contract for outbound command invocation through `CommandsService`.
 * It protects argument/result/error pass-through and contract-id dispatch; a
 * failure points first to the service-to-`CommandCapability` delegation rather
 * than command registration or the application operation pipeline.
 */
import { describe, expect, it } from 'vitest';

import { Commands, createCommandsService } from '../../../src/capabilities/commands/commands.js';
import { defineCommandContract } from '../../../src/foundation/commands/contract.js';
import { createFakeCommands } from '../../../src/testing/fakes/fake-commands.js';

describe('CommandsService', () => {
  it('passes the id and arguments through, and returns the result', async () => {
    const capability = createFakeCommands();
    capability.register('sample.sum', (...args) => (args as number[]).reduce((a, b) => a + b, 0));

    const result = await createCommandsService(capability).execute<number>('sample.sum', 1, 2, 3);

    expect(result).toBe(6);
  });

  it('rejects with what the command threw', async () => {
    const capability = createFakeCommands();
    capability.register('sample.fail', () => {
      throw new Error('nope');
    });

    await expect(createCommandsService(capability).execute('sample.fail')).rejects.toThrow('nope');
  });

  it('invokes a contract by its declared id', async () => {
    const Refresh = defineCommandContract<readonly [force: boolean], number>({
      id: 'sample.refresh',
    });
    const capability = createFakeCommands();
    capability.register('sample.refresh', (force) => (force === true ? 2 : 1));

    // The point of `invoke`: the id comes from the contract, so a renamed
    // command cannot leave a stale string behind at a call site.
    const count = await createCommandsService(capability).invoke(Refresh, true);

    expect(count).toBe(2);
  });

  it('is injected under a stable token id', () => {
    expect(Commands.id).toBe('framework.commands');
  });
});
