/**
 * @packageDocumentation
 * `createVSCodeMock(framework)` builds a partial in-memory replacement for the
 * `vscode` module, for use with `vi.mock('vscode', () => createVSCodeMock(vi))`
 * (or the Jest equivalent). It also exports every individual builder
 * (`createMockQuickPick`, `createMockFileSystemWatcher`, ...) as a named
 * export, for tests that want a standalone fixture without going through
 * `vi.mock` at all — e.g. to override a single `window.createTreeView()`
 * call with a listener-capturing instance for one test.
 *
 * This module never imports `vscode` at runtime — only `import type` — and
 * never imports a test framework. Every mock function is created through
 * the injected {@link MockFrameworkLike}, so the whole module has zero hard
 * dependency on a particular runner.
 *
 * Scope and non-guarantees:
 *
 * - Builders implement the members documented beside them and the observable
 *   behavior pinned by this package's contract tests. This is not the complete
 *   VS Code API; an unimplemented member is intentionally absent rather than a
 *   permissive no-op.
 * - Value classes reproduce the range/event/URI semantics framework code relies
 *   on, not every constructor overload or internal validation performed by VS
 *   Code.
 * - Namespace mocks favor explicit, scriptable state and recorded calls. They
 *   do not provide a workbench, extension scheduling, persistence, filesystem,
 *   browser sandbox or renderer.
 *
 * Prefer `createTestHost` for framework modules. Use this lower-level mock for
 * direct `vscode` imports, and keep an Extension Host test for behavior where
 * VS Code itself—not the extension's translation code—is the subject.
 */
import type * as vscode from 'vscode';
import type { MockFrameworkLike } from './mock-types.js';

// ================================================================
// Enums (plain objects — `erasableSyntaxOnly` forbids real `enum`)
// ================================================================

/** Numeric values needed by log-channel code; no filtering is performed. */
export const LogLevel = {
  Off: 0,
  Trace: 1,
  Debug: 2,
  Info: 3,
  Warning: 4,
  Error: 5,
} as const;

/** Stable `ProgressLocation` values used to assert adapter mapping. */
export const ProgressLocation = {
  SourceControl: 1,
  Window: 10,
  Notification: 15,
} as const;

/** Stable configuration target values; persistence is not emulated. */
export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;

/** Stable status-bar alignment values used by item factories. */
export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
} as const;

/** Stable tree collapsibility values; no tree is rendered. */
export const TreeItemCollapsibleState = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const;

/** Stable checkbox values used by synthetic tree events. */
export const TreeItemCheckboxState = {
  Unchecked: 0,
  Checked: 1,
} as const;

/** Quick-pick item kinds used in structural item fixtures. */
export const QuickPickItemKind = {
  Separator: -1,
  Default: 0,
} as const;

/** Shared back-button identity used by quick-input navigation tests. */
export const QuickInputButtons = {
  Back: { iconPath: { id: 'arrow-left' }, tooltip: 'Back' },
} as const;

/** Quick-input button locations; rendering is outside the mock's scope. */
export const QuickInputButtonLocation = {
  Title: 1,
  Inline: 2,
  Input: 3,
} as const;

/** Stable language-status severities for adapter translation tests. */
export const LanguageStatusSeverity = {
  Information: 0,
  Warning: 1,
  Error: 2,
} as const;

/** Theme-kind values plus a scriptable active-theme namespace. */
export const ColorThemeKind = {
  Light: 1,
  Dark: 2,
  HighContrast: 3,
  HighContrastLight: 4,
} as const;

/** Reveal modes for call-shape assertions; there is no viewport to reveal. */
export const TextEditorRevealType = {
  Default: 0,
  InCenter: 1,
  InCenterIfOutsideViewport: 2,
  AtTop: 3,
} as const;

/** Host UI kind read by runtime preflight; no host is actually launched. */
export const UIKind = {
  Desktop: 1,
  Web: 2,
} as const;

/**
 * Editor-column values accepted by panel/editor call-shape tests. Columns have
 * no layout behavior in this mock.
 */
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

/** Splices one listener out of a mock's listener array; backs the subscriptions' dispose(). */
function removeFrom<L>(listeners: L[], listener: L): void {
  const index = listeners.indexOf(listener);
  if (index >= 0) {
    listeners.splice(index, 1);
  }
}

