import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { pickOne, pickMany, inputText, wizard, type WizardQuickPickItem, type WizardOptions } from '../src/ui.js';

describe('UI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('pickOne', () => {
    it('should call showQuickPick with canPickMany: false', async () => {
      const items = [{ label: 'Item 1' }, { label: 'Item 2' }];

      await pickOne(items);

      expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
        items,
        expect.objectContaining({ canPickMany: false })
      );
    });

    it('should return selected item', async () => {
      const items = [{ label: 'Item 1' }, { label: 'Item 2' }];
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(items[0]);

      const result = await pickOne(items);

      expect(result).toBe(items[0]);
    });

    it('should return undefined when cancelled', async () => {
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

      const result = await pickOne([{ label: 'Item 1' }]);

      expect(result).toBeUndefined();
    });

    it('should pass options to showQuickPick', async () => {
      const items = [{ label: 'Item 1' }];
      const opts = { placeHolder: 'Select an item', title: 'Title' };

      await pickOne(items, opts);

      expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
        items,
        expect.objectContaining({
          placeHolder: 'Select an item',
          title: 'Title',
          canPickMany: false,
        })
      );
    });

    it('should work with custom item types', async () => {
      interface CustomItem extends vscode.QuickPickItem {
        value: number;
      }
      const items: CustomItem[] = [
        { label: 'Option 1', value: 1 },
        { label: 'Option 2', value: 2 },
      ];
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(items[1]);

      const result = await pickOne(items);

      expect(result?.value).toBe(2);
    });
  });

  describe('pickMany', () => {
    it('should call showQuickPick with canPickMany: true', async () => {
      const items = [{ label: 'Item 1' }, { label: 'Item 2' }];

      await pickMany(items);

      expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
        items,
        expect.objectContaining({ canPickMany: true })
      );
    });

    it('should return array of selected items', async () => {
      const items = [{ label: 'Item 1' }, { label: 'Item 2' }, { label: 'Item 3' }];
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue([items[0], items[2]]);

      const result = await pickMany(items);

      expect(result).toEqual([items[0], items[2]]);
    });

    it('should return undefined when cancelled', async () => {
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue(undefined);

      const result = await pickMany([{ label: 'Item 1' }]);

      expect(result).toBeUndefined();
    });

    it('should return empty array when nothing selected', async () => {
      vi.mocked(vscode.window.showQuickPick).mockResolvedValue([]);

      const result = await pickMany([{ label: 'Item 1' }]);

      expect(result).toEqual([]);
    });

    it('should pass options to showQuickPick', async () => {
      const items = [{ label: 'Item 1' }];
      const opts = { placeHolder: 'Select items' };

      await pickMany(items, opts);

      expect(vscode.window.showQuickPick).toHaveBeenCalledWith(
        items,
        expect.objectContaining({
          placeHolder: 'Select items',
          canPickMany: true,
        })
      );
    });
  });

  describe('inputText', () => {
    it('should call showInputBox with prompt', async () => {
      await inputText({ prompt: 'Enter value' });

      expect(vscode.window.showInputBox).toHaveBeenCalledWith(
        expect.objectContaining({ prompt: 'Enter value' })
      );
    });

    it('should return user input', async () => {
      vi.mocked(vscode.window.showInputBox).mockResolvedValue('user input');

      const result = await inputText({ prompt: 'Enter value' });

      expect(result).toBe('user input');
    });

    it('should return undefined when cancelled', async () => {
      vi.mocked(vscode.window.showInputBox).mockResolvedValue(undefined);

      const result = await inputText({ prompt: 'Enter value' });

      expect(result).toBeUndefined();
    });

    it('should pass all options to showInputBox', async () => {
      const validateFn = vi.fn();
      await inputText({
        prompt: 'Enter name',
        placeHolder: 'John Doe',
        value: 'default',
        password: true,
        validate: validateFn,
      });

      expect(vscode.window.showInputBox).toHaveBeenCalledWith({
        prompt: 'Enter name',
        placeHolder: 'John Doe',
        value: 'default',
        password: true,
        validateInput: validateFn,
      });
    });

    it('should pass validation function', async () => {
      const validateFn = vi.fn().mockReturnValue('Error message');

      await inputText({
        prompt: 'Enter value',
        validate: validateFn,
      });

      const call = vi.mocked(vscode.window.showInputBox).mock.calls[0];
      expect(call?.[0]?.validateInput).toBe(validateFn);
    });
  });

  describe('wizard', () => {
    it('should create QuickPick for quickpick step', async () => {
      const mockQuickPick = {
        title: '',
        placeholder: '',
        canSelectMany: false,
        items: [] as WizardQuickPickItem<string>[],
        selectedItems: [] as WizardQuickPickItem<string>[],
        buttons: [] as unknown[],
        onDidAccept: vi.fn((cb: () => void) => {
          setTimeout(() => {
            mockQuickPick.selectedItems = [{ label: 'Test', value: 'test' }];
            cb();
          }, 0);
          return { dispose: vi.fn() };
        }),
        onDidTriggerButton: vi.fn(() => ({ dispose: vi.fn() })),
        onDidHide: vi.fn(() => ({ dispose: vi.fn() })),
        show: vi.fn(),
        dispose: vi.fn(),
      };
      vi.mocked(vscode.window.createQuickPick).mockReturnValue(mockQuickPick as unknown as ReturnType<typeof vscode.window.createQuickPick>);

      interface TestState { choice: string }
      const options: WizardOptions<TestState> = {
        title: 'Test Wizard',
        steps: [
          {
            id: 'choice',
            type: 'quickpick',
            placeholder: 'Select one',
            items: [{ label: 'Test', value: 'test' }],
          },
        ],
      };

      const resultPromise = wizard(options);
      await new Promise((r) => setTimeout(r, 10));
      const result = await resultPromise;

      expect(vscode.window.createQuickPick).toHaveBeenCalled();
      expect(result.completed).toBe(true);
      expect(result.state.choice).toBe('test');
    });

    it('should create InputBox for input step', async () => {
      const mockInputBox = {
        title: '',
        prompt: '',
        placeholder: '',
        password: false,
        value: 'typed value',
        validationMessage: undefined as string | undefined,
        buttons: [] as unknown[],
        onDidAccept: vi.fn((cb: () => void) => {
          setTimeout(() => cb(), 0);
          return { dispose: vi.fn() };
        }),
        onDidTriggerButton: vi.fn(() => ({ dispose: vi.fn() })),
        onDidHide: vi.fn(() => ({ dispose: vi.fn() })),
        onDidChangeValue: vi.fn(() => ({ dispose: vi.fn() })),
        show: vi.fn(),
        dispose: vi.fn(),
      };
      vi.mocked(vscode.window.createInputBox).mockReturnValue(mockInputBox as unknown as ReturnType<typeof vscode.window.createInputBox>);

      interface TestState { name: string }
      const options: WizardOptions<TestState> = {
        title: 'Test Wizard',
        steps: [
          {
            id: 'name',
            type: 'input',
            prompt: 'Enter name',
            placeholder: 'Name',
          },
        ],
      };

      const resultPromise = wizard(options);
      await new Promise((r) => setTimeout(r, 10));
      const result = await resultPromise;

      expect(vscode.window.createInputBox).toHaveBeenCalled();
      expect(result.completed).toBe(true);
      expect(result.state.name).toBe('typed value');
    });

    it('should return completed false when cancelled', async () => {
      const mockQuickPick = {
        title: '',
        placeholder: '',
        canSelectMany: false,
        items: [] as WizardQuickPickItem<string>[],
        selectedItems: [] as WizardQuickPickItem<string>[],
        buttons: [] as unknown[],
        onDidAccept: vi.fn(() => ({ dispose: vi.fn() })),
        onDidTriggerButton: vi.fn(() => ({ dispose: vi.fn() })),
        onDidHide: vi.fn((cb: () => void) => {
          setTimeout(() => cb(), 0);
          return { dispose: vi.fn() };
        }),
        show: vi.fn(),
        dispose: vi.fn(),
      };
      vi.mocked(vscode.window.createQuickPick).mockReturnValue(mockQuickPick as unknown as ReturnType<typeof vscode.window.createQuickPick>);

      interface TestState { choice: string }
      const options: WizardOptions<TestState> = {
        title: 'Test Wizard',
        steps: [
          {
            id: 'choice',
            type: 'quickpick',
            items: [{ label: 'Test', value: 'test' }],
          },
        ],
      };

      const resultPromise = wizard(options);
      await new Promise((r) => setTimeout(r, 10));
      const result = await resultPromise;

      expect(result.completed).toBe(false);
      expect(result.state.choice).toBeUndefined();
    });

    it('should show step numbers when showStepNumbers is true', async () => {
      const mockQuickPick = {
        title: '',
        placeholder: '',
        canSelectMany: false,
        items: [] as WizardQuickPickItem<string>[],
        selectedItems: [] as WizardQuickPickItem<string>[],
        buttons: [] as unknown[],
        onDidAccept: vi.fn((cb: () => void) => {
          setTimeout(() => {
            mockQuickPick.selectedItems = [{ label: 'Test', value: 'test' }];
            cb();
          }, 0);
          return { dispose: vi.fn() };
        }),
        onDidTriggerButton: vi.fn(() => ({ dispose: vi.fn() })),
        onDidHide: vi.fn(() => ({ dispose: vi.fn() })),
        show: vi.fn(),
        dispose: vi.fn(),
      };
      vi.mocked(vscode.window.createQuickPick).mockReturnValue(mockQuickPick as unknown as ReturnType<typeof vscode.window.createQuickPick>);

      interface TestState { choice: string }
      const options: WizardOptions<TestState> = {
        title: 'My Wizard',
        showStepNumbers: true,
        steps: [
          {
            id: 'choice',
            type: 'quickpick',
            items: [{ label: 'Test', value: 'test' }],
          },
        ],
      };

      const resultPromise = wizard(options);
      await new Promise((r) => setTimeout(r, 10));
      await resultPromise;

      expect(mockQuickPick.title).toContain('1/1');
    });

    it('should use initial state values', async () => {
      const mockInputBox = {
        title: '',
        prompt: '',
        placeholder: '',
        password: false,
        value: '',
        validationMessage: undefined as string | undefined,
        buttons: [] as unknown[],
        onDidAccept: vi.fn((cb: () => void) => {
          setTimeout(() => cb(), 0);
          return { dispose: vi.fn() };
        }),
        onDidTriggerButton: vi.fn(() => ({ dispose: vi.fn() })),
        onDidHide: vi.fn(() => ({ dispose: vi.fn() })),
        onDidChangeValue: vi.fn(() => ({ dispose: vi.fn() })),
        show: vi.fn(),
        dispose: vi.fn(),
      };
      vi.mocked(vscode.window.createInputBox).mockReturnValue(mockInputBox as unknown as ReturnType<typeof vscode.window.createInputBox>);

      interface TestState { name: string; email: string }
      const options: WizardOptions<TestState> = {
        title: 'Test Wizard',
        initialState: { email: 'initial@test.com' },
        steps: [
          {
            id: 'name',
            type: 'input',
            prompt: 'Enter name',
          },
        ],
      };

      mockInputBox.value = 'John';
      const resultPromise = wizard(options);
      await new Promise((r) => setTimeout(r, 10));
      const result = await resultPromise;

      expect(result.state.email).toBe('initial@test.com');
      expect(result.state.name).toBe('John');
    });

    it('should skip steps when skip returns true', async () => {
      const mockInputBox = {
        title: '',
        prompt: '',
        placeholder: '',
        password: false,
        value: 'result',
        validationMessage: undefined as string | undefined,
        buttons: [] as unknown[],
        onDidAccept: vi.fn((cb: () => void) => {
          setTimeout(() => cb(), 0);
          return { dispose: vi.fn() };
        }),
        onDidTriggerButton: vi.fn(() => ({ dispose: vi.fn() })),
        onDidHide: vi.fn(() => ({ dispose: vi.fn() })),
        onDidChangeValue: vi.fn(() => ({ dispose: vi.fn() })),
        show: vi.fn(),
        dispose: vi.fn(),
      };
      vi.mocked(vscode.window.createInputBox).mockReturnValue(mockInputBox as unknown as ReturnType<typeof vscode.window.createInputBox>);

      interface TestState { first: string; second: string }
      const options: WizardOptions<TestState> = {
        title: 'Test Wizard',
        steps: [
          {
            id: 'first',
            type: 'input',
            prompt: 'First',
          },
          {
            id: 'second',
            type: 'input',
            prompt: 'Second',
            skip: () => true, // Always skip
          },
        ],
      };

      const resultPromise = wizard(options);
      await new Promise((r) => setTimeout(r, 10));
      const result = await resultPromise;

      expect(result.completed).toBe(true);
      expect(result.state.first).toBe('result');
      expect(result.state.second).toBeUndefined();
    });

    it('should handle empty steps array', async () => {
      type TestState = Record<string, unknown>;
      const options: WizardOptions<TestState> = {
        title: 'Empty Wizard',
        steps: [],
      };

      const result = await wizard(options);

      expect(result.completed).toBe(true);
      expect(result.state).toEqual({});
    });
  });
});
