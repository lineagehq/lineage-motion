import { describe, expect, test } from 'vitest';
import { handoffRequestSchema, parseHandoffRequest, parseReviewCommand } from './review.ts';

describe('review.protocol.v1', () => {
  test('strictly parses the distinct five-action review envelope', () => {
    const command = { schemaVersion: 'review.operation.v1', kind: 'review.annotation.create', operationId: 'op',
      documentId: 'doc', branchId: 'main', expectedBranchRevision: 0, annotationId: 'note',
      expectedAnnotationVersion: 0, anchorRevision: 0, body: 'synthetic' };
    expect(parseReviewCommand({ protocolVersion: 'review.protocol.v1', command })).toEqual({ ok: true, command });
    expect(parseReviewCommand({ protocolVersion: 'motion.protocol.v1', command })).toMatchObject({ ok: false,
      response: { code: 'UNSUPPORTED_VERSION' } });
    expect(parseReviewCommand({ protocolVersion: 'review.protocol.v1', command: { ...command, selector: '.x' } }))
      .toMatchObject({ ok: false, response: { code: 'VALIDATION' } });
  });
  test('rejects every ambiguous, unversioned, nonempty, and unallowlisted handoff input', () => {
    const comparison = { schemaVersion: 'review.comparison-identity.v1', leftRevision: 0,
      leftCanonicalDigest: 'a'.repeat(64), rightRevision: 1, rightCanonicalDigest: 'b'.repeat(64) };
    const proof = { schemaVersion: 'review.proof-identity.v1', revision: 1, canonicalDigest: 'b'.repeat(64),
      htmlDigest: 'c'.repeat(64), cssDigest: 'd'.repeat(64), exportDigest: 'e'.repeat(64) };
    const valid = { operationId: 'handoff-op', schemaVersion: 'review.handoff-identity.v1',
      serializerVersion: 'review.serializer.v1', documentId: 'doc', branchId: 'main', revision: 1,
      canonicalDigest: 'b'.repeat(64), comparisonRecords: [comparison], proofRecords: [proof], benchmarkRecords: [] };
    expect(parseHandoffRequest(valid)).toMatchObject({ ok: true });
    const invalid = [
      (({ comparisonRecords: _, ...rest }) => rest)(valid),
      { ...valid, comparisonRecords: [comparison, comparison] },
      { ...valid, comparisonRecords: [{ ...comparison, rightRevision: 2 }, comparison] },
      { ...valid, comparisonRecords: [{ ...comparison, schemaVersion: 'review.comparison-identity.v0' }] },
      { ...valid, proofRecords: [{ ...proof, schemaVersion: 'review.proof-identity.v0' }] },
      { ...valid, benchmarkRecords: [{ schemaVersion: 'benchmark.v1' }] },
      { ...valid, unallowlistedSentinel: 'must-not-escape' },
      { ...valid, comparisonRecords: [{ ...comparison, unallowlistedSentinel: 'must-not-escape' }] },
      { ...valid, proofRecords: [{ ...proof, unallowlistedSentinel: 'must-not-escape' }] },
    ];
    for (const value of invalid) expect(parseHandoffRequest(value)).toMatchObject({ ok: false,
      response: { diagnostic: { code: 'PROTOCOL_HANDOFF_REQUEST_INVALID' } } });
    expect(() => handoffRequestSchema.parse({ ...valid, unallowlistedSentinel: 'must-not-escape' })).toThrow();
  });
});
