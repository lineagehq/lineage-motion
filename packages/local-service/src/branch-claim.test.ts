import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { MotionServiceClient, makeBranchCreateCommand, makeClaimAcquireCommand, makeClaimControlCommand,
  makeTrackCreateCommand } from '../../motion-protocol/src/index.ts';
import { startLocalMotionService } from './index.ts';
import { phase3Seed, temporaryStore } from './test-support.ts';

const secretA = 'agent-secret-A-0123456789-abcdefghijklmnopqrstuvwxyz';
const secretB = 'agent-secret-B-0123456789-abcdefghijklmnopqrstuvwxyz';
const capabilities = {
  human: randomBytes(32).toString('base64url'),
  agent: randomBytes(32).toString('base64url'),
};
const agent = (url: string, secret = secretA) => new MotionServiceClient(url, (...args) => fetch(...args),
  { actor: 'agent', capability: 'cli-agent', claimSecret: secret });

describe('minimum branches and claims', () => {
  test('requires provisioned high-entropy capabilities and rejects repository-known impersonation', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed();
    await expect(startLocalMotionService({ databasePath: temp.databasePath, seed,
      capabilities: { human: 'human-editor', agent: 'cli-agent' } })).rejects.toThrow('SERVICE_CAPABILITIES_INVALID');
    const service = await startLocalMotionService({ databasePath: temp.databasePath, seed, capabilities });
    const command = makeBranchCreateCommand({ operationId: 'capability-proof', documentId: seed.documentId,
      expectedRevision: 0, branchId: 'feature' });
    const rejected = await fetch(`${service.url}/api/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: 'Bearer human-editor', 'x-motion-actor': 'human',
    }, body: JSON.stringify(command) });
    expect(await rejected.json()).toEqual({ ok: false, code: 'UNAUTHORIZED_CLAIM' });
    expect((service.store.snapshot() as { events: unknown[] }).events).toEqual([]);
    const human = new MotionServiceClient(service.url, (...args) => fetch(...args),
      { actor: 'human', capability: capabilities.human });
    expect(await human.dispatch(command)).toMatchObject({ ok: true });
    await service.close(); await temp.cleanup();
  });

  test('allows exactly one same-branch acquisition winner and leaves no loser state', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed(); const service = await startLocalMotionService({
      databasePath: temp.databasePath, seed, now: () => 100, capabilities });
    const left = new MotionServiceClient(service.url, (...args) => fetch(...args),
      { actor: 'agent', capability: capabilities.agent, claimSecret: secretA });
    const right = new MotionServiceClient(service.url, (...args) => fetch(...args),
      { actor: 'agent', capability: capabilities.agent, claimSecret: secretB });
    const [a, b] = await Promise.all([
      left.dispatch(makeClaimAcquireCommand({ operationId: 'same-branch-left', documentId: seed.documentId,
        branchId: 'main', expectedRevision: 0, scope: 'branch' })),
      right.dispatch(makeClaimAcquireCommand({ operationId: 'same-branch-right', documentId: seed.documentId,
        branchId: 'main', expectedRevision: 0, scope: 'branch' })),
    ]);
    expect([a, b].filter((response) => response.ok)).toHaveLength(1);
    expect([a, b].filter((response) => !response.ok)).toEqual([{ ok: false, code: 'UNAUTHORIZED_CLAIM' }]);
    const snapshot = service.store.snapshot() as { events: Array<{ operation_id: string }>; claims: unknown[];
      documents: Array<{ last_revision: number }>; branches: Array<{ head_revision: number }> };
    expect(snapshot.events).toHaveLength(1); expect(snapshot.claims).toHaveLength(1);
    expect(snapshot.events.map((event) => event.operation_id)).toEqual([
      a.ok ? 'same-branch-left' : 'same-branch-right',
    ]);
    expect(snapshot.documents[0]?.last_revision).toBe(0); expect(snapshot.branches[0]?.head_revision).toBe(0);
    await service.close(); await temp.cleanup();
  });

  test('creates immutable branch heads and allocates document-global authoring revisions', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed(); const service = await startLocalMotionService({ databasePath: temp.databasePath, seed });
    const human = new MotionServiceClient(service.url); const create = makeBranchCreateCommand({ operationId: 'branch-create',
      documentId: seed.documentId, expectedRevision: 0, branchId: 'feature' });
    const created = await human.dispatch(create); expect(created).toMatchObject({ ok: true, resultingRevision: 0,
      receipt: { kind: 'motion.branch.create' } }); expect(await human.dispatch(create)).toEqual(created);
    expect(await human.dispatch(makeBranchCreateCommand({ operationId: 'branch-create', documentId: seed.documentId,
      expectedRevision: 0, branchId: 'other' })))
      .toEqual({ ok: false, code: 'OPERATION_ID_CONFLICT' });
    expect((await human.head(seed.documentId, 'feature')).document).toEqual(seed);
    expect(await human.dispatch(makeTrackCreateCommand({ operationId: 'main-write', documentId: seed.documentId,
      expectedRevision: 0, elementId: 'el_a2849ff826f3e167' }))).toMatchObject({ ok: true, resultingRevision: 1 });
    expect(await human.dispatch(makeTrackCreateCommand({ operationId: 'feature-write', documentId: seed.documentId,
      branchId: 'feature', expectedRevision: 0, elementId: 'el_2dbee68b1ea318c8' }))).toMatchObject({ ok: true, resultingRevision: 2 });
    expect((await human.head(seed.documentId, 'main')).document.revision).toBe(1);
    expect((await human.head(seed.documentId, 'feature')).document.revision).toBe(2);
    await service.close(); await temp.cleanup();
  });

  test('serializes overlapping acquisition, authorizes exact scopes, renews, releases, and revokes atomically', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed(); let now = 1000;
    const service = await startLocalMotionService({ databasePath: temp.databasePath, seed, now: () => now });
    const human = new MotionServiceClient(service.url); const a = agent(service.url); const b = agent(service.url, secretB);
    await human.dispatch(makeBranchCreateCommand({ operationId: 'make-feature', documentId: seed.documentId,
      expectedRevision: 0, branchId: 'feature' }));
    const documentClaim = makeClaimAcquireCommand({ operationId: 'doc-claim', documentId: seed.documentId,
      expectedRevision: 0, scope: 'document' });
    const branchClaim = makeClaimAcquireCommand({ operationId: 'branch-claim', documentId: seed.documentId,
      branchId: 'feature', expectedRevision: 0, scope: 'branch' });
    const [left, right] = await Promise.all([a.dispatch(documentClaim), b.dispatch(branchClaim)]);
    expect([left, right].filter((value) => value.ok)).toHaveLength(1);
    expect([left, right].filter((value) => !value.ok)).toEqual([{ ok: false, code: 'UNAUTHORIZED_CLAIM' }]);
    const won = left.ok ? left : right; const wonClient = left.ok ? a : b; const branch = left.ok ? 'main' : 'feature';
    if (!won.ok) throw new Error('CLAIM_RACE_NO_WINNER');
    expect(won).toMatchObject({ claimId: expect.stringMatching(/^claim_/), leaseVersion: 1 });
    const retryCommand = left.ok ? documentClaim : branchClaim; expect(await wonClient.dispatch(retryCommand)).toEqual(won);
    const write = makeTrackCreateCommand({ operationId: 'claimed-write', documentId: seed.documentId, branchId: branch,
      expectedRevision: 0, elementId: 'el_2dbee68b1ea318c8' });
    expect(await agent(service.url, left.ok ? secretB : secretA).dispatch(write)).toEqual({ ok: false, code: 'UNAUTHORIZED_CLAIM' });
    expect(await wonClient.dispatch(write)).toMatchObject({ ok: true, resultingRevision: 1 });
    const renew = makeClaimControlCommand({ kind: 'motion.claim.renew', operationId: 'renew', documentId: seed.documentId,
      branchId: branch, expectedRevision: 1, claimId: won.claimId!, leaseVersion: 1 });
    const renewed = await wonClient.dispatch(renew); expect(renewed).toMatchObject({ ok: true, leaseVersion: 2 });
    const beforeStale = service.store.snapshot(); expect(await wonClient.dispatch({ ...renew,
      operationId: 'stale-renew', command: { ...renew.command, operationId: 'stale-renew' } })).toEqual({ ok: false, code: 'UNAUTHORIZED_CLAIM' });
    expect(service.store.snapshot()).toEqual(beforeStale);
    const revoke = makeClaimControlCommand({ kind: 'motion.claim.revoke', operationId: 'revoke', documentId: seed.documentId,
      branchId: branch, expectedRevision: 1, claimId: won.claimId!, leaseVersion: 2 });
    expect(await human.dispatch(revoke)).toMatchObject({ ok: true, leaseVersion: 3 });
    expect(await wonClient.dispatch(makeTrackCreateCommand({ operationId: 'after-revoke', documentId: seed.documentId,
      branchId: branch, expectedRevision: 1, elementId: 'el_a2849ff826f3e167' }))).toEqual({ ok: false, code: 'UNAUTHORIZED_CLAIM' });
    const featureRevision = branch === 'feature' ? 1 : 0;
    const featureClaim = await b.dispatch(makeClaimAcquireCommand({ operationId: 'feature-claim', documentId: seed.documentId,
      branchId: 'feature', expectedRevision: featureRevision, scope: 'branch' }));
    if (!featureClaim.ok) throw new Error('FEATURE_CLAIM_FAILED');
    expect(await b.dispatch(makeTrackCreateCommand({ operationId: 'wrong-scope', documentId: seed.documentId,
      expectedRevision: branch === 'main' ? 1 : 0, elementId: 'el_a2849ff826f3e167' }))).toEqual({ ok: false, code: 'UNAUTHORIZED_CLAIM' });
    expect(await b.dispatch(makeClaimControlCommand({ kind: 'motion.claim.release', operationId: 'release', documentId: seed.documentId,
      branchId: 'feature', expectedRevision: featureRevision, claimId: featureClaim.claimId!, leaseVersion: 1 })))
      .toMatchObject({ ok: true, leaseVersion: 2 });
    const expiring = await b.dispatch(makeClaimAcquireCommand({ operationId: 'expiring', documentId: seed.documentId,
      branchId: 'feature', expectedRevision: featureRevision, scope: 'branch' }));
    expect(expiring).toMatchObject({ ok: true }); now += 120_000;
    expect(await b.dispatch(makeTrackCreateCommand({ operationId: 'expired-write', documentId: seed.documentId,
      branchId: 'feature', expectedRevision: featureRevision, elementId: 'el_a2849ff826f3e167' })))
      .toEqual({ ok: false, code: 'UNAUTHORIZED_CLAIM' });
    expect(await a.dispatch(makeClaimAcquireCommand({ operationId: 'after-expiry', documentId: seed.documentId,
      branchId: 'feature', expectedRevision: featureRevision, scope: 'branch' }))).toMatchObject({ ok: true });
    await service.close(); await temp.cleanup();
  });

  test('rolls back an injected control fault without consuming its operation ID', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed(); let injected = false;
    const service = await startLocalMotionService({ databasePath: temp.databasePath, seed,
      fault: (point) => { if (!injected && point === 'after-inserts') { injected = true; throw new Error('CONTROL_FAULT'); } } });
    const command = makeBranchCreateCommand({ operationId: 'faulted-control', documentId: seed.documentId,
      expectedRevision: 0, branchId: 'feature' }); const client = new MotionServiceClient(service.url); const before = service.store.snapshot();
    expect(await client.dispatch(command)).toEqual({ ok: false, code: 'STORAGE_FAILURE' }); expect(service.store.snapshot()).toEqual(before);
    expect(await client.dispatch(command)).toMatchObject({ ok: true }); await service.close(); await temp.cleanup();
  });

  test('keeps document-scope control events and stale pairs coherent on diverged branch heads', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed(); const service = await startLocalMotionService({
      databasePath: temp.databasePath, seed, now: () => 100 }); const human = new MotionServiceClient(service.url);
    await human.dispatch(makeBranchCreateCommand({ operationId: 'diverge-branch', documentId: seed.documentId,
      expectedRevision: 0, branchId: 'feature' }));
    await human.dispatch(makeTrackCreateCommand({ operationId: 'diverge-main', documentId: seed.documentId,
      expectedRevision: 0, elementId: 'el_a2849ff826f3e167' }));
    await human.dispatch(makeTrackCreateCommand({ operationId: 'diverge-feature', documentId: seed.documentId,
      branchId: 'feature', expectedRevision: 0, elementId: 'el_2dbee68b1ea318c8' }));
    const main = await human.head(seed.documentId, 'main'); const feature = await human.head(seed.documentId, 'feature');
    expect(main.document.revision).toBe(1); expect(feature.document.revision).toBe(2);
    const acquire = makeClaimAcquireCommand({ operationId: 'diverged-document-claim', documentId: seed.documentId,
      branchId: 'main', expectedRevision: 2, scope: 'document' });
    const acquired = service.store.execute(acquire, { actor: 'agent', capability: 'cli-agent', claimSecret: secretA, now: 100 });
    if (!('event' in acquired) || !acquired.response.ok) throw new Error('DIVERGED_ACQUIRE_FAILED');
    expect(acquired.response).toMatchObject({ expectedRevision: 2, resultingRevision: 1,
      receipt: { expectedRevision: 2, resultingRevision: 1 } });
    expect(acquired.event).toMatchObject({ branchId: 'main', revision: 1, digest: main.canonicalDigest });
    expect(acquired.event.digest).not.toBe(feature.canonicalDigest);
    const renew = makeClaimControlCommand({ kind: 'motion.claim.renew', operationId: 'diverged-renew',
      documentId: seed.documentId, branchId: 'main', expectedRevision: 2, claimId: acquired.response.claimId!, leaseVersion: 1 });
    const renewed = service.store.execute(renew, { actor: 'agent', capability: 'cli-agent', claimSecret: secretA, now: 200 });
    if (!('event' in renewed) || !renewed.response.ok) throw new Error('DIVERGED_RENEW_FAILED');
    expect(renewed.event).toMatchObject({ branchId: 'main', revision: 1, digest: main.canonicalDigest });
    const revoke = makeClaimControlCommand({ kind: 'motion.claim.revoke', operationId: 'diverged-revoke',
      documentId: seed.documentId, branchId: 'main', expectedRevision: 2, claimId: acquired.response.claimId!, leaseVersion: 2 });
    const revoked = service.store.execute(revoke, { actor: 'human', capability: 'human-editor', now: 300 });
    if (!('event' in revoked)) throw new Error('DIVERGED_REVOKE_FAILED');
    expect(revoked.event).toMatchObject({ branchId: 'main', revision: 1, digest: main.canonicalDigest });
    const beforeStale = service.store.snapshot(); const stale = await agent(service.url).dispatch(makeClaimAcquireCommand({
      operationId: 'diverged-stale', documentId: seed.documentId, branchId: 'main', expectedRevision: 1, scope: 'document' }));
    expect(stale).toEqual({ ok: false, code: 'STALE_REVISION', currentRevision: 2, currentDigest: feature.canonicalDigest });
    expect(service.store.snapshot()).toEqual(beforeStale);
    const stored = service.store.snapshot() as { events: Array<{ branch_id: string; resulting_revision: number }> };
    expect(stored.events.slice(-3).every((event) => event.branch_id === 'main' && event.resulting_revision === 1)).toBe(true);
    await service.close(); await temp.cleanup();
  });
});
