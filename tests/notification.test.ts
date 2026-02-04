import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { showInfo, showWarn, showError, confirm, showWithActions } from '../src/notification.js';

// Get the mocked window object
const mockedWindow = vscode.window as unknown as {
  showInformationMessage: ReturnType<typeof vi.fn>;
  showWarningMessage: ReturnType<typeof vi.fn>;
  showErrorMessage: ReturnType<typeof vi.fn>;
};

describe('notification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedWindow.showInformationMessage.mockResolvedValue(undefined);
    mockedWindow.showWarningMessage.mockResolvedValue(undefined);
    mockedWindow.showErrorMessage.mockResolvedValue(undefined);
  });

  // ============================================
  // showInfo
  // ============================================

  describe('showInfo', () => {
    it('shows information message without actions', async () => {
      await showInfo('Test message');

      expect(mockedWindow.showInformationMessage).toHaveBeenCalledWith('Test message', {
        modal: undefined,
      });
    });

    it('shows information message with modal option', async () => {
      await showInfo('Test message', { modal: true });

      expect(mockedWindow.showInformationMessage).toHaveBeenCalledWith('Test message', { modal: true });
    });

    it('shows information message with actions', async () => {
      mockedWindow.showInformationMessage.mockResolvedValue('Reload');

      const result = await showInfo('File changed', {}, 'Reload', 'Ignore');

      expect(mockedWindow.showInformationMessage).toHaveBeenCalledWith(
        'File changed',
        { modal: undefined, detail: undefined },
        'Reload',
        'Ignore'
      );
      expect(result).toBe('Reload');
    });

    it('returns undefined when no action selected', async () => {
      mockedWindow.showInformationMessage.mockResolvedValue(undefined);

      const result = await showInfo('File changed', {}, 'Reload', 'Ignore');

      expect(result).toBeUndefined();
    });

    it('shows information message with modal and detail', async () => {
      await showInfo('Test', { modal: true, detail: 'Additional info' }, 'OK');

      expect(mockedWindow.showInformationMessage).toHaveBeenCalledWith(
        'Test',
        { modal: true, detail: 'Additional info' },
        'OK'
      );
    });
  });

  // ============================================
  // showWarn
  // ============================================

  describe('showWarn', () => {
    it('shows warning message without actions', async () => {
      await showWarn('Warning message');

      expect(mockedWindow.showWarningMessage).toHaveBeenCalledWith('Warning message', {
        modal: undefined,
      });
    });

    it('shows warning message with modal option', async () => {
      await showWarn('Warning message', { modal: true });

      expect(mockedWindow.showWarningMessage).toHaveBeenCalledWith('Warning message', { modal: true });
    });

    it('shows warning message with actions', async () => {
      mockedWindow.showWarningMessage.mockResolvedValue('Continue');

      const result = await showWarn('Proceed?', {}, 'Continue', 'Cancel');

      expect(mockedWindow.showWarningMessage).toHaveBeenCalledWith(
        'Proceed?',
        { modal: undefined, detail: undefined },
        'Continue',
        'Cancel'
      );
      expect(result).toBe('Continue');
    });

    it('returns undefined when dismissed', async () => {
      mockedWindow.showWarningMessage.mockResolvedValue(undefined);

      const result = await showWarn('Proceed?', {}, 'Continue');

      expect(result).toBeUndefined();
    });
  });

  // ============================================
  // showError
  // ============================================

  describe('showError', () => {
    it('shows error message without actions', async () => {
      await showError('Error occurred');

      expect(mockedWindow.showErrorMessage).toHaveBeenCalledWith('Error occurred', { modal: undefined });
    });

    it('shows error message with modal option', async () => {
      await showError('Critical error', { modal: true });

      expect(mockedWindow.showErrorMessage).toHaveBeenCalledWith('Critical error', { modal: true });
    });

    it('shows error message with actions', async () => {
      mockedWindow.showErrorMessage.mockResolvedValue('Retry');

      const result = await showError('Failed', {}, 'Retry', 'Abort');

      expect(mockedWindow.showErrorMessage).toHaveBeenCalledWith(
        'Failed',
        { modal: undefined, detail: undefined },
        'Retry',
        'Abort'
      );
      expect(result).toBe('Retry');
    });

    it('shows error message with detail', async () => {
      await showError('Error', { modal: true, detail: 'Stack trace here' }, 'OK');

      expect(mockedWindow.showErrorMessage).toHaveBeenCalledWith(
        'Error',
        { modal: true, detail: 'Stack trace here' },
        'OK'
      );
    });
  });

  // ============================================
  // confirm
  // ============================================

  describe('confirm', () => {
    it('returns true when Yes clicked', async () => {
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

    it('returns false when No clicked', async () => {
      mockedWindow.showWarningMessage.mockResolvedValue('No');

      const result = await confirm('Delete file?');

      expect(result).toBe(false);
    });

    it('returns false when dismissed', async () => {
      mockedWindow.showWarningMessage.mockResolvedValue(undefined);

      const result = await confirm('Delete file?');

      expect(result).toBe(false);
    });

    it('uses custom button texts', async () => {
      mockedWindow.showWarningMessage.mockResolvedValue('Delete');

      const result = await confirm('Remove item?', {
        yesText: 'Delete',
        noText: 'Keep',
      });

      expect(mockedWindow.showWarningMessage).toHaveBeenCalledWith(
        'Remove item?',
        { modal: true, detail: undefined },
        'Delete',
        'Keep'
      );
      expect(result).toBe(true);
    });

    it('can be non-modal', async () => {
      mockedWindow.showWarningMessage.mockResolvedValue('Yes');

      await confirm('Proceed?', { modal: false });

      expect(mockedWindow.showWarningMessage).toHaveBeenCalledWith(
        'Proceed?',
        { modal: false, detail: undefined },
        'Yes',
        'No'
      );
    });

    it('includes detail text', async () => {
      mockedWindow.showWarningMessage.mockResolvedValue('Yes');

      await confirm('Delete?', { detail: 'This cannot be undone' });

      expect(mockedWindow.showWarningMessage).toHaveBeenCalledWith(
        'Delete?',
        { modal: true, detail: 'This cannot be undone' },
        'Yes',
        'No'
      );
    });
  });

  // ============================================
  // showWithActions
  // ============================================

  describe('showWithActions', () => {
    it('shows info notification with custom actions', async () => {
      mockedWindow.showInformationMessage.mockResolvedValue({ title: 'Save' });

      const result = await showWithActions('info', 'Unsaved changes', [
        { title: 'Save', value: 'save' },
        { title: 'Discard', value: 'discard' },
      ]);

      expect(mockedWindow.showInformationMessage).toHaveBeenCalledWith(
        'Unsaved changes',
        { modal: undefined, detail: undefined },
        { title: 'Save', isCloseAffordance: undefined },
        { title: 'Discard', isCloseAffordance: undefined }
      );
      expect(result).toBe('save');
    });

    it('shows warn notification with custom actions', async () => {
      mockedWindow.showWarningMessage.mockResolvedValue({ title: 'Continue' });

      const result = await showWithActions('warn', 'Proceed?', [
        { title: 'Continue', value: 1 },
        { title: 'Stop', value: 0 },
      ]);

      expect(mockedWindow.showWarningMessage).toHaveBeenCalled();
      expect(result).toBe(1);
    });

    it('shows error notification with custom actions', async () => {
      mockedWindow.showErrorMessage.mockResolvedValue({ title: 'Retry' });

      const result = await showWithActions('error', 'Operation failed', [
        { title: 'Retry', value: 'retry' },
        { title: 'Abort', value: 'abort' },
      ]);

      expect(mockedWindow.showErrorMessage).toHaveBeenCalled();
      expect(result).toBe('retry');
    });

    it('returns undefined when dismissed', async () => {
      mockedWindow.showInformationMessage.mockResolvedValue(undefined);

      const result = await showWithActions('info', 'Test', [{ title: 'OK', value: 'ok' }]);

      expect(result).toBeUndefined();
    });

    it('handles isCloseAffordance', async () => {
      mockedWindow.showWarningMessage.mockResolvedValue({ title: 'Cancel' });

      await showWithActions('warn', 'Test', [
        { title: 'OK', value: 'ok' },
        { title: 'Cancel', value: 'cancel', isCloseAffordance: true },
      ]);

      expect(mockedWindow.showWarningMessage).toHaveBeenCalledWith(
        'Test',
        { modal: undefined, detail: undefined },
        { title: 'OK', isCloseAffordance: undefined },
        { title: 'Cancel', isCloseAffordance: true }
      );
    });

    it('supports modal option', async () => {
      mockedWindow.showInformationMessage.mockResolvedValue({ title: 'OK' });

      await showWithActions(
        'info',
        'Test',
        [{ title: 'OK', value: 'ok' }],
        { modal: true, detail: 'Details' }
      );

      expect(mockedWindow.showInformationMessage).toHaveBeenCalledWith(
        'Test',
        { modal: true, detail: 'Details' },
        { title: 'OK', isCloseAffordance: undefined }
      );
    });

    it('handles complex value types', async () => {
      const complexValue = { id: 1, action: 'save', data: { foo: 'bar' } };
      mockedWindow.showInformationMessage.mockResolvedValue({ title: 'Save' });

      const result = await showWithActions('info', 'Test', [
        { title: 'Save', value: complexValue },
        { title: 'Cancel', value: null },
      ]);

      expect(result).toEqual(complexValue);
    });
  });
});
