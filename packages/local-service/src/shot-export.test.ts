import { afterEach, expect, test } from 'vitest';
import { canonicalJson, sha256Hex } from '../../domain/src/index.ts';
import { ExportServiceClient, parseExportResponse, type ExportRequest } from '../../motion-protocol/src/export.ts';
import { MotionServiceClient } from '../../motion-protocol/src/index.ts';
import { compileMotionDocument } from '../../css-compiler/src/index.ts';
import { startLocalMotionService, type LocalMotionService } from './index.ts';
import { phase3Command, phase3Seed, temporaryStore } from './test-support.ts';
import { exportShot } from './shot-export.ts';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.reverse()) await close(); cleanup.length = 0; });
async function setup() {
  const temporary = await temporaryStore(); cleanup.push(temporary.cleanup);
  let service = await startLocalMotionService({ databasePath: temporary.databasePath, seed: phase3Seed() });
  cleanup.push(() => service.close());
  return { get service() { return service; }, async restart() { await service.close();
    service = await startLocalMotionService({ databasePath: temporary.databasePath, seed: phase3Seed() }); } };
}
function request(service: LocalMotionService): ExportRequest {
  return { schemaVersion: 'motion.export-request.v1', projectId: service.store.readProjectCatalog().projectId,
    documentId: phase3Seed().documentId, branchId: 'main', expectedRevision: 0 };
}
function client(service: LocalMotionService, actor: 'human' | 'agent' = 'human') {
  return new ExportServiceClient(service.url, { actor, capability: actor === 'human' ? 'human-editor' : 'cli-agent' });
}

test('human and agent exports agree byte-for-byte across three runs and a service restart', async () => {
  const fixture = await setup(); const input = request(fixture.service);
  const before = fixture.service.store.snapshot();
  const baseline = await client(fixture.service).shot(input);
  expect(baseline.ok).toBe(true); if (!baseline.ok) throw new Error('EXPORT_FAILED');
  const compiled = compileMotionDocument(fixture.service.store.readHead(input.documentId)!.document);
  expect(baseline.files['animation.html']).toBe(compiled.html);
  expect(baseline.files['animation.css']).toBe(compiled.css);
  expect(baseline.files['receipt.json']).toBe(canonicalJson(baseline.receipt));
  expect(baseline.receipt.exportDigest).toBe(compiled.exportDigest);
  for (let run = 0; run < 3; run++) {
    expect(await client(fixture.service).shot(input)).toEqual(baseline);
    expect(await client(fixture.service, 'agent').shot(input)).toEqual(baseline);
  }
  expect(fixture.service.store.snapshot()).toEqual(before);
  await fixture.restart();
  expect(await client(fixture.service).shot(input)).toEqual(baseline);
  expect(fixture.service.store.snapshot()).toEqual(before);
  expect(baseline.files['receipt.json']).not.toContain('<style');
  expect(baseline.files['receipt.json']).not.toContain('human-editor');
});

test('stale, wrong-project, missing-shot and unauthorized exports produce no artifacts or writes', async () => {
  const { service } = await setup(); const input = request(service);
  expect(await new MotionServiceClient(service.url).dispatch(phase3Command())).toMatchObject({ ok: true });
  const before = service.store.snapshot();
  expect(await client(service).shot(input)).toEqual({ ok: false, code: 'EXPORT_STALE_REVISION', currentRevision: 1 });
  expect(await client(service).shot({ ...input, projectId: 'another-project' }))
    .toEqual({ ok: false, code: 'EXPORT_PROJECT_MISMATCH' });
  expect(await client(service).shot({ ...input, documentId: 'absent' })).toEqual({ ok: false, code: 'EXPORT_SHOT_NOT_FOUND' });
  expect(await client(service).shot({ ...input, branchId: 'absent' })).toEqual({ ok: false, code: 'EXPORT_SHOT_NOT_FOUND' });
  expect(await new ExportServiceClient(service.url, { actor: 'agent', capability: 'invalid' }).shot(input))
    .toEqual({ ok: false, code: 'EXPORT_UNAUTHORIZED' });
  const response = await fetch(`${service.url}/api/export/v1/shot`, { method: 'POST',
    headers: { authorization: 'Bearer human-editor', 'x-motion-actor': 'human' }, body: '{' });
  expect(response.status).toBe(422);
  expect(await response.json()).toEqual({ ok: false, code: 'EXPORT_REQUEST_INVALID' });
  expect((await client(service).shot({ ...input, expectedRevision: 1 })).ok).toBe(true);
  expect(service.store.snapshot()).toEqual(before);
});

test('unsupported content is rejected without exposing authored text in diagnostics', async () => {
  const { service } = await setup(); const input = request(service);
  const read = service.store.readHead.bind(service.store);
  const snapshot = read(input.documentId)!;
  snapshot.document.presentation.html += '<script>private-content-sentinel</script>';
  // Exercise export defense against an older persisted document the compiler refuses.
  service.store.readHead = () => snapshot;
  expect(exportShot(service.store, input)).toEqual({ ok: false, code: 'EXPORT_UNSUPPORTED' });
  snapshot.document.inventory.unsupportedCount = 1;
  expect(exportShot(service.store, input)).toEqual({ ok: false, code: 'EXPORT_UNSUPPORTED' });
  service.store.readHead = read;
});

test('client rejects wrong identities, modified artifacts and inconsistent receipts', async () => {
  const { service } = await setup(); const input = request(service);
  const baseline = await client(service).shot(input);
  if (!baseline.ok) throw new Error('EXPORT_FAILED');
  for (const change of [
    (copy: typeof baseline) => { copy.receipt.revision++; },
    (copy: typeof baseline) => { copy.files['animation.html'] += 'changed'; },
    (copy: typeof baseline) => { copy.receipt.exportDigest = sha256Hex('wrong'); },
    (copy: typeof baseline) => { copy.files['receipt.json'] = '{}'; },
  ]) {
    const copy = structuredClone(baseline); change(copy);
    expect(() => parseExportResponse(copy, input)).toThrow();
  }
});
