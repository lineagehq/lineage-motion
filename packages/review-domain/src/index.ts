import { canonicalJson, sha256Hex } from '../../domain/src/index.ts';

export const REVIEW_PROTOCOL_VERSION = 'review.protocol.v1' as const;
export const REVIEW_SERIALIZER_VERSION = 'review.serializer.v1' as const;

export type AnnotationState = 'open' | 'resolved' | 'deleted';
export type AnnotationProjection = {
  annotationId: string; documentId: string; branchId: string; anchorRevision: number;
  version: number; state: AnnotationState;
};
export type AnnotationPrivateSnapshotEntry = AnnotationProjection & { body: string };
export type ComparisonIdentityRecord = {
  schemaVersion: 'review.comparison-identity.v1';
  leftRevision: number; leftCanonicalDigest: string; rightRevision: number; rightCanonicalDigest: string;
};
export type ProofIdentityRecord = {
  schemaVersion: 'review.proof-identity.v1';
  revision: number; canonicalDigest: string; htmlDigest: string; cssDigest: string; exportDigest: string;
};
export type HandoffIdentityInput = {
  schemaVersion: 'review.handoff-identity.v1'; serializerVersion: typeof REVIEW_SERIALIZER_VERSION;
  documentId: string; branchId: string; revision: number; canonicalDigest: string;
  annotationSnapshotVersion: number; annotationSnapshotDigest: string;
  comparisonRecords: ComparisonIdentityRecord[]; proofRecords: ProofIdentityRecord[]; benchmarkRecords: [];
};
export type HandoffReceipt = {
  schemaVersion: 'review.handoff-receipt.v1'; protocolVersion: typeof REVIEW_PROTOCOL_VERSION;
  identity: HandoffIdentityInput; handoffDigest: string; bytes: string;
};

export function annotationSnapshotBytes(entries: AnnotationPrivateSnapshotEntry[]): string {
  assertOrderedUnique(entries.map((entry) => `${entry.annotationId}\0${entry.version}`), 'ANNOTATION_SNAPSHOT_ORDER');
  return canonicalJson({ schemaVersion: 'review.annotation-snapshot.v1', annotations: entries });
}

export function annotationSnapshotDigest(entries: AnnotationPrivateSnapshotEntry[]): string {
  return sha256Hex(annotationSnapshotBytes(entries));
}

export function validateHandoffIdentity(input: HandoffIdentityInput): void {
  assertExactKeys(input, ['annotationSnapshotDigest', 'annotationSnapshotVersion', 'benchmarkRecords', 'branchId',
    'canonicalDigest', 'comparisonRecords', 'documentId', 'proofRecords', 'revision', 'schemaVersion', 'serializerVersion'],
  'HANDOFF_IDENTITY_FIELDS_INVALID');
  if (input.schemaVersion !== 'review.handoff-identity.v1' || input.serializerVersion !== REVIEW_SERIALIZER_VERSION)
    throw new Error('HANDOFF_VERSION_INVALID');
  if (input.benchmarkRecords.length !== 0) throw new Error('BENCHMARK_RECORDS_NOT_EMPTY');
  if (!input.comparisonRecords.length || !input.proofRecords.length) throw new Error('HANDOFF_RECORDS_REQUIRED');
  for (const record of input.comparisonRecords) { assertExactKeys(record, ['leftCanonicalDigest', 'leftRevision',
    'rightCanonicalDigest', 'rightRevision', 'schemaVersion'], 'COMPARISON_RECORD_FIELDS_INVALID');
    if (record.schemaVersion !== 'review.comparison-identity.v1') throw new Error('COMPARISON_RECORD_VERSION_INVALID'); }
  for (const record of input.proofRecords) { assertExactKeys(record, ['canonicalDigest', 'cssDigest', 'exportDigest',
    'htmlDigest', 'revision', 'schemaVersion'], 'PROOF_RECORD_FIELDS_INVALID');
    if (record.schemaVersion !== 'review.proof-identity.v1') throw new Error('PROOF_RECORD_VERSION_INVALID'); }
  assertOrderedUnique(input.comparisonRecords.map((record) => canonicalJson(record)), 'COMPARISON_RECORD_ORDER');
  assertOrderedUnique(input.proofRecords.map((record) => canonicalJson(record)), 'PROOF_RECORD_ORDER');
}

function assertExactKeys(value: object, expected: string[], code: string): void {
  const actual = Object.keys(value).sort(); if (canonicalJson(actual) !== canonicalJson([...expected].sort())) throw new Error(code);
}

export function createHandoffReceipt(input: HandoffIdentityInput): HandoffReceipt {
  validateHandoffIdentity(input);
  const bytes = canonicalJson({ schemaVersion: 'review.handoff.v1', identity: input });
  return { schemaVersion: 'review.handoff-receipt.v1', protocolVersion: REVIEW_PROTOCOL_VERSION,
    identity: input, handoffDigest: sha256Hex(bytes), bytes };
}

function assertOrderedUnique(keys: string[], code: string): void {
  if (new Set(keys).size !== keys.length || keys.some((key, index) => index > 0 && key <= keys[index - 1]!))
    throw new Error(code);
}
