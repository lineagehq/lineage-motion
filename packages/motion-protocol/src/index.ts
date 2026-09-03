import { z } from 'zod';

export * from './review.ts';

import { canonicalBytes, canonicalJson, isValidAuthoringOperationId, sha256Hex, validateMotionDocument,
  DURABLE_OPERATION_KINDS, type CueAuthoringOperation, type HistoryOperation,
  type MotionDocument, type OperationPreparation, type OperationPreparationRequest, type PreparedOperationIntent,
  type TrajectoryAuthoringOperation, type WorkspaceProjection } from '../../domain/src/index.ts';

export const PROTOCOL_VERSION = 'motion.protocol.v1' as const;
export const MAIN_BRANCH_ID = 'main' as const;
export type ActorKind = 'human' | 'agent';
export type RequestAuth = { actor: ActorKind; capability: string; claimSecret?: string };

const operationId = z.string().refine(isValidAuthoringOperationId);
const branchId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const stableId = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const revision = z.number().int().nonnegative().safe();
const trackCreate = z.object({ schemaVersion: z.literal('motion.operation.v1'), kind: z.literal('motion.track.create'),
  operationId, documentId: z.string().min(1), expectedRevision: revision,
  elementId: z.enum(['el_a2849ff826f3e167', 'el_2dbee68b1ea318c8']),
  payload: z.object({ property: z.literal('opacity'), durationMs: z.literal(1000), delayMs: z.literal(610),
    easing: z.literal('linear'), startValue: z.literal(0), endValue: z.literal(1) }).strict() }).strict();
const target = z.object({ elementId: z.string().min(1), trackId: z.string().min(1), keyframeId: z.string().min(1), expectedTransform: z.string().min(1) }).strict();
const insertionTarget = z.object({ elementId: z.string().min(1), trackId: z.string().min(1),
  beforeKeyframeId: z.string().min(1), afterKeyframeId: z.string().min(1), expectedBeforeTransform: z.string().min(1),
  expectedAfterTransform: z.string().min(1) }).strict();
const insertionTargets = z.array(insertionTarget).min(1).superRefine((value, context) => {
  const keys = value.map((item) => `${item.elementId}\0${item.trackId}`);
  if (new Set(keys).size !== keys.length || keys.some((key, index) => index > 0 && key <= keys[index - 1]!)) {
    context.addIssue({ code: 'custom', message: 'INSERTION_TARGET_ORDER' });
  }
});
const targets = z.array(target).min(1).superRefine((value, context) => { const keys = value.map((item) => `${item.elementId}\0${item.trackId}\0${item.keyframeId}`);
  if (new Set(keys).size !== keys.length || keys.some((key, index) => index > 0 && key <= keys[index - 1]!)) context.addIssue({ code: 'custom', message: 'TARGET_ORDER' }); });
