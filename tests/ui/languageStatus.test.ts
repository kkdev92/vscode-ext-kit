import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { createLanguageStatusItem } from '../../src/ui/languageStatus.js';

describe('languageStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createLanguageStatusItem', () => {
    const selector = { language: 'typescript' };

    it('creates the native item with id and selector', () => {
      createLanguageStatusItem('myext.eslint', selector, {
        name: 'ESLint',
        text: '$(check) No issues',
      });

      expect(vscode.languages.createLanguageStatusItem).toHaveBeenCalledWith(
        'myext.eslint',
        selector
      );
    });

    it('applies the initial options onto the native item', () => {
      const command = { command: 'myext.showLog', title: 'Show Log' };
      const accessibilityInformation = { label: 'ESLint status' };

      const status = createLanguageStatusItem('myext.eslint', selector, {
        name: 'ESLint',
        text: '$(check) No issues',
        detail: 'Last run: just now',
        command,
        severity: 'warn',
        busy: true,
        accessibilityInformation,
      });

      expect(status.native.name).toBe('ESLint');
      expect(status.native.text).toBe('$(check) No issues');
      expect(status.native.detail).toBe('Last run: just now');
      expect(status.native.command).toBe(command);
      expect(status.native.severity).toBe(vscode.LanguageStatusSeverity.Warning);
      expect(status.native.busy).toBe(true);
      expect(status.native.accessibilityInformation).toBe(accessibilityInformation);
    });

    it('defaults severity to Information and busy to false', () => {
      const status = createLanguageStatusItem('myext.eslint', selector, {
        name: 'ESLint',
        text: 'Ready',
      });

      expect(status.native.severity).toBe(vscode.LanguageStatusSeverity.Information);
      expect(status.native.busy).toBe(false);
    });

    it("maps the severity vocabulary onto VS Code's enum", () => {
      const error = createLanguageStatusItem('a', selector, {
        name: 'X',
        text: 'x',
        severity: 'error',
      });
      const info = createLanguageStatusItem('b', selector, {
        name: 'X',
        text: 'x',
        severity: 'info',
      });

      expect(error.native.severity).toBe(vscode.LanguageStatusSeverity.Error);
      expect(info.native.severity).toBe(vscode.LanguageStatusSeverity.Information);
    });

    describe('update', () => {
      it('always replaces the text', () => {
        const status = createLanguageStatusItem('myext.eslint', selector, {
          name: 'ESLint',
          text: 'before',
        });

        status.update('$(warning) 3 problems');

        expect(status.native.text).toBe('$(warning) 3 problems');
      });

      it('patches only the fields that were given', () => {
        const command = { command: 'myext.original', title: 'Original' };
        const status = createLanguageStatusItem('myext.eslint', selector, {
          name: 'ESLint',
          text: 'before',
          detail: 'original detail',
          command,
          severity: 'info',
          busy: false,
        });

        status.update('after', { severity: 'error', busy: true });

        expect(status.native.text).toBe('after');
        expect(status.native.severity).toBe(vscode.LanguageStatusSeverity.Error);
        expect(status.native.busy).toBe(true);
        // Untouched fields keep their previous values.
        expect(status.native.detail).toBe('original detail');
        expect(status.native.command).toBe(command);
      });

      it('patches detail, command, and accessibility information', () => {
        const status = createLanguageStatusItem('myext.eslint', selector, {
          name: 'ESLint',
          text: 'x',
        });
        const command = { command: 'myext.fix', title: 'Fix' };
        const accessibilityInformation = { label: 'Three problems' };

        status.update('x', { detail: 'new detail', command, accessibilityInformation });

        expect(status.native.detail).toBe('new detail');
        expect(status.native.command).toBe(command);
        expect(status.native.accessibilityInformation).toBe(accessibilityInformation);
      });
    });

    it('dispose() disposes the native item', () => {
      const status = createLanguageStatusItem('myext.eslint', selector, {
        name: 'ESLint',
        text: 'x',
      });

      status.dispose();

      expect(status.native.dispose).toHaveBeenCalled();
    });
  });
});
