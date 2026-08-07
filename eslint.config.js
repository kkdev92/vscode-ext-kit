import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/',
      '**/node_modules/**',
      '**/coverage/**',
      'eslint.config.js',
      'vitest.config.ts',
      // Bundled fixture output (esbuild writes here) and the VS Code builds the
      // host contract lanes download.
      '**/out/**',
      '.vscode-test/**',
      '.vscode-test-web/**',
    ],
  },

  // Type-aware linting, using the same TypeScript 6.0.x as `tsc`, with
  // projectService resolving each file to the nearest tsconfig.json.
  {
    files: ['src/**/*.ts', 'tests/**/*.ts', 'fixtures/**/*.ts'],
    extends: [
      eslint.configs.recommended,
      ...tseslint.configs.recommendedTypeChecked,
      eslintConfigPrettier,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Redundant under type-aware linting, and it does not know the
      // WebWorker/ES lib globals the framework compiles against.
      'no-undef': 'off',
      'no-console': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/only-throw-error': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-import-type-side-effects': 'error',
    },
  },

  // Architecture rules. Enforced with no-restricted-imports first; a dedicated
  // plugin only if these prove insufficient.
  //
  // The mock kit (vscode-mock/mock-factories) is also exempt: it *implements*
  // the vscode API surface, so it type-imports vscode to stay shape-accurate.
  // allowTypeImports keeps that legal while still banning runtime imports.
  {
    files: ['src/**/*.ts'],
    ignores: ['src/vscode/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vscode',
              message:
                'The runtime core stays vscode-free so it can run on a fake capability in the Test Host. Depend on a capability port; only src/vscode/** may import vscode.',
            },
          ],
          patterns: [
            {
              group: ['node:*'],
              message:
                'The runtime core must not use Node built-ins: it has to load in the web/worker extension host.',
            },
          ],
        },
      ],
    },
  },

  // The mock kit *implements* the vscode API surface, so shape-accuracy needs
  // vscode's types. Type-only imports carry no runtime dependency; the runtime
  // ban (and the Node built-ins ban) still applies.
  {
    files: ['src/testing/mock/vscode-mock.ts', 'src/testing/mock/mock-factories.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'vscode',
              allowTypeImports: true,
              message:
                'The mock kit may reference vscode types for shape accuracy, but must not import it at runtime.',
            },
          ],
          patterns: [
            {
              group: ['node:*'],
              message:
                'The runtime core must not use Node built-ins: it has to load in the web/worker extension host.',
            },
          ],
        },
      ],
    },
  },

  {
    // A fixture is a test harness inside a real extension host; writing to the
    // console is how its results get out.
    files: ['fixtures/**/*.ts'],
    rules: {
      'no-console': 'off',
    },
  },

  {
    files: ['tests/**/*.ts'],
    rules: {
      // Mock shapes need casts that production code must not use.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  }
);
