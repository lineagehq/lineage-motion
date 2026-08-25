import { z } from 'zod';

import { canonicalBytes, canonicalJson, isValidAuthoringOperationId, sha256Hex, validateMotionDocument,
  type HistoryOperation, type MotionDocument, type TrajectoryAuthoringOperation } from '../../domain/src/index.ts';

export const PROTOCOL_VERSION = 'motion.protocol.v1' as const;
export const MAIN_BRANCH_ID = 'main' as const;
export type ActorKind = 'human' | 'agent';
export type RequestAuth = { actor: ActorKind; capability: string; claimSecret?: string };

const operationId = z.string().refine(isValidAuthoringOperationId);
const branchId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const revision = z.number().int().nonnegative().safe();
const trackCreate = z.object({ schemaVersion: z.literal('motion.operation.v1'), kind: z.literal('motion.track.create'),
  operationId, documentId: z.string().min(1), expectedRevision: revision,
  elementId: z.enum(['el_a2849ff826f3e167', 'el_2dbee68b1ea318c8']),
  payload: z.object({ property: z.literal('opacity'), durationMs: z.literal(1000), delayMs: z.literal(610),
    easing: z.literal('linear'), startValue: z.literal(0), endValue: z.literal(1) }).strict() }).strict();
const target = z.object({ elementId: z.string().min(1), trackId: z.string().min(1), keyframeId: z.string().min(1), expectedTransform: z.string().min(1) }).strict();
const targets = z.array(target).min(1).superRefine((value, context) => { const keys = value.map((item) => `${item.elementId}\0${item.trackId}\0${item.keyframeId}`);
  if (new Set(keys).size !== keys.length || keys.some((key, index) => index > 0 && key <= keys[index - 1]!)) context.addIssue({ code: 'custom', message: 'TARGET_ORDER' }); });
const stage = z.object({ stageDigest: z.string().regex(/^[a-f0-9]{64}$/), widthMicrounits: z.number().int().positive().safe(), heightMicrounits: z.number().int().positive().safe() }).strict();
const pose = z.object({ translateXMicrounits: z.number().int().safe(), translateYMicrounits: z.number().int().safe(), scalePpm: z.number().int().positive().max(10_000_000), rotateMicrodegrees: z.number().int().safe() }).strict();
const timing = z.discriminatedUnion('kind', [z.object({ kind: z.literal('keyword'), value: z.enum(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']) }).strict(),
  z.object({ kind: z.literal('steps'), count: z.number().int().positive(), position: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('cubic-bezier'), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }).strict()]);
const authorBase = { schemaVersion: z.literal('motion.operation.v1'), operationId, documentId: z.string().min(1), expectedRevision: revision } as const;
const poseSet = z.object({ ...authorBase, kind: z.literal('motion.transform-pose.set'), ...target.shape, payload: z.object({ pose, stage }).strict() }).strict();
const waypointTranslate = z.object({ ...authorBase, kind: z.literal('motion.transform-waypoints.translate'), payload: z.object({ targets, deltaXPpm: z.number().int().min(-1_000_000).max(1_000_000), deltaYPpm: z.number().int().min(-1_000_000).max(1_000_000), stage }).strict() }).strict();
const groupTime = z.object({ ...authorBase, kind: z.literal('motion.keyframe-group-time.set'), payload: z.object({ targets, sourceTimeMs: z.number().int().min(0).max(2100), targetTimeMs: z.number().int().min(1).max(2100), landingTimeMs: z.number().int().min(1).max(2099), settledTimeMs: z.number().int().min(2).max(2100) }).strict() }).strict();
const groupEasing = z.object({ ...authorBase, kind: z.literal('motion.keyframe-group-easing.set'), payload: z.object({ targets, expectedEasing: timing, easing: timing }).strict() }).strict();
const settledHold = z.object({ ...authorBase, kind: z.literal('motion.settled-hold.set'), payload: z.object({ targets, sourceTimeMs: z.number().int().min(1).max(2100), settledTimeMs: z.number().int().min(2).max(2099), landingTimeMs: z.number().int().min(1).max(2098), boundaryTimeMs: z.literal(2100) }).strict() }).strict();
const history = z.object({ ...authorBase, kind: z.enum(['motion.history.undo', 'motion.history.redo']) }).strict();
const controlBase = { schemaVersion: z.literal('motion.control.v1'), operationId, documentId: z.string().min(1),
  expectedRevision: revision } as const;
const branchCreate = z.object({ ...controlBase, kind: z.literal('motion.branch.create'),
  payload: z.object({ branchId }).strict() }).strict();
const claimAcquire = z.object({ ...controlBase, kind: z.literal('motion.claim.acquire'),
  payload: z.discriminatedUnion('scope', [z.object({ scope: z.literal('document') }).strict(),
    z.object({ scope: z.literal('branch'), branchId }).strict()]) }).strict();
const leaseControl = (kind: 'motion.claim.renew' | 'motion.claim.release' | 'motion.claim.revoke') => z.object({
  ...controlBase, kind: z.literal(kind), payload: z.object({ claimId: z.string().regex(/^claim_[a-f0-9]{24}$/),
    leaseVersion: z.number().int().positive().safe() }).strict() }).strict();
export const operationSchema = z.discriminatedUnion('kind', [trackCreate, poseSet, waypointTranslate, groupTime, groupEasing, settledHold, history, branchCreate, claimAcquire,
  leaseControl('motion.claim.renew'), leaseControl('motion.claim.release'), leaseControl('motion.claim.revoke')]);
export const commandSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), operationId,
  documentId: z.string().min(1), branchId, expectedRevision: revision, command: operationSchema }).strict()
  .superRefine((value, context) => {
    for (const key of ['operationId', 'documentId', 'expectedRevision'] as const) if (value[key] !== value.command[key])
      context.addIssue({ code: 'custom', message: `ENVELOPE_${key}` });
    if (value.command.kind === 'motion.claim.acquire' && value.command.payload.scope === 'branch'
      && value.command.payload.branchId !== value.branchId) context.addIssue({ code: 'custom', message: 'ENVELOPE_branchId' });
  });

