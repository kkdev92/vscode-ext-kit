import { vi } from 'vitest';

// Mock vscode module globally
vi.mock('vscode', () => {
  const createMockLogOutputChannel = (name: string) => ({
    name,
    logLevel: 3,
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
  });

  const createMockStatusBarItem = () => ({
    id: '',
    alignment: 1,
    priority: undefined,
    name: undefined,
    text: '',
    tooltip: undefined,
    color: undefined,
    backgroundColor: undefined,
    command: undefined,
    accessibilityInformation: undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  });

  const createMockFileSystemWatcher = () => {
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
  };

  const createMockTreeView = () => ({
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
  });

  const createMockWebview = () => ({
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
  });

  const createMockWebviewPanel = (viewType: string = 'test', title: string = 'Test') => {
    const webview = createMockWebview();
    return {
      viewType,
      title,
      webview,
      options: {},
      viewColumn: 1,
      active: true,
      visible: true,
      onDidChangeViewState: vi.fn(() => ({ dispose: vi.fn() })),
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
      reveal: vi.fn(),
      dispose: vi.fn(),
    };
  };

  const createMockQuickPick = <T extends { label: string }>() => {
    let items: T[] = [];
    let selectedItems: T[] = [];
    const onDidAcceptListeners: (() => void)[] = [];
    const onDidTriggerButtonListeners: ((button: unknown) => void)[] = [];
    const onDidHideListeners: (() => void)[] = [];

    return {
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
  };

  const createMockInputBox = () => {
    let value = '';
    const onDidAcceptListeners: (() => void)[] = [];
    const onDidTriggerButtonListeners: ((button: unknown) => void)[] = [];
    const onDidHideListeners: (() => void)[] = [];
    const onDidChangeValueListeners: ((value: string) => void)[] = [];

    return {
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
  };

  // EventEmitter class
  class EventEmitter<T> {
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

  // TreeItem class
  class TreeItem {
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
      this.collapsibleState = collapsibleState ?? 0;
    }
  }

  // ThemeIcon class
  class ThemeIcon {
    constructor(
      public readonly id: string,
      public readonly color?: unknown
    ) {}
  }

  // ThemeColor class
  class ThemeColor {
    constructor(public readonly id: string) {}
  }

  // Position class
  class Position {
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
  }

  // Range class
  class Range {
    readonly start: Position;
    readonly end: Position;
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
  }

  // Selection class
  class Selection extends Range {
    readonly anchor: Position;
    readonly active: Position;
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
  }

  // RelativePattern class
  class RelativePattern {
    constructor(
      public readonly base: { fsPath: string } | string,
      public readonly pattern: string
    ) {}
  }

  // Uri mock
  const Uri = {
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

  // Disposable class
  class Disposable {
    private _callOnDispose: () => void;
    constructor(callOnDispose: () => void) {
      this._callOnDispose = callOnDispose;
    }
    dispose(): void {
      this._callOnDispose();
    }
    static from(...disposables: { dispose(): void }[]) {
      return new Disposable(() => {
        disposables.forEach((d) => d.dispose());
      });
    }
  }

  return {
    LogLevel: {
      Off: 0,
      Trace: 1,
      Debug: 2,
      Info: 3,
      Warning: 4,
      Error: 5,
    },
    ProgressLocation: {
      SourceControl: 1,
      Window: 10,
      Notification: 15,
    },
    ConfigurationTarget: {
      Global: 1,
      Workspace: 2,
      WorkspaceFolder: 3,
    },
    StatusBarAlignment: {
      Left: 1,
      Right: 2,
    },
    TreeItemCollapsibleState: {
      None: 0,
      Collapsed: 1,
      Expanded: 2,
    },
    ViewColumn: {
      Active: -1,
      Beside: -2,
      One: 1,
      Two: 2,
      Three: 3,
    },
    EventEmitter,
    TreeItem,
    ThemeIcon,
    ThemeColor,
    Position,
    Range,
    Selection,
    RelativePattern,
    Uri,
    Disposable,
    window: {
      createOutputChannel: vi.fn((name: string, _options?: { log: true }) => {
        return createMockLogOutputChannel(name);
      }),
      createStatusBarItem: vi.fn(() => createMockStatusBarItem()),
      createTreeView: vi.fn(() => createMockTreeView()),
      createWebviewPanel: vi.fn((viewType, title) => createMockWebviewPanel(viewType, title)),
      createQuickPick: vi.fn(() => createMockQuickPick()),
      createInputBox: vi.fn(() => createMockInputBox()),
      showInformationMessage: vi.fn().mockResolvedValue(undefined),
      showWarningMessage: vi.fn().mockResolvedValue(undefined),
      showErrorMessage: vi.fn().mockResolvedValue(undefined),
      showQuickPick: vi.fn().mockResolvedValue(undefined),
      showInputBox: vi.fn().mockResolvedValue(undefined),
      withProgress: vi
        .fn()
        .mockImplementation(
          async (
            _options: unknown,
            task: (progress: unknown, token: unknown) => Promise<unknown>
          ) => {
            const progress = { report: vi.fn() };
            const token = {
              isCancellationRequested: false,
              onCancellationRequested: vi.fn(() => ({ dispose: vi.fn() })),
            };
            return task(progress, token);
          }
        ),
    },
    commands: {
      registerCommand: vi.fn((_commandId: string, callback: (...args: unknown[]) => unknown) => ({
        dispose: vi.fn(),
        _callback: callback,
      })),
      registerTextEditorCommand: vi.fn(
        (
          _commandId: string,
          callback: (editor: unknown, edit: unknown, ...args: unknown[]) => unknown
        ) => ({
          dispose: vi.fn(),
          _callback: callback,
        })
      ),
      executeCommand: vi.fn().mockResolvedValue(undefined),
    },
    workspace: {
      getConfiguration: vi.fn((_section?: string) => ({
        get: vi.fn((_key: string, defaultValue?: unknown) => defaultValue),
        has: vi.fn(() => false),
        inspect: vi.fn(),
        update: vi.fn().mockResolvedValue(undefined),
      })),
      onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
      createFileSystemWatcher: vi.fn(() => createMockFileSystemWatcher()),
    },
    env: {
      language: 'en',
    },
    l10n: {
      t: vi.fn((message: string, ..._args: unknown[]) => message),
      bundle: undefined,
      uri: undefined,
    },
  };
});
