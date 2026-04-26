import type * as vscode from 'vscode';

/**
 * A collection of disposables that can be disposed together.
 * Useful for managing multiple subscriptions and resources.
 *
 * @example
 * ```typescript
 * const disposables = new DisposableCollection();
 *
 * // Add disposables
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
 * // Dispose all at once
 * disposables.dispose();
 * ```
 */
export class DisposableCollection implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private isDisposed = false;

  /**
   * Adds a disposable to the collection and returns it.
   * Useful when you need to keep a reference to the disposable.
   *
   * @param disposable - The disposable to add
   * @returns The same disposable for chaining
   * @throws Error if the collection has already been disposed
   */
  add<T extends vscode.Disposable>(disposable: T): T {
    if (this.isDisposed) {
      throw new Error('Cannot add to a disposed DisposableCollection');
    }
    this.disposables.push(disposable);
    return disposable;
  }

  /**
   * Adds one or more disposables to the collection.
   *
   * @param disposables - The disposables to add
   * @throws Error if the collection has already been disposed
   */
  push(...disposables: vscode.Disposable[]): void {
    if (this.isDisposed) {
      throw new Error('Cannot add to a disposed DisposableCollection');
    }
    this.disposables.push(...disposables);
  }

  /**
   * Returns the number of disposables in the collection.
   */
  get size(): number {
    return this.disposables.length;
  }

  /**
   * Disposes all disposables in the collection.
   * After calling this method, no more disposables can be added.
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
}