export type MotionCommand = z.infer<typeof commandSchema>;
export type TrackCreateCommand = MotionCommand & { command: z.infer<typeof trackCreate> };
export type TrajectoryCommand = MotionCommand & { command: TrajectoryAuthoringOperation };
export type ClaimAcquireCommand = MotionCommand & { command: z.infer<typeof claimAcquire> };
export type ProtocolErrorCode = 'VALIDATION' | 'STALE_REVISION' | 'UNAUTHORIZED_CLAIM' | 'OPERATION_ID_CONFLICT'
  | 'UNSUPPORTED_VERSION' | 'STORAGE_FAILURE';
export type RevisionReceipt = { schemaVersion: 'motion.revision-receipt.v1'; protocolVersion: typeof PROTOCOL_VERSION;
  documentId: string; branchId: string; expectedRevision: number; resultingRevision: number; operationDigest: string;
  canonicalDigest: string; inventory: { ruleCount: number; applicationCount: number; slotCount: number; trackCount: number } };
export type ControlReceipt = { schemaVersion: 'motion.control-receipt.v1'; protocolVersion: typeof PROTOCOL_VERSION;
  kind: Exclude<MotionCommand['command']['kind'], 'motion.track.create' | TrajectoryAuthoringOperation['kind'] | 'motion.history.undo' | 'motion.history.redo'>; documentId: string; branchId: string;
  expectedRevision: number; resultingRevision: number; operationDigest: string; claimId?: string; leaseVersion?: number };
export type CommandSuccess = { ok: true; protocolVersion: typeof PROTOCOL_VERSION; operationId: string; documentId: string;
  branchId: string; expectedRevision: number; resultingRevision: number; operationDigest: string; canonicalDigest?: string;
  claimId?: string; leaseVersion?: number; expiresAt?: number; receipt: RevisionReceipt | ControlReceipt };
export type CommandFailure = { ok: false; code: ProtocolErrorCode; currentRevision?: number; currentDigest?: string };
export type CommandResponse = CommandSuccess | CommandFailure;
export type ImmutableRevision = { document: MotionDocument; canonicalDigest: string };
export type DocumentRevision = { revision: number; canonicalDigest: string };
export type CommitMetadata = { documentId: string; branchId: string; revision: number; digest: string;
  kind: MotionCommand['command']['kind']; commitSeq: number };
