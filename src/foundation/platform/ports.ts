/**
 * Anything the platform hands back that must be released synchronously.
 * Structurally compatible with `vscode.Disposable`, without depending on the
 * `vscode` module. Owners ignore the return value from `dispose`.
 */
export interface PlatformRegistration {
  dispose(): unknown;
}

/**
 * The command surface the framework needs.
 *
 * Deliberately tiny: there is no attempt to wrap the whole `vscode` namespace.
 * A real adapter and a fake both implement this, and one contract suite runs
 * against both — worth doing wherever the adapter *converts* something, since
 * that is where the two can drift apart. Where an adapter only forwards a
 * platform object, such a suite would compare a fake against a mock of VS Code
 * and settle nothing; those behaviours belong in the Extension Host lane.
 *
 * @example
 * ```ts
 * const capability: CommandCapability = {
 *   register: (id, handler) => vscode.commands.registerCommand(id, handler),
 *   execute: (id, ...args) => Promise.resolve(vscode.commands.executeCommand(id, ...args)),
 * };
 * ```
 */
export interface CommandCapability {
  /**
   * Registers one handler for `id`. The returned registration removes it; a
   * platform conflict may throw synchronously during registration.
   */
  register(id: string, handler: (...args: readonly unknown[]) => unknown): PlatformRegistration;

  /**
   * Registers a text editor command.
   *
   * VS Code only invokes it with an editor focused; with none it logs "no
   * active text editor" and skips the handler. It does **not** grey the
   * command out in the palette — that is the `enablement` / `commandPalette`
   * `when` clause in package.json.
   *
   * **Fire-and-forget, unlike {@link CommandCapability.register}.** VS Code's
   * wrapper runs the handler inside `activeTextEditor.edit(...)` and discards
   * what it returned, logging a rejection rather than propagating it
   * So `execute` on such a command may resolve `undefined` while an async
   * handler is still running. A command whose caller needs the result or the
   * failure must be a plain one.
   *
   * The editor arrives as the same port `active` returns, so a handler works
   * with one editor shape however its command was declared. VS Code's
   * synchronous `TextEditorEdit` builder is deliberately not passed through:
   * it validates its arguments with `instanceof Range`, so it cannot cross a
   * port, and it is closed by the time an operation-wrapped handler resumes.
   */
  registerTextEditor(
    id: string,
    handler: (editor: ActiveTextEditor, args: readonly unknown[]) => unknown
  ): PlatformRegistration;

  /**
   * Invokes a command, resolving with whatever the handler returned and
   * rejecting with whatever it threw.
   */
  execute<T>(id: string, ...args: readonly unknown[]): Promise<T>;
}

/** Where the extension host is running. */
export const UiKind = {
  Desktop: 'desktop',
  Web: 'web',
} as const;

/** Union of {@link UiKind} values. */
export type UiKind = (typeof UiKind)[keyof typeof UiKind];

/**
 * The host facts runtime preflight checks a module's requirements against.
 *
 * Read once at activation. These cannot be known at definition time, which is
 * why preflight is two-stage: identity and the service graph are checked when
 * the plan compiles, and this is checked when the host starts.
 */
export interface HostEnvironment {
  /** Desktop or browser/worker extension host. */
  readonly uiKind: UiKind;
  /** Remote authority name, or undefined when local. */
  readonly remoteName: string | undefined;
  /** Whether the workspace is trusted. */
  readonly isTrusted: boolean;
  /** Number of open workspace folders. Zero means no folder is open. */
  readonly workspaceFolderCount: number;
  /** True when any workspace folder uses a scheme other than `file`. */
  readonly hasVirtualWorkspace: boolean;
}

/**
 * Reads the current {@link HostEnvironment}. The Application samples it once
 * during activation-time preflight; this port does not publish later changes.
 */
export interface EnvironmentCapability {
  read(): HostEnvironment;
}

/**
 * A message to translate, with context for whoever writes the translation.
 *
 * `vscode.l10n.t`'s object overload satisfies this shape.
 */
export interface LocalizedMessage {
  /**
   * The message to localize. `{0}`, `{1}` are replaced by the item at that
   * index in `args`.
   */
  readonly message: string;
  /** Values filling the message's placeholders. */
  readonly args?: readonly (string | number | boolean)[] | undefined;
  /** Context for translators. Not shown to users. */
  readonly comment?: string | readonly string[] | undefined;
}

