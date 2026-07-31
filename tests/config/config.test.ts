import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as vscode from 'vscode';
import { field, defineConfigSchema, watchSetting } from '../../src/config/index.js';
import { s, type StandardSchemaV1 } from '../../src/core/schema.js';

type Mock = ReturnType<typeof vi.fn>;

interface MockWorkspaceConfiguration {
  get: Mock;
  has: Mock;
  inspect: Mock;
  update: Mock;
}

/** Installs a `WorkspaceConfiguration` mock with a controllable `get`. */
function mockConfiguration(
  get: Mock = vi.fn((_key: string, defaultValue?: unknown) => defaultValue)
): MockWorkspaceConfiguration {
  const configuration: MockWorkspaceConfiguration = {
    get,
    has: vi.fn(() => false),
    inspect: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
  };
  vi.mocked(vscode.workspace.getConfiguration).mockReturnValue(configuration as never);
  return configuration;
}

/** Returns the handler passed to the Nth (default: last-registered) `onDidChangeConfiguration` call. */
function changeHandler(callIndex = 0): (e: vscode.ConfigurationChangeEvent) => void {
  return vi.mocked(vscode.workspace.onDidChangeConfiguration).mock.calls[callIndex]![0] as (
    e: vscode.ConfigurationChangeEvent
  ) => void;
}

function affects(section: string): vscode.ConfigurationChangeEvent {
  return {
    affectsConfiguration: (s: string) => s === section,
  } as unknown as vscode.ConfigurationChangeEvent;
}

function affectsNothing(): vscode.ConfigurationChangeEvent {
  return { affectsConfiguration: () => false } as unknown as vscode.ConfigurationChangeEvent;
}

/** Wraps a schema with a spy on `validate`, delegating to the real implementation. */
function spySchema<T>(inner: StandardSchemaV1<unknown, T>) {
  const validate = vi.fn(inner['~standard'].validate);
  const schema: StandardSchemaV1<unknown, T> = {
    '~standard': { version: 1, vendor: 'test', validate },
  };
  return { schema, validate };
}

const logLevels = ['trace', 'debug', 'info', 'warn', 'error', 'silent'] as const;

function makeSchema() {
  return {
    logLevel: field(s.enum(...logLevels), 'info'),
    timeout: field(s.number({ min: 0 }), 5000),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Defensive reset: vitest's `clearMocks` clears call history but keeps any
  // `mockReturnValue`/`mockImplementation` set by a previous test, so make
  // every test start from the same known-default mock shape regardless of
  // execution order.
  mockConfiguration();
  vi.mocked(vscode.workspace.onDidChangeConfiguration).mockImplementation(() => ({
    dispose: vi.fn(),
  }));
});

describe('defineConfigSchema — input validation', () => {
  it('throws on empty section', () => {
    expect(() => defineConfigSchema('', makeSchema())).toThrow(
      'section must be a non-empty string'
    );
  });

  it('throws on whitespace-only section', () => {
    expect(() => defineConfigSchema('   ', makeSchema())).toThrow(
      'section must be a non-empty string'
    );
  });
});

