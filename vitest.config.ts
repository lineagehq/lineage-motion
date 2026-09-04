import { defineConfig } from 'vitest/config';

export const repositoryTestExcludes = [
  '**/.git/**',
  '**/.worktrees/**',
  '**/node_modules/**',
  '**/.next/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/vendor/**',
  '**/.cache/**',
  '**/.vite/**',
  '**/playwright-report/**',
  '**/test-results/**',
];

export default defineConfig({
  test: {
    environment: 'node',
    exclude: repositoryTestExcludes,
  },
});
