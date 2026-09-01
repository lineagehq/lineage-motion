import { describe, expect, test } from 'vitest';
import { canonicalBytes, deriveCueId, sha256Hex, type CueAuthoringOperation,
  type TransformWaypointsTranslateOperation } from '../../domain/src/index.ts';
import { createPhase3Seed } from '../../local-service/src/seed.ts';
import { makeBranchCreateCommand, makeClaimAcquireCommand, makeCueCommand, makeTrackCreateCommand, makeTrajectoryCommand, parseCommand,
  parseCommandResponse, parseCommitMetadata, parseImmutableRevision, MotionServiceClient } from './index.ts';

describe('motion.protocol.v1', () => {
  test('strictly transports canonical cursor cue intent without selector or candidate addressing', () => {
    const cueId = deriveCueId('doc', 'protocol-path');
    const operation: CueAuthoringOperation = { schemaVersion: 'motion.operation.v1', kind: 'motion.cue.create',
      operationId: 'cue-protocol', documentId: 'doc', expectedRevision: 0, payload: { cueId,
        semantic: { kind: 'cursor-path', cursorTargetId: 'el_cursor', startMs: 0, arriveMs: 700,
          easing: { kind: 'keyword', value: 'ease-out' }, waypoints: [
            { timeMs: 0, xPpm: 0, yPpm: 0 }, { timeMs: 700, xPpm: 500_000, yPpm: 500_000 },
          ] }, targetSnapshots: [{ role: 'cursor', ordinal: 0, elementId: 'el_cursor',
          structuralFingerprint: 'synthetic/cursor' }], replacementTrackIds: [], replacementInputDigest: null } };
    const command = makeCueCommand(operation);
    expect(parseCommand(command)).toEqual({ ok: true, command });
    expect(parseCommand({ ...command, command: { ...command.command, selector: '.cursor' } }))
      .toEqual({ ok: false, code: 'VALIDATION' });
    expect(parseCommand({ ...command, command: { ...command.command, payload: {
      ...command.command.payload, candidateTargetIds: ['el_other'],
    } } })).toEqual({ ok: false, code: 'VALIDATION' });
    expect(parseCommand({ ...command, command: { ...command.command, payload: { ...command.command.payload,
      semantic: { ...operation.payload.semantic, arriveMs: 0 } } } })).toEqual({ ok: false, code: 'VALIDATION' });
  });
  test('strictly carries the shared trajectory operation without widening its bundle', () => {
    const operation: TransformWaypointsTranslateOperation = { schemaVersion: 'motion.operation.v1', kind: 'motion.transform-waypoints.translate', operationId: 'trajectory', documentId: 'doc', expectedRevision: 0,
      payload: { targets: [{ elementId: 'a', trackId: 't', keyframeId: 'k', expectedTransform: 'translate(0px, 0px)' }], deltaXPpm: 1000, deltaYPpm: -1000,
        stage: { stageDigest: 'a'.repeat(64), widthMicrounits: 1_000_000, heightMicrounits: 1_000_000 } } };
    const command = makeTrajectoryCommand(operation);
    expect(parseCommand(command)).toEqual({ ok: true, command });
    expect(parseCommand({ ...command, command: { ...command.command, privatePath: '/tmp/no' } })).toEqual({ ok: false, code: 'VALIDATION' });
    expect(() => makeTrajectoryCommand({ ...operation, payload: { ...operation.payload, deltaXPpm: 0.5 } })).toThrow();
  });
  test('shares one strict canonical-ID command and rejects selector addressing or envelope drift', () => {
    const command = makeTrackCreateCommand({ operationId: 'op', documentId: 'doc', expectedRevision: 0,
      elementId: 'el_2dbee68b1ea318c8' });
    expect(parseCommand(command)).toEqual({ ok: true, command });
    expect(parseCommand({ ...command, selector: '.private' })).toEqual({ ok: false, code: 'VALIDATION' });
    expect(parseCommand({ ...command, expectedRevision: 1 })).toEqual({ ok: false, code: 'VALIDATION' });
    expect(parseCommand({ ...command, protocolVersion: 'motion.protocol.v2' })).toEqual({ ok: false, code: 'UNSUPPORTED_VERSION' });
    expect(parseCommand({ ...command, operationId: 'contains space', command: { ...command.command, operationId: 'contains space' } }))
      .toEqual({ ok: false, code: 'VALIDATION' });
    expect(() => makeTrackCreateCommand({ operationId: 'contains space', documentId: 'doc', expectedRevision: 0,
      elementId: 'el_2dbee68b1ea318c8' })).toThrow();
  });
  test('keeps branch and claim controls strict and claim-secret free', () => {
    const branch = makeBranchCreateCommand({ operationId: 'branch', documentId: 'doc', expectedRevision: 0, branchId: 'feature' });
    const claim = makeClaimAcquireCommand({ operationId: 'claim', documentId: 'doc', branchId: 'feature',
      expectedRevision: 0, scope: 'branch' });
    expect(parseCommand(branch)).toEqual({ ok: true, command: branch }); expect(parseCommand(claim)).toEqual({ ok: true, command: claim });
    expect(JSON.stringify(claim)).not.toContain('secret');
    expect(parseCommand({ ...claim, command: { ...claim.command, payload: { ...claim.command.payload, branchId: 'other' } } }))
      .toEqual({ ok: false, code: 'VALIDATION' });
  });
  test('runtime-validates exact responses, immutable revisions with matching digests, and metadata-only events', () => {
    const document = createPhase3Seed(); const canonicalDigest = sha256Hex(canonicalBytes(document));
    expect(parseImmutableRevision({ document, canonicalDigest })).toEqual({ document, canonicalDigest });
    expect(() => parseImmutableRevision({ document, canonicalDigest: '0'.repeat(64) })).toThrow('PROTOCOL_REVISION_INVALID');
    const receipt = { schemaVersion: 'motion.revision-receipt.v1', protocolVersion: 'motion.protocol.v1', documentId: document.documentId,
      branchId: 'main', expectedRevision: 0, resultingRevision: 1, operationDigest: '1'.repeat(64), canonicalDigest,
      inventory: { ruleCount: 1, applicationCount: 1, slotCount: 1, trackCount: 1 } };
    expect(parseCommandResponse({ ok: true, protocolVersion: 'motion.protocol.v1', operationId: 'op', documentId: document.documentId,
      branchId: 'main', expectedRevision: 0, resultingRevision: 1, operationDigest: '1'.repeat(64), canonicalDigest, receipt })).toBeTruthy();
    expect(() => parseCommandResponse({ ok: true, ...receipt, operationId: 'op', receipt: { ...receipt, resultingRevision: 2 } }))
      .toThrow('PROTOCOL_RESPONSE_INVALID');
    const metadata = { documentId: document.documentId, branchId: 'main', revision: 1, digest: canonicalDigest,
      kind: 'motion.track.create', commitSeq: 1 };
    expect(parseCommitMetadata(metadata)).toEqual(metadata);
    for (const leak of ['document', 'payload', 'selector', 'url']) expect(() => parseCommitMetadata({ ...metadata, [leak]: 'x' }))
      .toThrow('PROTOCOL_EVENT_INVALID');
  });
  test('enforces kind-specific success fields and exact top-level/receipt equality', () => {
    const identity = { ok: true, protocolVersion: 'motion.protocol.v1', operationId: 'strict-response', documentId: 'doc',
      branchId: 'main', expectedRevision: 2, resultingRevision: 1, operationDigest: '1'.repeat(64) } as const;
    const control = { schemaVersion: 'motion.control-receipt.v1', protocolVersion: 'motion.protocol.v1', documentId: 'doc',
      branchId: 'main', expectedRevision: 2, resultingRevision: 1, operationDigest: '1'.repeat(64) } as const;
    const branch = { ...identity, receipt: { ...control, kind: 'motion.branch.create' } };
    const acquire = { ...identity, claimId: 'claim_1234567890abcdef12345678', leaseVersion: 1, expiresAt: 60_000,
      receipt: { ...control, kind: 'motion.claim.acquire', claimId: 'claim_1234567890abcdef12345678', leaseVersion: 1 } };
    const renew = { ...acquire, receipt: { ...acquire.receipt, kind: 'motion.claim.renew' } };
    const release = { ...identity, claimId: acquire.claimId, leaseVersion: 2,
      receipt: { ...control, kind: 'motion.claim.release', claimId: acquire.claimId, leaseVersion: 2 } };
    const revoke = { ...release, receipt: { ...release.receipt, kind: 'motion.claim.revoke' } };
    for (const response of [branch, acquire, renew, release, revoke]) expect(parseCommandResponse(response)).toEqual(response);
    for (const response of [
      { ...branch, claimId: acquire.claimId },
      { ...acquire, expiresAt: undefined },
      { ...release, expiresAt: 60_000 },
      { ...revoke, receipt: { ...revoke.receipt, leaseVersion: 3 } },
      { ...renew, documentId: 'other' },
      { ...acquire, resultingRevision: 2 },
    ]) expect(() => parseCommandResponse(response)).toThrow('PROTOCOL_RESPONSE_INVALID');
    expect(parseCommandResponse({ ok: false, code: 'STALE_REVISION', currentRevision: 2,
      currentDigest: '2'.repeat(64) })).toBeTruthy();
    expect(() => parseCommandResponse({ ok: false, code: 'STALE_REVISION', currentRevision: 2 }))
      .toThrow('PROTOCOL_RESPONSE_INVALID');
    expect(() => parseCommandResponse({ ok: false, code: 'UNAUTHORIZED_CLAIM', currentRevision: 2,
      currentDigest: '2'.repeat(64) })).toThrow('PROTOCOL_RESPONSE_INVALID');
  });
  test('authenticates event reads, resumes from a cursor, and suppresses duplicate metadata', async () => {
    const metadata = { documentId: 'doc', branchId: 'main', revision: 1, digest: '1'.repeat(64),
      kind: 'motion.track.create' as const, commitSeq: 6 };
    const encoder = new TextEncoder(); const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(encoder.encode(`id: 6\nevent: commit\ndata: ${JSON.stringify(metadata)}\n\n`));
      controller.enqueue(encoder.encode(`id: 6\nevent: commit\ndata: ${JSON.stringify(metadata)}\n\n`)); controller.close();
    } });
    let request: { url: string; init: RequestInit | undefined } | undefined;
    const client = new MotionServiceClient('http://service', async (url, init) => {
      request = { url: String(url), init }; return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    }, { actor: 'human', capability: 'x'.repeat(43) });
    const received: typeof metadata[] = []; await new Promise<void>((resolve) => {
      client.events('doc', 5, (event) => received.push(event as typeof metadata), () => resolve());
    });
    expect(received).toEqual([metadata]); expect(request?.url).not.toContain('x'.repeat(43));
    expect(new Headers(request?.init?.headers).get('authorization')).toBe(`Bearer ${'x'.repeat(43)}`);
    expect(new Headers(request?.init?.headers).get('last-event-id')).toBe('5');
  });
});
