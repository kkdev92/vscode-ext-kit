/**
 * Type-accumulating multi-step input above the quick-input platform port.
 *
 * Public surface: {@link createWizard} builds an immutable chain of named
 * steps; {@link quickpickStep} and {@link inputStep} are the supported UI step
 * factories. `run()` returns typed accumulated state or an explicit cancelled
 * `Result`; callback failures reject as {@link WizardStepError}.
 *
 * Managed state: each visible step owns exactly one QuickPick/InputBox and its
 * subscriptions. Accept, hide, back, abort, and async failure all converge on a
 * single-settlement cleanup path. Going back recomputes branches and removes
 * answers that no longer belong to the active path.
 *
 * Ownership: the builder is inert configuration. `run()` owns each step UI
 * only until that step settles and never transfers the native handle to the
 * caller. The caller owns the returned promise and should pass its operation
 * signal so an open wizard cannot outlive the operation that started it.
 */
import { err, ok } from '../core/result.js';
import type { Result } from '../core/result.js';
import type { Logger } from '../../foundation/logging/logger.js';
import type {
  PlatformRegistration,
  QuickInputButtonLike,
  QuickInputCapability,
} from '../../foundation/platform/ports.js';
import { debounce } from '../std/timing.js';
import type { PickItem } from './quick-input.js';

function isThenable<T>(value: unknown): value is Thenable<T> {
  return typeof (value as { then?: unknown } | null | undefined)?.then === 'function';
}

/**
 * What a step resolved to: a value (the user accepted a choice/input), a
 * request to go back one step, or a cancellation (Escape / lost focus).
 */
export type StepOutcome<V> =
  | { readonly kind: 'value'; readonly value: V }
  | { readonly kind: 'back' }
  | { readonly kind: 'cancel' };

/** Which part of a step failed, carried on {@link WizardStepError}. */
export type WizardStepPhase = 'load' | 'validate' | 'accept' | 'branch';

/** What each step receives when it runs. */
export interface StepRunContext<S> {
  readonly state: Readonly<S>;
  readonly title: string;
  readonly step: number | undefined;
  readonly totalSteps: number | undefined;
  readonly ignoreFocusOut: boolean;
  readonly backButton: QuickInputButtonLike | undefined;
  /** The quick-input surface the step builds its UI on. */
  readonly quickInput: QuickInputCapability;
  /** Aborting hides the step's UI and cancels the wizard. */
  readonly signal: AbortSignal | undefined;
}

/**
 * A runnable wizard step, as produced by {@link quickpickStep}/{@link inputStep}.
 * Not meant to be implemented by hand — build steps with those factories.
 */
export interface StepDefinition<S, V> {
  /** @internal Executed by `wizard().run()`. */
  readonly run: (ctx: StepRunContext<S>) => Promise<StepOutcome<V>>;
}

/**
 * Error thrown by {@link WizardBuilder.run} when a step's `items`/`value`/
 * `validate` callback (or a `branch()` function) throws or rejects.
 * Cancellation — Escape, back, losing focus — never throws; only a genuinely
 * unexpected failure does. A caller therefore branches on the returned outcome
 * for "the user gave up" and catches only for "something broke", rather than
 * having to tell those two apart inside one `catch`. `error.cause` holds the
 * original error.
 *
 * The state snapshot is deliberately *not* carried: wizard state may contain
 * secrets, and an error object travels further than the wizard's caller. The
 * original `cause` may still contain callback-provided sensitive text; redact
 * it before sending the error to telemetry or a user-facing report.
 */
export class WizardStepError extends Error {
  /** The key of the step whose callback failed, or `'(branch)'`. */
  readonly atKey: string;
  /** Which part of the step failed. */
  readonly phase: WizardStepPhase;

  constructor(atKey: string, phase: WizardStepPhase, cause: unknown) {
    const causeMessage = cause instanceof Error ? cause.message : String(cause);
    super(`Wizard step "${atKey}" failed while ${phase}: ${causeMessage}`, { cause });
    this.name = 'WizardStepError';
    this.atKey = atKey;
    this.phase = phase;
  }
}

/** @internal Tags a step rejection with the phase that failed. */
class StepFailure extends Error {
  readonly phase: WizardStepPhase;
  readonly failure: unknown;

  constructor(phase: WizardStepPhase, failure: unknown) {
    super(`Step failed while ${phase}.`);
    this.name = 'StepFailure';
    this.phase = phase;
    this.failure = failure;
  }
}

