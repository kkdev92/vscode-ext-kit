#!/usr/bin/env node
// The command-line tool.
//
//   vscode-ext-kit plan <entry> [--export <name>] [--format json|mermaid|dot] [--check] [--kit <path>]
//   vscode-ext-kit manifest <entry> [--manifest <path>] [--format text|json] [--apply] [--export <name>] [--kit <path>]
//
// `plan` reads the plan an extension compiles at import time and prints it: as
// the JSON `describePlan` produces, as a Mermaid or Graphviz graph of modules,
// services and the edges between them, or — with `--check` — as nothing but
// an exit code and the list of problems preflight found.
//
// `manifest` compares that plan with the extension's package.json — the same
// comparison `diffManifest` makes — and reports every disagreement. With
// `--apply` it adds what the manifest is missing and the source can supply:
// commands and settings, with placeholder titles and descriptions. Anything a
// person has to decide — a view's container, a drifted default, an entry only
// the manifest has — is reported and left alone.
//
// The entry module is evaluated with a stand-in for `vscode` (see
// vscode-stub.cjs), because the real module only exists inside an extension
// host. Nothing in this package touches VS Code before `activate`, so a
// well-formed entry evaluates to its plan without noticing. Module-scope code
// that reads a VS Code value would get a proxy instead; keep such reads inside
// `activate` or a handler, which the framework asks for anyway.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire, register } from 'node:module';
import { relative, resolve as resolvePath } from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXIT_OK = 0;
// Preflight rejected the plan, or the manifest disagrees with it: one code for
// both, the way a linter exits.
const EXIT_REJECTED = 1;
const EXIT_USAGE = 2;

const USAGE = `usage: vscode-ext-kit <command> <entry> [options]

commands
  plan <entry>         print the plan an extension compiles at import time
  manifest <entry>     compare that plan with package.json; report what
                       disagrees, or add what the manifest is missing

options for both
  <entry>              the extension's entry module (ESM or a CommonJS bundle)
  --export <name>      the export holding the defineExtension result or the plan
                       (default: tries "app", then the default export)
  --kit <path>         the @kkdev92/vscode-ext-kit to read the plan with
                       (default: the copy this tool ships in)
  --help               this text

plan
  --format <fmt>       json (default) | mermaid | dot
  --check              print nothing on success; exit 1 listing every problem
                       preflight found

manifest
  --manifest <path>    the package.json to compare (default: ./package.json)
  --format <fmt>       text (default) | json
  --apply              add the commands and settings the manifest is missing,
                       with placeholder titles and descriptions marked TODO.
                       Views, drifted values and entries only the manifest has
                       are reported, never changed.

exit codes: 0 ok, 1 preflight rejected the plan or the manifest disagrees with it,
            2 usage or load error
`;

// --- `vscode` stand-in ----------------------------------------------------
// Registered before anything else is imported. ESM imports go through the
// hooks module; CommonJS `require('vscode')` — what a bundled extension does —
// goes through Node's CommonJS resolver, which is patched here to agree.
const STUB_PATH = fileURLToPath(new URL('./vscode-stub.cjs', import.meta.url));
const requireFromHere = createRequire(import.meta.url);
const NodeModule = requireFromHere('node:module');
const resolveFilename = NodeModule._resolveFilename;
NodeModule._resolveFilename = function (request, ...rest) {
  return request === 'vscode' ? STUB_PATH : resolveFilename.call(this, request, ...rest);
};
register('./vscode-stub-hooks.mjs', import.meta.url);

// --- arguments ------------------------------------------------------------
/** @param {string[]} argv */
function parse(argv) {
  const options = {
    command: undefined,
    entry: undefined,
    exportName: undefined,
    format: undefined,
    check: false,
    kit: undefined,
    manifest: undefined,
    apply: false,
    help: false,
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = () => {
      const next = argv[index + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new UsageError(`${arg} needs a value`);
      }
      index += 1;
      return next;
    };
    switch (arg) {
      case '--help':
      case '-h':
        options.help = true;
        break;
      case '--export':
        options.exportName = value();
        break;
      case '--format':
        options.format = value();
        break;
      case '--check':
        options.check = true;
        break;
      case '--kit':
        options.kit = value();
        break;
      case '--manifest':
        options.manifest = value();
        break;
      case '--apply':
        options.apply = true;
        break;
      default:
        if (arg.startsWith('--')) {
          throw new UsageError(`unknown option ${arg}`);
        }
        positional.push(arg);
    }
  }
  [options.command, options.entry] = positional;
  return options;
}

