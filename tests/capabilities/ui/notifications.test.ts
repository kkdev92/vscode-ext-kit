/**
 * Unit contract for notification result mapping and confirmation policy over a
 * fake capability. It protects positional action identity, dismissal and
 * suppression defaults, remembered affirmative choices, and platform-error
 * propagation. Failures should be investigated before application UI wiring.
 */
import { describe, expect, it } from 'vitest';

import { createNotifier } from '../../../src/capabilities/ui/notifications.js';
import type { RememberedChoice } from '../../../src/capabilities/ui/notifications.js';
import { createFakeNotifications } from '../../../src/testing/fakes/fake-ui.js';

/** Stands in for a `TypedStorage<boolean>`, which is what production passes. */
const rememberedChoice = (): RememberedChoice & { stored: unknown } => {
  let stored: unknown;
  return {
    get stored(): unknown {
      return stored;
    },
    set stored(value: unknown) {
      stored = value;
    },
    get: () => stored as boolean | undefined,
    set: (value: boolean) => {
      stored = value;
    },
  };
};

describe('createNotifier', () => {
  it('returns the clicked action value and records severity, modal and detail', async () => {
    const capability = createFakeNotifications();
    const notifier = createNotifier(capability);

    capability._respondWith(0);
    const choice = await notifier.warn('Unsaved changes', {
      modal: true,
      detail: 'Two files changed.',
      actions: [
        { title: 'Save', value: 'save' as const },
        { title: 'Discard', value: 'discard' as const, isCloseAffordance: true },
      ],
    });

    expect(choice).toBe('save');
    expect(capability.shown).toEqual([
      {
        severity: 'warn',
        message: 'Unsaved changes',
        modal: true,
        detail: 'Two files changed.',
        actionTitles: ['Save', 'Discard'],
      },
    ]);
  });

  it('resolves duplicate titles by position, never by label', async () => {
    const capability = createFakeNotifications();
    const notifier = createNotifier(capability);

    capability._respondWith(1);
    const choice = await notifier.info('Pick one', {
      actions: [
        { title: 'OK', value: 'first' },
        { title: 'OK', value: 'second' },
      ],
    });

    expect(choice).toBe('second');
  });

  it('resolves undefined for a plain notification and for a dismissal', async () => {
    const capability = createFakeNotifications();
    const notifier = createNotifier(capability);

    await expect(notifier.info('Done')).resolves.toBeUndefined();
    // No scripted response: the user hit Escape.
    await expect(
      notifier.error('Failed', { actions: [{ title: 'Retry', value: 'retry' }] })
    ).resolves.toBeUndefined();
    expect(capability.shown).toHaveLength(2);
  });

  it('propagates a platform failure to the caller', async () => {
    const capability = createFakeNotifications();
    const notifier = createNotifier(capability);

    capability._failNext(new Error('display unavailable'));
    await expect(notifier.info('hello')).rejects.toThrow('display unavailable');
  });

  it('suppresses everything once isSuppressed reports true', async () => {
    const capability = createFakeNotifications();
    const events: string[] = [];
    let stopping = false;
    const notifier = createNotifier(capability, {
      isSuppressed: () => stopping,
      onDiagnostic: (event) => events.push(event),
    });

    await expect(notifier.info('before')).resolves.toBeUndefined();
    expect(capability.shown).toHaveLength(1);

    stopping = true;
    await expect(notifier.warn('during shutdown')).resolves.toBeUndefined();
    await expect(notifier.confirm('Proceed?')).resolves.toBe(false);
    expect(capability.shown).toHaveLength(1);
    expect(events).toEqual(['notification.suppressed', 'notification.suppressed']);
  });

  describe('confirm', () => {
    it('maps Yes, No and dismissal; defaults to a warning modal', async () => {
      const capability = createFakeNotifications();
      const notifier = createNotifier(capability);

      capability._respondWith(0);
      await expect(notifier.confirm('Delete this file?')).resolves.toBe(true);
      capability._respondWith(1);
      await expect(notifier.confirm('Delete this file?')).resolves.toBe(false);
      await expect(notifier.confirm('Delete this file?')).resolves.toBe(false);

      expect(capability.shown[0]).toMatchObject({
        severity: 'warn',
        modal: true,
        actionTitles: ['Yes', 'No'],
      });
    });

    it('honours custom button text and severity', async () => {
      const capability = createFakeNotifications();
      const notifier = createNotifier(capability);

      capability._respondWith(0);
      await expect(
        notifier.confirm('Enable feature?', {
          severity: 'info',
          yesText: 'Enable',
          noText: 'Not now',
          modal: false,
        })
      ).resolves.toBe(true);

      expect(capability.shown[0]).toMatchObject({
        severity: 'info',
        modal: false,
        actionTitles: ['Enable', 'Not now'],
      });
    });

    it('persists the remembered yes and skips the prompt afterwards, with a diagnostic', async () => {
      const capability = createFakeNotifications();
      const events: string[] = [];
      const notifier = createNotifier(capability, { onDiagnostic: (event) => events.push(event) });
      const acknowledged = rememberedChoice();

      capability._respondWith(2); // the remembering button
      await expect(
        notifier.confirm('Run linter on save?', {
          remember: acknowledged,
        })
      ).resolves.toBe(true);
      expect(acknowledged.stored).toBe(true);
      // The label states the decision it stores. `"Don't Ask Again"` would read
      // as a dismissal while recording consent to everything that follows.
      expect(capability.shown[0]?.actionTitles).toEqual(['Yes', 'No', 'Yes, Always']);

      // Second call never reaches the platform.
      await expect(
        notifier.confirm('Run linter on save?', {
          remember: acknowledged,
        })
      ).resolves.toBe(true);
      expect(capability.shown).toHaveLength(1);
      expect(events).toContain('notification.confirmSkipped');
    });

    it('lets the caller word the remembering button, for localization', async () => {
      const capability = createFakeNotifications();
      const notifier = createNotifier(capability);

      capability._respondWith(1);
      await notifier.confirm('Trust this workspace?', {
        remember: rememberedChoice(),
        rememberText: 'Always trust',
      });

      expect(capability.shown[0]?.actionTitles).toEqual(['Yes', 'No', 'Always trust']);
    });

    it('ignores a stored value that is not exactly true', async () => {
      const capability = createFakeNotifications();
      const notifier = createNotifier(capability);
      const acknowledged = rememberedChoice();
      acknowledged.stored = 'yes'; // an invalid stored value must not authorize

      capability._respondWith(1);
      await expect(notifier.confirm('Proceed?', { remember: acknowledged })).resolves.toBe(false);
      expect(capability.shown).toHaveLength(1);
    });
  });
});
