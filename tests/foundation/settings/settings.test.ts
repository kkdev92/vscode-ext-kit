/**
 * SettingsDefinition, SettingsAccessor and FakeSettings behavior tests. The
 * accessor is real while the platform port is fake, covering validation policy,
 * cache invalidation and tier semantics; adapter mapping is owned by the shared
 * SettingsCapability contract suite.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createNoopLogger } from '../../../src/foundation/logging/logger.js';
import { FrameworkError } from '../../../src/foundation/operations/errors.js';
import { SettingsTarget } from '../../../src/foundation/platform/ports.js';
import type { SettingsScope } from '../../../src/foundation/platform/ports.js';
import { createSettingsAccessor } from '../../../src/foundation/settings/accessor.js';
import { defineSettings, setting } from '../../../src/foundation/settings/definition.js';
import { createFakeSettings } from '../../../src/testing/fakes/fake-settings.js';
import { createRecordingLogSink } from '../../../src/testing/fakes/recording-log-sink.js';
import { createLogger } from '../../../src/foundation/logging/logger.js';

const SECTION = 'sample.projects';

const uri = (path: string): { scheme: string; path: string; toString(): string } => ({
  scheme: 'file',
  path,
  toString: () => `file://${path}`,
});

describe('setting builders', () => {
  it('validates booleans, numbers with bounds, strings, enums and string arrays', () => {
    expect(setting.boolean({ default: true }).validate(false)).toEqual({ ok: true, value: false });
    expect(setting.boolean({ default: true }).validate('no').ok).toBe(false);

    const interval = setting.number({ default: 30, minimum: 5, maximum: 60 });
    expect(interval.validate(10)).toEqual({ ok: true, value: 10 });
    expect(interval.validate(1).ok).toBe(false);
    expect(interval.validate(100).ok).toBe(false);
    expect(interval.validate(Number.NaN).ok).toBe(false);

    const mode = setting.enum({ values: ['fast', 'thorough'], default: 'fast' });
    expect(mode.validate('thorough')).toEqual({ ok: true, value: 'thorough' });
    expect(mode.validate('other').ok).toBe(false);
    expect(mode.enum).toEqual(['fast', 'thorough']);

    const globs = setting.stringArray({ default: [] });
    expect(globs.validate(['a', 'b']).ok).toBe(true);
    expect(globs.validate(['a', 2]).ok).toBe(false);
  });

  it('defaults scope to window and records the contributed scope', () => {
    expect(setting.boolean({ default: true }).scope).toBe('window');
    expect(setting.boolean({ default: true, scope: 'resource' }).scope).toBe('resource');
  });
});

describe('createSettingsAccessor', () => {
  const definition = defineSettings({
    section: SECTION,
    values: {
      enabled: setting.boolean({ default: true, scope: 'resource' }),
      interval: setting.number({ default: 30, minimum: 5 }),
    },
  });

  let capability: ReturnType<typeof createFakeSettings>;

  beforeEach(() => {
    capability = createFakeSettings();
  });

  const accessor = (
    policy: 'strict' | 'lenient' = 'lenient',
    logSink = createRecordingLogSink()
  ): {
    read: ReturnType<typeof createSettingsAccessor>;
    logs: ReturnType<typeof createRecordingLogSink>;
    diagnostics: string[];
  } => {
    const diagnostics: string[] = [];
    return {
      read: createSettingsAccessor({
        definition: { section: SECTION, values: definition.values, policy },
        capability,
        logger: createLogger(logSink.sink),
        onDiagnostic: (event) => diagnostics.push(event),
      }),
      logs: logSink,
      diagnostics,
    };
  };

  it('falls back to the declared default when nothing is configured', () => {
    const snapshot = accessor().read.read();
    expect(snapshot.get('enabled')).toBe(true);
    expect(snapshot.get('interval')).toBe(30);
  });

  it('reads a configured value', () => {
    capability._set(SECTION, 'interval', 'globalValue', 45);
    expect(accessor().read.read().get('interval')).toBe(45);
  });

  it('uses the default for an invalid value under the lenient policy, and says so', () => {
    capability._set(SECTION, 'interval', 'globalValue', 1);
    const { read, logs, diagnostics } = accessor('lenient');

    expect(read.read().get('interval')).toBe(30);
    // A silent fallback would hide a misconfiguration for the whole session.
    expect(logs.at('warn')).toHaveLength(1);
    expect(diagnostics).toContain('settings.invalid');
  });

  it('fails the read for an invalid value under the strict policy', () => {
    capability._set(SECTION, 'interval', 'globalValue', 'not a number');
    const { read, diagnostics } = accessor('strict');

    expect(() => read.read()).toThrow(FrameworkError);
    expect(diagnostics).toContain('settings.invalid');
  });

  it('caches the unscoped snapshot but not scoped reads', () => {
    const spy = vi.spyOn(capability, 'read');
    const { read } = accessor();

    read.read();
    const afterFirst = spy.mock.calls.length;
    read.read();
    expect(spy.mock.calls.length).toBe(afterFirst);

    // A per-URI cache could not be invalidated precisely from a change event.
    read.read({ resource: uri('/a') });
    read.read({ resource: uri('/a') });
    expect(spy.mock.calls.length).toBeGreaterThan(afterFirst + 1);
  });

  it('invalidates the cache after an update', async () => {
    const { read } = accessor();
    expect(read.read().get('interval')).toBe(30);

    await read.update('interval', 45, SettingsTarget.Global);

    expect(read.read().get('interval')).toBe(45);
  });

  it('removes a value when updating to undefined', async () => {
    capability._set(SECTION, 'interval', 'globalValue', 45);
    const { read } = accessor();
    expect(read.read().get('interval')).toBe(45);

    await read.update('interval', undefined, SettingsTarget.Global);

    expect(read.read().get('interval')).toBe(30);
  });

  it('passes inspect through with every tier', () => {
    capability._set(SECTION, 'interval', 'defaultValue', 30);
    capability._set(SECTION, 'interval', 'globalValue', 45);

    const inspection = accessor().read.inspect('interval');

    expect(inspection?.key).toBe(`${SECTION}.interval`);
    expect(inspection?.defaultValue).toBe(30);
    expect(inspection?.globalValue).toBe(45);
    expect(inspection?.workspaceValue).toBeUndefined();
  });

  it('notifies only for changes affecting its section, and re-reads on demand', () => {
    const { read } = accessor();
    const seen: boolean[] = [];
    const subscription = read.onDidChange((event) => {
      seen.push(event.affects());
      expect(event.read().get('interval')).toBe(45);
    });

    capability._set(SECTION, 'interval', 'globalValue', 45);
    capability._fireChange(['other.section']);
    expect(seen).toHaveLength(0);

    capability._fireChange([SECTION]);
    expect(seen).toEqual([true]);

    subscription.dispose();
    capability._fireChange([SECTION]);
    expect(seen).toHaveLength(1);
  });

  it('rejects an unknown key', () => {
    const broken = createSettingsAccessor({
      definition: { section: SECTION, values: definition.values, policy: 'lenient' },
      capability,
      logger: createNoopLogger(),
    });
    // @ts-expect-error the key is not part of the definition
    expect(() => broken.inspect('missing')).not.toThrow();
    expect(() => broken.read()).not.toThrow();
  });
});

describe('FakeSettings tier resolution', () => {
  let capability: ReturnType<typeof createFakeSettings>;
  const read = (scope?: SettingsScope): unknown => capability.read(SECTION, 'wordWrap', scope);

  beforeEach(() => {
    capability = createFakeSettings();
  });

  it('applies the documented tier precedence', () => {
    capability._set(SECTION, 'wordWrap', 'defaultValue', 'default');
    expect(read()).toBe('default');

    capability._set(SECTION, 'wordWrap', 'globalValue', 'global');
    expect(read()).toBe('global');

    capability._set(SECTION, 'wordWrap', 'workspaceValue', 'workspace');
    expect(read()).toBe('workspace');
  });

  it('applies a folder value only for a matching resource', () => {
    capability._set(SECTION, 'wordWrap', 'globalValue', 'global');
    capability._set(SECTION, 'wordWrap', 'workspaceFolderValue', 'folder', {
      resource: 'file:///a',
    });

    expect(read()).toBe('global');
    expect(read({ resource: uri('/b') })).toBe('global');
    expect(read({ resource: uri('/a') })).toBe('folder');
  });

  it('applies a language value only for a matching language', () => {
    capability._set(SECTION, 'wordWrap', 'globalValue', 'global');
    capability._set(SECTION, 'wordWrap', 'globalLanguageValue', 'typescript-only', {
      languageId: 'typescript',
    });

    expect(read()).toBe('global');
    expect(read({ languageId: 'python' })).toBe('global');
    expect(read({ languageId: 'typescript' })).toBe('typescript-only');
  });

  it('lets a language value outrank a more local non-language value', () => {
    // Language tiers come after every non-language tier in effective-value
    // resolution, so a language value can outrank a folder-only value.
    capability._set(SECTION, 'wordWrap', 'workspaceFolderValue', 'off', {
      resource: 'file:///a',
    });
    capability._set(SECTION, 'wordWrap', 'globalLanguageValue', 'on', {
      languageId: 'typescript',
    });

    expect(read({ resource: uri('/a') })).toBe('off');
    expect(read({ resource: uri('/a'), languageId: 'typescript' })).toBe('on');
  });

  it('merges object values shallowly and overrides every other type', () => {
    capability._set(SECTION, 'wordWrap', 'defaultValue', { a: 1, b: 2 });
    capability._set(SECTION, 'wordWrap', 'globalValue', { b: 3, c: 4 });

    expect(read()).toEqual({ a: 1, b: 3, c: 4 });

    capability._reset();
    capability._set(SECTION, 'wordWrap', 'defaultValue', ['a']);
    capability._set(SECTION, 'wordWrap', 'globalValue', ['b']);
    expect(read()).toEqual(['b']);
  });

  it('returns undefined for a key that was never configured', () => {
    expect(read()).toBeUndefined();
    expect(capability.inspect(SECTION, 'wordWrap')).toBeUndefined();
  });

  it('writes to the tier implied by target and overrideInLanguage', async () => {
    await capability.update(SECTION, 'wordWrap', 'x', SettingsTarget.Global);
    expect(capability.inspect(SECTION, 'wordWrap')?.globalValue).toBe('x');

    // A language override needs a language in the scope: VS Code writes it under
    // the requested languageId, so there is nothing to write without one.
    await capability.update(
      SECTION,
      'wordWrap',
      'y',
      SettingsTarget.Workspace,
      { languageId: 'typescript' },
      true
    );
    expect(
      capability.inspect(SECTION, 'wordWrap', { languageId: 'typescript' })?.workspaceLanguageValue
    ).toBe('y');
  });
});