const stage = z.object({ stageDigest: z.string().regex(/^[a-f0-9]{64}$/), widthMicrounits: z.number().int().positive().safe(), heightMicrounits: z.number().int().positive().safe() }).strict();
const pose = z.object({ translateXMicrounits: z.number().int().safe(), translateYMicrounits: z.number().int().safe(), scalePpm: z.number().int().positive().max(10_000_000), rotateMicrodegrees: z.number().int().safe() }).strict();
const timing = z.discriminatedUnion('kind', [z.object({ kind: z.literal('keyword'), value: z.enum(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']) }).strict(),
  z.object({ kind: z.literal('steps'), count: z.number().int().positive(),
    position: z.enum(['start', 'end', 'jump-start', 'jump-end', 'jump-none', 'jump-both']) }).strict(),
  z.object({ kind: z.literal('cubic-bezier'), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }).strict()]);
const authorBase = { schemaVersion: z.literal('motion.operation.v1'), operationId, documentId: z.string().min(1), expectedRevision: revision } as const;
const structuralElementId = z.enum(['el_a2849ff826f3e167', 'el_2dbee68b1ea318c8']);
const editTarget = { elementId: z.string().min(1), trackId: z.string().min(1), keyframeId: z.string().min(1) } as const;
const keyframeValue = z.object({ ...authorBase, kind: z.literal('motion.keyframe-value.set'), ...editTarget,
  payload: z.object({ value: z.number().finite() }).strict() }).strict();
const keyframeTime = z.object({ ...authorBase, kind: z.literal('motion.keyframe-time.set'), ...editTarget,
  payload: z.object({ timeMs: revision }).strict() }).strict();
const keyframeAdd = z.object({ ...authorBase, kind: z.literal('motion.keyframe.add'), elementId: structuralElementId,
  trackId: z.string().min(1), payload: z.object({ timeMs: revision, value: z.number().finite() }).strict() }).strict();
const keyframeRemove = z.object({ ...authorBase, kind: z.literal('motion.keyframe.remove'), elementId: structuralElementId,
  trackId: z.string().min(1), keyframeId: z.string().min(1) }).strict();
const slotDuration = z.object({ ...authorBase, kind: z.literal('motion.slot-duration.set'), elementId: structuralElementId,
  trackId: z.string().min(1), payload: z.object({ durationMs: revision }).strict() }).strict();
const bindingDelay = z.object({ ...authorBase, kind: z.literal('motion.binding-delay.set'), elementId: structuralElementId,
  trackId: z.string().min(1), payload: z.object({ delayMs: z.number().int().safe() }).strict() }).strict();
const slotEasing = z.object({ ...authorBase, kind: z.literal('motion.slot-easing.set'), elementId: structuralElementId,
  trackId: z.string().min(1), payload: z.object({ easing: z.enum(['linear', 'ease-in-out']) }).strict() }).strict();
const holdInsert = z.object({ ...authorBase, kind: z.literal('motion.hold.insert'),
  payload: z.object({ cueId: z.literal('cue_pair'), durationMs: z.literal(600) }).strict() }).strict();
const poseSet = z.object({ ...authorBase, kind: z.literal('motion.transform-pose.set'), ...target.shape, payload: z.object({ pose, stage }).strict() }).strict();
const waypointTranslate = z.object({ ...authorBase, kind: z.literal('motion.transform-waypoints.translate'), payload: z.object({ targets, deltaXPpm: z.number().int().min(-1_000_000).max(1_000_000), deltaYPpm: z.number().int().min(-1_000_000).max(1_000_000), stage }).strict() }).strict();
const waypointAdd = z.object({ ...authorBase, kind: z.literal('motion.transform-waypoint.add'), payload: z.object({
  targets: insertionTargets, timeMs: revision }).strict() }).strict();
const waypointRemove = z.object({ ...authorBase, kind: z.literal('motion.transform-waypoint.remove'), payload: z.object({
  targets, timeMs: revision }).strict() }).strict();
const groupTime = z.object({ ...authorBase, kind: z.literal('motion.keyframe-group-time.set'), payload: z.object({ targets, sourceTimeMs: z.number().int().min(0).max(2100), targetTimeMs: z.number().int().min(1).max(2100), landingTimeMs: z.number().int().min(1).max(2099), settledTimeMs: z.number().int().min(2).max(2100) }).strict() }).strict();
const groupEasing = z.object({ ...authorBase, kind: z.literal('motion.keyframe-group-easing.set'), payload: z.object({ targets, expectedEasing: timing, easing: timing }).strict() }).strict();
const settledHold = z.object({ ...authorBase, kind: z.literal('motion.settled-hold.set'), payload: z.object({ targets, sourceTimeMs: z.number().int().min(1).max(2100), settledTimeMs: z.number().int().min(2).max(2099), landingTimeMs: z.number().int().min(1).max(2098), boundaryTimeMs: z.literal(2100) }).strict() }).strict();
const history = z.object({ ...authorBase, kind: z.enum(['motion.history.undo', 'motion.history.redo']) }).strict();
const cueSnapshot = z.object({ role: z.string().min(1), ordinal: z.number().int().nonnegative(), elementId: z.string().min(1),
  structuralFingerprint: z.string().min(1), contentKind: z.literal('text').optional() }).strict();
const cursorSemantic = z.object({ kind: z.literal('cursor-path'), cursorTargetId: z.string().min(1), startMs: revision,
  arriveMs: revision, easing: timing, waypoints: z.array(z.object({ timeMs: revision, xPpm: z.number().int().safe(),
    yPpm: z.number().int().safe() }).strict()).min(2) }).strict().superRefine((value, context) => {
      if (value.arriveMs <= value.startMs || value.waypoints[0]?.timeMs !== value.startMs
        || value.waypoints.at(-1)?.timeMs !== value.arriveMs
        || value.waypoints.some((point, index) => index > 0 && point.timeMs <= value.waypoints[index - 1]!.timeMs)) {
        context.addIssue({ code: 'custom', message: 'CUE_MOMENT_ORDER' });
      }
    });
const clickSemantic = z.object({ kind: z.literal('click'), cursorTargetId: z.string().min(1), pulseTargetId: z.string().min(1),
  arriveMs: revision, pressMs: revision, releaseMs: revision, pulseEndMs: revision,
  pressScalePpm: z.number().int().positive().safe(), pulseRadiusPpm: z.number().int().positive().safe(),
  pulseOpacityPpm: z.number().int().positive().max(1_000_000), revealCueId: z.string().regex(/^cue_[a-f0-9]{24}$/).optional() }).strict()
  .superRefine((value, context) => { if (!(value.arriveMs < value.pressMs && value.pressMs < value.releaseMs
    && value.releaseMs < value.pulseEndMs)) context.addIssue({ code: 'custom', message: 'CUE_MOMENT_ORDER' }); });
const revealSemantic = z.object({ kind: z.literal('reveal'), targetIds: z.array(z.string().min(1)).min(1),
  startMs: revision, completeMs: revision }).strict().superRefine((value, context) => {
    if (value.completeMs <= value.startMs || new Set(value.targetIds).size !== value.targetIds.length) {
      context.addIssue({ code: 'custom', message: 'CUE_REVEAL_INVALID' });
    }
  });
const typeSemantic = z.object({ kind: z.literal('type'), targetId: z.string().min(1), startMs: revision,
  completeMs: revision, stepCount: z.number().int().positive().safe() }).strict().superRefine((value, context) => {
    if (value.completeMs <= value.startMs) context.addIssue({ code: 'custom', message: 'CUE_MOMENT_ORDER' });
  });
const selectSemantic = z.object({ kind: z.literal('select'), cursorTargetId: z.string().min(1),
  selectedTargetId: z.string().min(1), highlightTargetId: z.string().min(1).optional(), approachMs: revision,
  chooseMs: revision, settleMs: revision }).strict().superRefine((value, context) => {
    if (!(value.approachMs < value.chooseMs && value.chooseMs < value.settleMs)) {
      context.addIssue({ code: 'custom', message: 'CUE_MOMENT_ORDER' });
    }
  });
const dragSemantic = z.object({ kind: z.literal('drag'), cursorTargetId: z.string().min(1), draggedTargetId: z.string().min(1),
  approachMs: revision, pressMs: revision, moveStartMs: revision, arriveMs: revision, releaseMs: revision,
  grabOffsetXPpm: z.number().int().safe(), grabOffsetYPpm: z.number().int().safe(), waypoints: z.array(z.object({
    timeMs: revision, xPpm: z.number().int().safe(), yPpm: z.number().int().safe() }).strict()).min(2) }).strict()
  .superRefine((value, context) => {
    if (!(value.approachMs < value.pressMs && value.pressMs <= value.moveStartMs && value.moveStartMs < value.arriveMs
      && value.arriveMs < value.releaseMs) || value.waypoints[0]?.timeMs !== value.moveStartMs
      || value.waypoints.at(-1)?.timeMs !== value.arriveMs
      || value.waypoints.some((point, index) => index > 0 && point.timeMs <= value.waypoints[index - 1]!.timeMs)) {
      context.addIssue({ code: 'custom', message: 'CUE_MOMENT_ORDER' });
    }
  });
const holdSemantic = z.object({ kind: z.literal('hold'), targetIds: z.array(z.string().min(1)).min(1), enterMs: revision,
  durationMs: z.number().int().positive().safe(), exitMs: revision }).strict().superRefine((value, context) => {
    if (value.exitMs !== value.enterMs + value.durationMs || new Set(value.targetIds).size !== value.targetIds.length) {
      context.addIssue({ code: 'custom', message: 'CUE_HOLD_INVALID' });
    }
  });
const cueSemantic = z.discriminatedUnion('kind', [cursorSemantic, clickSemantic, revealSemantic, typeSemantic,
  selectSemantic, dragSemantic, holdSemantic]);
const sanitizedCueSemantic = cueSemantic.superRefine((value, context) => {
  const ids = value.kind === 'reveal' || value.kind === 'hold' ? value.targetIds
    : value.kind === 'type' ? [value.targetId]
      : value.kind === 'cursor-path' ? [value.cursorTargetId]
        : value.kind === 'click' ? [value.cursorTargetId, value.pulseTargetId]
          : value.kind === 'select' ? [value.cursorTargetId, value.selectedTargetId,
            ...(value.highlightTargetId ? [value.highlightTargetId] : [])]
            : [value.cursorTargetId, value.draggedTargetId];
  if (ids.some((id) => !stableId.safeParse(id).success)) context.addIssue({ code: 'custom', message: 'STABLE_ID' });
});
const cueId = z.string().regex(/^cue_[a-f0-9]{24}$/); const digestOrNull = z.string().regex(/^[a-f0-9]{64}$/).nullable();
const cueCreate = z.object({ ...authorBase, kind: z.literal('motion.cue.create'), payload: z.object({ cueId,
  semantic: cueSemantic, targetSnapshots: z.array(cueSnapshot).min(1), replacementTrackIds: z.array(z.string().min(1)),
  replacementInputDigest: digestOrNull }).strict() }).strict();
const cueUpdate = z.object({ ...authorBase, kind: z.literal('motion.cue.update'), payload: z.object({ cueId,
  expectedExpansionDigest: z.string().regex(/^[a-f0-9]{64}$/), semantic: cueSemantic,
  targetSnapshots: z.array(cueSnapshot).min(1) }).strict() }).strict();
const cueTerminal = (kind: 'motion.cue.delete' | 'motion.cue.detach') => z.object({ ...authorBase, kind: z.literal(kind),
  payload: z.object({ cueId, expectedExpansionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    expectedReplacementInputDigest: digestOrNull }).strict() }).strict();
const viewportIntent = z.object({ widthCssPixels: z.number().positive().safe(),
  heightCssPixels: z.number().positive().safe() }).strict();
const intentPayload = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('motion.transform-pose.set'), elementId: stableId, momentMs: revision,
    pose, viewport: viewportIntent }).strict(),
  z.object({ kind: z.literal('motion.transform-waypoints.translate'), elementIds: z.array(stableId).min(1),
    momentMs: revision, deltaXPpm: z.number().int().min(-1_000_000).max(1_000_000),
    deltaYPpm: z.number().int().min(-1_000_000).max(1_000_000), viewport: viewportIntent }).strict(),
  z.object({ kind: z.literal('motion.transform-waypoint.add'), elementIds: z.array(stableId).min(1),
    timeMs: revision }).strict(),
  z.object({ kind: z.literal('motion.transform-waypoint.remove'), elementIds: z.array(stableId).min(1),
    timeMs: revision }).strict(),
  z.object({ kind: z.literal('motion.keyframe-group-time.set'), elementIds: z.array(stableId).min(1),
    sourceTimeMs: revision, targetTimeMs: revision, landingTimeMs: revision, settledTimeMs: revision }).strict(),
  z.object({ kind: z.literal('motion.keyframe-group-easing.set'), elementIds: z.array(stableId).min(1),
    momentMs: revision, expectedEasing: timing, easing: timing }).strict(),
  z.object({ kind: z.literal('motion.settled-hold.set'), elementIds: z.array(stableId).min(1),
    sourceTimeMs: revision, settledTimeMs: revision, landingTimeMs: revision, boundaryTimeMs: z.literal(2100) }).strict(),
  z.object({ kind: z.literal('motion.cue.create'), creationKey: z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/),
    semantic: sanitizedCueSemantic }).strict(),
  z.object({ kind: z.literal('motion.cue.update'), cueId, semantic: sanitizedCueSemantic }).strict(),
  z.object({ kind: z.literal('motion.cue.delete'), cueId }).strict(),
  z.object({ kind: z.literal('motion.cue.detach'), cueId }).strict(),
]);
const operationIntentSchema = z.object({ schemaVersion: z.literal('motion.operation-intent.v1'), operationId,
  documentId: stableId, expectedRevision: revision,
  kind: z.enum(['motion.transform-pose.set', 'motion.transform-waypoints.translate', 'motion.keyframe-group-time.set',
    'motion.transform-waypoint.add', 'motion.transform-waypoint.remove', 'motion.keyframe-group-easing.set',
    'motion.settled-hold.set', 'motion.cue.create', 'motion.cue.update',
    'motion.cue.delete', 'motion.cue.detach']), derivationDigest: z.string().regex(/^[a-f0-9]{64}$/),
  intent: intentPayload }).strict().superRefine((value, context) => {
    if (value.kind !== value.intent.kind) context.addIssue({ code: 'custom', message: 'INTENT_KIND' });
  });
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
export const operationSchema = z.discriminatedUnion('kind', [trackCreate, keyframeValue, keyframeTime, keyframeAdd,
  keyframeRemove, slotDuration, bindingDelay, slotEasing, holdInsert, poseSet, waypointTranslate, groupTime, groupEasing, settledHold,
  waypointAdd, waypointRemove,
  cueCreate, cueUpdate, cueTerminal('motion.cue.delete'), cueTerminal('motion.cue.detach'), history, branchCreate, claimAcquire,
  leaseControl('motion.claim.renew'), leaseControl('motion.claim.release'), leaseControl('motion.claim.revoke')]);
