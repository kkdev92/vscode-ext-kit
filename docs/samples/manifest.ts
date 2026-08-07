import { defineCommandContract, defineSettings, setting } from '@kkdev92/vscode-ext-kit';
import { assertManifestMatches } from '@kkdev92/vscode-ext-kit/testing';

// VS Code reads package.json before any extension code runs, so the manifest
// and `src` can never collapse into one file. What overlaps is small and
// mechanical -- ids, types, defaults, enum values, scopes -- and this is the
// check that keeps the two from drifting apart there.
const Settings = defineSettings({
  section: 'sample',
  values: {
    limit: setting.number({ default: 10, minimum: 1 }),
    mode: setting.enum({ values: ['fast', 'thorough'], default: 'fast' }),
  },
});

const Contracts = {
  Refresh: defineCommandContract<readonly [], void>({ id: 'sample.refresh' }),
  Clear: defineCommandContract<readonly [], void>({ id: 'sample.clear' }),
};

// Call this from whichever test runner you use, with the parsed package.json
// (`JSON.parse(readFileSync('package.json', 'utf8'))`). It has no runner
// dependency of its own, and it throws once -- naming every disagreement and
// printing the JSON to paste, so the fix is always "update the manifest".
export function checkManifest(manifest: unknown): void {
  assertManifestMatches(manifest, {
    settings: [Settings],
    commands: Object.values(Contracts),
    views: ['sample.projects'],
  });
}