/**
 * The localization surface: which language the UI is in, and how to translate.
 *
 * Kept apart from {@link EnvironmentCapability}, which exists to answer
 * preflight's questions about where the host is running. This one is consumed
 * by application code on every string it shows.
 */
export interface LocalizationCapability {
  /** The host's display language, as a BCP 47 tag (`'en'`, `'ja-JP'`, ...). */
  readonly language: string;
  /** Looks a message up in the host's bundle, filling in its placeholders. */
  translate(message: LocalizedMessage): string;
}

/**
 * The parts of `vscode.Uri` the framework needs, declared structurally so the
 * core stays vscode-free. A real `vscode.Uri` satisfies it.
 */
export interface ResourceUri {
  readonly scheme: string;
  readonly path: string;
  toString(): string;
}

/**
 * Which resource and language a setting is read for.
 *
 * VS Code resolves a different effective value per resource and per language, so
 * there is no single "current" value for an application.
 */
export interface SettingsScope {
  /** Resource the value applies to. Selects the workspace folder. */
  readonly resource?: ResourceUri | undefined;
  /** Language id, selecting `[language]` overrides. */
  readonly languageId?: string | undefined;
}

/** Where an update is written. Values match `vscode.ConfigurationTarget`. */
export const SettingsTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3,
} as const;

/** Union of {@link SettingsTarget} values. */
export type SettingsTarget = (typeof SettingsTarget)[keyof typeof SettingsTarget];

/**
 * Every tier VS Code exposes for one setting, in precedence order.
 *
 * Field names mirror `WorkspaceConfiguration.inspect` exactly so nothing is lost
 * in translation.
 */
export interface SettingsInspection<T> {
  readonly key: string;
  readonly defaultValue?: T | undefined;
  readonly globalValue?: T | undefined;
  readonly workspaceValue?: T | undefined;
  readonly workspaceFolderValue?: T | undefined;
  readonly defaultLanguageValue?: T | undefined;
  readonly globalLanguageValue?: T | undefined;
  readonly workspaceLanguageValue?: T | undefined;
  readonly workspaceFolderLanguageValue?: T | undefined;
  readonly languageIds?: readonly string[] | undefined;
}

/** Tells whether a configuration change touched a given section and scope. */
export interface SettingsChangeSource {
  affects(section: string, scope?: SettingsScope): boolean;
}

/** A watched file's URI. A real `vscode.Uri` satisfies it. */
export interface WatchedUri extends ResourceUri {
  /** Filesystem path. Only meaningful for `file:`-like schemes. */
  readonly fsPath: string;
}

/**
 * A glob with its own base folder. A real `vscode.RelativePattern` satisfies it
 * structurally.
 */
export interface RelativePatternLike {
  readonly baseUri: ResourceUri;
  readonly pattern: string;
}

/**
 * One native watcher subscription. Event registrations and the watcher itself
 * are synchronous disposables owned by the managed watcher that creates them.
 */
export interface FileWatcherHandle {
  onDidCreate(listener: (uri: WatchedUri) => void): PlatformRegistration;
  onDidChange(listener: (uri: WatchedUri) => void): PlatformRegistration;
  onDidDelete(listener: (uri: WatchedUri) => void): PlatformRegistration;
  dispose(): void;
}

/**
 * A place in a document. `vscode.Position` satisfies it.
 *
 * Plain data on purpose. VS Code's edit builder validates its arguments with
 * `instanceof`, so a port cannot hand its objects straight to the platform
 * anyway — and once the adapter has to convert, plain data is the better half
 * of the boundary: it compares with `toEqual`, logs readably, and a fake can
 * produce it without a VS Code runtime.
 */
export interface TextPosition {
  /** Zero-based line. */
  readonly line: number;
  /** Zero-based UTF-16 code unit offset within the line. */
  readonly character: number;
}

/** A span in a document. `vscode.Range` and `vscode.Selection` satisfy it. */
export interface TextRange {
  readonly start: TextPosition;
  readonly end: TextPosition;
}

