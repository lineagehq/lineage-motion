import { expect, test } from 'vitest';
import { sequenceTestStore } from './sequence-test-support.ts';
import { startLocalMotionService } from './index.ts';
import { SequenceServiceClient } from '../../motion-protocol/src/sequence-client.ts';
import { ProjectServiceClient } from '../../motion-protocol/src/project-client.ts';
import { sequenceSourceSchema } from '../../domain/src/sequence.ts';

test('static shots remain explicitly unavailable without hiding eligible sequence sources', async () => {
  const t = await sequenceTestStore(); t.store.close();
  const service = await startLocalMotionService({ databasePath: t.path, seed: t.seed });
  try {
    const auth = { actor: 'human' as const, capability: 'human-editor' };
    const project = new ProjectServiceClient(service.url, auth);
    const catalog = await project.catalog();
    const admitted = await project.admit({ protocolVersion: 'motion.project-protocol.v1', kind: 'motion.shot.admit',
      operationId: 'static-admit', projectId: catalog.projectId, expectedCatalogRevision: catalog.catalogRevision,
      documentId: 'static_shot', name: 'Static title', source: { kind: 'html-css',
        html: '<!doctype html><html><head><style>html,body{margin:0;width:320px;height:180px;overflow:hidden}</style></head><body><div>Public title</div></body></html>' }, claim: null });
    expect(admitted.ok).toBe(true);
    const sources = await new SequenceServiceClient(service.url, auth).sources();
    expect(sources.shots.find(shot => shot.source.documentId === t.seed.documentId)).toMatchObject({
      viewport: { widthCssPixels: 800, heightCssPixels: 450 }, reasonCode: null });
    const unavailable = sources.shots.find(shot => shot.source.documentId === 'static_shot');
    expect(unavailable).toMatchObject({ source: { durationMs: 0 }, viewport: null, reasonCode: 'SEQUENCE_SOURCE_DURATION_INVALID' });
    expect(sequenceSourceSchema.safeParse(unavailable!.source).success).toBe(false);
  } finally { await service.close(); await t.cleanup(); }
});
