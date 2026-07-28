import * as vscode from 'vscode';
import type { Result } from '../core/result.js';
import { ok, err } from '../core/result.js';
import { debounce } from '../std/timing.js';
import type { PickItem } from './pick.js';

function isThenable<T>(value: unknown): value is Thenable<T> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}

// ============================================
// Step outcome / definition
// ============================================

/**
 * What a step resolved to: a value (the user accepted a choice/input), a
 * request to go back one step, or a cancellation (Escape / lost focus).
 */
export type StepOutcome<V> =
  | { readonly kind: 'value'; readonly value: V }
  | { readonly kind: 'back' }
  | { readonly kind: 'cancel' };

/**
 * A runnable wizard step, as produced by {@link quickpickStep}/{@link inputStep}.
 * Not meant to be implemented by hand — build steps with those factories.
 */
export interface StepDefinition<S, V> {
  /** @internal Executed by `wizard().run()`. */
  readonly run: (ctx: {
    readonly state: Readonly<S>;
    readonly title: string;
    readonly step: number | undefined;
    readonly totalSteps: number | undefined;
    readonly ignoreFocusOut: boolean;
    readonly backButton: vscode.QuickInputButton | undefined;
  }) => Promise<StepOutcome<V>>;
}

/**
 * Error thrown by {@link WizardBuilder.run} when a step's `items`/`value`/
 * `validate` callback throws or rejects. Cancellation (Escape, back, losing
 * focus) never throws — only genuinely unexpected failures do, mirroring
 * {@link import('./progress.js').withSteps}'s "cancellation returns normally,
 * errors propagate" policy. `error.cause` holds the original error.
 */
export class WizardStepError extends Error {
  /** The key of the step whose callback failed. */
  readonly atKey: string;

