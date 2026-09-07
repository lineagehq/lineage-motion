import { z } from 'zod';
import { sequenceClipSchema, sequenceDigestSchema, sequenceDocumentSchema, sequenceEditSchema,
  sequenceIdSchema as id, sequenceIntegerSchema as integer, sequenceNameSchema,
  sequenceViewportSchema, sequenceSourceSchema } from '../../domain/src/sequence.ts';

export const SEQUENCE_PROTOCOL_VERSION = 'motion.sequence-protocol.v1' as const;
const envelope = { protocolVersion: z.literal(SEQUENCE_PROTOCOL_VERSION), operationId: id,
  projectId: id, sequenceId: id, expectedRevision: integer };
export const sequenceCommandSchema = z.discriminatedUnion('kind', [
  z.object({ ...envelope, kind: z.literal('sequence.create'), name: sequenceNameSchema,
    viewport: sequenceViewportSchema, initialClip: sequenceClipSchema.nullable(), claim: z.boolean() }).strict(),
  z.object({ ...envelope, kind: z.literal('sequence.edit'), edit: sequenceEditSchema }).strict(),
  z.object({ ...envelope, kind: z.literal('sequence.undo') }).strict(),
  z.object({ ...envelope, kind: z.literal('sequence.redo') }).strict(),
  z.object({ ...envelope, kind: z.literal('sequence.claim.acquire') }).strict(),
  z.object({ ...envelope, kind: z.literal('sequence.claim.renew'), claimId: id, expectedLeaseVersion: integer }).strict(),
  z.object({ ...envelope, kind: z.literal('sequence.claim.release'), claimId: id, expectedLeaseVersion: integer }).strict(),
  z.object({ ...envelope, kind: z.literal('sequence.claim.revoke'), claimId: id, expectedLeaseVersion: integer }).strict(),
]);
export type SequenceCommand = z.infer<typeof sequenceCommandSchema>;
export const sequenceFailureSchema = z.object({ ok: z.literal(false), code: z.enum([
  'SEQUENCE_INVALID', 'SEQUENCE_NOT_FOUND', 'SEQUENCE_ALREADY_EXISTS', 'SEQUENCE_PROJECT_MISMATCH',
  'SEQUENCE_STALE_REVISION', 'SEQUENCE_OPERATION_CONFLICT', 'SEQUENCE_UNAUTHORIZED',
  'SEQUENCE_CLAIM_CONFLICT', 'SEQUENCE_CLAIM_EXPIRED', 'SEQUENCE_STALE_LEASE', 'SEQUENCE_HISTORY_UNAVAILABLE',
  'SEQUENCE_SOURCE_UNSUPPORTED', 'SEQUENCE_SOURCE_MISMATCH', 'SEQUENCE_VIEWPORT_MISMATCH',
  'SEQUENCE_EMPTY', 'SEQUENCE_STORAGE_FAILURE',
]), reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/).optional(), currentRevision: integer.optional() }).strict();
export type SequenceFailure = z.infer<typeof sequenceFailureSchema>;
export const sequenceClaimSchema = z.object({ claimId: id, leaseVersion: integer, expiresAt: integer }).strict();
export const sequenceReceiptSchema = z.object({ ok: z.literal(true), schemaVersion: z.literal('motion.sequence-receipt.v1'),
  operationId: id, projectId: id, sequenceId: id, revision: integer, canonicalDigest: sequenceDigestSchema,
  claim: sequenceClaimSchema.optional(),
}).strict();
export type SequenceReceipt = z.infer<typeof sequenceReceiptSchema>;
export type SequenceResponse = SequenceReceipt | SequenceFailure;
export const sequenceSnapshotSchema = z.object({ schemaVersion: z.literal('motion.sequence-snapshot.v1'),
  sequence: sequenceDocumentSchema, canonicalDigest: sequenceDigestSchema,
  undoAvailable: z.boolean(), redoAvailable: z.boolean(), activeClaim: sequenceClaimSchema.nullable(),
}).strict();
export type SequenceSnapshot = z.infer<typeof sequenceSnapshotSchema>;
export const sequenceCatalogSchema = z.object({ schemaVersion: z.literal('motion.sequence-catalog.v1'), projectId: id,
  sequences: z.array(z.object({ sequenceId: id, name: sequenceNameSchema, revision: integer,
    canonicalDigest: sequenceDigestSchema, durationMs: integer, viewport: sequenceViewportSchema, clipCount: integer }).strict()),
}).strict();
export type SequenceCatalog = z.infer<typeof sequenceCatalogSchema>;
export const sequenceReadRequestSchema = z.object({ projectId: id, sequenceId: id, expectedRevision: integer }).strict();
export type SequenceReadRequest = z.infer<typeof sequenceReadRequestSchema>;
export const sequenceSourcesSchema = z.object({ schemaVersion: z.literal('motion.sequence-sources.v1'), projectId: id,
  shots: z.array(z.object({ name: sequenceNameSchema, source: sequenceSourceSchema.extend({ durationMs: integer }),
    viewport: sequenceViewportSchema.nullable(), reasonCode: z.string().nullable() }).strict()),
}).strict();
export type SequenceSources = z.infer<typeof sequenceSourcesSchema>;