/**
 * Synchronous event emitter with snapshot delivery and idempotent listener
 * removal—the event semantics this kit explicitly contract-tests.
 * It omits VS Code's optional `thisArgs`/disposable-bucket overloads.
 */
export class EventEmitter<T> {
  private listeners: ((e: T) => void)[] = [];

  event = (listener: (e: T) => void): vscode.Disposable => {
    this.listeners.push(listener);
    // Through removeFrom, so a second dispose (or one after the emitter was
    // disposed) is a no-op instead of splicing at index -1 and evicting an
    // unrelated listener.
    return { dispose: () => removeFrom(this.listeners, listener) };
  };

  fire(data: T): void {
    // Deliver to a snapshot, as the real Emitter does: a listener disposing
    // itself (or another) mid-fire must not make this fire skip anyone.
    [...this.listeners].forEach((l) => l(data));
  }

  dispose(): void {
    this.listeners = [];
  }
}

/**
 * Mutable data holder for adapter tests. It is not a workbench tree row and
 * performs no icon, command, accessibility or checkbox validation.
 */
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

/** Opaque theme-color id; theme resolution is not emulated. */
export class ThemeColor {
  readonly id: string;
  constructor(id: string) {
    this.id = id;
  }
}

/** Opaque icon id/color pair; icon availability is not validated. */
export class ThemeIcon {
  readonly id: string;
  readonly color: vscode.ThemeColor | undefined;
  constructor(id: string, color?: vscode.ThemeColor) {
    this.id = id;
    this.color = color;
  }
}

/**
 * Immutable line/character value with the comparison and transformation
 * operations used by editor code. Document-bound validation is out of scope.
 */
export class Position {
  readonly line: number;
  readonly character: number;
  constructor(line: number, character: number) {
    this.line = line;
    this.character = character;
  }

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

/**
 * Normalizing range value. Constructor reversal, containment, intersection and
 * union mirror the semantics pinned by the value-class tests; document clamping
 * is intentionally left to a document fixture.
 */
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
    let start: Position;
    let end: Position;
    if (typeof startOrStartLine === 'number') {
      start = new Position(startOrStartLine, endOrStartCharacter as number);
      end = new Position(endLine!, endCharacter!);
    } else {
      start = startOrStartLine;
      end = endOrStartCharacter as Position;
    }
    // The real Range guarantees start <= end and swaps when handed a
    // reversed pair — which is also what makes a reversed Selection expose
    // its `active` (earlier) position as `start`. Without this, contains()/
    // intersection()/getText(range) behave differently in tests than in the
    // extension host.
    if (start.isAfter(end)) {
      [start, end] = [end, start];
    }
    this.start = start;
    this.end = end;
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

/** Range with preserved anchor/active direction and normalized start/end. */
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

/** Plain base/pattern holder; matching is performed by watcher fakes elsewhere. */
export class RelativePattern {
  readonly base: { fsPath: string } | string;
  readonly pattern: string;
  constructor(base: { fsPath: string } | string, pattern: string) {
    this.base = base;
    this.pattern = pattern;
  }
}

/**
 * Minimal disposable wrapper. `from` preserves input order; it does not collect
 * or aggregate exceptions from multiple disposals.
 */
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

/**
 * Mutable markdown accumulator for call/data assertions. Trust, command links,
 * URI escaping and renderer sanitization are not interpreted by this mock.
 */
export class MarkdownString {
  isTrusted?: boolean;
  supportThemeIcons?: boolean;
  supportHtml?: boolean;

  value: string;

  constructor(value: string = '') {
    this.value = value;
  }

  appendText(text: string): MarkdownString {
    this.value += text;
    return this;
  }

  appendMarkdown(text: string): MarkdownString {
    this.value += text;
    return this;
  }
}

/** In-memory drag payload with string conversion; file payloads are unsupported. */
export class DataTransferItem {
  readonly value: unknown;
  constructor(value: unknown) {
    this.value = value;
  }

  asString(): Promise<string> {
    return Promise.resolve(
      typeof this.value === 'string' ? this.value : JSON.stringify(this.value)
    );
  }

