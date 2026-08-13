import { z } from 'zod';

import { canonicalBytes, canonicalJson, isValidAuthoringOperationId, sha256Hex, validateMotionDocument,
  type MotionDocument } from '../../domain/src/index.ts';

export const PROTOCOL_VERSION = 'motion.protocol.v1' as const;
export const MAIN_BRANCH_ID = 'main' as const;

const trackCreate = z.object({
  schemaVersion: z.literal('motion.operation.v1'),
  kind: z.literal('motion.track.create'),
  operationId: z.string().refine(isValidAuthoringOperationId),
  documentId: z.string().min(1),
  expectedRevision: z.number().int().nonnegative().safe(),
  elementId: z.enum(['el_a2849ff826f3e167', 'el_2dbee68b1ea318c8']),
  payload: z.object({
    property: z.literal('opacity'), durationMs: z.literal(1000), delayMs: z.literal(610),
    easing: z.literal('linear'), startValue: z.literal(0), endValue: z.literal(1),
  }).strict(),
}).strict();

export const commandSchema = z.object({
  protocolVersion: z.literal(PROTOCOL_VERSION),
  operationId: z.string().refine(isValidAuthoringOperationId),
  documentId: z.string().min(1),
  branchId: z.literal(MAIN_BRANCH_ID),
  expectedRevision: z.number().int().nonnegative().safe(),
  command: trackCreate,
}).strict().superRefine((value, context) => {
  for (const key of ['operationId', 'documentId', 'expectedRevision'] as const) {
    if (value[key] !== value.command[key]) context.addIssue({ code: 'custom', message: `ENVELOPE_${key}` });
  }
});

export type MotionCommand = z.infer<typeof commandSchema>;
export type ProtocolErrorCode = 'VALIDATION' | 'STALE_REVISION' | 'OPERATION_ID_CONFLICT'
  | 'UNSUPPORTED_VERSION' | 'STORAGE_FAILURE';
export type RevisionReceipt = {
  schemaVersion: 'motion.revision-receipt.v1'; protocolVersion: typeof PROTOCOL_VERSION;
  documentId: string; branchId: typeof MAIN_BRANCH_ID; expectedRevision: number;
  resultingRevision: number; operationDigest: string; canonicalDigest: string;
  inventory: { ruleCount: number; applicationCount: number; slotCount: number; trackCount: number };
};
export type CommandSuccess = {
  ok: true; protocolVersion: typeof PROTOCOL_VERSION; operationId: string; documentId: string;
  branchId: typeof MAIN_BRANCH_ID; expectedRevision: number; resultingRevision: number;
  operationDigest: string; canonicalDigest: string; receipt: RevisionReceipt;
};
export type CommandFailure = { ok: false; code: ProtocolErrorCode; currentRevision?: number | undefined; currentDigest?: string | undefined };
export type CommandResponse = CommandSuccess | CommandFailure;
export type ImmutableRevision = { document: MotionDocument; canonicalDigest: string };
export type CommitMetadata = { documentId: string; branchId: typeof MAIN_BRANCH_ID; revision: number;
  digest: string; kind: 'motion.track.create'; commitSeq: number };

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const inventoryReceipt = z.object({ ruleCount: z.number().int().nonnegative(), applicationCount: z.number().int().nonnegative(),
  slotCount: z.number().int().nonnegative(), trackCount: z.number().int().nonnegative() }).strict();
const receiptSchema = z.object({ schemaVersion: z.literal('motion.revision-receipt.v1'), protocolVersion: z.literal(PROTOCOL_VERSION),
  documentId: z.string().min(1), branchId: z.literal(MAIN_BRANCH_ID), expectedRevision: z.number().int().nonnegative().safe(),
  resultingRevision: z.number().int().positive().safe(), operationDigest: digest, canonicalDigest: digest,
  inventory: inventoryReceipt }).strict();
const successSchema = z.object({ ok: z.literal(true), protocolVersion: z.literal(PROTOCOL_VERSION), operationId: z.string().min(1),
  documentId: z.string().min(1), branchId: z.literal(MAIN_BRANCH_ID), expectedRevision: z.number().int().nonnegative().safe(),
  resultingRevision: z.number().int().positive().safe(), operationDigest: digest, canonicalDigest: digest,
  receipt: receiptSchema }).strict().superRefine((value, context) => {
    for (const key of ['documentId', 'branchId', 'expectedRevision', 'resultingRevision', 'operationDigest', 'canonicalDigest'] as const) {
      if (value[key] !== value.receipt[key]) context.addIssue({ code: 'custom', message: `RECEIPT_${key}` });
    }
  });
