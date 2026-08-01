/**
 * @packageDocumentation
 * The Vitest configuration needed to test a VS Code extension, as a value you
 * can merge instead of settings you have to know about.
 *
 * Two things have to line up, and getting either wrong produces an error that
 * doesn't name its cause: `vscode` must resolve to a mock, and this kit must be
 * transformed by Vite rather than externalized, or its *own* `vscode` imports
 * bypass that mock. See {@link vscodeExtKitVitestConfig} for the details.
 */

/**
 * Drop-in Vitest config: aliases `vscode` to
 * `@kkdev92/vscode-ext-kit/testing/vitest` and inlines this kit so the alias
 * reaches it.
 *
 * ```ts
 * // vitest.config.ts
 * import { defineConfig, mergeConfig } from 'vitest/config';
 * import { vscodeExtKitVitestConfig } from '@kkdev92/vscode-ext-kit/testing/vitest-config';
 *
 * export default mergeConfig(
 *   vscodeExtKitVitestConfig,
 *   defineConfig({
 *     test: { clearMocks: true, include: ['tests/**\/*.test.ts'] },
 *   })
 * );
 * ```
 *
 * Why each half is required:
 *
 * - **`resolve.alias`** points every `import ... from 'vscode'` at the mock in
 *   {@link ./vitest.js `@kkdev92/vscode-ext-kit/testing/vitest`}. Unlike
 *   `vi.mock('vscode', ...)`, an alias also applies to code Vite did not
 *   transform on your behalf, which is what lets you `activate()` a built
 *   bundle in a test.
 * - **`server.deps.inline`** stops Vitest from externalizing this package.
 *   Externalized dependencies load through Node's ESM loader, which knows
 *   nothing about Vite aliases — so without this, the kit's own
 *   `import * as vscode from 'vscode'` fails with `Cannot find package
 *   'vscode'` even though your test files resolve it fine.
 *
 * Merge order matters only if you also set these keys: `mergeConfig`
 * concatenates arrays and lets the second argument win on scalars, so passing
 * your own config second is the safe default.
 *
 * Plain object rather than a `defineConfig` call, so importing this never drags
 * Vitest's config types into a project that pins a different Vitest major.
 */
export const vscodeExtKitVitestConfig = {
  resolve: {
    alias: {
      vscode: '@kkdev92/vscode-ext-kit/testing/vitest',
    },
  },
  test: {
    server: {
      deps: {
        inline: ['@kkdev92/vscode-ext-kit'],
      },
    },
  },
} as const;
