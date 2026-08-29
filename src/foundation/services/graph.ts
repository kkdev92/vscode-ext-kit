import type { ServiceDescriptor } from './descriptors.js';
import { ServiceLifetime } from './descriptors.js';
import type { ServiceToken } from './token.js';

/** Categories of service-graph problem, all detectable before instantiation. */
export const ServiceGraphIssueCode = {
  DuplicateToken: 'duplicate-token',
  MissingDependency: 'missing-dependency',
  CircularDependency: 'circular-dependency',
  CaptiveDependency: 'captive-dependency',
} as const;

/** Union of {@link ServiceGraphIssueCode} values. */
export type ServiceGraphIssueCode =
  (typeof ServiceGraphIssueCode)[keyof typeof ServiceGraphIssueCode];

/** A single service-graph problem, carrying enough context to fix it. */
export interface ServiceGraphIssue {
  /** What kind of problem this is. */
  readonly code: ServiceGraphIssueCode;
  /** Human-readable description, including the ids involved. */
  readonly message: string;
  /** Token the problem was found on. */
  readonly tokenId: string;
  /** Module that registered the offending descriptor. */
  readonly moduleId: string;
  /** Dependency path, for cycles and captive dependencies. */
  readonly path?: readonly string[];
}

/**
 * Validates the whole service graph without creating a single instance.
 *
 * Returns every problem found rather than stopping at the first, so one preflight
 * run reports all of them.
 *
 * `provided` names tokens the *Application* registers rather than a Module —
 * the framework services (`Notifications`, `Editors`, `Log`, …). They are
 * satisfiable but absent from `descriptors`, so without this a Module service
 * that injects one would be reported as depending on nothing.
 *
 * @example
 * ```ts
 * const issues = validateServiceGraph(descriptors, { provided: frameworkTokens });
 * if (issues.length > 0) {
 *   throw new PreflightError(
 *     issues.map(({ code, message, moduleId }) => ({ code, message, moduleId }))
 *   );
 * }
 * ```
 */
export function validateServiceGraph(
  descriptors: readonly ServiceDescriptor[],
  options: { readonly provided?: ReadonlySet<ServiceToken<unknown>> | undefined } = {}
): readonly ServiceGraphIssue[] {
  const provided = options.provided ?? new Set<ServiceToken<unknown>>();
  const issues: ServiceGraphIssue[] = [];
  const byToken = new Map<ServiceToken<unknown>, ServiceDescriptor>();

  for (const descriptor of descriptors) {
    const existing = byToken.get(descriptor.token);
    if (existing !== undefined) {
      issues.push({
        code: ServiceGraphIssueCode.DuplicateToken,
        message:
          `Service "${descriptor.token.id}" is registered twice ` +
          `(by "${existing.moduleId}" and "${descriptor.moduleId}").`,
        tokenId: descriptor.token.id,
        moduleId: descriptor.moduleId,
      });
      continue;
    }
    byToken.set(descriptor.token, descriptor);
  }

  for (const descriptor of byToken.values()) {
    for (const [name, dependency] of Object.entries(descriptor.dependencies)) {
      const target = byToken.get(dependency);

      if (target === undefined) {
        if (provided.has(dependency)) {
          // Registered by the application, and always a singleton, so neither
          // the captive check nor the cycle walk below has anything to add.
          continue;
        }
        issues.push({
          code: ServiceGraphIssueCode.MissingDependency,
          message:
            `Service "${descriptor.token.id}" depends on "${dependency.id}" as "${name}", ` +
            'but nothing registers that token.',
          tokenId: descriptor.token.id,
          moduleId: descriptor.moduleId,
        });
        continue;
      }

      // A singleton outliving a shorter-lived dependency would capture a stale
      // instance for the rest of the application's life.
      if (
        descriptor.lifetime === ServiceLifetime.Singleton &&
        target.lifetime === ServiceLifetime.Transient
      ) {
        issues.push({
          code: ServiceGraphIssueCode.CaptiveDependency,
          message:
            `Singleton "${descriptor.token.id}" depends on transient "${target.token.id}" ` +
            `as "${name}". The transient would be captured for the application's lifetime.`,
          tokenId: descriptor.token.id,
          moduleId: descriptor.moduleId,
          path: [descriptor.token.id, target.token.id],
        });
      }
    }
  }

  issues.push(...findCycles(byToken));
  return issues;
}

/** Depth-first cycle search that reports the full path it walked. */
function findCycles(
  byToken: ReadonlyMap<ServiceToken<unknown>, ServiceDescriptor>
): readonly ServiceGraphIssue[] {
  const issues: ServiceGraphIssue[] = [];
  const settled = new Set<ServiceToken<unknown>>();
  const reported = new Set<string>();

  const walk = (token: ServiceToken<unknown>, stack: readonly ServiceToken<unknown>[]): void => {
    const cycleStart = stack.indexOf(token);
    if (cycleStart !== -1) {
      const cycle = [...stack.slice(cycleStart), token].map((entry) => entry.id);
      // Normalise so the same cycle reported from different entry points collapses.
      const signature = [...cycle].slice(0, -1).sort().join('>');
      if (!reported.has(signature)) {
        reported.add(signature);
        const descriptor = byToken.get(token);
        issues.push({
          code: ServiceGraphIssueCode.CircularDependency,
          message: `Circular service dependency: ${cycle.join(' -> ')}.`,
          tokenId: token.id,
          moduleId: descriptor?.moduleId ?? '<unknown>',
          path: cycle,
        });
      }
      return;
    }

    if (settled.has(token)) {
      return;
    }

    const descriptor = byToken.get(token);
    if (descriptor === undefined) {
      // Missing dependencies are reported separately.
      return;
    }

    const nextStack = [...stack, token];
    for (const dependency of Object.values(descriptor.dependencies)) {
      walk(dependency, nextStack);
    }
    settled.add(token);
  };

  for (const token of byToken.keys()) {
    walk(token, []);
  }

  return issues;
}
