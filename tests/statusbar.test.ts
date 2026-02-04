import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createStatusBarItem, showStatusMessage } from '../src/statusbar.js';

describe('statusbar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================
  // createStatusBarItem
  // ============================================

  describe('createStatusBarItem', () => {
    it('creates a status bar item with required options', () => {
      const item = createStatusBarItem('test.item', {
        text: 'Test',
      });

      expect(item).toBeDefined();
      expect(item.native).toBeDefined();
      expect(item.native.text).toBe('Test');
    });

    it('creates with right alignment', () => {
      const item = createStatusBarItem('test.item', {
        text: 'Test',
        alignment: 'right',
      });

      expect(item).toBeDefined();
    });

    it('creates with priority', () => {
      const item = createStatusBarItem('test.item', {
        text: 'Test',
        priority: 100,
      });

      expect(item).toBeDefined();
    });

    it('applies tooltip', () => {
      const item = createStatusBarItem('test.item', {
        text: 'Test',
        tooltip: 'Test tooltip',
      });

      expect(item.native.tooltip).toBe('Test tooltip');
    });

    it('applies command', () => {
      const item = createStatusBarItem('test.item', {
        text: 'Test',
        command: 'test.command',
      });

      expect(item.native.command).toBe('test.command');
    });

    it('applies command object', () => {
      const command = { command: 'test.cmd', title: 'Test', arguments: [1, 2] };
      const item = createStatusBarItem('test.item', {
        text: 'Test',
        command,
      });

      expect(item.native.command).toEqual(command);
    });

    it('does not show when visible is false', () => {
      const item = createStatusBarItem('test.item', {
        text: 'Test',
        visible: false,
      });

      expect(item.native.show).not.toHaveBeenCalled();
    });

    it('applies warning background color', () => {
      const item = createStatusBarItem('test.item', {
        text: 'Test',
        backgroundColor: 'warning',
      });

      expect(item.native.backgroundColor).toBeDefined();
    });

    it('applies error background color', () => {
      const item = createStatusBarItem('test.item', {
        text: 'Test',
        backgroundColor: 'error',
      });

      expect(item.native.backgroundColor).toBeDefined();
    });

    it('applies accessibility information', () => {
      const accessibilityInformation = { label: 'Status', role: 'status' };
      const item = createStatusBarItem('test.item', {
        text: 'Test',
        accessibilityInformation,
      });

      expect(item.native.accessibilityInformation).toEqual(accessibilityInformation);
    });

    describe('update', () => {
      it('updates text', () => {
        const item = createStatusBarItem('test.item', { text: 'Initial' });

        item.update('Updated');

        expect(item.native.text).toBe('Updated');
      });

      it('updates text and tooltip', () => {
        const item = createStatusBarItem('test.item', { text: 'Initial' });

        item.update('Updated', 'New tooltip');

        expect(item.native.text).toBe('Updated');
        expect(item.native.tooltip).toBe('New tooltip');
      });
    });

    describe('set', () => {
      it('sets multiple properties', () => {
        const item = createStatusBarItem('test.item', { text: 'Initial' });

        item.set({
          text: 'New text',
          tooltip: 'New tooltip',
          command: 'new.command',
        });

        expect(item.native.text).toBe('New text');
        expect(item.native.tooltip).toBe('New tooltip');
        expect(item.native.command).toBe('new.command');
      });

      it('sets only provided properties', () => {
        const item = createStatusBarItem('test.item', {
          text: 'Initial',
          tooltip: 'Initial tooltip',
        });

        item.set({ text: 'New text' });

        expect(item.native.text).toBe('New text');
        expect(item.native.tooltip).toBe('Initial tooltip');
      });
    });

    describe('show/hide', () => {
      it('shows the item', () => {
        const item = createStatusBarItem('test.item', { text: 'Test', visible: false });

        item.show();

        expect(item.native.show).toHaveBeenCalled();
      });

      it('hides the item', () => {
        const item = createStatusBarItem('test.item', { text: 'Test' });

        item.hide();

        expect(item.native.hide).toHaveBeenCalled();
      });
    });

    describe('spinner', () => {
      it('shows spinner with custom text', () => {
        const item = createStatusBarItem('test.item', { text: '$(check) Ready' });

        item.showSpinner('Loading...');

        expect(item.native.text).toBe('$(sync~spin) Loading...');
      });

      it('shows spinner preserving text without icon', () => {
        const item = createStatusBarItem('test.item', { text: '$(check) Ready' });

        item.showSpinner();

        expect(item.native.text).toBe('$(sync~spin) Ready');
      });

      it('hides spinner and restores original text', () => {
        const item = createStatusBarItem('test.item', { text: '$(check) Ready' });

        item.showSpinner('Loading...');
        item.hideSpinner();

        expect(item.native.text).toBe('$(check) Ready');
      });

      it('does nothing when hideSpinner called without showSpinner', () => {
        const item = createStatusBarItem('test.item', { text: 'Test' });

        item.hideSpinner();

        expect(item.native.text).toBe('Test');
      });

      it('updates original text after update call', () => {
        const item = createStatusBarItem('test.item', { text: 'Initial' });

        item.update('Updated');
        item.showSpinner();
        item.hideSpinner();

        expect(item.native.text).toBe('Updated');
      });
    });

    describe('dispose', () => {
      it('disposes the native item', () => {
        const item = createStatusBarItem('test.item', { text: 'Test' });

        item.dispose();

        expect(item.native.dispose).toHaveBeenCalled();
      });
    });
  });

  // ============================================
  // showStatusMessage
  // ============================================

  describe('showStatusMessage', () => {
    it('shows a status bar message', () => {
      const disposable = showStatusMessage('Test message');

      expect(disposable).toBeDefined();
      expect(typeof disposable.dispose).toBe('function');
    });

    it('can be manually disposed', () => {
      const disposable = showStatusMessage('Test message', 10000);

      // Should not throw
      expect(() => disposable.dispose()).not.toThrow();
    });

    it('returns a disposable', () => {
      const disposable = showStatusMessage('Test', 3000);

      expect(disposable).toBeDefined();
      expect(typeof disposable.dispose).toBe('function');
    });
  });
});
