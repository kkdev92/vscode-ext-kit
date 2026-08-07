/**
 * Converts the plain settings port to `WorkspaceConfiguration` calls. The
 * framework validates declared values and manages snapshots; VS Code remains
 * authoritative for configuration precedence, scopes and change detection.
 */
import * as vscode from 'vscode';

import type {
  PlatformRegistration,
  SettingsCapability,
  SettingsChangeSource,
  SettingsInspection,
  SettingsScope,
  SettingsTarget,
} from '../../foundation/platform/ports.js';

/**
 * Converts the framework's scope into a `vscode.ConfigurationScope`.
 *
 * VS Code accepts `Uri | TextDocument | WorkspaceFolder | { uri?, languageId }`;
 * the object form is the only one that carries both a resource and a language.
 */
function toConfigurationScope(
  scope: SettingsScope | undefined
): vscode.ConfigurationScope | undefined {
  if (scope === undefined) {
    return undefined;
  }
  const resource = scope.resource as vscode.Uri | undefined;

  if (scope.languageId !== undefined) {
    return resource === undefined
      ? { languageId: scope.languageId }
      : { uri: resource, languageId: scope.languageId };
  }
  return resource;
}

/**
 * The real settings capability, backed by `vscode.workspace`.
 *
 * Reads go through `getConfiguration(section, scope).get(key)` so VS Code's own
 * precedence and object-merge rules apply. Reimplementing that resolution here
 * would let the Test Host and editor disagree about an effective value.
 *
 * @example
 * ```ts
 * const capability = createVSCodeSettingsCapability();
 * ```
 */
export function createVSCodeSettingsCapability(): SettingsCapability {
  return {
    read<T>(section: string, key: string, scope?: SettingsScope): T | undefined {
      return vscode.workspace.getConfiguration(section, toConfigurationScope(scope)).get<T>(key);
    },

    inspect<T>(
      section: string,
      key: string,
      scope?: SettingsScope
    ): SettingsInspection<T> | undefined {
      return vscode.workspace
        .getConfiguration(section, toConfigurationScope(scope))
        .inspect<T>(key);
    },

    async update(
      section: string,
      key: string,
      value: unknown,
      target: SettingsTarget,
      scope?: SettingsScope,
      overrideInLanguage?: boolean
    ): Promise<void> {
      await vscode.workspace
        .getConfiguration(section, toConfigurationScope(scope))
        .update(key, value, target, overrideInLanguage);
    },

    onDidChange(listener: (event: SettingsChangeSource) => void): PlatformRegistration {
      return vscode.workspace.onDidChangeConfiguration((event) => {
        listener({
          // Keep the native predicate lazy. Eagerly reducing the event to a list
          // would lose VS Code's resource/language-aware `affectsConfiguration`
          // semantics and require guessing which keys might matter.
          affects: (section, scope) =>
            event.affectsConfiguration(section, toConfigurationScope(scope)),
        });
      });
    },
  };
}
