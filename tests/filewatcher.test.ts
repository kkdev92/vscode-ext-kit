import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as vscode from 'vscode';
import { createFileWatcher, watchFile } from '../src/filewatcher.js';

// Helper to create a mock file system watcher with event firing capability
function createTestFileSystemWatcher() {
  const createEventEmitter = () => {
    const listeners: ((uri: unknown) => void)[] = [];
    return {
      fire: (uri: unknown) => listeners.forEach((l) => l(uri)),
      event: vi.fn((listener: (uri: unknown) => void) => {
        listeners.push(listener);
        return { dispose: vi.fn(() => listeners.splice(listeners.indexOf(listener), 1)) };
      }),
    };
  };
  const onDidCreate = createEventEmitter();
  const onDidChange = createEventEmitter();
  const onDidDelete = createEventEmitter();
  return {
    ignoreCreateEvents: false,
    ignoreChangeEvents: false,
    ignoreDeleteEvents: false,
    onDidCreate: onDidCreate.event,
    onDidChange: onDidChange.event,
    onDidDelete: onDidDelete.event,
    _fireCreate: onDidCreate.fire,
    _fireChange: onDidChange.fire,
    _fireDelete: onDidDelete.fire,
    dispose: vi.fn(),
  };
}

// Get mocked workspace
const mockedWorkspace = vscode.workspace as unknown as {
  createFileSystemWatcher: ReturnType<typeof vi.fn>;
};

describe('filewatcher', () => {
  let mockWatcher: ReturnType<typeof createTestFileSystemWatcher>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockWatcher = createTestFileSystemWatcher();
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
      mockWatcher._fireChange({ fsPath: '/test/file1.ts', path: '/test/file1.ts' });
      mockWatcher._fireChange({ fsPath: '/test/file2.ts', path: '/test/file2.ts' });

      expect(listener).not.toHaveBeenCalled();

      vi.advanceTimersByTime(100);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toHaveLength(2);

      watcher.dispose();
    });

    it('reports correct event types', () => {
      const watcher = createFileWatcher({
        patterns: '**/*.ts',
        debounceDelay: 50,
      });

      const listener = vi.fn();
      watcher.onDidChange(listener);

      mockWatcher._fireCreate({ fsPath: '/test/new.ts', path: '/test/new.ts' });
      mockWatcher._fireChange({ fsPath: '/test/changed.ts', path: '/test/changed.ts' });
      mockWatcher._fireDelete({ fsPath: '/test/deleted.ts', path: '/test/deleted.ts' });

      vi.advanceTimersByTime(50);

      expect(listener).toHaveBeenCalledTimes(1);
      const events = listener.mock.calls[0][0];
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

      mockWatcher._fireCreate({ fsPath: '/test/new.ts', path: '/test/new.ts' });
      mockWatcher._fireChange({ fsPath: '/test/changed.ts', path: '/test/changed.ts' });
      mockWatcher._fireDelete({ fsPath: '/test/deleted.ts', path: '/test/deleted.ts' });

      vi.advanceTimersByTime(50);

      expect(listener).toHaveBeenCalledTimes(1);
      const events = listener.mock.calls[0][0];
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

      mockWatcher._fireChange({ fsPath: '/test/node_modules/pkg/index.ts', path: '/test/node_modules/pkg/index.ts' });
      mockWatcher._fireChange({ fsPath: '/test/src/app.ts', path: '/test/src/app.ts' });

      vi.advanceTimersByTime(50);

      expect(listener).toHaveBeenCalledTimes(1);
      const events = listener.mock.calls[0][0];
      expect(events).toHaveLength(1);
      expect(events[0].uri.fsPath).toBe('/test/src/app.ts');

      watcher.dispose();
    });

    it('deduplicates same file events', () => {
      const watcher = createFileWatcher({
        patterns: '**/*.ts',
        debounceDelay: 100,
      });

      const listener = vi.fn();
      watcher.onDidChange(listener);

      const uri = { fsPath: '/test/file.ts', path: '/test/file.ts' };
      mockWatcher._fireChange(uri);
      mockWatcher._fireChange(uri);
      mockWatcher._fireChange(uri);

      vi.advanceTimersByTime(100);

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toHaveLength(1);

      watcher.dispose();
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

        mockWatcher._fireChange({ fsPath: '/test/file.ts', path: '/test/file.ts' });
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

        mockWatcher._fireChange({ fsPath: '/test/file.ts', path: '/test/file.ts' });
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

        mockWatcher._fireChange({ fsPath: '/test/file.ts', path: '/test/file.ts' });
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

        mockWatcher._fireChange({ fsPath: '/test/file.ts', path: '/test/file.ts' });
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

        mockWatcher._fireChange({ fsPath: '/test/file.ts', path: '/test/file.ts' });
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

        mockWatcher._fireChange({ fsPath: '/test/file.ts', path: '/test/file.ts' });
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
