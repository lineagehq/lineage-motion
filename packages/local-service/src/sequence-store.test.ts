import { expect, test } from 'vitest';
import { makeClaimAcquireCommand, makeTrackCreateCommand } from '../../motion-protocol/src/index.ts';
import { sequenceTestStore, human, agent } from './sequence-test-support.ts';
test('duplicates are independent, edits preserve source pins, and undo/redo survive revisions', async () => {
  const t = await sequenceTestStore(); const { store, base } = t;
  try {
    expect(store.executeSequence(t.create, human)).toMatchObject({ ok: true, revision: 0 });
    expect(store.executeSequence({ ...base, kind: 'sequence.edit', operationId: 'duplicate', edit: { kind: 'clip.duplicate', clipId: 'clip_one', newClipId: 'clip_two', name: 'Copy' } }, human)).toMatchObject({ ok: true, revision: 1 });
    expect(store.executeSequence({ ...base, expectedRevision: 1, kind: 'sequence.edit', operationId: 'hold', edit: { kind: 'clip.hold', clipId: 'clip_two', endHoldMs: 500 } }, human)).toMatchObject({ ok: true, revision: 2 });
    const clips = store.readSequence(base.sequenceId, 1000)!.sequence.clips;
    expect(clips.map(clip => clip.endHoldMs)).toEqual([0, 500]); expect(clips.map(clip => clip.source)).toEqual([t.source, t.source]);
    expect(store.executeSequence({ ...base, expectedRevision: 2, kind: 'sequence.undo', operationId: 'undo' }, human)).toMatchObject({ ok: true, revision: 3 });
    expect(store.readSequence(base.sequenceId, 1000)!.sequence.clips.map(clip => clip.endHoldMs)).toEqual([0, 0]);
    expect(store.executeSequence({ ...base, expectedRevision: 3, kind: 'sequence.redo', operationId: 'redo' }, human)).toMatchObject({ ok: true, revision: 4 });
    expect(store.readSequence(base.sequenceId, 1000)!.sequence.clips).toEqual(clips);
    expect(store.readHead(t.seed.documentId)!.document).toEqual(t.seed);
  } finally { store.close(); await t.cleanup(); }
});
test('stale revisions, wrong projects and invalid source updates leave every durable table unchanged', async () => {
  const t = await sequenceTestStore(); const { store, base } = t;
  try {
    store.executeSequence(t.create, human);
    store.executeSequence({ ...base, kind: 'sequence.edit', operationId: 'rename', edit: { kind: 'sequence.rename', name: 'Updated' } }, human);
    const before = store.snapshot();
    expect(store.executeSequence({ ...base, kind: 'sequence.undo', operationId: 'stale' }, human)).toMatchObject({ ok: false, code: 'SEQUENCE_STALE_REVISION' });
    expect(store.executeSequence({ ...base, expectedRevision: 1, projectId: 'wrong', kind: 'sequence.undo', operationId: 'wrong-project' }, human)).toMatchObject({ ok: false, code: 'SEQUENCE_PROJECT_MISMATCH' });
    expect(store.executeSequence({ ...base, expectedRevision: 1, kind: 'sequence.edit', operationId: 'bad-pin', edit: { kind: 'clip.update-source', clipId: 'clip_one', source: { ...t.source, canonicalDigest: '0'.repeat(64) } } }, human)).toMatchObject({ ok: false, code: 'SEQUENCE_SOURCE_MISMATCH' });
    expect(store.snapshot()).toEqual(before);
  } finally { store.close(); await t.cleanup(); }
});
test('claims isolate sequences from documents and other sequences, release replay remains exact after expiry', async () => {
  const t = await sequenceTestStore(); const { store, base } = t;
  try {
    const created = store.executeSequence({ ...t.create, claim: true }, agent); expect(created.ok).toBe(true);
    if (!created.ok || !created.claim) throw new Error('CLAIM_REQUIRED');
    const edit = { ...base, kind: 'sequence.edit' as const, operationId: 'rename', edit: { kind: 'sequence.rename' as const, name: 'Changed' } };
    expect(store.executeSequence(edit, human)).toMatchObject({ ok: false, code: 'SEQUENCE_CLAIM_CONFLICT' });
    expect(store.executeSequence(edit, { ...agent, claimSecret: agent.claimSecret + '.wrong' })).toMatchObject({ ok: false, code: 'SEQUENCE_UNAUTHORIZED' });
    expect(store.executeSequence({ ...t.create, sequenceId: 'sequence_two', operationId: 'create-two' }, human)).toMatchObject({ ok: true });
    expect(store.executeSequence({ ...edit, sequenceId: 'sequence_two' }, agent)).toMatchObject({ ok: false, code: 'SEQUENCE_CLAIM_EXPIRED' });
    expect(store.execute(makeClaimAcquireCommand({ operationId: 'document-claim', documentId: t.seed.documentId, expectedRevision: 0, scope: 'document' }), agent).response.ok).toBe(true);
    expect(store.executeSequence({ ...edit, sequenceId: 'sequence_two' }, agent)).toMatchObject({ ok: false, code: 'SEQUENCE_CLAIM_EXPIRED' });
    expect(store.executeSequence(edit, agent)).toMatchObject({ ok: true, revision: 1 });
    const release = { ...base, expectedRevision: 1, kind: 'sequence.claim.release' as const, operationId: 'release', claimId: created.claim.claimId, expectedLeaseVersion: 1 };
    const receipt = store.executeSequence(release, agent); expect(receipt.ok).toBe(true);
    expect(store.executeSequence(release, { ...agent, now: 90000 })).toEqual(receipt);
    expect(store.executeSequence({ ...release, expectedLeaseVersion: 2 }, agent)).toMatchObject({ ok: false, code: 'SEQUENCE_OPERATION_CONFLICT' });
    expect(store.executeSequence({ ...edit, expectedRevision: 1, operationId: 'after-release' }, agent)).toMatchObject({ ok: false, code: 'SEQUENCE_CLAIM_EXPIRED' });
    expect(store.listActiveClaims(t.seed.documentId, 1000)!.claims).toHaveLength(1);
  } finally { store.close(); await t.cleanup(); }
});