export type EventSubscription = { close(): void; readonly closed: boolean };

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const claimId = z.string().regex(/^claim_[a-f0-9]{24}$/);
const responseIdentity = { ok: z.literal(true), protocolVersion: z.literal(PROTOCOL_VERSION), operationId,
  documentId: z.string().min(1), branchId, expectedRevision: revision, resultingRevision: revision,
  operationDigest: digest } as const;
const receiptIdentity = { protocolVersion: z.literal(PROTOCOL_VERSION), documentId: z.string().min(1), branchId,
  expectedRevision: revision, resultingRevision: revision, operationDigest: digest } as const;
const revisionReceiptSchema = z.object({ schemaVersion: z.literal('motion.revision-receipt.v1'), ...receiptIdentity,
  canonicalDigest: digest, inventory: z.object({ ruleCount: revision, applicationCount: revision, slotCount: revision,
    trackCount: revision }).strict() }).strict();
const branchReceiptSchema = z.object({ schemaVersion: z.literal('motion.control-receipt.v1'), ...receiptIdentity,
  kind: z.literal('motion.branch.create') }).strict();
const claimReceiptSchema = (kind: 'motion.claim.acquire' | 'motion.claim.renew' | 'motion.claim.release' | 'motion.claim.revoke') =>
  z.object({ schemaVersion: z.literal('motion.control-receipt.v1'), ...receiptIdentity, kind: z.literal(kind),
    claimId, leaseVersion: z.number().int().positive().safe() }).strict();
const revisionSuccessSchema = z.object({ ...responseIdentity, canonicalDigest: digest, receipt: revisionReceiptSchema }).strict();
const branchSuccessSchema = z.object({ ...responseIdentity, receipt: branchReceiptSchema }).strict();
const claimSuccessSchema = (kind: 'motion.claim.acquire' | 'motion.claim.renew' | 'motion.claim.release' | 'motion.claim.revoke',
  expires: boolean) => z.object({ ...responseIdentity, claimId, leaseVersion: z.number().int().positive().safe(),
    ...(expires ? { expiresAt: z.number().safe() } : {}), receipt: claimReceiptSchema(kind) }).strict();
const successSchema = z.union([revisionSuccessSchema, branchSuccessSchema,
  claimSuccessSchema('motion.claim.acquire', true), claimSuccessSchema('motion.claim.renew', true),
  claimSuccessSchema('motion.claim.release', false), claimSuccessSchema('motion.claim.revoke', false)])
  .superRefine((value, context) => {
    for (const key of ['protocolVersion', 'documentId', 'branchId', 'expectedRevision', 'resultingRevision', 'operationDigest'] as const)
      if (value[key] !== value.receipt[key]) context.addIssue({ code: 'custom', message: `RECEIPT_${key}` });
    if ('canonicalDigest' in value && value.canonicalDigest !== value.receipt.canonicalDigest)
      context.addIssue({ code: 'custom', message: 'RECEIPT_canonicalDigest' });
    if ('claimId' in value && (value.claimId !== value.receipt.claimId || value.leaseVersion !== value.receipt.leaseVersion))
      context.addIssue({ code: 'custom', message: 'RECEIPT_claim' });
  });
const failureCode = z.enum(['VALIDATION', 'STALE_REVISION', 'UNAUTHORIZED_CLAIM', 'OPERATION_ID_CONFLICT',
  'UNSUPPORTED_VERSION', 'STORAGE_FAILURE']);
const responseSchema = z.union([
  z.object({ ok: z.literal(false), code: z.literal('STALE_REVISION'), currentRevision: revision, currentDigest: digest }).strict(),
  z.object({ ok: z.literal(false), code: failureCode.exclude(['STALE_REVISION']) }).strict(), successSchema,
]);
const immutableRevisionSchema = z.object({ document: z.custom<MotionDocument>((value) => validateMotionDocument(value).ok),
  canonicalDigest: digest }).strict().superRefine((value, context) => { if (sha256Hex(canonicalBytes(value.document)) !== value.canonicalDigest)
    context.addIssue({ code: 'custom', message: 'REVISION_DIGEST' }); });
