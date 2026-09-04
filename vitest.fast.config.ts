import { defineConfig } from 'vitest/config';

import { verificationSuites } from './scripts/repository-policy/verification-manifest.mjs';
import { repositoryTestExcludes } from './vitest.config';

export default defineConfig({
  test: {
    environment: 'node',
    exclude: repositoryTestExcludes,
    include: verificationSuites['fast-unit'].files,
  },
});
