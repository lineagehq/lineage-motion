import { z } from 'zod';
export const PROJECT_PROTOCOL_VERSION = 'motion.project-protocol.v1' as const;
const id = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const name = z.string().trim().min(1).max(120);
export const shotSourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('starter'), starterId: z.enum(['trajectory', 'reusable-cues']) }).strict(),
  z.object({ kind: z.literal('html-css'), html: z.string().min(1).max(900_000) }).strict(),
]);
export type ShotSource = z.infer<typeof shotSourceSchema>;
const commandSchema = z.object({ protocolVersion: z.literal(PROJECT_PROTOCOL_VERSION), kind: z.literal('motion.shot.admit'),
  operationId: id, projectId: id, expectedCatalogRevision: integer, documentId: id, name, source: shotSourceSchema,
  claim: z.object({ scope: z.literal('document'), documentId: id }).strict().nullable(),
}).strict();
export type ShotAdmissionCommand = z.infer<typeof commandSchema>;
const shotSchema = z.object({ documentId: z.string().min(1), name, branchId: z.literal('main'), headRevision: integer,
  canonicalDigest: digest, durationMs: integer, sourceKind: z.enum(['starter', 'html-css', 'legacy']) }).strict();
const catalogSchema = z.object({ schemaVersion: z.literal('motion.project-catalog.v1'), projectId: id, name,
  catalogRevision: integer, catalogDigest: digest, shots: z.array(shotSchema) }).strict();
export type ProjectCatalog = z.infer<typeof catalogSchema>;
const inventorySchema = z.object({ sourceDigest: digest, ruleCount: integer, applicationCount: integer,
  slotCount: integer, trackCount: integer, supportedCount: integer, unsupportedCount: integer,
  missingCount: integer, diagnosticCodes: z.array(z.string()) }).strict();
export type ShotInventory = z.infer<typeof inventorySchema>;
const failureSchema = z.object({ ok: z.literal(false), code: z.enum(['VALIDATION', 'STALE_CATALOG_REVISION',
  'PROJECT_MISMATCH', 'DOCUMENT_ALREADY_EXISTS', 'OPERATION_ID_CONFLICT', 'UNAUTHORIZED_CLAIM', 'IMPORT_REJECTED', 'STORAGE_FAILURE']),
  diagnosticCode: z.string(), currentCatalogRevision: integer.optional(), inventory: inventorySchema.optional(),
}).strict();
export type ShotAdmissionFailure = z.infer<typeof failureSchema>;
const successSchema = z.object({ ok: z.literal(true), schemaVersion: z.literal('motion.shot-admission.v1'),
  operationId: id, projectId: id, documentId: id, name, branchId: z.literal('main'), headRevision: integer,
  catalogRevision: integer, catalogDigest: digest, sourceDigest: digest, canonicalDigest: digest, exportDigest: digest,
  inventory: inventorySchema, claim: z.object({ claimId: id, scope: z.literal('document'), leaseVersion: integer,
    expiresAt: integer }).strict().optional(),
}).strict();
export type ShotAdmissionReceipt = z.infer<typeof successSchema>;
export type ShotAdmissionResponse = ShotAdmissionReceipt | ShotAdmissionFailure;
export function parseShotAdmissionCommand(value: unknown): ShotAdmissionCommand { return commandSchema.parse(value); }
export function parseProjectCatalog(value: unknown): ProjectCatalog { return catalogSchema.parse(value); }
export function parseShotAdmissionResponse(value: unknown): ShotAdmissionResponse {
  return z.discriminatedUnion('ok', [successSchema, failureSchema]).parse(value);
}