/** Configuration accepted by {@link quickpickStep}. */
export interface QuickPickStepConfig<S, V> {
  /** Placeholder text shown in the empty filter box. */
  readonly placeholder?: string;
  /** Instructional text shown below the input box and above the items. */
  readonly prompt?: string;
  /**
   * Items to choose from. May be computed from the accumulated state of
   * previous steps, and may be asynchronous — the picker opens immediately
   * showing a busy indicator while this resolves.
   */
  readonly items: (state: Readonly<S>) => readonly PickItem<V>[] | Promise<readonly PickItem<V>[]>;
  /** Include item descriptions when filtering (default: false). */
  readonly matchOnDescription?: boolean;
  /** Include item details when filtering (default: false). */
  readonly matchOnDetail?: boolean;
  /** Allow selecting more than one item. */
  readonly canPickMany?: boolean;
}

/**
 * Builds a single-selection wizard step from a (possibly async) list of items.
 *
 * @example
 * ```ts
 * quickpickStep({
 *   items: () => [
 *     toPickItem('feature', { label: 'Feature' }),
 *     toPickItem('fix', { label: 'Bug Fix' }),
 *   ],
 * });
 * ```
 */
export function quickpickStep<S, V>(
  config: QuickPickStepConfig<S, V> & { readonly canPickMany?: false }
): StepDefinition<S, V>;
/**
 * Builds a multi-selection wizard step from a (possibly async) list of items.
 *
 * @example
 * ```ts
 * quickpickStep({
 *   canPickMany: true,
 *   items: () => [toPickItem('a', { label: 'A' }), toPickItem('b', { label: 'B' })],
 * });
 * ```
 */
export function quickpickStep<S, V>(
  config: QuickPickStepConfig<S, V> & { readonly canPickMany: true }
): StepDefinition<S, V[]>;
export function quickpickStep<S, V>(
  config: QuickPickStepConfig<S, V> & { readonly canPickMany?: boolean }
): StepDefinition<S, V | V[]> {
  const canPickMany = config.canPickMany ?? false;

  return {
    run(ctx) {
      return new Promise<StepOutcome<V | V[]>>((resolve, reject) => {
        const quickPick = ctx.quickInput.createQuickPick<PickItem<V>>();
        const registrations: PlatformRegistration[] = [];
        let removeAbortListener: (() => void) | undefined;
        let settled = false;

        quickPick.title = ctx.title;
        quickPick.step = ctx.step;
        quickPick.totalSteps = ctx.totalSteps;
        quickPick.ignoreFocusOut = ctx.ignoreFocusOut;
        quickPick.placeholder = config.placeholder;
        quickPick.prompt = config.prompt;
        quickPick.matchOnDescription = config.matchOnDescription ?? false;
        quickPick.matchOnDetail = config.matchOnDetail ?? false;
        quickPick.canSelectMany = canPickMany;
        if (ctx.backButton !== undefined) {
          quickPick.buttons = [ctx.backButton];
        }

        // A step resolving concurrently with dispose/hide must not
        // double-settle: the promise is claimed before teardown.
        const finish = (outcome: () => void): void => {
          if (settled) {
            return;
          }
          settled = true;
          outcome();
          for (const registration of registrations) {
            registration.dispose();
          }
          removeAbortListener?.();
          quickPick.dispose();
        };

        registrations.push(
          quickPick.onDidTriggerButton((button) => {
            if (button === ctx.backButton) {
              finish(() => {
                resolve({ kind: 'back' });
              });
            }
          }),
          quickPick.onDidAccept(() => {
            finish(() => {
              if (canPickMany) {
                resolve({
                  kind: 'value',
                  value: quickPick.selectedItems.map((item) => item.value),
                });
                return;
              }
              const selected = quickPick.selectedItems[0];
              resolve(selected ? { kind: 'value', value: selected.value } : { kind: 'cancel' });
            });
          }),
          quickPick.onDidHide(() => {
            finish(() => {
              resolve({ kind: 'cancel' });
            });
          })
        );

        if (ctx.signal !== undefined) {
          const signal = ctx.signal;
          const onAbort = (): void => {
            quickPick.hide();
          };
          signal.addEventListener('abort', onAbort, { once: true });
          removeAbortListener = () => {
            signal.removeEventListener('abort', onAbort);
          };
        }

        try {
          const rawItems = config.items(ctx.state);
          if (isThenable<readonly PickItem<V>[]>(rawItems)) {
            // Only pay for a busy spinner + an extra microtask hop when the
            // items genuinely are asynchronous — a synchronous list is
            // assigned below, before show(), so it never flashes empty.
            quickPick.busy = true;
            quickPick.show();
            rawItems.then(
              (resolvedItems) => {
                if (settled) {
                  return;
                }
                quickPick.items = resolvedItems;
                quickPick.busy = false;
              },
              (error: unknown) => {
                finish(() => {
                  reject(new StepFailure('load', error));
                });
              }
            );
          } else {
            quickPick.items = rawItems;
            quickPick.show();
          }
        } catch (error) {
          finish(() => {
            reject(new StepFailure('load', error));
          });
        }
      });
    },
  };
}