export const commandSchema = z.object({ protocolVersion: z.literal(PROTOCOL_VERSION), operationId,
  documentId: stableId, branchId, expectedRevision: revision,
  command: z.union([operationSchema, operationIntentSchema]) }).strict()
  .superRefine((value, context) => {
    for (const key of ['operationId', 'documentId', 'expectedRevision'] as const) if (value[key] !== value.command[key])
      context.addIssue({ code: 'custom', message: `ENVELOPE_${key}` });
    if (value.command.kind === 'motion.claim.acquire' && value.command.payload.scope === 'branch'
      && value.command.payload.branchId !== value.branchId) context.addIssue({ code: 'custom', message: 'ENVELOPE_branchId' });
  });

export type MotionCommand = z.infer<typeof commandSchema>;
export type OperationIntentCommand = MotionCommand & { command: PreparedOperationIntent };
export type TrackCreateCommand = MotionCommand & { command: z.infer<typeof trackCreate> };
export type TrajectoryCommand = MotionCommand & { command: TrajectoryAuthoringOperation };
export type CueCommand = MotionCommand & { command: CueAuthoringOperation };
export type ClaimAcquireCommand = MotionCommand & { command: z.infer<typeof claimAcquire> };
export type ProtocolErrorCode = 'VALIDATION' | 'STALE_REVISION' | 'UNAUTHORIZED_CLAIM' | 'OPERATION_ID_CONFLICT'
  | 'UNSUPPORTED_VERSION' | 'STORAGE_FAILURE';
