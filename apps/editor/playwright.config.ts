import { randomUUID } from 'node:crypto';
import { defineConfig } from '@playwright/test';

process.env.MOTION_DIAGNOSTIC_RUN ??= randomUUID();
const run = process.env.MOTION_DIAGNOSTIC_RUN;
const suite = process.env.MOTION_DIAGNOSTIC_SUITE ?? 'direct';
if (!/^[a-f0-9-]{36}$/.test(run) || !/^[a-z-]{1,40}$/.test(suite)) throw new Error('Invalid diagnostic identity');

export default defineConfig({
  testDir: './tests',
  globalSetup: './tests/global-setup.ts',
  outputDir: `./test-results/${run}/${suite}`,
  preserveOutput: 'failures-only',
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
