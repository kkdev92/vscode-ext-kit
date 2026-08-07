import type { Logger } from '../logging/logger.js';
import type { RegistrationScope } from '../resources/registration-scope.js';
import type { ResourceScope } from '../resources/resource-scope.js';
import type { ServiceResolver } from '../services/container.js';
import type { ServiceMap } from '../services/token.js';

/**
 * What a raw registration is given.
 *
 * Deliberately does **not** hand over a substitutable `vscode` object: the
 * framework cannot fake an arbitrary VS Code API, so pretending otherwise would
 * misrepresent what a Test Host guarantees. Import `vscode` directly and put
 * each returned registration or cleanup into the appropriate Module scope
 * below. The Test Host can verify lifecycle and portable collaborators; behavior
 * that calls the real `vscode` module still needs Extension Host integration
 * coverage.
 */
export interface RawRegistrationContext {
  /**
   * Module RegistrationScope, shared with the Module's other registrations.
   * Own native registrations here so stop closes their ingress synchronously.
   */
  readonly registrations: RegistrationScope;
  /**
   * Module ResourceScope, shared by every raw registration in the Module. Own
   * resource cleanup here; prefer `deferAsync` when the teardown is a
   * promise-returning callback, so the registration site says so.
   */
  readonly resources: ResourceScope;
  /** Logger scoped to this registration. */
  readonly logger: Logger;
  /**
   * Resolves from the Application container, with disposable transients owned
   * by the Module ResourceScope above. Prefer the `injected` argument for actual
   * dependencies so preflight can validate the declared graph; reserve this
   * resolver for genuinely dynamic lookup.
   */
  readonly services: ServiceResolver;
}

/**
 * An escape hatch that keeps framework ownership.
 *
 * For VS Code APIs the framework has no model for. The registration still takes
 * part in the activation transaction and still unwinds on stop, which is what
 * separates this from an unmanaged `import "vscode"` call.
 */
export interface RawRegistrationDefinition {
  /** Unique id, used in diagnostics and preflight. */
  readonly id: string;
  /**
   * Dependencies validated by preflight and resolved once immediately before
   * `bind`. Disposable transients in this map are Application-owned because the
   * activation resolver, rather than `context.services`, resolves them.
   */
  readonly dependencies: ServiceMap;
  /**
   * Performs the registration. The type-level contract is synchronous and
   * returns `undefined`: activation binds Modules transactionally, and an async
   * bind could continue mutating a scope after that transaction committed or
   * rolled back. A thenable return is also detected and rejected at runtime.
   */
  readonly bind: (
    context: RawRegistrationContext,
    injected: Readonly<Record<string, unknown>>
  ) => undefined;
  /** Module that registered this. */
  readonly moduleId: string;
}