export type MotionDiagnostic = { schemaVersion: 'motion.diagnostic.v1'; code: string;
  category: 'protocol' | 'target' | 'revision' | 'authorization' | 'domain' | 'storage'; retryable: boolean;
  fieldPath?: string; affectedIds?: string[]; currentRevision?: number; currentDigest?: string };
export type RevisionReceipt = { schemaVersion: 'motion.revision-receipt.v1'; protocolVersion: typeof PROTOCOL_VERSION;
  documentId: string; branchId: string; expectedRevision: number; resultingRevision: number; operationDigest: string;
  canonicalDigest: string; inventory: { ruleCount: number; applicationCount: number; slotCount: number; trackCount: number } };
export type ControlReceipt = { schemaVersion: 'motion.control-receipt.v1'; protocolVersion: typeof PROTOCOL_VERSION;
  kind: 'motion.branch.create' | 'motion.claim.acquire' | 'motion.claim.renew' | 'motion.claim.release' | 'motion.claim.revoke';
  documentId: string; branchId: string;
  expectedRevision: number; resultingRevision: number; operationDigest: string; claimId?: string; leaseVersion?: number };
export type CommandSuccess = { ok: true; protocolVersion: typeof PROTOCOL_VERSION; operationId: string; documentId: string;
  branchId: string; expectedRevision: number; resultingRevision: number; operationDigest: string; canonicalDigest?: string;
  claimId?: string; leaseVersion?: number; expiresAt?: number; receipt: RevisionReceipt | ControlReceipt };
