/**
 * @packageDocumentation
 * `createVSCodeMock(framework)` builds a full in-memory replacement for the
 * `vscode` module, for use with `vi.mock('vscode', () => createVSCodeMock(vi))`
 * (or the Jest equivalent). It also exports every individual builder
 * (`createMockQuickPick`, `createMockFileSystemWatcher`, ...) as a named
 * export, for tests that want a standalone fixture without going through
 * `vi.mock` at all — e.g. to override a single `window.createTreeView()`
 * call with a listener-capturing instance for one test.
 *
 * This module never imports `vscode` at runtime — only `import type` — and
 * never imports a test framework. Every mock function is created through
 * the injected {@link MockFrameworkLike}, so the whole module is unusable
 * without a framework argument but has zero hard dependency on which one.
 */
import type * as vscode from 'vscode';
import type { MockFrameworkLike } from './types.js';

// ================================================================
// Enums (plain objects — `erasableSyntaxOnly` forbids real `enum`)
// ================================================================

export const LogLevel = {
  Off: 0,
  Trace: 1,
  Debug: 2,
  Info: 3,
  Warning: 4,
  Error: 5,
} as const;

export const ProgressLocation = {
  SourceControl: 1,
  Window: 10,
  Notification: 15,
} as const;

export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
} as const;

export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const;

export const TreeItemCheckboxState = {
  Unchecked: 0,
  Checked: 1,
} as const;

export const QuickPickItemKind = {
  Separator: -1,
  Default: 0,
} as const;

export const QuickInputButtons = {
  Back: { iconPath: { id: 'arrow-left' }, tooltip: 'Back' },
} as const;

export const QuickInputButtonLocation = {
  Title: 1,
  Inline: 2,
  Input: 3,
} as const;

export const LanguageStatusSeverity = {
  Information: 0,
  Warning: 1,
  Error: 2,
} as const;

// `Four`..`Nine` included for parity with the real `vscode.ViewColumn` enum.
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

// ================================================================
// Value classes (no framework dependency — plain logic, no mock functions)
// ================================================================

export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];

  event = (listener: (e: T) => void): vscode.Disposable => {
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

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class ThemeIcon {
  constructor(
    public readonly id: string,
    public readonly color?: vscode.ThemeColor
  ) {}
}

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

  isBeforeOrEqual(other: Position): boolean {
    return this.isBefore(other) || this.isEqual(other);
  }

  isAfterOrEqual(other: Position): boolean {
    return this.isAfter(other) || this.isEqual(other);
  }

  compareTo(other: Position): number {
    if (this.isBefore(other)) return -1;
    if (this.isAfter(other)) return 1;
    return 0;
  }

  translate(lineDelta?: number, characterDelta?: number): Position;
  translate(change: { lineDelta?: number; characterDelta?: number }): Position;
  translate(
    lineDeltaOrChange?: number | { lineDelta?: number; characterDelta?: number },
    characterDelta?: number
  ): Position {
    if (typeof lineDeltaOrChange === 'object') {
      return new Position(
        this.line + (lineDeltaOrChange.lineDelta ?? 0),
        this.character + (lineDeltaOrChange.characterDelta ?? 0)
      );
    }
    return new Position(
      this.line + (lineDeltaOrChange ?? 0),
      this.character + (characterDelta ?? 0)
    );
  }

  with(line?: number, character?: number): Position;
  with(change: { line?: number; character?: number }): Position;
  with(
    lineOrChange?: number | { line?: number; character?: number },
    character?: number
  ): Position {
    if (typeof lineOrChange === 'object') {
      return new Position(lineOrChange.line ?? this.line, lineOrChange.character ?? this.character);
    }
    return new Position(lineOrChange ?? this.line, character ?? this.character);
  }
}

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

  intersection(range: Range): Range | undefined {
    const start = this.start.isAfter(range.start) ? this.start : range.start;
    const end = this.end.isBefore(range.end) ? this.end : range.end;
    if (start.isAfter(end)) return undefined;
    return new Range(start, end);
  }

  union(other: Range): Range {
    const start = this.start.isBefore(other.start) ? this.start : other.start;
    const end = this.end.isAfter(other.end) ? this.end : other.end;
    return new Range(start, end);
  }

  with(start?: Position, end?: Position): Range;
  with(change: { start?: Position; end?: Position }): Range;
  with(startOrChange?: Position | { start?: Position; end?: Position }, end?: Position): Range {
    if (startOrChange && !(startOrChange instanceof Position)) {
      return new Range(startOrChange.start ?? this.start, startOrChange.end ?? this.end);
    }
    return new Range(startOrChange ?? this.start, end ?? this.end);
  }
}

export class Selection extends Range {
  readonly anchor: Position;
  readonly active: Position;

