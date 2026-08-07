/**
 * Fake-timer unit suite for long-lived managed status items and standalone
 * status messages. It protects spinner/busy/flash precedence, undoing temporary
 * presentation, per-message ownership, timers, and inert teardown. Failures in
 * declaration/DI lifecycle belong in `ui-integration.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createManagedStatusBarItem,
  createStatusMessage,
} from '../../../src/capabilities/ui/statusbar.js';
import { createFakeStatusBar } from '../../../src/testing/fakes/fake-ui.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('createManagedStatusBarItem', () => {
  const make = (options: Parameters<typeof createManagedStatusBarItem>[1]) => {
    const statusBar = createFakeStatusBar();
    const managed = createManagedStatusBarItem(statusBar.createItem('test.item', 'left', 10), {
      ...options,
    });
    const item = statusBar.items[0];
    if (item === undefined) {
      throw new Error('no item created');
    }
    return { managed, item };
  };

  it('applies the initial options and shows by default', () => {
    const { item } = make({
      text: '$(cloud) Idle',
      tooltip: 'Sync state',
      command: 'sample.sync',
      backgroundColor: 'warning',
      accessibilityInformation: { label: 'Sync idle' },
    });

    expect(item).toMatchObject({
      text: '$(cloud) Idle',
      tooltip: 'Sync state',
      command: 'sample.sync',
      backgroundColor: 'warning',
      visible: true,
    });
  });

  it('respects visible: false', () => {
    const { item } = make({ text: 'x', visible: false });
    expect(item.visible).toBe(false);
  });

  it('update replaces the text and optionally the tooltip; show/hide toggle visibility', () => {
    const { managed, item } = make({ text: 'a' });

    managed.update('b');
    expect(item.text).toBe('b');
    managed.update('c', 'new tooltip');
    expect(item.tooltip).toBe('new tooltip');

    managed.hide();
    expect(item.visible).toBe(false);
    managed.show();
    expect(item.visible).toBe(true);
  });

  it('set applies several fields at once', () => {
    const { managed, item } = make({ text: 'a' });
    managed.set({ text: 'b', command: 'cmd', backgroundColor: 'error' });
    expect(item).toMatchObject({ text: 'b', command: 'cmd', backgroundColor: 'error' });
  });

  it('shows a spinner that strips a leading codicon, and restores on hide', () => {
    const { managed, item } = make({ text: '$(check) Ready' });

    managed.showSpinner();
    expect(item.text).toBe('$(sync~spin) Ready');
    managed.hideSpinner();
    expect(item.text).toBe('$(check) Ready');
  });

  it('spinner override text wins until the next update reclaims priority', () => {
    const { managed, item } = make({ text: 'Ready' });

    managed.showSpinner('Working…');
    expect(item.text).toBe('$(sync~spin) Working…');
    managed.update('Done');
    // update() clears the override; the spinner flag is still on.
    expect(item.text).toBe('$(sync~spin) Done');
    managed.hideSpinner();
    expect(item.text).toBe('Done');
  });

  it('keeps spinning while text updates arrive during busy', () => {
    const { managed, item } = make({ text: 'Ready' });

    managed.setBusy(true);
    expect(item.text).toBe('$(sync~spin) Ready');
    managed.update('Processing 42%');
    expect(item.text).toBe('$(sync~spin) Processing 42%');
    managed.setBusy(false);
    expect(item.text).toBe('Processing 42%');
  });

  it('reference-counts nested busy requests', () => {
    const { managed, item } = make({ text: 'Ready' });

    managed.setBusy(true);
    managed.setBusy(true);
    managed.setBusy(false);
    // One busy owner remains: still spinning.
    expect(item.text).toBe('$(sync~spin) Ready');
    managed.setBusy(false);
    expect(item.text).toBe('Ready');
    // An unbalanced extra release never goes negative.
    managed.setBusy(false);
    managed.setBusy(true);
    expect(item.text).toBe('$(sync~spin) Ready');
  });

  it('is inert after dispose, and dispose is idempotent', () => {
    const { managed, item } = make({ text: 'a' });

    managed.dispose();
    expect(item.disposed).toBe(true);

    managed.update('late');
    managed.set({ text: 'later' });
    managed.show();
    managed.showSpinner();
    managed.setBusy(true);
    managed.dispose();

    expect(item.text).toBe('a');
    expect(item.visible).toBe(false);
  });
});

describe('createStatusMessage', () => {
  it('disposes itself after the timeout', () => {
    vi.useFakeTimers();
    const statusBar = createFakeStatusBar();

    createStatusMessage(statusBar, 'Saved!', 3000);
    expect(statusBar.items[0]).toMatchObject({ text: 'Saved!', visible: true });

    vi.advanceTimersByTime(3000);
    expect(statusBar.items[0]?.disposed).toBe(true);
  });

  it('can be dismissed early, cancelling the timer', () => {
    vi.useFakeTimers();
    const statusBar = createFakeStatusBar();

    const message = createStatusMessage(statusBar, 'Processing…');
    message.dispose();
    expect(statusBar.items[0]?.disposed).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    // Disposing again is safe.
    message.dispose();
  });

  it('gives each message its own platform item, so overlapping messages never tear each other down', () => {
    vi.useFakeTimers();
    const statusBar = createFakeStatusBar();

    const first = createStatusMessage(statusBar, 'one', 10_000);
    createStatusMessage(statusBar, 'two', 10_000);
    expect(statusBar.items).toHaveLength(2);
    expect(statusBar.items[0]?.id).not.toBe(statusBar.items[1]?.id);

    first.dispose();
    expect(statusBar.items[0]?.disposed).toBe(true);
    expect(statusBar.items[1]?.disposed).toBe(false);
  });
});

describe('flash', () => {
  const make = (): {
    managed: ReturnType<typeof createManagedStatusBarItem>;
    item: NonNullable<ReturnType<typeof createFakeStatusBar>['items'][number]>;
  } => {
    const statusBar = createFakeStatusBar();
    const managed = createManagedStatusBarItem(statusBar.createItem('test.item', 'left', 10), {
      text: '$(cloud) Idle',
    });
    const item = statusBar.items[0];
    if (item === undefined) {
      throw new Error('no item created');
    }
    return { managed, item };
  };

  it('shows the message, then restores the previous text', () => {
    vi.useFakeTimers();
    const { managed, item } = make();

    managed.flash('$(check) Saved', 3000);
    expect(item.text).toBe('$(check) Saved');

    vi.advanceTimersByTime(3000);
    expect(item.text).toBe('$(cloud) Idle');
  });

  it('ends early when dismissed, and cancels its timer', () => {
    vi.useFakeTimers();
    const { managed, item } = make();

    const flash = managed.flash('Processing…');
    flash.dispose();

    expect(item.text).toBe('$(cloud) Idle');
    expect(vi.getTimerCount()).toBe(0);
    // Disposing again is safe.
    flash.dispose();
  });

  it('lets a later flash win rather than queueing behind the first', () => {
    vi.useFakeTimers();
    const { managed, item } = make();

    managed.flash('one', 10_000);
    managed.flash('two', 10_000);
    expect(item.text).toBe('two');

    // The superseded handle must not cut the current message short: it is no
    // longer the thing on screen.
    vi.advanceTimersByTime(10_000);
    expect(item.text).toBe('$(cloud) Idle');
  });

  it('does not let a superseded handle blank the current message', () => {
    vi.useFakeTimers();
    const { managed, item } = make();

    const first = managed.flash('one', 10_000);
    managed.flash('two', 10_000);
    first.dispose();

    expect(item.text).toBe('two');
  });

  /**
   * Which flash it is, not what it says. "Saved" twice in a row is the normal
   * case for a status message, so identifying one by its text makes the common
   * case the broken one.
   */
  describe('two flashes with the same text', () => {
    it('are not confused when the earlier handle is disposed', () => {
      vi.useFakeTimers();
      const { managed, item } = make();

      const first = managed.flash('Saved', 10_000);
      managed.flash('Saved', 10_000);
      first.dispose();

      expect(item.text).toBe('Saved');
    });

    it('are not confused when the earlier one runs out', () => {
      vi.useFakeTimers();
      const { managed, item } = make();

      managed.flash('Saved', 10_000);
      vi.advanceTimersByTime(9000);
      managed.flash('Saved', 10_000);

      // The first one's deadline passes; the second still has 9s to run.
      vi.advanceTimersByTime(1500);
      expect(item.text).toBe('Saved');

      vi.advanceTimersByTime(10_000);
      expect(item.text).toBe('$(cloud) Idle');
    });
  });

  it('restores the text an update set while it was showing', () => {
    vi.useFakeTimers();
    const { managed, item } = make();

    managed.flash('$(check) Saved', 3000);
    managed.update('$(cloud) 3 pending');
    expect(item.text).toBe('$(check) Saved');

    vi.advanceTimersByTime(3000);
    // The base text moved on underneath; going back means going back to *now*.
    expect(item.text).toBe('$(cloud) 3 pending');
  });

  it('outranks a spinner, and hands back to it', () => {
    vi.useFakeTimers();
    const { managed, item } = make();

    managed.showSpinner('Syncing');
    expect(item.text).toBe('$(sync~spin) Syncing');

    managed.flash('$(check) Saved', 3000);
    expect(item.text).toBe('$(check) Saved');

    vi.advanceTimersByTime(3000);
    expect(item.text).toBe('$(sync~spin) Syncing');
  });

  it('cancels a pending flash when the item is disposed', () => {
    vi.useFakeTimers();
    const { managed } = make();

    managed.flash('Saved', 10_000);
    managed.dispose();

    // An armed timer holds the item; firing it would render against a disposed
    // handle.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('is inert on a disposed item', () => {
    const { managed, item } = make();
    managed.dispose();

    expect(() => managed.flash('Saved').dispose()).not.toThrow();
    expect(item.disposed).toBe(true);
  });
});