export type CommandFailure = { ok: false; code: ProtocolErrorCode; diagnostic: MotionDiagnostic;
  currentRevision?: number; currentDigest?: string };
export type CommandResponse = CommandSuccess | CommandFailure;
export type ImmutableRevision = { document: MotionDocument; canonicalDigest: string };
export type DocumentRevision = { revision: number; canonicalDigest: string };
export type CommitMetadata = { documentId: string; branchId: string; revision: number; digest: string;
  kind: MotionCommand['command']['kind']; commitSeq: number; operationDigest?: string;
  actor?: { kind: ActorKind | 'legacy-unknown'; actorId: string | null }; affectedIds?: string[] };
export type BranchList = { schemaVersion: 'motion.branch-list.v1'; documentId: string; branches: Array<{
  branchId: string; baseRevision: number; headRevision: number; headDigest: string }> };
export type ActiveClaimList = { schemaVersion: 'motion.active-claim-list.v1'; documentId: string; claims: Array<{
  claimId: string; scope: 'document' | 'branch'; branchId: string | null;
  holder: { kind: 'agent' | 'legacy-unknown'; actorId: string | null };
  leaseVersion: number; expiresAt: number }> };
export type ActivityPage = { schemaVersion: 'motion.activity-page.v1'; documentId: string; afterCommitSeq: number;
  events: CommitMetadata[]; nextAfterCommitSeq: number | null };
export type CommandValidation = { schemaVersion: 'motion.command-validation.v1'; valid: boolean;
  response: { ok: true } | CommandFailure };
export type ExportProof = { schemaVersion: 'motion.export-proof.v1'; documentId: string; branchId: string;
  revision: number; canonicalDigest: string; htmlDigest: string; cssDigest: string; exportDigest: string;
  reducedMotionDigest: string; counts: { ruleCount: number; applicationCount: number; slotCount: number; trackCount: number } };
export type EventSubscription = { close(): void; readonly closed: boolean };
export class MotionPreparationError extends Error {
  readonly name = 'MotionPreparationError';
  constructor(readonly response: CommandFailure) { super(`PREPARATION_FAILED:${response.diagnostic.code}`); }
}

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
const diagnosticSchema = z.object({ schemaVersion: z.literal('motion.diagnostic.v1'), code: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
  category: z.enum(['protocol', 'target', 'revision', 'authorization', 'domain', 'storage']), retryable: z.boolean(),
  fieldPath: z.string().regex(/^\$(?:\.[A-Za-z0-9_-]+|\[\d+\])*$/).optional(), affectedIds: z.array(z.string().min(1)).optional(),
  currentRevision: revision.optional(), currentDigest: digest.optional() }).strict();
const responseSchema = z.union([
  z.object({ ok: z.literal(false), code: z.literal('STALE_REVISION'), currentRevision: revision, currentDigest: digest,
    diagnostic: diagnosticSchema }).strict(),
  z.object({ ok: z.literal(false), code: failureCode.exclude(['STALE_REVISION']), diagnostic: diagnosticSchema }).strict(), successSchema,
]);
const immutableRevisionSchema = z.object({ document: z.custom<MotionDocument>((value) => validateMotionDocument(value).ok),
  canonicalDigest: digest }).strict().superRefine((value, context) => { if (sha256Hex(canonicalBytes(value.document)) !== value.canonicalDigest)
    context.addIssue({ code: 'custom', message: 'REVISION_DIGEST' }); });
const commitMetadataSchema = z.object({ documentId: z.string(), branchId, revision, digest,
  kind: z.enum(DURABLE_OPERATION_KINDS), commitSeq: z.number().int().positive(), operationDigest: digest.optional(),
  actor: z.object({ kind: z.enum(['human', 'agent', 'legacy-unknown']), actorId: z.string().regex(/^actor_[a-f0-9]{24}$/).nullable() }).strict().optional(),
  affectedIds: z.array(z.string().min(1)).optional() }).strict();
