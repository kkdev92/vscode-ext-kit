/**
 * Public manifest-assertion contract.
 *
 * These tests pin the mechanical overlap for which source is authoritative and
 * the “report all disagreements” ergonomics. Add cases here when
 * `DeclaredContributions` begins checking another machine-facing fact; do not
 * add assertions for human-facing manifest fields that source cannot own.
 */
import { describe, expect, it } from 'vitest';

import { defineCommandContract } from '../../src/foundation/commands/contract.js';
import { defineSettings, setting } from '../../src/foundation/settings/definition.js';
import { assertManifestMatches, diffManifest } from '../../src/testing/manifest.js';

const Refresh = defineCommandContract({ id: 'sample.refresh' });
const Clear = defineCommandContract({ id: 'sample.clear' });

const Options = defineSettings({
  section: 'sample',
  values: {
    limit: setting.integer({ default: 10, minimum: 1 }),
    mode: setting.enum({ values: ['fast', 'safe'], default: 'safe' }),
  },
});

/** A manifest that agrees with everything above. */
function agreeingManifest(): unknown {
  return {
    contributes: {
      commands: [
        { command: 'sample.refresh', title: 'Refresh' },
        { command: 'sample.clear', title: 'Clear' },
      ],
      configuration: {
        properties: {
          'sample.limit': { type: 'integer', default: 10, scope: 'window', description: 'Limit' },
          'sample.mode': {
            type: 'string',
            default: 'safe',
            enum: ['fast', 'safe'],
            scope: 'window',
            description: 'Mode',
          },
        },
      },
      views: { sampleContainer: [{ id: 'sample.tree', name: 'Tree' }] },
    },
  };
}

/**
 * Keeping package.json and `src` in step, without generating either.
 *
 * VS Code reads the manifest before the extension's code runs, so the two can
 * never become one file. What overlaps is small — ids, types, defaults, enum
 * values and scopes—and this is what stops it drifting. Presentation and other
 * contribution points remain the manifest's responsibility.
 */
