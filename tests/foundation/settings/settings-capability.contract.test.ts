/**
 * Shared SettingsCapability contract for the fake and VS Code adapter. An
 * independent `vscode.workspace` stand-in exercises scope/target conversion and
 * configuration-change boundaries; full Extension Host resolution remains an
 * integration concern.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsTarget } from '../../../src/foundation/platform/ports.js';
import type { SettingsCapability } from '../../../src/foundation/platform/ports.js';

// A stand-in for the `vscode.workspace` semantics the adapter relies on: the
// configuration tiers in precedence order, resource tiers keyed by URI,
// language tiers keyed by languageId, and `update(key, undefined)` removing the
// target value.
//
// What this suite proves is that the *adapter maps onto the port correctly* --
// that a section plus key becomes the right `getConfiguration` call, that a
// `SettingsScope` becomes the right `ConfigurationScope` shape, and that targets
// and `overrideInLanguage` are passed through. VS Code's own resolution is its
// business, and the host contract lanes are what exercise that.
const vscodeMock = vi.hoisted(() => {
  interface Entry {
    tier: string;
    value: unknown;
    resource?: string | undefined;
    languageId?: string | undefined;
  }

  const TIERS = [
    'defaultValue',
    'globalValue',
    'workspaceValue',
    'workspaceFolderValue',
    'defaultLanguageValue',
    'globalLanguageValue',
    'workspaceLanguageValue',
    'workspaceFolderLanguageValue',
  ];
  const RESOURCE_TIERS = new Set(['workspaceFolderValue', 'workspaceFolderLanguageValue']);
  const LANGUAGE_TIERS = new Set([
    'defaultLanguageValue',
    'globalLanguageValue',
    'workspaceLanguageValue',
    'workspaceFolderLanguageValue',
  ]);

  const store = new Map<string, Entry[]>();
  const listeners = new Set<(event: unknown) => void>();

  interface Scope {
    resource?: string | undefined;
    languageId?: string | undefined;
  }

  /** Reverses the adapter's ConfigurationScope construction. */
  const toScope = (raw: unknown): Scope => {
    if (raw === undefined || raw === null) {
      return {};
    }
    const candidate = raw as {
      uri?: { toString(): string };
      languageId?: string;
      toString(): string;
    };
    if (typeof candidate.languageId === 'string') {
      return {
        resource: candidate.uri === undefined ? undefined : candidate.uri.toString(),
        languageId: candidate.languageId,
      };
    }
    return { resource: candidate.toString() };
  };

  const applicable = (entry: Entry, scope: Scope): boolean => {
    if (RESOURCE_TIERS.has(entry.tier) && entry.resource !== scope.resource) {
      return false;
    }
    if (LANGUAGE_TIERS.has(entry.tier) && entry.languageId !== scope.languageId) {
      return false;
    }
    return true;
  };

  const getConfiguration = (section: string, rawScope?: unknown) => {
    const scope = toScope(rawScope);
    const path = (key: string): string => `${section}.${key}`;

    return {
      get<T>(key: string): T | undefined {
        const entries = (store.get(path(key)) ?? []).filter((entry) => applicable(entry, scope));
        let winner: Entry | undefined;
        for (const tier of TIERS) {
          const match = entries.find((entry) => entry.tier === tier);
          if (match !== undefined) {
            winner = match;
          }
        }
        return winner?.value as T | undefined;
      },

      inspect(key: string): Record<string, unknown> | undefined {
        const entries = store.get(path(key));
        if (entries === undefined) {
          return undefined;
        }
        const result: Record<string, unknown> = { key: path(key) };
        for (const tier of TIERS) {
          result[tier] = entries.find(
            (entry) => entry.tier === tier && applicable(entry, scope)
          )?.value;
        }
        return result;
      },

      update(
        key: string,
        value: unknown,
        target?: unknown,
        overrideInLanguage?: boolean
      ): Promise<void> {
        const language = overrideInLanguage === true;
        const tier =
          target === 1
            ? language
              ? 'globalLanguageValue'
              : 'globalValue'
            : target === 2
              ? language
                ? 'workspaceLanguageValue'
                : 'workspaceValue'
              : language
                ? 'workspaceFolderLanguageValue'
                : 'workspaceFolderValue';

        const id = path(key);
        const kept = (store.get(id) ?? []).filter(
          (entry) =>
            entry.tier !== tier ||
            entry.resource !== scope.resource ||
            entry.languageId !== scope.languageId
        );
        if (value !== undefined) {
          kept.push({ tier, value, resource: scope.resource, languageId: scope.languageId });
        }
        store.set(id, kept);
        return Promise.resolve();
      },
    };
  };

  return {
    store,
    listeners,
    fire(sections: readonly string[]): void {
      // Model configuration keys as dot-delimited segments: a query is affected
      // when a changed key is exactly that section or lies below it. Marker
      // padding makes the boundary explicit and prevents raw-prefix matches.
      //
      // Written from the algorithm rather than shared with the fake on purpose:
      // a helper used by both would let one wrong rule satisfy the suite twice.
      const MARKER = '\n';
      const padded = `${MARKER}${sections.join(MARKER)}${MARKER}`;
      const event = {
        affectsConfiguration(section: string): boolean {
          const needle = `${MARKER}${section}`;
          const index = padded.indexOf(needle);
          if (index < 0) {
            return false;
          }
          const next = padded.charAt(index + needle.length);
          return next === MARKER || next === '.';
        },
      };
      for (const listener of [...listeners]) {
        listener(event);
      }
    },
    module: {
      workspace: {
        getConfiguration,
        onDidChangeConfiguration(listener: (event: unknown) => void) {
          listeners.add(listener);
          return {
            dispose(): void {
              listeners.delete(listener);
            },
          };
        },
      },
    },
  };
});

