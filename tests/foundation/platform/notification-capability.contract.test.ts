/**
 * Shared NotificationCapability contract for the fake and VS Code adapter, with
 * adapter-only MessageItem construction checks. The suite protects selection by
 * item identity/position, including duplicate titles; higher-level notification
 * policy is outside this port.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { NotificationCapability } from '../../../src/foundation/platform/ports.js';

/**
 * A stand-in for `vscode.window.show*Message`.
 *
 * It reproduces the one behaviour the adapter is built on: VS Code resolves
 * with **the exact item object** it was handed, not with a copy and not with a
 * title. `_pick(index)` therefore returns the object at that position, which is
 * what makes the adapter's `indexOf` meaningful.
 *
 * Written out here rather than shared with the fake on purpose. A helper used
 * by both sides would let one wrong idea satisfy the whole suite twice, and the
 * suite exists precisely to catch the two implementations disagreeing.
 */
const vscodeMock = vi.hoisted(() => {
  const state: { pick: number | undefined; last: unknown[] } = { pick: undefined, last: [] };

  const show = (_message: string, _options: unknown, ...items: unknown[]): Promise<unknown> => {
    state.last = items;
    const chosen = state.pick === undefined ? undefined : items[state.pick];
    return Promise.resolve(chosen);
  };

  return {
    state,
    module: {
      window: {
        showInformationMessage: show,
        showWarningMessage: show,
        showErrorMessage: show,
      },
    },
  };
});

vi.mock('vscode', () => vscodeMock.module);

const { createVSCodeNotificationCapability } =
  await import('../../../src/vscode/capabilities/notifications.js');
const { createFakeNotifications } = await import('../../../src/testing/fakes/fake-ui.js');

/** What "the user chose the item at this position" means for one implementation. */
interface Harness {
  readonly capability: NotificationCapability;
  /** Scripts the next dialog. `undefined` means the user dismissed it. */
  pick(index: number | undefined): void;
}

/**
 * One suite, run against every implementation of the port.
 *
 * The contract is entirely about *identity*: an action is chosen by position,
 * and the caller gets that position back. Everything above this port maps the
 * position to the action's own `value`, so an implementation that resolved by
 * title instead would hand the caller the wrong action whenever two of them
 * read the same — "Overwrite"/"Overwrite" in different scopes, or the same
 * word after translation.
 */
function describeNotificationCapability(name: string, makeHarness: () => Harness): void {
  describe(name, () => {
    it('returns the position of the chosen action', async () => {
      const harness = makeHarness();
      harness.pick(1);

      await expect(
        harness.capability.show('info', 'Changed on disk', {}, [
          { title: 'Reload' },
          { title: 'Ignore' },
        ])
      ).resolves.toBe(1);
    });

    it('distinguishes two actions that share a title', async () => {
      const harness = makeHarness();
      harness.pick(2);

      // The case a title lookup gets wrong, and the reason the port speaks in
      // positions rather than strings.
      await expect(
        harness.capability.show('warn', 'Overwrite?', { modal: true }, [
          { title: 'Overwrite' },
          { title: 'Overwrite' },
          { title: 'Overwrite' },
        ])
      ).resolves.toBe(2);
    });

    it('resolves undefined when the user dismisses the dialog', async () => {
      const harness = makeHarness();
      harness.pick(undefined);

      await expect(
        harness.capability.show('error', 'Failed', {}, [{ title: 'Retry' }])
      ).resolves.toBeUndefined();
    });

    it('resolves undefined for a message with no actions', async () => {
      const harness = makeHarness();
      harness.pick(undefined);

      await expect(harness.capability.show('info', 'Saved', {}, [])).resolves.toBeUndefined();
    });

    it('accepts every severity', async () => {
      for (const severity of ['info', 'warn', 'error'] as const) {
        const harness = makeHarness();
        harness.pick(0);

        await expect(
          harness.capability.show(severity, 'Message', {}, [{ title: 'Only' }])
        ).resolves.toBe(0);
      }
    });
  });
}

beforeEach(() => {
  vscodeMock.state.pick = undefined;
  vscodeMock.state.last = [];
});

describeNotificationCapability('FakeNotifications', () => {
  const capability = createFakeNotifications();
  return {
    capability,
    pick: (index) => {
      capability._respondWith(index);
    },
  };
});

describeNotificationCapability('VS Code adapter', () => ({
  capability: createVSCodeNotificationCapability(),
  pick: (index) => {
    vscodeMock.state.pick = index;
  },
}));

/**
 * Adapter-only: how the port's actions reach the platform.
 *
 * The fake never builds `MessageItem`s, so there is nothing here for it to
 * agree or disagree with.
 */
describe('VS Code adapter, item construction', () => {
  it('passes the titles through in order', async () => {
    const capability = createVSCodeNotificationCapability();
    vscodeMock.state.pick = 0;

    await capability.show('info', 'Pick', {}, [{ title: 'First' }, { title: 'Second' }]);

    expect(vscodeMock.state.last).toEqual([{ title: 'First' }, { title: 'Second' }]);
  });

  it('marks the close affordance only when one was declared', async () => {
    const capability = createVSCodeNotificationCapability();
    vscodeMock.state.pick = 0;

    await capability.show('warn', 'Discard?', { modal: true }, [
      { title: 'Discard' },
      { title: 'Cancel', isCloseAffordance: true },
    ]);

    // Absent rather than `false`: VS Code treats the property's presence as the
    // signal, and an explicit `false` on every item is noise in the dialog it
    // builds.
    expect(vscodeMock.state.last).toEqual([
      { title: 'Discard' },
      { title: 'Cancel', isCloseAffordance: true },
    ]);
  });
});
