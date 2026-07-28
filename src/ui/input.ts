import * as vscode from 'vscode';

/**
 * Options for {@link inputText}.
 */
export interface InputTextOptions {
  /** Prompt text to display */
  prompt: string;
  /** Placeholder text */
  placeHolder?: string;
  /** Initial value */
  value?: string;
  /** Password input mode */
  password?: boolean;
  /** Validation function */
  validate?: (value: string) => string | undefined | Promise<string | undefined>;
  /**
   * Keep the input box open when focus moves elsewhere (default: `false`,
   * matching `vscode.window.showInputBox`'s own default).
   */
  ignoreFocusOut?: boolean;
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
    ignoreFocusOut: opts.ignoreFocusOut,
    validateInput: opts.validate,
  });
}