/** Configuration accepted by {@link inputStep}. */
export interface InputStepConfig<S> {
  /** Instructional text shown below the input box. */
  readonly prompt?: string;
  /** Placeholder text shown when the box is empty. */
  readonly placeholder?: string;
  /** Hides typed characters. */
  readonly password?: boolean;
  /** Default value, computed from the accumulated state of previous steps. */
  readonly value?: (state: Readonly<S>) => string;
  /**
   * Validation function. May be asynchronous. Live validation (as the user
   * types) is debounced by 100ms — matching the debounce VS Code applies
   * internally to `showInputBox`'s `validateInput` — so an async validator
   * isn't invoked on every keystroke. The final value is always re-validated
   * once more, without debouncing, when the user accepts.
   */
  readonly validate?: (
    value: string,
    state: Readonly<S>
  ) => string | undefined | Promise<string | undefined>;
}

const VALIDATE_DEBOUNCE_MS = 100;

/**
 * Builds a text input wizard step, with optional (possibly async) validation.
 *
 * @example
 * ```ts
 * inputStep({
 *   prompt: 'Enter branch name',
 *   validate: (v) => (/^[a-z0-9-]+$/.test(v) ? undefined : 'Lowercase letters, numbers and hyphens only'),
 * });
 * ```
 */
export function inputStep<S>(config: InputStepConfig<S>): StepDefinition<S, string> {
  return {
    run(ctx) {
      return new Promise<StepOutcome<string>>((resolve, reject) => {
        const inputBox = ctx.quickInput.createInputBox();
        const registrations: PlatformRegistration[] = [];
        let removeAbortListener: (() => void) | undefined;
        let settled = false;

        inputBox.title = ctx.title;
        inputBox.step = ctx.step;
        inputBox.totalSteps = ctx.totalSteps;
        inputBox.ignoreFocusOut = ctx.ignoreFocusOut;
        inputBox.prompt = config.prompt;
        inputBox.placeholder = config.placeholder;
        inputBox.password = config.password ?? false;
        if (config.value !== undefined) {
          inputBox.value = config.value(ctx.state);
        }
        if (ctx.backButton !== undefined) {
          inputBox.buttons = [ctx.backButton];
        }

        const finish = (outcome: () => void): void => {
          if (settled) {
            return;
          }
          settled = true;
          debouncedValidate.cancel();
          outcome();
          for (const registration of registrations) {
            registration.dispose();
          }
          removeAbortListener?.();
          inputBox.dispose();
        };

        const fail = (error: unknown): void => {
          finish(() => {
            reject(new StepFailure('validate', error));
          });
        };

        const debouncedValidate = debounce((value: string) => {
          try {
            Promise.resolve(config.validate?.(value, ctx.state)).then(
              (message) => {
                // Discard a stale result if the value moved on while this
                // validation was in flight.
                if (settled || inputBox.value !== value) {
                  return;
                }
                inputBox.validationMessage = message;
              },
              (error: unknown) => {
                fail(error);
              }
            );
          } catch (error) {
            fail(error);
          }
        }, VALIDATE_DEBOUNCE_MS);

        if (config.validate !== undefined) {
          registrations.push(
            inputBox.onDidChangeValue((value) => {
              debouncedValidate(value);
            })
          );
        }

        registrations.push(
          inputBox.onDidTriggerButton((button) => {
            if (button === ctx.backButton) {
              finish(() => {
                resolve({ kind: 'back' });
              });
            }
          }),
          inputBox.onDidAccept(() => {
            const value = inputBox.value;
            const validate = config.validate;
            if (validate === undefined) {
              finish(() => {
                resolve({ kind: 'value', value });
              });
              return;
            }
            debouncedValidate.cancel();
            inputBox.enabled = false;
            inputBox.busy = true;
            try {
              Promise.resolve(validate(value, ctx.state)).then(
                (message) => {
                  if (settled) {
                    return;
                  }
                  inputBox.enabled = true;
                  inputBox.busy = false;
                  if (message !== undefined && message !== '') {
                    inputBox.validationMessage = message;
                    return;
                  }
                  finish(() => {
                    resolve({ kind: 'value', value });
                  });
                },
                (error: unknown) => {
                  fail(error);
                }
              );
            } catch (error) {
              fail(error);
            }
          }),
          inputBox.onDidHide(() => {
            finish(() => {
              resolve({ kind: 'cancel' });
            });
          })
        );

        if (ctx.signal !== undefined) {
          const signal = ctx.signal;
          const onAbort = (): void => {
            inputBox.hide();
          };
          signal.addEventListener('abort', onAbort, { once: true });
          removeAbortListener = () => {
            signal.removeEventListener('abort', onAbort);
          };
        }

        inputBox.show();
      });
    },
  };
}

