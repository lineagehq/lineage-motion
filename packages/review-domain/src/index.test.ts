import { describe, expect, test } from 'vitest';
import { createHandoffReceipt, REVIEW_SERIALIZER_VERSION, annotationSnapshotDigest } from './index.ts';

describe('review handoff identity', () => {
  test('is deterministic, ordered, and explicit about absent benchmarks', () => {
    const input = { schemaVersion: 'review.handoff-identity.v1' as const, serializerVersion: REVIEW_SERIALIZER_VERSION,
      documentId: 'document', branchId: 'main', revision: 2, canonicalDigest: 'a'.repeat(64),
      annotationSnapshotVersion: 1, annotationSnapshotDigest: 'b'.repeat(64), comparisonRecords: [{ schemaVersion: 'review.comparison-identity.v1' as const, leftRevision: 1,
        leftCanonicalDigest: 'c'.repeat(64), rightRevision: 2, rightCanonicalDigest: 'a'.repeat(64) }], proofRecords: [{ schemaVersion: 'review.proof-identity.v1' as const,
        revision: 2, canonicalDigest: 'a'.repeat(64), htmlDigest: 'd'.repeat(64), cssDigest: 'e'.repeat(64),
        exportDigest: 'f'.repeat(64) }], benchmarkRecords: [] as [] };
    expect(createHandoffReceipt(input)).toEqual(createHandoffReceipt(structuredClone(input)));
    expect(() => createHandoffReceipt({ ...input, comparisonRecords: [...input.comparisonRecords, ...input.comparisonRecords] }))
      .toThrow('COMPARISON_RECORD_ORDER');
    expect(() => createHandoffReceipt({ ...input, unallowlistedSentinel: 'must-not-escape' } as typeof input))
      .toThrow('HANDOFF_IDENTITY_FIELDS_INVALID');
    expect(() => createHandoffReceipt({ ...input, proofRecords: [{ ...input.proofRecords[0]!,
      unallowlistedSentinel: 'must-not-escape' }] } as unknown as typeof input)).toThrow('PROOF_RECORD_FIELDS_INVALID');
  });
  test('private snapshot bodies influence only the private digest', () => {
    const base = { annotationId: 'a', documentId: 'd', branchId: 'main', anchorRevision: 0,
      version: 1, state: 'open' as const };
    expect(annotationSnapshotDigest([{ ...base, body: 'one' }])).not.toBe(annotationSnapshotDigest([{ ...base, body: 'two' }]));
  });
});
