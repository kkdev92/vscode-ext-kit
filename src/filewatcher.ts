import * as vscode from 'vscode';
import { debounce } from './timing.js';

// ============================================
// Types
// ============================================

/**
 * Options for creating a file watcher.
 */
export interface FileWatcherOptions {
  /** Glob pattern(s) to watch */
  patterns: string | string[];
  /** Workspace folder (when specified, uses RelativePattern for better performance) */
  workspaceFolder?: vscode.WorkspaceFolder;
  /** Patterns to ignore */
  ignorePatterns?: string[];
  /** Debounce delay in milliseconds (default: 100) */
  debounceDelay?: number;
  /** Events to watch (default: all) */
  events?: ('create' | 'change' | 'delete')[];
}

/**
 * A file watcher event.
 */
export interface FileWatcherEvent {
  /** Event type */
  type: 'create' | 'change' | 'delete';
  /** File URI */
  uri: vscode.Uri;
  /** Event timestamp */
  timestamp: number;
}

/**
 * A managed file watcher with debouncing support.
 */
export interface ManagedFileWatcher extends vscode.Disposable {
  /**
   * Register a listener for file changes.
   * Events are debounced and batched.
   *
   * @param listener - Callback receiving batched events
   * @returns Disposable to unregister the listener
   */
  onDidChange(listener: (events: FileWatcherEvent[]) => void): vscode.Disposable;

  /** Pause the file watcher. */
  pause(): void;

  /** Resume the file watcher. */
  resume(): void;

  /** Whether the watcher is currently active. */
  readonly isWatching: boolean;
}

// ============================================
// createFileWatcher
// ============================================

/**
 * Creates a managed file watcher with debouncing and event batching.
 *
 * @param options - File watcher options
 * @returns A managed file watcher
 *
 * @example
 * ```typescript
 * const watcher = createFileWatcher({
 *   patterns: ['**\/*.ts', '**\/*.tsx'],
 *   ignorePatterns: ['**\/node_modules/**'],
 *   debounceDelay: 300,
 *   events: ['change', 'create'],
 * });
 *
 * watcher.onDidChange((events) => {
 *   console.log(`${events.length} files changed`);
 *   for (const event of events) {
 *     console.log(`${event.type}: ${event.uri.fsPath}`);
 *   }
 * });
 *
 * context.subscriptions.push(watcher);
 * ```
 */
export function createFileWatcher(options: FileWatcherOptions): ManagedFileWatcher {
  const {
    patterns,
    workspaceFolder,
    ignorePatterns = [],
    debounceDelay = 100,
    events = ['create', 'change', 'delete'],
  } = options;

  const patternList = Array.isArray(patterns) ? patterns : [patterns];
  const watchers: vscode.FileSystemWatcher[] = [];
  const listeners: ((events: FileWatcherEvent[]) => void)[] = [];
  const pendingEvents: FileWatcherEvent[] = [];
  let isPaused = false;
  let isDisposed = false;

  // Create debounced flush function
  const flushEvents = debounce(() => {
    if (pendingEvents.length > 0 && !isPaused) {
      const events = [...pendingEvents];
      pendingEvents.length = 0;
      for (const listener of listeners) {
        listener(events);
      }
    }
  }, debounceDelay);

  // Check if a path should be ignored
  function shouldIgnore(uri: vscode.Uri): boolean {
    const filePath = uri.fsPath;
    for (const pattern of ignorePatterns) {
      // Simple glob matching for common patterns
      if (pattern.includes('**') || pattern.includes('*')) {
        // Use placeholder to avoid replacing * inside .* from ** conversion
        const PLACEHOLDER = '<<<GLOBSTAR>>>';
        const regex = new RegExp(
          pattern
            .replace(/\*\*/g, PLACEHOLDER) // Protect ** with placeholder
            .replace(/\*/g, '[^/\\\\]*') // Replace single *
            .replace(new RegExp(PLACEHOLDER, 'g'), '.*') // Restore ** as .*
            .replace(/\//g, '[/\\\\]')
        );
        if (regex.test(filePath)) {
          return true;
        }
      } else if (filePath.includes(pattern)) {
        return true;
      }
    }
    return false;
  }

  // Add event to pending queue
  function addEvent(type: 'create' | 'change' | 'delete', uri: vscode.Uri): void {
    if (isPaused || isDisposed || shouldIgnore(uri)) {
      return;
    }

    // Check for duplicate events
    const existing = pendingEvents.find((e) => e.uri.fsPath === uri.fsPath && e.type === type);
    if (existing) {
      existing.timestamp = Date.now();
    } else {
      pendingEvents.push({
        type,
        uri,
        timestamp: Date.now(),
      });
    }

    flushEvents();
  }

  // Create watchers for each pattern
  for (const pattern of patternList) {
    // Use RelativePattern when workspaceFolder is specified for better performance
    const watchPattern = workspaceFolder
      ? new vscode.RelativePattern(workspaceFolder, pattern)
      : pattern;
    const watcher = vscode.workspace.createFileSystemWatcher(watchPattern);

    if (events.includes('create')) {
      watcher.onDidCreate((uri) => addEvent('create', uri));
    }
    if (events.includes('change')) {
      watcher.onDidChange((uri) => addEvent('change', uri));
    }
    if (events.includes('delete')) {
      watcher.onDidDelete((uri) => addEvent('delete', uri));
    }

    watchers.push(watcher);
  }

  return {
    onDidChange(listener: (events: FileWatcherEvent[]) => void): vscode.Disposable {
      listeners.push(listener);
      return new vscode.Disposable(() => {
        const index = listeners.indexOf(listener);
        if (index >= 0) {
          listeners.splice(index, 1);
        }
      });
    },

    pause(): void {
      isPaused = true;
      flushEvents.cancel();
      pendingEvents.length = 0;
    },

    resume(): void {
      isPaused = false;
    },

    get isWatching(): boolean {
      return !isPaused && !isDisposed;
    },

    dispose(): void {
      isDisposed = true;
      flushEvents.cancel();
      pendingEvents.length = 0;
      listeners.length = 0;
      for (const watcher of watchers) {
        watcher.dispose();
      }
      watchers.length = 0;
    },
  };
}

// ============================================
// watchFile
// ============================================

/**
 * Watches a single file for changes.
 *
 * @param uri - URI of the file to watch
 * @param onChange - Callback when file changes
 * @param debounceDelay - Debounce delay in milliseconds (default: 100)
 * @returns Disposable to stop watching
 *
 * @example
 * ```typescript
 * const disposable = watchFile(configUri, () => {
 *   reloadConfig();
 * }, 500);
 *
 * // Later...
 * disposable.dispose();
 * ```
 */
export function watchFile(
  uri: vscode.Uri,
  onChange: () => void,
  debounceDelay: number = 100
): vscode.Disposable {
  const debouncedOnChange = debounce(onChange, debounceDelay);

  // Create a pattern that matches the specific file
  const pattern = new vscode.RelativePattern(
    vscode.Uri.joinPath(uri, '..'),
    uri.path.split('/').pop() || ''
  );

  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  const disposables = [
    watcher,
    watcher.onDidChange(() => debouncedOnChange()),
    watcher.onDidCreate(() => debouncedOnChange()),
    watcher.onDidDelete(() => debouncedOnChange()),
  ];

  return new vscode.Disposable(() => {
    debouncedOnChange.cancel();
    for (const d of disposables) {
      d.dispose();
    }
  });
}