/** `--format`, checked against what the command can print; the first is the default. */
function formatOf(options, command, allowed) {
  const format = options.format ?? allowed[0];
  if (!allowed.includes(format)) {
    throw new UsageError(
      `--format must be ${allowed.slice(0, -1).join(', ')} or ${allowed.at(-1)} for ${command}, not ${format}`
    );
  }
  return format;
}

class UsageError extends Error {}

// --- loading --------------------------------------------------------------
/** Whether a value has the shape `compileApplication` produces. */
function isPlan(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.name === 'string' &&
    Array.isArray(value.modules) &&
    Array.isArray(value.services)
  );
}

/**
 * Finds the plan in what the entry module exported: either a
 * `defineExtension` result (which carries `.plan`) or a plan itself.
 */
async function loadPlan(entryPath, exportName) {
  const url = pathToFileURL(resolvePath(entryPath)).href;
  const exported = await import(url);
  const candidates =
    exportName === undefined
      ? [exported.app, exported.default?.app, exported.default, exported.plan]
      : [exported[exportName], exported.default?.[exportName]];
  for (const candidate of candidates) {
    if (isPlan(candidate)) {
      return candidate;
    }
    if (typeof candidate === 'object' && candidate !== null && isPlan(candidate.plan)) {
      return candidate.plan;
    }
  }
  throw new UsageError(
    exportName === undefined
      ? `${entryPath} exports no plan. Export the defineExtension result as "app", or name the export with --export.`
      : `${entryPath} has no export "${exportName}" holding a defineExtension result or a plan.`
  );
}

/** Where each entry point lives inside the package, for a copy without an exports map to ask. */
const KIT_ENTRIES = { '.': 'dist/index.js', './testing': 'dist/testing/index.js' };

/**
 * One entry point of the package the plan is read with: the copy this tool
 * ships in, unless `--kit` names another. Accepts a package directory or, for
 * the root entry, a module file. `expected` names the export that has to be
 * there, which is also how a copy too old to have it is recognised.
 */
async function loadKit(kitPath, subpath, expected) {
  let target;
  if (kitPath === undefined) {
    target = new URL(`../${KIT_ENTRIES[subpath]}`, import.meta.url);
  } else {
    const absolute = resolvePath(kitPath);
    const manifestPath = resolvePath(absolute, 'package.json');
    if (existsSync(manifestPath)) {
      const entry =
        JSON.parse(readFileSync(manifestPath, 'utf8')).exports?.[subpath]?.import ??
        KIT_ENTRIES[subpath];
      target = pathToFileURL(resolvePath(absolute, entry));
    } else if (subpath === '.') {
      target = pathToFileURL(absolute);
    } else {
      throw new UsageError(
        `--kit must name the package directory, not a file, to reach ${subpath}`
      );
    }
  }
  const kit = await import(target.href);
  if (typeof kit[expected] !== 'function') {
    throw new UsageError(
      `${fileURLToPath(target)} does not export ${expected}; is it @kkdev92/vscode-ext-kit 4.1 or later?`
    );
  }
  return kit;
}

