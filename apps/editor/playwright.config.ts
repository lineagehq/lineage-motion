import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  outputDir: './test-results',
  fullyParallel: false,
  workers: 1,
  reporter: 'line',
  use: {
    browserName: 'chromium',
    ...(process.env.MOTION_TEST_BROWSER === 'chrome' ? { channel: 'chrome' } : {}),
    headless: true,
    viewport: { width: 1280, height: 900 },
  },
});
