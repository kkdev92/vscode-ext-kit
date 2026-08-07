import type { ServiceMap } from '../../foundation/services/token.js';
import type { TreeViewOptionsLike } from '../../foundation/platform/ports.js';

/**
 * A module-registered tree view. The provider is resolved from the service
 * container at bind time and handed to the platform opaquely; the host owns
 * the native view and, when disposable, the provider. LIFO teardown removes
 * the native view before disposing the provider it invokes.
 */
export interface TreeViewDefinition {
  /** View id, matching the package.json `views` contribution. */
  readonly id: string;
  /** Declared dependencies, resolved once at bind time. */
  readonly dependencies: ServiceMap;
  /**
   * Produces the portable `TreeDataSource`/provider for this view. The erased
   * type keeps the application plan independent of `vscode` runtime types.
   */
  readonly resolveProvider: (injected: Readonly<Record<string, unknown>>) => unknown;
  /** Native view options. */
  readonly options: TreeViewOptionsLike;
  /** Module that registered this view. */
  readonly moduleId: string;
}
