/**
 * General-purpose disposable primitives.
 *
 * These are for resources an extension owns itself. Anything the framework
 * registers lives in a `RegistrationScope`/`ResourceScope` and is released by
 * `host.stop()` instead — those scopes carry activation-transaction and
 * diagnostics machinery that has no place in a general-purpose utility, so they
 * are deliberately not the same type.
 */

/**
 * Anything with a synchronous `dispose`, including every `vscode.Disposable`.
 * A returned promise is not awaited; asynchronous cleanup belongs in a hosted
 * service or `ResourceScope`.
 */
interface DisposableLike {
  dispose(): unknown;
}

/**
 * A collection of disposables that can be disposed together.
 *
 * Supports TC39 Explicit Resource Management: `using scope = new
 * DisposableCollection()` disposes everything when the block exits, even on
 * exceptions.
 *
 * @example
 * ```ts
 * const disposables = new DisposableCollection();
 *
 * disposables.push(
 *   vscode.workspace.onDidChangeConfiguration(() => {}),
 *   vscode.window.onDidChangeActiveTextEditor(() => {})
 * );
 *
 * const watcher = disposables.add(vscode.workspace.createFileSystemWatcher('**\/*.ts'));
 *
 * disposables.dispose();
 * ```
 */
export class DisposableCollection implements DisposableLike {
  #disposables: DisposableLike[] = [];
  #isDisposed = false;

  /**
   * Adds a disposable and returns it.
   *
   * Adding to an already-disposed collection disposes the value immediately
   * instead of leaking it (mirroring VS Code's own DisposableStore); no error
   * is thrown.
   */
  add<T extends DisposableLike>(disposable: T): T {
    if (this.#isDisposed) {
      disposable.dispose();
      return disposable;
    }
    this.#disposables.push(disposable);
    return disposable;
  }

  /** Adds one or more disposables. Like {@link add} when already disposed. */
  push(...disposables: DisposableLike[]): void {
    for (const disposable of disposables) {
      this.add(disposable);
    }
  }

  /** Number of disposables currently held. */
  get size(): number {
    return this.#disposables.length;
  }

  /**
   * Disposes everything in reverse (LIFO) order.
   *
   * A failing `dispose()` never stops the rest. A single collected error is
   * rethrown as-is; several are wrapped in an `AggregateError` — so partial
   * cleanup never silently succeeds.
   */
  dispose(): void {
    if (this.#isDisposed) {
      return;
    }
    this.#isDisposed = true;
    const toDispose = [...this.#disposables].reverse();
    this.#disposables = [];

    const errors: unknown[] = [];
    for (const disposable of toDispose) {
      try {
        disposable.dispose();
      } catch (error) {
        errors.push(error);
      }
    }

    if (errors.length === 1) {
      throw errors[0];
    }
    if (errors.length > 1) {
      throw new AggregateError(errors, 'DisposableCollection: errors during dispose');
    }
  }

  /** TC39 Explicit Resource Management (`using`) support. */
  [Symbol.dispose](): void {
    this.dispose();
  }
}

/** The part of `vscode.ExtensionContext` that {@link createScope} needs. */
interface SubscriptionsHost {
  readonly subscriptions: { push(disposable: DisposableLike): void };
}

/**
 * Creates a {@link DisposableCollection} that is disposed automatically when
 * the extension deactivates, by registering itself in `context.subscriptions`.
 *
 * For user-owned resources only. `context.subscriptions` is a synchronous
 * disposal surface, so anything needing asynchronous teardown belongs in a
 * hosted service or an application-owned `ResourceScope` instead.
 *
 * @example
 * ```ts
 * const scope = createScope(context);
 * scope.add(vscode.window.createStatusBarItem());
 * // ...later, when the feature is turned off early:
 * scope.dispose();
 * ```
 */
export function createScope(context: SubscriptionsHost): DisposableCollection {
  const scope = new DisposableCollection();
  context.subscriptions.push(scope);
  return scope;
}
