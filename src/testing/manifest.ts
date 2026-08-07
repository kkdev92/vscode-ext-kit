/**
 * @packageDocumentation
 * Read-only drift check between source declarations and `package.json`.
 *
 * This is intentionally an assertion rather than a manifest generator. Source
 * owns machine-facing facts that affect runtime correctness; the manifest owns
 * presentation and contribution metadata consumed before activation. Comparing
 * only their overlap keeps either side free to express what the other cannot.
 */
import type { CommandDescriptor } from '../foundation/commands/contract.js';
import type { SettingSpec, SettingSpecs } from '../foundation/settings/definition.js';

/**
 * The manifest facts a declaration in `src` is the authority for.
 *
 * Structural on purpose: a `defineSettings` result, a `defineCommandContract`
 * result and a plain list of view ids all satisfy these without importing
 * anything from here.
 */
export interface DeclaredContributions {
  /** Settings groups, from `defineSettings`. */
  readonly settings?: readonly { readonly section: string; readonly values: SettingSpecs }[];
  /** Command contracts, from `defineCommandContract`. */
  readonly commands?: readonly { readonly descriptor: CommandDescriptor }[];
  /** View ids the application registers, independent of manifest container. */
  readonly views?: readonly string[];
}

/** A single disagreement between the manifest and what `src` declares. */
interface Mismatch {
  readonly summary: string;
  /** JSON to paste into `contributes`, when the fix is mechanical. */
  readonly paste?: string;
}

/**
 * The narrow `package.json` projection this assertion reads.
 * Unknown contribution points and human-facing fields are deliberately ignored
 * so adding unrelated manifest metadata cannot break this check.
 */
interface Manifest {
  readonly contributes?: {
    readonly commands?: readonly { readonly command?: unknown }[];
    readonly configuration?: {
      readonly properties?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
    };
    readonly views?: Readonly<Record<string, readonly { readonly id?: unknown }[]>>;
  };
}

/** Normalize omitted scope before comparing; source declarations are explicit. */
const DEFAULT_MANIFEST_SCOPE = 'window';

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Produces pasteable mechanical fields for a missing setting.
 * The placeholder description is intentionally conspicuous: generated text
 * must not silently become user-facing documentation.
 */
function contributionFor(spec: SettingSpec<unknown>): Record<string, unknown> {
  return {
    type: spec.type,
    default: spec.default,
    ...(spec.enum === undefined ? {} : { enum: [...spec.enum] }),
    scope: spec.scope,
    description: '%TODO: describe this setting%',
  };
}

function commandIds(manifest: Manifest): readonly string[] {
  return (manifest.contributes?.commands ?? [])
    .map((entry) => entry.command)
    .filter((id): id is string => typeof id === 'string');
}

function viewIds(manifest: Manifest): readonly string[] {
  return Object.values(manifest.contributes?.views ?? {})
    .flat()
    .map((entry) => entry.id)
    .filter((id): id is string => typeof id === 'string');
}

function checkCommands(manifest: Manifest, declared: DeclaredContributions): Mismatch[] {
  if (declared.commands === undefined) {
    return [];
  }
  const inManifest = new Set(commandIds(manifest));
  const inSource = new Set(declared.commands.map((contract) => contract.descriptor.id));
  const mismatches: Mismatch[] = [];

  for (const id of inSource) {
    if (!inManifest.has(id)) {
      mismatches.push({
        summary: `command "${id}" is declared in src but missing from contributes.commands`,
        paste: JSON.stringify({ command: id, title: 'TODO' }, null, 2),
      });
    }
  }
  for (const id of inManifest) {
    if (!inSource.has(id)) {
      // The palette would offer a command nothing handles.
      mismatches.push({
        summary: `command "${id}" is in contributes.commands but no contract declares it`,
      });
    }
  }
  return mismatches;
}

