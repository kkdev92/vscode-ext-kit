import type { ServiceMap } from '../../../foundation/services/token.js';
import type { WebviewViewRequest } from '../../../foundation/platform/ports.js';

/**
 * A module-registered webview view.
 *
 * A view contributed in `package.json` is resolved lazily — VS Code calls the
 * provider the first time the user reveals it — so unlike a status bar item
 * there is nothing to create at activation beyond the registration itself.
 */
export interface WebviewViewDefinition {
  /** View id, matching the `views` contribution in package.json. */
  readonly id: string;
  /** Declared dependencies, resolved once at bind time. */
  readonly dependencies: ServiceMap;
  /**
   * Fills the view in when the user first opens it. Receives the managed
   * webview; the return value is awaited, so setting HTML from a template is
   * straightforward.
   */
  readonly resolve: (view: unknown, injected: Readonly<Record<string, unknown>>) => unknown;
  /** Content options for the view. */
  readonly options: WebviewViewRequest;
  /** Module that registered this view. */
  readonly moduleId: string;
}

/**
 * A module-registered panel restorer.
 *
 * VS Code calls it when a window reopens with a panel of this `viewType` still
 * in its tab layout, handing back whatever the content saved with
 * `setState()`.
 */
export interface WebviewPanelSerializerDefinition {
  /** The panel kind this restores, matching what `openPanel` was given. */
  readonly viewType: string;
  /** Declared dependencies, resolved once at bind time. */
  readonly dependencies: ServiceMap;
  /**
   * Fills the restored panel back in. `state` originates in webview content
   * and is untrusted at runtime. The erased plan type does not validate it;
   * the restorer must do so before use.
   */
  readonly restore: (
    panel: unknown,
    state: unknown,
    injected: Readonly<Record<string, unknown>>
  ) => unknown;
  /** Module that registered this restorer. */
  readonly moduleId: string;
}