describe('assertManifestMatches', () => {
  const declared = {
    settings: [Options],
    commands: [Refresh, Clear],
    views: ['sample.tree'],
  };

  it('passes when the manifest agrees', () => {
    expect(() => {
      assertManifestMatches(agreeingManifest(), declared);
    }).not.toThrow();
  });

  it('does not ask the manifest for a section the extension only reads', () => {
    // `editor.tabSize` is VS Code's. Declaring it gives the extension the same
    // typed accessor; `contributed: false` says the manifest must not carry it.
    const Editor = defineSettings({
      section: 'editor',
      values: { tabSize: setting.integer({ default: 4 }) },
      contributed: false,
    });

    expect(() => {
      assertManifestMatches(agreeingManifest(), { ...declared, settings: [Options, Editor] });
    }).not.toThrow();
    expect(diffManifest(agreeingManifest(), { settings: [Editor] })).toEqual([]);
  });

  it('names a command src declares and the manifest is missing, with the JSON to paste', () => {
    const manifest = agreeingManifest() as { contributes: { commands: unknown[] } };
    manifest.contributes.commands = [{ command: 'sample.refresh', title: 'Refresh' }];

    expect(() => {
      assertManifestMatches(manifest, declared);
    }).toThrow(/"sample\.clear" is declared in src but missing[\s\S]*"command": "sample\.clear"/u);
  });

  it('names a command the manifest offers that nothing handles', () => {
    const manifest = agreeingManifest() as { contributes: { commands: unknown[] } };
    manifest.contributes.commands.push({ command: 'sample.ghost', title: 'Ghost' });

    expect(() => {
      assertManifestMatches(manifest, declared);
    }).toThrow(/"sample\.ghost" is in contributes\.commands but no contract declares it/u);
  });

  it('catches a type that drifted, which is what `integer` exists to make visible', () => {
    const manifest = agreeingManifest() as {
      contributes: { configuration: { properties: Record<string, Record<string, unknown>> } };
    };
    const limit = manifest.contributes.configuration.properties['sample.limit'];
    if (limit !== undefined) {
      limit['type'] = 'number';
    }

    expect(() => {
      assertManifestMatches(manifest, declared);
    }).toThrow(/"sample\.limit" is "number" in the manifest and "integer" in src/u);
  });

  it('catches a default and an enum that drifted', () => {
    const manifest = agreeingManifest() as {
      contributes: { configuration: { properties: Record<string, Record<string, unknown>> } };
    };
    const limit = manifest.contributes.configuration.properties['sample.limit'];
    const mode = manifest.contributes.configuration.properties['sample.mode'];
    if (limit !== undefined) {
      limit['default'] = 25;
    }
    if (mode !== undefined) {
      mode['enum'] = ['fast'];
    }

    let message = '';
    try {
      assertManifestMatches(manifest, declared);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    // Everything at once: fixing a manifest one failing assertion at a time is
    // the slowest possible way to do it.
    expect(message).toMatch(/defaults to 25 in the manifest and 10 in src/u);
    expect(message).toMatch(/allows \["fast"\] in the manifest/u);
    expect(message).toMatch(/in 2 place\(s\)/u);
  });

  it('prints the setting to paste when the manifest has none', () => {
    const manifest = agreeingManifest() as {
      contributes: { configuration: { properties: Record<string, unknown> } };
    };
    delete manifest.contributes.configuration.properties['sample.mode'];

    expect(() => {
      assertManifestMatches(manifest, declared);
    }).toThrow(/"enum": \[\s*"fast",\s*"safe"\s*\]/u);
  });

  it('treats an omitted scope as window, which is what VS Code does', () => {
    const manifest = agreeingManifest() as {
      contributes: { configuration: { properties: Record<string, Record<string, unknown>> } };
    };
    for (const entry of Object.values(manifest.contributes.configuration.properties)) {
      delete entry['scope'];
    }

    expect(() => {
      assertManifestMatches(manifest, declared);
    }).not.toThrow();
  });

  it('catches a view in one place and not the other', () => {
    expect(() => {
      assertManifestMatches(agreeingManifest(), { ...declared, views: ['sample.other'] });
    }).toThrow(/"sample\.other" is registered in src[\s\S]*"sample\.tree" is contributed/u);
  });

  it('checks only what it was given', () => {
    // A consumer that declares no views should not be told its views are wrong.
    expect(() => {
      assertManifestMatches({ contributes: { views: { c: [{ id: 'x' }] } } }, {});
    }).not.toThrow();
  });

  it('survives a manifest with no contributes at all', () => {
    expect(() => {
      assertManifestMatches({}, { commands: [Refresh] });
    }).toThrow(/"sample\.refresh" is declared in src/u);
  });
});

/**
 * A setting that means "unset".
 *
 * VS Code will not accept a null default unless the manifest declares
 * `["string","null"]`, so a spec that cannot say that is a spec this assertion
 * can never agree with — which is how it was found: the first extension to
 * declare one had to normalise the manifest before it could be checked at all.
 */
describe('assertManifestMatches, on a nullable setting', () => {
  const Nullable = defineSettings({
    section: 'sample',
    values: {
      preset: setting.nullable(setting.enum({ values: ['ai'], default: 'ai' }), { default: null }),
      width: setting.nullable(setting.integer({ default: 1200 })),
    },
  });

  const manifest = (presetType: unknown, widthType: unknown): unknown => ({
    contributes: {
      configuration: {
        properties: {
          'sample.preset': {
            type: presetType,
            default: null,
            enum: [null, 'ai'],
            scope: 'window',
          },
          'sample.width': { type: widthType, default: 1200, scope: 'window' },
        },
      },
    },
  });

  it('agrees with the union type the manifest has to declare', () => {
    expect(() => {
      assertManifestMatches(manifest(['string', 'null'], ['integer', 'null']), {
        settings: [Nullable],
      });
    }).not.toThrow();
  });

  it('does not care what order the manifest lists the types in', () => {
    // `["null","string"]` and `["string","null"]` are the same schema, and a
    // reorder is not a change worth failing a build over.
    expect(() => {
      assertManifestMatches(manifest(['null', 'string'], ['null', 'integer']), {
        settings: [Nullable],
      });
    }).not.toThrow();
  });

  it('still catches a manifest that forgot the null', () => {
    expect(() => {
      assertManifestMatches(manifest('string', ['integer', 'null']), { settings: [Nullable] });
    }).toThrow(/"sample\.preset" is "string" in the manifest and \["string","null"\] in src/u);
  });

  it('prints a pasteable union type for a setting the manifest has not got', () => {
    // One key, so the reported JSON is one object and can be parsed back.
    const OnlyPreset = defineSettings({
      section: 'sample',
      values: { preset: Nullable.values.preset },
    });

    let message = '';
    try {
      assertManifestMatches({ contributes: {} }, { settings: [OnlyPreset] });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    // The JSON is meant to be pasted straight into `contributes`, so the union
    // has to survive into it — a `type` of "string" there would be wrong in the
    // one place the tool tells the reader to copy from.
    const pasted: unknown = JSON.parse(message.slice(message.indexOf('{')));
    expect(pasted).toMatchObject({
      'sample.preset': { type: ['string', 'null'], default: null, enum: [null, 'ai'] },
    });
  });
});

/**
 * The same comparison, as data.
 *
 * A tool that prints, counts or applies the mechanical part of the fix needs
 * more than a sentence: which contribution point, which side, which id, and
 * whether there is JSON that settles it. The assertion is built on this, so
 * the two can never disagree about what disagrees.
 */
describe('diffManifest', () => {
  const declared = { commands: [Refresh, Clear], settings: [Options], views: ['sample.tree'] };

  /** The agreeing manifest with one problem of each kind introduced. */
  function disagreeingManifest(): unknown {
    const manifest = agreeingManifest() as {
      contributes: {
        commands: unknown[];
        configuration: { properties: Record<string, Record<string, unknown>> };
        views: Record<string, unknown[]>;
      };
    };
    // One command gone, one nobody handles.
    manifest.contributes.commands = [
      { command: 'sample.refresh', title: 'Refresh' },
      { command: 'sample.ghost', title: 'Ghost' },
    ];
    // A type that drifted.
    manifest.contributes.configuration.properties['sample.limit'] = {
      type: 'number',
      default: 10,
      scope: 'window',
    };
    // The declared view missing, an undeclared one present.
    manifest.contributes.views = { sampleContainer: [{ id: 'sample.other', name: 'Other' }] };
    return manifest;
  }

  it('returns nothing when the two agree', () => {
    expect(diffManifest(agreeingManifest(), declared)).toEqual([]);
  });

  it('reports each disagreement as data, in the order the checks run', () => {
    const mismatches = diffManifest(disagreeingManifest(), declared);

    expect(mismatches.map((m) => [m.kind, m.direction, m.id])).toEqual([
      ['command', 'missing-in-manifest', 'sample.clear'],
      ['command', 'missing-in-src', 'sample.ghost'],
      ['setting', 'drift', 'sample.limit'],
      ['view', 'missing-in-manifest', 'sample.tree'],
      ['view', 'missing-in-src', 'sample.other'],
    ]);
  });

  it('attaches the JSON to paste only where the fix is mechanical', () => {
    const mismatches = diffManifest(disagreeingManifest(), declared);
    const byId = new Map(mismatches.map((m) => [m.id, m]));

    // A missing command has a mechanical shape; the title is a placeholder.
    expect(byId.get('sample.clear')?.paste).toContain('"command": "sample.clear"');
    // A missing view needs a container, which is a decision, not a fact in src.
    expect(byId.get('sample.tree')?.paste).toBeUndefined();
    // Drift is a disagreement about a value, not an absence; there is nothing to paste.
    expect(byId.get('sample.limit')?.paste).toBeUndefined();
  });

  it('is exactly what the assertion reports, one summary per line', () => {
    const manifest = disagreeingManifest();
    const summaries = diffManifest(manifest, declared).map((m) => m.summary);

    let message = '';
    try {
      assertManifestMatches(manifest, declared);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain(`${String(summaries.length)} place(s)`);
    for (const summary of summaries) {
      expect(message).toContain(summary);
    }
  });
});