vi.mock('vscode', () => vscodeMock.module);

const { createVSCodeSettingsCapability } =
  await import('../../../src/vscode/foundation/settings.js');
const { createFakeSettings } = await import('../../../src/testing/fakes/fake-settings.js');

const SECTION = 'sample.projects';
const uri = (path: string): { scheme: string; path: string; toString(): string } => ({
  scheme: 'file',
  path,
  toString: () => `file://${path}`,
});

/**
 * The `affects()` truth table for `SECTION`.
 *
 * VS Code reports a configuration change as a set of fully qualified leaf keys,
 * so what an extension asks is "did anything under my section move?". The answer
 * is yes for the section itself and for anything below it on a dot-segment
 * boundary, and no in every other direction. A raw string-prefix comparison is
 * therefore invalid.
 */
const AFFECTS_CASES: readonly {
  readonly changed: string;
  readonly affected: boolean;
  readonly why: string;
}[] = [
  { changed: SECTION, affected: true, why: 'the section itself' },
  {
    changed: `${SECTION}.enabled`,
    affected: true,
    why: 'a leaf key under it, which is what VS Code actually reports',
  },
  { changed: `${SECTION}.deep.nested.flag`, affected: true, why: 'depth does not matter' },
  { changed: 'sample.pro', affected: false, why: 'a string prefix is not a segment' },
  { changed: 'sample.projectsExtra.on', affected: false, why: 'a sibling sharing a prefix' },
  { changed: 'sample.other', affected: false, why: 'a sibling section' },
  { changed: 'sample', affected: false, why: 'an ancestor, which carries no news about the child' },
  { changed: 'other.section', affected: false, why: 'nothing to do with it' },
];

/**
 * One suite, run against every implementation of the port. A fake that drifts
 * from the adapter fails here.
 */