/* Historical v1 events intentionally parse without actor summaries. */
const legacyCommitMetadataSchema = z.object({ documentId: z.string(), branchId, revision, digest,
  kind: z.enum(['motion.track.create', 'motion.transform-pose.set', 'motion.transform-waypoints.translate', 'motion.keyframe-group-time.set', 'motion.keyframe-group-easing.set', 'motion.settled-hold.set',
    'motion.cue.create', 'motion.cue.update', 'motion.cue.delete', 'motion.cue.detach', 'motion.history.undo', 'motion.history.redo', 'motion.branch.create', 'motion.claim.acquire', 'motion.claim.renew',
    'motion.claim.release', 'motion.claim.revoke']), commitSeq: z.number().int().positive() }).strict();

export function parseCommand(input: unknown): { ok: true; command: MotionCommand } | { ok: false; code: ProtocolErrorCode } {
  if (typeof input === 'object' && input !== null && 'protocolVersion' in input
    && (input as { protocolVersion?: unknown }).protocolVersion !== PROTOCOL_VERSION) return { ok: false, code: 'UNSUPPORTED_VERSION' };
  const parsed = commandSchema.safeParse(input); return parsed.success ? { ok: true, command: parsed.data } : { ok: false, code: 'VALIDATION' };
}
export function parseCommandDetailed(input: unknown): { ok: true; command: MotionCommand } | { ok: false; response: CommandFailure } {
  if (typeof input === 'object' && input !== null && 'protocolVersion' in input
    && (input as { protocolVersion?: unknown }).protocolVersion !== PROTOCOL_VERSION) return { ok: false, response: {
      ok: false, code: 'UNSUPPORTED_VERSION', diagnostic: { schemaVersion: 'motion.diagnostic.v1',
        code: 'UNSUPPORTED_VERSION', category: 'protocol', retryable: false, fieldPath: '$.protocolVersion' } } };
  const parsed = commandSchema.safeParse(input); if (parsed.success) return { ok: true, command: parsed.data };
  const issue = parsed.error.issues[0]; const fieldPath = `$${issue?.path.map((part) => typeof part === 'number' ? `[${part}]` : `.${String(part)}`).join('') ?? ''}`;
  return { ok: false, response: { ok: false, code: 'VALIDATION', diagnostic: { schemaVersion: 'motion.diagnostic.v1',
    code: 'PROTOCOL_COMMAND_INVALID', category: 'protocol', retryable: false, fieldPath } } };
}
export const canonicalResponseBytes = (response: CommandResponse): string => canonicalJson(response);
export function parseCommandResponse(input: unknown): CommandResponse { const parsed = responseSchema.safeParse(input);
  if (!parsed.success) throw new Error('PROTOCOL_RESPONSE_INVALID'); return parsed.data as CommandResponse; }
export function parseImmutableRevision(input: unknown): ImmutableRevision { const parsed = immutableRevisionSchema.safeParse(input);
  if (!parsed.success) throw new Error('PROTOCOL_REVISION_INVALID'); return parsed.data; }
export function parseCommitMetadata(input: unknown): CommitMetadata { const parsed = commitMetadataSchema.safeParse(input);
  if (parsed.success) return parsed.data as CommitMetadata; const legacy = legacyCommitMetadataSchema.safeParse(input);
  if (!legacy.success) throw new Error('PROTOCOL_EVENT_INVALID'); return legacy.data as CommitMetadata; }
export function parseMotionDiagnostic(input: unknown): MotionDiagnostic { const parsed = diagnosticSchema.safeParse(input);
  if (!parsed.success) throw new Error('PROTOCOL_DIAGNOSTIC_INVALID'); return parsed.data as MotionDiagnostic; }

const writableValueSchema = z.union([z.object({ kind: z.literal('number'), value: z.number().finite() }).strict(),
  z.object({ kind: z.literal('transform'), value: z.string().min(1).max(512) }).strict()]);
const inventorySchema = z.object({ ruleCount: revision, applicationCount: revision, slotCount: revision, trackCount: revision,
  supportedCount: revision, unsupportedCount: revision, missingCount: revision, diagnosticCodes: z.array(z.string().min(1)) }).strict();
