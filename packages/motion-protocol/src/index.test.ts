import { describe, expect, test } from 'vitest';
import { canonicalBytes, sha256Hex } from '../../domain/src/index.ts';
import { createPhase3Seed } from '../../local-service/src/seed.ts';
import { makeTrackCreateCommand, parseCommand, parseCommandResponse, parseCommitMetadata, parseImmutableRevision } from './index.ts';

describe('motion.protocol.v1', () => {
  test('shares one strict canonical-ID command and rejects selector addressing or envelope drift', () => {
    const command = makeTrackCreateCommand({ operationId: 'op', documentId: 'doc', expectedRevision: 0,
      elementId: 'el_2dbee68b1ea318c8' });
    expect(parseCommand(command)).toEqual({ ok: true, command });
    expect(parseCommand({ ...command, selector: '.private' })).toEqual({ ok: false, code: 'VALIDATION' });
    expect(parseCommand({ ...command, expectedRevision: 1 })).toEqual({ ok: false, code: 'VALIDATION' });
    expect(parseCommand({ ...command, protocolVersion: 'motion.protocol.v2' })).toEqual({ ok: false, code: 'UNSUPPORTED_VERSION' });
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
});
