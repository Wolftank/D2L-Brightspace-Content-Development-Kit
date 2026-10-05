// @ts-check
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'src/db/migrations/**', 'kit/**'],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.test.ts'],
    ignores: ['src/**/*.int.test.ts', 'src/**/*.live.test.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          {
            group: ['node:fs', 'node:fs/*', 'fs', 'fs/*'],
            message: 'Unit tests (*.test.ts) must not use the filesystem. Rename to *.int.test.ts.',
          },
          {
            group: ['better-sqlite3', 'drizzle-orm', 'drizzle-orm/*', '**/test-db*'],
            message: 'Unit tests (*.test.ts) must not use the database. Rename to *.int.test.ts.',
          },
          {
            group: ['supertest', 'node:http', 'node:https', 'http', 'https'],
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