const workspaceSchema = z.object({ schemaVersion: z.literal('motion.workspace-projection.v1'), documentId: z.string().min(1),
  branchId, revision, canonicalDigest: digest, durationMs: revision, inventory: inventorySchema,
  elements: z.array(z.object({ elementId: z.string().min(1) }).strict()),
  tracks: z.array(z.object({ trackId: z.string().min(1), elementId: z.string().min(1), ruleId: z.string().min(1),
    slotId: z.string().min(1), property: z.string().min(1), interpolation: z.enum(['continuous', 'discrete', 'step']),
    cueId: z.string().nullable() }).strict()),
  rules: z.array(z.object({ ruleId: z.string().min(1), tracks: z.array(z.object({ ruleTrackId: z.string().min(1),
    property: z.string().min(1), interpolation: z.enum(['continuous', 'discrete', 'step']), keyframes: z.array(z.object({
      keyframeId: z.string().min(1), offset: z.number().min(0).max(1), value: writableValueSchema.nullable(),
      easing: timing.nullable(), timings: z.array(z.object({ slotId: z.string().min(1), elementId: z.string().min(1),
        timeMs: z.number().int().safe() }).strict()) }).strict()) }).strict()) }).strict()),
  slots: z.array(z.object({ slotId: z.string().min(1), ruleId: z.string().min(1), durationMs: revision,
    delayMs: z.number().int().safe(), timingFunction: timing, bindings: z.array(z.object({ elementId: z.string().min(1),
      delayMs: z.number().int().safe() }).strict()) }).strict()),
  cues: z.array(z.object({ cueId: z.string().min(1), timeMs: revision, semantic: cueSemantic.nullable(),
    expansionDigest: digest.nullable() }).strict()),
  holds: z.array(z.object({ holdId: z.string().min(1), cueId: z.string().min(1), sourceTimeMs: revision,
    durationMs: revision }).strict()), history: z.object({ undoAvailable: z.boolean(), redoAvailable: z.boolean() }).strict(),
  eligibility: z.array(z.object({ kind: z.enum(DURABLE_OPERATION_KINDS), eligible: z.boolean(),
    reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/).nullable() }).strict()).length(DURABLE_OPERATION_KINDS.length) }).strict();
const branchListSchema = z.object({ schemaVersion: z.literal('motion.branch-list.v1'), documentId: z.string().min(1),
  branches: z.array(z.object({ branchId, baseRevision: revision, headRevision: revision, headDigest: digest }).strict()) }).strict();
const activeClaimListSchema = z.object({ schemaVersion: z.literal('motion.active-claim-list.v1'), documentId: z.string().min(1),
  claims: z.array(z.object({ claimId, scope: z.enum(['document', 'branch']), branchId: branchId.nullable(), holder: z.object({
    kind: z.enum(['agent', 'legacy-unknown']), actorId: z.string().regex(/^actor_[a-f0-9]{24}$/).nullable() }).strict(),
    leaseVersion: z.number().int().positive().safe(), expiresAt: z.number().safe() }).strict().superRefine((value, context) => {
      if ((value.scope === 'document') !== (value.branchId === null) || (value.holder.kind === 'legacy-unknown') !== (value.holder.actorId === null))
        context.addIssue({ code: 'custom', message: 'CLAIM_RELATIONSHIP' });
    })) }).strict();
const activityPageSchema = z.object({ schemaVersion: z.literal('motion.activity-page.v1'), documentId: z.string().min(1),
  afterCommitSeq: revision, events: z.array(commitMetadataSchema.required({ operationDigest: true, actor: true, affectedIds: true })),
  nextAfterCommitSeq: z.number().int().positive().safe().nullable() }).strict();
const validationSchema = z.object({ schemaVersion: z.literal('motion.command-validation.v1'), valid: z.boolean(),
  response: z.union([z.object({ ok: z.literal(true) }).strict(), responseSchema.options[0]!, responseSchema.options[1]!]) }).strict()
  .superRefine((value, context) => { if (value.valid !== value.response.ok) context.addIssue({ code: 'custom', message: 'VALIDATION_RESULT' }); });
const exportProofSchema = z.object({ schemaVersion: z.literal('motion.export-proof.v1'), documentId: z.string().min(1), branchId,
  revision, canonicalDigest: digest, htmlDigest: digest, cssDigest: digest, exportDigest: digest, reducedMotionDigest: digest,
  counts: z.object({ ruleCount: revision, applicationCount: revision, slotCount: revision, trackCount: revision }).strict() }).strict();
const preparationRequestSchema = z.object({ schemaVersion: z.literal('motion.operation-preparation-request.v1'),
  documentId: z.string().min(1), branchId, expectedRevision: revision,
  kind: operationIntentSchema.shape.kind, intent: intentPayload }).strict().superRefine((value, context) => {
    if (value.kind !== value.intent.kind) context.addIssue({ code: 'custom', message: 'INTENT_KIND' });
  });
const preparationSchema = z.object({ schemaVersion: z.literal('motion.operation-preparation.v1'),
  documentId: stableId, branchId, revision, canonicalDigest: digest, exportDigest: digest,
  kind: operationIntentSchema.shape.kind, normalizedIntent: intentPayload.nullable(),
  resolvedElementIds: z.array(z.string().min(1)), resolvedTrackIds: z.array(z.string().min(1)),
  resolvedKeyframeIds: z.array(z.string().min(1)), resolvedCueId: cueId.nullable(),
  resolvedTargetElementIds: z.array(z.string().min(1)), resolvedReplacementTrackIds: z.array(z.string().min(1)),
  expectedExpansionDigest: digest.nullable(), expectedReplacementInputDigest: digest.nullable(),
  stage: stage.nullable(), derivationDigest: digest.nullable(), eligibility: z.boolean(),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]*$/).nullable() }).strict().superRefine((value, context) => {
    if (value.normalizedIntent && value.kind !== value.normalizedIntent.kind) context.addIssue({ code: 'custom', message: 'INTENT_KIND' });
    if (value.eligibility !== (value.derivationDigest !== null && value.reasonCode === null
      && value.normalizedIntent !== null))
      context.addIssue({ code: 'custom', message: 'PREPARATION_ELIGIBILITY' });
  });

