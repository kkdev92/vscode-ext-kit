/**
 * Lifecycle states of an `ApplicationHost`.
 *
 * `failed` is reached only **after** rollback completed; it never represents
 * cleanup in progress.
 */
export const HostState = {
  New: 'new',
  Starting: 'starting',
  Running: 'running',
  Stopping: 'stopping',
  Stopped: 'stopped',
  Failed: 'failed',
} as const;

/** Union of {@link HostState} values. */
export type HostState = (typeof HostState)[keyof typeof HostState];

/** Why the host is stopping. Recorded in diagnostics. */
export const StopReason = {
  /** `deactivate()` was called by VS Code. */
  Deactivate: 'deactivate',
  /** The failsafe registered on `context.subscriptions` fired. */
  ContextDisposed: 'context-disposed',
  /** Activation failed and the host is unwinding. */
  StartFailed: 'start-failed',
  /** Stopped explicitly, typically by a test. */
  Manual: 'manual',
} as const;

/** Union of {@link StopReason} values. */
export type StopReason = (typeof StopReason)[keyof typeof StopReason];

/** Whether the state is terminal, so no further transition can occur. */
export function isTerminalState(state: HostState): boolean {
  return state === HostState.Stopped || state === HostState.Failed;
}

/**
 * Whether the host accepts new operations. Only `running` does: once stopping
 * begins, ingress is closed.
 *
 * @example
 * ```ts
 * if (!acceptsWork(host.state)) {
 *   throw new InvalidHostStateError('Host is not running.');
 * }
 * ```
 */
export function acceptsWork(state: HostState): boolean {
  return state === HostState.Running;
}