  constructor(atKey: string, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Wizard step "${atKey}" failed: ${causeMessage}`, { cause });
    this.name = 'WizardStepError';
    this.atKey = atKey;
  }
}

// ============================================
// quickpickStep
// ============================================

/** Configuration accepted by {@link quickpickStep}. */
export interface QuickPickStepConfig<S, V> {
  /** Placeholder text shown in the empty filter box. */
  placeholder?: string;
  /**
   * Instructional text shown below the input box and above the items
   * (VS Code 1.108+; silently ignored on older hosts via feature detection).
   */
  prompt?: string;
  /**
   * Items to choose from. May be computed from the accumulated state of
   * previous steps, and may be asynchronous — the picker opens immediately
   * showing a busy indicator while this resolves.
   */
  items: (state: Readonly<S>) => readonly PickItem<V>[] | Promise<readonly PickItem<V>[]>;
  /** Include item descriptions when filtering (default: false). */
  matchOnDescription?: boolean;
  /** Include item details when filtering (default: false). */
  matchOnDetail?: boolean;
  /** Allow selecting more than one item. */
  canPickMany?: boolean;
}

/** Applies the feature-detectable `QuickPick.prompt` (1.108+) without requiring `engines.vscode` to be raised. */
function applyQuickPickPrompt(
  quickPick: vscode.QuickPick<vscode.QuickPickItem>,
  prompt: string | undefined
): void {
  if (prompt !== undefined && 'prompt' in quickPick) {
    quickPick.prompt = prompt;
  }
}

/**
 * Builds a single-selection wizard step from a (possibly async) list of items.
 *
 * @example
 * ```typescript
 * quickpickStep({
 *   items: () => [
 *     toPickItem('feature', { label: 'Feature' }),
 *     toPickItem('fix', { label: 'Bug Fix' }),
 *   ],
 * });
 * ```
 */
export function quickpickStep<S, V>(
  config: QuickPickStepConfig<S, V> & { canPickMany?: false }
): StepDefinition<S, V>;
/**
 * Builds a multi-selection wizard step from a (possibly async) list of items.
 *
 * @example
 * ```typescript
 * quickpickStep({
 *   canPickMany: true,
 *   items: () => [toPickItem('a', { label: 'A' }), toPickItem('b', { label: 'B' })],
 * });
 * ```
 */
export function quickpickStep<S, V>(
  config: QuickPickStepConfig<S, V> & { canPickMany: true }
): StepDefinition<S, V[]>;
export function quickpickStep<S, V>(
  config: QuickPickStepConfig<S, V> & { canPickMany?: boolean }
): StepDefinition<S, V | V[]> {
  const canPickMany = config.canPickMany ?? false;

  return {
    run(ctx) {
      return new Promise<StepOutcome<V | V[]>>((resolve, reject) => {
        const quickPick = vscode.window.createQuickPick<PickItem<V>>();
        let settled = false;

        quickPick.title = ctx.title;
        quickPick.step = ctx.step;
        quickPick.totalSteps = ctx.totalSteps;
        quickPick.ignoreFocusOut = ctx.ignoreFocusOut;
        quickPick.placeholder = config.placeholder;
        applyQuickPickPrompt(quickPick, config.prompt);
        quickPick.matchOnDescription = config.matchOnDescription ?? false;
        quickPick.matchOnDetail = config.matchOnDetail ?? false;
        quickPick.canSelectMany = canPickMany;
        if (ctx.backButton) {
          quickPick.buttons = [ctx.backButton];
        }

        const finish = (outcome: StepOutcome<V | V[]>): void => {
          if (settled) return;
          settled = true;
          resolve(outcome);
          quickPick.dispose();
        };

        quickPick.onDidTriggerButton((button) => {
          if (button === ctx.backButton) {
            finish({ kind: 'back' });
          }
        });

        quickPick.onDidAccept(() => {
          if (canPickMany) {
            finish({ kind: 'value', value: quickPick.selectedItems.map((item) => item.value) });
            return;
          }
          const selected = quickPick.selectedItems[0];
          if (selected) {
            finish({ kind: 'value', value: selected.value });
          } else {
            finish({ kind: 'cancel' });
          }
        });

        quickPick.onDidHide(() => {
          finish({ kind: 'cancel' });
        });

        try {
          const rawItems = config.items(ctx.state);
          if (isThenable<readonly PickItem<V>[]>(rawItems)) {
            // Only pay for a busy spinner + an extra microtask hop when the
            // items genuinely are asynchronous — a synchronous list is
            // assigned below, before `show()`, so it never flashes empty.
            quickPick.busy = true;
            quickPick.show();
            rawItems.then(
              (resolvedItems) => {
                if (settled) return;
                quickPick.items = resolvedItems;
                quickPick.busy = false;
              },
              (error: unknown) => {
                if (settled) return;
                settled = true;
                quickPick.dispose();
                reject(error);
              }
            );
          } else {
            quickPick.items = rawItems;
            quickPick.show();
          }
        } catch (error) {
          settled = true;
          quickPick.dispose();
          reject(error);
        }
      });
    },
  };
}

// ============================================
// inputStep
// ============================================

/** Configuration accepted by {@link inputStep}. */
export interface InputStepConfig<S> {
  /** Instructional text shown below the input box. */
  prompt?: string;
  /** Placeholder text shown when the box is empty. */
  placeholder?: string;
  /** Hides typed characters. */
  password?: boolean;
  /** Default value, computed from the accumulated state of previous steps. */
  value?: (state: Readonly<S>) => string;
  /**
   * Validation function. May be asynchronous. Live validation (as the user
   * types) is debounced by 100ms — matching the debounce VS Code applies
   * internally to `showInputBox`'s `validateInput` — so an async validator
   * isn't invoked on every keystroke. The final value is always re-validated
   * once more, without debouncing, when the user accepts.
   */
  validate?: (
    value: string,
    state: Readonly<S>
  ) => string | undefined | Promise<string | undefined>;
}

const VALIDATE_DEBOUNCE_MS = 100;

/**
 * Builds a text input wizard step, with optional (possibly async) validation.
 *
 * @example
 * ```typescript
 * inputStep({
 *   prompt: 'Enter branch name',
 *   validate: (v) => (/^[a-z0-9-]+$/.test(v) ? undefined : 'Use lowercase letters, numbers, and hyphens only'),
 * });
 * ```
 */
export function inputStep<S>(config: InputStepConfig<S>): StepDefinition<S, string> {
  return {
    run(ctx) {
      return new Promise<StepOutcome<string>>((resolve, reject) => {
        const inputBox = vscode.window.createInputBox();
        let settled = false;

        inputBox.title = ctx.title;
        inputBox.step = ctx.step;
        inputBox.totalSteps = ctx.totalSteps;
        inputBox.ignoreFocusOut = ctx.ignoreFocusOut;
        inputBox.prompt = config.prompt;
        inputBox.placeholder = config.placeholder;
        inputBox.password = config.password ?? false;
        if (config.value) {
          inputBox.value = config.value(ctx.state);
        }
        if (ctx.backButton) {
          inputBox.buttons = [ctx.backButton];
        }

        const finish = (outcome: StepOutcome<string>): void => {
          if (settled) return;
          settled = true;
          debouncedValidate.cancel();
          resolve(outcome);
          inputBox.dispose();
        };

        const fail = (error: unknown): void => {
          if (settled) return;
          settled = true;
          debouncedValidate.cancel();
          inputBox.dispose();
          reject(error);
        };

        const debouncedValidate = debounce(
          // `debounce`'s generic constraint is `(...args: unknown[]) => void`;
          // a concretely-typed `(value: string) => void` doesn't satisfy that
          // under `strictFunctionTypes`, so it's asserted through once here.
          // Call sites below still pass (and get) a plain `string`.
          ((value: string) => {
            try {
              Promise.resolve(config.validate?.(value, ctx.state)).then(
                (message) => {
                  // Discard a stale result if the value moved on while this
                  // validation was in flight.
                  if (settled || inputBox.value !== value) return;
                  inputBox.validationMessage = message;
                },
                (error: unknown) => fail(error)
              );
            } catch (error) {
              fail(error);
            }
          }) as (...args: unknown[]) => void,
          VALIDATE_DEBOUNCE_MS
        );

        if (config.validate) {
          inputBox.onDidChangeValue((value) => {
            debouncedValidate(value);
          });
        }

        inputBox.onDidTriggerButton((button) => {
          if (button === ctx.backButton) {
            finish({ kind: 'back' });
          }
        });

        inputBox.onDidAccept(() => {
          const value = inputBox.value;
          if (!config.validate) {
            finish({ kind: 'value', value });
            return;
          }
          debouncedValidate.cancel();
          inputBox.enabled = false;
          inputBox.busy = true;
          try {
            Promise.resolve(config.validate(value, ctx.state)).then(
              (message) => {
                if (settled) return;
                inputBox.enabled = true;
                inputBox.busy = false;
                if (message) {
                  inputBox.validationMessage = message;
                  return;
                }
                finish({ kind: 'value', value });
              },
              (error: unknown) => fail(error)
            );
          } catch (error) {
            fail(error);
          }
        });

        inputBox.onDidHide(() => {
          finish({ kind: 'cancel' });
        });

        inputBox.show();
      });
    },
  };
}

// ============================================
// WizardBuilder
// ============================================

/** Options for {@link WizardBuilder.run}. */
export interface WizardRunOptions {
  /** Title shown for steps that don't set their own `opts.title`. */
  title: string;
  /**
   * Show native step/total-step numbering (VS Code's own "1/3" indicator).
   * @default true
   */
  showStepNumbers?: boolean;
  /**
   * Keep each step's QuickPick/InputBox open when focus moves elsewhere.
   * Defaults to `true` — without it, briefly switching windows mid-wizard
   * silently discards everything answered so far.
   * @default true
   */
  ignoreFocusOut?: boolean;
}

/**
 * Type-accumulating fluent builder for multi-step wizards. Each `.step()`/
 * `.optionalStep()` call folds its value's type into the state type carried
 * by the chain, so `run()` resolves with an exact, cast-free result type —
 * `.step()` fields are required, `.optionalStep()` fields are optional
 * exactly when their `skip` predicate could make them so.
 *
 * Build steps with {@link quickpickStep}/{@link inputStep}; obtain a builder
 * with {@link wizard}.
 */
export interface WizardBuilder<S> {
  /**
   * Adds a required step. `key` must not already be used by an earlier
   * step (enforced at compile time).
   */
  step<K extends string, V>(
    key: K extends keyof S ? never : K,
    def: StepDefinition<S, V>,
    opts?: { title?: string }
  ): WizardBuilder<S & Record<K, V>>;

  /**
   * Adds a step that may be skipped based on the state so far — its result
   * type is optional (`key?: V`) since the wizard may complete without ever
   * asking it.
   */
  optionalStep<K extends string, V>(
    key: K extends keyof S ? never : K,
    def: StepDefinition<S, V>,
    opts: { skip: (state: Partial<S>) => boolean; title?: string }
  ): WizardBuilder<S & Partial<Record<K, V>>>;

  /**
   * Dynamic branching: inspects the state accumulated so far and returns the
   * builder to continue with. Unlike `skip`, this can add an entirely
   * different set of steps per branch rather than just omitting one.
   *
   * When different branches add *disjoint* keys (e.g. `featureName` vs.
   * `bugId`), TypeScript can't infer — or even check — a single `S2` from a
   * function returning a union of differently-keyed `WizardBuilder`s
   * (`WizardBuilder` is invariant in its state parameter, since
   * `step()`/`optionalStep()` also consume it contravariantly). Give `S2`
   * explicitly and cast the union through `unknown`:
   * `.branch<Record<'featureName', string> | Record<'bugId', string>>((s) =>
   * (s.kind === 'a' ? builderA : builderB) as unknown as WizardBuilder<...>)`.
   * Branches that share their key set don't need either.
   */
  branch<S2>(fn: (state: Readonly<S>) => WizardBuilder<S2>): WizardBuilder<S & S2>;

  /**
   * Runs the wizard.
   *
   * @returns `Result.ok` with the fully-typed state on completion, or
   *   `Result.err` (with `cancelled: true`) holding the step key the user
   *   cancelled at and the partial state gathered so far. Unexpected
   *   errors from step callbacks reject the promise as a
   *   {@link WizardStepError} instead of resolving — see that class.
   */
  run(options: WizardRunOptions): Promise<Result<S, { atKey: keyof S | null; state: Partial<S> }>>;
}

type UnknownState = Record<string, unknown>;
type ErasedStepDefinition = StepDefinition<UnknownState, unknown>;

interface WizardStepNode {
  readonly kind: 'step';
  readonly key: string;
  readonly def: ErasedStepDefinition;
  readonly optional: boolean;
  readonly skip?: (state: Partial<UnknownState>) => boolean;
  readonly title?: string;
}

interface WizardBranchNode {
  readonly kind: 'branch';
  readonly fn: (state: Readonly<UnknownState>) => WizardBuilderImpl;
}

type WizardNode = WizardStepNode | WizardBranchNode;

/** Recomputes which steps are currently active, given the state so far — recursing into `branch()` and honoring `optionalStep()`'s `skip`, both evaluated fresh against the *current* state every time this runs. */
function computeActiveSequence(
  nodes: readonly WizardNode[],
  state: Readonly<UnknownState>
): WizardStepNode[] {
  const result: WizardStepNode[] = [];
  for (const node of nodes) {
    if (node.kind === 'branch') {
      result.push(...computeActiveSequence(node.fn(state).nodes, state));
    } else if (!node.optional || !(node.skip?.(state) ?? false)) {
      result.push(node);
    }
  }
  return result;
}

class WizardBuilderImpl<S = UnknownState> implements WizardBuilder<S> {
  constructor(readonly nodes: readonly WizardNode[]) {}

  step<K extends string, V>(
    key: K extends keyof S ? never : K,
    def: StepDefinition<S, V>,
    opts?: { title?: string }
  ): WizardBuilder<S & Record<K, V>> {
    const node: WizardStepNode = {
      kind: 'step',
      key: key as unknown as string,
      def: def as unknown as ErasedStepDefinition,
      optional: false,
      title: opts?.title,
    };
    return new WizardBuilderImpl<S & Record<K, V>>([...this.nodes, node]);
  }

  optionalStep<K extends string, V>(
    key: K extends keyof S ? never : K,
    def: StepDefinition<S, V>,
    opts: { skip: (state: Partial<S>) => boolean; title?: string }
  ): WizardBuilder<S & Partial<Record<K, V>>> {
    const node: WizardStepNode = {
      kind: 'step',
      key: key as unknown as string,
      def: def as unknown as ErasedStepDefinition,
      optional: true,
      skip: opts.skip as unknown as (state: Partial<UnknownState>) => boolean,
      title: opts.title,
    };
    return new WizardBuilderImpl<S & Partial<Record<K, V>>>([...this.nodes, node]);
  }

  branch<S2>(fn: (state: Readonly<S>) => WizardBuilder<S2>): WizardBuilder<S & S2> {
    // `WizardBuilder<S2>` is only ever implemented by `WizardBuilderImpl` —
    // `wizard()` is the sole factory — so the cast back to the concrete
    // class (to reach its `.nodes`) is safe as long as callers build the
    // sub-builder with the exported `wizard()`/`.step()`/etc. API.
    const node: WizardBranchNode = {
      kind: 'branch',
      fn: (state) => fn(state as Readonly<S>) as unknown as WizardBuilderImpl,
    };
    return new WizardBuilderImpl<S & S2>([...this.nodes, node]);
  }

  async run(
    options: WizardRunOptions
  ): Promise<Result<S, { atKey: keyof S | null; state: Partial<S> }>> {
    const { title, showStepNumbers = true, ignoreFocusOut = true } = options;
    const backButton = vscode.QuickInputButtons.Back;
    const state: UnknownState = {};
    let currentIndex = 0;

    for (;;) {
      const activeSequence = computeActiveSequence(this.nodes, { ...state });

      // Bug fix: keys from a step that's no longer on the active path after
      // going `back` and changing an earlier answer (or taking a different
      // `branch()`) must not linger in the final result. Exactly the steps
      // strictly before `currentIndex` in the *current* sequence are
      // "confirmed"; everything else gets pruned every iteration.
      const keptKeys = new Set(activeSequence.slice(0, currentIndex).map((node) => node.key));
      for (const key of Object.keys(state)) {
        if (!keptKeys.has(key)) {
          delete state[key];
        }
      }

      if (currentIndex >= activeSequence.length) {
        return ok(state as S);
      }

      const node = activeSequence[currentIndex];
      /* istanbul ignore next -- currentIndex is bounds-checked above; guard only satisfies noUncheckedIndexedAccess */
      if (!node) {
        return ok(state as S);
      }

      let outcome: StepOutcome<unknown>;
      try {
        outcome = await node.def.run({
          state: { ...state },
          title: node.title ?? title,
          step: showStepNumbers ? currentIndex + 1 : undefined,
          totalSteps: showStepNumbers ? activeSequence.length : undefined,
          ignoreFocusOut,
          backButton: currentIndex > 0 ? backButton : undefined,
        });
      } catch (error) {
        throw new WizardStepError(node.key, error);
      }

      if (outcome.kind === 'back') {
        currentIndex = Math.max(0, currentIndex - 1);
        continue;
      }

      if (outcome.kind === 'cancel') {
        return err(
          { atKey: node.key as keyof S, state: { ...state } as Partial<S> },
          { cancelled: true }
        );
      }

      state[node.key] = outcome.value;
      currentIndex++;
    }
  }
}

/**
 * Starts a new wizard builder.
 *
 * @example
 * ```typescript
 * const result = await wizard()
 *   .step('type', quickpickStep({
 *     items: () => [
 *       toPickItem('feature', { label: 'Feature', description: 'New feature' }),
 *       toPickItem('fix', { label: 'Bug Fix', description: 'Fix a bug' }),
 *       toPickItem('chore', { label: 'Chore', description: 'Maintenance' }),
 *     ],
 *   }))
 *   .step('name', inputStep({
 *     prompt: 'Enter branch name',
 *     validate: (v) => (/^[a-z0-9-]+$/.test(v) ? undefined : 'Use lowercase letters, numbers, and hyphens only'),
 *   }))
 *   .optionalStep('description', inputStep({ prompt: 'Enter description' }), {
 *     skip: (s) => s.type === 'chore',
 *   })
 *   .run({ title: 'Create Branch' });
 *
 * if (result.ok) {
 *   // result.value: { type: 'feature' | 'fix' | 'chore'; name: string; description?: string }
 *   const { type, name, description } = result.value;
 *   await createBranch(`${type}/${name}`, description);
 * } else {
 *   // Always a cancellation (result.cancelled is true) — an unexpected
 *   // items/value/validate failure instead rejects run() as a WizardStepError.
 *   logger.info(`Wizard cancelled at ${String(result.error.atKey)}`);
 * }
 * ```
 */
export function wizard(): WizardBuilder<Record<never, never>> {
  return new WizardBuilderImpl<Record<never, never>>([]);
}