/** One replacement inside a document. An empty `text` deletes the range. */
export interface TextEdit {
  readonly range: TextRange;
  readonly text: string;
}

/** How a batch of edits lands in the undo stack. */
export interface TextEditOptions {
  /**
   * Where this batch places undo boundaries.
   *
   * `'both'` makes it its own undo step, which is what a single edit wants.
   * The other three exist so several batches can be *joined* into one step:
   * the first opens it, the middle ones add to it, and the last closes it.
   * Without that, "apply three transforms in a row" is three undos — and it
   * cannot be one batch, because each stage has to see what the previous one
   * left behind.
   *
   * `ActiveEditor.editStages` is the way to do that without tracking the
   * boundaries by hand.
   *
   * @defaultValue 'both'
   */
  readonly undoStop?: 'both' | 'before' | 'after' | 'none' | undefined;
}

/** One replacement targeting a file that need not be open. */
export interface WorkspaceTextEdit extends TextEdit {
  /** The document to edit. */
  readonly uri: ResourceUri;
}

/** Metadata for a cross-file edit, surfaced in the refactor-preview UI. */
export interface WorkspaceEditOptions {
  /** Label shown in the undo stack and the preview UI. */
  readonly label?: string | undefined;
  /** Whether the user is asked to confirm before the edit lands. */
  readonly needsConfirmation?: boolean | undefined;
  /** Marks the whole edit as a refactoring. */
  readonly isRefactoring?: boolean | undefined;
  /**
   * Checked while the edit is assembled, so a very large batch stops promptly
   * instead of building a transaction nobody is waiting for.
   */
  readonly signal?: AbortSignal | undefined;
}

/**
 * The editor the user is working in, as the framework sees it.
 *
 * Reads are pull-based rather than a snapshot: a handler can edit and then read
 * back, and the document may also change underneath it.
 */
export interface ActiveTextEditor {
  /** The document's location. `untitled:` documents have no meaningful path. */
  readonly uri: WatchedUri;
  /** The document's language id, e.g. `'typescript'`. */
  readonly languageId: string;
  /** Number of lines. Always at least 1. */
  readonly lineCount: number;
  /**
   * The current selections, primary first. Never empty.
   *
   * Each is ordered: `start` never comes after `end`, even for a right-to-left
   * selection, matching `vscode.Selection.start`/`end`. The direction the user
   * dragged in is not something a text operation should have to think about.
   */
  readonly selections: readonly TextRange[];

  /** The document's text, or just the given span. */
  getText(range?: TextRange): string;
  /** The span of a whole line, or undefined when the line does not exist. */
  lineRange(line: number): TextRange | undefined;
  /**
   * The span of the word at a position, using the platform's own word
   * definition unless `pattern` overrides it. Undefined when there is no word.
   */
  wordRangeAt(position: TextPosition, pattern?: RegExp): TextRange | undefined;

  /**
   * Applies replacements. Resolves false when the platform refused them.
   *
   * An empty batch with an explicit `undoStop` places that boundary and
   * changes nothing else — which is how a sequence of batches closes its undo
   * step once the last one turns out to have been the last. With no explicit
   * `undoStop` an empty batch is simply nothing to do.
   */
  applyEdits(edits: readonly TextEdit[], options?: TextEditOptions): Promise<boolean>;
  /** Replaces the selections. The first becomes primary. */
  select(selections: readonly TextRange[]): void;
  /** Scrolls a span into view. */
  reveal(range: TextRange): void;
}

/**
 * Reading and editing text.
 *
 * Cross-file edits do not need an open editor, which is why they live on the
 * capability rather than on {@link ActiveTextEditor}.
 */
export interface EditorCapability {
  /** The editor the user is focused on, or undefined when none is. */
  readonly active: ActiveTextEditor | undefined;
  /** Applies replacements across any number of files as one transaction. */
  applyWorkspaceEdit(
    edits: readonly WorkspaceTextEdit[],
    options?: WorkspaceEditOptions
  ): Promise<boolean>;
}

/**
 * The file-watching surface the framework needs.
 *
 * The ignore flags are passed to the *native* watcher, so event kinds nobody
 * asked for are never generated, rather than filtered after the fact.
 */
