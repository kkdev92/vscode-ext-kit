import type * as vscode from 'vscode';

/**
 * A collection of disposables that can be disposed together.
 *
 * Supports TC39 Explicit Resource Management: `using scope = new
 * DisposableCollection()` disposes everything when the block exits, even on
 * exceptions.
 *
 * @example
 * ```typescript
 * const disposables = new DisposableCollection();
 *
 * disposables.push(
 *   vscode.workspace.onDidChangeConfiguration(() => {}),
 *   vscode.window.onDidChangeActiveTextEditor(() => {})
 * );
 *
 * // Or use add() to get the disposable back
 * const watcher = disposables.add(
 *   vscode.workspace.createFileSystemWatcher('**\/*.ts')
 * );
 *
 * disposables.dispose();
 * ```
 */
export class DisposableCollection implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private isDisposed = false;

  /**
   * Adds a disposable to the collection and returns it.
   *
   * If the collection is already disposed, the disposable is disposed
   * immediately instead of leaking (mirroring VS Code's internal
   * DisposableStore behavior) — no error is thrown.
   *
   * @param disposable - The disposable to add
   * @returns The same disposable for chaining
   */
  add<T extends vscode.Disposable>(disposable: T): T {
    if (this.isDisposed) {
      disposable.dispose();
      return disposable;
    }
    this.disposables.push(disposable);
    return disposable;
  }

  /**
   * Adds one or more disposables to the collection. Like {@link add},
   * disposes them immediately if the collection is already disposed.
   */
  push(...disposables: vscode.Disposable[]): void {
    for (const disposable of disposables) {
      this.add(disposable);
    }
  }

  /**
   * Returns the number of disposables in the collection.
   */
  get size(): number {
    return this.disposables.length;
  }

  /**
   * Disposes all disposables in the collection.
   * After calling this method, added disposables are disposed immediately.
   *
   * If individual `dispose()` calls throw, all remaining disposables are still
   * disposed. Collected errors are then rethrown as a single error (or
   * `AggregateError` if multiple), so partial cleanup never silently succeeds.
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    // Dispose in reverse order (LIFO) to properly handle dependencies
    const toDispose = [...this.disposables].reverse();
    this.disposables = [];

    const errors: unknown[] = [];
    for (const disposable of toDispose) {
      try {
        disposable.dispose();
      } catch (err) {
        errors.push(err);
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

/**
 * Creates a {@link DisposableCollection} that is automatically disposed when
 * the extension deactivates (it registers itself in `context.subscriptions`).
 *
 * Useful for grouping the disposables of one feature so they can also be
 * torn down together ahead of deactivation:
 *
 * @example
 * ```typescript
 * const scope = createScope(context);
 * scope.add(createStatusBarItem({ text: 'hi' }));
 * scope.add(createFileWatcher({ patterns: '**\/*.md' }));
 * // ...later, when the feature is turned off:
 * scope.dispose();
 * ```
 */
export function createScope(context: vscode.ExtensionContext): DisposableCollection {
  const scope = new DisposableCollection();
  context.subscriptions.push(scope);
  return scope;
}
