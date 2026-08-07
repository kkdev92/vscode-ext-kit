/**
 * Mutable point-in-time host snapshot for runtime-preflight tests. It has no
 * workspace/trust events because the current environment port exposes only
 * `read()`; call `_set` before the next read to arrange a different snapshot.
 */
import type { EnvironmentCapability, HostEnvironment } from '../../foundation/platform/ports.js';

/** In-memory environment capability for tests. */
export interface FakeEnvironment extends EnvironmentCapability {
  /** Overwrites part of the reported environment. */
  _set(patch: Partial<HostEnvironment>): void;
}

/**
 * Creates a fake environment.
 *
 * Defaults to a supported local desktop workspace so feature tests state only
 * exceptional compatibility facts. A test specifically about environment
 * assumptions should pass every relevant field explicitly.
 *
 * @example
 * ```ts
 * const environment = createFakeEnvironment({ isTrusted: false });
 * // or later:
 * environment._set({ uiKind: 'web' });
 * ```
 */
export function createFakeEnvironment(initial: Partial<HostEnvironment> = {}): FakeEnvironment {
  let current: HostEnvironment = {
    uiKind: 'desktop',
    remoteName: undefined,
    isTrusted: true,
    workspaceFolderCount: 1,
    hasVirtualWorkspace: false,
    ...initial,
  };

  return {
    read: () => current,
    _set(patch: Partial<HostEnvironment>): void {
      current = { ...current, ...patch };
    },
  };
}
