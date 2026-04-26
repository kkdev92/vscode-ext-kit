# @kkdev92/vscode-ext-kit

[![npm version](https://img.shields.io/npm/v/@kkdev92/vscode-ext-kit)](https://www.npmjs.com/package/@kkdev92/vscode-ext-kit)
[![npm downloads](https://img.shields.io/npm/dm/@kkdev92/vscode-ext-kit)](https://www.npmjs.com/package/@kkdev92/vscode-ext-kit)
[![CI](https://github.com/kkdev92/vscode-ext-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/kkdev92/vscode-ext-kit/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-blue.svg)](https://www.typescriptlang.org/)

A lightweight, type-safe utility library for VS Code extension development. Eliminates boilerplate and provides consistent patterns for common extension tasks.

> **Status:** Active (best-effort maintenance)
>
> **Quick Links:** [Installation](#installation) | [Quick Start](#quick-start) | [API Reference](#api-reference) | [Examples](#examples)

---

## Table of Contents

- [Features](#features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [API Reference](#api-reference)
  - [Logger](#logger)
  - [Commands](#commands)
  - [Error Handling](#error-handling)
  - [Progress](#progress)
  - [Configuration](#configuration)
  - [UI Utilities](#ui-utilities)
  - [Notifications](#notifications)
  - [Status Bar](#status-bar)
  - [Storage](#storage)
  - [File Watcher](#file-watcher)
  - [Editor Utilities](#editor-utilities)
  - [Tree View](#tree-view)
  - [WebView](#webview)
  - [Utilities](#utilities)
- [Development](#development)
- [Contributing](#contributing)
- [Security](#security)
- [License](#license)

## Features

### Core Utilities
- **Logger** - Structured logging with full log level control and telemetry support
- **Commands** - Simplified command registration with automatic error handling
- **Error Handling** - Unified error handling with `safeExecute`
- **Progress** - Step-based progress tracking with cancellation support

### Configuration & Storage
- **Config** - Type-safe configuration access with validation
- **Storage** - Type-safe global/workspace/secret storage wrappers

### UI Components
- **UI Utilities** - QuickPick, InputBox, and multi-step wizards
- **Notifications** - Info/warning/error messages with action buttons
- **Status Bar** - Managed status bar items with spinner support

### Advanced Features
- **File Watcher** - Debounced file watching with event batching
- **Editor** - Text editor manipulation utilities
- **Tree View** - Base TreeDataProvider with caching
- **WebView** - Managed WebView panels with CSP support

### Developer Tools
- **Localization** - Translation, pluralization, and locale-aware formatting
- **Utilities** - retry, debounce, throttle, DisposableCollection

> See [API Reference](#api-reference) below for detailed documentation and code examples.

## Installation

```bash
npm install @kkdev92/vscode-ext-kit
```

> Requires VS Code 1.96.0+ and Node.js 20.0.0+

## Quick Start

```typescript
import * as vscode from 'vscode';
import {
  createLogger,
  registerCommands,
  withProgress,
  showInfo,
  getSetting,
  onConfigChange,
} from '@kkdev92/vscode-ext-kit';

export function activate(context: vscode.ExtensionContext) {
  // Create logger with config-based level
  const logger = createLogger('MyExtension', {
    level: getSetting('myExtension', 'logLevel', 'info'),
    configSection: 'myExtension.logLevel',
  });
  context.subscriptions.push(logger);

  // Register commands with automatic error handling
  registerCommands(context, logger, {
    'myExtension.helloWorld': () => {
      showInfo('Hello World!');
    },
    'myExtension.processFiles': async () => {
      return withProgress('Processing files...', async (progress, token) => {
        for (let i = 0; i < 10; i++) {
          if (token.isCancellationRequested) return;
          progress.report({ increment: 10, message: `File ${i + 1}/10` });
          await processFile(i);
        }
        return 'Complete';
      }, { cancellable: true });
    },
  });

  logger.info('Extension activated');
}
```

## Examples

### Real-World Usage

See these projects using `vscode-ext-kit`:
- More examples coming soon!

### Code Snippets

Common patterns and usage examples are shown throughout the [API Reference](#api-reference) below.

> Want to add your project? [Open a PR](CONTRIBUTING.md)!

---

## API Reference

> **Note:** This section contains detailed API documentation. For a quick overview, see [Features](#features) above.

### Logger

Create a structured logger using VS Code's OutputChannel.

```typescript
import { createLogger } from '@kkdev92/vscode-ext-kit';

const logger = createLogger('MyExtension', {
  level: 'debug',           // 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'silent'
  showOnError: true,        // Show output channel on error
  showOnErrorThrottleMs: 5000, // Suppress repeated channel.show() within this window
  timestamp: true,          // Include timestamp in messages
  configSection: 'myExt.logLevel',  // Watch config for level changes
  telemetryReporter: reporter,      // Optional telemetry integration
  redactStackPaths: true,   // Replace os.homedir() with `~` in telemetry
});

// Logging methods
logger.trace('Detailed trace info', { data: 'value' });
logger.debug('Debug message', 'additional', 'args');
logger.info('User logged in', { userId: 123 });
logger.warn('Deprecated API used');
logger.error('Operation failed', new Error('details'));
logger.error(new Error('Direct error'));

// Dynamic level change
logger.setLevel('warn');

// Cleanup
context.subscriptions.push(logger);
```

#### Logging Best Practices

Choose appropriate log levels:

| Level | Use for |
|-------|---------|
| `trace` | Detailed debugging (function entry/exit, variable values) |
| `debug` | Development debugging (config values, internal state) |
| `info` | User-relevant events (extension activated, operation completed) |
| `warn` | Recoverable issues (deprecated API, fallback used) |
| `error` | Failures requiring attention |

**Tips:**
- Keep `info` level logs minimal and user-friendly
- Put detailed diagnostic info at `debug` or `trace` level
- Don't log sensitive data (credentials, personal info)

### Commands

Register commands with automatic error handling.

```typescript
import { registerCommands, registerTextEditorCommands, executeCommand } from '@kkdev92/vscode-ext-kit';

// Register multiple commands
registerCommands(context, logger, {
  'myExt.command1': () => doSomething(),
  'myExt.command2': async (arg1, arg2) => doAsync(arg1, arg2),
}, {
  wrapWithSafeExecute: true,  // Auto-wrap with error handling (default: true)
  commandErrorMessage: (id) => `Command ${id} failed`,
});

// Register text editor commands
registerTextEditorCommands(context, logger, {
  'myExt.formatSelection': (editor, edit) => {
    const selection = editor.selection;
    edit.replace(selection, formatText(editor.document.getText(selection)));
  },
});

// Execute a command programmatically
const result = await executeCommand<string>(logger, 'vscode.openFolder', uri);
```

### Error Handling

Unified error handling with logging and notifications.

```typescript
import { safeExecute, trySafeExecute } from '@kkdev92/vscode-ext-kit';

// Basic usage - returns undefined on error
const result = await safeExecute(logger, 'Fetch data', async () => {
  return await fetchData();
});

// With options
const data = await safeExecute(logger, 'Process file', async () => {
  return await processFile(path);
}, {
  userMessage: 'Failed to process file',  // Custom error message for user
  silent: false,                          // Show notification (default: false)
  rethrow: false,                         // Rethrow after logging (default: false)
});

// Using Result type for explicit success/failure
const result = await trySafeExecute(logger, 'Operation', async () => {
  return await riskyOperation();
});

if (result.ok) {
  console.log(result.value);
} else {
  console.log(result.error.message);
}
```

### Progress

Display progress notifications with cancellation support.

```typescript
import { withProgress, withSteps, toAbortSignal } from '@kkdev92/vscode-ext-kit';
import { ProgressLocation } from 'vscode';

// With progress reporting
const result = await withProgress('Processing...', async (progress, token) => {
  for (let i = 0; i < 100; i++) {
    if (token.isCancellationRequested) {
      return undefined;
    }
    progress.report({
      increment: 1,
      message: `Step ${i + 1}/100`
    });
    await processStep(i);
  }
  return 'Complete';
}, {
  location: ProgressLocation.Notification,  // Default
  cancellable: true,
});

// Simple progress without reporting
const data = await withProgress('Loading...', async () => {
  return await loadData();
});
```

#### Step-based Progress

Execute multiple steps with automatic progress tracking.

```typescript
import { withSteps } from '@kkdev92/vscode-ext-kit';

// Basic usage
const result = await withSteps('Deploying...', [
  { label: 'Building', task: async () => await build() },
  { label: 'Testing', task: async () => await runTests() },
  { label: 'Publishing', task: async () => await publish() },
]);

if (result.completed) {
  console.log('All steps completed');
}

// With weights (heavier steps show more progress)
const result = await withSteps('Processing...', [
  { label: 'Downloading', task: download, weight: 3 },
  { label: 'Processing', task: process, weight: 5 },
  { label: 'Uploading', task: upload, weight: 2 },
], { cancellable: true });

// Access individual step results
const [downloadResult, processResult, uploadResult] = result.results;

// Handle cancellation
if (result.cancelled) {
  console.log('Operation was cancelled');
}
```

#### AbortSignal Integration

Convert VS Code CancellationToken to AbortSignal for fetch APIs.

```typescript
import { withProgress, toAbortSignal } from '@kkdev92/vscode-ext-kit';

await withProgress('Fetching...', async (progress, token) => {
  const signal = toAbortSignal(token);
  const response = await fetch(url, { signal });
  return await response.json();
}, { cancellable: true });
```

### Configuration

Type-safe configuration access.

```typescript
import { getSetting, setSetting, onConfigChange, getConfig } from '@kkdev92/vscode-ext-kit';

// Get a setting with default value
const level = getSetting('myExtension', 'logLevel', 'info');
const timeout = getSetting('myExtension', 'timeout', 5000);

// Set a setting
await setSetting('myExtension', 'logLevel', 'debug', ConfigurationTarget.Global);

// Watch for configuration changes
context.subscriptions.push(
  onConfigChange('myExtension', (e) => {
    if (e.affectsConfiguration('myExtension.logLevel')) {
      logger.setLevel(getSetting('myExtension', 'logLevel', 'info'));
    }
  })
);

// Get entire configuration section
const config = getConfig('myExtension');
```

### UI Utilities

QuickPick, InputBox, and multi-step wizard helpers.

```typescript
import { pickOne, pickMany, inputText, wizard } from '@kkdev92/vscode-ext-kit';

// Single selection
const item = await pickOne(
  [
    { label: 'Option 1', value: 1 },
    { label: 'Option 2', value: 2 },
  ],
  { placeHolder: 'Select an option' }
);

// Multiple selection
const items = await pickMany(
  [
    { label: 'File 1', picked: true },
    { label: 'File 2' },
  ],
  { placeHolder: 'Select files' }
);

// Text input with validation
const name = await inputText({
  prompt: 'Enter project name',
  placeHolder: 'my-project',
  validate: (value) => {
    if (!value) return 'Name is required';
    if (!/^[a-z-]+$/.test(value)) return 'Use lowercase letters and hyphens only';
    return undefined;
  },
});
```

#### Multi-Step Wizard

Create guided multi-step input flows with back navigation, step tracking, and conditional skipping.

```typescript
import { wizard } from '@kkdev92/vscode-ext-kit';

interface BranchState {
  type: 'feature' | 'fix' | 'chore';
  name: string;
  description: string;
}

const result = await wizard<BranchState>({
  title: 'Create Branch',
  steps: [
    {
      id: 'type',
      type: 'quickpick',
      placeholder: 'Select branch type',
      items: [
        { label: 'Feature', description: 'New feature', value: 'feature' },
        { label: 'Bug Fix', description: 'Fix a bug', value: 'fix' },
        { label: 'Chore', description: 'Maintenance', value: 'chore' },
      ],
    },
    {
      id: 'name',
      type: 'input',
      prompt: 'Enter branch name',
      placeholder: 'my-feature',
      validate: (value) => {
        if (!/^[a-z0-9-]+$/.test(value)) {
          return 'Use lowercase letters, numbers, and hyphens only';
        }
        return undefined;
      },
    },
    {
      id: 'description',
      type: 'input',
      prompt: 'Enter description (optional)',
      // Skip this step for chore branches
      skip: (state) => state.type === 'chore',
    },
  ],
});

if (result.completed) {
  const { type, name, description } = result.state as BranchState;
  await createBranch(`${type}/${name}`, description);
}
```

Wizard features:
- Step numbers (e.g., "Step 1 of 3")
- Back button navigation
- Conditional step skipping based on previous inputs
- Dynamic items and default values based on state
- Input validation with state context

### Notifications

Show notifications with action buttons.

```typescript
import { showInfo, showWarn, showError, confirm, showWithActions } from '@kkdev92/vscode-ext-kit';

// Simple notifications
await showInfo('Operation completed');
await showWarn('This action is deprecated');
await showError('Failed to save file');

// Confirmation dialog (modal by default; customise button text via options)
const confirmed = await confirm('Delete this file?', {
  yesText: 'Delete',
  noText: 'Cancel',
});
if (confirmed) {
  await deleteFile();
}

// Notifications with custom actions
const action = await showWithActions(
  'info',
  'New version available',
  [
    { title: 'Update Now', value: 'update' },
    { title: 'Later', value: 'later' },
    { title: 'Never', value: 'never', isCloseAffordance: true },
  ]
);
```

### Status Bar

Managed status bar items.

```typescript
import { createStatusBarItem, showStatusMessage } from '@kkdev92/vscode-ext-kit';

// Create managed status bar item
const statusItem = createStatusBarItem('myExt.status', {
  text: 'Ready',
  tooltip: 'Extension status',
  command: 'myExt.showStatus',
  alignment: 'left',
  priority: 100,
});

// Update text (and optionally tooltip)
statusItem.update('Processing...');
statusItem.showSpinner('Processing...');
// ... do work ...
statusItem.hideSpinner();
statusItem.update('Ready', 'Last sync: just now');

// Temporary status message
const disposable = showStatusMessage('Saved!', 3000);

context.subscriptions.push(statusItem);
```

### Storage

Type-safe storage wrappers.

```typescript
import { createGlobalStorage, createWorkspaceStorage, createSecretStorage } from '@kkdev92/vscode-ext-kit';

// Global storage (persists across workspaces)
const globalStorage = createGlobalStorage<{ theme: string; fontSize: number }>(
  context,
  'settings',
  {
    defaultValue: { theme: 'dark', fontSize: 14 },
    version: 2,
    migrate: (old, version) => {
      if (version === 1) {
        return { ...old, fontSize: 14 };
      }
      return old;
    },
  }
);

const settings = globalStorage.get();
await globalStorage.set({ theme: 'light', fontSize: 16 });
await globalStorage.reset();

// Workspace storage (per-workspace)
const workspaceStorage = createWorkspaceStorage<string[]>(
  context,
  'recentFiles',
  { defaultValue: [] }
);

// Secret storage (encrypted)
const secretStorage = createSecretStorage(context, 'apiKey');
await secretStorage.set('sk-...');
const apiKey = await secretStorage.get();
await secretStorage.delete();

// Listen for changes
secretStorage.onDidChange(() => {
  console.log('API key changed');
});

context.subscriptions.push(secretStorage);
```

### File Watcher

Debounced file watching with event batching.

```typescript
import { createFileWatcher, watchFile } from '@kkdev92/vscode-ext-kit';

// Watch multiple patterns with debouncing
const watcher = createFileWatcher({
  patterns: ['**/*.ts', '**/*.json'],
  ignorePatterns: ['**/node_modules/**'],
  debounceDelay: 300,
  events: ['create', 'change', 'delete'],
  workspaceFolder: vscode.workspace.workspaceFolders?.[0],  // Use RelativePattern
});

// Events are batched per debounce window — the listener receives all the
// events that occurred during the window in a single array.
watcher.onDidChange((events) => {
  for (const event of events) {
    console.log(`${event.type}:`, event.uri.fsPath);
  }
});

context.subscriptions.push(watcher);

// Simple single-file watcher (takes a vscode.Uri, not a glob)
const configUri = vscode.Uri.file('/path/to/.myconfig');
const configWatcher = watchFile(configUri, () => {
  reloadConfig();
});
```

### Editor Utilities

Text editor manipulation utilities.

```typescript
import {
  getSelectedText,
  replaceText,
  insertAtCursor,
  transformSelection,
  getLine,
  getCurrentLine,
  moveCursor,
  selectRange,
} from '@kkdev92/vscode-ext-kit';

// Get selected text
const text = getSelectedText(editor);

// Replace text in range
await replaceText(editor, range, 'new text');

// Insert at cursor
await insertAtCursor(editor, 'inserted text');

// Transform selection
await transformSelection(editor, (text) => text.toUpperCase());

// Get line content
const line = getLine(editor, 5);
const currentLine = getCurrentLine(editor);

// Cursor and selection manipulation
moveCursor(editor, new vscode.Position(10, 0));
selectRange(editor, new vscode.Range(0, 0, 10, 0));
```

### Tree View

Base class for tree data providers.

```typescript
import { BaseTreeDataProvider, createTreeView, type TreeItemData } from '@kkdev92/vscode-ext-kit';

interface FileItem extends TreeItemData<{ path: string; isDirectory: boolean }> {}

class FileTreeProvider extends BaseTreeDataProvider<FileItem> {
  async getRoots(): Promise<FileItem[]> {
    return this.toItems(await this.loadDirectory('/'));
  }

  async getChildrenOf(element: FileItem): Promise<FileItem[]> {
    if (!element.data?.isDirectory) return [];
    return this.toItems(await this.loadDirectory(element.data.path));
  }

  // getTreeItem already has a sensible default implementation that maps the
  // TreeItemData fields onto a vscode.TreeItem. Override it only to customise
  // the rendering (icons, contextValue, etc.).
  override getTreeItem(element: FileItem): vscode.TreeItem {
    const item = super.getTreeItem(element);
    item.contextValue = element.data?.isDirectory ? 'directory' : 'file';
    return item;
  }

  private toItems(entries: { name: string; path: string; isDirectory: boolean }[]): FileItem[] {
    return entries.map((entry) => ({
      id: entry.path,
      label: entry.name,
      collapsibleState: entry.isDirectory
        ? vscode.TreeItemCollapsibleState.Collapsed
        : vscode.TreeItemCollapsibleState.None,
      data: { path: entry.path, isDirectory: entry.isDirectory },
    }));
  }
}

const provider = new FileTreeProvider();
const treeView = createTreeView(context, 'myExtension.fileTree', provider, {
  showCollapseAll: true,
});

// `createTreeView` already pushes the view (and the provider, if disposable)
// onto context.subscriptions for you.
```

### WebView

Managed WebView panels with CSP support.

```typescript
import {
  createWebViewPanel,
  generateCSP,
  generateNonce,
  createWebViewHtml,
} from '@kkdev92/vscode-ext-kit';

interface InMsg { type: 'save'; payload: { content: string } }
interface OutMsg { type: 'update'; payload: { data: unknown } }

const panel = createWebViewPanel<InMsg, OutMsg>(context, {
  viewType: 'myExt.preview',
  title: 'Preview',
  column: vscode.ViewColumn.Beside,
  enableScripts: true,
  retainContext: true, // option name on this kit; maps to retainContextWhenHidden internally
  localResourceRoots: [context.extensionUri],
});

// Generate CSP — webview is positional, options come second
const nonce = generateNonce();
const csp = generateCSP(panel.native.webview, {
  nonce,
  // Opt in to a stricter policy than the historical defaults:
  allowInlineStyles: false,
  allowAnyHttpsImages: false,
});

// Build HTML using webview-resolved URIs for scripts/styles
const scriptUri = panel.asWebviewUri(
  vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js')
);
const styleUri = panel.asWebviewUri(
  vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.css')
);

panel.setHtml(
  createWebViewHtml({
    title: 'Preview',
    csp,
    nonce,
    scripts: [scriptUri.toString()],
    styles: [styleUri.toString()],
    body: '<div id="app"></div>',
  })
);

// Handle messages from webview — WebViewMessage has { type, payload }
panel.onMessage((message) => {
  if (message.type === 'save') {
    saveData(message.payload.content);
  }
});

// Send messages to webview
await panel.postMessage({ type: 'update', payload: { data: newData } });

// `createWebViewPanel` already pushes the panel onto context.subscriptions.
```

### Utilities

#### DisposableCollection

```typescript
import { DisposableCollection } from '@kkdev92/vscode-ext-kit';

const disposables = new DisposableCollection();

disposables.push(
  vscode.workspace.onDidChangeConfiguration(() => {}),
  vscode.window.onDidChangeActiveTextEditor(() => {})
);

const watcher = disposables.add(
  vscode.workspace.createFileSystemWatcher('**/*.ts')
);

context.subscriptions.push(disposables);
```

#### Retry

```typescript
import { retry } from '@kkdev92/vscode-ext-kit';

const data = await retry(
  () => fetchWithTimeout(url),
  {
    maxAttempts: 5,
    delay: 1000,
    backoff: 'exponential',
    maxDelay: 30_000,        // Cap each wait so exponential growth stays bounded
    jitter: 'equal',         // 'none' (default) | 'full' | 'equal' — randomise delays
    retryIf: (error) => (error as { code?: string }).code === 'ETIMEDOUT',
    onRetry: (error, attempt, delay) => {
      logger.warn(`Retry ${attempt} after ${delay}ms`, error);
    },
  }
);
```

#### Debounce / Throttle

```typescript
import { debounce, throttle } from '@kkdev92/vscode-ext-kit';

// Debounce - execute after delay since last call
const debouncedSave = debounce((content: string) => {
  saveToFile(content);
}, 500);

editor.onDidChangeTextDocument(() => {
  debouncedSave(editor.document.getText());
});

// Throttle - execute at most once per interval
const throttledUpdate = throttle(() => {
  updatePreview();
}, 100);

editor.onDidScrollChange(() => {
  throttledUpdate();
});

// Cancel pending executions
debouncedSave.cancel();
```

#### Localization

```typescript
import { t, getLanguage, isLanguage, plural, formatNumber, formatDate, formatRelativeTime } from '@kkdev92/vscode-ext-kit';

// Translate message (uses vscode.l10n.t)
const greeting = t('Hello, World!');
const welcome = t('Welcome, {0}!', userName);

// Check current language
const lang = getLanguage(); // 'en', 'ja', etc.
if (isLanguage('ja')) {
  // Japanese-specific handling
}

// Pluralization (uses Intl.PluralRules)
plural(1, { one: '{count} item', other: '{count} items' }); // "1 item"
plural(5, { one: '{count} item', other: '{count} items' }); // "5 items"
plural(0, {
  zero: 'No items',
  one: '{count} item',
  other: '{count} items'
}); // "No items"

// Number formatting (locale-aware)
formatNumber(1234567.89);  // "1,234,567.89" (en) / "1.234.567,89" (de)
formatNumber(0.75, { style: 'percent' });  // "75%"
formatNumber(1234.56, { style: 'currency', currency: 'USD' });  // "$1,234.56"
formatNumber(3.14159, { maximumFractionDigits: 2 });  // "3.14"

// Date formatting (locale-aware)
formatDate(new Date(), { dateStyle: 'short' });  // "2/4/26" (en-US)
formatDate(new Date(), { dateStyle: 'long' });   // "February 4, 2026" (en)
formatDate(new Date(), { dateStyle: 'medium', timeStyle: 'short' });

// Relative time formatting
formatRelativeTime(-1, 'day');    // "1 day ago" (en) / "1日前" (ja)
formatRelativeTime(2, 'hour');    // "in 2 hours"
formatRelativeTime(-5, 'minute', 'short');  // "5 min. ago"
```

## Troubleshooting

### Common Issues

#### Logger not showing debug messages

**Problem**: Debug logs don't appear in Output channel.

**Solution**: Check your log level setting:

```typescript
// Ensure level is 'debug' or 'trace'
const logger = createLogger('MyExt', { level: 'debug' });
```

#### TypeScript errors with imports

**Problem**: `Cannot find module '@kkdev92/vscode-ext-kit'`

**Solution**: Ensure you have the correct version:

```bash
npm install @kkdev92/vscode-ext-kit@latest
```

#### Commands not registering

**Problem**: Commands don't appear in Command Palette.

**Solution**: Verify `package.json` includes command declarations:

```json
{
  "contributes": {
    "commands": [
      { "command": "myExt.commandId", "title": "My Command" }
    ]
  }
}
```

### Need More Help?

- Check [GitHub Issues](https://github.com/kkdev92/vscode-ext-kit/issues)
- Review [API Reference](#api-reference) above
- See [Contributing Guide](CONTRIBUTING.md) to report bugs

---

## Development

### Prerequisites

- Node.js >= 20.0.0
- npm >= 10.0.0

### Setup

```bash
git clone https://github.com/kkdev92/vscode-ext-kit.git
cd vscode-ext-kit
npm install
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript to dist/ |
| `npm test` | Run tests with Vitest |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |
| `npm run lint` | Run ESLint |
| `npm run lint:fix` | Fix ESLint errors |
| `npm run format` | Format code with Prettier |
| `npm run typecheck` | Run TypeScript type checking |
| `npm run knip` | Check for unused code/exports |

### Git Hooks

Pre-commit hooks automatically run:
1. **lint-staged** - Formats and lints staged files
2. **typecheck** - Verifies TypeScript types
3. **test** - Runs the test suite

## Contributing

Contributions are welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

For security concerns, please see [SECURITY.md](SECURITY.md).

---

## License

[MIT](LICENSE)
