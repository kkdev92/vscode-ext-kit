/**
 * In-memory UI integration suite for the typed wizard state machine. It
 * protects state accumulation, Back/path pruning, optional and branch
 * recomputation, cancellation results, callback phase errors, validation races,
 * abort cleanup, and listener ownership. Failures usually indicate navigation
 * state or step settlement rather than the native adapter.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  WizardStepError,
  createWizard,
  inputStep,
  quickpickStep,
} from '../../../src/capabilities/ui/wizard.js';
import { createFakeQuickInput } from '../../../src/testing/fakes/fake-quick-input.js';
import type { PickItem } from '../../../src/capabilities/ui/quick-input.js';

afterEach(() => {
  vi.useRealTimers();
});

const item = <T>(value: T, label: string): PickItem<T> => ({ value, label });

const typeItems = [item('feature' as const, 'Feature'), item('fix' as const, 'Bug Fix')];

describe('wizard', () => {
  it('accumulates typed state across steps and resolves the exact final state', async () => {
    const ui = createFakeQuickInput();
    const pending = createWizard(ui)
      .step('type', quickpickStep({ items: () => typeItems }))
      .step('name', inputStep({ prompt: 'Branch name' }))
      .run({ title: 'Create Branch' });

    const quickPick = ui.quickPicks[0];
    expect(quickPick).toMatchObject({ title: 'Create Branch', step: 1, totalSteps: 2 });
    quickPick?._accept([typeItems[0] as PickItem<'feature' | 'fix'>]);

    await vi.waitFor(() => {
      expect(ui.inputBoxes).toHaveLength(1);
    });
    const inputBox = ui.inputBoxes[0];
    expect(inputBox).toMatchObject({ step: 2, totalSteps: 2, ignoreFocusOut: true });
    inputBox?._type('add-widgets');
    inputBox?._accept();

    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) {
      const state: { type: 'feature' | 'fix'; name: string } = result.value;
      expect(state).toEqual({ type: 'feature', name: 'add-widgets' });
    }
  });

  it('reports cancellation with the step key and partial state', async () => {
    const ui = createFakeQuickInput();
    const pending = createWizard(ui)
      .step('type', quickpickStep({ items: () => typeItems }))
      .step('name', inputStep({ prompt: 'Branch name' }))
      .run({ title: 'Create Branch' });

    ui.quickPicks[0]?._accept([typeItems[1] as PickItem<'feature' | 'fix'>]);
    await vi.waitFor(() => {
      expect(ui.inputBoxes).toHaveLength(1);
    });
    ui.inputBoxes[0]?._hide();

    const result = await pending;
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.cancelled).toBe(true);
      expect(result.error.atKey).toBe('name');
      expect(result.error.state).toEqual({ type: 'fix' });
    }
  });

  it('skips optional steps and leaves their key absent', async () => {
    const ui = createFakeQuickInput();
    const pending = createWizard(ui)
      .step('type', quickpickStep({ items: () => typeItems }))
      .optionalStep('description', inputStep({ prompt: 'Describe' }), {
        skip: (state) => state.type === 'fix',
      })
      .run({ title: 'W' });

    ui.quickPicks[0]?._accept([typeItems[1] as PickItem<'feature' | 'fix'>]);

    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ type: 'fix' });
      expect('description' in result.value).toBe(false);
    }
  });

  it('walks back with the platform back button and prunes keys no longer on the path', async () => {
    const ui = createFakeQuickInput();
    const pending = createWizard(ui)
      .step('type', quickpickStep({ items: () => typeItems }))
      .step('name', inputStep({ prompt: 'Name' }))
      .run({ title: 'W' });

    // First step has no back button; the second shows the platform sentinel.
    expect(ui.quickPicks[0]?.buttons).toEqual([]);
    ui.quickPicks[0]?._accept([typeItems[0] as PickItem<'feature' | 'fix'>]);
    await vi.waitFor(() => {
      expect(ui.inputBoxes).toHaveLength(1);
    });
    expect(ui.inputBoxes[0]?.buttons).toEqual([ui.backButton]);

    ui.inputBoxes[0]?._triggerButton(ui.backButton);
    // Back re-runs the first step; answering differently must not leak the
    // pruned key later.
    await vi.waitFor(() => {
      expect(ui.quickPicks).toHaveLength(2);
    });
    ui.quickPicks[1]?._accept([typeItems[1] as PickItem<'feature' | 'fix'>]);
    await vi.waitFor(() => {
      expect(ui.inputBoxes).toHaveLength(2);
    });
    ui.inputBoxes[1]?._type('hotfix');
    ui.inputBoxes[1]?._accept();

    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ type: 'fix', name: 'hotfix' });
    }
  });

  it('branches on accumulated state', async () => {
    const ui = createFakeQuickInput();
    const featureBranch = createWizard(ui).step('featureName', inputStep({ prompt: 'Feature' }));
    const fixBranch = createWizard(ui).step('bugId', inputStep({ prompt: 'Bug id' }));

    const pending = createWizard(ui)
      .step('type', quickpickStep({ items: () => typeItems }))
      .branch<Record<'featureName', string> | Record<'bugId', string>>(
        (state) =>
          (state.type === 'feature' ? featureBranch : fixBranch) as ReturnType<
            typeof createWizard
          > as never
      )
      .run({ title: 'W' });

    ui.quickPicks[0]?._accept([typeItems[1] as PickItem<'feature' | 'fix'>]);
    await vi.waitFor(() => {
      expect(ui.inputBoxes).toHaveLength(1);
    });
    expect(ui.inputBoxes[0]?.prompt).toBe('Bug id');
    ui.inputBoxes[0]?._type('BUG-42');
    ui.inputBoxes[0]?._accept();

    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ type: 'fix', bugId: 'BUG-42' });
    }
  });

  it('hides step numbering when showStepNumbers is false', async () => {
    const ui = createFakeQuickInput();
    const pending = createWizard(ui)
      .step('type', quickpickStep({ items: () => typeItems }))
      .run({ title: 'W', showStepNumbers: false });

    expect(ui.quickPicks[0]?.step).toBeUndefined();
    expect(ui.quickPicks[0]?.totalSteps).toBeUndefined();
    ui.quickPicks[0]?._hide();
    await pending;
  });

  it('does not double-settle when a step accept races the teardown', async () => {
    const ui = createFakeQuickInput();
    const pending = createWizard(ui)
      .step('type', quickpickStep({ items: () => typeItems }))
      .run({ title: 'W' });

    const quickPick = ui.quickPicks[0];
    quickPick?._accept([typeItems[0] as PickItem<'feature' | 'fix'>]);
    // The accept disposed a visible quick pick, which fired onDidHide
    // reentrantly; the cancel outcome must have lost to the claimed value.
    expect(quickPick?.disposed).toBe(true);

    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ type: 'feature' });
    }
  });

  it('supports multi-select steps', async () => {
    const ui = createFakeQuickInput();
    const flags = [item('a', 'A'), item('b', 'B')];
    const pending = createWizard(ui)
      .step('flags', quickpickStep({ canPickMany: true, items: () => flags }))
      .run({ title: 'W' });

    expect(ui.quickPicks[0]?.canSelectMany).toBe(true);
    ui.quickPicks[0]?._accept(flags);

    const result = await pending;
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.flags).toEqual(['a', 'b']);
    }
  });

  describe('failures', () => {
    it('wraps an async items failure as WizardStepError with phase load', async () => {
      const ui = createFakeQuickInput();
      const pending = createWizard(ui)
        .step('type', quickpickStep({ items: () => Promise.reject(new Error('list unavailable')) }))
        .run({ title: 'W' });

      await expect(pending).rejects.toMatchObject({
        name: 'WizardStepError',
        atKey: 'type',
        phase: 'load',
      });
      await pending.catch((error: unknown) => {
        expect(error).toBeInstanceOf(WizardStepError);
        expect((error as WizardStepError).cause).toMatchObject({
          message: 'list unavailable',
        });
      });
    });

    it('wraps a validator failure as WizardStepError with phase validate', async () => {
      const ui = createFakeQuickInput();
      const pending = createWizard(ui)
        .step(
          'name',
          inputStep({ prompt: 'n', validate: () => Promise.reject(new Error('backend down')) })
        )
        .run({ title: 'W' });

      ui.inputBoxes[0]?._accept();
      await expect(pending).rejects.toMatchObject({
        name: 'WizardStepError',
        atKey: 'name',
        phase: 'validate',
      });
    });

    it('wraps a branch failure as WizardStepError with phase branch', async () => {
      const ui = createFakeQuickInput();
      const pending = createWizard(ui)
        .branch(() => {
          throw new Error('cannot decide');
        })
        .run({ title: 'W' });

      await expect(pending).rejects.toMatchObject({
        name: 'WizardStepError',
        atKey: '(branch)',
        phase: 'branch',
      });
    });
  });

  describe('validation', () => {
    it('re-validates on accept and blocks until valid', async () => {
      const ui = createFakeQuickInput();
      const pending = createWizard(ui)
        .step(
          'name',
          inputStep({
            prompt: 'n',
            validate: (value) => (value.length < 3 ? 'Too short' : undefined),
          })
        )
        .run({ title: 'W' });

      const inputBox = ui.inputBoxes[0];
      inputBox?._type('ab');
      inputBox?._accept();
      await Promise.resolve();
      expect(inputBox?.validationMessage).toBe('Too short');
      expect(inputBox?.disposed).toBe(false);

      inputBox?._type('abc');
      inputBox?._accept();
      const result = await pending;
      expect(result.ok).toBe(true);
    });

    it('discards a stale live-validation result after the value moved on', async () => {
      vi.useFakeTimers();
      const ui = createFakeQuickInput();
      const resolvers: ((message: string | undefined) => void)[] = [];
      const pending = createWizard(ui)
        .step(
          'name',
          inputStep({
            prompt: 'n',
            validate: () =>
              new Promise<string | undefined>((resolve) => {
                resolvers.push(resolve);
              }),
          })
        )
        .run({ title: 'W' });

      const inputBox = ui.inputBoxes[0];
      inputBox?._type('first');
      await vi.advanceTimersByTimeAsync(100);
      expect(resolvers).toHaveLength(1);

      // The value changes while the first validation is still in flight.
      inputBox?._type('second');
      resolvers[0]?.('stale message');
      await Promise.resolve();
      expect(inputBox?.validationMessage).toBeUndefined();

      inputBox?._hide();
      await vi.runAllTimersAsync();
      const result = await pending;
      expect(result.ok).toBe(false);
    });
  });

  describe('signal', () => {
    it('cancels the open step when the signal aborts', async () => {
      const ui = createFakeQuickInput();
      const controller = new AbortController();
      const pending = createWizard(ui)
        .step('type', quickpickStep({ items: () => typeItems }))
        .run({ title: 'W', signal: controller.signal });

      controller.abort();
      const result = await pending;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.atKey).toBe('type');
      }
      expect(ui.quickPicks[0]?.disposed).toBe(true);
    });

    it('never opens a step for an already-aborted signal', async () => {
      const ui = createFakeQuickInput();
      const controller = new AbortController();
      controller.abort();

      const result = await createWizard(ui)
        .step('type', quickpickStep({ items: () => typeItems }))
        .run({ title: 'W', signal: controller.signal });

      expect(result.ok).toBe(false);
      expect(ui.quickPicks).toHaveLength(0);
    });
  });

  it('requires a quick-input surface from somewhere', async () => {
    await expect(
      createWizard()
        .step('type', quickpickStep({ items: () => typeItems }))
        .run({ title: 'W' })
    ).rejects.toThrow(/no quick-input surface/);

    const ui = createFakeQuickInput();
    const pending = createWizard()
      .step('type', quickpickStep({ items: () => typeItems }))
      .run({ title: 'W', ui });
    ui.quickPicks[0]?._hide();
    await pending;
  });

  it('cleans up listeners on every settled step', async () => {
    const ui = createFakeQuickInput();
    const pending = createWizard(ui)
      .step('name', inputStep({ prompt: 'n', validate: () => undefined }))
      .run({ title: 'W' });

    ui.inputBoxes[0]?._type('x');
    ui.inputBoxes[0]?._accept();
    await pending;
    expect(ui.inputBoxes[0]?.listenerCount).toBe(0);
  });
});