export interface FileWatcherCapability {
  watch(
    pattern: string | RelativePatternLike,
    options: {
      readonly ignoreCreateEvents: boolean;
      readonly ignoreChangeEvents: boolean;
      readonly ignoreDeleteEvents: boolean;
    }
  ): FileWatcherHandle;
}

/**
 * The structural subset of `vscode.Memento` the framework needs. A real
 * `globalState`/`workspaceState` satisfies it.
 */
export interface MementoLike {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): Thenable<void>;
  keys(): readonly string[];
}

/**
 * The persisted-state surface the framework needs.
 *
 * `setKeysForSync` replaces its **entire** argument on every call — VS Code's
 * own contract — which is why the framework aggregates all syncable keys and
 * calls it once at activation rather than per storage definition.
 */
export interface StorageCapability {
  /** Extension-global state, shared across workspaces. */
  readonly global: MementoLike;
  /** Per-workspace state. Never synced. */
  readonly workspace: MementoLike;
  /** Declares which global keys participate in Settings Sync. */
  setKeysForSync(keys: readonly string[]): void;
}

/**
 * The secret-storage surface the framework needs. Values remain opaque strings
 * at this boundary; typed serialization and validation live above the port.
 */
export interface SecretsCapability {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<readonly string[]>;
  /** Fires with the affected key whenever a secret is stored or deleted. */
  onDidChange(listener: (key: string) => void): PlatformRegistration;
}

/**
 * The structural subset of `vscode.CancellationToken` the framework needs. A
 * real token satisfies it, and so does a fake, which is what lets cancellation
 * logic be tested without an extension host.
 */
export interface CancellationTokenLike {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => void): PlatformRegistration;
}

/** Message severity, mirroring `showInformation/Warning/ErrorMessage`. */
export type NotificationSeverity = 'info' | 'warn' | 'error';

/** One action button, as the platform sees it. */
export interface NotificationActionLike {
  readonly title: string;
  readonly isCloseAffordance?: boolean | undefined;
}

/**
 * The message surface the framework needs.
 *
 * `show` resolves with the *index* of the chosen action. The real adapter
 * recovers that index from the exact item object VS Code hands back, so two
 * actions with the same title still resolve correctly — identity, never a
 * title-string lookup.
 */
export interface NotificationCapability {
  show(
    severity: NotificationSeverity,
    message: string,
    options: { readonly modal?: boolean | undefined; readonly detail?: string | undefined },
    actions: readonly NotificationActionLike[]
  ): Promise<number | undefined>;
}

/** Where progress UI is rendered. Mirrors `vscode.ProgressLocation`. */
export type ProgressArea = 'notification' | 'window' | 'source-control';

/** Reports progress updates. A real `vscode.Progress` satisfies it. */
export interface ProgressReporterLike {
  report(update: {
    readonly message?: string | undefined;
    readonly increment?: number | undefined;
  }): void;
}

/**
 * The progress-UI surface the framework needs. `run` settles with the task's
 * value or rejection; cancellation is communicated through the supplied token.
 */
export interface ProgressCapability {
  run<T>(
    options: {
      readonly title: string;
      readonly location: ProgressArea;
      readonly cancellable: boolean;
    },
    task: (reporter: ProgressReporterLike, token: CancellationTokenLike) => Promise<T>
  ): Promise<T>;
}

/**
 * A command reference for UI elements. Structurally compatible with
 * `vscode.Command` for the fields the framework carries.
 */
export interface CommandLinkLike {
  readonly command: string;
  readonly title: string;
  readonly arguments?: readonly unknown[] | undefined;
}

/** Screen-reader information. Structurally `vscode.AccessibilityInformation`. */
export interface AccessibilityInformationLike {
  readonly label: string;
  readonly role?: string | undefined;
}

/**
 * A tooltip. A real `vscode.MarkdownString` satisfies the object form and is
 * passed through to the platform untouched.
 */
export type TooltipLike = string | { readonly value: string };

/** Fields a status bar item renders. `undefined` means "leave unchanged". */
export interface StatusBarItemFields {
  readonly text?: string | undefined;
  readonly tooltip?: TooltipLike | undefined;
  readonly command?: string | CommandLinkLike | undefined;
  readonly backgroundColor?: 'warning' | 'error' | undefined;
  readonly accessibilityInformation?: AccessibilityInformationLike | undefined;
}

