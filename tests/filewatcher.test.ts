import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { createMockFileSystemWatcher as createMockFileSystemWatcherWith } from '../src/testing/index.js';
import { createFileWatcher, watchFile } from '../src/workspace/filewatcher.js';

// Thin local re-bind so the rest of this file doesn't need a `vi` argument
// at every call site.
const createMockFileSystemWatcher = () => createMockFileSystemWatcherWith(vi);

// Get mocked workspace
const mockedWorkspace = vscode.workspace as unknown as {
  createFileSystemWatcher: ReturnType<typeof vi.fn>;
};

describe('filewatcher', () => {
  let mockWatcher: ReturnType<typeof createMockFileSystemWatcher>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockWatcher = createMockFileSystemWatcher();
    mockedWorkspace.createFileSystemWatcher.mockReturnValue(mockWatcher);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================
  // createFileWatcher
  // ============================================

  describe('createFileWatcher', () => {
    it('creates a watcher for a single pattern', () => {
      const watcher = createFileWatcher({
        patterns: '**/*.ts',
      });

      expect(watcher).toBeDefined();
      expect(watcher.isWatching).toBe(true);

      watcher.dispose();
    });

    it('creates watchers for multiple patterns', () => {
      const watcher = createFileWatcher({
        patterns: ['**/*.ts', '**/*.tsx'],
      });

      expect(watcher).toBeDefined();
      expect(mockedWorkspace.createFileSystemWatcher).toHaveBeenCalledTimes(2);

      watcher.dispose();
    });

    it('batches events with debouncing', () => {
      const watcher = createFileWatcher({
        patterns: '**/*.ts',
        debounceDelay: 100,
      });

      const listener = vi.fn();
      watcher.onDidChange(listener);

      // Fire multiple events
      mockWatcher._fireChange({
        fsPath: '/test/file1.ts',
        path: '/test/file1.ts',
        toString: () => '/test/file1.ts',
      });
      mockWatcher._fireChange({
        fsPath: '/test/file2.ts',
        path: '/test/file2.ts',
        toString: () => '/test/file2.ts',
      });

      expect(listener).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]![0]).toHaveLength(2);

      watcher.dispose();
    });

    it('reports correct event types', () => {
      const watcher = createFileWatcher({
        patterns: '**/*.ts',
        debounceDelay: 50,
      });

      const listener = vi.fn();
      watcher.onDidChange(listener);

      mockWatcher._fireCreate({
        fsPath: '/test/new.ts',
        path: '/test/new.ts',
        toString: () => '/test/new.ts',
      });
      mockWatcher._fireChange({
        fsPath: '/test/changed.ts',
        path: '/test/changed.ts',
        toString: () => '/test/changed.ts',
      });
      mockWatcher._fireDelete({
        fsPath: '/test/deleted.ts',
        path: '/test/deleted.ts',
        toString: () => '/test/deleted.ts',
      });

      vi.advanceTimersByTime(50);

      expect(listener).toHaveBeenCalledTimes(1);
      const events = listener.mock.calls[0]![0];
      expect(events).toHaveLength(3);
      expect(events[0].type).toBe('create');
      expect(events[1].type).toBe('change');
      expect(events[2].type).toBe('delete');

      watcher.dispose();
    });

    it('filters events by type', () => {
      const watcher = createFileWatcher({
        patterns: '**/*.ts',
        events: ['change'],
        debounceDelay: 50,
      });

      const listener = vi.fn();
      watcher.onDidChange(listener);

      mockWatcher._fireCreate({
        fsPath: '/test/new.ts',
        path: '/test/new.ts',
        toString: () => '/test/new.ts',
      });
      mockWatcher._fireChange({
        fsPath: '/test/changed.ts',
        path: '/test/changed.ts',
        toString: () => '/test/changed.ts',
      });
      mockWatcher._fireDelete({
        fsPath: '/test/deleted.ts',
        path: '/test/deleted.ts',
        toString: () => '/test/deleted.ts',
      });

      vi.advanceTimersByTime(50);

      expect(listener).toHaveBeenCalledTimes(1);
      const events = listener.mock.calls[0]![0];
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('change');

      watcher.dispose();
    });

    it('ignores patterns', () => {
      const watcher = createFileWatcher({
        patterns: '**/*.ts',
        ignorePatterns: ['**/node_modules/**'],
        debounceDelay: 50,
      });

      const listener = vi.fn();
      watcher.onDidChange(listener);

      mockWatcher._fireChange({
        fsPath: '/test/node_modules/pkg/index.ts',
        path: '/test/node_modules/pkg/index.ts',
        toString: () => '/test/node_modules/pkg/index.ts',
      });
      mockWatcher._fireChange({
        fsPath: '/test/src/app.ts',
        path: '/test/src/app.ts',
        toString: () => '/test/src/app.ts',
      });

      vi.advanceTimersByTime(50);

      expect(listener).toHaveBeenCalledTimes(1);
      const events = listener.mock.calls[0]![0];
      expect(events).toHaveLength(1);
      expect(events[0].uri.fsPath).toBe('/test/src/app.ts');

      watcher.dispose();
    });

    it('matches dots in ignore patterns literally', () => {
      const watcher = createFileWatcher({
        patterns: '**/*',
        ignorePatterns: ['*.log'],
        debounceDelay: 50,
      });

      const listener = vi.fn();
      watcher.onDidChange(listener);

      // The dot must not act as a regex wildcard: "axlog" must NOT be ignored
      mockWatcher._fireChange({
        fsPath: '/test/axlog',
        path: '/test/axlog',
        toString: () => '/test/axlog',
      });
      mockWatcher._fireChange({
        fsPath: '/test/app.log',
        path: '/test/app.log',
        toString: () => '/test/app.log',
      });

      vi.advanceTimersByTime(50);

      expect(listener).toHaveBeenCalledTimes(1);
      const events = listener.mock.calls[0]![0];
      expect(events).toHaveLength(1);
      expect(events[0].uri.fsPath).toBe('/test/axlog');

      watcher.dispose();
    });

    it('deduplicates same file events', () => {
      const watcher = createFileWatcher({
        patterns: '**/*.ts',
        debounceDelay: 100,
      });

      const listener = vi.fn();
      watcher.onDidChange(listener);

      const uri = {
        fsPath: '/test/file.ts',
        path: '/test/file.ts',
        toString: () => '/test/file.ts',
      };
      mockWatcher._fireChange(uri);
      mockWatcher._fireChange(uri);
      mockWatcher._fireChange(uri);

      vi.advanceTimersByTime(100);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]![0]).toHaveLength(1);

      watcher.dispose();
    });

    it('collapses mixed event types for the same file to the latest type within one window', () => {
      // The pending map is keyed by uri.toString() only, so a create
      // immediately followed by a change for the same file within one
      // debounce window reports just the latest type — the net effect by
      // the time the batch flushes, not every intermediate transition.
      const watcher = createFileWatcher({
        patterns: '**/*.ts',
        debounceDelay: 50,
      });

      const listener = vi.fn();
      watcher.onDidChange(listener);

      const uri = {
        fsPath: '/test/file.ts',
        path: '/test/file.ts',
        toString: () => '/test/file.ts',
      };
      mockWatcher._fireCreate(uri);
      mockWatcher._fireChange(uri);

      vi.advanceTimersByTime(50);

      expect(listener).toHaveBeenCalledTimes(1);
      const events = listener.mock.calls[0]![0];
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('change');

      watcher.dispose();
    });

    it('handles a large burst of distinct files within one debounce window', () => {
      const watcher = createFileWatcher({
        patterns: '**/*.ts',
        debounceDelay: 50,
      });

      const listener = vi.fn();
      watcher.onDidChange(listener);

      const total = 2000;
      for (let i = 0; i < total; i++) {
        mockWatcher._fireChange({
          fsPath: `/test/file${i}.ts`,
          path: `/test/file${i}.ts`,
          toString: () => `/test/file${i}.ts`,
        });
      }
      // Re-fire a subset to exercise dedup at scale in the same window.
      for (let i = 0; i < 500; i++) {
        mockWatcher._fireChange({
          fsPath: `/test/file${i}.ts`,
          path: `/test/file${i}.ts`,
          toString: () => `/test/file${i}.ts`,
        });
      }

      vi.advanceTimersByTime(50);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0]![0]).toHaveLength(total);

      watcher.dispose();
    });

    describe('native ignore*Events pass-through', () => {
      it('watches everything by default (all ignore flags false)', () => {
        createFileWatcher({ patterns: '**/*.ts' }).dispose();

        expect(mockedWorkspace.createFileSystemWatcher).toHaveBeenCalledWith(
          '**/*.ts',
          false,
          false,
          false
        );
      });

      it('derives ignore*Events from the events option', () => {
        createFileWatcher({ patterns: '**/*.ts', events: ['change'] }).dispose();

        expect(mockedWorkspace.createFileSystemWatcher).toHaveBeenCalledWith(
          '**/*.ts',
          true, // ignoreCreateEvents
          false, // ignoreChangeEvents
          true // ignoreDeleteEvents
        );
      });

      it('passes all-true ignore flags when events is empty', () => {
        createFileWatcher({ patterns: '**/*.ts', events: [] }).dispose();

        expect(mockedWorkspace.createFileSystemWatcher).toHaveBeenCalledWith(
          '**/*.ts',
          true,
          true,
          true
        );
      });

      it('does not attach a listener for an ignored event kind', () => {
        const watcher = createFileWatcher({
          patterns: '**/*.ts',
          events: ['change'],
          debounceDelay: 50,
        });

        // The native mock doesn't enforce ignore*Events itself, so firing a
        // "create" here only proves createFileWatcher never subscribed.
        mockWatcher._fireCreate({
          fsPath: '/test/new.ts',
          path: '/test/new.ts',
          toString: () => '/test/new.ts',
        });
        vi.advanceTimersByTime(50);

        const listener = vi.fn();
        watcher.onDidChange(listener);
        vi.advanceTimersByTime(50);

        expect(listener).not.toHaveBeenCalled();

        watcher.dispose();
      });
    });

    describe('maxBatchSize', () => {
      it('flushes immediately once the pending count reaches maxBatchSize', () => {
        const watcher = createFileWatcher({
          patterns: '**/*.ts',
          debounceDelay: 1000,
          maxBatchSize: 3,
        });

        const listener = vi.fn();
        watcher.onDidChange(listener);

        mockWatcher._fireChange({
          fsPath: '/test/a.ts',
          path: '/test/a.ts',
          toString: () => '/test/a.ts',
        });
        mockWatcher._fireChange({
          fsPath: '/test/b.ts',
          path: '/test/b.ts',
          toString: () => '/test/b.ts',
        });
        expect(listener).not.toHaveBeenCalled();

        mockWatcher._fireChange({
          fsPath: '/test/c.ts',
          path: '/test/c.ts',
          toString: () => '/test/c.ts',
        });

        // Flushed synchronously on the 3rd distinct file, without waiting
        // for the much longer debounce delay.
        expect(listener).toHaveBeenCalledTimes(1);
        expect(listener.mock.calls[0]![0]).toHaveLength(3);

        watcher.dispose();
      });

      it('does not flush early when maxBatchSize is unset', () => {
        const watcher = createFileWatcher({ patterns: '**/*.ts', debounceDelay: 1000 });

        const listener = vi.fn();
        watcher.onDidChange(listener);

        for (let i = 0; i < 10; i++) {
          mockWatcher._fireChange({
            fsPath: `/test/f${i}.ts`,
            path: `/test/f${i}.ts`,
            toString: () => `/test/f${i}.ts`,
          });
        }

        expect(listener).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1000);
        expect(listener).toHaveBeenCalledTimes(1);

        watcher.dispose();
      });

      it('starts a fresh debounce window for events after an immediate flush', () => {
        const watcher = createFileWatcher({
          patterns: '**/*.ts',
          debounceDelay: 50,
          maxBatchSize: 2,
        });

        const listener = vi.fn();
        watcher.onDidChange(listener);

        mockWatcher._fireChange({
          fsPath: '/test/a.ts',
          path: '/test/a.ts',
          toString: () => '/test/a.ts',
        });
        mockWatcher._fireChange({
          fsPath: '/test/b.ts',
          path: '/test/b.ts',
          toString: () => '/test/b.ts',
        });
        expect(listener).toHaveBeenCalledTimes(1);

        mockWatcher._fireChange({
          fsPath: '/test/c.ts',
          path: '/test/c.ts',
          toString: () => '/test/c.ts',
        });
        vi.advanceTimersByTime(50);

        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener.mock.calls[1]![0]).toHaveLength(1);

        watcher.dispose();
      });
    });

    describe('mixed RelativePattern support', () => {
      it('uses a pre-built RelativePattern entry as-is, ignoring workspaceFolder', () => {
        const relativePattern = new vscode.RelativePattern(
          { fsPath: '/repo/folderA' } as never,
          '**/*.ts'
        );
        const workspaceFolder = { uri: { fsPath: '/repo/folderB' } } as never;

        createFileWatcher({
          patterns: [relativePattern, '**/*.md'],
          workspaceFolder,
        }).dispose();

        const calls = mockedWorkspace.createFileSystemWatcher.mock.calls;
        // The RelativePattern is passed through unchanged...
        expect(calls[0]![0]).toBe(relativePattern);
        // ...while the plain string pattern is wrapped using workspaceFolder.
        expect(calls[1]![0]).toBeInstanceOf(vscode.RelativePattern);
        expect((calls[1]![0] as vscode.RelativePattern).base).toBe(workspaceFolder);
      });

      it('creates one watcher per pattern when mixing string and RelativePattern entries', () => {
        const relativePattern = new vscode.RelativePattern(
          { fsPath: '/repo/folderA' } as never,
          '**/*.ts'
        );

        const watcher = createFileWatcher({ patterns: [relativePattern, '**/*.md'] });

        expect(mockedWorkspace.createFileSystemWatcher).toHaveBeenCalledTimes(2);
        watcher.dispose();
      });
    });

    describe('listener exception isolation', () => {
      it('still notifies later listeners when an earlier one throws', () => {
        const watcher = createFileWatcher({
          patterns: '**/*.ts',
          debounceDelay: 50,
        });

        const throwingListener = vi.fn(() => {
          throw new Error('boom');
        });
        const healthyListener = vi.fn();
        watcher.onDidChange(throwingListener);
        watcher.onDidChange(healthyListener);

        mockWatcher._fireChange({
          fsPath: '/test/file.ts',
          path: '/test/file.ts',
          toString: () => '/test/file.ts',
        });
        vi.advanceTimersByTime(50);

        expect(throwingListener).toHaveBeenCalledTimes(1);
        expect(healthyListener).toHaveBeenCalledTimes(1);

        watcher.dispose();
      });
    });

    describe('pause/resume', () => {
      it('pauses event delivery', () => {
        const watcher = createFileWatcher({
          patterns: '**/*.ts',
          debounceDelay: 50,
        });

        const listener = vi.fn();
        watcher.onDidChange(listener);

        watcher.pause();

        mockWatcher._fireChange({
          fsPath: '/test/file.ts',
          path: '/test/file.ts',
          toString: () => '/test/file.ts',
        });
        vi.advanceTimersByTime(50);

        expect(listener).not.toHaveBeenCalled();

        watcher.dispose();
      });

      it('resumes event delivery', () => {
        const watcher = createFileWatcher({
          patterns: '**/*.ts',
          debounceDelay: 50,
        });

        const listener = vi.fn();
        watcher.onDidChange(listener);

        watcher.pause();
        watcher.resume();

        mockWatcher._fireChange({
          fsPath: '/test/file.ts',
          path: '/test/file.ts',
          toString: () => '/test/file.ts',
        });
        vi.advanceTimersByTime(50);

        expect(listener).toHaveBeenCalledTimes(1);

        watcher.dispose();
      });

      it('clears pending events on pause', () => {
        const watcher = createFileWatcher({
          patterns: '**/*.ts',
          debounceDelay: 100,
        });

        const listener = vi.fn();
        watcher.onDidChange(listener);

        mockWatcher._fireChange({
          fsPath: '/test/file.ts',
          path: '/test/file.ts',
          toString: () => '/test/file.ts',
        });
        watcher.pause();
        vi.advanceTimersByTime(100);

        expect(listener).not.toHaveBeenCalled();

        watcher.dispose();
      });

      it('reports isWatching correctly', () => {
        const watcher = createFileWatcher({
          patterns: '**/*.ts',
        });

        expect(watcher.isWatching).toBe(true);

        watcher.pause();
        expect(watcher.isWatching).toBe(false);

        watcher.resume();
        expect(watcher.isWatching).toBe(true);

        watcher.dispose();
        expect(watcher.isWatching).toBe(false);
      });
    });

    describe('listener management', () => {
      it('supports multiple listeners', () => {
        const watcher = createFileWatcher({
          patterns: '**/*.ts',
          debounceDelay: 50,
        });

        const listener1 = vi.fn();
        const listener2 = vi.fn();
        watcher.onDidChange(listener1);
        watcher.onDidChange(listener2);

        mockWatcher._fireChange({
          fsPath: '/test/file.ts',
          path: '/test/file.ts',
          toString: () => '/test/file.ts',
        });
        vi.advanceTimersByTime(50);

        expect(listener1).toHaveBeenCalledTimes(1);
        expect(listener2).toHaveBeenCalledTimes(1);

        watcher.dispose();
      });

      it('can unregister listeners', () => {
        const watcher = createFileWatcher({
          patterns: '**/*.ts',
          debounceDelay: 50,
        });

        const listener = vi.fn();
        const disposable = watcher.onDidChange(listener);
        disposable.dispose();

        mockWatcher._fireChange({
          fsPath: '/test/file.ts',
          path: '/test/file.ts',
          toString: () => '/test/file.ts',
        });
        vi.advanceTimersByTime(50);

        expect(listener).not.toHaveBeenCalled();

        watcher.dispose();
      });
    });

    describe('dispose', () => {
      it('disposes watcher', () => {
        const watcher = createFileWatcher({
          patterns: '**/*.ts',
        });

        watcher.dispose();

        expect(watcher.isWatching).toBe(false);
      });

      it('ignores events after dispose', () => {
        const watcher = createFileWatcher({
          patterns: '**/*.ts',
          debounceDelay: 50,
        });

        const listener = vi.fn();
        watcher.onDidChange(listener);

        watcher.dispose();

        mockWatcher._fireChange({
          fsPath: '/test/file.ts',
          path: '/test/file.ts',
          toString: () => '/test/file.ts',
        });
        vi.advanceTimersByTime(50);

        expect(listener).not.toHaveBeenCalled();
      });
    });
  });

  // ============================================
  // watchFile
  // ============================================

  describe('watchFile', () => {
    it('watches a single file', () => {
      const uri = vscode.Uri.file('/test/config.json');
      const onChange = vi.fn();

      const disposable = watchFile(uri, onChange);

      expect(mockedWorkspace.createFileSystemWatcher).toHaveBeenCalled();

      disposable.dispose();
    });

    it('calls onChange on file change', () => {
      const uri = vscode.Uri.file('/test/config.json');
      const onChange = vi.fn();

      const disposable = watchFile(uri, onChange, 50);

      mockWatcher._fireChange(uri);
      vi.advanceTimersByTime(50);

      expect(onChange).toHaveBeenCalledTimes(1);

      disposable.dispose();
    });

    it('calls onChange on file create', () => {
      const uri = vscode.Uri.file('/test/config.json');
      const onChange = vi.fn();

      const disposable = watchFile(uri, onChange, 50);

      mockWatcher._fireCreate(uri);
      vi.advanceTimersByTime(50);

      expect(onChange).toHaveBeenCalledTimes(1);

      disposable.dispose();
    });

    it('calls onChange on file delete', () => {
      const uri = vscode.Uri.file('/test/config.json');
      const onChange = vi.fn();

      const disposable = watchFile(uri, onChange, 50);

      mockWatcher._fireDelete(uri);
      vi.advanceTimersByTime(50);

      expect(onChange).toHaveBeenCalledTimes(1);

      disposable.dispose();
    });

    it('debounces rapid changes', () => {
      const uri = vscode.Uri.file('/test/config.json');
      const onChange = vi.fn();

      const disposable = watchFile(uri, onChange, 100);

      mockWatcher._fireChange(uri);
      mockWatcher._fireChange(uri);
      mockWatcher._fireChange(uri);
      vi.advanceTimersByTime(100);

      expect(onChange).toHaveBeenCalledTimes(1);

      disposable.dispose();
    });

    it('uses default debounce delay', () => {
      const uri = vscode.Uri.file('/test/config.json');
      const onChange = vi.fn();

      const disposable = watchFile(uri, onChange);

      mockWatcher._fireChange(uri);

      vi.advanceTimersByTime(99);
      expect(onChange).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(onChange).toHaveBeenCalledTimes(1);

      disposable.dispose();
    });

    it('cancels pending calls on dispose', () => {
      const uri = vscode.Uri.file('/test/config.json');
      const onChange = vi.fn();

      const disposable = watchFile(uri, onChange, 100);

      mockWatcher._fireChange(uri);
      disposable.dispose();
      vi.advanceTimersByTime(100);

      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
