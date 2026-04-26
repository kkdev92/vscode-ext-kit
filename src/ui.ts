import * as vscode from 'vscode';
import type { InputTextOptions } from './types.js';

// ============================================
// Basic UI Utilities
// ============================================

/**
 * Shows a QuickPick for single item selection.
 *
 * @param items - Items to display
 * @param opts - QuickPick options
 * @returns Selected item or undefined if cancelled
 *
 * @example
 * ```typescript
 * const items = [
 *   { label: 'Option 1', description: 'First option', value: 1 },
 *   { label: 'Option 2', description: 'Second option', value: 2 },
 * ];
 * const selected = await pickOne(items, { placeHolder: 'Select an option' });
 * if (selected) {
 *   console.log(selected.value);
 * }
 * ```
 */
export async function pickOne<T extends vscode.QuickPickItem>(
  items: readonly T[],
  opts?: vscode.QuickPickOptions
): Promise<T | undefined> {
  return vscode.window.showQuickPick(items, {
    ...opts,
    canPickMany: false,
  }) as Promise<T | undefined>;
}

/**
 * Shows a QuickPick for multiple item selection.
 *
 * @param items - Items to display
 * @param opts - QuickPick options
 * @returns Array of selected items or undefined if cancelled
 *
 * @example
 * ```typescript
 * const items = [
 *   { label: 'Feature A', picked: true },
 *   { label: 'Feature B', picked: false },
 *   { label: 'Feature C', picked: true },
 * ];
 * const selected = await pickMany(items, { placeHolder: 'Select features' });
 * if (selected && selected.length > 0) {
 *   console.log('Selected:', selected.map(s => s.label));
 * }
 * ```
 */
export async function pickMany<T extends vscode.QuickPickItem>(
  items: readonly T[],
  opts?: vscode.QuickPickOptions
): Promise<T[] | undefined> {
  return vscode.window.showQuickPick(items, {
    ...opts,
    canPickMany: true,
  }) as Promise<T[] | undefined>;
}

/**
 * Shows an InputBox for text input with optional validation.
 *
 * @param opts - InputBox options including prompt, placeholder, and validation
 * @returns User input string or undefined if cancelled
 *
 * @example
 * ```typescript
 * const name = await inputText({
 *   prompt: 'Enter your name',
 *   placeHolder: 'John Doe',
 *   validate: (value) => {
 *     if (value.length < 2) {
 *       return 'Name must be at least 2 characters';
 *     }
 *     return undefined;
 *   },
 * });
 *
 * // Password input
 * const password = await inputText({
 *   prompt: 'Enter password',
 *   password: true,
 * });
 * ```
 */
export async function inputText(opts: InputTextOptions): Promise<string | undefined> {
  return vscode.window.showInputBox({
    prompt: opts.prompt,
    placeHolder: opts.placeHolder,
    value: opts.value,
    password: opts.password,
    validateInput: opts.validate,
  });
}

// ============================================
// Multi-Step Wizard
// ============================================

/**
 * QuickPick item with a value.
 */
export interface WizardQuickPickItem<T = string> extends vscode.QuickPickItem {
  /** The value associated with this item */
  value: T;
}

/**
 * Base step definition.
 */
interface WizardStepBase<TState, TKey extends keyof TState> {
  /** Unique identifier for this step (must be a key in the state) */
  id: TKey;
  /** Title displayed at the top of the input */
  title?: string;
  /** Skip this step based on current state */
  skip?: (state: Partial<TState>) => boolean;
}

/**
 * QuickPick step (single selection). Inferred when `canPickMany` is omitted
 * or `false`. Items must carry values matching `TState[TKey]`.
 */
export interface WizardQuickPickStepSingle<
  TState,
  TKey extends keyof TState,
> extends WizardStepBase<TState, TKey> {
  type: 'quickpick';
  /** Placeholder text */
  placeholder?: string;
  /** Items to choose from (can be dynamic based on state) */
  items:
    | WizardQuickPickItem<TState[TKey]>[]
    | ((state: Partial<TState>) => WizardQuickPickItem<TState[TKey]>[]);
  /** Allow multiple selections */
  canPickMany?: false;
}

/**
 * QuickPick step (multi selection). Only valid when `TState[TKey]` is itself
 * an array — otherwise the type collapses to `never`, surfacing the
 * `canPickMany: true` + non-array state mismatch at compile time.
 */
export interface WizardQuickPickStepMulti<TState, TKey extends keyof TState> extends WizardStepBase<
  TState,
  TKey
> {
  type: 'quickpick';
  /** Placeholder text */
  placeholder?: string;
  /** Items to choose from (can be dynamic based on state) */
  items: TState[TKey] extends readonly (infer U)[]
    ? WizardQuickPickItem<U>[] | ((state: Partial<TState>) => WizardQuickPickItem<U>[])
    : never;
  /** Multiple selections enabled */
  canPickMany: true;
}

