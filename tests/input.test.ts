import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { inputText } from '../src/ui/input.js';

describe('inputText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls showInputBox with the prompt', async () => {
    await inputText({ prompt: 'Enter value' });

    expect(vscode.window.showInputBox).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Enter value' })
    );
  });

  it('returns the user input', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValue('user input');

    const result = await inputText({ prompt: 'Enter value' });

    expect(result).toBe('user input');
  });

  it('returns undefined when cancelled', async () => {
    vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

    const result = await inputText({ prompt: 'Enter value' });

    expect(result).toBeUndefined();
  });

  it('passes all options to showInputBox, including ignoreFocusOut', async () => {
    const validateFn = vi.fn();
    await inputText({
      prompt: 'Enter name',
      placeHolder: 'John Doe',
      value: 'default',
      password: true,
      ignoreFocusOut: true,
      validate: validateFn,
    });

    expect(vscode.window.showInputBox).toHaveBeenCalledWith({
      prompt: 'Enter name',
      placeHolder: 'John Doe',
      value: 'default',
      password: true,
      ignoreFocusOut: true,
      validateInput: validateFn,
    });
  });

  it('defaults ignoreFocusOut to undefined (VS Code default: false)', async () => {
    await inputText({ prompt: 'Enter value' });

    const call = vi.mocked(vscode.window.showInputBox).mock.calls[0];
    expect(call?.[0]?.ignoreFocusOut).toBeUndefined();
  });

  it('passes the validation function through', async () => {
    const validateFn = vi.fn().mockReturnValue('Error message');

    await inputText({ prompt: 'Enter value', validate: validateFn });

    const call = vi.mocked(vscode.window.showInputBox).mock.calls[0];
    expect(call?.[0]?.validateInput).toBe(validateFn);
  });
});
