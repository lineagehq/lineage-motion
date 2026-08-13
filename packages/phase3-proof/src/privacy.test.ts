import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { phase3Command, phase3Seed, temporaryStore } from '../../local-service/src/test-support.ts';
import { MotionServiceClient } from '../../motion-protocol/src/index.ts';

describe('Phase 3 privacy boundary', () => {
  test('keeps stores temporary and receipts free of content, selectors, paths, URLs, and credentials', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    const response = await new MotionServiceClient(service.url).dispatch(phase3Command('privacy'));
    const receipt = JSON.stringify(response);
    for (const forbidden of ['selectorHint', 'presentation', '<html', 'http://', 'https://', temporary.directory,
      'private_payload_json', 'credential', 'token']) expect(receipt).not.toContain(forbidden);
    await service.close();
    expect((await readdir(temporary.directory)).some((name) => name.endsWith('.sqlite'))).toBe(true);
    expect((await readFile(temporary.databasePath)).length).toBeGreaterThan(0);
    await temporary.cleanup();
  });
});