export function parseWorkspaceProjection(input: unknown): WorkspaceProjection {
  return parseRead(workspaceSchema, input, 'PROTOCOL_WORKSPACE_INVALID') as WorkspaceProjection; }
export function parseBranchList(input: unknown): BranchList { return parseRead(branchListSchema, input, 'PROTOCOL_BRANCH_LIST_INVALID'); }
export function parseActiveClaimList(input: unknown): ActiveClaimList { return parseRead(activeClaimListSchema, input, 'PROTOCOL_ACTIVE_CLAIMS_INVALID'); }
export function parseActivityPage(input: unknown): ActivityPage { return parseRead(activityPageSchema, input, 'PROTOCOL_ACTIVITY_INVALID'); }
export function parseCommandValidation(input: unknown): CommandValidation {
  return parseRead(validationSchema, input, 'PROTOCOL_VALIDATION_INVALID') as CommandValidation; }
export function parseExportProof(input: unknown): ExportProof { return parseRead(exportProofSchema, input, 'PROTOCOL_EXPORT_PROOF_INVALID'); }
export function parseOperationPreparationRequest(input: unknown): OperationPreparationRequest {
  return parseRead(preparationRequestSchema, input, 'PROTOCOL_PREPARATION_REQUEST_INVALID') as OperationPreparationRequest; }
export function parseOperationPreparation(input: unknown): OperationPreparation {
  return parseRead(preparationSchema, input, 'PROTOCOL_PREPARATION_INVALID') as OperationPreparation; }
function parseRead<T>(schema: z.ZodType<T>, input: unknown, code: string): T { const parsed = schema.safeParse(input);
  if (!parsed.success) throw new Error(code); return parsed.data; }

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
  async workspace(documentId: string, branch: string = MAIN_BRANCH_ID): Promise<WorkspaceProjection> {
    return parseWorkspaceProjection(await this.readJson(`/api/v1/documents/${encodeURIComponent(documentId)}/branches/${encodeURIComponent(branch)}/workspace`)); }
  async branches(documentId: string): Promise<BranchList> { return this.readJson(
    `/api/v1/documents/${encodeURIComponent(documentId)}/branches`).then(parseBranchList); }
  async activeClaims(documentId: string): Promise<ActiveClaimList> { return this.readJson(
    `/api/v1/documents/${encodeURIComponent(documentId)}/claims?status=active`).then(parseActiveClaimList); }
  async activity(documentId: string, afterCommitSeq = 0, limit = 100): Promise<ActivityPage> { return this.readJson(
    `/api/v1/documents/${encodeURIComponent(documentId)}/activity?afterCommitSeq=${afterCommitSeq}&limit=${limit}`).then(parseActivityPage); }
  async validate(command: MotionCommand, claimSecret?: string): Promise<CommandValidation> {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...this.authHeaders() };
    const secret = claimSecret ?? this.auth.claimSecret; if (secret) headers['x-motion-claim-secret'] = secret;
    const response = await this.request(`${this.baseUrl}/api/v1/commands/validate`, { method: 'POST', headers, body: canonicalJson(command) });
    return parseCommandValidation(await response.json());
  }
  async prepareOperation(request: OperationPreparationRequest): Promise<OperationPreparation> {
    const path = `/api/v1/documents/${encodeURIComponent(request.documentId)}/branches/${encodeURIComponent(request.branchId)}/operations/prepare`;
    const response = await this.request(`${this.baseUrl}${path}`, { method: 'POST', headers: {
      'content-type': 'application/json', ...this.authHeaders() }, body: canonicalJson(request) });
    if (!response.ok) { const parsed = parseCommandResponse(await response.json());
      if (parsed.ok) throw new Error('PROTOCOL_PREPARATION_FAILURE_INVALID');
      throw new MotionPreparationError(parsed); }
    return parseOperationPreparation(await response.json());
  }
  async exportProof(documentId: string, branch: string = MAIN_BRANCH_ID): Promise<ExportProof> { return this.readJson(
    `/api/v1/documents/${encodeURIComponent(documentId)}/branches/${encodeURIComponent(branch)}/export-proof`).then(parseExportProof); }
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
  private async readJson(path: string): Promise<unknown> { const response = await this.request(`${this.baseUrl}${path}`,
    { headers: this.authHeaders() }); if (!response.ok) throw new Error('SERVICE_READ_FAILED'); return response.json(); }
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
export function makeCueCommand(operation: CueAuthoringOperation, branchIdValue: string = MAIN_BRANCH_ID): CueCommand {
  return envelope(operation as MotionCommand['command'], branchIdValue) as CueCommand;
}
export function makeOperationIntentCommand(input: PreparedOperationIntent, branchIdValue: string = MAIN_BRANCH_ID): OperationIntentCommand {
  return envelope(input as MotionCommand['command'], branchIdValue) as OperationIntentCommand;
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
