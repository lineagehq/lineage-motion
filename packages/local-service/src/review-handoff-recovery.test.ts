import { describe, expect, test } from 'vitest';
import { ReviewServiceClient } from '../../motion-protocol/src/review.ts';
import { startLocalMotionService } from './index.ts';
import { phase3Seed, temporaryStore } from './test-support.ts';

describe('review recovery', () => {
  for (const faultPoint of ['after-begin', 'after-inserts', 'before-commit'] as const) test(`rolls back ${faultPoint} without review state or events`, async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed(); let armed = true;
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed,
      fault: (point) => { if (armed && point === faultPoint) { armed = false; throw new Error('synthetic-fault'); } } });
    const before = service.store.snapshot(); const client = new ReviewServiceClient(service.url, fetch,
      { actor: 'human', capability: 'human-editor' });
    const command = { schemaVersion: 'review.operation.v1' as const, kind: 'review.annotation.create' as const,
      operationId: `fault-${faultPoint}`, documentId: seed.documentId, branchId: 'main', expectedBranchRevision: 0,
      annotationId: `note-${faultPoint}`, expectedAnnotationVersion: 0, anchorRevision: 0, body: `ephemeral-${crypto.randomUUID()}` };
    expect(await client.dispatch(command)).toMatchObject({ ok: false, code: 'STORAGE_FAILURE' });
    expect(service.store.snapshot()).toEqual(before); expect(service.store.readReviewEvents(seed.documentId, 0)).toEqual([]);
    expect(await client.dispatch(command)).toMatchObject({ ok: true, annotation: { version: 1 } });
    expect(service.store.readReviewEvents(seed.documentId, 0)).toHaveLength(1);
    await service.close(); await temporary.cleanup();
  });
  test('recovers a committed lost response exactly after restart', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed(); let fail = true;
    let service = await startLocalMotionService({ databasePath: temporary.databasePath, seed,
      fault: (point) => { if (fail && point === 'after-commit') { fail = false; throw new Error('lost'); } } });
    const client = new ReviewServiceClient(service.url, fetch, { actor: 'human', capability: 'human-editor' });
    const command = { schemaVersion: 'review.operation.v1' as const, kind: 'review.annotation.create' as const,
      operationId: 'restart-review', documentId: seed.documentId, branchId: 'main', expectedBranchRevision: 0,
      annotationId: 'restart-note', expectedAnnotationVersion: 0, anchorRevision: 0, body: `ephemeral-${crypto.randomUUID()}` };
    expect(await client.dispatch(command)).toMatchObject({ ok: false, code: 'STORAGE_FAILURE' });
    expect(service.store.readReviewEvents(seed.documentId, 0)).toHaveLength(1); await service.close();
    service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    const recovered = await new ReviewServiceClient(service.url, fetch, { actor: 'human', capability: 'human-editor' }).dispatch(command);
    expect(recovered).toMatchObject({ ok: true, annotation: { version: 1 } }); expect(service.store.readReviewEvents(seed.documentId, 0)).toHaveLength(1);
    await service.close(); await temporary.cleanup();
  });
});