/** One native status bar item. The creator owns it until `dispose`. */
export interface StatusBarItemHandle {
  patch(fields: StatusBarItemFields): void;
  show(): void;
  hide(): void;
  dispose(): void;
}

/** The status bar surface the framework needs. */
export interface StatusBarCapability {
  createItem(
    id: string,
    alignment: 'left' | 'right',
    priority: number | undefined
  ): StatusBarItemHandle;
}

/** A language filter. Structurally a `vscode.DocumentFilter`. */
interface LanguageFilterLike {
  readonly language?: string | undefined;
  readonly scheme?: string | undefined;
  readonly pattern?: string | undefined;
  readonly notebookType?: string | undefined;
}

/** Which documents a language status item applies to. */
export type LanguageSelectorLike =
  string | LanguageFilterLike | readonly (string | LanguageFilterLike)[];

/** Fields a language status item renders. `undefined` means "leave unchanged". */
export interface LanguageStatusItemFields {
  readonly name?: string | undefined;
  readonly text?: string | undefined;
  readonly detail?: string | undefined;
  readonly command?: CommandLinkLike | undefined;
  readonly severity?: 'info' | 'warn' | 'error' | undefined;
  readonly busy?: boolean | undefined;
  readonly accessibilityInformation?: AccessibilityInformationLike | undefined;
}

/** One native language status item. The creator owns it until `dispose`. */
export interface LanguageStatusItemHandle {
  patch(fields: LanguageStatusItemFields): void;
  dispose(): void;
}

/** The language-status surface the framework needs. */
export interface LanguageStatusCapability {
  createItem(id: string, selector: LanguageSelectorLike): LanguageStatusItemHandle;
}

/**
 * The structural subset of `vscode.QuickPickItem` the framework needs. The
 * vscode-specific fields (`iconPath`, `resourceUri`, `kind`) are carried as
 * opaque values: the engine never interprets them, it only hands them to the
 * platform.
 */
export interface QuickPickItemLike {
  readonly label: string;
  /** `vscode.QuickPickItemKind` value; `-1` renders a separator. */
  readonly kind?: number | undefined;
  readonly description?: string | undefined;
  readonly detail?: string | undefined;
  readonly picked?: boolean | undefined;
  readonly alwaysShow?: boolean | undefined;
  readonly iconPath?: unknown;
  readonly resourceUri?: unknown;
  readonly buttons?: readonly QuickInputButtonLike[] | undefined;
}

/** A quick input button. Compared by identity, never by tooltip. */
export interface QuickInputButtonLike {
  readonly iconPath: unknown;
  readonly tooltip?: string | undefined;
}

/**
 * The structural subset of `vscode.QuickPick` the framework drives. A real
 * `window.createQuickPick()` satisfies it. Event registrations and the input
 * itself must all be disposed by the consumer that owns the interaction.
 */
export interface QuickPickLike<T extends QuickPickItemLike> {
  title: string | undefined;
  step: number | undefined;
  totalSteps: number | undefined;
  placeholder: string | undefined;
  prompt: string | undefined;
  value: string;
  items: readonly T[];
  readonly activeItems: readonly T[];
  readonly selectedItems: readonly T[];
  canSelectMany: boolean;
  matchOnDescription: boolean;
  matchOnDetail: boolean;
  ignoreFocusOut: boolean;
  busy: boolean;
  enabled: boolean;
  buttons: readonly QuickInputButtonLike[];
  onDidAccept(listener: () => void): PlatformRegistration;
  onDidHide(listener: () => void): PlatformRegistration;
  onDidChangeValue(listener: (value: string) => void): PlatformRegistration;
  onDidChangeActive(listener: (items: readonly T[]) => void): PlatformRegistration;
  onDidTriggerButton(listener: (button: QuickInputButtonLike) => void): PlatformRegistration;
  onDidTriggerItemButton(
    listener: (event: { readonly button: QuickInputButtonLike; readonly item: T }) => void
  ): PlatformRegistration;
  show(): void;
  hide(): void;
  dispose(): void;
}

/**
 * The structural subset of `vscode.InputBox` the framework drives. A real
 * `window.createInputBox()` satisfies it. Event registrations and the input
 * itself must all be disposed by the consumer that owns the interaction.
 */
