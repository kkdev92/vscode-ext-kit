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
  /**
   * Settings groups, from `defineSettings`. A group declared with
   * `contributed: false` — a section the extension reads but does not own — is
   * not asked of the manifest.
   */
  readonly settings?: readonly {
    readonly section: string;
    readonly values: SettingSpecs;
    readonly contributed?: boolean | undefined;
  }[];
  /** Command contracts, from `defineCommandContract`. */
  readonly commands?: readonly { readonly descriptor: CommandDescriptor }[];
  /** View ids the application registers, independent of manifest container. */
  readonly views?: readonly string[];
  /**
   * Opts in to checking that every contributed keybinding binds a command this
   * extension declares.
   *
   * VS Code validates only the shape of a keybinding entry, never that its
   * command exists: one naming a command nothing registers is accepted, given a
   * weight, and does nothing when the key is pressed. A renamed or deleted
   * command therefore leaves a shortcut that fails in silence.
   *
   * Omitting this checks no keybindings at all.
   */
  readonly keybindings?: {
    /**
     * Command ids the manifest may bind without declaring them, for the
     * supported case of putting a key on a built-in command such as
     * `workbench.action.files.save`.
     */
    readonly allow?: readonly string[];
  };
  /**
   * Opts in to checking that `engines.vscode` admits no VS Code older than the
   * oldest this package runs on.
   *
   * Nothing else compares the two. npm reads only the `node` and `npm` engines
   * of a dependency, and `vsce` checks an extension's `engines.vscode` against
   * its own `@types/vscode` and nothing more. So when this package raises its
   * floor, an extension can go on declaring the older range and installing on
   * a VS Code that lacks what this package calls; with this set, that is a
   * failing test instead.
   *
   * A value VS Code would refuse to load fails it too: a missing one, `*`, or a
   * range in a form VS Code does not read, such as one starting with `~`.
   *
   * Omitting this checks no engines at all.
   */
  readonly engines?: boolean;
}

/**
 * One disagreement between `package.json` and what `src` declares.
 *
 * `kind` says which contribution point, or `engine` for `engines.vscode`;
 * `direction` which side is missing something — or `drift`, when both have the
 * entry and disagree about it — and `id` the command, setting key or view it
 * concerns, or `vscode` for the engine. `summary` says the same thing to a
 * person; `paste` is the JSON that would settle it, present when the fix is
 * mechanical and absent when only a person can supply it (a view needs a
 * container; a command needs a title).
 */
export interface ManifestMismatch {
  readonly kind: 'command' | 'setting' | 'view' | 'keybinding' | 'engine';
  readonly direction: 'missing-in-manifest' | 'missing-in-src' | 'drift';
  readonly id: string;
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
    readonly keybindings?: readonly { readonly command?: unknown }[];
  };
  readonly engines?: { readonly vscode?: unknown };
}

/** Normalize omitted scope before comparing; source declarations are explicit. */
const DEFAULT_MANIFEST_SCOPE = 'window';

type Version = readonly [major: number, minor: number, patch: number];

/**
 * The oldest VS Code this package runs on: its own `engines.vscode`, which a
 * test holds this to.
 */
const VSCODE_FLOOR: Version = [1, 138, 0];

/**
 * An `engines.vscode` value as VS Code reads one: an optional `^` or `>=`, then
 * `major.minor.patch` with `x` allowed in any part, then an optional suffix
 * after `-`. VS Code refuses to parse anything else.
 */
const ENGINE_RANGE = /^(\^|>=)?(\d+|x)\.(\d+|x)\.(\d+|x)(-.*)?$/u;

function equalJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Compares a JSON Schema `type`, which is a name or a list of them.
 *
 * Order-insensitive, because `["string","null"]` and `["null","string"]` mean
 * the same thing to every JSON Schema reader including VS Code. `enum` is
 * compared in order by contrast, and deliberately: `enumDescriptions` pairs
 * with it positionally, so a reorder there is a real change.
 */
function sameType(inManifest: unknown, inSource: SettingSpec<unknown>['type']): boolean {
  // `Array.isArray` narrows to `any[]`, which makes the map below unchecked.
  const normalise = (value: unknown): string => {
    const names: readonly unknown[] = value instanceof Array ? value : [value];
    return names.map(String).sort().join('|');
  };
  return normalise(inManifest) === normalise(inSource);
}

/**
 * Produces pasteable mechanical fields for a missing setting.
 * The placeholder description is intentionally conspicuous: generated text
 * must not silently become user-facing documentation.
 */