/**
 * QuickPick step definition (single or multi).
 */
export type WizardQuickPickStep<TState, TKey extends keyof TState> =
  | WizardQuickPickStepSingle<TState, TKey>
  | WizardQuickPickStepMulti<TState, TKey>;

/**
 * Input step definition. Only valid when `TState[TKey]` is `string`; for
 * non-string state fields the type collapses to `never`, so the step is
 * rejected at compile time instead of producing a runtime type mismatch.
 */
export type WizardInputStep<TState, TKey extends keyof TState> = TState[TKey] extends string
  ? WizardInputStepValid<TState, TKey>
  : never;

interface WizardInputStepValid<TState, TKey extends keyof TState> extends WizardStepBase<
  TState,
  TKey
> {
  type: 'input';
  /** Prompt text */
  prompt?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Default value (can be dynamic based on state) */
  value?: string | ((state: Partial<TState>) => string);
  /** Password mode */
  password?: boolean;
  /** Validation function */
  validate?: (value: string, state: Partial<TState>) => string | undefined;
}

/**
 * A wizard step can be either a QuickPick or Input step.
 */
export type WizardStep<TState, TKey extends keyof TState = keyof TState> =
  | WizardQuickPickStep<TState, TKey>
  | WizardInputStep<TState, TKey>;

/**
 * Wizard configuration options.
 */
export interface WizardOptions<TState> {
  /** Title displayed in the wizard */
  title: string;
  /** Array of steps to execute */
  steps: { [K in keyof TState]: WizardStep<TState, K> }[keyof TState][];
  /** Initial state values */
  initialState?: Partial<TState>;
  /** Show step numbers (e.g., "Step 1 of 3") */
  showStepNumbers?: boolean;
}

/**
 * Result of a wizard execution.
 */
export interface WizardResult<TState> {
  /** Whether the wizard completed successfully */
  completed: boolean;
  /** The final state (partial if cancelled) */
  state: Partial<TState>;
}

/**
 * Runs a multi-step wizard with support for navigation.
 *
 * Provides a guided, multi-step input experience with:
 * - Step tracking (e.g., "Step 1 of 3")
 * - Back navigation via button
 * - Conditional step skipping
 * - Dynamic items and values based on previous inputs
 * - State management between steps
 *
 * @param options - Wizard configuration
 * @returns Wizard result with completion status and final state
 *
 * @example
 * ```typescript
 * interface BranchState {
 *   type: 'feature' | 'fix' | 'chore';
 *   name: string;
 *   description: string;
 * }
 *
 * const result = await wizard<BranchState>({
 *   title: 'Create Branch',
 *   steps: [
 *     {
 *       id: 'type',
 *       type: 'quickpick',
 *       placeholder: 'Select branch type',
 *       items: [
 *         { label: 'Feature', description: 'New feature', value: 'feature' },
 *         { label: 'Bug Fix', description: 'Fix a bug', value: 'fix' },
 *         { label: 'Chore', description: 'Maintenance', value: 'chore' },
 *       ],
 *     },
 *     {
 *       id: 'name',
 *       type: 'input',
 *       prompt: 'Enter branch name',
 *       placeholder: 'my-feature',
 *       validate: (value) => {
 *         if (!/^[a-z0-9-]+$/.test(value)) {
 *           return 'Use lowercase letters, numbers, and hyphens only';
 *         }
 *         return undefined;
 *       },
 *     },
 *     {
 *       id: 'description',
 *       type: 'input',
 *       prompt: 'Enter description (optional)',
 *       skip: (state) => state.type === 'chore',
 *     },
 *   ],
 * });
 *
 * if (result.completed) {
 *   const { type, name, description } = result.state as BranchState;
 *   await createBranch(`${type}/${name}`, description);
 * }
 * ```
 */
/**
 * Internal tagged result returned by step runners.
 * Public API still surfaces only `WizardResult` — this union just keeps
 * the wizard control flow type-safe instead of relying on a sentinel
 * value that can clash with user values like `undefined`.
 */
type StepResult<T> = { kind: 'value'; value: T } | { kind: 'back' } | { kind: 'cancel' };