export interface InputBoxLike {
  title: string | undefined;
  step: number | undefined;
  totalSteps: number | undefined;
  prompt: string | undefined;
  placeholder: string | undefined;
  password: boolean;
  value: string;
  validationMessage: string | { readonly message: string; readonly severity: number } | undefined;
  ignoreFocusOut: boolean;
  busy: boolean;
  enabled: boolean;
  buttons: readonly QuickInputButtonLike[];
  onDidAccept(listener: () => void): PlatformRegistration;
  onDidHide(listener: () => void): PlatformRegistration;
  onDidChangeValue(listener: (value: string) => void): PlatformRegistration;
  onDidTriggerButton(listener: (button: QuickInputButtonLike) => void): PlatformRegistration;
  show(): void;
  hide(): void;
  dispose(): void;
}

/**
 * The quick-input surface the framework needs.
 *
 * Disposing a *visible* quick input fires `onDidHide` — that reentry is why
 * every consumer settles its promise before tearing down, and a fake must
 * reproduce it or that whole class of bug becomes untestable.
 */
export interface QuickInputCapability {
  createQuickPick<T extends QuickPickItemLike>(): QuickPickLike<T>;
  createInputBox(): InputBoxLike;
  /** The platform's Back button sentinel. Steps compare against it by identity. */
  readonly backButton: QuickInputButtonLike;
}

/** Whether a tree item can expand, and whether it starts expanded. */
export const TreeItemCollapsible = {
  None: 0,
  Collapsed: 1,
  Expanded: 2,
} as const;

/** Union of {@link TreeItemCollapsible} values. Matches `vscode.TreeItemCollapsibleState`. */
export type TreeItemCollapsible = (typeof TreeItemCollapsible)[keyof typeof TreeItemCollapsible];

/** A tree item's checkbox, when the view shows one. */
export const TreeItemChecked = {
  Unchecked: 0,
  Checked: 1,
} as const;

/** Union of {@link TreeItemChecked} values. Matches `vscode.TreeItemCheckboxState`. */
export type TreeItemChecked = (typeof TreeItemChecked)[keyof typeof TreeItemChecked];

/** Rendered markdown. A `vscode.MarkdownString` satisfies it. */
export interface MarkdownLike {
  readonly value: string;
}

/** A command to run, with the title a menu would show. A `vscode.Command` satisfies it. */
export interface CommandLike {
  readonly command: string;
  readonly title: string;
  readonly tooltip?: string | undefined;
  readonly arguments?: readonly unknown[] | undefined;
}

/**
 * A tree item's icon.
 *
 * A bare string is a theme icon id (`'folder'`, `'error'`), which is the common
 * case by a wide margin. The object forms cover a coloured theme icon and image
 * files, including a light/dark pair.
 */
export type TreeItemIcon =
  | string
  | { readonly id: string; readonly color?: string | undefined }
  | { readonly uri: ResourceUri }
  | { readonly light: ResourceUri; readonly dark: ResourceUri };

/**
 * One row in a tree, as plain data.
 *
 * The platform's own `TreeItem` is a class the adapter builds from this. Keeping
 * the model plain is what lets a provider be written, tested and reasoned about
 * without a VS Code runtime.
 */
export interface TreeItemLike {
  /** Unique across the whole tree, not just among siblings. */
  readonly id: string;
  /** The text shown. */
  readonly label: string;
  /** Dimmed text after the label. */
  readonly description?: string | undefined;
  /** Hover text. */
  readonly tooltip?: string | MarkdownLike | undefined;
  /** The icon, if any. */
  readonly icon?: TreeItemIcon | undefined;
  /**
   * The resource this row stands for. Setting it enables file-icon themes and
   * the built-in file commands in the row's context menu.
   */
  readonly resourceUri?: ResourceUri | undefined;
  /** Checkbox state, for a view that shows checkboxes. */
  readonly checkboxState?: TreeItemChecked | undefined;
  /** Value matched by `when` clauses in menu contributions. */
  readonly contextValue?: string | undefined;
  /** Whether the row expands. */
  readonly collapsibleState?: TreeItemCollapsible | undefined;
  /** Run when the row is clicked. */
  readonly command?: CommandLike | undefined;
}