describe('get — validation success and failure fallback', () => {
  it('returns the configured value when it validates', () => {
    mockConfiguration(vi.fn(() => 'debug'));
    const config = defineConfigSchema('myExt', makeSchema());

    expect(config.get('logLevel')).toBe('debug');
  });

  it('returns the default when the setting is unset', () => {
    mockConfiguration(vi.fn((_key: string, defaultValue?: unknown) => defaultValue));
    const config = defineConfigSchema('myExt', makeSchema());

    expect(config.get('logLevel')).toBe('info');
    expect(config.get('timeout')).toBe(5000);
  });

  it('falls back to the default when the stored value fails its schema (enum)', () => {
    mockConfiguration(vi.fn(() => 'not-a-level'));
    const config = defineConfigSchema('myExt', makeSchema());

    expect(config.get('logLevel')).toBe('info');
  });

  it('falls back to the default when the stored value fails its schema (number range)', () => {
    mockConfiguration(vi.fn(() => -5));
    const config = defineConfigSchema('myExt', makeSchema());

    expect(config.get('timeout')).toBe(5000);
  });

  it('falls back to the default when the stored value has the wrong primitive type', () => {
    mockConfiguration(vi.fn(() => 'not-a-number'));
    const config = defineConfigSchema('myExt', makeSchema());

    expect(config.get('timeout')).toBe(5000);
  });

  it('forwards the key and its own default to WorkspaceConfiguration.get', () => {
    const getMock = vi.fn((_key: string, defaultValue?: unknown) => defaultValue);
    mockConfiguration(getMock);
    const config = defineConfigSchema('myExt', makeSchema());

    config.get('timeout');

    expect(getMock).toHaveBeenCalledWith('timeout', 5000);
  });
});

describe('tryGet — reports validation failures instead of hiding them', () => {
  it('returns ok:true with the validated value on success', () => {
    mockConfiguration(vi.fn(() => 'debug'));
    const config = defineConfigSchema('myExt', makeSchema());

    expect(config.tryGet('logLevel')).toEqual({ ok: true, value: 'debug' });
  });

  it('returns ok:true with the default when unset (not a failure)', () => {
    mockConfiguration();
    const config = defineConfigSchema('myExt', makeSchema());

    expect(config.tryGet('logLevel')).toEqual({ ok: true, value: 'info' });
  });

  it('returns ok:false with a fully-qualified key and message on failure', () => {
    mockConfiguration(vi.fn(() => 'not-a-level'));
    const config = defineConfigSchema('myExt', makeSchema());

    const result = config.tryGet('logLevel');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual([
        { key: 'myExt.logLevel', message: expect.stringContaining('must be one of') },
      ]);
      expect(result.cancelled).toBe(false);
    }
  });

  it('reports the timeout range failure independently of logLevel', () => {
    mockConfiguration(vi.fn(() => -1));
    const config = defineConfigSchema('myExt', makeSchema());

    const result = config.tryGet('timeout');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual([
        { key: 'myExt.timeout', message: expect.stringContaining('>= 0') },
      ]);
    }
  });
});

describe('cache — validated value is cached, getConfiguration is not', () => {
  it('calls getConfiguration on every get(), even when the value is unchanged', () => {
    mockConfiguration(vi.fn(() => 'debug'));
    const config = defineConfigSchema('myExt', makeSchema());

    config.get('logLevel');
    config.get('logLevel');
    config.get('logLevel');

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledTimes(3);
  });

  it('skips re-validation when the raw value is unchanged', () => {
    const { schema, validate } = spySchema(s.enum(...logLevels));
    mockConfiguration(vi.fn(() => 'debug'));
    const config = defineConfigSchema('myExt', { logLevel: field(schema, 'info') });

    config.get('logLevel');
    config.get('logLevel');
    config.get('logLevel');

    expect(validate).toHaveBeenCalledTimes(1);
  });

  it('re-validates once the raw value changes', () => {
    const { schema, validate } = spySchema(s.enum(...logLevels));
    const getMock = vi.fn();
    getMock.mockReturnValueOnce('debug').mockReturnValueOnce('debug').mockReturnValueOnce('warn');
    mockConfiguration(getMock);
    const config = defineConfigSchema('myExt', { logLevel: field(schema, 'info') });

    expect(config.get('logLevel')).toBe('debug');
    expect(config.get('logLevel')).toBe('debug');
    expect(config.get('logLevel')).toBe('warn');

    expect(validate).toHaveBeenCalledTimes(2);
  });

  it('caches a failing value too, so tryGet keeps reporting the same failure on repeat reads', () => {
    const { schema, validate } = spySchema(s.enum(...logLevels));
    mockConfiguration(vi.fn(() => 'not-a-level'));
    const config = defineConfigSchema('myExt', { logLevel: field(schema, 'info') });

    const first = config.tryGet('logLevel');
    const second = config.tryGet('logLevel');

    expect(first.ok).toBe(false);
    expect(second.ok).toBe(false);
    expect(validate).toHaveBeenCalledTimes(1);
  });
});

