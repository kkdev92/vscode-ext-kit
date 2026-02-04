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
 * QuickPick step definition.
 */
export interface WizardQuickPickStep<TState, TKey extends keyof TState> extends WizardStepBase<
  TState,
  TKey
> {
  type: 'quickpick';
  /** Placeholder text */
  placeholder?: string;
  /** Items to choose from (can be dynamic based on state) */
  items:
    | WizardQuickPickItem<TState[TKey]>[]
    | ((state: Partial<TState>) => WizardQuickPickItem<TState[TKey]>[]);
  /** Allow multiple selections */
  canPickMany?: boolean;
}

/**
 * Input step definition.
 */
export interface WizardInputStep<TState, TKey extends keyof TState> extends WizardStepBase<
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

    let result: unknown;

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

    // Handle back navigation
    if (result === Symbol.for('back')) {
      currentIndex = Math.max(0, currentIndex - 1);
      continue;
    }

    // Handle cancellation
    if (result === undefined) {
      return { completed: false, state };
    }

    // Store result and move to next step
    (state as Record<string, unknown>)[step.id as string] = result;
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
): Promise<TState[TKey] | symbol | undefined> {
  return new Promise((resolve) => {
    const quickPick = vscode.window.createQuickPick<WizardQuickPickItem<TState[TKey]>>();

    quickPick.title = title;
    quickPick.placeholder = step.placeholder;
    quickPick.canSelectMany = step.canPickMany ?? false;

    // Get items (static or dynamic)
    const items = typeof step.items === 'function' ? step.items(state) : step.items;
    quickPick.items = items;

    // Add back button if available
    if (backButton) {
      quickPick.buttons = [backButton];
    }

    quickPick.onDidAccept(() => {
      const selected = quickPick.selectedItems;
      quickPick.dispose();

      if (step.canPickMany) {
        resolve(selected.map((item) => item.value) as TState[TKey]);
      } else {
        resolve(selected[0]?.value);
      }
    });

    quickPick.onDidTriggerButton((button) => {
      if (button === backButton) {
        quickPick.dispose();
        resolve(Symbol.for('back'));
      }
    });

    quickPick.onDidHide(() => {
      quickPick.dispose();
      resolve(undefined);
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
): Promise<string | symbol | undefined> {
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

      const value = inputBox.value;
      inputBox.dispose();
      resolve(value as TState[TKey] extends string ? string : never);
    });

    inputBox.onDidTriggerButton((button) => {
      if (button === backButton) {
        inputBox.dispose();
        resolve(Symbol.for('back'));
      }
    });

    inputBox.onDidHide(() => {
      inputBox.dispose();
      resolve(undefined);
    });

    inputBox.show();
  });
}
