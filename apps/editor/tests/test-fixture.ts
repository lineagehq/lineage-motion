import { test as base, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { stopAllTestServers, takeServerDiagnostics } from './test-server.ts';

export { expect };
export const test = base.extend<{ serverLifecycle: void }>({
  baseURL: async ({}, use) => { await use(process.env.MOTION_STATIC_URL); },
  serverLifecycle: [async ({}, use, testInfo) => {
    try { await use(); }
    finally {
      await stopAllTestServers();
      const diagnostic = takeServerDiagnostics();
      if (testInfo.status !== testInfo.expectedStatus && diagnostic) {
        const path = testInfo.outputPath('server-diagnostics.txt');
        await writeFile(path, diagnostic, { mode: 0o600 });
        await testInfo.attach('server-diagnostics', { path, contentType: 'text/plain' });
      }
    }
  }, { auto: true }],
});