function checkSettings(manifest: Manifest, declared: DeclaredContributions): Mismatch[] {
  if (declared.settings === undefined) {
    return [];
  }
  const properties = manifest.contributes?.configuration?.properties ?? {};
  const mismatches: Mismatch[] = [];
  const expected = new Set<string>();

  for (const group of declared.settings) {
    for (const [name, spec] of Object.entries(group.values)) {
      const key = `${group.section}.${name}`;
      expected.add(key);
      const entry = properties[key];
      if (entry === undefined) {
        mismatches.push({
          summary: `setting "${key}" is declared in src but missing from contributes.configuration`,
          paste: JSON.stringify({ [key]: contributionFor(spec) }, null, 2),
        });
        continue;
      }
      // Only the machine-facing facts. Descriptions, ordering and
      // `markdownDescription` are the manifest's to own.
      if (entry['type'] !== spec.type) {
        mismatches.push({
          summary: `setting "${key}" is ${JSON.stringify(entry['type'])} in the manifest and "${spec.type}" in src`,
        });
      }
      if (!equalJson(entry['default'], spec.default)) {
        mismatches.push({
          summary:
            `setting "${key}" defaults to ${JSON.stringify(entry['default'])} in the manifest ` +
            `and ${JSON.stringify(spec.default)} in src`,
        });
      }
      if (spec.enum !== undefined && !equalJson(entry['enum'], [...spec.enum])) {
        mismatches.push({
          summary:
            `setting "${key}" allows ${JSON.stringify(entry['enum'])} in the manifest ` +
            `and ${JSON.stringify(spec.enum)} in src`,
        });
      }
      if ((entry['scope'] ?? DEFAULT_MANIFEST_SCOPE) !== spec.scope) {
        mismatches.push({
          summary:
            `setting "${key}" is scoped ${JSON.stringify(entry['scope'] ?? DEFAULT_MANIFEST_SCOPE)} ` +
            `in the manifest and "${spec.scope}" in src`,
        });
      }
    }
  }

  const sections = declared.settings.map((group) => `${group.section}.`);
  for (const key of Object.keys(properties)) {
    if (sections.some((prefix) => key.startsWith(prefix)) && !expected.has(key)) {
      // A setting the user can change that the extension never reads.
      mismatches.push({
        summary: `setting "${key}" is contributed but no declaration in src reads it`,
      });
    }
  }
  return mismatches;
}

function checkViews(manifest: Manifest, declared: DeclaredContributions): Mismatch[] {
  if (declared.views === undefined) {
    return [];
  }
  const inManifest = new Set(viewIds(manifest));
  const inSource = new Set(declared.views);
  return [
    ...[...inSource]
      .filter((id) => !inManifest.has(id))
      .map((id) => ({
        summary: `view "${id}" is registered in src but missing from contributes.views`,
      })),
    ...[...inManifest]
      .filter((id) => !inSource.has(id))
      .map((id) => ({ summary: `view "${id}" is contributed but nothing in src registers it` })),
  ];
}

/**
 * Fails when `package.json` and the declarations in `src` disagree.
 *
 * VS Code reads the manifest before an extension's code runs, so the two can
 * never collapse into one file — the Command Palette and the Settings UI need
 * titles and descriptions that only the manifest can carry, and a handler's
 * argument types are something only `src` can express. What overlaps is small
 * and mechanical: ids, types, defaults, enum values, scopes.
 *
 * This treats `src` as the authority for that overlap. A failure names what the
 * manifest is missing and prints the JSON to paste, so the fix is always
 * "update the manifest", never "go and change the code to match".
 *
 * It reports every mismatch in one throw and has no test-runner dependency.
 * It does not validate unrelated contribution points, activation events,
 * localization files or whether VS Code accepts the complete manifest; retain a
 * packaging/Extension Host lane for those concerns.
 *
 * @example
 * ```ts
 * it('the manifest agrees with what src declares', () => {
 *   assertManifestMatches(JSON.parse(readFileSync('package.json', 'utf8')), {
 *     settings: [Settings, EditorSettings],
 *     commands: Object.values(Contracts),
 *     views: Object.values(VIEWS),
 *   });
 * });
 * ```
 *
 * @param manifest - The parsed `package.json`
 * @param declared - What `src` declares
 * @throws when anything disagrees, listing every disagreement at once
 */
export function assertManifestMatches(manifest: unknown, declared: DeclaredContributions): void {
  const parsed = (manifest ?? {}) as Manifest;
  const mismatches = [
    ...checkCommands(parsed, declared),
    ...checkSettings(parsed, declared),
    ...checkViews(parsed, declared),
  ];
  if (mismatches.length === 0) {
    return;
  }

  // Everything at once: fixing a manifest one failing assertion at a time is
  // the slowest possible way to do it.
  const report = mismatches
    .map((mismatch) =>
      mismatch.paste === undefined
        ? `  - ${mismatch.summary}`
        : `  - ${mismatch.summary}\n${mismatch.paste.replace(/^/gmu, '      ')}`
    )
    .join('\n');
  throw new Error(
    `package.json disagrees with src in ${String(mismatches.length)} place(s):\n${report}`
  );
}
