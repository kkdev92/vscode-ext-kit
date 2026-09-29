import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

/**
 * `allowScripts` in the manifest, checked against the lockfile.
 *
 * npm 11 runs a dependency's install script only when `allowScripts` has a
 * matching entry, and skips every other one with a warning rather than an error.
 * An approval pinned to `pkg@1.2.3` stops matching the day the lockfile moves the
 * package, and a newly added dependency with an install script matches nothing,
 * so in both cases the script is skipped and every job stays green. These cases
 * turn that into a failure here, with the fix in the message.
 *
 * Reviewing an install script means approving it (`true`) or denying it
 * (`false`); either counts. Only packages that install on Linux, where CI runs,
 * need a review: an entry the lockfile limits to other operating systems never
 * installs there.
 */

interface LockEntry {
  readonly version?: string;
  readonly hasInstallScript?: boolean;
  readonly os?: readonly string[];
}

const manifest = JSON.parse(readFileSync('package.json', 'utf8')) as {
  allowScripts?: Record<string, boolean>;
};

const lock = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
  packages: Record<string, LockEntry>;
};

const MARKER = 'node_modules/';

/** `@scope/name@1.2.3` names a version; `@scope/name` alone covers every version. */
function parseKey(key: string): { name: string; version: string | undefined } {
  const at = key.lastIndexOf('@');
  return at > 0
    ? { name: key.slice(0, at), version: key.slice(at + 1) }
    : { name: key, version: undefined };
}

function installsOnLinux(os: readonly string[] | undefined): boolean {
  if (os === undefined || os.length === 0) return true;
  if (os.includes('!linux')) return false;
  const named = os.filter((entry) => !entry.startsWith('!'));
  return named.length === 0 || named.includes('linux');
}

const keys = Object.keys(manifest.allowScripts ?? {}).map(parseKey);

const withInstallScript = Object.entries(lock.packages)
  .filter(([path, entry]) => path.includes(MARKER) && entry.hasInstallScript === true)
  .map(([path, entry]) => ({
    name: path.slice(path.lastIndexOf(MARKER) + MARKER.length),
    version: entry.version ?? '',
    onLinux: installsOnLinux(entry.os),
  }));

describe('allowScripts against the lockfile', () => {
  it('finds install scripts in the lockfile to check', () => {
    // Without this, a lockfile the parsing below misreads would pass every case.
    expect(withInstallScript.length).toBeGreaterThan(0);
  });

  it('pins each approval to the version the lockfile installs', () => {
    const stale = keys.flatMap(({ name, version }) =>
      version === undefined
        ? []
        : withInstallScript
            .filter((pkg) => pkg.name === name && pkg.version !== version)
            .map(
              (pkg) =>
                `${name}@${version} is pinned but the lockfile installs ${pkg.version}; ` +
                `run \`npm install-scripts approve ${name}\``
            )
    );
    expect(stale).toEqual([]);
  });

  it('names only packages the lockfile installs with an install script', () => {
    const unused = keys
      .filter(({ name }) => !withInstallScript.some((pkg) => pkg.name === name))
      .map(({ name, version }) => (version === undefined ? name : `${name}@${version}`));
    expect(unused).toEqual([]);
  });

  it('reviews every install script CI would run', () => {
    const reviewed = new Set(keys.map(({ name }) => name));
    const unreviewed = withInstallScript
      .filter((pkg) => pkg.onLinux && !reviewed.has(pkg.name))
      .map((pkg) => `${pkg.name}@${pkg.version} has an install script allowScripts does not name`);
    expect(unreviewed).toEqual([]);
  });
});
