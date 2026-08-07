/**
 * In-memory configuration resolver for the settings port.
 *
 * It models tier precedence, shallow object merging, inspection and updates.
 * It does not parse `settings.json`, enforce manifest schemas, synchronize
 * profiles, or retain before/after snapshots for resource-aware change events.
 */
import type {
  PlatformRegistration,
  SettingsCapability,
  SettingsChangeSource,
  SettingsInspection,
  SettingsScope,
  SettingsTarget,
} from '../../foundation/platform/ports.js';

/** Which tier a fake value is written to. Mirrors `inspect()`'s field names. */
export type FakeSettingsTier =
  | 'defaultValue'
  | 'globalValue'
  | 'workspaceValue'
  | 'workspaceFolderValue'
  | 'defaultLanguageValue'
  | 'globalLanguageValue'
  | 'workspaceLanguageValue'
  | 'workspaceFolderLanguageValue';

/** Where a fake value applies. */
export interface FakeSettingsPlacement {
  /** Resource the value is scoped to, for folder tiers. */
  readonly resource?: string | undefined;
  /** Language the value is scoped to, for language tiers. */
  readonly languageId?: string | undefined;
}

/** In-memory settings capability for tests. */
export interface FakeSettings extends SettingsCapability {
  /** Writes a value into a specific tier. */
  _set(
    section: string,
    key: string,
    tier: FakeSettingsTier,
    value: unknown,
    placement?: FakeSettingsPlacement
  ): void;
  /** Removes every configured value. */
  _reset(): void;
  /**
   * Notifies listeners that the given **keys** changed, the way VS Code reports
   * a configuration change: fully qualified leaf keys, not section names.
   *
   * The resulting `affects(section)` says yes when a changed key *is* that
   * section or sits under it — so `_fireChange(['sample.projects.enabled'])`
   * affects `sample.projects`, while a change to `sample.pro` does not.
   */
  _fireChange(sections: readonly string[]): void;
}

/** Tiers in VS Code's documented precedence order; later entries win. */
const TIER_ORDER: readonly FakeSettingsTier[] = [
  'defaultValue',
  'globalValue',
  'workspaceValue',
  'workspaceFolderValue',
  'defaultLanguageValue',
  'globalLanguageValue',
  'workspaceLanguageValue',
  'workspaceFolderLanguageValue',
];

const RESOURCE_TIERS = new Set<FakeSettingsTier>([
  'workspaceFolderValue',
  'workspaceFolderLanguageValue',
]);

const LANGUAGE_TIERS = new Set<FakeSettingsTier>([
  'defaultLanguageValue',
  'globalLanguageValue',
  'workspaceLanguageValue',
  'workspaceFolderLanguageValue',
]);