export async function wizard<TState extends Record<string, unknown>>(
  options: WizardOptions<TState>
): Promise<WizardResult<TState>> {
  const { title, steps, initialState = {}, showStepNumbers = true } = options;
  const state: Partial<TState> = { ...initialState };

  // Filter out skipped steps
  const getActiveSteps = () => steps.filter((step) => !step.skip?.(state));

  let currentIndex = 0;

  while (currentIndex < getActiveSteps().length) {
    const activeSteps = getActiveSteps();
    const step = activeSteps[currentIndex];

    if (!step) {
      break;
    }

    // Build step title with step numbers
    const stepTitle = showStepNumbers
      ? `${title} (${currentIndex + 1}/${activeSteps.length})`
      : (step.title ?? title);

    // Create back button for navigation
    const backButton: vscode.QuickInputButton = {
      iconPath: new vscode.ThemeIcon('arrow-left'),
      tooltip: 'Back',
    };

    let result: StepResult<unknown>;

    if (step.type === 'quickpick') {
      result = await runQuickPickStep(
        step as WizardQuickPickStep<TState, keyof TState>,
        state,
        stepTitle,
        currentIndex > 0 ? backButton : undefined
      );
    } else {
      result = await runInputStep(
        step as WizardInputStep<TState, keyof TState>,
        state,
        stepTitle,
        currentIndex > 0 ? backButton : undefined
      );
    }

    if (result.kind === 'back') {
      currentIndex = Math.max(0, currentIndex - 1);
      continue;
    }

    if (result.kind === 'cancel') {
      return { completed: false, state };
    }

    // Store result and move to next step
    (state as Record<string, unknown>)[step.id as string] = result.value;
    currentIndex++;
  }

  return { completed: true, state };
}

/**
 * Runs a QuickPick step.
 */
async function runQuickPickStep<TState, TKey extends keyof TState>(
  step: WizardQuickPickStep<TState, TKey>,
  state: Partial<TState>,
  title: string,
  backButton?: vscode.QuickInputButton
): Promise<StepResult<TState[TKey]>> {
  return new Promise((resolve) => {
    // The public `WizardQuickPickStep` union has different `items` types for
    // single (value: TState[TKey]) and multi (value: array element). Use a
    // permissive value type internally and reapply the right type on resolve.
    type AnyItem = WizardQuickPickItem<unknown>;
    const quickPick = vscode.window.createQuickPick<AnyItem>();

    quickPick.title = title;
    quickPick.placeholder = step.placeholder;
    quickPick.canSelectMany = step.canPickMany ?? false;

    const rawItems = typeof step.items === 'function' ? step.items(state) : step.items;
    quickPick.items = rawItems as AnyItem[];

    // Add back button if available
    if (backButton) {
      quickPick.buttons = [backButton];
    }

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems;

      if (step.canPickMany) {
        resolve({
          kind: 'value',
          value: selected.map((item) => item.value) as TState[TKey],
        });
      } else if (selected[0]) {
        resolve({ kind: 'value', value: selected[0].value as TState[TKey] });
      } else {
        // Accept fired with no selection — treat as cancel for consistency
        // with the historical behaviour where `selected[0]?.value` produced
        // an undefined result that the wizard interpreted as cancellation.
        resolve({ kind: 'cancel' });
      }

      quickPick.dispose();
    });

    quickPick.onDidTriggerButton((button) => {
      if (button === backButton) {
        resolve({ kind: 'back' });
        quickPick.dispose();
      }
    });

    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve({ kind: 'cancel' });
    });

    quickPick.show();
  });
}

/**
 * Runs an Input step.
 */
async function runInputStep<TState, TKey extends keyof TState>(
  step: WizardInputStep<TState, TKey>,
  state: Partial<TState>,
  title: string,
  backButton?: vscode.QuickInputButton
): Promise<StepResult<TState[TKey]>> {
  return new Promise((resolve) => {
    const inputBox = vscode.window.createInputBox();

    inputBox.title = title;
    inputBox.prompt = step.prompt;
    inputBox.placeholder = step.placeholder;
    inputBox.password = step.password ?? false;

    // Get default value (static or dynamic)
    if (step.value !== undefined) {
      inputBox.value = typeof step.value === 'function' ? step.value(state) : step.value;
    }

    // Add back button if available
    if (backButton) {
      inputBox.buttons = [backButton];
    }

    // Handle validation
    if (step.validate) {
      inputBox.onDidChangeValue((value) => {
        const error = step.validate?.(value, state);
        inputBox.validationMessage = error;
      });
    }

    inputBox.onDidAccept(() => {
      // Check validation before accepting
      if (step.validate) {
        const error = step.validate(inputBox.value, state);
        if (error) {
          inputBox.validationMessage = error;
          return;
        }
      }

      // WizardInputStep is constrained to keys whose state value is a string,
      // so the cast below is safe at runtime — see the type declaration.
      resolve({ kind: 'value', value: inputBox.value as TState[TKey] });
      inputBox.dispose();
    });

    inputBox.onDidTriggerButton((button) => {
      if (button === backButton) {
        resolve({ kind: 'back' });
        inputBox.dispose();
      }
    });

    inputBox.onDidHide(() => {
      inputBox.dispose();
      resolve({ kind: 'cancel' });
    });

    inputBox.show();
  });
}
