import { defineConfig } from 'vitest/config';

// Deliberately has NO vscode mock setup file: the runtime core is vscode-free, so
// a test that reaches for `vscode` should fail to resolve rather than silently
// pick up a mock.
export default defineConfig({
  test: {
    globals: true,
    clearMocks: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/**/*.ts'],
      // Barrels re-export only.
      exclude: ['src/index.ts', 'src/testing/index.ts'],
      // Global thresholds plus a floor per layer.
      //
      // The global numbers alone were not a gate: `foundation` and
      // `capabilities` sit in the mid-90s and carry the aggregate, so the
      // lifecycle core could shed a lot of coverage without the total ever
      // dropping to 80. Each layer therefore has its own floor, set just under
      // what it measures today, so a regression trips where it happens.
      //
      // Verified rather than assumed: a glob group is checked *in addition to*
      // the global thresholds (not instead of), the group's coverage is the
      // aggregate over its files, and a threshold miss exits non-zero — which is
      // what makes wiring this into `quality` and CI meaningful.
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
        // The v3 architecture core: the highest bar, because everything else
        // trusts its lifecycle, and it is pure logic with no host to blame.
        'src/foundation/**': { lines: 92, functions: 92, branches: 84, statements: 92 },
        'src/capabilities/**': { lines: 90, functions: 88, branches: 82, statements: 90 },
        // The adapter layer is now almost nothing but translation, and the
        // Extension Host lane is what really exercises it. This floor dropped
        // from 68/52/62 when S6 deleted ~450 lines of well-tested v2 standalones
        // that used to live here -- the layer's percentage fell without a single
        // test being lost, because what remains is the part only a real host can
        // reach. Set just under today's 66.2/50.3/75.0.
        'src/vscode/**': { lines: 64, functions: 70, branches: 48, statements: 64 },
        // A fake that drifts is worse than no fake, so the published test
        // surface is held to the same bar as the core.
        'src/testing/fakes/**': { lines: 92, functions: 92, branches: 84, statements: 92 },
        'src/testing/test-host.ts': { lines: 90, functions: 88, branches: 80, statements: 90 },
        // The mock kit mirrors the vscode API surface for *consumers*, so most
        // of it is reachable only from a consumer's test. This is a deliberately
        // low floor that still catches a collapse; raising it means writing
        // consumer-facing tests, which is tracked separately.
        'src/testing/mock/**': { lines: 50, functions: 50, branches: 15, statements: 50 },
      },
    },
  },
});
