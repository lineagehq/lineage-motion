import { expect, test } from 'vitest';
import { unzipSync } from 'fflate';
import { createSequenceExportArchive, fetchSequenceExport, validateSequenceExport } from './sequence-export.ts';
import { sequenceTestStore } from '../../local-service/src/sequence-test-support.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { canonicalJson, sha256Hex } from '../../domain/src/index.ts';

test('sequence archive validates exact identity and bytes and rejects altered responses', async () => {
  const t = await sequenceTestStore(); t.store.close();
  const service = await startLocalMotionService({ databasePath: t.path, seed: t.seed });
  try {
    expect(service.store.executeSequence(t.create, { actor: 'human', capability: 'human-editor', now: 1000 }).ok).toBe(true);
    const identity = { projectId: t.base.projectId, sequenceId: t.base.sequenceId, expectedRevision: 0 };
    const auth = { actor: 'human' as const, capability: 'human-editor' };
    const bundle = await fetchSequenceExport(service.url, auth, identity);
    if (!bundle.ok) throw new Error(bundle.code);
    const archive = createSequenceExportArchive(bundle);
    expect(createSequenceExportArchive(bundle)).toEqual(archive);
    const files = unzipSync(archive);
    expect(Object.keys(files)).toEqual(['animation.html', 'animation.css', 'receipt.json']);
    const receipt = JSON.parse(Buffer.from(files['receipt.json']!).toString('utf8'));
    expect(receipt.htmlDigest).toBe(sha256Hex(files['animation.html']!));
    expect(Buffer.from(files['animation.html']!).subarray(0, 3)).toEqual(Buffer.from([239, 187, 191]));
    expect(() => validateSequenceExport({ ...bundle, html: bundle.html + 'changed' })).toThrow();
    const wrong = { ...bundle, receipt: { ...bundle.receipt, revision: 1 } };
    const fake: typeof fetch = async () => new Response(canonicalJson(wrong), { status: 200 });
    await expect(fetchSequenceExport(service.url, auth, identity, fake)).rejects.toThrow('SEQUENCE_EXPORT_IDENTITY_MISMATCH');
    expect(await fetchSequenceExport(service.url, auth, { ...identity, expectedRevision: 1 })).toMatchObject({ ok: false, code: 'SEQUENCE_STALE_REVISION' });
  } finally { await service.close(); await t.cleanup(); }
});
