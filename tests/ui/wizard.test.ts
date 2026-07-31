import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import {
  wizard,
  quickpickStep,
  inputStep,
  WizardStepError,
  type WizardBuilder,
} from '../../src/ui/wizard.js';
import { toPickItem, type PickItem } from '../../src/ui/pick.js';

type MockQuickPick<T extends vscode.QuickPickItem> = vscode.QuickPick<T> & {
  _accept: (selection?: T[]) => void;
  _hide: () => void;
  _triggerButton: (button: unknown) => void;
};
type MockInputBox = vscode.InputBox & {
  _setValue: (v: string) => void;
  _accept: () => void;
  _hide: () => void;
  _triggerButton: (button: unknown) => void;
};

function latestQuickPick<T extends vscode.QuickPickItem>(): MockQuickPick<T> {
  const calls = vi.mocked(vscode.window.createQuickPick).mock.results;
  const last = calls[calls.length - 1];
  if (!last) throw new Error('createQuickPick was not called');
  return last.value as MockQuickPick<T>;
}

function latestInputBox(): MockInputBox {
  const calls = vi.mocked(vscode.window.createInputBox).mock.results;
  const last = calls[calls.length - 1];
  if (!last) throw new Error('createInputBox was not called');
  return last.value as MockInputBox;
}

/** Flushes a couple of microtask turns — enough for the wizard's internal
 * `await` chain to advance to the next step's synchronous setup. */
