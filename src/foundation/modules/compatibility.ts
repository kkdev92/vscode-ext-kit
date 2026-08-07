/**
 * What kind of host a module can run in.
 *
 * This is self-declared metadata, not static bundle analysis. A declaration of
 * a hard incompatibility (for example Node-only code in a web host) blocks
 * activation; positive or missing compatibility claims can only guide warnings
 * and still require tests in the intended Extension Host.
 */
export const ModuleCompatibility = {
  /** No Node built-ins; loads in the browser/worker host. */
  WebSafe: 'web-safe',
  /** Needs the Node runtime, so it cannot run in the web host. */
  WorkspaceNode: 'workspace-node',
  /** Works anywhere but is better placed on the UI side of a remote. */
  UiPreferred: 'ui-preferred',
  /** Not declared. Treated cautiously rather than assumed safe. */
  Unspecified: 'unspecified',
} as const;

/** Union of {@link ModuleCompatibility} values. */
export type ModuleCompatibility = (typeof ModuleCompatibility)[keyof typeof ModuleCompatibility];

/**
 * What a module needs from the host to work at all.
 *
 * Checked at activation, before any Module binds, so a Module that cannot
 * possibly function says so instead of failing later in a confusing place.
 */
export interface ModuleRequirements {
  /** Needs at least one workspace folder open. */
  readonly workspace?: boolean;
  /** Needs a trusted workspace. */
  readonly trust?: boolean;
  /** Needs real `file:` paths, so a virtual workspace will not do. */
  readonly localFileSystem?: boolean;
}