/** Options for {@link WizardBuilder.run}. */
export interface WizardRunOptions {
  /** Title shown for steps that don't set their own `opts.title`. */
  readonly title: string;
  /**
   * Show native step/total-step numbering (VS Code's own "1/3" indicator).
   * @default true
   */
  readonly showStepNumbers?: boolean;
  /**
   * Keep each step's QuickPick/InputBox open when focus moves elsewhere.
   * Defaults to `true` — without it, briefly switching windows mid-wizard
   * silently discards everything answered so far.
   * @default true
   */
  readonly ignoreFocusOut?: boolean;
  /**
   * The quick-input surface to build steps on. Required when the builder was
   * created without a default (the root `wizard()` export binds VS Code).
   */
  readonly ui?: QuickInputCapability;
  /** Aborting cancels the wizard: the open step hides and `run` resolves cancelled. */
  readonly signal?: AbortSignal;
  /** Receives step-transition debug logs. */
  readonly logger?: Logger;
}

/**
 * Type-accumulating fluent builder for multi-step wizards. Each `.step()`/
 * `.optionalStep()` call folds its value's type into the state type carried
 * by the chain, so `run()` resolves with an exact, cast-free result type —
 * `.step()` fields are required, `.optionalStep()` fields are optional
 * exactly when their `skip` predicate could make them so.
 *
 * Build steps with {@link quickpickStep}/{@link inputStep}; obtain a builder
 * with `wizard()`.
 */
export interface WizardBuilder<S> {
  /**
   * Adds a required step. `key` must not already be used by an earlier
   * step (enforced at compile time).
   */
  step<K extends string, V>(
    key: K extends keyof S ? never : K,
    def: StepDefinition<S, V>,
    opts?: { readonly title?: string }
  ): WizardBuilder<S & Record<K, V>>;

  /**
   * Adds a step that may be skipped based on the state so far — its result
   * type is optional (`key?: V`) since the wizard may complete without ever
   * asking it.
   */
  optionalStep<K extends string, V>(
    key: K extends keyof S ? never : K,
    def: StepDefinition<S, V>,
    opts: { readonly skip: (state: Partial<S>) => boolean; readonly title?: string }
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
   * explicitly and cast the union through `unknown`.
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
  readonly skip?: ((state: Partial<UnknownState>) => boolean) | undefined;
  readonly title?: string | undefined;
}

interface WizardBranchNode {
  readonly kind: 'branch';
  readonly fn: (state: Readonly<UnknownState>) => WizardBuilderImpl;
}

type WizardNode = WizardStepNode | WizardBranchNode;

/**
 * Recomputes the active path from the answers retained so far. Branch and skip
 * predicates are intentionally re-evaluated after Back: an edited answer can
 * select a different path, so caching the prior sequence would preserve steps
 * that are no longer reachable.
 */
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
  readonly nodes: readonly WizardNode[];
  readonly defaultUi: QuickInputCapability | undefined;

  constructor(nodes: readonly WizardNode[], defaultUi: QuickInputCapability | undefined) {
    this.nodes = nodes;
    this.defaultUi = defaultUi;
  }

  step<K extends string, V>(
    key: K extends keyof S ? never : K,
    def: StepDefinition<S, V>,
    opts?: { readonly title?: string }
  ): WizardBuilder<S & Record<K, V>> {
    const node: WizardStepNode = {
      kind: 'step',
      key: key,
      def: def as unknown as ErasedStepDefinition,
      optional: false,
      title: opts?.title,
    };
    return new WizardBuilderImpl<S & Record<K, V>>([...this.nodes, node], this.defaultUi);
  }