test('source head changes leave both occurrences pinned until one reference is explicitly updated', async () => {
  const t = await sequenceTestStore(); const { store, base } = t;
  try {
    store.executeSequence(t.create, human);
    store.executeSequence({ ...base, kind: 'sequence.edit', operationId: 'duplicate', edit: { kind: 'clip.duplicate', clipId: 'clip_one', newClipId: 'clip_two', name: 'Copy' } }, human);
    const before = store.readSequence(base.sequenceId, 1000);
    expect(store.execute(makeTrackCreateCommand({ operationId: 'edit-source', documentId: t.seed.documentId, expectedRevision: 0, elementId: t.seed.elements[0]!.id }), human).response.ok).toBe(true);
    expect(store.readSequence(base.sequenceId, 1000)).toEqual(before);
    const head = store.readHead(t.seed.documentId)!;
    const source = { ...t.source, revision: head.document.revision, canonicalDigest: head.canonicalDigest };
    expect(store.executeSequence({ ...base, expectedRevision: 1, kind: 'sequence.edit', operationId: 'update-copy', edit: { kind: 'clip.update-source', clipId: 'clip_two', source } }, human)).toMatchObject({ ok: true, revision: 2 });
    expect(store.readSequence(base.sequenceId, 1000)!.sequence.clips.map(clip => clip.source)).toEqual([t.source, source]);
  } finally { store.close(); await t.cleanup(); }
});
test('renewal CAS and human revocation enforce lease ownership without changing source or sequence content', async () => {
  const t = await sequenceTestStore(); const { store, base } = t;
  try {
    store.executeSequence(t.create, human);
    const acquired = store.executeSequence({ ...base, kind: 'sequence.claim.acquire', operationId: 'acquire' }, agent);
    if (!acquired.ok || !acquired.claim) throw new Error('CLAIM_REQUIRED');
    const before = store.readSequence(base.sequenceId, 1000)!.sequence;
    const renew = { ...base, kind: 'sequence.claim.renew' as const, operationId: 'renew', claimId: acquired.claim.claimId, expectedLeaseVersion: 1 };
    expect(store.executeSequence(renew, { ...agent, now: 2000 })).toMatchObject({ ok: true, claim: { leaseVersion: 2, expiresAt: 62000 } });
    expect(store.executeSequence({ ...renew, operationId: 'stale-renew' }, agent)).toMatchObject({ ok: false, code: 'SEQUENCE_STALE_LEASE' });
    expect(store.executeSequence({ ...renew, kind: 'sequence.claim.revoke', operationId: 'revoke', expectedLeaseVersion: 2 }, human)).toMatchObject({ ok: true });
    expect(store.readSequence(base.sequenceId, 1000)!.activeClaim).toBeNull();
    expect(store.readSequence(base.sequenceId, 1000)!.sequence).toEqual(before);
    expect(store.executeSequence({ ...base, kind: 'sequence.edit', operationId: 'human-edit', edit: { kind: 'sequence.rename', name: 'Recovered' } }, human)).toMatchObject({ ok: true });
  } finally { store.close(); await t.cleanup(); }
});
test('real HTTP sequence operations authenticate, reject stale writes, and export exactly the saved pin', async () => {
  const { startLocalMotionService } = await import('./index.ts');
  const t = await sequenceTestStore(); t.store.close();
  const service = await startLocalMotionService({ databasePath: t.path, seed: t.seed, now: () => 1000 });
  try {
    const headers = { 'content-type': 'application/json', 'x-motion-actor': 'human', authorization: 'Bearer human-editor' };
    const post = (path: string, body: unknown) => fetch(`${service.url}/api/sequence/v1/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    expect((await fetch(`${service.url}/api/sequence/v1/catalog`)).status).toBe(403);
    const created = await post('commands', t.create); expect(created.status).toBe(200);
    const receipt = await created.json(); expect(receipt).toMatchObject({ ok: true, revision: 0 });
    expect(await (await post('commands', t.create)).json()).toEqual(receipt);
    const edit = { ...t.base, kind: 'sequence.edit', operationId: 'rename-http', edit: { kind: 'sequence.rename', name: 'HTTP result' } };
    expect((await post('commands', edit)).status).toBe(200);
    const stale = await post('commands', { ...edit, operationId: 'stale-http' }); expect(stale.status).toBe(409);
    expect(await stale.json()).toMatchObject({ ok: false, code: 'SEQUENCE_STALE_REVISION', currentRevision: 1 });
    const identity = { projectId: t.base.projectId, sequenceId: t.base.sequenceId, expectedRevision: 1 };
    expect((await post('export', { ...identity, projectId: 'other' })).status).toBe(422);
    expect((await post('export', { ...identity, expectedRevision: 0 })).status).toBe(409);
    const exported = await post('export', identity); expect(exported.status).toBe(200);
    const output = await exported.json(); expect(output).toMatchObject({ ok: true, schemaVersion: 'motion.sequence-export.v1' });
    expect(output.html).toContain('iframe');
    expect(await (await post('export', identity)).json()).toEqual(output);
    const snapshot = await (await fetch(`${service.url}/api/sequence/v1/sequences/${t.base.sequenceId}`, { headers })).json();
    expect(snapshot.sequence.clips[0].source).toEqual(t.source); expect(snapshot.sequence.revision).toBe(1);
    const raced = await Promise.all(['one', 'two'].map(name => post('commands', { ...edit, expectedRevision: 1,
      operationId: `race-${name}`, edit: { kind: 'sequence.rename', name } })));
    expect(raced.map(response => response.status).sort()).toEqual([200, 409]);
    const afterRace = await (await fetch(`${service.url}/api/sequence/v1/sequences/${t.base.sequenceId}`, { headers })).json();
    expect(afterRace.sequence.revision).toBe(2);
    expect(['one', 'two']).toContain(afterRace.sequence.name);
  } finally { await service.close(); await t.cleanup(); }
});