const commitMetadataSchema = z.object({ documentId: z.string(), branchId, revision, digest,
  kind: z.enum(['motion.track.create', 'motion.transform-pose.set', 'motion.transform-waypoints.translate', 'motion.keyframe-group-time.set', 'motion.keyframe-group-easing.set', 'motion.settled-hold.set', 'motion.history.undo', 'motion.history.redo', 'motion.branch.create', 'motion.claim.acquire', 'motion.claim.renew',
    'motion.claim.release', 'motion.claim.revoke']), commitSeq: z.number().int().positive() }).strict();

export function parseCommand(input: unknown): { ok: true; command: MotionCommand } | { ok: false; code: ProtocolErrorCode } {
  if (typeof input === 'object' && input !== null && 'protocolVersion' in input
    && (input as { protocolVersion?: unknown }).protocolVersion !== PROTOCOL_VERSION) return { ok: false, code: 'UNSUPPORTED_VERSION' };
  const parsed = commandSchema.safeParse(input); return parsed.success ? { ok: true, command: parsed.data } : { ok: false, code: 'VALIDATION' };
}
export const canonicalResponseBytes = (response: CommandResponse): string => canonicalJson(response);
export function parseCommandResponse(input: unknown): CommandResponse { const parsed = responseSchema.safeParse(input);
  if (!parsed.success) throw new Error('PROTOCOL_RESPONSE_INVALID'); return parsed.data as CommandResponse; }
export function parseImmutableRevision(input: unknown): ImmutableRevision { const parsed = immutableRevisionSchema.safeParse(input);
  if (!parsed.success) throw new Error('PROTOCOL_REVISION_INVALID'); return parsed.data; }
export function parseCommitMetadata(input: unknown): CommitMetadata { const parsed = commitMetadataSchema.safeParse(input);
  if (!parsed.success) throw new Error('PROTOCOL_EVENT_INVALID'); return parsed.data; }

export class MotionServiceClient {
  constructor(readonly baseUrl: string, private readonly request: typeof fetch = (...args) => fetch(...args),
    private readonly auth: RequestAuth = testOnlyDefaultAuth()) {
    if (!/^[A-Za-z0-9_-]{43,}$/.test(auth.capability) && !isVitest()) throw new Error('CLIENT_CAPABILITY_REQUIRED');
  }
  async dispatch(command: MotionCommand, claimSecret?: string): Promise<CommandResponse> {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...this.authHeaders() };
    const secret = claimSecret ?? this.auth.claimSecret; if (secret) headers['x-motion-claim-secret'] = secret;
    const response = await this.request(`${this.baseUrl}/api/v1/commands`, { method: 'POST', headers, body: canonicalJson(command) });
    return parseCommandResponse(await response.json());
  }
  async head(documentId: string, branch: string = MAIN_BRANCH_ID): Promise<ImmutableRevision> { const response = await this.request(
    `${this.baseUrl}/api/v1/documents/${encodeURIComponent(documentId)}/branches/${encodeURIComponent(branch)}/head`,
    { headers: this.authHeaders() });
    if (!response.ok) throw new Error('SERVICE_HEAD_FAILED'); return parseImmutableRevision(await response.json()); }
  async revision(documentId: string, value: number): Promise<ImmutableRevision> { const response = await this.request(
    `${this.baseUrl}/api/v1/documents/${encodeURIComponent(documentId)}/revisions/${value}`, { headers: this.authHeaders() });
    if (!response.ok) throw new Error('SERVICE_REVISION_FAILED'); return parseImmutableRevision(await response.json()); }
  async documentRevision(documentId: string): Promise<DocumentRevision> { const response = await this.request(
    `${this.baseUrl}/api/v1/documents/${encodeURIComponent(documentId)}/revision`, { headers: this.authHeaders() });
    if (!response.ok) throw new Error('SERVICE_DOCUMENT_REVISION_FAILED');
    const parsed = z.object({ revision, canonicalDigest: digest }).strict().safeParse(await response.json());
    if (!parsed.success) throw new Error('PROTOCOL_DOCUMENT_REVISION_INVALID'); return parsed.data; }
  events(documentId: string, afterCommitSeq: number, onCommit: (event: CommitMetadata) => void,
    onDisconnect?: (error: unknown) => void): EventSubscription {
    const controller = new AbortController(); let closed = false;
    void this.readEventStream(documentId, afterCommitSeq, onCommit, controller.signal).catch((error) => {
      if (!closed && !controller.signal.aborted) onDisconnect?.(error);
    });
    return { close: () => { closed = true; controller.abort(); }, get closed() { return closed; } };
  }
  private authHeaders(): Record<string, string> { return { authorization: `Bearer ${this.auth.capability}`,
    'x-motion-actor': this.auth.actor }; }
  private async readEventStream(documentId: string, afterCommitSeq: number, onCommit: (event: CommitMetadata) => void,
    signal: AbortSignal): Promise<void> {
    const response = await this.request(`${this.baseUrl}/api/v1/documents/${encodeURIComponent(documentId)}/events`, {
      headers: { ...this.authHeaders(), 'last-event-id': String(afterCommitSeq) }, signal });
    if (!response.ok || !response.body) throw new Error('SERVICE_EVENTS_FAILED');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let cursor = afterCommitSeq;
    while (!signal.aborted) {
      const next = await reader.read(); if (next.done) throw new Error('SERVICE_EVENTS_DISCONNECTED');
      buffer += decoder.decode(next.value, { stream: true }).replace(/\r\n/g, '\n');
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const data = frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n');
        if (data) { const event = parseCommitMetadata(JSON.parse(data)); if (event.commitSeq > cursor) {
          cursor = event.commitSeq; onCommit(event); } }
      }
    }
  }
}