  asFile(): undefined {
    return undefined;
  }
}

/** MIME-keyed drag payload map; no workbench drag session is created. */
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

/** Cancellation-shaped error for classification tests; no token throws it automatically. */
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

/**
 * Recording workspace edit. It groups text replacements by URI but never reads
 * or mutates documents; inspect `_getEntries` or the `workspace.applyEdit` call.
 */
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
 * Creates the URI namespace subset used by this kit (`parse`, `file`,
 * `joinPath`). Returned values preserve scheme/path/toString facts needed by
 * adapters; they do not implement authority, query, fragment, `with`, JSON
 * serialization or platform-specific `fsPath` normalization.
 *
 * VS Code's URI is nominal, while this fixture returns structural plain data.
 * Tests should assert on the documented fields/string conversion, not
 * `instanceof` or class identity. Cast only at the fixture boundary when a
 * function signature requires the nominal `vscode.Uri` type.
 */
export function createMockUri(framework: MockFrameworkLike) {
  const { fn } = framework;
  return {
    parse: fn((value: string) => {
      // Preserve the distinction adapters rely on: `untitled:Untitled-1` has an
      // `untitled` scheme, while a bare test path gets the fixture's `file`
      // default. This is not a complete RFC URI parser.
      const match = /^([A-Za-z][A-Za-z0-9+.-]*):(.*)$/.exec(value);
      const scheme = match?.[1] ?? 'file';
      const path = (match?.[2] ?? value).replace(/^\/\//, '');
      return {
        fsPath: path,
        path,
        scheme,
        toString: () => value,
      };
    }),
    file: fn((path: string) => ({
      fsPath: path,
      path,
      scheme: 'file',
      toString: () => path,
    })),
    joinPath: fn((uri: { path: string; scheme?: string }, ...segments: string[]) => {
      // The real Uri.joinPath resolves '.' and '..' segments (posix join
      // semantics) — watchFile() relies on `joinPath(uri, '..')` producing
      // the parent directory, so a mock that merely concatenated would let
      // tests pass against paths the host never produces.
      const parts: string[] = [];
      for (const part of [uri.path, ...segments].join('/').split('/')) {
        if (part === '' || part === '.') continue;
        if (part === '..') {
          parts.pop();
          continue;
        }
        parts.push(part);
      }
      const newPath = `/${parts.join('/')}`;
      return {
        fsPath: newPath,
        path: newPath,
        scheme: uri.scheme ?? 'file',
        toString: () => newPath,
      };
    }),
  };
}

// ================================================================
// Output channels / status bar
// ================================================================

/**
 * Creates a spy-only log output channel. Calls and levels are observable, but
 * messages are not rendered, filtered or persisted and `dispose` is not a state
 * machine unless the test overrides it.
 */
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

/** Creates a spy-only plain output channel; it stores no output buffer. */
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

/**
 * Creates a mutable status-bar item shape with spy lifecycle methods. Property
 * assignment is observable; visibility, ordering and theme rendering are not.
 */
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

/**
 * Creates an event-capable watcher fixture. `_fire*` delivers synthetic URIs and
 * subscriptions detach correctly; glob selection, ignore flags and a real file
 * system are not applied here (use the higher-level port fake for filtering).
 */
export function createMockFileSystemWatcher(framework: MockFrameworkLike) {
  const { fn } = framework;
  const createEventEmitter = () => {
    const listeners: ((uri: unknown) => void)[] = [];
    return {
      fire: (uri: unknown) => [...listeners].forEach((l) => l(uri)),
      event: fn((listener: (uri: unknown) => void) => {
        listeners.push(listener);
        return { dispose: fn(() => removeFrom(listeners, listener)) };
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

/**
 * Creates a scriptable native tree-view shape. It records state and fires view
 * events, but does not invoke a `TreeDataProvider`, render elements, or implement
 * reveal/selection policy on the workbench's behalf.
 */
export function createMockTreeView<T = unknown>(framework: MockFrameworkLike) {
  const { fn } = framework;
  const checkboxListeners: ((e: { items: readonly (readonly [T, number])[] }) => void)[] = [];
  // Every event keeps its listeners, so a subscription can be disposed and a
  // test hook can fire it. The four expansion/selection/visibility events used
  // to accept a listener, drop it on the floor and hand back a dispose that did
  // nothing -- unfireable *and* untestable for leaks.
  const expandListeners: ((e: { element: T }) => void)[] = [];
  const collapseListeners: ((e: { element: T }) => void)[] = [];
  const selectionListeners: ((e: { selection: readonly T[] }) => void)[] = [];
  const visibilityListeners: ((e: { visible: boolean }) => void)[] = [];

  const view = {
    onDidExpandElement: fn((listener: (e: { element: T }) => void) => {
      expandListeners.push(listener);
      return { dispose: fn(() => removeFrom(expandListeners, listener)) };
    }),
    onDidCollapseElement: fn((listener: (e: { element: T }) => void) => {
      collapseListeners.push(listener);
      return { dispose: fn(() => removeFrom(collapseListeners, listener)) };
    }),
    onDidChangeSelection: fn((listener: (e: { selection: readonly T[] }) => void) => {
      selectionListeners.push(listener);
      return { dispose: fn(() => removeFrom(selectionListeners, listener)) };
    }),
    onDidChangeVisibility: fn((listener: (e: { visible: boolean }) => void) => {
      visibilityListeners.push(listener);
      return { dispose: fn(() => removeFrom(visibilityListeners, listener)) };
    }),
    onDidChangeCheckboxState: fn(
      (listener: (e: { items: readonly (readonly [T, number])[] }) => void) => {
        checkboxListeners.push(listener);
        return {
          dispose: fn(() => removeFrom(checkboxListeners, listener)),
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
      [...checkboxListeners].forEach((l) => l({ items }));
    },
    /** Test hook: simulates the user expanding a node. */
    _fireExpandElement: (element: T) => {
      [...expandListeners].forEach((l) => l({ element }));
    },
    /** Test hook: simulates the user collapsing a node. */
    _fireCollapseElement: (element: T) => {
      [...collapseListeners].forEach((l) => l({ element }));
    },
    /** Test hook: simulates the user selecting nodes; also updates `selection`. */
    _fireSelectionChange: (selection: readonly T[]) => {
      view.selection = [...selection];
      [...selectionListeners].forEach((l) => l({ selection }));
    },
    /** Test hook: simulates the view becoming visible/hidden; also updates `visible`. */
    _fireVisibilityChange: (visible: boolean) => {
      view.visible = visible;
      [...visibilityListeners].forEach((l) => l({ visible }));
    },
  };
  return view;
}

// ================================================================
// Webview / WebviewPanel / WebviewView
// ================================================================

/**
 * Creates the extension-host half of a webview. HTML and options are mutable,
 * messages are recordable/fireable, and URIs get recognizable mock text. No
 * browser executes the HTML and no CSP or origin boundary is enforced.
 */
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
      return { dispose: fn(() => removeFrom(messageListeners, listener)) };
    }),
    postMessage: fn().mockResolvedValue(true),
    /** Test hook: simulates the webview content posting `message` back to the extension host. */
    _fireMessage: (message: unknown) => {
      [...messageListeners].forEach((l) => l(message));
    },
  };
}

/**
 * Creates a panel around a mock webview with fireable state/disposal events.
 * Calling the `dispose` spy alone does not synthesize disposal; use
 * `_fireDispose` when the code under test must observe the native event.
 */
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
        dispose: fn(() => removeFrom(viewStateListeners, listener)),
      };
    }),
    onDidDispose: fn((listener: () => void) => {
      disposeListeners.push(listener);
      return { dispose: fn(() => removeFrom(disposeListeners, listener)) };
    }),
    reveal: fn(),
    dispose: fn(),
    /** Test hook: simulates the panel gaining/losing focus or visibility. */
    _fireViewStateChange: (visible: boolean) => {
      [...viewStateListeners].forEach((l) => l({ webviewPanel: { visible } }));
    },
    /** Test hook: simulates the user closing the panel's tab. */
    _fireDispose: () => {
      [...disposeListeners].forEach((l) => l());
    },
  };
}

