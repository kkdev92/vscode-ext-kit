/**
 * Minimal event emitter for the vscode-free core.
 *
 * Delivery iterates a **snapshot** of the listener set — the same contract
 * VS Code's own `EventEmitter` has, and the one that is easy to get wrong: a
 * listener disposing itself, or another, part-way through a firing must not
 * cause anyone else to be skipped.
 *
 * Listener failures are not isolated: `fire` propagates the exception and does
 * not call later listeners in that delivery. Callers that need best-effort
 * observers must isolate them before registration.
 */
export interface Emitter<T> {
  /** Subscribes. The returned disposable detaches exactly this listener. */
  event(listener: (value: T) => void): { dispose(): void };
  /** Delivers `value` to a snapshot; a listener exception propagates immediately. */
  fire(value: T): void;
  /** Detaches every listener. Further `fire` calls do nothing. */
  dispose(): void;
}

/**
 * Creates an {@link Emitter}.
 *
 * @example
 * ```ts
 * const changed = createEmitter<string>();
 * const subscription = changed.event((key) => refresh(key));
 * changed.fire('preferences');
 * subscription.dispose();
 * ```
 */
export function createEmitter<T>(): Emitter<T> {
  const listeners = new Set<(value: T) => void>();
  let disposed = false;

  return {
    event(listener: (value: T) => void): { dispose(): void } {
      if (!disposed) {
        listeners.add(listener);
      }
      return {
        dispose(): void {
          listeners.delete(listener);
        },
      };
    },

    fire(value: T): void {
      // Snapshot: mutations during delivery affect the next firing, not this one.
      for (const listener of [...listeners]) {
        listener(value);
      }
    },

    dispose(): void {
      disposed = true;
      listeners.clear();
    },
  };
}