interface StoredValue {
  readonly tier: FakeSettingsTier;
  readonly value: unknown;
  readonly resource?: string | undefined;
  readonly languageId?: string | undefined;
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Creates a fake settings capability.
 *
 * Implements VS Code's documented resolution rather than a convenient
 * approximation: the supported tiers apply in VS Code precedence order, a language value outranks a
 * more local non-language value, and only object values merge (shallow) while
 * everything else is overridden outright. The same contract suite runs against
 * this and the real adapter for the port contract. Platform configuration
 * behavior not exposed by the port remains an Extension Host concern.
 *
 * @example
 * ```ts
 * const settings = createFakeSettings();
 * settings._set('sample.projects', 'enabled', 'globalValue', false);
 * settings._set('sample.projects', 'enabled', 'globalLanguageValue', true, {
 *   languageId: 'typescript',
 * });
 * ```
 */
export function createFakeSettings(): FakeSettings {
  const store = new Map<string, StoredValue[]>();
  const listeners = new Set<(event: SettingsChangeSource) => void>();

  const path = (section: string, key: string): string => `${section}.${key}`;

  const applicable = (entry: StoredValue, scope: SettingsScope | undefined): boolean => {
    if (RESOURCE_TIERS.has(entry.tier)) {
      const resource = scope?.resource?.toString();
      if (resource === undefined || entry.resource !== resource) {
        return false;
      }
    }
    if (LANGUAGE_TIERS.has(entry.tier)) {
      if (scope?.languageId === undefined || entry.languageId !== scope.languageId) {
        return false;
      }
    }
    return true;
  };

  const matching = (
    section: string,
    key: string,
    scope: SettingsScope | undefined
  ): StoredValue[] => {
    const entries = store.get(path(section, key)) ?? [];
    return TIER_ORDER.flatMap((tier) =>
      entries.filter((entry) => entry.tier === tier && applicable(entry, scope))
    );
  };

  return {
    _set(section, key, tier, value, placement): void {
      const id = path(section, key);
      const entries = store.get(id) ?? [];
      const filtered = entries.filter(
        (entry) =>
          entry.tier !== tier ||
          entry.resource !== placement?.resource ||
          entry.languageId !== placement?.languageId
      );
      filtered.push({
        tier,
        value,
        resource: placement?.resource,
        languageId: placement?.languageId,
      });
      store.set(id, filtered);
    },

    _reset(): void {
      store.clear();
    },

    _fireChange(sections): void {
      const source: SettingsChangeSource = {
        // A changed key affects a section when it is that section or a
        // descendant of it, on a dot-segment boundary. VS Code decides this by
        // padding the changed keys with a marker and requiring the character
        // after the queried section to be the marker or a dot; the contract
        // suite runs that algorithm against this rule.
        //
        // `scope` is deliberately ignored. The real event narrows a scoped
        // query by comparing the effective value before and after, which needs
        // two configuration snapshots this fake does not keep. Over-reporting is
        // the direction that cannot miss a change, and the narrowing is pinned
        // by the Extension Host lane.
        affects: (section) =>
          sections.some((changed) => changed === section || changed.startsWith(`${section}.`)),
      };
      for (const listener of [...listeners]) {
        listener(source);
      }
    },

    read<T>(section: string, key: string, scope?: SettingsScope): T | undefined {
      const entries = matching(section, key, scope);
      if (entries.length === 0) {
        return undefined;
      }

      // Objects merge shallowly across tiers; every other type is overridden.
      if (entries.every((entry) => isPlainObject(entry.value))) {
        let merged: Record<string, unknown> = {};
        for (const entry of entries) {
          merged = { ...merged, ...(entry.value as Record<string, unknown>) };
        }
        return merged as T;
      }

      return entries[entries.length - 1]?.value as T;
    },

    inspect<T>(
      section: string,
      key: string,
      scope?: SettingsScope
    ): SettingsInspection<T> | undefined {
      const entries = store.get(path(section, key));
      if (entries === undefined) {
        return undefined;
      }

      const pick = (tier: FakeSettingsTier): T | undefined =>
        entries.find((entry) => entry.tier === tier && applicable(entry, scope))?.value as
          T | undefined;

      const languageIds = [
        ...new Set(
          entries
            .map((entry) => entry.languageId)
            .filter((languageId): languageId is string => languageId !== undefined)
        ),
      ];

      return {
        key: path(section, key),
        defaultValue: pick('defaultValue'),
        globalValue: pick('globalValue'),
        workspaceValue: pick('workspaceValue'),
        workspaceFolderValue: pick('workspaceFolderValue'),
        defaultLanguageValue: pick('defaultLanguageValue'),
        globalLanguageValue: pick('globalLanguageValue'),
        workspaceLanguageValue: pick('workspaceLanguageValue'),
        workspaceFolderLanguageValue: pick('workspaceFolderLanguageValue'),
        ...(languageIds.length === 0 ? {} : { languageIds }),
      };
    },

    update(
      section: string,
      key: string,
      value: unknown,
      target: SettingsTarget,
      scope?: SettingsScope,
      overrideInLanguage?: boolean
    ): Promise<void> {
      const tier: FakeSettingsTier =
        overrideInLanguage === true
          ? target === 1
            ? 'globalLanguageValue'
            : target === 2
              ? 'workspaceLanguageValue'
              : 'workspaceFolderLanguageValue'
          : target === 1
            ? 'globalValue'
            : target === 2
              ? 'workspaceValue'
              : 'workspaceFolderValue';

      const id = path(section, key);
      const entries = store.get(id) ?? [];
      const placement: FakeSettingsPlacement = {
        resource: scope?.resource?.toString(),
        languageId: scope?.languageId,
      };
      const filtered = entries.filter(
        (entry) =>
          entry.tier !== tier ||
          entry.resource !== placement.resource ||
          entry.languageId !== placement.languageId
      );

      // undefined removes the value, matching WorkspaceConfiguration.update.
      if (value !== undefined) {
        filtered.push({
          tier,
          value,
          resource: placement.resource,
          languageId: placement.languageId,
        });
      }
      store.set(id, filtered);
      return Promise.resolve();
    },

    onDidChange(listener: (event: SettingsChangeSource) => void): PlatformRegistration {
      listeners.add(listener);
      return {
        dispose(): void {
          listeners.delete(listener);
        },
      };
    },
  };
}
