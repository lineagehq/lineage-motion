import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { ReviewServiceClient } from '../../motion-protocol/src/review.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { phase3Seed, temporaryStore } from '../../local-service/src/test-support.ts';

describe('review privacy', () => {
  test('keeps bodies only in ephemeral private SQLite storage', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed(); const body = `ephemeral-${crypto.randomUUID()}`;
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    const client = new ReviewServiceClient(service.url, fetch, { actor: 'human', capability: 'human-editor' });
    const response = await client.dispatch({ schemaVersion: 'review.operation.v1', kind: 'review.annotation.create',
      operationId: 'privacy-review', documentId: seed.documentId, branchId: 'main', expectedBranchRevision: 0,
      annotationId: 'privacy-note', expectedAnnotationVersion: 0, anchorRevision: 0, body });
    expect(JSON.stringify(response)).not.toContain(body); expect(JSON.stringify(service.store.snapshot())).not.toContain(body);
    expect(JSON.stringify(service.store.readReviewEvents(seed.documentId, 0))).not.toContain(body);
    const durableBytes = Buffer.concat([await readFile(temporary.databasePath), await readFile(`${temporary.databasePath}-wal`)]);
    expect(durableBytes.includes(Buffer.from(body))).toBe(true);
    await service.close(); await temporary.cleanup();
  });
});