function isVitest(): boolean { return typeof process !== 'undefined' && Boolean(process.env.VITEST); }
function testOnlyDefaultAuth(): RequestAuth {
  if (!isVitest()) throw new Error('CLIENT_CAPABILITY_REQUIRED');
  return { actor: 'human', capability: 'human-editor' };
}

function envelope(operation: MotionCommand['command'], branch: string): MotionCommand { return commandSchema.parse({
  protocolVersion: PROTOCOL_VERSION, operationId: operation.operationId, documentId: operation.documentId,
  branchId: branch, expectedRevision: operation.expectedRevision, command: operation }); }
export function makeTrackCreateCommand(input: { operationId: string; documentId: string; expectedRevision: number;
  branchId?: string; elementId: 'el_a2849ff826f3e167' | 'el_2dbee68b1ea318c8' }): TrackCreateCommand {
  return envelope({ schemaVersion: 'motion.operation.v1', kind: 'motion.track.create', operationId: input.operationId,
    documentId: input.documentId, expectedRevision: input.expectedRevision, elementId: input.elementId,
    payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 } }, input.branchId ?? MAIN_BRANCH_ID) as TrackCreateCommand; }
export function makeTrajectoryCommand(operation: TrajectoryAuthoringOperation | HistoryOperation, branchIdValue: string = MAIN_BRANCH_ID): MotionCommand {
  return envelope(operation as MotionCommand['command'], branchIdValue);
}
export function makeBranchCreateCommand(input: { operationId: string; documentId: string; sourceBranchId?: string;
  expectedRevision: number; branchId: string }): MotionCommand { return envelope({ schemaVersion: 'motion.control.v1',
    kind: 'motion.branch.create', operationId: input.operationId, documentId: input.documentId,
    expectedRevision: input.expectedRevision, payload: { branchId: input.branchId } }, input.sourceBranchId ?? MAIN_BRANCH_ID); }
export function makeClaimAcquireCommand(input: { operationId: string; documentId: string; branchId?: string;
  expectedRevision: number; scope: 'document' | 'branch' }): ClaimAcquireCommand { const branch = input.branchId ?? MAIN_BRANCH_ID;
  return envelope({ schemaVersion: 'motion.control.v1', kind: 'motion.claim.acquire', operationId: input.operationId,
    documentId: input.documentId, expectedRevision: input.expectedRevision,
    payload: input.scope === 'document' ? { scope: 'document' } : { scope: 'branch', branchId: branch } }, branch) as ClaimAcquireCommand; }
export function makeClaimControlCommand(input: { kind: 'motion.claim.renew' | 'motion.claim.release' | 'motion.claim.revoke';
  operationId: string; documentId: string; branchId?: string; expectedRevision: number; claimId: string;
  leaseVersion: number }): MotionCommand { return envelope({ schemaVersion: 'motion.control.v1', kind: input.kind,
    operationId: input.operationId, documentId: input.documentId, expectedRevision: input.expectedRevision,
    payload: { claimId: input.claimId, leaseVersion: input.leaseVersion } }, input.branchId ?? MAIN_BRANCH_ID); }