function describeSettingsCapability(
  name: string,
  create: () => SettingsCapability,
  seed: (
    section: string,
    key: string,
    tier: string,
    value: unknown,
    placement?: { resource?: string; languageId?: string }
  ) => void
): void {
  describe(name, () => {
    it('returns undefined for an unconfigured key', () => {
      expect(create().read(SECTION, 'enabled')).toBeUndefined();
    });

    it('reads a global value back', () => {
      const capability = create();
      seed(SECTION, 'enabled', 'globalValue', true);

      expect(capability.read<boolean>(SECTION, 'enabled')).toBe(true);
    });

    it('applies a folder value only for the matching resource', () => {
      const capability = create();
      seed(SECTION, 'enabled', 'globalValue', false);
      seed(SECTION, 'enabled', 'workspaceFolderValue', true, { resource: 'file:///a' });

      expect(capability.read<boolean>(SECTION, 'enabled')).toBe(false);
      expect(capability.read<boolean>(SECTION, 'enabled', { resource: uri('/b') })).toBe(false);
      expect(capability.read<boolean>(SECTION, 'enabled', { resource: uri('/a') })).toBe(true);
    });

    it('applies a language value only for the matching language', () => {
      const capability = create();
      seed(SECTION, 'mode', 'globalValue', 'off');
      seed(SECTION, 'mode', 'globalLanguageValue', 'on', { languageId: 'typescript' });

      expect(capability.read<string>(SECTION, 'mode')).toBe('off');
      expect(capability.read<string>(SECTION, 'mode', { languageId: 'python' })).toBe('off');
      expect(capability.read<string>(SECTION, 'mode', { languageId: 'typescript' })).toBe('on');
    });

    it('lets a language value outrank a more local non-language value', () => {
      const capability = create();
      seed(SECTION, 'mode', 'workspaceFolderValue', 'off', { resource: 'file:///a' });
      seed(SECTION, 'mode', 'globalLanguageValue', 'on', { languageId: 'typescript' });

      expect(
        capability.read<string>(SECTION, 'mode', { resource: uri('/a'), languageId: 'typescript' })
      ).toBe('on');
    });

    it('inspects an unknown key as undefined', () => {
      expect(create().inspect(SECTION, 'missing')).toBeUndefined();
    });

    it('inspects the tier a value actually lives in', () => {
      const capability = create();
      seed(SECTION, 'enabled', 'globalValue', true);

      const inspection = capability.inspect<boolean>(SECTION, 'enabled');
      expect(inspection?.key).toBe(`${SECTION}.enabled`);
      expect(inspection?.globalValue).toBe(true);
      expect(inspection?.workspaceValue).toBeUndefined();
    });

    it('writes to the tier implied by the target', async () => {
      const capability = create();

      await capability.update(SECTION, 'enabled', true, SettingsTarget.Global);
      expect(capability.inspect<boolean>(SECTION, 'enabled')?.globalValue).toBe(true);

      await capability.update(SECTION, 'enabled', false, SettingsTarget.Workspace);
      expect(capability.inspect<boolean>(SECTION, 'enabled')?.workspaceValue).toBe(false);
    });

    it('writes a folder value under the given resource', async () => {
      const capability = create();

      await capability.update(SECTION, 'enabled', true, SettingsTarget.WorkspaceFolder, {
        resource: uri('/a'),
      });

      expect(
        capability.inspect<boolean>(SECTION, 'enabled', { resource: uri('/a') })
          ?.workspaceFolderValue
      ).toBe(true);
      expect(
        capability.inspect<boolean>(SECTION, 'enabled', { resource: uri('/b') })
          ?.workspaceFolderValue
      ).toBeUndefined();
    });

    it('writes a language override when asked', async () => {
      const capability = create();

      await capability.update(
        SECTION,
        'mode',
        'on',
        SettingsTarget.Global,
        { languageId: 'typescript' },
        true
      );

      expect(
        capability.inspect<string>(SECTION, 'mode', { languageId: 'typescript' })
          ?.globalLanguageValue
      ).toBe('on');
    });

    it('removes a value when updating to undefined', async () => {
      const capability = create();
      await capability.update(SECTION, 'enabled', true, SettingsTarget.Global);
      expect(capability.read<boolean>(SECTION, 'enabled')).toBe(true);

      await capability.update(SECTION, 'enabled', undefined, SettingsTarget.Global);

      expect(capability.read<boolean>(SECTION, 'enabled')).toBeUndefined();
    });

    describe('affects()', () => {
      for (const { changed, affected, why } of AFFECTS_CASES) {
        it(`${affected ? 'reports' : 'ignores'} a change to "${changed}" — ${why}`, () => {
          const capability = create();
          const seen: boolean[] = [];
          const subscription = capability.onDidChange((event) => {
            seen.push(event.affects(SECTION));
          });

          fireChange(capability, [changed]);

          expect(seen).toEqual([affected]);
          subscription.dispose();
        });
      }

      it('reports a change when any one of several keys affects the section', () => {
        const capability = create();
        const seen: boolean[] = [];
        const subscription = capability.onDidChange((event) => {
          seen.push(event.affects(SECTION));
        });

        fireChange(capability, ['unrelated.thing', `${SECTION}.enabled`, 'other.one']);

        expect(seen).toEqual([true]);
        subscription.dispose();
      });

      it('answers a scoped query the same way, never narrower', () => {
        // The real event narrows a scoped query by diffing the effective value
        // for that scope. Neither implementation here keeps two configuration
        // snapshots, so both over-report — the direction that cannot miss a
        // change. The narrowing is the host lane's to pin.
        const capability = create();
        const seen: boolean[] = [];
        const subscription = capability.onDidChange((event) => {
          seen.push(event.affects(SECTION, { resource: uri('/a'), languageId: 'typescript' }));
        });

        fireChange(capability, [`${SECTION}.enabled`]);

        expect(seen).toEqual([true]);
        subscription.dispose();
      });
    });

    it('notifies listeners and filters by section', () => {
      const capability = create();
      const affected: boolean[] = [];
      const subscription = capability.onDidChange((event) => {
        affected.push(event.affects(SECTION));
      });

      fireChange(capability, ['other.section']);
      expect(affected).toEqual([false]);

      fireChange(capability, [SECTION]);
      expect(affected).toEqual([false, true]);

      subscription.dispose();
      fireChange(capability, [SECTION]);
      expect(affected).toHaveLength(2);
    });
  });
}

/** Triggers a change through whichever implementation is under test. */
function fireChange(capability: SettingsCapability, sections: readonly string[]): void {
  const fake = capability as { _fireChange?: (sections: readonly string[]) => void };
  if (typeof fake._fireChange === 'function') {
    fake._fireChange(sections);
    return;
  }
  vscodeMock.fire(sections);
}

describe('SettingsCapability contract', () => {
  beforeEach(() => {
    vscodeMock.store.clear();
    vscodeMock.listeners.clear();
  });

  // The fake is recreated per test, so seeding goes through the instance.
  let currentFake: ReturnType<typeof createFakeSettings> | undefined;
  describeSettingsCapability(
    'FakeSettings',
    () => {
      currentFake = createFakeSettings();
      return currentFake;
    },
    (section, key, tier, value, placement) => {
      currentFake?._set(section, key, tier as never, value, placement);
    }
  );

  describeSettingsCapability(
    'VS Code adapter',
    () => createVSCodeSettingsCapability(),
    (section, key, tier, value, placement) => {
      const id = `${section}.${key}`;
      const entries = vscodeMock.store.get(id) ?? [];
      entries.push({
        tier,
        value,
        resource: placement?.resource,
        languageId: placement?.languageId,
      });
      vscodeMock.store.set(id, entries);
    }
  );
});