describe('onDidChange — key-level events', () => {
  it('registers a configuration change listener', () => {
    mockConfiguration();
    const config = defineConfigSchema('myExt', makeSchema());

    const disposable = config.onDidChange('logLevel', vi.fn());

    expect(vscode.workspace.onDidChangeConfiguration).toHaveBeenCalledTimes(1);
    expect(disposable).toHaveProperty('dispose');
  });

  it('fires with the freshly-resolved value when its own key changes', () => {
    const getMock = vi.fn(() => 'info');
    mockConfiguration(getMock);
    const config = defineConfigSchema('myExt', makeSchema());
    const listener = vi.fn();
    config.onDidChange('logLevel', listener);

    getMock.mockReturnValue('debug');
    changeHandler()(affects('myExt.logLevel'));

    expect(listener).toHaveBeenCalledWith('debug');
  });

  it('does not fire when a different key changes', () => {
    mockConfiguration(vi.fn(() => 'info'));
    const config = defineConfigSchema('myExt', makeSchema());
    const listener = vi.fn();
    config.onDidChange('logLevel', listener);

    changeHandler()(affects('myExt.timeout'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('does not fire on an unrelated event', () => {
    mockConfiguration(vi.fn(() => 'info'));
    const config = defineConfigSchema('myExt', makeSchema());
    const listener = vi.fn();
    config.onDidChange('logLevel', listener);

    changeHandler()(affectsNothing());

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('onDidChangeAny — whole-section events (onConfigChange replacement)', () => {
  it('fires with the raw event when the section is affected', () => {
    mockConfiguration();
    const config = defineConfigSchema('myExt', makeSchema());
    const listener = vi.fn();
    config.onDidChangeAny(listener);

    const event = affects('myExt');
    changeHandler()(event);

    expect(listener).toHaveBeenCalledWith(event);
  });

  it('does not fire for unrelated sections', () => {
    mockConfiguration();
    const config = defineConfigSchema('myExt', makeSchema());
    const listener = vi.fn();
    config.onDidChangeAny(listener);

    changeHandler()(affectsNothing());

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('scope', () => {
  it('forwards the scope to getConfiguration', () => {
    mockConfiguration();
    const config = defineConfigSchema('myExt', makeSchema());
    const scope = vscode.Uri.file('/workspace/a.ts');

    config.get('logLevel', scope);

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('myExt', scope);
  });

  it('forwards the scope to affectsConfiguration', () => {
    mockConfiguration();
    const config = defineConfigSchema('myExt', makeSchema());
    const scope = vscode.Uri.file('/workspace/a.ts');
    config.onDidChange('logLevel', vi.fn(), scope);

    const affectsConfiguration = vi.fn(() => false);
    changeHandler()({ affectsConfiguration } as unknown as vscode.ConfigurationChangeEvent);

    expect(affectsConfiguration).toHaveBeenCalledWith('myExt.logLevel', scope);
  });

  it('resolves independent values per scope', () => {
    const scopeA = vscode.Uri.file('/a');
    const scopeB = vscode.Uri.file('/b');
    vi.mocked(vscode.workspace.getConfiguration).mockImplementation(
      (_section?: string, scope?: unknown) =>
        ({
          get: vi.fn(() => (scope === scopeA ? 'debug' : scope === scopeB ? 'warn' : 'info')),
          has: vi.fn(),
          inspect: vi.fn(),
          update: vi.fn(),
        }) as never
    );
    const config = defineConfigSchema('myExt', makeSchema());

    expect(config.get('logLevel', scopeA)).toBe('debug');
    expect(config.get('logLevel', scopeB)).toBe('warn');
    expect(config.get('logLevel')).toBe('info');
  });

  it('caches per scope independently, not collapsing distinct scopes into one entry', () => {
    const { schema, validate } = spySchema(s.enum(...logLevels));
    const scopeA = vscode.Uri.file('/a');
    const scopeB = vscode.Uri.file('/b');
    mockConfiguration(vi.fn(() => 'debug')); // same value for every scope

    const config = defineConfigSchema('myExt', { logLevel: field(schema, 'info') });

    config.get('logLevel', scopeA);
    config.get('logLevel', scopeA); // cache hit
    config.get('logLevel', scopeB); // different scope -> must revalidate

    expect(validate).toHaveBeenCalledTimes(2);
  });
});

describe('set (update)', () => {
  it('updates with the Global target by default', async () => {
    const configuration = mockConfiguration();
    const config = defineConfigSchema('myExt', makeSchema());

    await config.set('logLevel', 'debug');

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('myExt');
    expect(configuration.update).toHaveBeenCalledWith(
      'logLevel',
      'debug',
      vscode.ConfigurationTarget.Global,
      undefined
    );
  });

  it('forwards an explicit target and overrideInLanguage', async () => {
    const configuration = mockConfiguration();
    const config = defineConfigSchema('myExt', makeSchema());

    await config.set('logLevel', 'debug', vscode.ConfigurationTarget.Workspace, true);

    expect(configuration.update).toHaveBeenCalledWith(
      'logLevel',
      'debug',
      vscode.ConfigurationTarget.Workspace,
      true
    );
  });
});

describe('getAll', () => {
  it('resolves every declared field', () => {
    mockConfiguration(
      vi.fn((key: string, defaultValue?: unknown) => (key === 'timeout' ? 10 : defaultValue))
    );
    const config = defineConfigSchema('myExt', makeSchema());

    expect(config.getAll()).toEqual({ logLevel: 'info', timeout: 10 });
  });
});

describe('inspect', () => {
  it('delegates to WorkspaceConfiguration.inspect', () => {
    const configuration = mockConfiguration();
    configuration.inspect.mockReturnValue({ key: 'myExt.logLevel', globalValue: 'debug' });
    const config = defineConfigSchema('myExt', makeSchema());

    const result = config.inspect('logLevel');

    expect(configuration.inspect).toHaveBeenCalledWith('logLevel');
    expect(result).toEqual({ key: 'myExt.logLevel', globalValue: 'debug' });
  });
});

describe('checkPackageJsonSync', () => {
  function contextWith(packageJSON: unknown): vscode.ExtensionContext {
    return { extension: { packageJSON } } as unknown as vscode.ExtensionContext;
  }

  it('reports keys declared in the schema but missing from package.json', () => {
    const config = defineConfigSchema('myExt', makeSchema());

    const issues = config.checkPackageJsonSync(
      contextWith({ contributes: { configuration: { properties: { 'myExt.logLevel': {} } } } })
    );

    expect(issues).toEqual(['myExt.timeout']);
  });

  it('returns an empty array when every key is declared', () => {
    const config = defineConfigSchema('myExt', makeSchema());

    const issues = config.checkPackageJsonSync(
      contextWith({
        contributes: {
          configuration: { properties: { 'myExt.logLevel': {}, 'myExt.timeout': {} } },
        },
      })
    );

    expect(issues).toEqual([]);
  });

  it('supports contributes.configuration as an array of groups', () => {
    const config = defineConfigSchema('myExt', makeSchema());

    const issues = config.checkPackageJsonSync(
      contextWith({
        contributes: {
          configuration: [
            { properties: { 'myExt.logLevel': {} } },
            { properties: { 'myExt.timeout': {} } },
          ],
        },
      })
    );

    expect(issues).toEqual([]);
  });

  it('never throws and returns an empty array for malformed packageJSON', () => {
    const config = defineConfigSchema('myExt', makeSchema());

    expect(config.checkPackageJsonSync(contextWith(undefined))).toEqual([]);
    expect(config.checkPackageJsonSync(contextWith(null))).toEqual([]);
    expect(config.checkPackageJsonSync(contextWith({}))).toEqual([
      'myExt.logLevel',
      'myExt.timeout',
    ]);
  });
});

describe('watchSetting — input validation', () => {
  it('throws on empty section', () => {
    expect(() => watchSetting('', 'logLevel', 'info')).toThrow(
      'section must be a non-empty string'
    );
  });

  it('throws on empty key', () => {
    expect(() => watchSetting('myExt', '', 'info')).toThrow('key must be a non-empty string');
  });
});

describe('watchSetting', () => {
  it('exposes the current configured value', () => {
    mockConfiguration(vi.fn(() => 'debug'));

    const watcher = watchSetting('myExt', 'logLevel', 'info');

    expect(watcher.value).toBe('debug');
  });

  it('falls back to defaultValue when unset', () => {
    mockConfiguration();

    const watcher = watchSetting('myExt', 'logLevel', 'info');

    expect(watcher.value).toBe('info');
  });

  it('reads through the section and key', () => {
    const getMock = vi.fn((_key: string, defaultValue?: unknown) => defaultValue);
    mockConfiguration(getMock);

    watchSetting('myExt', 'logLevel', 'info');

    expect(vscode.workspace.getConfiguration).toHaveBeenCalledWith('myExt');
    expect(getMock).toHaveBeenCalledWith('logLevel', 'info');
  });

  it('fires onDidChange with the new value when the key changes', () => {
    const getMock = vi.fn(() => 'info');
    mockConfiguration(getMock);
    const watcher = watchSetting('myExt', 'logLevel', 'info');
    const listener = vi.fn();
    watcher.onDidChange(listener);

    getMock.mockReturnValue('debug');
    changeHandler()(affects('myExt.logLevel'));

    expect(watcher.value).toBe('debug');
    expect(listener).toHaveBeenCalledWith('debug');
  });

  it('does not fire when an unrelated key changes', () => {
    const getMock = vi.fn(() => 'info');
    mockConfiguration(getMock);
    const watcher = watchSetting('myExt', 'logLevel', 'info');
    const listener = vi.fn();
    watcher.onDidChange(listener);

    getMock.mockReturnValue('debug');
    changeHandler()(affects('myExt.timeout'));

    expect(listener).not.toHaveBeenCalled();
    expect(watcher.value).toBe('info');
  });

  it('does not fire when the resolved value is unchanged', () => {
    const getMock = vi.fn(() => 'info');
    mockConfiguration(getMock);
    const watcher = watchSetting('myExt', 'logLevel', 'info');
    const listener = vi.fn();
    watcher.onDidChange(listener);

    changeHandler()(affects('myExt.logLevel'));

    expect(listener).not.toHaveBeenCalled();
  });

  it('dispose tears down the configuration listener and stops future emissions', () => {
    const configDispose = vi.fn();
    vi.mocked(vscode.workspace.onDidChangeConfiguration).mockReturnValue({
      dispose: configDispose,
    } as never);
    const getMock = vi.fn(() => 'info');
    mockConfiguration(getMock);
    const watcher = watchSetting('myExt', 'logLevel', 'info');
    const listener = vi.fn();
    watcher.onDidChange(listener);

    watcher.dispose();

    expect(configDispose).toHaveBeenCalledTimes(1);

    // Even if VS Code still invoked the (supposedly detached) raw handler,
    // the watcher's own emitter is already torn down, so subscribers must
    // not be notified.
    getMock.mockReturnValue('debug');
    changeHandler()(affects('myExt.logLevel'));

    expect(listener).not.toHaveBeenCalled();
  });
});