// --- output ---------------------------------------------------------------
/** A Mermaid/DOT-safe node id. */
const nodeId = (prefix, text) => `${prefix}_${text.replace(/[^A-Za-z0-9_]/g, '_')}`;
const quote = (text) => text.replace(/"/g, '#quot;');

/**
 * Modules as subgraphs; services, commands, hosted services, watchers and
 * views inside them; dependency edges between them. Framework services that
 * something depends on appear in their own subgraph, so an edge never points
 * at nothing.
 */
function toMermaid(description) {
  const lines = ['flowchart LR'];
  const edges = [];
  const frameworkUsed = new Set();
  const framework = new Set(description.frameworkServices);
  const service = (token) => nodeId('svc', token);
  const dependsOn = (from, dependencies, style) => {
    for (const token of Object.values(dependencies)) {
      if (framework.has(token)) {
        frameworkUsed.add(token);
      }
      edges.push(`  ${from} ${style} ${service(token)}`);
    }
  };

  for (const module of description.modules) {
    lines.push(`  subgraph ${nodeId('module', module.id)}["${quote(module.id)}"]`);
    for (const entry of description.services.filter((s) => s.moduleId === module.id)) {
      lines.push(
        `    ${service(entry.token)}["${quote(entry.token)}<br/><i>${entry.lifetime}</i>"]`
      );
      dependsOn(service(entry.token), entry.dependencies, '-->');
    }
    for (const entry of description.commands.filter((c) => c.moduleId === module.id)) {
      const id = nodeId('cmd', entry.id);
      lines.push(
        `    ${id}(["${entry.textEditor ? 'editor command' : 'command'}<br/>${quote(entry.id)}"])`
      );
      dependsOn(id, entry.dependencies, '-.->');
    }
    for (const entry of description.hostedServices.filter((h) => h.moduleId === module.id)) {
      const id = nodeId('hosted', entry.id);
      lines.push(`    ${id}[["hosted service<br/>${quote(entry.id)}"]]`);
      dependsOn(id, entry.dependencies, '-.->');
    }
    for (const entry of description.fileWatchers.filter((w) => w.moduleId === module.id)) {
      const id = nodeId('watch', entry.id);
      lines.push(`    ${id}>"watcher<br/>${quote(entry.id)}"]`);
      dependsOn(id, entry.dependencies, '-.->');
    }
    for (const [kind, list] of [
      ['tree view', description.treeViews],
      ['webview', description.webviewViews],
      ['panel restorer', description.webviewSerializers],
      ['raw', description.rawRegistrations],
    ]) {
      for (const entry of list.filter((v) => v.moduleId === module.id)) {
        const id = nodeId(kind.replace(/\s/g, ''), entry.id);
        lines.push(`    ${id}[/"${kind}<br/>${quote(entry.id)}"/]`);
        dependsOn(id, entry.dependencies, '-.->');
      }
    }
    lines.push('  end');
  }

  if (frameworkUsed.size > 0) {
    lines.push('  subgraph framework["framework services"]');
    for (const token of frameworkUsed) {
      lines.push(`    ${service(token)}["${quote(token)}"]`);
    }
    lines.push('  end');
  }

  return [...lines, ...edges].join('\n') + '\n';
}

/** The same graph for Graphviz. */
function toDot(description) {
  const lines = ['digraph plan {', '  rankdir=LR;', '  node [shape=box, fontname="Helvetica"];'];
  const edges = [];
  const frameworkUsed = new Set();
  const framework = new Set(description.frameworkServices);
  const dependsOn = (from, dependencies, style) => {
    for (const token of Object.values(dependencies)) {
      if (framework.has(token)) {
        frameworkUsed.add(token);
      }
      edges.push(`  "${from}" -> "${token}"${style};`);
    }
  };

  for (const module of description.modules) {
    lines.push(`  subgraph "cluster_${module.id}" {`, `    label="${module.id}";`);
    for (const entry of description.services.filter((s) => s.moduleId === module.id)) {
      lines.push(`    "${entry.token}" [label="${entry.token}\\n${entry.lifetime}"];`);
      dependsOn(entry.token, entry.dependencies, '');
    }
    const declared = [
      ...description.commands
        .filter((c) => c.moduleId === module.id)
        .map((c) => [c.id, c.textEditor ? 'editor command' : 'command', c.dependencies]),
      ...description.hostedServices
        .filter((h) => h.moduleId === module.id)
        .map((h) => [h.id, 'hosted service', h.dependencies]),
      ...description.fileWatchers
        .filter((w) => w.moduleId === module.id)
        .map((w) => [w.id, 'watcher', w.dependencies]),
      ...description.treeViews
        .filter((v) => v.moduleId === module.id)
        .map((v) => [v.id, 'tree view', v.dependencies]),
      ...description.webviewViews
        .filter((v) => v.moduleId === module.id)
        .map((v) => [v.id, 'webview', v.dependencies]),
      ...description.webviewSerializers
        .filter((v) => v.moduleId === module.id)
        .map((v) => [v.id, 'panel restorer', v.dependencies]),
      ...description.rawRegistrations
        .filter((v) => v.moduleId === module.id)
        .map((v) => [v.id, 'raw', v.dependencies]),
    ];
    for (const [id, kind, dependencies] of declared) {
      lines.push(`    "${id}" [shape=ellipse, label="${kind}\\n${id}"];`);
      dependsOn(id, dependencies, ' [style=dashed]');
    }
    lines.push('  }');
  }

  if (frameworkUsed.size > 0) {
    lines.push(
      '  subgraph "cluster_framework" {',
      '    label="framework services";',
      '    style=dashed;'
    );
    for (const token of frameworkUsed) {
      lines.push(`    "${token}";`);
    }
    lines.push('  }');
  }

  return [...lines, ...edges, '}'].join('\n') + '\n';
}

/** One line per problem, the way a compiler reports. */
function formatProblems(problems) {
  return problems
    .map((problem) => {
      const where = problem.moduleId === undefined ? '' : ` (module ${problem.moduleId})`;
      const what = problem.subject === undefined ? '' : ` ${problem.subject}`;
      return `  ${problem.code}${what}${where}\n      ${problem.message}`;
    })
    .join('\n');
}

// --- manifest -------------------------------------------------------------
/**
 * What the plan declares, in the shape `diffManifest` compares: command ids,
 * setting specs keyed by name, view ids. Built from the description rather
 * than the plan, so the only data this reads is the public, printable kind.
 */
function declaredContributions(description) {
  return {
    commands: description.commands.map((command) => ({ descriptor: { id: command.id } })),
    // A section the extension only reads (`contributed: false`) is not its to
    // contribute. Compared as "not false" so a description without the field
    // is treated the way it always was.
    settings: description.settings
      .filter((section) => section.contributed !== false)
      .map((section) => ({
        section: section.section,
        values: Object.fromEntries(
          section.values.map((value) => [
            value.key.slice(section.section.length + 1),
            {
              type: value.type.length === 1 ? value.type[0] : [...value.type],
              default: value.default,
              scope: value.scope,
              ...(value.enum === undefined ? {} : { enum: [...value.enum] }),
            },
          ])
        ),
      })),
    views: [...description.treeViews, ...description.webviewViews].map((view) => view.id),
  };
}

/** One entry per disagreement, with the JSON to paste under it when there is some. */
function formatMismatches(mismatches) {
  return mismatches
    .map((mismatch) =>
      mismatch.paste === undefined
        ? `  - ${mismatch.summary}`
        : `  - ${mismatch.summary}\n${mismatch.paste.replace(/^/gm, '      ')}`
    )
    .join('\n');
}

/** The indentation a JSON file uses, so writing it back does not reformat it. */
function indentationOf(text) {
  return /^(?<indent>[ \t]+)"/m.exec(text)?.groups.indent ?? 2;
}

/**
 * Adds what the manifest is missing and the source can supply. Commands and
 * settings carry everything mechanical — id, type, default, enum, scope — and
 * get placeholder titles and descriptions a person has to replace. Everything
 * else is a decision rather than a transcription and stays as it is: a view
 * needs a container, a drifted value has two candidates, and an entry only
 * the manifest has may be there on purpose.
 */
function applyMismatches(manifest, mismatches) {
  const applied = [];
  const remaining = [];
  manifest.contributes ??= {};
  const contributes = manifest.contributes;
  for (const mismatch of mismatches) {
    if (mismatch.direction !== 'missing-in-manifest' || mismatch.paste === undefined) {
      remaining.push(mismatch);
    } else if (mismatch.kind === 'command') {
      contributes.commands ??= [];
      contributes.commands.push(JSON.parse(mismatch.paste));
      applied.push(mismatch);
    } else if (mismatch.kind === 'setting' && !Array.isArray(contributes.configuration)) {
      contributes.configuration ??= {};
      contributes.configuration.properties ??= {};
      Object.assign(contributes.configuration.properties, JSON.parse(mismatch.paste));
      applied.push(mismatch);
    } else {
      // A setting while `contributes.configuration` is a list of sections:
      // which section it belongs in is not something the declaration says.
      remaining.push(mismatch);
    }
  }
  return { applied, remaining };
}

async function runManifest(options, description) {
  const format = formatOf(options, 'manifest', ['text', 'json']);
  const manifestPath = resolvePath(options.manifest ?? 'package.json');
  // Read first and explain a missing file afterwards, rather than checking for
  // it and then reading: the file can change between the two, and the read is
  // the only check that means anything.
  let text;
  try {
    text = readFileSync(manifestPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new UsageError(
        `${manifestPath} does not exist; point --manifest at the extension's package.json`
      );
    }
    throw error;
  }
  const manifest = JSON.parse(text);
  const { diffManifest } = await loadKit(options.kit, './testing', 'diffManifest');
  const declared = declaredContributions(description);
  const mismatches = diffManifest(manifest, declared);
  const shown = relative(process.cwd(), manifestPath) || manifestPath;

  if (options.apply) {
    const { applied, remaining } = applyMismatches(manifest, mismatches);
    if (applied.length > 0) {
      writeFileSync(
        manifestPath,
        JSON.stringify(manifest, null, indentationOf(text)) + (text.endsWith('\n') ? '\n' : '')
      );
    }
    if (format === 'json') {
      process.stdout.write(`${JSON.stringify({ applied, remaining }, null, 2)}\n`);
    } else {
      process.stdout.write(
        [
          `applied ${applied.length} change(s) to ${shown}`,
          ...applied.map((mismatch) => `  + ${mismatch.kind} "${mismatch.id}"`),
          ...(remaining.length === 0
            ? []
            : [`${remaining.length} disagreement(s) need a person:`, formatMismatches(remaining)]),
        ].join('\n') + '\n'
      );
    }
    return remaining.length === 0 ? EXIT_OK : EXIT_REJECTED;
  }

  if (format === 'json') {
    process.stdout.write(`${JSON.stringify(mismatches, null, 2)}\n`);
  } else if (mismatches.length === 0) {
    const settings = declared.settings.reduce((n, s) => n + Object.keys(s.values).length, 0);
    process.stdout.write(
      `manifest ok: ${declared.commands.length} command(s), ${settings} setting(s), ` +
        `${declared.views.length} view(s) agree\n`
    );
  } else {
    process.stdout.write(
      `${shown} disagrees with the plan in ${mismatches.length} place(s):\n${formatMismatches(mismatches)}\n`
    );
  }
  return mismatches.length === 0 ? EXIT_OK : EXIT_REJECTED;
}

// --- main -----------------------------------------------------------------
async function main(argv) {
  const options = parse(argv);
  if (options.help || options.command === undefined) {
    process.stdout.write(USAGE);
    return options.help ? EXIT_OK : EXIT_USAGE;
  }
  if (options.command !== 'plan' && options.command !== 'manifest') {
    throw new UsageError(
      `unknown command "${options.command}"; the commands are plan and manifest`
    );
  }
  if (options.entry === undefined) {
    throw new UsageError(`${options.command} needs an <entry> module`);
  }

  let plan;
  try {
    plan = await loadPlan(options.entry, options.exportName);
  } catch (error) {
    // Preflight rejects a plan by throwing while the entry module evaluates.
    // Recognised by name rather than by class: the error comes from whichever
    // copy of the package the entry imported, which need not be this one.
    if (
      error instanceof Error &&
      error.name === 'PreflightError' &&
      Array.isArray(error.problems)
    ) {
      process.stderr.write(
        `preflight rejected the plan with ${error.problems.length} problem(s):\n${formatProblems(error.problems)}\n`
      );
      return EXIT_REJECTED;
    }
    throw error;
  }

  const kit = await loadKit(options.kit, '.', 'describePlan');
  const description = kit.describePlan(plan);

  if (options.command === 'manifest') {
    return runManifest(options, description);
  }

  const format = formatOf(options, 'plan', ['json', 'mermaid', 'dot']);
  if (options.check) {
    process.stdout.write(
      `plan ok: ${description.modules.length} module(s), ${description.services.length} service(s), ` +
        `${description.commands.length} command(s), ${description.hostedServices.length} hosted service(s)\n`
    );
    return EXIT_OK;
  }

  const output =
    format === 'mermaid'
      ? toMermaid(description)
      : format === 'dot'
        ? toDot(description)
        : `${JSON.stringify(description, null, 2)}\n`;
  process.stdout.write(output);
  return EXIT_OK;
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof UsageError) {
    process.stderr.write(`vscode-ext-kit: ${error.message}\n\n${USAGE}`);
    process.exitCode = EXIT_USAGE;
  } else {
    process.stderr.write(
      `vscode-ext-kit: could not load the plan.\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`
    );
    process.exitCode = EXIT_USAGE;
  }
}
