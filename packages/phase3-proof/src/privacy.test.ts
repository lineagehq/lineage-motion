import { readFile, readdir } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { phase3Command, phase3Seed, temporaryStore } from '../../local-service/src/test-support.ts';
import { MotionServiceClient, makeClaimAcquireCommand } from '../../motion-protocol/src/index.ts';

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
  test('keeps claim proofs out of responses, events, snapshots, and SQLite bytes', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed(); const secret = ['verifier', 'only', 'private',
      '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-'); const service = await startLocalMotionService({
      databasePath: temporary.databasePath, seed, now: () => 100 });
    const client = new MotionServiceClient(service.url, (...args) => fetch(...args),
      { actor: 'agent', capability: 'cli-agent', claimSecret: secret });
    const response = await client.dispatch(makeClaimAcquireCommand({ operationId: 'privacy-claim', documentId: seed.documentId,
      expectedRevision: 0, scope: 'document' }));
    expect(response).toMatchObject({ ok: true, claimId: expect.stringMatching(/^claim_/) });
    const snapshot = JSON.stringify(service.store.snapshot()); const receipt = JSON.stringify(response);
    for (const evidence of [snapshot, receipt]) { expect(evidence).not.toContain(secret); expect(evidence).not.toContain('claimSecret'); }
    await service.close(); const bytes = await readFile(temporary.databasePath);
    expect(bytes.includes(Buffer.from(secret))).toBe(false); await temporary.cleanup();
  });
});