const failureSchema = z.object({ ok: z.literal(false), code: z.enum(['VALIDATION', 'STALE_REVISION', 'OPERATION_ID_CONFLICT',
  'UNSUPPORTED_VERSION', 'STORAGE_FAILURE']), currentRevision: z.number().int().nonnegative().safe().optional(),
currentDigest: digest.optional() }).strict();
const responseSchema = z.union([successSchema, failureSchema]);
const immutableRevisionSchema = z.object({ document: z.custom<MotionDocument>((value) => validateMotionDocument(value).ok),
  canonicalDigest: digest }).strict().superRefine((value, context) => {
    if (sha256Hex(canonicalBytes(value.document)) !== value.canonicalDigest) context.addIssue({ code: 'custom', message: 'REVISION_DIGEST' });
  });
const commitMetadataSchema = z.object({ documentId: z.string().min(1), branchId: z.literal(MAIN_BRANCH_ID),
  revision: z.number().int().positive().safe(), digest, kind: z.literal('motion.track.create'),
  commitSeq: z.number().int().positive().safe() }).strict();

export function parseCommand(input: unknown): { ok: true; command: MotionCommand } | { ok: false; code: ProtocolErrorCode } {
  if (typeof input === 'object' && input !== null && 'protocolVersion' in input
    && (input as { protocolVersion?: unknown }).protocolVersion !== PROTOCOL_VERSION) {
    return { ok: false, code: 'UNSUPPORTED_VERSION' };
  }
  const parsed = commandSchema.safeParse(input);
  return parsed.success ? { ok: true, command: parsed.data } : { ok: false, code: 'VALIDATION' };
}

export function canonicalResponseBytes(response: CommandResponse): string { return canonicalJson(response); }
export function parseCommandResponse(input: unknown): CommandResponse {
  const parsed = responseSchema.safeParse(input); if (!parsed.success) throw new Error('PROTOCOL_RESPONSE_INVALID');
  return parsed.data;
}
export function parseImmutableRevision(input: unknown): ImmutableRevision {
  const parsed = immutableRevisionSchema.safeParse(input); if (!parsed.success) throw new Error('PROTOCOL_REVISION_INVALID');
  return parsed.data;
}
export function parseCommitMetadata(input: unknown): CommitMetadata {
  const parsed = commitMetadataSchema.safeParse(input); if (!parsed.success) throw new Error('PROTOCOL_EVENT_INVALID');
  return parsed.data;
}

export class MotionServiceClient {
  readonly baseUrl: string;
  private readonly request: typeof fetch;
  constructor(baseUrl: string, request: typeof fetch = (...args) => fetch(...args)) { this.baseUrl = baseUrl; this.request = request; }
  async dispatch(command: MotionCommand): Promise<CommandResponse> {
    const response = await this.request(`${this.baseUrl}/api/v1/commands`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: canonicalJson(command),
    });
    return parseCommandResponse(await response.json());
  }
  async head(documentId: string): Promise<ImmutableRevision> {
    const response = await this.request(`${this.baseUrl}/api/v1/documents/${encodeURIComponent(documentId)}/head`);
    if (!response.ok) throw new Error('SERVICE_HEAD_FAILED');
    return parseImmutableRevision(await response.json());
  }
  async revision(documentId: string, revision: number): Promise<ImmutableRevision> {
    const response = await this.request(`${this.baseUrl}/api/v1/documents/${encodeURIComponent(documentId)}/revisions/${revision}`);
    if (!response.ok) throw new Error('SERVICE_REVISION_FAILED');
    return parseImmutableRevision(await response.json());
  }
  events(documentId: string, onCommit: (event: CommitMetadata) => void): EventSource {
    const source = new EventSource(`${this.baseUrl}/api/v1/documents/${encodeURIComponent(documentId)}/events`);
    source.addEventListener('commit', (event) => onCommit(parseCommitMetadata(JSON.parse((event as MessageEvent<string>).data))));
    return source;
  }
}

export function makeTrackCreateCommand(input: { operationId: string; documentId: string; expectedRevision: number;
  elementId: 'el_a2849ff826f3e167' | 'el_2dbee68b1ea318c8' }): MotionCommand {
  const command = { schemaVersion: 'motion.operation.v1' as const, kind: 'motion.track.create' as const,
    operationId: input.operationId, documentId: input.documentId, expectedRevision: input.expectedRevision,
    elementId: input.elementId, payload: { property: 'opacity' as const, durationMs: 1000 as const,
      delayMs: 610 as const, easing: 'linear' as const, startValue: 0 as const, endValue: 1 as const } };
  return commandSchema.parse({ protocolVersion: PROTOCOL_VERSION, operationId: input.operationId, documentId: input.documentId,
    branchId: MAIN_BRANCH_ID, expectedRevision: input.expectedRevision, command });
}
