import { describe, expect, test } from 'vitest';
import { MotionServiceClient, makeBranchCreateCommand, makeClaimAcquireCommand, makeClaimControlCommand,
  makeTrackCreateCommand } from '../../motion-protocol/src/index.ts';
import { startLocalMotionService } from './index.ts';
import { phase3Seed, temporaryStore } from './test-support.ts';
import { createLegacyV1Database } from './sqlite-project-store.ts';
import { compileMotionDocument } from '../../css-compiler/src/index.ts';

describe('branch/claim bounded recovery', () => {
  test('migrates v1 transactionally while preserving the main head and export digest', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed(); createLegacyV1Database(temp.databasePath, seed);
    const before = compileMotionDocument(seed).exportDigest; const service = await startLocalMotionService({ databasePath: temp.databasePath, seed });
    const head = service.store.readHead(seed.documentId)!; expect(head.document).toEqual(seed);
    expect(compileMotionDocument(head.document).exportDigest).toBe(before);
    expect((service.store as unknown as { database: { prepare(sql: string): { get(): unknown } } }).database
      .prepare('SELECT checksum FROM schema_migrations WHERE version=2').get()).toEqual({ checksum: 'phase3-branches-claims-v2' });
    await service.close(); await temp.cleanup();
  });
  test('returns the byte-identical acquisition after a lost response and stores only a verifier', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed(); let injected = false;
    const secret = ['lost', 'claim', 'proof', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const service = await startLocalMotionService({ databasePath: temp.databasePath, seed, now: () => 100,
      fault: (point) => { if (!injected && point === 'after-commit') { injected = true; throw new Error('LOST'); } } });
    const client = new MotionServiceClient(service.url, (...args) => fetch(...args), { actor: 'agent', capability: 'cli-agent', claimSecret: secret });
    const command = makeClaimAcquireCommand({ operationId: 'lost-acquire', documentId: seed.documentId, expectedRevision: 0, scope: 'document' });
    expect(await client.dispatch(command)).toEqual({ ok: false, code: 'STORAGE_FAILURE' }); await service.close();
    const restarted = await startLocalMotionService({ databasePath: temp.databasePath, seed, now: () => 100 });
    const retryClient = new MotionServiceClient(restarted.url, (...args) => fetch(...args), { actor: 'agent', capability: 'cli-agent', claimSecret: secret });
    const retry = await retryClient.dispatch(command); expect(retry).toMatchObject({ ok: true, leaseVersion: 1 });
    const stored = restarted.store.snapshot() as { claims: unknown[] }; const snapshot = JSON.stringify(stored);
    expect(snapshot).not.toContain(secret); expect(stored.claims).toHaveLength(1);
    expect(await retryClient.dispatch(command)).toEqual(retry); await restarted.close(); await temp.cleanup();
  });
  test('restarts with diverged heads and an idempotent document lease transition intact', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed(); const secret = ['restart', 'lease', 'proof',
      '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-'); let service = await startLocalMotionService({
      databasePath: temp.databasePath, seed, now: () => 100 }); let human = new MotionServiceClient(service.url);
    await human.dispatch(makeBranchCreateCommand({ operationId: 'restart-branch', documentId: seed.documentId,
      expectedRevision: 0, branchId: 'feature' }));
    await human.dispatch(makeTrackCreateCommand({ operationId: 'restart-main', documentId: seed.documentId,
      expectedRevision: 0, elementId: 'el_a2849ff826f3e167' }));
    await human.dispatch(makeTrackCreateCommand({ operationId: 'restart-feature', documentId: seed.documentId,
      branchId: 'feature', expectedRevision: 0, elementId: 'el_2dbee68b1ea318c8' }));
    let client = new MotionServiceClient(service.url, (...args) => fetch(...args),
      { actor: 'agent', capability: 'cli-agent', claimSecret: secret });
    const acquired = await client.dispatch(makeClaimAcquireCommand({ operationId: 'restart-acquire', documentId: seed.documentId,
      branchId: 'main', expectedRevision: 2, scope: 'document' }));
    if (!acquired.ok) throw new Error('RESTART_ACQUIRE_FAILED');
    const renew = makeClaimControlCommand({ kind: 'motion.claim.renew', operationId: 'restart-renew', documentId: seed.documentId,
      branchId: 'main', expectedRevision: 2, claimId: acquired.claimId!, leaseVersion: 1 });
    const renewed = await client.dispatch(renew); expect(renewed).toMatchObject({ ok: true, resultingRevision: 1, leaseVersion: 2 });
    const mainBefore = await human.head(seed.documentId, 'main'); const featureBefore = await human.head(seed.documentId, 'feature');
    await service.close(); service = await startLocalMotionService({ databasePath: temp.databasePath, seed, now: () => 100 });
    human = new MotionServiceClient(service.url); client = new MotionServiceClient(service.url, (...args) => fetch(...args),
      { actor: 'agent', capability: 'cli-agent', claimSecret: secret });
    expect(await human.head(seed.documentId, 'main')).toEqual(mainBefore);
    expect(await human.head(seed.documentId, 'feature')).toEqual(featureBefore);
    expect(await client.dispatch(renew)).toEqual(renewed);
    const release = await client.dispatch(makeClaimControlCommand({ kind: 'motion.claim.release', operationId: 'restart-release',
      documentId: seed.documentId, branchId: 'main', expectedRevision: 2, claimId: acquired.claimId!, leaseVersion: 2 }));
    expect(release).toMatchObject({ ok: true, resultingRevision: 1, leaseVersion: 3 });
    expect(await client.dispatch(makeTrackCreateCommand({ operationId: 'restart-after-release', documentId: seed.documentId,
      branchId: 'main', expectedRevision: 1, elementId: 'el_2dbee68b1ea318c8' })))
      .toEqual({ ok: false, code: 'UNAUTHORIZED_CLAIM' });
    expect(JSON.stringify(service.store.snapshot())).not.toContain(secret);
    await service.close(); await temp.cleanup();
  });
});