function contributionFor(spec: SettingSpec<unknown>): Record<string, unknown> {
  return {
    // Copied so the pasteable JSON carries a plain array rather than whatever
    // readonly view the spec happened to hold.
    type: typeof spec.type === 'string' ? spec.type : [...spec.type],
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

function boundCommandIds(manifest: Manifest): readonly string[] {
  return (manifest.contributes?.keybindings ?? [])
    .map((entry) => entry.command)
    .filter((id): id is string => typeof id === 'string');
}

function checkCommands(manifest: Manifest, declared: DeclaredContributions): ManifestMismatch[] {
  if (declared.commands === undefined) {
    return [];
  }
  const inManifest = new Set(commandIds(manifest));
  const inSource = new Set(declared.commands.map((contract) => contract.descriptor.id));
  const mismatches: ManifestMismatch[] = [];

  for (const id of inSource) {
    if (!inManifest.has(id)) {
      mismatches.push({
        kind: 'command',
        direction: 'missing-in-manifest',
        id,
        summary: `command "${id}" is declared in src but missing from contributes.commands`,
        paste: JSON.stringify({ command: id, title: 'TODO' }, null, 2),
      });
    }
  }
  for (const id of inManifest) {
    if (!inSource.has(id)) {
      mismatches.push({
        kind: 'command',
        direction: 'missing-in-src',
        id,
        summary: `command "${id}" is in contributes.commands but no contract declares it`,
      });
    }
  }
  return mismatches;
}

function checkSettings(manifest: Manifest, declared: DeclaredContributions): ManifestMismatch[] {
  if (declared.settings === undefined) {
    return [];
  }
  const properties = manifest.contributes?.configuration?.properties ?? {};
  const mismatches: ManifestMismatch[] = [];
  const expected = new Set<string>();
  const drift = (id: string, summary: string): ManifestMismatch => ({
    kind: 'setting',
    direction: 'drift',
    id,
    summary,
  });

  const contributed = declared.settings.filter((group) => group.contributed !== false);
  for (const group of contributed) {
    for (const [name, spec] of Object.entries(group.values)) {
      const key = `${group.section}.${name}`;
      expected.add(key);
      const entry = properties[key];
      if (entry === undefined) {
        mismatches.push({
          kind: 'setting',
          direction: 'missing-in-manifest',
          id: key,
          summary: `setting "${key}" is declared in src but missing from contributes.configuration`,
          paste: JSON.stringify({ [key]: contributionFor(spec) }, null, 2),
        });
        continue;
      }
      if (!sameType(entry['type'], spec.type)) {
        mismatches.push(
          drift(
            key,
            `setting "${key}" is ${JSON.stringify(entry['type'])} in the manifest ` +
              `and ${JSON.stringify(spec.type)} in src`
          )
        );
      }
      if (!equalJson(entry['default'], spec.default)) {
        mismatches.push(
          drift(
            key,
            `setting "${key}" defaults to ${JSON.stringify(entry['default'])} in the manifest ` +
              `and ${JSON.stringify(spec.default)} in src`
          )
        );
      }
      if (spec.enum !== undefined && !equalJson(entry['enum'], [...spec.enum])) {
        mismatches.push(
          drift(
            key,
            `setting "${key}" allows ${JSON.stringify(entry['enum'])} in the manifest ` +
              `and ${JSON.stringify(spec.enum)} in src`
          )
        );
      }
      if ((entry['scope'] ?? DEFAULT_MANIFEST_SCOPE) !== spec.scope) {
        mismatches.push(
          drift(
            key,
            `setting "${key}" is scoped ${JSON.stringify(entry['scope'] ?? DEFAULT_MANIFEST_SCOPE)} ` +
              `in the manifest and "${spec.scope}" in src`
          )
        );
      }
    }
  }

  const sections = contributed.map((group) => `${group.section}.`);
  for (const key of Object.keys(properties)) {
    if (sections.some((prefix) => key.startsWith(prefix)) && !expected.has(key)) {
      mismatches.push({
        kind: 'setting',
        direction: 'missing-in-src',
        id: key,
        summary: `setting "${key}" is contributed but no declaration in src reads it`,
      });
    }
  }
  return mismatches;
}

function checkViews(manifest: Manifest, declared: DeclaredContributions): ManifestMismatch[] {
  if (declared.views === undefined) {
    return [];
  }
  const inManifest = new Set(viewIds(manifest));
  const inSource = new Set(declared.views);
  return [
    ...[...inSource]
      .filter((id) => !inManifest.has(id))
      .map((id): ManifestMismatch => ({
        kind: 'view',
        direction: 'missing-in-manifest',
        id,
        // No `paste`: a view needs a container, and which one is a design
        // decision the declaration does not carry.
        summary: `view "${id}" is registered in src but missing from contributes.views`,
      })),
    ...[...inManifest]
      .filter((id) => !inSource.has(id))
      .map((id): ManifestMismatch => ({
        kind: 'view',
        direction: 'missing-in-src',
        id,
        summary: `view "${id}" is contributed but nothing in src registers it`,
      })),
  ];
}

function checkKeybindings(manifest: Manifest, declared: DeclaredContributions): ManifestMismatch[] {
  if (declared.keybindings === undefined) {
    return [];
  }
  const bindable = new Set([
    ...(declared.commands ?? []).map((contract) => contract.descriptor.id),
    ...(declared.keybindings.allow ?? []),
  ]);
  // One report per unresolved id: binding the same command from several entries
  // is how a keybinding carries a `when`, and a typo in it is still one mistake.
  const unresolved = new Set(boundCommandIds(manifest).filter((id) => !bindable.has(id)));

  return [...unresolved].map((id): ManifestMismatch => ({
    kind: 'keybinding',
    direction: 'missing-in-src',
    id,
    // No `paste`: the fix is a contract, a corrected id or an `allow` entry,
    // and which one is a decision the manifest cannot settle.
    summary:
      `keybinding "${id}" is bound in contributes.keybindings but no contract ` +
      `declares it and keybindings.allow does not list it`,
  }));
}

/**
 * The oldest VS Code an `engines.vscode` value admits, or `undefined` when VS
 * Code would not load an extension that declares it.
 *
 * Whatever the form, VS Code admits nothing older than the version written —
 * `^` and `>=` open the range upward, an `x` opens the part it stands in, and a
 * suffix can only narrow it — so that version, with `x` read as 0, is the
 * answer. VS Code refuses a value whose major is `x` as not specific enough,
 * and below 1.0.0 one whose minor is `x` as well; `*` is refused the same way.
 */
function oldestAdmitted(value: string): Version | undefined {
  const match = ENGINE_RANGE.exec(value.trim());
  if (match === null) {
    return undefined;
  }
  const [major, minor, patch] = [match[2], match[3], match[4]].map((part) =>
    part === undefined || part === 'x' ? undefined : Number(part)
  );
  if (major === undefined || (major === 0 && minor === undefined)) {
    return undefined;
  }
  return [major, minor ?? 0, patch ?? 0];
}

function olderThan(version: Version, than: Version): boolean {
  const [major, minor, patch] = version;
  if (major !== than[0]) {
    return major < than[0];
  }
  if (minor !== than[1]) {
    return minor < than[1];
  }
  return patch < than[2];
}

function checkEngines(manifest: Manifest, declared: DeclaredContributions): ManifestMismatch[] {
  if (declared.engines !== true) {
    return [];
  }
  const needs = `@kkdev92/vscode-ext-kit needs VS Code ${VSCODE_FLOOR.join('.')} or later`;
  // No `paste`: `engines` is not part of `contributes`, and the summary already
  // names the version to declare.
  const value = manifest.engines?.vscode;
  if (value === undefined) {
    return [
      {
        kind: 'engine',
        direction: 'missing-in-manifest',
        id: 'vscode',
        summary: `engines.vscode is missing, and VS Code loads no extension without it; ${needs}`,
      },
    ];
  }
  const oldest = typeof value === 'string' ? oldestAdmitted(value) : undefined;
  if (oldest === undefined) {
    return [
      {
        kind: 'engine',
        direction: 'drift',
        id: 'vscode',
        summary: `engines.vscode ${JSON.stringify(value)} is not a range VS Code accepts; ${needs}`,
      },
    ];
  }
  if (olderThan(oldest, VSCODE_FLOOR)) {
    return [
      {
        kind: 'engine',
        direction: 'drift',
        id: 'vscode',
        summary: `engines.vscode ${JSON.stringify(value)} admits VS Code ${oldest.join('.')}, and ${needs}`,
      },
    ];
  }
  return [];
}

/**
 * Every disagreement between `package.json` and the declarations in `src`, as
 * data, in the order the checks run: commands, then settings, then views, then
 * keybindings, then the engine.
 *
 * The same comparison {@link assertManifestMatches} makes, without the throw —
 * for a tool that wants to print, count or apply the mechanical part of the
 * fix itself. An empty result means the two agree on everything this checks.
 *
 * @example
 * ```ts
 * const mismatches = diffManifest(manifest, { commands: Object.values(Contracts) });
 * for (const mismatch of mismatches.filter((m) => m.direction === 'missing-in-manifest')) {
 *   console.log(mismatch.paste ?? mismatch.summary);
 * }
 * ```
 */
export function diffManifest(
  manifest: unknown,
  declared: DeclaredContributions
): readonly ManifestMismatch[] {
  const parsed = (manifest ?? {}) as Manifest;
  return [
    ...checkCommands(parsed, declared),
    ...checkSettings(parsed, declared),
    ...checkViews(parsed, declared),
    ...checkKeybindings(parsed, declared),
    ...checkEngines(parsed, declared),
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
 * Of a keybinding it reads the command id and nothing else. The key, `when` and
 * `args` stay the manifest's, as does the order of the entries — which is what
 * decides the winner when several share a key, so an extension that depends on
 * that order needs its own assertion for it.
 *
 * Of `engines` it reads `vscode`, and asks only that the range admit no VS Code
 * older than this package runs on. How far above that the range starts is the
 * extension's to decide.
 *
 * @example
 * ```ts
 * it('the manifest agrees with what src declares', () => {
 *   assertManifestMatches(JSON.parse(readFileSync('package.json', 'utf8')), {
 *     settings: [Settings, EditorSettings],
 *     commands: Object.values(Contracts),
 *     views: Object.values(VIEWS),
 *     keybindings: { allow: ['workbench.action.files.save'] },
 *     engines: true,
 *   });
 * });
 * ```
 *
 * @param manifest - The parsed `package.json`
 * @param declared - What `src` declares
 * @throws when anything disagrees, listing every disagreement at once
 */
export function assertManifestMatches(manifest: unknown, declared: DeclaredContributions): void {
  const mismatches = diffManifest(manifest, declared);
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
