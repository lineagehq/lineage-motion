import { z } from 'zod';
import { canonicalJson } from '../../domain/src/index.ts';
import { REVIEW_PROTOCOL_VERSION, REVIEW_SERIALIZER_VERSION, type AnnotationProjection, type HandoffIdentityInput,
  type HandoffReceipt } from '../../review-domain/src/index.ts';

const stableId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const operationId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const revision = z.number().int().nonnegative().safe();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const base = { schemaVersion: z.literal('review.operation.v1'), operationId, documentId: stableId, branchId: stableId,
  expectedBranchRevision: revision, annotationId: stableId, expectedAnnotationVersion: revision } as const;
const create = z.object({ ...base, kind: z.literal('review.annotation.create'), anchorRevision: revision,
  body: z.string().min(1).max(100_000) }).strict();
const edit = z.object({ ...base, kind: z.literal('review.annotation.edit'), body: z.string().min(1).max(100_000) }).strict();
const terminal = (kind: 'review.annotation.resolve' | 'review.annotation.reopen' | 'review.annotation.delete') =>
  z.object({ ...base, kind: z.literal(kind) }).strict();
export const reviewCommandSchema = z.discriminatedUnion('kind', [create, edit, terminal('review.annotation.resolve'),
  terminal('review.annotation.reopen'), terminal('review.annotation.delete')]);
export type ReviewCommand = z.infer<typeof reviewCommandSchema>;

export type ReviewDiagnostic = { schemaVersion: 'review.diagnostic.v1'; code: string;
  category: 'protocol' | 'target' | 'revision' | 'authorization' | 'domain' | 'storage'; retryable: boolean;
  currentBranchRevision?: number; currentAnnotationVersion?: number };
export type ReviewFailure = { ok: false; protocolVersion: typeof REVIEW_PROTOCOL_VERSION;
  code: 'VALIDATION' | 'STALE_BRANCH_REVISION' | 'STALE_ANNOTATION_VERSION' | 'UNAUTHORIZED_CLAIM' |
    'OPERATION_ID_CONFLICT' | 'UNSUPPORTED_VERSION' | 'STORAGE_FAILURE'; diagnostic: ReviewDiagnostic };
export type ReviewSuccess = { ok: true; protocolVersion: typeof REVIEW_PROTOCOL_VERSION; operationId: string;
  documentId: string; branchId: string; annotation: AnnotationProjection;
  receipt: { schemaVersion: 'review.receipt.v1'; protocolVersion: typeof REVIEW_PROTOCOL_VERSION; operationId: string;
    documentId: string; branchId: string; annotationId: string; annotationVersion: number; kind: ReviewCommand['kind'] } };
export type ReviewResponse = ReviewSuccess | ReviewFailure;
export type ReviewEvent = { schemaVersion: 'review.event.v1'; protocolVersion: typeof REVIEW_PROTOCOL_VERSION;
  reviewSeq: number; documentId: string; branchId: string; operationId: string; annotationId: string;
  annotationVersion: number; kind: ReviewCommand['kind']; actor: { kind: 'human' | 'agent'; actorId: string } };
export type AnnotationList = { schemaVersion: 'review.annotation-list.v1'; documentId: string; branchId: string;
  annotations: AnnotationProjection[] };
export type RevisionComparison = { schemaVersion: 'review.comparison.v1'; documentId: string;
  left: { revision: number; canonicalDigest: string }; right: { revision: number; canonicalDigest: string };
  changed: boolean; unsupported: []; missing: [] };
const comparisonIdentitySchema = z.object({ schemaVersion: z.literal('review.comparison-identity.v1'),
  leftRevision: revision, leftCanonicalDigest: digest, rightRevision: revision, rightCanonicalDigest: digest }).strict();
const proofIdentitySchema = z.object({ schemaVersion: z.literal('review.proof-identity.v1'), revision,
  canonicalDigest: digest, htmlDigest: digest, cssDigest: digest, exportDigest: digest }).strict();
const orderedRecords = <T>(schema: z.ZodType<T>, code: string) => z.array(schema).min(1).superRefine((records, context) => {
  const keys = records.map((record) => canonicalJson(record));
  if (new Set(keys).size !== keys.length || keys.some((key, index) => index > 0 && key <= keys[index - 1]!))
    context.addIssue({ code: 'custom', message: code });
});
export const handoffRequestSchema = z.object({ operationId,
  schemaVersion: z.literal('review.handoff-identity.v1'), serializerVersion: z.literal(REVIEW_SERIALIZER_VERSION),
  documentId: stableId, branchId: stableId, revision, canonicalDigest: digest,
  comparisonRecords: orderedRecords(comparisonIdentitySchema, 'COMPARISON_RECORD_ORDER'),
  proofRecords: orderedRecords(proofIdentitySchema, 'PROOF_RECORD_ORDER'), benchmarkRecords: z.tuple([]) }).strict();