/**
 * Creates a contributed view surface with fireable visibility/disposal events.
 * Provider registration/resolution scheduling is left to the namespace mock or
 * an adapter-specific fixture.
 */
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
        dispose: fn(() => removeFrom(visibilityListeners, listener)),
      };
    }),
    onDidDispose: fn((listener: () => void) => {
      disposeListeners.push(listener);
      return { dispose: fn(() => removeFrom(disposeListeners, listener)) };
    }),
    show: fn(),
    /** Test hook: simulates the view becoming visible/hidden (sidebar switch, panel collapse, ...). */
    _fireVisibilityChange: () => {
      [...visibilityListeners].forEach((l) => l());
    },
    /** Test hook: simulates VS Code disposing the view (e.g. the container closes). */
    _fireDispose: () => {
      [...disposeListeners].forEach((l) => l());
    },
  };
}

/**
 * Creates only the saved-state portion of a resolve context. Cancellation and
 * platform restoration timing must be supplied by a more specific fixture.
 */
export function createMockWebviewViewResolveContext<T = unknown>(
  state?: T
): { state: T | undefined } {
  return { state };
}

// ================================================================
// QuickPick / InputBox
// ================================================================

/**
 * Creates a scriptable QuickPick-shaped object with event subscription removal
 * and the same synchronous hide/dispose model as the higher-level fake. It does
 * not filter/rank items, validate selection rules, or model focus and keyboard
 * behavior. Exact Extension Host event scheduling is outside this mock.
 */
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

  /** Emits at most once for each shown interval; hiding an already-hidden input is silent. */
  const fireHide = (): void => {
    if (!visible) return;
    visible = false;
    [...onDidHideListeners].forEach((l) => l());
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
      return { dispose: fn(() => removeFrom(onDidChangeValueListeners, listener)) };
    }),
    onDidTriggerItemButton: fn((listener: (e: unknown) => void) => {
      onDidTriggerItemButtonListeners.push(listener);
      return { dispose: fn(() => removeFrom(onDidTriggerItemButtonListeners, listener)) };
    }),
    /** Test hook: simulates the user typing into the filter box. */
    _setValue: (v: string) => {
      [...onDidChangeValueListeners].forEach((l) => l(v));
    },
    /** Test hook: simulates clicking a per-item button. */
    _triggerItemButton: (e: unknown) => {
      [...onDidTriggerItemButtonListeners].forEach((l) => l(e));
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
      return { dispose: fn(() => removeFrom(onDidAcceptListeners, listener)) };
    }),
    onDidTriggerButton: fn((listener: (button: unknown) => void) => {
      onDidTriggerButtonListeners.push(listener);
      return { dispose: fn(() => removeFrom(onDidTriggerButtonListeners, listener)) };
    }),
    onDidHide: fn((listener: () => void) => {
      onDidHideListeners.push(listener);
      return { dispose: fn(() => removeFrom(onDidHideListeners, listener)) };
    }),
    show: fn(() => {
      visible = true;
    }),
    // This mock synchronously notifies hide listeners when either path ends a
    // visible input. Keeping that modeled edge catches re-entrant cleanup bugs;
    // it is not evidence about undocumented Extension Host scheduling.
    hide: fn(() => {
      fireHide();
    }),
    dispose: fn(() => {
      fireHide();
    }),
    /** Test hook: simulates the user accepting the current selection. */
    _accept: (selection?: T[]) => {
      if (selection) selectedItems = selection;
      [...onDidAcceptListeners].forEach((l) => l());
    },
    /** Test hook: simulates clicking a title-bar button (e.g. the back button). */
    _triggerButton: (button: unknown) => {
      [...onDidTriggerButtonListeners].forEach((l) => l(button));
    },
    /** Test hook: simulates the QuickPick being dismissed (Escape, focus loss, ...). */
    _hide: () => {
      visible = true;
      fireHide();
    },
  };
}