  optionalStep<K extends string, V>(
    key: K extends keyof S ? never : K,
    def: StepDefinition<S, V>,
    opts: { readonly skip: (state: Partial<S>) => boolean; readonly title?: string }
  ): WizardBuilder<S & Partial<Record<K, V>>> {
    const node: WizardStepNode = {
      kind: 'step',
      key: key,
      def: def as unknown as ErasedStepDefinition,
      optional: true,
      skip: opts.skip as unknown as (state: Partial<UnknownState>) => boolean,
      title: opts.title,
    };
    return new WizardBuilderImpl<S & Partial<Record<K, V>>>([...this.nodes, node], this.defaultUi);
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
    return new WizardBuilderImpl<S & S2>([...this.nodes, node], this.defaultUi);
  }

  async run(
    options: WizardRunOptions
  ): Promise<Result<S, { atKey: keyof S | null; state: Partial<S> }>> {
    const { title, showStepNumbers = true, ignoreFocusOut = true, signal, logger } = options;
    const quickInput = options.ui ?? this.defaultUi;
    if (quickInput === undefined) {
      throw new Error(
        'This wizard has no quick-input surface: pass one via run({ ui }) ' +
          'or build it with the VS Code-bound wizard() export.'
      );
    }
    const backButton = quickInput.backButton;
    const state: UnknownState = {};
    let currentIndex = 0;

    for (;;) {
      let activeSequence: WizardStepNode[];
      try {
        activeSequence = computeActiveSequence(this.nodes, { ...state });
      } catch (error) {
        throw new WizardStepError('(branch)', 'branch', error);
      }

      // Keys from a step that's no longer on the active path after going
      // `back` and changing an earlier answer (or taking a different
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
      /* v8 ignore next 3 -- currentIndex is bounds-checked above; guard only satisfies noUncheckedIndexedAccess */
      if (!node) {
        return ok(state as S);
      }

      if (signal?.aborted === true) {
        return err(
          { atKey: node.key as keyof S, state: { ...state } as Partial<S> },
          { cancelled: true }
        );
      }

      logger?.debug('wizard step starting', { key: node.key, index: currentIndex });

      let outcome: StepOutcome<unknown>;
      try {
        outcome = await node.def.run({
          state: { ...state },
          title: node.title ?? title,
          step: showStepNumbers ? currentIndex + 1 : undefined,
          totalSteps: showStepNumbers ? activeSequence.length : undefined,
          ignoreFocusOut,
          backButton: currentIndex > 0 ? backButton : undefined,
          quickInput,
          signal,
        });
      } catch (error) {
        if (error instanceof StepFailure) {
          throw new WizardStepError(node.key, error.phase, error.failure);
        }
        throw new WizardStepError(node.key, 'accept', error);
      }

      if (outcome.kind === 'back') {
        logger?.debug('wizard step back', { key: node.key });
        currentIndex = Math.max(0, currentIndex - 1);
        continue;
      }

      if (outcome.kind === 'cancel') {
        logger?.debug('wizard cancelled', { key: node.key });
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
 * Starts a new wizard builder on an explicit quick-input surface. The root
 * `wizard()` export binds VS Code; a test passes a fake instead.
 *
 * @example
 * ```ts
 * const result = await createWizard(ui)
 *   .step('type', quickpickStep({
 *     items: () => [
 *       toPickItem('feature', { label: 'Feature' }),
 *       toPickItem('fix', { label: 'Bug Fix' }),
 *     ],
 *   }))
 *   .step('name', inputStep({
 *     prompt: 'Enter branch name',
 *     validate: (v) => (/^[a-z0-9-]+$/.test(v) ? undefined : 'Lowercase only'),
 *   }))
 *   .optionalStep('description', inputStep({ prompt: 'Enter description' }), {
 *     skip: (s) => s.type === 'fix',
 *   })
 *   .run({ title: 'Create Branch' });
 *
 * if (result.ok) {
 *   const { type, name, description } = result.value;
 *   await createBranch(`${type}/${name}`, description);
 * }
 * ```
 */
export function createWizard(
  capability?: QuickInputCapability
): WizardBuilder<Record<never, never>> {
  return new WizardBuilderImpl<Record<never, never>>([], capability);
}
