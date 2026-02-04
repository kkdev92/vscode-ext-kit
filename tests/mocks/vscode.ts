import { vi } from 'vitest';

// LogLevel enum
export const LogLevel = {
  Off: 0,
  Trace: 1,
  Debug: 2,
  Info: 3,
  Warning: 4,
  Error: 5,
} as const;

// ProgressLocation enum
export const ProgressLocation = {
  SourceControl: 1,
  Window: 10,
  Notification: 15,
} as const;

// ConfigurationTarget enum
export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;

// StatusBarAlignment enum
export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
} as const;

// Mock StatusBarItem factory
export function createMockStatusBarItem() {
  return {
    id: '',
    alignment: StatusBarAlignment.Left,
    priority: undefined as number | undefined,
    name: undefined as string | undefined,
    text: '',
    tooltip: undefined as string | undefined,
    color: undefined,
    backgroundColor: undefined,
    command: undefined as string | undefined,
    accessibilityInformation: undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
}

// Mock Uri class
export const Uri = {
  parse: vi.fn((path: string) => ({
    fsPath: path,
    path,
    scheme: 'file',
    toString: () => path,
  })),
  file: vi.fn((path: string) => ({
    fsPath: path,
    path,
    scheme: 'file',
    toString: () => path,
  })),
  joinPath: vi.fn((uri: { path: string }, ...segments: string[]) => {
    const newPath = [uri.path, ...segments].join('/').replace(/\/+/g, '/');
    return {
      fsPath: newPath,
      path: newPath,
      scheme: 'file',
      toString: () => newPath,
    };
  }),
};

// Mock RelativePattern class
export class RelativePattern {
  constructor(
    public readonly base: { fsPath: string } | string,
    public readonly pattern: string
  ) {}
}

// Mock FileSystemWatcher factory
export function createMockFileSystemWatcher() {
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

// Mock LogOutputChannel factory
export function createMockLogOutputChannel(name: string) {
  return {
    name,
    logLevel: LogLevel.Info,
    onDidChangeLogLevel: vi.fn(),
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    append: vi.fn(),
    appendLine: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    replace: vi.fn(),
  };
}

// Mock OutputChannel factory
export function createMockOutputChannel(name: string) {
  return {
    name,
    append: vi.fn(),
    appendLine: vi.fn(),
    clear: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    replace: vi.fn(),
  };
}

// TreeItemCollapsibleState enum
export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const;

// Mock TreeItem class
export class TreeItem {
  id?: string;
  label?: string;
  description?: string;
  tooltip?: string;
  iconPath?: unknown;
  contextValue?: string;
  command?: unknown;
  collapsibleState?: number;

  constructor(label: string, collapsibleState?: number) {
    this.label = label;
    this.collapsibleState = collapsibleState ?? TreeItemCollapsibleState.None;
  }
}

// Mock ThemeIcon class
export class ThemeIcon {
  constructor(
    public readonly id: string,
    public readonly color?: unknown
  ) {}
}

// Mock EventEmitter class
export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];

  event = (listener: (e: T) => void) => {
    this.listeners.push(listener);
    return { dispose: () => this.listeners.splice(this.listeners.indexOf(listener), 1) };
  };

  fire(data: T): void {
    this.listeners.forEach((l) => l(data));
  }

  dispose(): void {
    this.listeners = [];
  }
}

// ViewColumn enum
export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
  Three: 3,
  Four: 4,
  Five: 5,
  Six: 6,
  Seven: 7,
  Eight: 8,
  Nine: 9,
} as const;

// Mock Webview factory
export function createMockWebview() {
  return {
    html: '',
    options: {},
    cspSource: 'https://mock.csp.source',
    asWebviewUri: vi.fn((uri: { toString: () => string }) => ({
      toString: () => `vscode-webview://mock/${uri.toString()}`,
      fsPath: uri.toString(),
      scheme: 'vscode-webview',
    })),
    onDidReceiveMessage: vi.fn(() => ({ dispose: vi.fn() })),
    postMessage: vi.fn().mockResolvedValue(true),
  };
}

