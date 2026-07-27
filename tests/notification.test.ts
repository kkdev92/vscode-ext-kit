import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { showInfo, showWarn, showError, confirm } from '../src/ui/notification.js';

// Get the mocked window object
const mockedWindow = vscode.window as unknown as {
  showInformationMessage: ReturnType<typeof vi.fn>;
  showWarningMessage: ReturnType<typeof vi.fn>;
  showErrorMessage: ReturnType<typeof vi.fn>;
};

function fakeMemento(initial: Record<string, unknown> = {}): vscode.Memento {
  const store = new Map<string, unknown>(Object.entries(initial));
  return {
    keys: () => [...store.keys()],
    get: ((key: string, defaultValue?: unknown) =>
      store.has(key) ? store.get(key) : defaultValue) as vscode.Memento['get'],
    update: vi.fn(async (key: string, value: unknown) => {
      if (value === undefined) {
        store.delete(key);
      } else {
        store.set(key, value);
      }
    }),
  };
}

describe('notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedWindow.showInformationMessage.mockResolvedValue(undefined);
    mockedWindow.showWarningMessage.mockResolvedValue(undefined);
    mockedWindow.showErrorMessage.mockResolvedValue(undefined);
  });

  describe('showInfo / showWarn / showError (no actions)', () => {
    it('shows an information message with no items when there are no actions', async () => {
      const result = await showInfo('Test message');

      expect(mockedWindow.showInformationMessage).toHaveBeenCalledWith('Test message', {
        modal: undefined,
        detail: undefined,
      });
      expect(result).toBeUndefined();
    });

    it('shows a warning message with modal/detail', async () => {
      await showWarn('Warning message', { modal: true, detail: 'more info' });

      expect(mockedWindow.showWarningMessage).toHaveBeenCalledWith('Warning message', {
        modal: true,
        detail: 'more info',
      });
    });

    it('shows an error message', async () => {
      await showError('Error occurred');

      expect(mockedWindow.showErrorMessage).toHaveBeenCalledWith('Error occurred', {
        modal: undefined,
        detail: undefined,
      });
    });
  });

  describe('actions carry a separate value from their title (proposal B)', () => {
    it('resolves with the value of the clicked action, not its title', async () => {
      mockedWindow.showInformationMessage.mockImplementation(
        async (
          _message: string,
          _options: unknown,
          ...items: { title: string; value: unknown }[]
        ) => items.find((i) => i.title === 'Reload')
      );

      const result = await showInfo('File changed', {
        actions: [
          { title: 'Reload', value: 'reload' as const },
          { title: 'Ignore', value: 'ignore' as const },
        ],
      });

      expect(mockedWindow.showInformationMessage).toHaveBeenCalledWith(
        'File changed',
        { modal: undefined, detail: undefined },
        { title: 'Reload', isCloseAffordance: undefined, value: 'reload' },
        { title: 'Ignore', isCloseAffordance: undefined, value: 'ignore' }
      );
      expect(result).toBe('reload');
    });

    it('returns undefined when the notification is dismissed', async () => {
      mockedWindow.showWarningMessage.mockResolvedValue(undefined);

      const result = await showWarn('Proceed?', {
        actions: [{ title: 'Continue', value: 'continue' as const }],
      });

      expect(result).toBeUndefined();
    });

    it('resolves the correct value even when two actions share the same title (bug #12 regression)', async () => {
      // VS Code resolves with the *object reference* it was given, so two
      // items with an identical title must not be confused with each other
      // via a title-string lookup.
      mockedWindow.showErrorMessage.mockImplementation(
        async (
          _message: string,
          _options: unknown,
          ...items: { title: string; value: unknown }[]
        ) => items[1] // always "select" the second "Retry"
      );

      const result = await showError('Failed twice', {
        actions: [
          { title: 'Retry', value: 'retry-first' as const },
          { title: 'Retry', value: 'retry-second' as const },
        ],
      });

      expect(result).toBe('retry-second');
    });

    it('passes isCloseAffordance through', async () => {
      await showWarn('Test', {
        actions: [
          { title: 'OK', value: 'ok' as const },
          { title: 'Cancel', value: 'cancel' as const, isCloseAffordance: true },
        ],
      });

      expect(mockedWindow.showWarningMessage).toHaveBeenCalledWith(
        'Test',
        { modal: undefined, detail: undefined },
        { title: 'OK', isCloseAffordance: undefined, value: 'ok' },
        { title: 'Cancel', isCloseAffordance: true, value: 'cancel' }
      );
    });
  });

  describe('confirm', () => {
    it('defaults to a modal warning with Yes/No', async () => {
      mockedWindow.showWarningMessage.mockResolvedValue('Yes');

      const result = await confirm('Delete file?');

      expect(mockedWindow.showWarningMessage).toHaveBeenCalledWith(
        'Delete file?',
        { modal: true, detail: undefined },
        'Yes',
        'No'
      );
      expect(result).toBe(true);
    });

    it('returns false when No is clicked', async () => {
      mockedWindow.showWarningMessage.mockResolvedValue('No');

      expect(await confirm('Delete file?')).toBe(false);
    });

    it('returns false when dismissed (Escape)', async () => {
      mockedWindow.showWarningMessage.mockResolvedValue(undefined);

      expect(await confirm('Delete file?')).toBe(false);
    });

    it('uses custom button texts', async () => {
      mockedWindow.showWarningMessage.mockResolvedValue('Delete');

      const result = await confirm('Remove item?', { yesText: 'Delete', noText: 'Keep' });

      expect(mockedWindow.showWarningMessage).toHaveBeenCalledWith(
        'Remove item?',
        { modal: true, detail: undefined },
        'Delete',
        'Keep'
      );
      expect(result).toBe(true);
    });

    it('can be non-modal, with detail', async () => {
      mockedWindow.showWarningMessage.mockResolvedValue('Yes');

      await confirm('Proceed?', { modal: false, detail: 'why' });

      expect(mockedWindow.showWarningMessage).toHaveBeenCalledWith(
        'Proceed?',
        { modal: false, detail: 'why' },
        'Yes',
        'No'
      );
    });

    describe('severity', () => {
      it('defaults to the warning dialog', async () => {
        mockedWindow.showWarningMessage.mockResolvedValue('Yes');
        await confirm('Q?');
        expect(mockedWindow.showWarningMessage).toHaveBeenCalled();
        expect(mockedWindow.showInformationMessage).not.toHaveBeenCalled();
      });

      it('uses showInformationMessage for severity: info', async () => {
        mockedWindow.showInformationMessage.mockResolvedValue('Yes');
        const result = await confirm('Enable feature?', { severity: 'info' });
        expect(mockedWindow.showInformationMessage).toHaveBeenCalledWith(
          'Enable feature?',
          { modal: true, detail: undefined },
          'Yes',
          'No'
        );
        expect(result).toBe(true);
      });

      it('uses showErrorMessage for severity: error', async () => {
        mockedWindow.showErrorMessage.mockResolvedValue('No');
        const result = await confirm('Really?', { severity: 'error' });
        expect(mockedWindow.showErrorMessage).toHaveBeenCalled();
        expect(result).toBe(false);
      });
    });

    describe('remember ("don\'t ask again")', () => {
      it('skips prompting entirely when already remembered', async () => {
        const memento = fakeMemento({ 'myext.confirmed': true });

        const result = await confirm('Q?', { remember: { memento, key: 'myext.confirmed' } });

        expect(result).toBe(true);
        expect(mockedWindow.showWarningMessage).not.toHaveBeenCalled();
      });

      it('adds a "Don\'t Ask Again" button and persists the choice when clicked', async () => {
        const memento = fakeMemento();
        mockedWindow.showWarningMessage.mockResolvedValue("Don't Ask Again");

        const result = await confirm('Q?', { remember: { memento, key: 'myext.confirmed' } });

        expect(mockedWindow.showWarningMessage).toHaveBeenCalledWith(
          'Q?',
          { modal: true, detail: undefined },
          'Yes',
          'No',
          "Don't Ask Again"
        );
        expect(result).toBe(true);
        expect(memento.update).toHaveBeenCalledWith('myext.confirmed', true);
      });

      it('does not persist anything when a plain No is clicked', async () => {
        const memento = fakeMemento();
        mockedWindow.showWarningMessage.mockResolvedValue('No');

        const result = await confirm('Q?', { remember: { memento, key: 'myext.confirmed' } });

        expect(result).toBe(false);
        expect(memento.update).not.toHaveBeenCalled();
      });
    });
  });
});