  constructor(anchor: Position, active: Position);
  constructor(
    anchorLine: number,
    anchorCharacter: number,
    activeLine: number,
    activeCharacter: number
  );
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

export class RelativePattern {
  constructor(
    public readonly base: { fsPath: string } | string,
    public readonly pattern: string
  ) {}
}

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

export class MarkdownString {
  isTrusted?: boolean;
  supportThemeIcons?: boolean;
  supportHtml?: boolean;

  constructor(public value: string = '') {}

  appendText(text: string): MarkdownString {
    this.value += text;
    return this;
  }

  appendMarkdown(text: string): MarkdownString {
    this.value += text;
    return this;
  }
}

export class DataTransferItem {
  constructor(public readonly value: unknown) {}

  asString(): Promise<string> {
    return Promise.resolve(
      typeof this.value === 'string' ? this.value : JSON.stringify(this.value)
    );
  }

  asFile(): undefined {
    return undefined;
  }
}

export class DataTransfer {
  private readonly items = new Map<string, DataTransferItem>();

  get(mimeType: string): DataTransferItem | undefined {
    return this.items.get(mimeType);
  }

  set(mimeType: string, value: DataTransferItem): void {
    this.items.set(mimeType, value);
  }

  forEach(callback: (item: DataTransferItem, mimeType: string) => void): void {
    this.items.forEach(callback);
  }

  *[Symbol.iterator](): IterableIterator<[string, DataTransferItem]> {
    yield* this.items;
  }
}

/** `name` is `'Canceled'`, matching the real API. */
export class CancellationError extends Error {
  constructor() {
    super('Canceled');
    this.name = 'Canceled';
  }
}

/**
 * Entries are keyed by `uri.toString()` so tests can inspect what was
 * recorded for a given file after a call such as `applyWorkspaceEdits`.
 */
export interface MockWorkspaceEditEntry {
  range: Range;
  newText: string;
  metadata?: unknown;
}

export class WorkspaceEdit {
  private readonly _entries = new Map<string, MockWorkspaceEditEntry[]>();

  replace(uri: { toString(): string }, range: Range, newText: string, metadata?: unknown): void {
    const key = uri.toString();
    const list = this._entries.get(key) ?? [];
    list.push({ range, newText, metadata });
    this._entries.set(key, list);
  }

  insert(
    uri: { toString(): string },
    position: Position,
    newText: string,
    metadata?: unknown
  ): void {
    this.replace(uri, new Range(position, position), newText, metadata);
  }

  delete(uri: { toString(): string }, range: Range, metadata?: unknown): void {
    this.replace(uri, range, '', metadata);
  }

  has(uri: { toString(): string }): boolean {
    return this._entries.has(uri.toString());
  }

  get size(): number {
    return this._entries.size;
  }

