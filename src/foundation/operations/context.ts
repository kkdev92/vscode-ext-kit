import type { CommandsService } from '../../capabilities/commands/commands.js';
import type { EditorService } from '../../capabilities/editor/editor.js';
import type { LocalizationService } from '../../capabilities/l10n/localization.js';
import type { NotificationService } from '../../capabilities/ui/notifications.js';
import type { QuickInputService } from '../../capabilities/ui/quick-input-service.js';
import type { StatusBarService } from '../../capabilities/ui/status-bar-service.js';
import type { Logger } from '../logging/logger.js';
import type { ResourceScope } from '../resources/resource-scope.js';
import type { ServiceResolver } from '../services/container.js';
import type { OperationProgress } from './progress.js';

/**
 * What kind of ingress created an Operation. The value is included in its id,
 * logger fields and diagnostics; it does not change execution semantics.
 */
export const OperationKind = {
  Command: 'command',
  FileWatcher: 'file-watcher',
  /** Work the application started itself, through the `Operations` service. */
  Task: 'task',
} as const;

/** Union of {@link OperationKind} values. */
export type OperationKind = (typeof OperationKind)[keyof typeof OperationKind];

/**
 * Execution context for one bounded unit of Application work.
 *
 * Identity, cancellation, a scope, a logger, timing — and the handful of
 * services a handler body almost always reaches for. Those last are resolved
 * lazily on first access, so an application that never notifies never builds a
 * notifier, and one running without a quick-input capability only finds out if
 * it asks.
 *
 * The standard service properties are shorthand, not a second service graph:
 * `context.notify`, for example, resolves the exact `Notifications` token that
 * an explicit `inject` would. `context.logger` is different by design: it is a
 * child logger enriched with this Operation's fields, whereas resolving `Log`
 * outside an Operation gives the Application logger. Declare token dependencies
 * with `inject` where there is no context to read — a service factory, hosted
 * service or tree-view provider.
 *
 * @example
 * ```ts
 * module.commands.handle(Clear, async (context) => {
 *   if (await context.notify.confirm(context.l10n.t('Clear everything?'))) {
 *     context.logger.info('cleared');
 *   }
 * });
 * ```
 */
export interface OperationContext {
  /** Unique within the application run. */
  readonly id: string;
  /** What kind of work this is. */
  readonly kind: OperationKind;
  /** Descriptor name, for example the command id. */
  readonly name: string;
  /** Aborts on application stop, caller cancellation or timeout. */
  readonly signal: AbortSignal;
  /** Logger pre-populated with the operation's fields. */
  readonly logger: Logger;
  /**
   * Disposed after the Operation settles and owns disposable transients resolved
   * through `services`. Its own `ResourceScope.signal` is inherited unchanged
   * from the parent scope; use `context.signal` for the combined Application,
   * caller and timeout cancellation sources.
   */
  readonly resources: ResourceScope;
  /** Resolves services, owning disposable transients in this operation's scope. */
  readonly services: ServiceResolver;
  /**
   * Progress sessions for this operation. Headless (no UI, operation signal
   * passthrough) when the application has no progress capability.
   */
  readonly progress: OperationProgress;
  /** Milliseconds since the epoch when the operation started. */
  readonly startedAt: number;

  /** Messages and confirmations. Resolved on first access. */
  readonly notify: NotificationService;
  /** Quick picks, input boxes and the wizard. Resolved on first access. */
  readonly ask: QuickInputService;
  /** The display language, and formatting for it. Resolved on first access. */
  readonly l10n: LocalizationService;
  /** Reading and editing text. Resolved on first access. */
  readonly editors: EditorService;
  /** Invoking commands, this application's and the platform's. Resolved on first access. */
  readonly commands: CommandsService;
  /** Short-lived status bar messages. Resolved on first access. */
  readonly status: StatusBarService;
}

let sequence = 0;

/**
 * Produces a process-local, monotonically sequenced Operation id without
 * randomness, keeping the core usable in browser and worker hosts.
 *
 * @example
 * ```ts
 * nextOperationId('command', 'sample.refresh'); // command:sample.refresh#<sequence>
 * ```
 */
export function nextOperationId(kind: OperationKind, name: string): string {
  sequence += 1;
  return `${kind}:${name}#${String(sequence)}`;
}
