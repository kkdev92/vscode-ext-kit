import { ModuleCompatibility } from '../modules/compatibility.js';
import type { HostEnvironment } from '../platform/ports.js';
import type { ApplicationPlan } from './plan.js';

/**
 * How seriously to treat a runtime-preflight finding.
 *
 * The distinction matters: an unsatisfied hard requirement or a declared
 * impossible host combination blocks activation. Cautionary metadata such as an
 * unspecified web compatibility claim is reported without preventing startup.
 */
export const PreflightSeverity = {
  /** Activation cannot succeed. */
  Error: 'error',
  /** Suspicious but survivable; logged and reported.  */
  Warning: 'warning',
} as const;

/** Union of {@link PreflightSeverity} values. */
export type PreflightSeverity = (typeof PreflightSeverity)[keyof typeof PreflightSeverity];

/** One runtime-preflight finding associated with a Module. */
export interface RuntimeIssue {
  readonly severity: PreflightSeverity;
  /** Stable, machine-readable code. */
  readonly code: string;
  readonly message: string;
  /** Module the finding belongs to. */
  readonly moduleId: string;
}

/**
 * The second preflight stage, run when the host starts.
 *
 * Definition-time compilation cannot see any of this: whether a folder is open,
 * whether the workspace is trusted, whether the host is a browser worker, or
 * whether the workspace is virtual. So requirements that depend on the host are
 * checked here, before a single Module binds — a Module that cannot work says so
 * up front instead of failing somewhere confusing later.
 *
 * @example
 * ```ts
 * const issues = runtimePreflight(plan, environment.read());
 * const errors = issues.filter((issue) => issue.severity === 'error');
 * if (errors.length > 0) {
 *   throw new PreflightError(errors.map((issue) => issue.message));
 * }
 * ```
 *
 * This function is pure and reports all findings in Module order. The caller
 * decides which severities block activation.
 */
export function runtimePreflight(
  plan: ApplicationPlan,
  environment: HostEnvironment
): readonly RuntimeIssue[] {
  const issues: RuntimeIssue[] = [];

  for (const module of plan.modules) {
    const { requires, compatibility } = module;

    if (requires.workspace === true && environment.workspaceFolderCount === 0) {
      issues.push({
        severity: PreflightSeverity.Error,
        code: 'WORKSPACE_REQUIRED',
        message: `Module "${module.id}" requires an open workspace folder, but none is open.`,
        moduleId: module.id,
      });
    }

    if (requires.trust === true && !environment.isTrusted) {
      issues.push({
        severity: PreflightSeverity.Error,
        code: 'TRUST_REQUIRED',
        message: `Module "${module.id}" requires a trusted workspace.`,
        moduleId: module.id,
      });
    }

    if (requires.localFileSystem === true && environment.hasVirtualWorkspace) {
      issues.push({
        severity: PreflightSeverity.Error,
        code: 'LOCAL_FILESYSTEM_REQUIRED',
        message:
          `Module "${module.id}" requires local file paths, but a workspace folder uses a ` +
          'non-file scheme.',
        moduleId: module.id,
      });
    }

    if (compatibility === ModuleCompatibility.WorkspaceNode && environment.uiKind === 'web') {
      issues.push({
        severity: PreflightSeverity.Error,
        code: 'NODE_MODULE_IN_WEB_HOST',
        message: `Module "${module.id}" is declared workspace-node but the host is the web host.`,
        moduleId: module.id,
      });
    }

    // A hint, not proof: self-declared metadata cannot establish web safety, so
    // this warns rather than refusing to start.
    if (compatibility === ModuleCompatibility.Unspecified && environment.uiKind === 'web') {
      issues.push({
        severity: PreflightSeverity.Warning,
        code: 'COMPATIBILITY_UNSPECIFIED_IN_WEB_HOST',
        message:
          `Module "${module.id}" does not declare compatibility and is running in the web host. ` +
          'Declare web-safe once verified, or workspace-node if it needs Node.',
        moduleId: module.id,
      });
    }

    if (compatibility === ModuleCompatibility.UiPreferred && environment.remoteName !== undefined) {
      issues.push({
        severity: PreflightSeverity.Warning,
        code: 'UI_PREFERRED_ON_REMOTE',
        message:
          `Module "${module.id}" prefers the UI side, but this extension host is remote ` +
          `("${environment.remoteName}"). Consider extensionKind.`,
        moduleId: module.id,
      });
    }
  }

  return issues;
}