export type HandoffRequest = z.infer<typeof handoffRequestSchema>;

export function parseReviewCommand(input: unknown): { ok: true; command: ReviewCommand } | { ok: false; response: ReviewFailure } {
  if (typeof input === 'object' && input !== null && 'protocolVersion' in input
    && (input as { protocolVersion?: unknown }).protocolVersion !== REVIEW_PROTOCOL_VERSION)
    return { ok: false, response: reviewFailure('UNSUPPORTED_VERSION', 'UNSUPPORTED_VERSION', 'protocol', false) };
  const candidate = typeof input === 'object' && input !== null && 'command' in input ? (input as { command: unknown }).command : input;
  const parsed = reviewCommandSchema.safeParse(candidate);
  return parsed.success ? { ok: true, command: parsed.data }
    : { ok: false, response: reviewFailure('VALIDATION', 'PROTOCOL_REVIEW_COMMAND_INVALID', 'protocol', false) };
}

export function parseReviewResponse(input: unknown): ReviewResponse {
  if (!input || typeof input !== 'object' || !('ok' in input)) throw new Error('PROTOCOL_REVIEW_RESPONSE_INVALID');
  return input as ReviewResponse;
}
export function parseHandoffRequest(input: unknown): { ok: true; operationId: string;
  identity: Omit<HandoffIdentityInput, 'annotationSnapshotVersion' | 'annotationSnapshotDigest'> }
  | { ok: false; response: ReviewFailure } {
  const parsed = handoffRequestSchema.safeParse(input); if (!parsed.success) return { ok: false,
    response: reviewFailure('VALIDATION', 'PROTOCOL_HANDOFF_REQUEST_INVALID', 'protocol', false) };
  const { operationId: parsedOperationId, ...identity } = parsed.data;
  return { ok: true, operationId: parsedOperationId, identity };
}
export const canonicalReviewResponseBytes = (value: ReviewResponse): string => canonicalJson(value);
export function reviewFailure(code: ReviewFailure['code'], diagnosticCode: string, category: ReviewDiagnostic['category'],
  retryable: boolean, extra: Partial<Pick<ReviewDiagnostic, 'currentBranchRevision' | 'currentAnnotationVersion'>> = {}): ReviewFailure {
  return { ok: false, protocolVersion: REVIEW_PROTOCOL_VERSION, code, diagnostic: {
    schemaVersion: 'review.diagnostic.v1', code: diagnosticCode, category, retryable, ...extra } };
}

export class ReviewServiceClient {
  constructor(readonly baseUrl: string, private readonly request: typeof fetch = (...args) => fetch(...args),
    private readonly auth: { actor: 'human' | 'agent'; capability: string; claimSecret?: string }) {}
  private headers(json = false): Record<string, string> { return { ...(json ? { 'content-type': 'application/json' } : {}),
    authorization: `Bearer ${this.auth.capability}`, 'x-motion-actor': this.auth.actor,
    ...(this.auth.claimSecret ? { 'x-motion-claim-secret': this.auth.claimSecret } : {}) }; }
  async dispatch(command: ReviewCommand): Promise<ReviewResponse> { const response = await this.request(`${this.baseUrl}/api/review/v1/commands`,
    { method: 'POST', headers: this.headers(true), body: canonicalJson({ protocolVersion: REVIEW_PROTOCOL_VERSION, command }) });
    return parseReviewResponse(await response.json()); }
  async annotations(documentId: string, branchId: string): Promise<AnnotationList> { return this.get(
    `/api/review/v1/documents/${encodeURIComponent(documentId)}/branches/${encodeURIComponent(branchId)}/annotations`) as Promise<AnnotationList>; }
  async compare(documentId: string, left: number, right: number): Promise<RevisionComparison> { return this.get(
    `/api/review/v1/documents/${encodeURIComponent(documentId)}/compare?left=${left}&right=${right}`) as Promise<RevisionComparison>; }
  async handoff(input: HandoffRequest): Promise<HandoffReceipt> { const parsed = handoffRequestSchema.parse(input);
    const response = await this.request(`${this.baseUrl}/api/review/v1/handoffs`,
    { method: 'POST', headers: this.headers(true), body: canonicalJson(parsed) }); const value = await response.json() as HandoffReceipt | ReviewFailure;
    if (!response.ok) throw new Error(`REVIEW_HANDOFF_FAILED:${'diagnostic' in value ? value.diagnostic.code : 'INVALID'}`);
    return value as HandoffReceipt; }
  private async get(path: string): Promise<unknown> { const response = await this.request(`${this.baseUrl}${path}`, { headers: this.headers() });
    if (!response.ok) throw new Error('REVIEW_READ_FAILED'); return response.json(); }
}

export const reviewSchemas = { stableId, operationId, revision, digest };