  /** Test hook: inspect the recorded entries for a uri. */
  _getEntries(uri: { toString(): string }): MockWorkspaceEditEntry[] {
    return this._entries.get(uri.toString()) ?? [];
  }
}

// ================================================================
// Uri
// ================================================================

/**
 * Creates a mock `vscode.Uri` namespace (`parse`/`file`/`joinPath`).
 *
 * The real `vscode.Uri` is a class with a private constructor, so the
 * plain objects returned here can never be nominally identical to it;
 * callers pass them into library code the same way the rest of this kit's
 * fixtures are passed in (through a `never`/`unknown` cast at the call
 * site, exactly as they would for a real `vscode.Uri` obtained from a real
 * extension host).
 */
export function createMockUri(framework: MockFrameworkLike) {
  const { fn } = framework;
  return {
    parse: fn((path: string) => ({
      fsPath: path,
      path,
      scheme: 'file',
      toString: () => path,
    })),
    file: fn((path: string) => ({
      fsPath: path,
      path,
      scheme: 'file',
      toString: () => path,
    })),
    joinPath: fn((uri: { path: string }, ...segments: string[]) => {
      const newPath = [uri.path, ...segments].join('/').replace(/\/+/g, '/');
      return {
        fsPath: newPath,
        path: newPath,
        scheme: 'file',
        toString: () => newPath,
      };
    }),
  };
}

// ================================================================
// Output channels / status bar
// ================================================================

export function createMockLogOutputChannel(framework: MockFrameworkLike, name: string) {
  const { fn } = framework;
  return {
    name,
    logLevel: LogLevel.Info,
    onDidChangeLogLevel: fn(),
    trace: fn(),
    debug: fn(),
    info: fn(),
    warn: fn(),
    error: fn(),
    append: fn(),
    appendLine: fn(),
    clear: fn(),
    show: fn(),
    hide: fn(),
    dispose: fn(),
    replace: fn(),
  };
}

export function createMockOutputChannel(framework: MockFrameworkLike, name: string) {
  const { fn } = framework;
  return {
    name,
    append: fn(),
    appendLine: fn(),
    clear: fn(),
    show: fn(),
    hide: fn(),
    dispose: fn(),
    replace: fn(),
  };
}

export function createMockStatusBarItem(framework: MockFrameworkLike) {
  const { fn } = framework;
  return {
    id: '',
    alignment: StatusBarAlignment.Left,
    priority: undefined as number | undefined,
    name: undefined as string | undefined,
    text: '',
    tooltip: undefined as string | vscode.MarkdownString | undefined,
    color: undefined as string | vscode.ThemeColor | undefined,
    backgroundColor: undefined as vscode.ThemeColor | undefined,
    command: undefined as string | vscode.Command | undefined,
    accessibilityInformation: undefined as vscode.AccessibilityInformation | undefined,
    show: fn(),
    hide: fn(),
    dispose: fn(),
  };
}

// ================================================================
// FileSystemWatcher
// ================================================================

export function createMockFileSystemWatcher(framework: MockFrameworkLike) {
  const { fn } = framework;
  const createEventEmitter = () => {
    const listeners: ((uri: unknown) => void)[] = [];
    return {
      fire: (uri: unknown) => listeners.forEach((l) => l(uri)),
      event: fn((listener: (uri: unknown) => void) => {
        listeners.push(listener);
        return { dispose: fn(() => listeners.splice(listeners.indexOf(listener), 1)) };
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
    /** Test hook: simulates a native file-create event. */
    _fireCreate: onDidCreate.fire,
    /** Test hook: simulates a native file-change event. */
    _fireChange: onDidChange.fire,
    /** Test hook: simulates a native file-delete event. */
    _fireDelete: onDidDelete.fire,
    dispose: fn(),
  };
}

// ================================================================
// TreeView
// ================================================================

export function createMockTreeView<T = unknown>(framework: MockFrameworkLike) {
  const { fn } = framework;
  const checkboxListeners: ((e: { items: readonly (readonly [T, number])[] }) => void)[] = [];

  return {
    onDidExpandElement: fn(() => ({ dispose: fn() })),
    onDidCollapseElement: fn(() => ({ dispose: fn() })),
    onDidChangeSelection: fn(() => ({ dispose: fn() })),
    onDidChangeVisibility: fn(() => ({ dispose: fn() })),
    onDidChangeCheckboxState: fn(
      (listener: (e: { items: readonly (readonly [T, number])[] }) => void) => {
        checkboxListeners.push(listener);
        return {
          dispose: fn(() => checkboxListeners.splice(checkboxListeners.indexOf(listener), 1)),
        };
      }
    ),
    selection: [] as T[],
    visible: true,
    title: undefined as string | undefined,
    description: undefined as string | undefined,
    message: undefined as string | undefined,
    badge: undefined as { readonly tooltip: string; readonly value: number } | undefined,
    reveal: fn().mockResolvedValue(undefined),
    dispose: fn(),
    /** Test hook: simulates the user checking/unchecking boxes in the UI. */
    _fireCheckboxState: (items: readonly (readonly [T, number])[]) => {
      checkboxListeners.forEach((l) => l({ items }));
    },
  };
}

// ================================================================
// Webview / WebviewPanel / WebviewView
// ================================================================

export function createMockWebview(framework: MockFrameworkLike) {
  const { fn } = framework;
  const messageListeners: ((message: unknown) => void)[] = [];

  return {
    html: '',
    options: {},
    cspSource: 'https://mock.csp.source',
    asWebviewUri: fn((uri: { toString: () => string }) => ({
      toString: () => `vscode-webview://mock/${uri.toString()}`,
      fsPath: uri.toString(),
      scheme: 'vscode-webview',
    })),
    onDidReceiveMessage: fn((listener: (message: unknown) => void) => {
      messageListeners.push(listener);
      return { dispose: fn(() => messageListeners.splice(messageListeners.indexOf(listener), 1)) };
    }),
    postMessage: fn().mockResolvedValue(true),
    /** Test hook: simulates the webview content posting `message` back to the extension host. */
    _fireMessage: (message: unknown) => {
      messageListeners.forEach((l) => l(message));
    },
  };
}

export function createMockWebviewPanel(
  framework: MockFrameworkLike,
  viewType: string = 'test',
  title: string = 'Test'
) {
  const { fn } = framework;
  const webview = createMockWebview(framework);
  const viewStateListeners: ((e: { webviewPanel: { visible: boolean } }) => void)[] = [];
  const disposeListeners: (() => void)[] = [];

  return {
    viewType,
    title,
    webview,
    options: {},
    viewColumn: ViewColumn.One as number,
    active: true,
    visible: true,
    onDidChangeViewState: fn((listener: (e: { webviewPanel: { visible: boolean } }) => void) => {
      viewStateListeners.push(listener);
      return {
        dispose: fn(() => viewStateListeners.splice(viewStateListeners.indexOf(listener), 1)),
      };
    }),
    onDidDispose: fn((listener: () => void) => {
      disposeListeners.push(listener);
      return { dispose: fn(() => disposeListeners.splice(disposeListeners.indexOf(listener), 1)) };
    }),
    reveal: fn(),
    dispose: fn(),
    /** Test hook: simulates the panel gaining/losing focus or visibility. */
    _fireViewStateChange: (visible: boolean) => {
      viewStateListeners.forEach((l) => l({ webviewPanel: { visible } }));
    },
    /** Test hook: simulates the user closing the panel's tab. */
    _fireDispose: () => {
      disposeListeners.forEach((l) => l());
    },
  };
}

export function createMockWebviewView(framework: MockFrameworkLike, viewType: string = 'test') {
  const { fn } = framework;
  const webview = createMockWebview(framework);
  const visibilityListeners: (() => void)[] = [];
  const disposeListeners: (() => void)[] = [];

  return {
    viewType,
    webview,
    title: undefined as string | undefined,
    description: undefined as string | undefined,
    badge: undefined as { readonly tooltip: string; readonly value: number } | undefined,
    visible: true,
    onDidChangeVisibility: fn((listener: () => void) => {
      visibilityListeners.push(listener);
      return {
        dispose: fn(() => visibilityListeners.splice(visibilityListeners.indexOf(listener), 1)),
      };
    }),
    onDidDispose: fn((listener: () => void) => {
      disposeListeners.push(listener);
      return { dispose: fn(() => disposeListeners.splice(disposeListeners.indexOf(listener), 1)) };
    }),
    show: fn(),
    /** Test hook: simulates the view becoming visible/hidden (sidebar switch, panel collapse, ...). */
    _fireVisibilityChange: () => {
      visibilityListeners.forEach((l) => l());
    },
    /** Test hook: simulates VS Code disposing the view (e.g. the container closes). */
    _fireDispose: () => {
      disposeListeners.forEach((l) => l());
    },
  };
}

/** No framework needed — this is a plain data holder, not a spy. */
export function createMockWebviewViewResolveContext<T = unknown>(
  state?: T
): { state: T | undefined } {
  return { state };
}

// ================================================================
// QuickPick / InputBox
// ================================================================

export function createMockQuickPick<T extends { label: string }>(framework: MockFrameworkLike) {
  const { fn } = framework;
  let items: T[] = [];
  let selectedItems: T[] = [];
  const onDidAcceptListeners: (() => void)[] = [];
  const onDidTriggerButtonListeners: ((button: unknown) => void)[] = [];
  const onDidTriggerItemButtonListeners: ((e: unknown) => void)[] = [];
  const onDidHideListeners: (() => void)[] = [];
  const onDidChangeValueListeners: ((value: string) => void)[] = [];
  let visible = false;

  /** Mirrors `ExtHostQuickInput._fireDidHide`: only a shown, not-yet-hidden input fires. */
  const fireHide = (): void => {
    if (!visible) return;
    visible = false;
    onDidHideListeners.forEach((l) => l());
  };

  return {
    title: '',
    placeholder: '',
    prompt: undefined as string | undefined,
    canSelectMany: false,
    step: undefined as number | undefined,
    totalSteps: undefined as number | undefined,
    busy: false,
    ignoreFocusOut: false,
    value: '',
    activeItems: [] as T[],
    matchOnDescription: false,
    matchOnDetail: false,
    onDidChangeValue: fn((listener: (value: string) => void) => {
      onDidChangeValueListeners.push(listener);
      return { dispose: fn() };
    }),
    onDidTriggerItemButton: fn((listener: (e: unknown) => void) => {
      onDidTriggerItemButtonListeners.push(listener);
      return { dispose: fn() };
    }),
    /** Test hook: simulates the user typing into the filter box. */
    _setValue: (v: string) => {
      onDidChangeValueListeners.forEach((l) => l(v));
    },
    /** Test hook: simulates clicking a per-item button. */
    _triggerItemButton: (e: unknown) => {
      onDidTriggerItemButtonListeners.forEach((l) => l(e));
    },
    get items() {
      return items;
    },
    set items(value: T[]) {
      items = value;
    },
    get selectedItems() {
      return selectedItems;
    },
    set selectedItems(value: T[]) {
      selectedItems = value;
    },
    buttons: [] as unknown[],
    onDidAccept: fn((listener: () => void) => {
      onDidAcceptListeners.push(listener);
      return { dispose: fn() };
    }),
    onDidTriggerButton: fn((listener: (button: unknown) => void) => {
      onDidTriggerButtonListeners.push(listener);
      return { dispose: fn() };
    }),
    onDidHide: fn((listener: () => void) => {
      onDidHideListeners.push(listener);
      return { dispose: fn() };
    }),
    show: fn(() => {
      visible = true;
    }),
    // `hide()` and `dispose()` both fire `onDidHide` on a *visible* quick input
    // in real VS Code (`ExtHostQuickInput.dispose` calls `_fireDidHide`). Code
    // that disposes on its way out therefore re-enters its own hide handler —
    // a mock that stayed silent here would hide that whole class of bug.
    hide: fn(() => {
      fireHide();
    }),
    dispose: fn(() => {
      fireHide();
    }),
    /** Test hook: simulates the user accepting the current selection. */
    _accept: (selection?: T[]) => {
      if (selection) selectedItems = selection;
      onDidAcceptListeners.forEach((l) => l());
    },
    /** Test hook: simulates clicking a title-bar button (e.g. the back button). */
    _triggerButton: (button: unknown) => {
      onDidTriggerButtonListeners.forEach((l) => l(button));
    },
    /** Test hook: simulates the QuickPick being dismissed (Escape, focus loss, ...). */
    _hide: () => {
      visible = true;
      fireHide();
    },
  };
}

export function createMockInputBox(framework: MockFrameworkLike) {
  const { fn } = framework;
  let value = '';
  const onDidAcceptListeners: (() => void)[] = [];
  const onDidTriggerButtonListeners: ((button: unknown) => void)[] = [];
  const onDidHideListeners: (() => void)[] = [];
  const onDidChangeValueListeners: ((value: string) => void)[] = [];
  let visible = false;

  /** Mirrors `ExtHostQuickInput._fireDidHide`: only a shown, not-yet-hidden input fires. */
  const fireHide = (): void => {
    if (!visible) return;
    visible = false;
    onDidHideListeners.forEach((l) => l());
  };

  return {
    title: '',
    prompt: '',
    placeholder: '',
    password: false,
    step: undefined as number | undefined,
    totalSteps: undefined as number | undefined,
    busy: false,
    ignoreFocusOut: false,
    valueSelection: undefined as readonly [number, number] | undefined,
    get value() {
      return value;
    },
    set value(v: string) {
      value = v;
    },
    validationMessage: undefined as string | undefined,
    buttons: [] as unknown[],
    onDidAccept: fn((listener: () => void) => {
      onDidAcceptListeners.push(listener);
      return { dispose: fn() };
    }),
    onDidTriggerButton: fn((listener: (button: unknown) => void) => {
      onDidTriggerButtonListeners.push(listener);
      return { dispose: fn() };
    }),
    onDidHide: fn((listener: () => void) => {
      onDidHideListeners.push(listener);
      return { dispose: fn() };
    }),
    onDidChangeValue: fn((listener: (value: string) => void) => {
      onDidChangeValueListeners.push(listener);
      return { dispose: fn() };
    }),
    show: fn(() => {
      visible = true;
    }),
    // See the note on `createMockQuickPick`: disposing a visible quick input
    // fires `onDidHide` in real VS Code.
    hide: fn(() => {
      fireHide();
    }),
    dispose: fn(() => {
      fireHide();
    }),
    /** Test hook: simulates the user typing into the input box. */
    _setValue: (v: string) => {
      value = v;
      onDidChangeValueListeners.forEach((l) => l(v));
    },
    /** Test hook: simulates the user pressing Enter. */
    _accept: () => {
      onDidAcceptListeners.forEach((l) => l());
    },
    /** Test hook: simulates clicking a title-bar button (e.g. the back button). */
    _triggerButton: (button: unknown) => {
      onDidTriggerButtonListeners.forEach((l) => l(button));
    },
    /** Test hook: simulates the input box being dismissed. */
    _hide: () => {
      visible = true;
      fireHide();
    },
  };
}

// ================================================================
// CancellationToken
// ================================================================

export function createMockCancellationToken(
  framework: MockFrameworkLike,
  isCancellationRequested: boolean = false
) {
  const { fn } = framework;
  return {
    isCancellationRequested,
    onCancellationRequested: fn(() => ({ dispose: fn() })),
  };
}

// ================================================================
// Memento / SecretStorage / WorkspaceConfiguration
// ================================================================

export function createMockMemento(framework: MockFrameworkLike) {
  const { fn } = framework;
  const storage = new Map<string, unknown>();
  return {
    keys: (): string[] => [...storage.keys()],
    get<T>(key: string, defaultValue?: T): T | undefined {
      return storage.has(key) ? (storage.get(key) as T) : defaultValue;
    },
    update: fn((key: string, value: unknown): Thenable<void> => {
      if (value === undefined) {
        storage.delete(key);
      } else {
        storage.set(key, value);
      }
      return Promise.resolve();
    }),
    /** Present on both `workspaceState` and `globalState`; only the latter is part of the real API. */
    setKeysForSync: fn(),
    /** Test hook: the backing map, for asserting on stored state directly. */
    _storage: storage,
  };
}

export function createMockSecretStorage(framework: MockFrameworkLike) {
  const { fn } = framework;
  const secrets = new Map<string, string>();
  return {
    keys: fn((): Thenable<string[]> => Promise.resolve([...secrets.keys()])),
    get: fn((key: string): Thenable<string | undefined> => Promise.resolve(secrets.get(key))),
    store: fn((key: string, value: string): Thenable<void> => {
      secrets.set(key, value);
      return Promise.resolve();
    }),
    delete: fn((key: string): Thenable<void> => {
      secrets.delete(key);
      return Promise.resolve();
    }),
    onDidChange: fn(() => ({ dispose: fn() })),
    /** Test hook: the backing map, for asserting on stored secrets directly. */
    _secrets: secrets,
  };
}

export function createMockWorkspaceConfiguration(framework: MockFrameworkLike) {
  const { fn } = framework;
  return {
    get: fn((_key: string, defaultValue?: unknown) => defaultValue),
    has: fn(() => false),
    inspect: fn(),
    update: fn().mockResolvedValue(undefined),
  };
}

// ================================================================
// TextDocument / TextEditor
// ================================================================

export interface MockTextLine {
  lineNumber: number;
  text: string;
  range: Range;
  rangeIncludingLineBreak: Range;
  firstNonWhitespaceCharacterIndex: number;
  isEmptyOrWhitespace: boolean;
}

export function createMockTextDocument(
  framework: MockFrameworkLike,
  content: string = '',
  languageId: string = 'plaintext'
) {
  const { fn } = framework;
  const lines = content.split('\n');
  return {
    uri: createMockUri(framework).file('/mock/document.txt'),
    fileName: '/mock/document.txt',
    isUntitled: false,
    languageId,
    version: 1,
    isDirty: false,
    isClosed: false,
    eol: 1, // LF
    lineCount: lines.length,
    getText: fn((range?: Range) => {
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
    lineAt: fn((lineOrPosition: number | Position): MockTextLine => {
      const lineNumber = typeof lineOrPosition === 'number' ? lineOrPosition : lineOrPosition.line;
      const text = lines[lineNumber] || '';
      return {
        lineNumber,
        text,
        range: new Range(lineNumber, 0, lineNumber, text.length),
        rangeIncludingLineBreak: new Range(lineNumber, 0, lineNumber + 1, 0),
        firstNonWhitespaceCharacterIndex:
          text.search(/\S/) === -1 ? text.length : text.search(/\S/),
        isEmptyOrWhitespace: text.trim().length === 0,
      };
    }),
    offsetAt: fn((position: Position) => {
      let offset = 0;
      for (let i = 0; i < position.line; i++) {
        offset += (lines[i]?.length || 0) + 1;
      }
      return offset + position.character;
    }),
    positionAt: fn((offset: number) => {
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
    getWordRangeAtPosition: fn((position: Position, regex?: RegExp) => {
      const line = lines[position.line] || '';
      // Force the `g` flag so `.exec()` advances through the line instead of
      // matching the same spot forever when a caller passes a bare pattern
      // (e.g. `/[\w-]+/` to treat kebab-case as one word).
      const wordPattern = regex
        ? new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`)
        : /\w+/g;
      let match;
      while ((match = wordPattern.exec(line)) !== null) {
        if (
          match.index <= position.character &&
          match.index + match[0].length >= position.character
        ) {
          return new Range(
            position.line,
            match.index,
            position.line,
            match.index + match[0].length
          );
        }
        if (match[0].length === 0) {
          wordPattern.lastIndex++;
        }
      }
      return undefined;
    }),
    validatePosition: fn((position: Position) => position),
    validateRange: fn((range: Range) => range),
    save: fn().mockResolvedValue(true),
    /** Test hook: the raw content this document was built from. */
    _content: content,
    /** Test hook: the content split into lines. */
    _lines: lines,
  };
}

export function createMockTextEditor(
  framework: MockFrameworkLike,
  content: string = '',
  languageId: string = 'plaintext'
) {
  const { fn } = framework;
  const document = createMockTextDocument(framework, content, languageId);
  let selection = new Selection(0, 0, 0, 0);
  let selections = [selection];

  return {
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
    viewColumn: ViewColumn.One as number,
    edit: fn(
      async (
        callback: (editBuilder: {
          replace: (range: Range, text: string) => void;
          insert: (position: Position, text: string) => void;
          delete: (range: Range) => void;
        }) => void,
        // Accepted (and recorded via the mock's own `.mock.calls`) but not
        // otherwise interpreted — tests assert on undoStopBefore/After by
        // reading the call args directly.
        _options?: { undoStopBefore: boolean; undoStopAfter: boolean }
      ) => {
        const operations: { type: string; range?: Range; position?: Position; text?: string }[] =
          [];
        const editBuilder = {
          replace: (range: Range, text: string) =>
            operations.push({ type: 'replace', range, text }),
          insert: (position: Position, text: string) =>
            operations.push({ type: 'insert', position, text }),
          delete: (range: Range) => operations.push({ type: 'delete', range }),
        };
        callback(editBuilder);
        return true;
      }
    ),
    insertSnippet: fn().mockResolvedValue(true),
    setDecorations: fn(),
    revealRange: fn(),
    show: fn(),
    hide: fn(),
  };
}

// ================================================================
// window / commands / workspace / languages / env / l10n namespaces
// ================================================================

function createMockWindowNamespace(framework: MockFrameworkLike) {
  const { fn } = framework;
  return {
    createOutputChannel: fn((name: string, options?: { log: true }) => {
      if (options?.log) {
        return createMockLogOutputChannel(framework, name);
      }
      return createMockOutputChannel(framework, name);
    }),
    createStatusBarItem: fn(
      (_idOrAlignment?: string | number, _alignmentOrPriority?: number, _priority?: number) =>
        createMockStatusBarItem(framework)
    ),
    createTreeView: fn((_viewId: string, _options: unknown) => createMockTreeView(framework)),
    createWebviewPanel: fn(
      (viewType: string, title: string, _column?: unknown, _options?: unknown) =>
        createMockWebviewPanel(framework, viewType, title)
    ),
    createQuickPick: fn(() => createMockQuickPick(framework)),
    createInputBox: fn(() => createMockInputBox(framework)),
    showInformationMessage: fn().mockResolvedValue(undefined),
    showWarningMessage: fn().mockResolvedValue(undefined),
    showErrorMessage: fn().mockResolvedValue(undefined),
    showQuickPick: fn().mockResolvedValue(undefined),
    showInputBox: fn().mockResolvedValue(undefined),
    registerWebviewViewProvider: fn(() => ({ dispose: fn() })),
    registerWebviewPanelSerializer: fn(() => ({ dispose: fn() })),
    withProgress: fn(
      async (
        _options: unknown,
        task: (progress: unknown, token: unknown) => Promise<unknown>
      ): Promise<unknown> => {
        const progress = { report: fn() };
        const token = {
          isCancellationRequested: false,
          onCancellationRequested: fn(() => ({ dispose: fn() })),
        };
        return task(progress, token);
      }
    ),
    // `undefined`/`[]` by default, mirroring a freshly started extension host
    // with nothing focused. Plain mutable fields — not getters, not
    // `readonly` — so a test can assign `vscode.window.activeTextEditor =
    // myEditor` directly instead of recomposing the whole `window` namespace.
    activeTextEditor: undefined as vscode.TextEditor | undefined,
    visibleTextEditors: [] as vscode.TextEditor[],
    onDidChangeActiveTextEditor: fn(() => ({ dispose: fn() })),
    onDidChangeTextEditorSelection: fn(() => ({ dispose: fn() })),
    /**
     * Returns a fresh {@link createMockTextEditor} fixture. When `document`
     * looks like a mock `TextDocument` (has `getText`), it's threaded through
     * so `result.document` is the same object the caller passed in, matching
     * the real API's identity guarantee.
     */
    showTextDocument: fn((document?: unknown) => {
      const editor = createMockTextEditor(framework);
      if (typeof document === 'object' && document !== null && 'getText' in document) {
        editor.document = document as typeof editor.document;
      }
      return Promise.resolve(editor);
    }),
  };
}

function createMockCommandsNamespace(framework: MockFrameworkLike) {
  const { fn } = framework;
  return {
    registerCommand: fn((_commandId: string, callback: (...args: unknown[]) => unknown) => ({
      dispose: fn(),
      /** Test hook: the handler passed to `registerCommand`, so tests can invoke it directly. */
      _callback: callback,
    })),
    registerTextEditorCommand: fn(
      (
        _commandId: string,
        callback: (editor: unknown, edit: unknown, ...args: unknown[]) => unknown
      ) => ({
        dispose: fn(),
        /** Test hook: the handler passed to `registerTextEditorCommand`. */
        _callback: callback,
      })
    ),
    executeCommand: fn().mockResolvedValue(undefined),
  };
}

function createMockWorkspaceNamespace(framework: MockFrameworkLike) {
  const { fn } = framework;
  return {
    getConfiguration: fn((_section?: string) => createMockWorkspaceConfiguration(framework)),
    onDidChangeConfiguration: fn(() => ({ dispose: fn() })),
    createFileSystemWatcher: fn((_pattern: unknown) => createMockFileSystemWatcher(framework)),
    fs: {
      readFile: fn().mockResolvedValue(new Uint8Array()),
    },
    /** Used by `applyWorkspaceEdits`/`applyEditsGrouped` (`src/workspace/editor.ts`). */
    applyEdit: fn().mockResolvedValue(true),
    // `undefined` by default (mirrors an extension host with no folder
    // open). A plain mutable field — not a getter, not `readonly` — so a
    // test can assign `vscode.workspace.workspaceFolders = [...]` directly
    // instead of recomposing the whole `workspace` namespace.
    workspaceFolders: undefined as vscode.WorkspaceFolder[] | undefined,
    getWorkspaceFolder: fn((_uri: vscode.Uri) => undefined as vscode.WorkspaceFolder | undefined),
    /** Simplified: returns `pathOrUri` itself for a string, or `.fsPath` for a Uri. */
    asRelativePath: fn(
      (pathOrUri: string | vscode.Uri, _includeWorkspaceFolder?: boolean): string =>
        typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath
    ),
    /** Honors `{ language, content }` options; otherwise an empty plaintext document. */
    openTextDocument: fn((uriOrOptions?: unknown) => {
      if (
        typeof uriOrOptions === 'object' &&
        uriOrOptions !== null &&
        ('content' in uriOrOptions || 'language' in uriOrOptions)
      ) {
        const { language, content } = uriOrOptions as { language?: string; content?: string };
        return Promise.resolve(
          createMockTextDocument(framework, content ?? '', language ?? 'plaintext')
        );
      }
      return Promise.resolve(createMockTextDocument(framework));
    }),
    onDidChangeTextDocument: fn(() => ({ dispose: fn() })),
    onDidSaveTextDocument: fn(() => ({ dispose: fn() })),
  };
}

function createMockLanguagesNamespace(framework: MockFrameworkLike) {
  const { fn } = framework;
  return {
    createLanguageStatusItem: fn(() => ({
      id: '',
      name: undefined as string | undefined,
      selector: undefined,
      severity: LanguageStatusSeverity.Information as number,
      text: '',
      detail: undefined as string | undefined,
      busy: false,
      command: undefined,
      accessibilityInformation: undefined,
      dispose: fn(),
    })),
  };
}

function createMockEnvNamespace(framework: MockFrameworkLike) {
  const { fn } = framework;
  return {
    language: 'en',
    clipboard: {
      readText: fn().mockResolvedValue(''),
      writeText: fn().mockResolvedValue(undefined),
    },
    createTelemetryLogger: fn(() => ({
      logUsage: fn(),
      logError: fn(),
      dispose: fn(),
      onDidChangeEnableStates: fn(() => ({ dispose: fn() })),
      isUsageEnabled: true,
      isErrorsEnabled: true,
    })),
  };
}

function createMockL10nNamespace(framework: MockFrameworkLike) {
  const { fn } = framework;
  return {
    t: fn((message: string, ..._args: unknown[]) => message),
    bundle: undefined,
    uri: undefined,
  };
}

// ================================================================
// createVSCodeMock
// ================================================================

/**
 * Builds a full replacement for the `vscode` module: every enum, value
 * class (`Position`, `Range`, `Uri`, `EventEmitter`, ...) and namespace
 * (`window`, `commands`, `workspace`, `languages`, `env`, `l10n`) that this
 * library's own test suite — and typical VS Code extensions — touch.
 *
 * Pass the result straight to `vi.mock`'s factory (or the Jest
 * equivalent). Individual builders (`createMockQuickPick`,
 * `createMockFileSystemWatcher`, ...) are also exported for tests that
 * want a standalone fixture, e.g. to override a single
 * `window.createTreeView()` call with a listener-capturing instance.
 *
 * `vscode.env` and `vscode.l10n` are implemented (unlike some generic
 * `vscode` mocks) since this library's own `l10n` module depends on them.
 *
 * Extension-authoring state that VS Code itself only lets the host set
 * (`window.activeTextEditor`, `window.visibleTextEditors`,
 * `workspace.workspaceFolders`) is exposed as plain, directly-assignable
 * fields here — a test sets `vscode.window.activeTextEditor = myEditor`
 * instead of recomposing the whole namespace.
 *
 * @example
 * ```ts
 * import { vi } from 'vitest';
 * import { createVSCodeMock } from '@kkdev92/vscode-ext-kit/testing';
 *
 * vi.mock('vscode', () => createVSCodeMock(vi));
 * ```
 */
export function createVSCodeMock(framework: MockFrameworkLike) {
  return {
    LogLevel,
    ProgressLocation,
    ConfigurationTarget,
    StatusBarAlignment,
    TreeItemCollapsibleState,
    TreeItemCheckboxState,
    QuickPickItemKind,
    QuickInputButtons,
    QuickInputButtonLocation,
    LanguageStatusSeverity,
    ViewColumn,
    EventEmitter,
    TreeItem,
    ThemeIcon,
    ThemeColor,
    MarkdownString,
    DataTransfer,
    DataTransferItem,
    CancellationError,
    Position,
    Range,
    Selection,
    RelativePattern,
    Uri: createMockUri(framework),
    Disposable,
    WorkspaceEdit,
    window: createMockWindowNamespace(framework),
    commands: createMockCommandsNamespace(framework),
    workspace: createMockWorkspaceNamespace(framework),
    languages: createMockLanguagesNamespace(framework),
    env: createMockEnvNamespace(framework),
    l10n: createMockL10nNamespace(framework),
  };
}
