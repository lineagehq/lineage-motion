import { describe, expect, test } from 'vitest';
import { compileMotionDocument } from '../../css-compiler/src/index.ts';
import { canonicalBytes, sha256Hex } from '../../domain/src/index.ts';
import { makeTrackCreateCommand, MotionServiceClient } from '../../motion-protocol/src/index.ts';
import { ReviewServiceClient, type ReviewCommand } from '../../motion-protocol/src/review.ts';
import { REVIEW_SERIALIZER_VERSION } from '../../review-domain/src/index.ts';
import { startLocalMotionService } from './index.ts';
import { phase3Seed, temporaryStore } from './test-support.ts';

describe('review handoff service', () => {
  test('runs five actions without changing motion identity and derives a reusable deterministic handoff', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    const motion = new MotionServiceClient(service.url); const review = new ReviewServiceClient(service.url, fetch,
      { actor: 'human', capability: 'human-editor' });
    expect(await motion.dispatch(makeTrackCreateCommand({ operationId: 'review-base-revision', documentId: seed.documentId,
      expectedRevision: 0, elementId: 'el_2dbee68b1ea318c8' }))).toMatchObject({ ok: true });
    const before = await motion.head(seed.documentId); const beforeCompiled = compileMotionDocument(before.document);
    const privateBody = `ephemeral-${crypto.randomUUID()}`; let version = 0;
    const run = async (kind: ReviewCommand['kind'], body?: string) => { const command = { schemaVersion: 'review.operation.v1', kind,
      operationId: `review-op-${version}`, documentId: seed.documentId, branchId: 'main', expectedBranchRevision: 1,
      annotationId: 'annotation-1', expectedAnnotationVersion: version,
      ...(kind === 'review.annotation.create' ? { anchorRevision: 0, body: body! } : kind === 'review.annotation.edit' ? { body: body! } : {}) } as ReviewCommand;
      const response = await review.dispatch(command); expect(response).toMatchObject({ ok: true, annotation: { version: version + 1 } });
      expect(JSON.stringify(response)).not.toContain(privateBody); version += 1; return { command, response }; };
    const created = await run('review.annotation.create', privateBody); expect(await review.dispatch(created.command)).toEqual(created.response);
    await run('review.annotation.edit', `${privateBody}-replacement`); await run('review.annotation.resolve');
    await run('review.annotation.reopen'); await run('review.annotation.delete');
    expect((await review.annotations(seed.documentId, 'main')).annotations).toEqual([expect.objectContaining({ version: 5, state: 'deleted' })]);
    const after = await motion.head(seed.documentId); expect(canonicalBytes(after.document)).toEqual(canonicalBytes(before.document));
    expect(compileMotionDocument(after.document)).toEqual(beforeCompiled);
    const beforeComparison = service.store.snapshot(); const comparison = await review.compare(seed.documentId, 0, 1);
    expect(comparison).toMatchObject({ changed: true, unsupported: [], missing: [] });
    expect(service.store.snapshot()).toEqual(beforeComparison);
    const request = { operationId: 'handoff-one', schemaVersion: 'review.handoff-identity.v1' as const,
      serializerVersion: REVIEW_SERIALIZER_VERSION, documentId: seed.documentId, branchId: 'main', revision: 1,
      canonicalDigest: after.canonicalDigest, comparisonRecords: [{ schemaVersion: 'review.comparison-identity.v1' as const, leftRevision: 0,
        leftCanonicalDigest: (await motion.revision(seed.documentId, 0)).canonicalDigest, rightRevision: 1,
        rightCanonicalDigest: after.canonicalDigest }], proofRecords: [{ schemaVersion: 'review.proof-identity.v1' as const, revision: 1, canonicalDigest: after.canonicalDigest,
        htmlDigest: sha256Hex(beforeCompiled.html), cssDigest: sha256Hex(beforeCompiled.css), exportDigest: beforeCompiled.exportDigest }],
      benchmarkRecords: [] as [] };
    const handoff = await review.handoff(request); expect(await review.handoff(request)).toEqual(handoff);
    expect(handoff.identity.benchmarkRecords).toEqual([]); expect(JSON.stringify(handoff)).not.toContain(privateBody);
    const second = await review.handoff({ ...request, operationId: 'handoff-two' }); expect(second).toEqual(handoff);
    await service.close(); await temporary.cleanup();
  });

  test('atomically rejects stale versions and requires a claim for agents', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed(); const now = 1_000;
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed, now: () => now });
    const human = new ReviewServiceClient(service.url, fetch, { actor: 'human', capability: 'human-editor' });
    const base = { schemaVersion: 'review.operation.v1' as const, operationId: 'human-create', documentId: seed.documentId,
      branchId: 'main', expectedBranchRevision: 0, annotationId: 'annotation-atomic', expectedAnnotationVersion: 0,
      kind: 'review.annotation.create' as const, anchorRevision: 0, body: `ephemeral-${crypto.randomUUID()}` };
    expect(await human.dispatch(base)).toMatchObject({ ok: true }); const stable = service.store.snapshot();
    const { anchorRevision: _anchor, ...editBase } = base;
    expect(await human.dispatch({ ...editBase, operationId: 'stale-version', kind: 'review.annotation.edit', body: 'synthetic' }))
      .toMatchObject({ ok: false, code: 'STALE_ANNOTATION_VERSION' }); expect(service.store.snapshot()).toEqual(stable);
    const agent = new ReviewServiceClient(service.url, fetch, { actor: 'agent', capability: 'cli-agent', claimSecret: 'x'.repeat(43) });
    expect(await agent.dispatch({ ...base, operationId: 'agent-no-claim', annotationId: 'agent-note' }))
      .toMatchObject({ ok: false, code: 'UNAUTHORIZED_CLAIM' }); expect(service.store.snapshot()).toEqual(stable);
    expect(await human.dispatch({ ...base, operationId: 'stale-branch', annotationId: 'stale-branch-note',
      expectedBranchRevision: 1 })).toMatchObject({ ok: false, code: 'STALE_BRANCH_REVISION' });
    expect(service.store.snapshot()).toEqual(stable);
    expect(await human.dispatch({ ...base, body: 'changed-request' })).toMatchObject({ ok: false, code: 'OPERATION_ID_CONFLICT' });
    expect(service.store.snapshot()).toEqual(stable);
    await service.close(); await temporary.cleanup();
  });

  test('rejects unknown handoff fields at HTTP ingress without echoing their sentinel', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed }); const before = service.store.snapshot();
    const response = await fetch(`${service.url}/api/review/v1/handoffs`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: 'Bearer human-editor', 'x-motion-actor': 'human' }, body: JSON.stringify({
        operationId: 'invalid-handoff', schemaVersion: 'review.handoff-identity.v1', serializerVersion: 'review.serializer.v1',
        documentId: seed.documentId, branchId: 'main', revision: 0, canonicalDigest: 'a'.repeat(64),
        comparisonRecords: [], proofRecords: [], benchmarkRecords: [], unallowlistedSentinel: 'must-not-escape' }) });
    const text = await response.text(); expect(response.status).toBe(422); expect(text).not.toContain('must-not-escape');
    expect(JSON.parse(text)).toMatchObject({ diagnostic: { code: 'PROTOCOL_HANDOFF_REQUEST_INVALID' } });
    expect(service.store.snapshot()).toEqual(before); await service.close(); await temporary.cleanup();
  });

  test('serializes concurrent annotation CAS so exactly one edit commits', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    const review = new ReviewServiceClient(service.url, fetch, { actor: 'human', capability: 'human-editor' });
    const create = { schemaVersion: 'review.operation.v1' as const, kind: 'review.annotation.create' as const,
      operationId: 'cas-create', documentId: seed.documentId, branchId: 'main', expectedBranchRevision: 0,
      annotationId: 'cas-note', expectedAnnotationVersion: 0, anchorRevision: 0, body: 'synthetic-create' };
    expect(await review.dispatch(create)).toMatchObject({ ok: true });
    const common = { schemaVersion: 'review.operation.v1' as const, kind: 'review.annotation.edit' as const,
      documentId: seed.documentId, branchId: 'main', expectedBranchRevision: 0, annotationId: 'cas-note', expectedAnnotationVersion: 1 };
    const results = await Promise.all([review.dispatch({ ...common, operationId: 'cas-edit-a', body: 'synthetic-a' }),
      review.dispatch({ ...common, operationId: 'cas-edit-b', body: 'synthetic-b' })]);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([expect.objectContaining({ code: 'STALE_ANNOTATION_VERSION' })]);
    expect(service.store.readReviewEvents(seed.documentId, 0)).toHaveLength(2);
    await service.close(); await temporary.cleanup();
  });
});
