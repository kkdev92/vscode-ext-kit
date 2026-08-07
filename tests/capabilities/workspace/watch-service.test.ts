/**
 * Unit/lifecycle suite for runtime-created watcher service instances. It
 * protects delegation, caller controls, tracking removal, service shutdown,
 * late creation after disposal, and the stable injection token. Declarative
 * operation wiring and batch mechanics are covered in `filewatcher.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  FileWatchers,
  createFileWatcherService,
} from '../../../src/capabilities/workspace/watch-service.js';
import { createFakeFileWatchers } from '../../../src/testing/fakes/fake-filewatcher.js';

describe('FileWatcherService', () => {
  it('hands back a working watcher', async () => {
    vi.useFakeTimers();
    try {
      const capability = createFakeFileWatchers();
      const service = createFileWatcherService(capability);
      const seen: string[] = [];

      service.watch({ patterns: '**/*.log', debounceDelay: 10 }).onDidChange((events) => {
        seen.push(...events.map((event) => event.uri.fsPath));
      });
      capability._emit('change', '/logs/app.log');
      await vi.advanceTimersByTimeAsync(10);

      expect(seen).toEqual(['/logs/app.log']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops every watcher it handed out when the application stops', () => {
    const capability = createFakeFileWatchers();
    const service = createFileWatcherService(capability);

    service.watch({ patterns: '**/*.log' });
    service.watch({ patterns: '**/*.txt' });
    expect(capability._watchedPatterns()).toHaveLength(2);

    service.dispose();

    // A watcher the application forgot about must not outlive the application.
    expect(capability._watchedPatterns()).toHaveLength(0);
  });

  it('forgets a watcher the caller disposed', () => {
    const capability = createFakeFileWatchers();
    const service = createFileWatcherService(capability);

    const watcher = service.watch({ patterns: '**/*.log' });
    watcher.dispose();
    expect(capability._watchedPatterns()).toHaveLength(0);

    // Nothing left to iterate: a session that watches a different file every
    // few minutes would otherwise accumulate dead entries for its whole life.
    expect(() => {
      service.dispose();
    }).not.toThrow();
  });

  it('exposes the underlying watcher controls through the wrapper', () => {
    const capability = createFakeFileWatchers();
    const service = createFileWatcherService(capability);

    const watcher = service.watch({ patterns: '**/*.log' });
    expect(watcher.isWatching).toBe(true);

    watcher.pause();
    expect(watcher.isWatching).toBe(false);
    watcher.resume();
    expect(watcher.isWatching).toBe(true);
  });

  it('does not leave a watcher running when the service is already disposed', () => {
    const capability = createFakeFileWatchers();
    const service = createFileWatcherService(capability);
    service.dispose();

    service.watch({ patterns: '**/*.log' });

    // Nothing would ever dispose it: the service is past its own teardown.
    expect(capability._watchedPatterns()).toHaveLength(0);
  });

  it('is injected under a stable token id', () => {
    expect(FileWatchers.id).toBe('framework.fileWatchers');
  });
});
