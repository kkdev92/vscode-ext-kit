/**
 * Fake-timer unit suite for the short-lived status-message service. It protects
 * lazy creation, latest-message precedence, early dismissal, timer cleanup,
 * service ownership, and post-disposal inertness. Declared long-lived items are
 * covered separately in `statusbar.test.ts`.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createStatusBarService } from '../../../src/capabilities/ui/status-bar-service.js';
import { createFakeStatusBar } from '../../../src/testing/fakes/fake-ui.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('StatusBarService', () => {
  it('creates no item until something is flashed', () => {
    const statusBar = createFakeStatusBar();

    createStatusBarService(statusBar);

    // An extension that never flashes anything should not put an item in the
    // status bar at all.
    expect(statusBar.items).toHaveLength(0);
  });

  it('shows the message, then takes it away', () => {
    vi.useFakeTimers();
    const statusBar = createFakeStatusBar();

    createStatusBarService(statusBar).flash('$(check) Saved', 3000);
    expect(statusBar.items[0]).toMatchObject({ text: '$(check) Saved', visible: true });

    vi.advanceTimersByTime(3000);
    expect(statusBar.items[0]?.visible).toBe(false);
  });

  it('ends early when dismissed, and cancels its timer', () => {
    vi.useFakeTimers();
    const statusBar = createFakeStatusBar();

    const flash = createStatusBarService(statusBar).flash('Working…');
    flash.dispose();

    expect(statusBar.items[0]?.visible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    // Disposing again is safe.
    flash.dispose();
  });

  it('reuses one item rather than one per message', () => {
    vi.useFakeTimers();
    const statusBar = createFakeStatusBar();
    const service = createStatusBarService(statusBar);

    service.flash('one', 10_000);
    service.flash('two', 10_000);

    // The service owns one transient presentation slot; concurrent items would
    // compete for the same corner instead of expressing latest-message wins.
    expect(statusBar.items).toHaveLength(1);
    expect(statusBar.items[0]?.text).toBe('two');
  });

  it('does not let a superseded handle blank the current message', () => {
    vi.useFakeTimers();
    const statusBar = createFakeStatusBar();
    const service = createStatusBarService(statusBar);

    const first = service.flash('one', 10_000);
    service.flash('two', 10_000);
    first.dispose();

    expect(statusBar.items[0]?.text).toBe('two');
    expect(statusBar.items[0]?.visible).toBe(true);
  });

  it('lets the later message run its own full duration', () => {
    vi.useFakeTimers();
    const statusBar = createFakeStatusBar();
    const service = createStatusBarService(statusBar);

    service.flash('one', 1000);
    vi.advanceTimersByTime(900);
    service.flash('two', 1000);

    vi.advanceTimersByTime(200);
    // The first message's timer must not carry off the second.
    expect(statusBar.items[0]).toMatchObject({ text: 'two', visible: true });

    vi.advanceTimersByTime(800);
    expect(statusBar.items[0]?.visible).toBe(false);
  });

  it('disposes the item and cancels a pending message', () => {
    vi.useFakeTimers();
    const statusBar = createFakeStatusBar();
    const service = createStatusBarService(statusBar);

    service.flash('Saved', 10_000);
    service.dispose();

    // An armed timer would patch a disposed handle.
    expect(vi.getTimerCount()).toBe(0);
    expect(statusBar.items[0]?.disposed).toBe(true);
  });

  it('is inert once disposed', () => {
    const statusBar = createFakeStatusBar();
    const service = createStatusBarService(statusBar);
    service.dispose();

    expect(() => service.flash('Saved').dispose()).not.toThrow();
    expect(statusBar.items).toHaveLength(0);
  });
});
