import { expect, test } from 'vitest';
import { sequenceTestStore } from './sequence-test-support.ts';
import { startLocalMotionService } from './index.ts';
import { canonicalJson, sha256Hex } from '../../domain/src/index.ts';

test('sequence service exports identical pinned content across three reads and a durable restart', async () => {
  const t = await sequenceTestStore(); t.store.close();
  let service: Awaited<ReturnType<typeof startLocalMotionService>> | undefined;
  const headers = { authorization: 'Bearer human-editor', 'x-motion-actor': 'human', 'content-type': 'application/json' };
  const body = { projectId: t.base.projectId, sequenceId: t.base.sequenceId, expectedRevision: 0 };
  try {
    service = await startLocalMotionService({ databasePath: t.path, seed: t.seed });
    const create = await fetch(`${service.url}/api/sequence/v1/commands`, { method: 'POST', headers, body: canonicalJson(t.create) });
    expect(create.status).toBe(200);
    const before = service.store.snapshot(); let original = '';
    for (let run = 0; run < 4; run++) {
      if (run === 3) {
        await service.close(); service = undefined;
        service = await startLocalMotionService({ databasePath: t.path, seed: t.seed });
      }
      const response = await fetch(`${service.url}/api/sequence/v1/export`, { method: 'POST', headers, body: canonicalJson(body) });
      expect(response.status).toBe(200); const bytes = await response.text();
      if (run === 0) original = bytes; else expect(bytes).toBe(original);
      const bundle = JSON.parse(bytes);
      expect(bundle.receipt).toMatchObject({ projectId: body.projectId, sequenceId: body.sequenceId, revision: 0,
        sources: [{ clipId: 'clip_one', source: t.source }] });
      expect(sha256Hex(`${bundle.html}\0${bundle.css}`)).toBe(bundle.exportDigest);
      expect(bundle.receipt.exportDigest).toBe(bundle.exportDigest);
      expect(service.store.snapshot()).toEqual(before);
    }
  } finally { await service?.close(); await t.cleanup(); }
});
