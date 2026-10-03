import type {
  PlatformRegistration,
  ResourceUri,
  WatchedUri,
  WorkspaceCapability,
  WorkspaceFolderLike,
} from '../../foundation/platform/ports.js';
import { serviceToken } from '../../foundation/services/token.js';
import type { ServiceToken } from '../../foundation/services/token.js';

/**
 * The open workspace folders, and where a resource sits among them.
 *
 * Which folder a resource is in, and how its path is written relative to it,
 * are VS Code's answers: with folders nested the innermost wins, letter case is
 * compared the way the resource's file system compares it, and with more than
 * one folder open a relative path starts with the folder's name — the same
 * text the Explorer shows. Asking VS Code rather than comparing paths here is
 * what keeps a multi-root or remote workspace from being a special case.
 *
 * Its shape is the workspace capability's, so `createFakeWorkspace` from
 * `/testing` stands in for it in a unit test of a feature that takes the
 * service, with no test host around it.
 *
 * @example
 * ```ts
 * module.commands.handle(Export, {
 *   inject: { workspace: Workspace },
 *   execute: async (context, [target], { workspace }) => {
 *     if (workspace.folderOf(target) === undefined) {
 *       await context.notify.warn(context.l10n.t('Choose a folder inside the workspace.'));
 *       return;
 *     }
 *     await context.notify.info(
 *       context.l10n.t('Exported to {0}', workspace.relativePath(target))
 *     );
 *   },
 * });
 * ```
 */
export interface WorkspaceService {
  /** The open folders, in the order VS Code lists them, read when called. */
  folders(): readonly WorkspaceFolderLike[];
  /** The folder `uri` is in, the innermost when folders nest, or undefined. */
  folderOf(uri: ResourceUri): WorkspaceFolderLike | undefined;
  /**
   * `uri` relative to the folder it is in, with `/` between segments.
   *
   * A resource in no folder comes back as its file system path. A folder
   * itself is looked up from the directory it sits in, so it is named relative
   * to a folder around that directory, or comes back as its file system path
   * when there is none.
   *
   * @param includeFolderName - Start with the folder's name. When omitted, it
   *   does exactly when more than one folder is open, as the Explorer does.
   */
  relativePath(uri: WatchedUri, includeFolderName?: boolean): string;
  /**
   * Calls `listener` after folders are added, removed or changed.
   *
   * The caller owns the subscription. One still open when the application
   * stops is released with it, so a forgotten one lasts for the session rather
   * than past it.
   */
  onDidChangeFolders(listener: () => void): PlatformRegistration;
}

/** Injects the application's {@link WorkspaceService}. */
export const Workspace: ServiceToken<WorkspaceService> =
  serviceToken<WorkspaceService>('framework.workspace');

/**
 * Builds the workspace service over a capability.
 *
 * The service tracks the subscriptions it hands out so that disposing it
 * releases the ones still open, and forgets one its caller disposed.
 *
 * @example
 * ```ts
 * const workspace = createWorkspaceService(capability);
 * const names = workspace.folders().map((folder) => folder.name);
 * ```
 */
export function createWorkspaceService(
  capability: WorkspaceCapability
): WorkspaceService & { dispose(): void } {
  const open = new Set<PlatformRegistration>();
  let disposed = false;

  return {
    folders: () => capability.folders(),

    folderOf: (uri) => capability.folderOf(uri),

    relativePath: (uri, includeFolderName) => capability.relativePath(uri, includeFolderName),

    onDidChangeFolders(listener: () => void): PlatformRegistration {
      if (disposed) {
        // Past teardown nothing would ever release it, so it is never made.
        return { dispose: () => undefined };
      }
      const registration = capability.onDidChangeFolders(listener);
      open.add(registration);
      return {
        dispose: () => {
          if (open.delete(registration)) {
            registration.dispose();
          }
        },
      };
    },

    dispose(): void {
      disposed = true;
      for (const registration of open) {
        registration.dispose();
      }
      open.clear();
    },
  };
}
