// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'release/**', 'node_modules/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.test.ts'],
    ignores: ['src/**/*.int.test.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['node:fs', 'node:fs/*', 'fs', 'fs/*'],
            message: 'Unit tests (*.test.ts) must not use the filesystem. Rename to *.int.test.ts.',
          },
          {
            group: ['node:net', 'node:http', 'node:https', 'net', 'http', 'https'],
            message: 'Unit tests (*.test.ts) must not use the network. Rename to *.int.test.ts.',
          },
          {
            group: ['node:child_process', 'child_process'],
            message: 'Unit tests (*.test.ts) must not use child processes. Rename to *.int.test.ts.',
          },
        ],
      }],
    },
  },
);
