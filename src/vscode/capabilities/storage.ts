/**
 * Storage adapters over the activation-time `ExtensionContext`. Typed
 * serialization, migrations and key policy remain in the capability layer;
 * these functions preserve the native Memento/SecretStorage semantics only.
 */
import type * as vscode from 'vscode';

import type {
  PlatformRegistration,
  SecretsCapability,
  StorageCapability,
} from '../../foundation/platform/ports.js';

/**
 * The real storage capability, backed by an `ExtensionContext`.
 *
 * Created at activation because the context does not exist during module
 * evaluation. `global` and `workspace` are passed through structurally so VS
 * Code remains responsible for persistence and Settings Sync behavior.
 *
 * @example
 * ```ts
 * const storage = createVSCodeStorageCapability(context);
 * ```
 */
export function createVSCodeStorageCapability(context: vscode.ExtensionContext): StorageCapability {
  return {
    global: context.globalState,
    workspace: context.workspaceState,
    setKeysForSync(keys: readonly string[]): void {
      context.globalState.setKeysForSync([...keys]);
    },
  };
}

/**
 * The real secrets capability, backed by `context.secrets`.
 *
 * Values never enter logs or diagnostics here. The promise normalization is
 * only a port-shape concern; it does not make the in-memory fake a security
 * boundary, so tests may inspect fake secret values deliberately.
 *
 * @example
 * ```ts
 * const secrets = createVSCodeSecretsCapability(context);
 * ```
 */
export function createVSCodeSecretsCapability(context: vscode.ExtensionContext): SecretsCapability {
  return {
    get(key: string): Promise<string | undefined> {
      return Promise.resolve(context.secrets.get(key));
    },

    store(key: string, value: string): Promise<void> {
      return Promise.resolve(context.secrets.store(key, value));
    },

    delete(key: string): Promise<void> {
      return Promise.resolve(context.secrets.delete(key));
    },

    keys(): Promise<readonly string[]> {
      return Promise.resolve(context.secrets.keys());
    },

    onDidChange(listener: (key: string) => void): PlatformRegistration {
      return context.secrets.onDidChange((event) => {
        listener(event.key);
      });
    },
  };
}