/**
 * Where a tree view's rows come from.
 *
 * The vscode-free counterpart of `vscode.TreeDataProvider`: the adapter wraps
 * one of these into the platform's shape, so a provider never imports `vscode`
 * and a test can drive it directly.
 */
export interface TreeDataSource<T> {
  /** Renders one element. */
  getTreeItem(element: T): TreeItemLike;
  /** The children of an element, or the roots when none is given. */
  getChildren(element?: T): T[] | Promise<T[]>;
  /** The parent of an element. Required for `reveal` to work. */
  getParent?(element: T): T | undefined | Promise<T | undefined>;
  /** Fires when a subtree (or the whole tree, for `undefined`) needs redrawing. */
  onDidChangeTreeData?(listener: (element: T | undefined) => void): PlatformRegistration;
  /** Called by the adapter when the user toggles checkboxes in the view. */
  reportCheckboxChange?(
    changes: readonly { readonly element: T; readonly checked: boolean }[]
  ): void;
  /** Released with the view. */
  dispose?(): void;
}

/** Moving rows within a tree, or between trees sharing a mime type. */
export interface TreeDragAndDrop<T> {
  /** Carries the dragged ids. Convention: `application/vnd.code.tree.<viewid>`. */
  readonly mimeType: string;
  /**
   * Called after a drop with the dragged items' **ids**, because ids are what
   * reliably survive the drag's serialisation. Redrawing is the handler's job.
   */
  onDrop(sourceIds: readonly string[], target: T | undefined): void | Promise<void>;
}

/** Options a declared tree view passes to the platform. */
export interface TreeViewOptionsLike {
  readonly showCollapseAll?: boolean | undefined;
  readonly canSelectMany?: boolean | undefined;
  readonly manageCheckboxStateManually?: boolean | undefined;
  /** Declared rather than pre-built: the adapter owns the platform controller. */
  readonly dragAndDrop?: TreeDragAndDrop<never> | undefined;
}

/**
 * One rendered webview, whatever is hosting it.
 *
 * Satisfies `WebviewLike`, so the typed RPC channel layers straight on top
 * without the RPC code learning anything about panels or views.
 */
export interface WebviewSurface {
  /** Sends a raw message to the content. */
  postMessage(message: unknown): Promise<boolean>;
  /** Subscribes to raw messages from the content. */
  onDidReceiveMessage(listener: (message: unknown) => void): PlatformRegistration;
  /** Replaces the rendered HTML. */
  setHtml(html: string): void;
  /** The source a content security policy has to allow for this webview. */
  readonly cspSource: string;
  /**
   * Rewrites a path inside the extension into a uri the content may load.
   *
   * Takes a path rather than a uri so nothing above the port has to construct
   * one — building a uri is exactly the sort of thing only the platform can do
   * correctly for remote and virtual file systems.
   */
  asWebviewUri(extensionRelativePath: string): string;
}

/**
 * One incarnation of a webview contributed to a view container.
 *
 * A view is not a single long-lived object: hiding it tears the webview down,
 * and showing it again builds a new one and asks the provider to fill it in
 * afresh. `onDidDispose` marks the end of *this* incarnation, which is what
 * makes per-incarnation state — an RPC channel, message subscriptions,
 * in-flight requests — releasable at the right moment rather than at shutdown.
 */
export interface WebviewViewSurface extends WebviewSurface {
  /** Fires when this incarnation goes away, typically because the view was hidden. */
  onDidDispose(listener: () => void): PlatformRegistration;
}

/** A webview in its own editor tab. */
export interface WebviewPanelSurface extends WebviewSurface {
  /** Brings the panel to the front, optionally in a specific column. */
  reveal(column?: number): void;
  /** Fires when the panel is shown or hidden. */
  onDidChangeVisibility(listener: (visible: boolean) => void): PlatformRegistration;
  /** Fires when the panel goes away, including when the user closes the tab. */
  onDidDispose(listener: () => void): PlatformRegistration;
  /** Closes the panel. */
  dispose(): void;
}

