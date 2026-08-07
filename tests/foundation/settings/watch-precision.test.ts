/**
 * Focused SettingsAccessor.watch regression tests using an instrumented
 * SettingsCapability. The suite protects per-key read cost, change de-duplication
 * and strict-validation isolation inside platform event dispatch; general
 * settings behavior is covered separately.
 */
import { describe, expect, it, vi } from 'vitest';

import { createSettingsAccessor } from '../../../src/foundation/settings/accessor.js';
import { SettingsValidationPolicy, setting } from '../../../src/foundation/settings/definition.js';
import type { Logger } from '../../../src/foundation/logging/logger.js';
import type {
  PlatformRegistration,
  SettingsCapability,
  SettingsChangeSource,
} from '../../../src/foundation/platform/ports.js';

/** A capability that counts reads and lets a test fire a change by hand. */
function countingCapability(values: Record<string, unknown>) {
  const reads: string[] = [];
  const listeners: ((source: SettingsChangeSource) => void)[] = [];
  const capability: SettingsCapability = {
    read<T>(_section: string, key: string): T | undefined {
      reads.push(key);
      return values[key] as T | undefined;
    },
    inspect: () => undefined,
    update: () => Promise.resolve(),
    onDidChange(listener): PlatformRegistration {
      listeners.push(listener);
      return { dispose: () => undefined };
    },
  };
  return {
    capability,
    reads,
    /** Fires a change that affects the section, like any key edit under it. */
    fireSectionChange: (): void => {
      for (const listener of [...listeners]) {
        listener({ affects: () => true });
      }
    },
  };
}

const recordingLogger = (): Logger & { readonly warnings: string[] } => {
  const warnings: string[] = [];
  const logger: Logger & { readonly warnings: string[] } = {
    warnings,
    trace: () => undefined,
    debug: () => undefined,
    info: () => undefined,
    warn: (message: string) => warnings.push(message),
    error: () => undefined,
    withFields: () => logger,
  };
  return logger;
};

describe('settings watch precision', () => {
  const specs = {
    watched: setting.number({ default: 0 }),
    sibling: setting.number({ default: 0 }),
    another: setting.number({ default: 0 }),
  };

  it('reads only the watched key, not the whole section', () => {
    const { capability, reads, fireSectionChange } = countingCapability({ watched: 1 });
    const accessor = createSettingsAccessor({
      definition: { section: 'demo', values: specs, policy: SettingsValidationPolicy.Lenient },
      capability,
      logger: recordingLogger(),
    });

    accessor.watch('watched', undefined, () => undefined);
    reads.length = 0;
    fireSectionChange();

    // Rebuilding the section snapshot made this O(keys) per watcher per event.
    expect(reads).toEqual(['watched']);
    accessor.dispose();
  });

  it('does not fire for a change that leaves the value alone', () => {
    const values: Record<string, unknown> = { watched: 5 };
    const { capability, fireSectionChange } = countingCapability(values);
    const accessor = createSettingsAccessor({
      definition: { section: 'demo', values: specs, policy: SettingsValidationPolicy.Lenient },
      capability,
      logger: recordingLogger(),
    });

    const seen: number[] = [];
    accessor.watch('watched', undefined, (value) => seen.push(value));

    // A sibling key changed: the section is affected, this value is not.
    fireSectionChange();
    expect(seen).toEqual([5]); // first change seeds the remembered value
    fireSectionChange();
    expect(seen).toEqual([5]); // unchanged, so no second call

    values['watched'] = 9;
    fireSectionChange();
    expect(seen).toEqual([5, 9]);
    accessor.dispose();
  });

  it('is unaffected by an invalid sibling key under strict policy', () => {
    // The whole-snapshot read threw for a sibling's invalid value, so a
    // perfectly valid watched key never reached its listener.
    const { capability, fireSectionChange } = countingCapability({
      watched: 3,
      sibling: 'not-a-number',
    });
    const accessor = createSettingsAccessor({
      definition: { section: 'demo', values: specs, policy: SettingsValidationPolicy.Strict },
      capability,
      logger: recordingLogger(),
    });

    const seen: number[] = [];
    expect(() => {
      accessor.watch('watched', undefined, (value) => seen.push(value));
      fireSectionChange();
    }).not.toThrow();
    expect(seen).toEqual([3]);
    accessor.dispose();
  });

  it('logs and keeps the previous value when the watched key itself turns invalid', () => {
    const values: Record<string, unknown> = { watched: 3 };
    const { capability, fireSectionChange } = countingCapability(values);
    const logger = recordingLogger();
    const accessor = createSettingsAccessor({
      definition: { section: 'demo', values: specs, policy: SettingsValidationPolicy.Strict },
      capability,
      logger,
    });

    const seen: number[] = [];
    accessor.watch('watched', undefined, (value) => seen.push(value));
    fireSectionChange();
    expect(seen).toEqual([3]);

    values['watched'] = 'broken';
    // Throwing here would escape into the platform's event dispatch.
    expect(() => fireSectionChange()).not.toThrow();
    expect(seen).toEqual([3]);
    expect(logger.warnings.join(' ')).toMatch(/watched setting is invalid/);
    accessor.dispose();
  });

  it('scales linearly with watchers instead of quadratically', () => {
    const many: Record<string, ReturnType<typeof setting.number>> = {};
    const values: Record<string, unknown> = {};
    for (let index = 0; index < 50; index += 1) {
      many[`key${String(index)}`] = setting.number({ default: 0 });
      values[`key${String(index)}`] = index;
    }
    const { capability, reads, fireSectionChange } = countingCapability(values);
    const accessor = createSettingsAccessor({
      definition: { section: 'demo', values: many, policy: SettingsValidationPolicy.Lenient },
      capability,
      logger: recordingLogger(),
    });

    for (let index = 0; index < 50; index += 1) {
      accessor.watch(`key${String(index)}`, undefined, () => undefined);
    }
    reads.length = 0;
    fireSectionChange();

    // One relevant change performs one read per watcher, independent of how
    // many sibling keys the section declares.
    expect(reads).toHaveLength(50);
    accessor.dispose();
  });

  it('still rebuilds the whole snapshot for onDidChange, which is section-wide', () => {
    const { capability, reads, fireSectionChange } = countingCapability({ watched: 1 });
    const accessor = createSettingsAccessor({
      definition: { section: 'demo', values: specs, policy: SettingsValidationPolicy.Lenient },
      capability,
      logger: recordingLogger(),
    });

    const snapshots = vi.fn();
    accessor.onDidChange((event) => {
      snapshots(event.read().values);
    });
    reads.length = 0;
    fireSectionChange();

    expect(snapshots).toHaveBeenCalledTimes(1);
    expect(reads).toEqual(['watched', 'sibling', 'another']);
    accessor.dispose();
  });
});