/**
 * Creates a scriptable InputBox-shaped object with value/accept/hide/button
 * events. Validation display, focus and workbench rendering are not emulated.
 */
export function createMockInputBox(framework: MockFrameworkLike) {
  const { fn } = framework;
  let value = '';
  const onDidAcceptListeners: (() => void)[] = [];
  const onDidTriggerButtonListeners: ((button: unknown) => void)[] = [];
  const onDidHideListeners: (() => void)[] = [];
  const onDidChangeValueListeners: ((value: string) => void)[] = [];
  let visible = false;

  /** Emits at most once for each shown interval; hiding an already-hidden input is silent. */
  const fireHide = (): void => {
    if (!visible) return;
    visible = false;
    [...onDidHideListeners].forEach((l) => l());
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
      return { dispose: fn(() => removeFrom(onDidAcceptListeners, listener)) };
    }),
    onDidTriggerButton: fn((listener: (button: unknown) => void) => {
      onDidTriggerButtonListeners.push(listener);
      return { dispose: fn(() => removeFrom(onDidTriggerButtonListeners, listener)) };
    }),
    onDidHide: fn((listener: () => void) => {
      onDidHideListeners.push(listener);
      return { dispose: fn(() => removeFrom(onDidHideListeners, listener)) };
    }),
    onDidChangeValue: fn((listener: (value: string) => void) => {
      onDidChangeValueListeners.push(listener);
      return { dispose: fn(() => removeFrom(onDidChangeValueListeners, listener)) };
    }),
    show: fn(() => {
      visible = true;
    }),
    // See the note on `createMockQuickPick`: the low-level builders intentionally
    // share one deterministic hide/dispose model.
    hide: fn(() => {
      fireHide();
    }),
    dispose: fn(() => {
      fireHide();
    }),
    /** Test hook: simulates the user typing into the input box. */
    _setValue: (v: string) => {
      value = v;
      [...onDidChangeValueListeners].forEach((l) => l(v));
    },
    /** Test hook: simulates the user pressing Enter. */
    _accept: () => {
      [...onDidAcceptListeners].forEach((l) => l());
    },
    /** Test hook: simulates clicking a title-bar button (e.g. the back button). */
    _triggerButton: (button: unknown) => {
      [...onDidTriggerButtonListeners].forEach((l) => l(button));
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

/**
 * Creates a static cancellation-token shape. It does not transition or fire an
 * event after construction; use a capability fake or a dedicated token source
 * when code must react to cancellation over time.
 */
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

/**
 * Creates an in-memory Memento with get/update/delete-by-undefined semantics.
 * There is no persistence or cross-window propagation; `_storage` is exposed as
 * a test hook.
 */
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

/**
 * Creates in-memory secret storage. Values are deliberately inspectable and are
 * not encrypted. Store/delete do not fire `onDidChange` in this low-level
 * fixture; use the port fake when change-event behavior is under test.
 */
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

/**
 * Creates a spy-first `WorkspaceConfiguration`: `get` returns its supplied
 * default and `update` resolves. It does not resolve scopes/tiers or retain
 * values; use `createFakeSettings` for configuration semantics.
 */
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

/** Plain line snapshot returned by {@link createMockTextDocument}. */
export interface MockTextLine {
  lineNumber: number;
  text: string;
  range: Range;
  rangeIncludingLineBreak: Range;
  firstNonWhitespaceCharacterIndex: number;
  isEmptyOrWhitespace: boolean;
}

/**
 * Creates an immutable LF-oriented text-document fixture with common range/
 * offset/word queries. It does not mutate after edits, track versions/dirty
 * state, validate bounds like the Extension Host, or fully model CRLF/CR files.
 */
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

/**
 * Creates a text-editor fixture around {@link createMockTextDocument}. Edit
 * callbacks are executed and spy calls are recorded, but operations are not
 * applied to document content and there is no selection/viewport rendering.
 */
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
      (
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
        return Promise.resolve(true);
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

/**
 * Assembles the scriptable `window` subset. Factory-shaped members return
 * standalone fixtures, while host-owned state is deliberately mutable so a
 * test can arrange it without replacing the namespace object.
 */
function createMockWindowNamespace(framework: MockFrameworkLike) {
  const { fn } = framework;
  // Backs `activeColorTheme` / `onDidChangeActiveColorTheme` / `_setColorTheme`
  // so a test can flip the theme and have listeners actually fire, the same way
  // `_fireChange` works on the standalone fixtures.
  const colorThemeEmitter = new EventEmitter<vscode.ColorTheme>();
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
    /**
     * `Dark` by default. A plain mutable field, so a test can assign it
     * directly — use `_setColorTheme` instead when listeners registered
     * through `onDidChangeActiveColorTheme` also need to fire.
     */
    activeColorTheme: { kind: ColorThemeKind.Dark } as vscode.ColorTheme,
    onDidChangeActiveColorTheme: fn((listener: (theme: vscode.ColorTheme) => void) =>
      colorThemeEmitter.event(listener)
    ),
    /**
     * Test hook: switches the active theme and notifies
     * `onDidChangeActiveColorTheme` listeners, as VS Code does when the user
     * picks a different theme.
     */
    _setColorTheme(kind: (typeof ColorThemeKind)[keyof typeof ColorThemeKind]): void {
      const theme = { kind } as vscode.ColorTheme;
      this.activeColorTheme = theme;
      colorThemeEmitter.fire(theme);
    },
    // `undefined` (the user cancelled) by default: a dialog that silently
    // returned a path would make a test pass for the wrong reason. Set a
    // return value explicitly with `mockResolvedValue([Uri.file('/x')])`.
    showOpenDialog: fn().mockResolvedValue(undefined),
    showSaveDialog: fn().mockResolvedValue(undefined),
  };
}

/** Command registry with duplicate protection, disposal and executable handlers. */
function createMockCommandsNamespace(
  framework: MockFrameworkLike,
  activeEditor: () => vscode.TextEditor | undefined
) {
  const { fn } = framework;
  // A real registry, so `executeCommand` reaches a handler that
  // `registerCommand` put there. Without it an extension's own commands are
  // unreachable through the API it registered them with, and the only way to
  // invoke one is to reach into `_callback`.
  const handlers = new Map<string, (...args: unknown[]) => unknown>();

  return {
    registerCommand: fn((commandId: string, callback: (...args: unknown[]) => unknown) => {
      if (handlers.has(commandId)) {
        // VS Code rejects a second registration of the same id, and one id
        // namespace covers plain and text editor commands alike.
        throw new Error(`command '${commandId}' already exists`);
      }
      handlers.set(commandId, callback);
      return {
        dispose: fn(() => {
          handlers.delete(commandId);
        }),
        /** Test hook: the handler passed to `registerCommand`, so tests can invoke it directly. */
        _callback: callback,
      };
    }),
    registerTextEditorCommand: fn(
      (
        commandId: string,
        callback: (editor: unknown, edit: unknown, ...args: unknown[]) => unknown
      ) => {
        if (handlers.has(commandId)) {
          throw new Error(`command '${commandId}' already exists`);
        }
        // Invoked with the focused editor, so the registry entry supplies
        // whatever `window.activeTextEditor` currently is rather than making
        // the caller pass one.
        handlers.set(commandId, (...args: unknown[]) =>
          callback(activeEditor(), { replace: fn(), insert: fn(), delete: fn() }, ...args)
        );
        return {
          dispose: fn(() => {
            handlers.delete(commandId);
          }),
          /** Test hook: the handler passed to `registerTextEditorCommand`. */
          _callback: callback,
        };
      }
    ),
    /**
     * Dispatches to a registered handler, and rejects for an unknown id.
     *
     * `setContext` is the exception, and the only one. It is a VS Code built-in
     * that no extension registers, so rejecting it would be the mock lying
     * about the platform — and an extension mirroring a setting into a `when`
     * clause is a common enough shape that every one of them would have to work
     * around it. Other built-ins are left rejecting on purpose: they have
     * effects a mock cannot stand in for, and silently resolving `undefined`
     * would hide a test that never did what it claimed. The call is still
     * recorded, so `mock.calls` is how a test asserts the key was published.
     */
    executeCommand: fn(async (commandId: string, ...args: unknown[]): Promise<unknown> => {
      const handler = handlers.get(commandId);
      if (handler === undefined) {
        if (commandId === 'setContext') {
          return undefined;
        }
        throw new Error(`command '${commandId}' not found`);
      }
      return await handler(...args);
    }),
  };
}

/**
 * Assembles the workspace subset used by the kit. File reads and edits are
 * spies/default promises, not a virtual filesystem; focused fakes provide
 * higher-fidelity settings/watcher behavior.
 */
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
    // Trusted by default, matching an ordinary local folder. Assign `false` to
    // exercise a restricted workspace.
    isTrusted: true,
    // The other half of the trust API, and the half an extension that supports
    // untrusted workspaces needs. Granting trust restarts the extension host
    // only when some extension's *enablement* changes — and an extension that
    // declared `untrustedWorkspaces.supported` was already enabled, so its own
    // enablement does not change. It is restarted only incidentally, if some
    // other installed extension flips, which it cannot count on. This event is
    // the one guaranteed signal.
    //
    // Like `onDidChangeConfiguration` above, the listener is recovered from
    // `mock.calls` and invoked by the test — assigning `isTrusted = true` first
    // is what makes the callback see a trusted workspace.
    onDidGrantWorkspaceTrust: fn((_listener: () => void) => ({ dispose: fn() })),
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

/**
 * Language APIs: the one the framework models, plus the provider registrations
 * an extension most often reaches past it for.
 *
 * The registrations are spies that hand back a disposable and nothing else —
 * no document is ever passed to the provider here. They exist because an
 * application containing a managed raw registration is bound by `createTestHost`
 * like any other, so a missing `registerXxx` stops the whole host from starting,
 * with a failure that says nothing about the test that hit it. What a test can
 * check is that the registration happened and was released; whether the provider
 * returns the right thing belongs in an Extension Host test.
 */
function createMockLanguagesNamespace(framework: MockFrameworkLike) {
  const { fn } = framework;
  const registration = (): { dispose: unknown } => ({ dispose: fn() });
  return {
    createLanguageStatusItem: fn(() => ({
      id: '',
      name: undefined as string | undefined,
      selector: undefined,
      severity: LanguageStatusSeverity.Information,
      text: '',
      detail: undefined as string | undefined,
      busy: false,
      command: undefined,
      accessibilityInformation: undefined,
      dispose: fn(),
    })),
    registerHoverProvider: fn(registration),
    registerCompletionItemProvider: fn(registration),
    registerCodeLensProvider: fn(registration),
    registerDefinitionProvider: fn(registration),
    registerDocumentFormattingEditProvider: fn(registration),
    registerCodeActionsProvider: fn(registration),
    createDiagnosticCollection: fn((name?: string) => ({
      name: name ?? '',
      set: fn(),
      delete: fn(),
      clear: fn(),
      dispose: fn(),
    })),
  };
}

/**
 * Creates mutable environment facts and spy clipboard/telemetry surfaces. No
 * OS clipboard, consent flow or telemetry transport exists behind the spies.
 */
function createMockEnvNamespace(framework: MockFrameworkLike) {
  const { fn } = framework;
  return {
    language: 'en',
    // Plain mutable fields, so a test exercising a web-only or remote code
    // path assigns them instead of recomposing the namespace. The framework
    // reads both at activation, so an extension built on it cannot start
    // without them.
    uiKind: UIKind.Desktop as (typeof UIKind)[keyof typeof UIKind],
    remoteName: undefined as string | undefined,
    appHost: 'desktop',
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

/**
 * `vscode.extensions`, which an extension reads to learn its own version or to
 * check whether another one is installed.
 *
 * `all` is a plain mutable array — push an entry to make `getExtension` find
 * it, the same way a test assigns `workspace.workspaceFolders`. Empty by
 * default, which is the honest answer: the mock does not know what is
 * installed until a test says so.
 */
function createMockExtensionsNamespace(framework: MockFrameworkLike) {
  const { fn } = framework;
  const all: vscode.Extension<unknown>[] = [];
  return {
    all,
    getExtension: fn((extensionId: string): vscode.Extension<unknown> | undefined =>
      all.find((candidate) => candidate.id === extensionId)
    ),
    onDidChange: fn(() => ({ dispose: fn() })),
  };
}

/**
 * Creates a source-string passthrough translator. Bundle lookup, comments,
 * object-overload parsing and locale fallback belong to the localization port
 * fake or an Extension Host test.
 */
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
 * Builds the documented partial replacement for the `vscode` module: the value
 * classes and namespaces exported below, with their focused semantics.
 *
 * Pass the result straight to `vi.mock`'s factory (or the Jest
 * equivalent). Individual builders (`createMockQuickPick`,
 * `createMockFileSystemWatcher`, ...) are also exported for tests that
 * want a standalone fixture, e.g. to override a single
 * `window.createTreeView()` call with a listener-capturing instance.
 *
 * Unsupported API members are absent on purpose. Add a focused builder plus
 * contract tests when this package begins to depend on another member; do not
 * add a catch-all proxy returning no-op functions, because that lets misspelled
 * and unsupported APIs pass tests silently.
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
  // Built first: a text editor command is dispatched against whatever
  // `window.activeTextEditor` is at the time, so the command registry needs to
  // be able to read it.
  const window = createMockWindowNamespace(framework);

  return {
    /**
     * A plausible `vscode.version` baseline, pinned by the mock's tests. It is
     * fixture data—not a claim about the editor running the test. Assign the
     * exact version a scenario requires instead of branching on this default.
     */
    version: '1.125.0',
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
    UIKind,
    ColorThemeKind,
    TextEditorRevealType,
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
    window,
    commands: createMockCommandsNamespace(framework, () => window.activeTextEditor),
    workspace: createMockWorkspaceNamespace(framework),
    languages: createMockLanguagesNamespace(framework),
    env: createMockEnvNamespace(framework),
    extensions: createMockExtensionsNamespace(framework),
    l10n: createMockL10nNamespace(framework),
  };
}