/** What to open a webview panel with. */
export interface WebviewPanelRequest {
  /** Identifies the kind of panel, matching a serializer contribution. */
  readonly viewType: string;
  /** The tab's title. */
  readonly title: string;
  /** Editor column to open in. */
  readonly column?: number | undefined;
  /**
   * Keeps the hidden panel's scripts running instead of tearing the iframe
   * down. It has a real memory cost; saving state from inside the content is
   * usually better.
   */
  readonly retainContextWhenHidden?: boolean | undefined;
  /** Whether the content may run scripts. */
  readonly enableScripts?: boolean | undefined;
  /** Whether the content may submit forms. */
  readonly enableForms?: boolean | undefined;
  /** Whether the find widget is available. */
  readonly enableFindWidget?: boolean | undefined;
  /** Extension-relative folders the content may load resources from. */
  readonly localResourceRoots?: readonly string[] | undefined;
}

/** Options for a webview registered into a view container. */
export interface WebviewViewRequest {
  /** Whether the content may run scripts. */
  readonly enableScripts?: boolean | undefined;
  /** Keeps the hidden view's scripts running. */
  readonly retainContextWhenHidden?: boolean | undefined;
  /** Extension-relative folders the content may load resources from. */
  readonly localResourceRoots?: readonly string[] | undefined;
}

/** Hosting webview content, in a panel or in a view container. */
export interface WebviewCapability {
  /** Opens a panel. The caller owns the surface and must eventually dispose it. */
  createPanel(request: WebviewPanelRequest): WebviewPanelSurface;
  /**
   * Registers the provider for a view contributed in `package.json`. The
   * callback runs when the platform resolves an incarnation of the view and
   * runs again for each later one. Disposing the returned registration prevents
   * future resolves; the surfaces already handed out live until their own
   * `onDidDispose`.
   */
  registerViewProvider(
    viewId: string,
    resolve: (surface: WebviewViewSurface) => void | Promise<void>,
    options: WebviewViewRequest
  ): PlatformRegistration;
  /**
   * Registers the restorer for a panel of `viewType`.
   *
   * Called when a window reopens with a panel of this kind still in its tab
   * layout. Without one, the tab is discarded on reload -- so this is what
   * makes a panel survive a window restart, not an optimisation. The returned
   * registration is Application-owned and must be disposed on shutdown.
   */
  registerPanelSerializer(
    viewType: string,
    restore: (surface: WebviewPanelSurface, state: unknown) => void | Promise<void>
  ): PlatformRegistration;
  /**
   * Reads a file shipped with the extension, as text.
   *
   * Goes through the platform rather than Node's `fs` so templates load in
   * remote and web extension hosts too.
   */
  readExtensionFile(extensionRelativePath: string): Promise<string>;
}

/** The tree view surface the framework needs. */
export interface TreeViewCapability {
  /**
   * Creates and registers a tree view. The returned registration owns the
   * native view/controller, while provider disposal remains the caller's
   * responsibility.
   */
  create(
    viewId: string,
    source: TreeDataSource<never>,
    options: TreeViewOptionsLike
  ): PlatformRegistration;
}

/**
 * The settings surface the framework needs.
 *
 * Reads take a scope rather than collapsing to one global value, because the
 * effective value genuinely differs per resource and per language.
 *
 * @example
 * ```ts
 * const enabled = capability.read<boolean>('sample.projects', 'enabled', {
 *   resource: document.uri,
 *   languageId: document.languageId,
 * });
 * ```
 */
export interface SettingsCapability {
  /** Reads the effective value, with VS Code's own tier resolution applied. */
  read<T>(section: string, key: string, scope?: SettingsScope): T | undefined;
  /** Returns every tier for a setting, or undefined for an unknown key. */
  inspect<T>(
    section: string,
    key: string,
    scope?: SettingsScope
  ): SettingsInspection<T> | undefined;
  /**
   * Writes a value to the requested tier. Passing `undefined` removes that
   * tier's value. Rejections from the platform propagate to the caller.
   */
  update(
    section: string,
    key: string,
    value: unknown,
    target: SettingsTarget,
    scope?: SettingsScope,
    overrideInLanguage?: boolean
  ): Promise<void>;
  /** Subscribes to configuration changes. */
  onDidChange(listener: (event: SettingsChangeSource) => void): PlatformRegistration;
}
