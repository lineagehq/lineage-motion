import { describe, expect, test } from 'vitest';
import { makeBranchCreateCommand, makeClaimAcquireCommand, MotionServiceClient } from '../../motion-protocol/src/index.ts';
import { ReviewServiceClient } from '../../motion-protocol/src/review.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { phase3Seed, temporaryStore } from '../../local-service/src/test-support.ts';

describe('review editor and claimed-agent parity', () => {
  test('produces equal sanitized receipts from equal commands while enforcing the agent claim', async () => {
    const seed = phase3Seed(); const a = await temporaryStore(); const b = await temporaryStore();
    const humanService = await startLocalMotionService({ databasePath: a.databasePath, seed });
    const agentService = await startLocalMotionService({ databasePath: b.databasePath, seed });
    const secret = ['claimed', 'agent', 'proof', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const agentMotion = new MotionServiceClient(agentService.url, fetch, { actor: 'agent', capability: 'cli-agent', claimSecret: secret });
    expect(await agentMotion.dispatch(makeClaimAcquireCommand({ operationId: 'review-claim', documentId: seed.documentId,
      expectedRevision: 0, scope: 'branch' }))).toMatchObject({ ok: true });
    const human = new ReviewServiceClient(humanService.url, fetch, { actor: 'human', capability: 'human-editor' });
    const agent = new ReviewServiceClient(agentService.url, fetch, { actor: 'agent', capability: 'cli-agent', claimSecret: secret });
    const body = `ephemeral-${crypto.randomUUID()}`; const command = { schemaVersion: 'review.operation.v1' as const,
      kind: 'review.annotation.create' as const, operationId: 'review-parity', documentId: seed.documentId, branchId: 'main',
      expectedBranchRevision: 0, annotationId: 'parity-note', expectedAnnotationVersion: 0, anchorRevision: 0, body };
    expect(await agent.dispatch(command)).toEqual(await human.dispatch(command));
    expect(JSON.stringify(agentService.store.readReviewEvents(seed.documentId, 0))).not.toContain(body);
    await humanService.close(); await agentService.close(); await a.cleanup(); await b.cleanup();
  });
  test('binds replay to the active claim and rejects wrong, expired, and scope-mismatched claim contexts', async () => {
    const seed = phase3Seed(); const temporary = await temporaryStore(); let now = 1_000;
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed, now: () => now });
    const humanMotion = new MotionServiceClient(service.url); expect(await humanMotion.dispatch(makeBranchCreateCommand({
      operationId: 'claim-feature', documentId: seed.documentId, expectedRevision: 0, branchId: 'feature' }))).toMatchObject({ ok: true });
    const mainSecret = ['main', 'claim', 'proof', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const mainMotion = new MotionServiceClient(service.url, fetch, { actor: 'agent', capability: 'cli-agent', claimSecret: mainSecret });
    expect(await mainMotion.dispatch(makeClaimAcquireCommand({ operationId: 'claim-main', documentId: seed.documentId,
      expectedRevision: 0, branchId: 'main', scope: 'branch' }))).toMatchObject({ ok: true });
    const command = { schemaVersion: 'review.operation.v1' as const, kind: 'review.annotation.create' as const,
      operationId: 'claim-bound-review', documentId: seed.documentId, branchId: 'main', expectedBranchRevision: 0,
      annotationId: 'claim-note', expectedAnnotationVersion: 0, anchorRevision: 0, body: 'synthetic-claim-body' };
    const claimed = new ReviewServiceClient(service.url, fetch, { actor: 'agent', capability: 'cli-agent', claimSecret: mainSecret });
    expect(await claimed.dispatch(command)).toMatchObject({ ok: true }); const stable = service.store.snapshot();
    expect(await new ReviewServiceClient(service.url, fetch, { actor: 'agent', capability: 'cli-agent',
      claimSecret: ['wrong', 'claim', 'context', 'abcdefghijklmnopqrstuvwxyz'].join('-') }).dispatch(command))
      .toMatchObject({ ok: false, code: 'UNAUTHORIZED_CLAIM' }); expect(service.store.snapshot()).toEqual(stable);
    expect(await new ReviewServiceClient(service.url, fetch, { actor: 'human', capability: 'human-editor' }).dispatch(command))
      .toMatchObject({ ok: false, code: 'OPERATION_ID_CONFLICT' }); expect(service.store.snapshot()).toEqual(stable);
    now = 70_000; expect(await claimed.dispatch(command)).toMatchObject({ ok: false, code: 'UNAUTHORIZED_CLAIM',
      diagnostic: { code: 'CLAIM_EXPIRED' } }); expect(service.store.snapshot()).toEqual(stable);
    now = 1_000; const featureSecret = ['feature', 'claim', 'proof', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const featureMotion = new MotionServiceClient(service.url, fetch, { actor: 'agent', capability: 'cli-agent', claimSecret: featureSecret });
    expect(await featureMotion.dispatch(makeClaimAcquireCommand({ operationId: 'claim-feature-agent', documentId: seed.documentId,
      expectedRevision: 0, branchId: 'feature', scope: 'branch' }))).toMatchObject({ ok: true });
    expect(await new ReviewServiceClient(service.url, fetch, { actor: 'agent', capability: 'cli-agent', claimSecret: featureSecret })
      .dispatch({ ...command, operationId: 'scope-mismatch', annotationId: 'scope-note' }))
      .toMatchObject({ ok: false, code: 'UNAUTHORIZED_CLAIM', diagnostic: { code: 'CLAIM_SCOPE_MISMATCH' } });
    await service.close(); await temporary.cleanup();
  });
});
