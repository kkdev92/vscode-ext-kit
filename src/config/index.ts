import * as vscode from 'vscode';

function validatePrefix(prefix: string): void {
  if (typeof prefix !== 'string' || prefix.trim() === '') {
    throw new Error('prefix must be a non-empty string');
  }
}

function validateKey(key: string): void {
  if (typeof key !== 'string' || key.trim() === '') {
    throw new Error('key must be a non-empty string');
  }
}

/**
 * Gets the WorkspaceConfiguration for a given section prefix.
 *
 * @param prefix - Configuration section prefix (e.g., 'myExtension')
 * @returns WorkspaceConfiguration object
 *
 * @example
 * ```typescript
 * const config = getConfig('myExtension');
 * const value = config.get('setting');
 * ```
 */
export function getConfig(prefix: string): vscode.WorkspaceConfiguration {
  validatePrefix(prefix);
  return vscode.workspace.getConfiguration(prefix);
}

/**
 * Gets a typed setting value with optional default.
 *
 * @param prefix - Configuration section prefix
 * @param key - Setting key
 * @param defaultValue - Default value if setting is not defined
 * @returns Setting value or default
 *
 * @example
 * ```typescript
 * const logLevel = getSetting('myExtension', 'logLevel', 'info');
 * const timeout = getSetting<number>('myExtension', 'timeout', 5000);
 * ```
 */
export function getSetting<T>(prefix: string, key: string, defaultValue: T): T;
export function getSetting<T>(prefix: string, key: string): T | undefined;
export function getSetting<T>(prefix: string, key: string, defaultValue?: T): T | undefined {
  validatePrefix(prefix);
  validateKey(key);
  const config = vscode.workspace.getConfiguration(prefix);
  return config.get<T>(key, defaultValue as T);
}

/**
 * Sets a setting value.
 *
 * @param prefix - Configuration section prefix
 * @param key - Setting key
 * @param value - Value to set
 * @param target - Configuration target (default: Global)
 *
 * @example
 * ```typescript
 * await setSetting('myExtension', 'logLevel', 'debug');
 * await setSetting('myExtension', 'timeout', 10000, vscode.ConfigurationTarget.Workspace);
 * ```
 */
export async function setSetting<T>(
  prefix: string,
  key: string,
  value: T,
  target: vscode.ConfigurationTarget = vscode.ConfigurationTarget.Global
): Promise<void> {
  validatePrefix(prefix);
  validateKey(key);
  const config = vscode.workspace.getConfiguration(prefix);
  await config.update(key, value, target);
}

/**
 * Registers a callback for configuration changes.
 *
 * @param prefix - Configuration section prefix to watch
 * @param callback - Function to call when configuration changes
 * @returns Disposable to unregister the listener
 *
 * @example
 * ```typescript
 * context.subscriptions.push(
 *   onConfigChange('myExtension', () => {
 *     const newLevel = getSetting('myExtension', 'logLevel', 'info');
 *     logger.setLevel(newLevel);
 *   })
 * );
 * ```
 */
export function onConfigChange(prefix: string, callback: () => void): vscode.Disposable {
  validatePrefix(prefix);
  return vscode.workspace.onDidChangeConfiguration((e) => {
    if (e.affectsConfiguration(prefix)) {
      callback();
    }
  });
}
