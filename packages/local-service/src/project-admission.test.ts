import { afterEach, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { ProjectServiceClient } from '../../motion-protocol/src/project-client.ts';
import { PROJECT_PROTOCOL_VERSION, type ShotAdmissionCommand } from '../../motion-protocol/src/project.ts';
import { MotionServiceClient, makeTrackCreateCommand } from '../../motion-protocol/src/index.ts';
import { canonicalJson } from '../../domain/src/index.ts';
import { compileMotionDocument } from '../../css-compiler/src/index.ts';
import { startLocalMotionService, type LocalMotionService } from './index.ts';
import { phase3Seed, temporaryStore } from './test-support.ts';
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.reverse()) await close(); cleanup.length = 0; });
async function setup() {
  const temporary = await temporaryStore(); cleanup.push(temporary.cleanup);
  const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed: phase3Seed() });
  cleanup.push(() => service.close()); return service;
}
function client(service: LocalMotionService, actor: 'human' | 'agent' = 'human') {
  return new ProjectServiceClient(service.url, { actor, capability: actor === 'human' ? 'human-editor' : 'cli-agent' });
}
async function command(service: LocalMotionService, overrides: Partial<ShotAdmissionCommand> = {}): Promise<ShotAdmissionCommand> {
  const catalog = await client(service).catalog();
  return { protocolVersion: PROJECT_PROTOCOL_VERSION, kind: 'motion.shot.admit', operationId: 'new-shot',
    projectId: catalog.projectId, expectedCatalogRevision: catalog.catalogRevision, documentId: 'shot_one', name: 'One',
    source: { kind: 'starter', starterId: 'trajectory' }, claim: null, ...overrides };
}
test('admits both starters and full imported inventories with independent identical-source instances', async () => {
  const service = await setup(); const human = client(service); const seedBefore = service.store.readHead(phase3Seed().documentId);
  for (const starterId of ['trajectory', 'reusable-cues'] as const) {
    expect(await human.admit(await command(service, { documentId: starterId, operationId: starterId,
      source: { kind: 'starter', starterId } }))).toMatchObject({ ok: true, inventory: { missingCount: 0, unsupportedCount: 0 } });
  }
  const html = readFileSync(new URL('../../../fixtures/public-synthetic/preview.html', import.meta.url), 'utf8');
  for (const documentId of ['copy_a', 'copy_b']) {
    const response = await human.admit(await command(service, { documentId, operationId: documentId, source: { kind: 'html-css', html } }));
    expect(response).toMatchObject({ ok: true, inventory: { ruleCount: 4, applicationCount: 3, slotCount: 4, trackCount: 5,
      missingCount: 0, unsupportedCount: 0 } });
    if (!response.ok) throw new Error('ADMISSION_FAILED');
    const head = service.store.readHead(documentId)!;
    expect(response.canonicalDigest).toBe(head.canonicalDigest);
    expect(response.exportDigest).toBe(compileMotionDocument(head.document).exportDigest);
  }
  const untouched = service.store.readHead('copy_b');
  const edit = makeTrackCreateCommand({ operationId: 'edit-copy-a', documentId: 'copy_a', expectedRevision: 0, elementId: 'el_2dbee68b1ea318c8' });
  expect(await new MotionServiceClient(service.url).dispatch(edit)).toMatchObject({ ok: true });
  expect(service.store.readHead('copy_b')).toEqual(untouched);
  expect(service.store.readHead(phase3Seed().documentId)).toEqual(seedBefore);
  expect((await human.catalog()).shots).toHaveLength(5);
});
test('rejects unsupported/missing animation imports explicitly and leaves every table unchanged', async () => {
  const service = await setup();
  for (const html of ['<script>private sentinel</script>', '<style>.x{animation:missing 1s}</style><div class="x"></div>']) {
    const before = service.store.snapshot();
    const result = await client(service).admit(await command(service, { source: { kind: 'html-css', html } }));
    expect(result).toMatchObject({ ok: false, code: 'IMPORT_REJECTED', inventory: expect.any(Object) });
    expect(canonicalJson(result)).not.toContain('private sentinel'); expect(service.store.snapshot()).toEqual(before);
  }
});
test('enforces stale catalog, project, identity and exact private retry boundaries atomically', async () => {
  const service = await setup(); const agent = client(service, 'agent'); const secret = 'synthetic-secret-'.repeat(4);
  const input = await command(service, { claim: { scope: 'document', documentId: 'shot_one' } });
  const result = await agent.admit(input, secret); expect(result).toMatchObject({ ok: true, claim: { leaseVersion: 1, scope: 'document' } });
  const before = service.store.snapshot();
  expect(await agent.admit(input, secret)).toEqual(result); expect(service.store.snapshot()).toEqual(before);
  for (const [changed, key, expected] of [
    [{ ...input, name: 'Changed' }, secret, 'OPERATION_ID_CONFLICT'],
    [input, 'different-secret-'.repeat(4), 'OPERATION_ID_CONFLICT'],
    [{ ...input, operationId: 'stale', documentId: 'new', claim: { scope: 'document', documentId: 'new' } }, secret, 'STALE_CATALOG_REVISION'],
    [{ ...input, operationId: 'project', projectId: 'wrong' }, secret, 'PROJECT_MISMATCH'],
    [{ ...input, operationId: 'existing', expectedCatalogRevision: 1 }, secret, 'DOCUMENT_ALREADY_EXISTS'],
    [{ ...input, claim: null }, secret, 'UNAUTHORIZED_CLAIM'],
    [{ ...input, claim: { scope: 'document', documentId: 'wrong' } }, secret, 'UNAUTHORIZED_CLAIM'],
  ] as const) {
    expect(await agent.admit(changed, key)).toMatchObject({ ok: false, code: expected });
    expect(service.store.snapshot()).toEqual(before);
  }
  expect(canonicalJson(result)).not.toContain(secret);
  expect(service.store.listActiveClaims('shot_one', Date.now())?.claims).toHaveLength(1);
});
test('human client and claimed agent publish byte-identical document/compiler output from equal inputs', async () => {
  const humanService = await setup(); const agentService = await setup();
  const input = await command(humanService);
  const human = await client(humanService).admit(input);
  const agent = await client(agentService, 'agent').admit({ ...input, claim: { scope: 'document', documentId: input.documentId } }, 'parity-secret-'.repeat(4));
  expect(human.ok && agent.ok).toBe(true);
  if (!human.ok || !agent.ok) throw new Error('ADMISSION_FAILED');
  const { claim: _claim, ...withoutClaim } = agent; expect(withoutClaim).toEqual(human);
  expect(agentService.store.readHead(input.documentId)).toEqual(humanService.store.readHead(input.documentId));
});
test('newly authored source admits labelled static text and arbitrary-duration targets with stable bindings', async () => {
  const service = await setup();
  const html = '<style>.comet{animation:fly 3750ms linear}@keyframes fly{from{opacity:0}to{opacity:1}}</style>'
    + '<main><div class="comet" aria-label="Comet"></div><p id="caption">Launch complete</p></main>';
  const input = await command(service, { source: { kind: 'html-css', html } });
  expect(await client(service).admit(input)).toMatchObject({ ok: true,
    inventory: { ruleCount: 1, applicationCount: 1, slotCount: 1, trackCount: 1, missingCount: 0, unsupportedCount: 0 } });
  const document = service.store.readHead(input.documentId)!.document;
  expect(document.durationMs).toBe(3750);
  expect(document.elements).toHaveLength(2);
  expect(document.elements).toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Comet' }),
    expect.objectContaining({ label: 'caption', editableText: 'Launch complete' })]));
  for (const target of document.elements) expect(document.presentation.html).toContain(`data-motion-id="${target.id}"`);
  const outputs = [0, 1, 2].map(() => compileMotionDocument(document)); expect(outputs[1]).toEqual(outputs[0]); expect(outputs[2]).toEqual(outputs[0]);
});
test('admission creates a usable bounded agent claim; missing and wrong secrets cannot author the new shot', async () => {
  const service = await setup(); const secret = 'usable-claim-'.repeat(4);
  const html = readFileSync(new URL('../../../fixtures/public-synthetic/preview.html', import.meta.url), 'utf8');
  const input = await command(service, { source: { kind: 'html-css', html }, claim: { scope: 'document', documentId: 'shot_one' } });
  expect(await client(service, 'agent').admit(input, secret)).toMatchObject({ ok: true });
  const edit = makeTrackCreateCommand({ operationId: 'claimed-edit', documentId: input.documentId, expectedRevision: 0, elementId: 'el_2dbee68b1ea318c8' });
  const agentClient = new MotionServiceClient(service.url, fetch, { actor: 'agent', capability: 'cli-agent' });
  const before = service.store.snapshot();
  expect(await agentClient.dispatch(edit)).toMatchObject({ ok: false, code: 'UNAUTHORIZED_CLAIM' });
  expect(await agentClient.dispatch(edit, 'wrong-secret'.repeat(4))).toMatchObject({ ok: false, code: 'UNAUTHORIZED_CLAIM' });
  expect(service.store.snapshot()).toEqual(before);
  expect(await agentClient.dispatch(edit, secret)).toMatchObject({ ok: true, resultingRevision: 1 });
});
test('authenticates catalog/admission and rejects malformed commands without allocations or echoed input', async () => {
  const service = await setup(); const input = await command(service); const before = service.store.snapshot();
  expect((await fetch(`${service.url}/api/project/v1/catalog`)).status).toBe(403);
  expect((await fetch(`${service.url}/api/project/v1/shots`, { method: 'POST', body: JSON.stringify(input) })).status).toBe(403);
  for (const invalid of [{ ...input, protocolVersion: 'future' }, { ...input, expectedCatalogRevision: -1 },
    { ...input, privateExtra: 'secret-sentinel' }, { ...input, source: { kind: 'html-css', html: '' } },
    { ...input, claim: { scope: 'branch', documentId: input.documentId } }]) {
    const response = await fetch(`${service.url}/api/project/v1/shots`, { method: 'POST',
      headers: { authorization: 'Bearer human-editor', 'x-motion-actor': 'human', 'content-type': 'application/json' }, body: JSON.stringify(invalid) });
    expect(response.status).toBe(422); expect(await response.json()).toEqual({ ok: false, code: 'VALIDATION', diagnosticCode: 'PROJECT_COMMAND_INVALID' });
    expect(service.store.snapshot()).toEqual(before);
  }
});