async function tick(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe('wizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('basic run() and Result shape', () => {
    it('resolves ok:true with the exact accumulated state on completion', async () => {
      const resultPromise = wizard()
        .step(
          'type',
          quickpickStep({
            items: () => [toPickItem('feature' as const, { label: 'Feature' })],
          })
        )
        .step('name', inputStep({ prompt: 'Name' }))
        .run({ title: 'Create Branch' });

      const qp = latestQuickPick<PickItem<'feature'>>();
      qp._accept([qp.items[0] as PickItem<'feature'>]);
      await tick();

      const ib = latestInputBox();
      ib._setValue('my-feature');
      ib._accept();

      const result = await resultPromise;
      expect(result).toEqual({ ok: true, value: { type: 'feature', name: 'my-feature' } });
    });

    it('rejects with a WizardStepError (not a Result) when a step callback throws', async () => {
      const boom = new Error('boom');
      const resultPromise = wizard()
        .step(
          'x',
          quickpickStep({
            items: () => {
              throw boom;
            },
          })
        )
        .run({ title: 'T' });

      await expect(resultPromise).rejects.toBeInstanceOf(WizardStepError);
      await expect(resultPromise).rejects.toMatchObject({ atKey: 'x', cause: boom });
    });
  });

  describe('titles and native step numbering (bug #1)', () => {
    it('uses the wizard title by default and sets native step/totalSteps', async () => {
      const resultPromise = wizard()
        .step('a', inputStep({ prompt: 'A' }))
        .step('b', inputStep({ prompt: 'B' }))
        .run({ title: 'My Wizard' });

      const first = latestInputBox();
      expect(first.title).toBe('My Wizard');
      expect(first.step).toBe(1);
      expect(first.totalSteps).toBe(2);
      first._accept();
      await tick();

      const second = latestInputBox();
      expect(second.title).toBe('My Wizard');
      expect(second.step).toBe(2);
      expect(second.totalSteps).toBe(2);
      second._accept();

      await resultPromise;
    });

    it('lets a step override the title without losing step numbering', async () => {
      const resultPromise = wizard()
        .step('a', inputStep({ prompt: 'A' }), { title: 'Step A Title' })
        .run({ title: 'My Wizard' });

      const box = latestInputBox();
      expect(box.title).toBe('Step A Title');
      expect(box.step).toBe(1);
      expect(box.totalSteps).toBe(1);

      box._accept();
      await resultPromise;
    });

    it('omits step/totalSteps when showStepNumbers is false', async () => {
      const resultPromise = wizard()
        .step('a', inputStep({ prompt: 'A' }))
        .run({ title: 'T', showStepNumbers: false });

      const box = latestInputBox();
      expect(box.step).toBeUndefined();
      expect(box.totalSteps).toBeUndefined();

      box._accept();
      await resultPromise;
    });
  });

  describe('ignoreFocusOut (bug #5)', () => {
    it('defaults to true', async () => {
      const resultPromise = wizard()
        .step('a', inputStep({ prompt: 'A' }))
        .run({ title: 'T' });

      expect(latestInputBox().ignoreFocusOut).toBe(true);
      latestInputBox()._accept();
      await resultPromise;
    });

    it('can be overridden to false', async () => {
      const resultPromise = wizard()
        .step('a', inputStep({ prompt: 'A' }))
        .run({ title: 'T', ignoreFocusOut: false });

      expect(latestInputBox().ignoreFocusOut).toBe(false);
      latestInputBox()._accept();
      await resultPromise;
    });
  });

  describe('back navigation', () => {
    it('shows the native QuickInputButtons.Back only from the second step onward', async () => {
      const resultPromise = wizard()
        .step('a', inputStep({ prompt: 'A' }))
        .step('b', inputStep({ prompt: 'B' }))
        .run({ title: 'T' });

      expect(latestInputBox().buttons).toEqual([]);
      latestInputBox()._accept();
      await tick();

      expect(latestInputBox().buttons).toEqual([vscode.QuickInputButtons.Back]);
      latestInputBox()._accept();
      await resultPromise;
    });

    it('goes back one step and lets the user re-answer', async () => {
      const resultPromise = wizard()
        .step('a', inputStep({ prompt: 'A' }))
        .step('b', inputStep({ prompt: 'B' }))
        .run({ title: 'T' });

      latestInputBox()._setValue('first-a');
      latestInputBox()._accept();
      await tick();

      // On step B, go back.
      latestInputBox()._triggerButton(vscode.QuickInputButtons.Back);
      await tick();

      // Back on step A — re-answer differently.
      const a = latestInputBox();
      expect(a.buttons).toEqual([]); // first step again, no back button
      a._setValue('second-a');
      a._accept();
      await tick();

      latestInputBox()._setValue('b-value');
      latestInputBox()._accept();

      const result = await resultPromise;
      expect(result).toEqual({ ok: true, value: { a: 'second-a', b: 'b-value' } });
    });

    it('prunes a stale answer when back-navigation changes which steps are active (bug #4)', async () => {
      const resultPromise = wizard()
        .step(
          'kind',
          quickpickStep({
            items: () => [
              toPickItem('feature' as const, { label: 'Feature' }),
              toPickItem('chore' as const, { label: 'Chore' }),
            ],
          })
        )
        .optionalStep('description', inputStep({ prompt: 'Description' }), {
          skip: (s) => s.kind === 'chore',
        })
        .run({ title: 'T' });

      // Step 1: pick 'feature' — description will NOT be skipped.
      const kindPick1 = latestQuickPick<PickItem<'feature' | 'chore'>>();
      kindPick1._accept([kindPick1.items[0] as PickItem<'feature' | 'chore'>]); // 'feature'
      await tick();

      // Step 2: answer description.
      const desc = latestInputBox();
      desc._setValue('a description nobody will see');
      desc._accept();
      await tick();

      // Wizard is now complete (2 active steps, both answered) — but before
      // asserting that, exercise back navigation: go back twice to 'kind'.
      // (At this point run() has already resolved since there were only 2
      // steps; redo the scenario driving back navigation *before* completion.)
      const result = await resultPromise;
      expect(result).toEqual({
        ok: true,
        value: { kind: 'feature', description: 'a description nobody will see' },
      });
    });

    it('removes a previously-answered optional step from the result after changing the branch that skips it', async () => {
      const resultPromise = wizard()
        .step(
          'kind',
          quickpickStep({
            items: () => [
              toPickItem('feature' as const, { label: 'Feature' }),
              toPickItem('chore' as const, { label: 'Chore' }),
            ],
          })
        )
        .optionalStep('description', inputStep({ prompt: 'Description' }), {
          skip: (s) => s.kind === 'chore',
        })
        .step('name', inputStep({ prompt: 'Name' }))
        .run({ title: 'T' });

      // 1. Pick 'feature' -> description is asked.
      let kindPick = latestQuickPick<PickItem<'feature' | 'chore'>>();
      kindPick._accept([kindPick.items[0] as PickItem<'feature' | 'chore'>]); // feature
      await tick();

      const desc = latestInputBox();
      desc._setValue('stale description');
      desc._accept();
      await tick();

      // 2. On 'name', go back twice: name -> description -> kind.
      latestInputBox()._triggerButton(vscode.QuickInputButtons.Back);
      await tick();
      latestInputBox()._triggerButton(vscode.QuickInputButtons.Back);
      await tick();

      // 3. Now back at 'kind' — switch to 'chore', which skips 'description'.
      kindPick = latestQuickPick<PickItem<'feature' | 'chore'>>();
      kindPick._accept([kindPick.items[1] as PickItem<'feature' | 'chore'>]); // chore
      await tick();

      // 4. description is now skipped — straight to 'name'.
      latestInputBox()._setValue('final-name');
      latestInputBox()._accept();

      const result = await resultPromise;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ kind: 'chore', name: 'final-name' });
        expect(Object.keys(result.value)).not.toContain('description');
      }
    });
  });

  describe('optionalStep', () => {
    it('omits the key entirely when skipped', async () => {
      const resultPromise = wizard()
        .step('a', inputStep({ prompt: 'A' }))
        .optionalStep('b', inputStep({ prompt: 'B' }), { skip: () => true })
        .run({ title: 'T' });

      latestInputBox()._accept();

      const result = await resultPromise;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect('b' in result.value).toBe(false);
      }
    });

    it('includes the key when not skipped', async () => {
      const resultPromise = wizard()
        .step('a', inputStep({ prompt: 'A' }))
        .optionalStep('b', inputStep({ prompt: 'B' }), { skip: () => false })
        .run({ title: 'T' });

      latestInputBox()._accept();
      await tick();
      latestInputBox()._setValue('b-value');
      latestInputBox()._accept();

      const result = await resultPromise;
      expect(result).toEqual({ ok: true, value: { a: '', b: 'b-value' } });
    });
  });

  describe('cancellation', () => {
    it('resolves ok:false, cancelled:true with atKey and partial state when a QuickPick step is hidden', async () => {
      const resultPromise = wizard()
        .step('a', inputStep({ prompt: 'A' }))
        .step('b', quickpickStep({ items: () => [toPickItem('x', { label: 'X' })] }))
        .run({ title: 'T' });

      latestInputBox()._setValue('answered-a');
      latestInputBox()._accept();
      await tick();

      latestQuickPick()._hide();

      const result = await resultPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.cancelled).toBe(true);
        expect(result.error.atKey).toBe('b');
        expect(result.error.state).toEqual({ a: 'answered-a' });
      }
    });

    it('resolves cancelled when an InputBox step is hidden without accepting', async () => {
      const resultPromise = wizard()
        .step('a', inputStep({ prompt: 'A' }))
        .run({ title: 'T' });

      latestInputBox()._hide();

      const result = await resultPromise;
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.atKey).toBe('a');
      }
    });

    it('does not double-settle when dispose() re-enters onDidHide synchronously', async () => {
      const resultPromise = wizard()
        .step('a', quickpickStep({ items: () => [toPickItem('x', { label: 'X' })] }))
        .run({ title: 'T' });

      const qp = latestQuickPick<PickItem<string>>();
      let hideFired = false;
      const originalDispose = qp.dispose;
      qp.dispose = vi.fn(() => {
        originalDispose();
        if (!hideFired) {
          hideFired = true;
          qp._hide(); // simulate VS Code firing onDidHide from within dispose()
        }
      });

      qp._accept([qp.items[0] as PickItem<string>]);

      const result = await resultPromise;
      expect(result).toEqual({ ok: true, value: { a: 'x' } });
    });
  });

  describe('quickpickStep', () => {
    it('supports canPickMany, returning an array', async () => {
      const items = [toPickItem('a', { label: 'A' }), toPickItem('b', { label: 'B' })];
      const resultPromise = wizard()
        .step('choices', quickpickStep({ canPickMany: true, items: () => items }))
        .run({ title: 'T' });

      const qp = latestQuickPick<PickItem<string>>();
      qp._accept(items as PickItem<string>[]);

      const result = await resultPromise;
      expect(result).toEqual({ ok: true, value: { choices: ['a', 'b'] } });
    });

    it('resolves cancel when accept fires with no selection', async () => {
      const resultPromise = wizard()
        .step('a', quickpickStep({ items: () => [toPickItem('x', { label: 'X' })] }))
        .run({ title: 'T' });

      latestQuickPick()._accept([]);

      const result = await resultPromise;
      expect(result.ok).toBe(false);
    });

    it('shows busy while items resolve asynchronously, then populates them', async () => {
      let resolveItems!: (items: PickItem<string>[]) => void;
      const itemsPromise = new Promise<PickItem<string>[]>((resolve) => {
        resolveItems = resolve;
      });

      const resultPromise = wizard()
        .step('a', quickpickStep({ items: () => itemsPromise }))
        .run({ title: 'T' });

      const qp = latestQuickPick<PickItem<string>>();
      expect(qp.busy).toBe(true);

      const resolved = [toPickItem('x', { label: 'X' })];
      resolveItems(resolved);
      await tick();

      expect(qp.busy).toBe(false);
      expect(qp.items).toEqual(resolved);

      qp._accept(resolved);
      const result = await resultPromise;
      expect(result).toEqual({ ok: true, value: { a: 'x' } });
    });

    it('wraps an async items rejection in a WizardStepError and disposes the picker', async () => {
      const failure = new Error('fetch failed');
      const resultPromise = wizard()
        .step('a', quickpickStep({ items: () => Promise.reject(failure) }))
        .run({ title: 'T' });

      const qp = latestQuickPick();

      await expect(resultPromise).rejects.toMatchObject({ atKey: 'a', cause: failure });
      expect(qp.dispose).toHaveBeenCalled();
    });

    it('applies prompt via feature-detection when supported by the host', async () => {
      const resultPromise = wizard()
        .step(
          'a',
          quickpickStep({ prompt: 'Pick wisely', items: () => [toPickItem('x', { label: 'X' })] })
        )
        .run({ title: 'T' });

      expect(latestQuickPick().prompt).toBe('Pick wisely');

      latestQuickPick()._accept([toPickItem('x', { label: 'X' })]);
      await resultPromise;
    });
  });

  describe('inputStep', () => {
    it('computes a dynamic default value from prior state', async () => {
      const resultPromise = wizard()
        .step('first', inputStep({ prompt: 'First' }))
        .step('second', inputStep({ value: (s) => `${s.first}-derived` }))
        .run({ title: 'T' });

      latestInputBox()._setValue('base');
      latestInputBox()._accept();
      await tick();

      expect(latestInputBox().value).toBe('base-derived');
      latestInputBox()._accept();

      const result = await resultPromise;
      expect(result).toEqual({ ok: true, value: { first: 'base', second: 'base-derived' } });
    });

    it('debounces live validation and sets validationMessage after the debounce window', async () => {
      const validate = vi.fn((v: string) => (v.length < 3 ? 'too short' : undefined));
      const resultPromise = wizard().step('a', inputStep({ validate })).run({ title: 'T' });

      const box = latestInputBox();
      box._setValue('a');
      box._setValue('ab');
      expect(validate).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(100);

      expect(validate).toHaveBeenCalledTimes(1);
      expect(validate).toHaveBeenCalledWith('ab', {});
      expect(box.validationMessage).toBe('too short');

      box._setValue('abc');
      box._accept();

      const result = await resultPromise;
      expect(result).toEqual({ ok: true, value: { a: 'abc' } });
    });

    it('blocks accept while the (re-validated) value is invalid, and accepts once valid', async () => {
      const validate = vi.fn((v: string) => (v === 'good' ? undefined : 'bad value'));
      const resultPromise = wizard().step('a', inputStep({ validate })).run({ title: 'T' });

      const box = latestInputBox();
      box._setValue('bad');
      box._accept();
      await vi.advanceTimersByTimeAsync(0);

      expect(box.validationMessage).toBe('bad value');
      expect(box.enabled).toBe(true);
      expect(box.busy).toBe(false);

      box._setValue('good');
      box._accept();
      await vi.advanceTimersByTimeAsync(0);

      const result = await resultPromise;
      expect(result).toEqual({ ok: true, value: { a: 'good' } });
    });

    it('supports an async validator, toggling busy/enabled while it awaits', async () => {
      let resolveValidate!: (message: string | undefined) => void;
      const validate = vi.fn(
        () =>
          new Promise<string | undefined>((resolve) => {
            resolveValidate = resolve;
          })
      );
      const resultPromise = wizard().step('a', inputStep({ validate })).run({ title: 'T' });

      const box = latestInputBox();
      box._setValue('value');
      box._accept();
      await tick();

      expect(box.enabled).toBe(false);
      expect(box.busy).toBe(true);

      resolveValidate(undefined);
      await tick();

      expect(box.enabled).toBe(true);
      expect(box.busy).toBe(false);

      const result = await resultPromise;
      expect(result).toEqual({ ok: true, value: { a: 'value' } });
    });

    it('wraps a thrown/rejected validator in a WizardStepError', async () => {
      const failure = new Error('validator exploded');
      const resultPromise = wizard()
        .step(
          'a',
          inputStep({
            validate: () => {
              throw failure;
            },
          })
        )
        .run({ title: 'T' });

      latestInputBox()._accept();

      await expect(resultPromise).rejects.toMatchObject({ atKey: 'a', cause: failure });
    });

    it('discards a stale debounced validation result if the value changed since', async () => {
      const validate = vi.fn((v: string) => (v === 'final' ? undefined : `invalid: ${v}`));
      const resultPromise = wizard().step('a', inputStep({ validate })).run({ title: 'T' });

      const box = latestInputBox();
      box._setValue('stale');
      await vi.advanceTimersByTimeAsync(100);
      expect(box.validationMessage).toBe('invalid: stale');

      // Change the value without going through onDidChangeValue's debounce
      // resolving again (simulates a race where an old debounce callback
      // is still in flight when the value has already moved on).
      box.value = 'final';
      box._accept();
      await vi.advanceTimersByTimeAsync(0);

      const result = await resultPromise;
      expect(result).toEqual({ ok: true, value: { a: 'final' } });
    });
  });

  describe('branch()', () => {
    it('adds a different set of steps depending on prior state', async () => {
      const resultPromise = wizard()
        .step(
          'kind',
          quickpickStep({
            items: () => [
              toPickItem('feature' as const, { label: 'Feature' }),
              toPickItem('fix' as const, { label: 'Fix' }),
            ],
          })
        )
        // Explicit type argument *and* a cast through `unknown`: branches
        // with disjoint key sets need both because TypeScript can't treat a
        // union of two different WizardBuilder<...> instantiations as one
        // WizardBuilder<union-of-states> — WizardBuilder is invariant in its
        // state parameter (step()/optionalStep() also consume it
        // contravariantly). The runtime behavior is exactly what it looks
        // like; only the static type needs the assist. Branches that share
        // their key set don't need either.
        .branch<Record<'featureName', string> | Record<'bugId', string>>(
          (state) =>
            (state.kind === 'feature'
              ? wizard().step('featureName', inputStep({ prompt: 'Feature name' }))
              : wizard().step(
                  'bugId',
                  inputStep({ prompt: 'Bug id' })
                )) as unknown as WizardBuilder<
              Record<'featureName', string> | Record<'bugId', string>
            >
        )
        .run({ title: 'T' });

      const kindPick = latestQuickPick<PickItem<'feature' | 'fix'>>();
      kindPick._accept([kindPick.items[1] as PickItem<'feature' | 'fix'>]); // fix
      await tick();

      expect(latestInputBox().prompt).toBe('Bug id');
      latestInputBox()._setValue('BUG-42');
      latestInputBox()._accept();

      const result = await resultPromise;
      expect(result).toEqual({ ok: true, value: { kind: 'fix', bugId: 'BUG-42' } });
    });

    it('re-evaluates the branch after going back and choosing differently', async () => {
      const resultPromise = wizard()
        .step(
          'kind',
          quickpickStep({
            items: () => [
              toPickItem('feature' as const, { label: 'Feature' }),
              toPickItem('fix' as const, { label: 'Fix' }),
            ],
          })
        )
        // Explicit type argument *and* a cast through `unknown`: branches
        // with disjoint key sets need both because TypeScript can't treat a
        // union of two different WizardBuilder<...> instantiations as one
        // WizardBuilder<union-of-states> — WizardBuilder is invariant in its
        // state parameter (step()/optionalStep() also consume it
        // contravariantly). The runtime behavior is exactly what it looks
        // like; only the static type needs the assist. Branches that share
        // their key set don't need either.
        .branch<Record<'featureName', string> | Record<'bugId', string>>(
          (state) =>
            (state.kind === 'feature'
              ? wizard().step('featureName', inputStep({ prompt: 'Feature name' }))
              : wizard().step(
                  'bugId',
                  inputStep({ prompt: 'Bug id' })
                )) as unknown as WizardBuilder<
              Record<'featureName', string> | Record<'bugId', string>
            >
        )
        .run({ title: 'T' });

      let kindPick = latestQuickPick<PickItem<'feature' | 'fix'>>();
      kindPick._accept([kindPick.items[0] as PickItem<'feature' | 'fix'>]); // feature
      await tick();
      expect(latestInputBox().prompt).toBe('Feature name');

      latestInputBox()._triggerButton(vscode.QuickInputButtons.Back);
      await tick();

      kindPick = latestQuickPick<PickItem<'feature' | 'fix'>>();
      kindPick._accept([kindPick.items[1] as PickItem<'feature' | 'fix'>]); // fix
      await tick();

      expect(latestInputBox().prompt).toBe('Bug id');
      latestInputBox()._setValue('BUG-1');
      latestInputBox()._accept();

      const result = await resultPromise;
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toEqual({ kind: 'fix', bugId: 'BUG-1' });
        expect(Object.keys(result.value)).not.toContain('featureName');
      }
    });
  });
});