// Mock WebviewPanel factory
export function createMockWebviewPanel(viewType: string = 'test', title: string = 'Test') {
  const webview = createMockWebview();
  return {
    viewType,
    title,
    webview,
    options: {},
    viewColumn: ViewColumn.One,
    active: true,
    visible: true,
    onDidChangeViewState: vi.fn(() => ({ dispose: vi.fn() })),
    onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
    reveal: vi.fn(),
    dispose: vi.fn(),
  };
}

// Mock TreeView factory
export function createMockTreeView() {
  return {
    onDidExpandElement: vi.fn(() => ({ dispose: vi.fn() })),
    onDidCollapseElement: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeSelection: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeVisibility: vi.fn(() => ({ dispose: vi.fn() })),
    onDidChangeCheckboxState: vi.fn(() => ({ dispose: vi.fn() })),
    selection: [],
    visible: true,
    title: '',
    description: '',
    message: '',
    badge: undefined,
    reveal: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  };
}

// Mock QuickPick factory
export function createMockQuickPick<T extends { label: string }>() {
  let items: T[] = [];
  let selectedItems: T[] = [];
  const onDidAcceptListeners: (() => void)[] = [];
  const onDidTriggerButtonListeners: ((button: unknown) => void)[] = [];
  const onDidHideListeners: (() => void)[] = [];

  const quickPick = {
    title: '',
    placeholder: '',
    canSelectMany: false,
    get items() { return items; },
    set items(value: T[]) { items = value; },
    get selectedItems() { return selectedItems; },
    set selectedItems(value: T[]) { selectedItems = value; },
    buttons: [] as unknown[],
    onDidAccept: vi.fn((listener: () => void) => {
      onDidAcceptListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    onDidTriggerButton: vi.fn((listener: (button: unknown) => void) => {
      onDidTriggerButtonListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    onDidHide: vi.fn((listener: () => void) => {
      onDidHideListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    // Test helpers
    _accept: (selection?: T[]) => {
      if (selection) selectedItems = selection;
      onDidAcceptListeners.forEach((l) => l());
    },
    _triggerButton: (button: unknown) => {
      onDidTriggerButtonListeners.forEach((l) => l(button));
    },
    _hide: () => {
      onDidHideListeners.forEach((l) => l());
    },
  };

  return quickPick;
}

// Mock InputBox factory
export function createMockInputBox() {
  let value = '';
  const onDidAcceptListeners: (() => void)[] = [];
  const onDidTriggerButtonListeners: ((button: unknown) => void)[] = [];
  const onDidHideListeners: (() => void)[] = [];
  const onDidChangeValueListeners: ((value: string) => void)[] = [];

  const inputBox = {
    title: '',
    prompt: '',
    placeholder: '',
    password: false,
    get value() { return value; },
    set value(v: string) { value = v; },
    validationMessage: undefined as string | undefined,
    buttons: [] as unknown[],
    onDidAccept: vi.fn((listener: () => void) => {
      onDidAcceptListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    onDidTriggerButton: vi.fn((listener: (button: unknown) => void) => {
      onDidTriggerButtonListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    onDidHide: vi.fn((listener: () => void) => {
      onDidHideListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    onDidChangeValue: vi.fn((listener: (value: string) => void) => {
      onDidChangeValueListeners.push(listener);
      return { dispose: vi.fn() };
    }),
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
    // Test helpers
    _setValue: (v: string) => {
      value = v;
      onDidChangeValueListeners.forEach((l) => l(v));
    },
    _accept: () => {
      onDidAcceptListeners.forEach((l) => l());
    },
    _triggerButton: (button: unknown) => {
      onDidTriggerButtonListeners.forEach((l) => l(button));
    },
    _hide: () => {
      onDidHideListeners.forEach((l) => l());
    },
  };

  return inputBox;
}

// Mock window namespace - create fresh functions each time
export const window = {
  createOutputChannel: vi.fn((name: string, options?: { log: true }) => {
    if (options?.log) {
      return createMockLogOutputChannel(name);
    }
    return createMockOutputChannel(name);
  }),
  createStatusBarItem: vi.fn(
    (_idOrAlignment?: string | number, _alignmentOrPriority?: number, _priority?: number) => {
      return createMockStatusBarItem();
    }
  ),
  createTreeView: vi.fn((_viewId: string, _options: unknown) => createMockTreeView()),
  createWebviewPanel: vi.fn(
    (viewType: string, title: string, _column: number, _options?: unknown) =>
      createMockWebviewPanel(viewType, title)
  ),
  createQuickPick: vi.fn(() => createMockQuickPick()),
  createInputBox: vi.fn(() => createMockInputBox()),
  showInformationMessage: vi.fn().mockResolvedValue(undefined),
  showWarningMessage: vi.fn().mockResolvedValue(undefined),
  showErrorMessage: vi.fn().mockResolvedValue(undefined),
  showQuickPick: vi.fn().mockResolvedValue(undefined),
  showInputBox: vi.fn().mockResolvedValue(undefined),
  withProgress: vi.fn().mockImplementation(
    async <T>(
      _options: unknown,
      task: (
        progress: { report: (value: unknown) => void },
        token: {
          isCancellationRequested: boolean;
          onCancellationRequested: ReturnType<typeof vi.fn>;
        }
      ) => Promise<T>
    ) => {
      const progress = { report: vi.fn() };
      const token = {
        isCancellationRequested: false,
        onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
      };
      return task(progress, token);
    }
  ),
};

// Mock commands namespace
export const commands = {
  registerCommand: vi.fn((_commandId: string, callback: (...args: unknown[]) => unknown) => {
    return {
      dispose: vi.fn(),
      _callback: callback, // Store callback for testing
    };
  }),
  registerTextEditorCommand: vi.fn(
    (
      _commandId: string,
      callback: (editor: unknown, edit: unknown, ...args: unknown[]) => unknown
    ) => {
      return {
        dispose: vi.fn(),
        _callback: callback, // Store callback for testing
      };
    }
  ),
  executeCommand: vi.fn().mockResolvedValue(undefined),
};

// Mock WorkspaceConfiguration factory
export function createMockWorkspaceConfiguration() {
  return {
    get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
    has: vi.fn(() => false),
    inspect: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

// Mock workspace namespace
export const workspace = {
  getConfiguration: vi.fn((_section?: string) => createMockWorkspaceConfiguration()),
  onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  createFileSystemWatcher: vi.fn((_pattern: string | RelativePattern) =>
    createMockFileSystemWatcher()
  ),
};

// Mock env namespace
export const env = {
  language: 'en',
};

// Mock l10n namespace
export const l10n = {
  t: vi.fn((message: string, ..._args: unknown[]) => message),
  bundle: undefined,
  uri: undefined,
};

// Mock Disposable
export class Disposable {
  private _callOnDispose: () => void;

  constructor(callOnDispose: () => void) {
    this._callOnDispose = callOnDispose;
  }

  dispose(): void {
    this._callOnDispose();
  }

  static from(...disposables: { dispose(): void }[]): Disposable {
    return new Disposable(() => {
      disposables.forEach((d) => d.dispose());
    });
  }
}

// Mock CancellationToken factory
export function createMockCancellationToken() {
  return {
    isCancellationRequested: false,
    onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

// Reset all mocks
export function resetAllMocks(): void {
  vi.clearAllMocks();

  // Reset window mocks
  window.createOutputChannel.mockImplementation((name: string, options?: { log: true }) => {
    if (options?.log) {
      return createMockLogOutputChannel(name);
    }
    return createMockOutputChannel(name);
  });
  window.createStatusBarItem.mockImplementation(() => createMockStatusBarItem());
  window.createTreeView.mockImplementation(() => createMockTreeView());
  window.showInformationMessage.mockResolvedValue(undefined);
  window.showWarningMessage.mockResolvedValue(undefined);
  window.showErrorMessage.mockResolvedValue(undefined);
  window.showQuickPick.mockResolvedValue(undefined);
  window.showInputBox.mockResolvedValue(undefined);

  // Reset commands mocks
  commands.registerCommand.mockImplementation(
    (_commandId: string, callback: (...args: unknown[]) => unknown) => {
      return {
        dispose: vi.fn(),
        _callback: callback,
      };
    }
  );
  commands.registerTextEditorCommand.mockImplementation(
    (
      _commandId: string,
      callback: (editor: unknown, edit: unknown, ...args: unknown[]) => unknown
    ) => {
      return {
        dispose: vi.fn(),
        _callback: callback,
      };
    }
  );
  commands.executeCommand.mockResolvedValue(undefined);

  // Reset workspace mocks
  workspace.getConfiguration.mockImplementation(() => createMockWorkspaceConfiguration());
  workspace.onDidChangeConfiguration.mockReturnValue({ dispose: vi.fn() });
  workspace.createFileSystemWatcher.mockImplementation(() => createMockFileSystemWatcher());
}

// Mock Memento factory
export function createMockMemento() {
  const storage = new Map<string, unknown>();
  return {
    keys: () => [...storage.keys()],
    get: <T>(key: string, defaultValue?: T): T | undefined => {
      return storage.has(key) ? (storage.get(key) as T) : defaultValue;
    },
    update: vi.fn(async (key: string, value: unknown) => {
      if (value === undefined) {
        storage.delete(key);
      } else {
        storage.set(key, value);
      }
    }),
    _storage: storage, // For testing
  };
}

// Mock SecretStorage factory
export function createMockSecretStorage() {
  const secrets = new Map<string, string>();
  return {
    get: vi.fn(async (key: string) => secrets.get(key)),
    store: vi.fn(async (key: string, value: string) => {
      secrets.set(key, value);
    }),
    delete: vi.fn(async (key: string) => {
      secrets.delete(key);
    }),
    onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
    _secrets: secrets, // For testing
  };
}

// Mock Position class
export class Position {
  constructor(
    public readonly line: number,
    public readonly character: number
  ) {}

  isEqual(other: Position): boolean {
    return this.line === other.line && this.character === other.character;
  }

  isBefore(other: Position): boolean {
    return this.line < other.line || (this.line === other.line && this.character < other.character);
  }

  isAfter(other: Position): boolean {
    return this.line > other.line || (this.line === other.line && this.character > other.character);
  }

  translate(lineDelta?: number, characterDelta?: number): Position {
    return new Position(this.line + (lineDelta || 0), this.character + (characterDelta || 0));
  }

  with(line?: number, character?: number): Position {
    return new Position(line ?? this.line, character ?? this.character);
  }
}

// Mock Range class
export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(start: Position, end: Position);
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
  constructor(
    startOrStartLine: Position | number,
    endOrStartCharacter: Position | number,
    endLine?: number,
    endCharacter?: number
  ) {
    if (typeof startOrStartLine === 'number') {
      this.start = new Position(startOrStartLine, endOrStartCharacter as number);
      this.end = new Position(endLine!, endCharacter!);
    } else {
      this.start = startOrStartLine;
      this.end = endOrStartCharacter as Position;
    }
  }

  get isEmpty(): boolean {
    return this.start.isEqual(this.end);
  }

  get isSingleLine(): boolean {
    return this.start.line === this.end.line;
  }

  contains(positionOrRange: Position | Range): boolean {
    if (positionOrRange instanceof Position) {
      return !positionOrRange.isBefore(this.start) && !positionOrRange.isAfter(this.end);
    }
    return this.contains(positionOrRange.start) && this.contains(positionOrRange.end);
  }

  isEqual(other: Range): boolean {
    return this.start.isEqual(other.start) && this.end.isEqual(other.end);
  }

  with(start?: Position, end?: Position): Range {
    return new Range(start ?? this.start, end ?? this.end);
  }
}

// Mock Selection class
export class Selection extends Range {
  readonly anchor: Position;
  readonly active: Position;

  constructor(anchor: Position, active: Position);
  constructor(anchorLine: number, anchorCharacter: number, activeLine: number, activeCharacter: number);
  constructor(
    anchorOrAnchorLine: Position | number,
    activeOrAnchorCharacter: Position | number,
    activeLine?: number,
    activeCharacter?: number
  ) {
    if (typeof anchorOrAnchorLine === 'number') {
      const anchor = new Position(anchorOrAnchorLine, activeOrAnchorCharacter as number);
      const active = new Position(activeLine!, activeCharacter!);
      super(anchor, active);
      this.anchor = anchor;
      this.active = active;
    } else {
      super(anchorOrAnchorLine, activeOrAnchorCharacter as Position);
      this.anchor = anchorOrAnchorLine;
      this.active = activeOrAnchorCharacter as Position;
    }
  }

  get isReversed(): boolean {
    return this.anchor.isAfter(this.active);
  }
}

// Mock TextLine
export interface MockTextLine {
  lineNumber: number;
  text: string;
  range: Range;
  rangeIncludingLineBreak: Range;
  firstNonWhitespaceCharacterIndex: number;
  isEmptyOrWhitespace: boolean;
}

// Mock TextDocument factory
export function createMockTextDocument(content: string = '', languageId: string = 'plaintext') {
  const lines = content.split('\n');
  return {
    uri: Uri.file('/mock/document.txt'),
    fileName: '/mock/document.txt',
    isUntitled: false,
    languageId,
    version: 1,
    isDirty: false,
    isClosed: false,
    eol: 1, // LF
    lineCount: lines.length,
    getText: vi.fn((range?: Range) => {
      if (!range) return content;
      const startLine = range.start.line;
      const endLine = range.end.line;
      if (startLine === endLine) {
        return lines[startLine]?.substring(range.start.character, range.end.character) || '';
      }
      const result: string[] = [];
      for (let i = startLine; i <= endLine; i++) {
        if (i === startLine) {
          result.push(lines[i]?.substring(range.start.character) || '');
        } else if (i === endLine) {
          result.push(lines[i]?.substring(0, range.end.character) || '');
        } else {
          result.push(lines[i] || '');
        }
      }
      return result.join('\n');
    }),
    lineAt: vi.fn((lineOrPosition: number | Position): MockTextLine => {
      const lineNumber = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line;
      const text = lines[lineNumber] || '';
      return {
        lineNumber,
        text,
        range: new Range(lineNumber, 0, lineNumber, text.length),
        rangeIncludingLineBreak: new Range(lineNumber, 0, lineNumber + 1, 0),
        firstNonWhitespaceCharacterIndex: text.search(/\S/) === -1 ? text.length : text.search(/\S/),
        isEmptyOrWhitespace: text.trim().length === 0,
      };
    }),
    offsetAt: vi.fn((position: Position) => {
      let offset = 0;
      for (let i = 0; i < position.line; i++) {
        offset += (lines[i]?.length || 0) + 1;
      }
      return offset + position.character;
    }),
    positionAt: vi.fn((offset: number) => {
      let remaining = offset;
      for (let i = 0; i < lines.length; i++) {
        const lineLength = (lines[i]?.length || 0) + 1;
        if (remaining < lineLength) {
          return new Position(i, remaining);
        }
        remaining -= lineLength;
      }
      return new Position(lines.length - 1, lines[lines.length - 1]?.length || 0);
    }),
    getWordRangeAtPosition: vi.fn((position: Position) => {
      const line = lines[position.line] || '';
      const wordPattern = /\w+/g;
      let match;
      while ((match = wordPattern.exec(line)) !== null) {
        if (match.index <= position.character && match.index + match[0].length >= position.character) {
          return new Range(position.line, match.index, position.line, match.index + match[0].length);
        }
      }
      return undefined;
    }),
    validatePosition: vi.fn((position: Position) => position),
    validateRange: vi.fn((range: Range) => range),
    save: vi.fn().mockResolvedValue(true),
    _content: content,
    _lines: lines,
  };
}

// Mock TextEditor factory
export function createMockTextEditor(content: string = '', languageId: string = 'plaintext') {
  const document = createMockTextDocument(content, languageId);
  let selection = new Selection(0, 0, 0, 0);
  let selections = [selection];

  const editor = {
    document,
    get selection() {
      return selection;
    },
    set selection(value: Selection) {
      selection = value;
      selections = [value];
    },
    get selections() {
      return selections;
    },
    set selections(value: Selection[]) {
      selections = value;
      selection = value[0] || new Selection(0, 0, 0, 0);
    },
    options: {
      tabSize: 2,
      insertSpaces: true,
    },
    viewColumn: 1,
    edit: vi.fn(async (callback: (editBuilder: {
      replace: (range: Range, text: string) => void;
      insert: (position: Position, text: string) => void;
      delete: (range: Range) => void;
    }) => void) => {
      const operations: { type: string; range?: Range; position?: Position; text?: string }[] = [];
      const editBuilder = {
        replace: (range: Range, text: string) => operations.push({ type: 'replace', range, text }),
        insert: (position: Position, text: string) => operations.push({ type: 'insert', position, text }),
        delete: (range: Range) => operations.push({ type: 'delete', range }),
      };
      callback(editBuilder);
      return true;
    }),
    insertSnippet: vi.fn().mockResolvedValue(true),
    setDecorations: vi.fn(),
    revealRange: vi.fn(),
    show: vi.fn(),
    hide: vi.fn(),
  };

  return editor;
}

// Mock ExtensionContext factory
export function createMockExtensionContext() {
  return {
    subscriptions: [] as { dispose: () => void }[],
    globalState: createMockMemento(),
    workspaceState: createMockMemento(),
    secrets: createMockSecretStorage(),
    extensionUri: Uri.parse('file:///mock/extension'),
    extensionPath: '/mock/extension',
    storagePath: '/mock/storage',
    globalStoragePath: '/mock/global-storage',
    logPath: '/mock/log',
    extensionMode: 1, // Production
    extension: {
      id: 'mock.extension',
      extensionUri: Uri.parse('file:///mock/extension'),
      extensionPath: '/mock/extension',
      isActive: true,
      packageJSON: {},
      extensionKind: 1,
      exports: undefined,
      activate: vi.fn(),
    },
    environmentVariableCollection: {
      persistent: false,
      description: undefined,
      replace: vi.fn(),
      append: vi.fn(),
      prepend: vi.fn(),
      get: vi.fn(),
      forEach: vi.fn(),
      delete: vi.fn(),
      clear: vi.fn(),
      getScoped: vi.fn(),
      [Symbol.iterator]: vi.fn(),
    },
    asAbsolutePath: vi.fn((path: string) => `/mock/extension/${path}`),
    storageUri: Uri.parse('file:///mock/storage'),
    globalStorageUri: Uri.parse('file:///mock/global-storage'),
    logUri: Uri.parse('file:///mock/log'),
    languageModelAccessInformation: {
      onDidChange: vi.fn(() => ({ dispose: vi.fn() })),
      canSendRequest: vi.fn(),
    },
  };
}

// Export all as default vscode module
export default {
  LogLevel,
  ProgressLocation,
  ConfigurationTarget,
  StatusBarAlignment,
  TreeItemCollapsibleState,
  ViewColumn,
  TreeItem,
  ThemeIcon,
  EventEmitter,
  Uri,
  RelativePattern,
  Position,
  Range,
  Selection,
  Disposable,
  window,
  commands,
  workspace,
  env,
  l10n,
};
