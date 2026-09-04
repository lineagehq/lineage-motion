import {
  cssKeyframeTimeQuantizationHalfStep,
  classifyAnimatedProperty,
  normalizeCssTimingFunction,
  projectTrackInterpolation,
} from './css-motion-semantics.js';
import { sha256Hex } from './sha256.js';
import {
  CUE_GENERATOR_ID, CUE_GENERATOR_VERSION, REUSABLE_CUE_GENERATOR_ID, REUSABLE_CUE_GENERATOR_VERSION,
  cueExpansionInput, cueFromExpansion, cueTargetSnapshots, deriveCueId, expandCue, isAuthoringCue,
  replacementInputDigest, type AuthoringCue, type CueReplacementBundle, type CueSemantic,
  type CueTargetSnapshot,
} from './cue-authoring.js';
import type {
  OperationIntentPayload, OperationPreparation, OperationPreparationRequest, PreparedOperationIntent,
} from './operation-preparation.js';
import {
  canonicalBytes, canonicalContentBytes, canonicalJson, formatCanonicalDecimal, stableStringify,
} from './canonical.js';
import {
  maximumCueMoment, timingFunctionSchema, validateAttachedCues, validateMotionDocument,
  type Diagnostic, type MotionDocument, type MotionHold, type RuleTrack, type TimelineCue,
  type TimingFunction,
} from './document.js';

export * from './canonical.js';
export * from './document.js';

type OperationEnvelope = {
  schemaVersion: 'motion.operation.v1';
  operationId: string;
  documentId: string;
  expectedRevision: number;
};

export const STRUCTURAL_AUTHORING_ELEMENT_IDS = [
  'el_a2849ff826f3e167',
  'el_2dbee68b1ea318c8',
] as const;
export const STRUCTURAL_AUTHORING_STATUS_ELEMENT_ID = 'el_1f3f2908e4fd2401';
export type StructuralAuthoringElementId = typeof STRUCTURAL_AUTHORING_ELEMENT_IDS[number];
/** Kept as the reviewed Cursor default for callers that have not adopted target selection. */
export const STRUCTURAL_AUTHORING_ELEMENT_ID: StructuralAuthoringElementId = STRUCTURAL_AUTHORING_ELEMENT_IDS[0];

export type TrackCreationEligibility = {
  elementId: string;
  property: string;
  available: boolean;
  reason: null | 'DOCUMENT_INVALID' | 'ELEMENT_NOT_FOUND' | 'TARGET_PROPERTY_UNSUPPORTED'
    | 'SHARED_PROPERTY_UNSUPPORTED' | 'PROPERTY_CONFLICT' | 'TRACK_ALREADY_EXISTS'
    | 'TRACK_LIMIT_REACHED' | 'ID_COLLISION';
};

/** Pure, selector-independent projection used by both UI and mutation validation. */
export function projectTrackCreationEligibility(
  document: MotionDocument,
  elementId: string,
  property: string,
): TrackCreationEligibility {
  const unavailable = (reason: NonNullable<TrackCreationEligibility['reason']>): TrackCreationEligibility =>
    ({ elementId, property, available: false, reason });
  if (!validateMotionDocument(document).ok) return unavailable('DOCUMENT_INVALID');
  if (!document.elements.some((element) => element.id === elementId)) return unavailable('ELEMENT_NOT_FOUND');
  if (property !== 'opacity' || ![...STRUCTURAL_AUTHORING_ELEMENT_IDS, STRUCTURAL_AUTHORING_STATUS_ELEMENT_ID]
    .includes(elementId as StructuralAuthoringElementId)) {
    return unavailable('TARGET_PROPERTY_UNSUPPORTED');
  }
  const propertyTracks = document.tracks.filter((track) => track.property === property);
  if (propertyTracks.some((track) => track.elementId === elementId
    && document.tracks.filter((candidate) => candidate.ruleId === track.ruleId
      && candidate.property === property).length > 1)) return unavailable('SHARED_PROPERTY_UNSUPPORTED');
  if (propertyTracks.some((track) => track.elementId === elementId)) return unavailable('TRACK_ALREADY_EXISTS');
  if (STRUCTURAL_AUTHORING_ELEMENT_IDS.some((candidate) =>
    document.tracks.some((track) => track.id === derivedBundleIds(document.documentId, candidate).trackId))) {
    return unavailable('TRACK_LIMIT_REACHED');
  }
  const ids = derivedBundleIds(document.documentId, elementId as StructuralAuthoringElementId);
  const allIds = canonicalIdentitySet(document);
  if ([ids.ruleId, ids.applicationId, ids.slotId, ids.ruleTrackId, ids.trackId, ids.startId, ids.endId]
    .some((id) => allIds.has(id))
    || document.rules.some((rule) => rule.sourceName === `created_${sha256Hex(ids.base).slice(0, 16)}`)) {
    return unavailable('ID_COLLISION');
  }
  return { elementId, property, available: true, reason: null };
}

export * from './authoring-types.js';
import type {
  AuthoringOperation, AuthoringResult, AuthoringState, CueAuthoringOperation, EditOperation, EditRecord,
  HistoryOperation, HoldInsertOperation, InternalHoldRemoveOperation, InternalKeyframeRestoreOperation,
  InternalTrackDeleteOperation, InternalTrajectoryRestoreOperation, KeyframeEditOperation,
  ReducerOperation, StageProjection, StructuralAuthoringOperation, TrajectoryAuthoringOperation,
  TrajectoryInsertionTarget, TrajectoryTarget, TransformPose,
} from './authoring-types.js';

export function createAuthoringState(document: MotionDocument): AuthoringState {
  return { document: structuredClone(document), consumedOperationIds: [], undo: [], redo: [] };
}

export function dispatchAuthoringOperation(
  state: AuthoringState,
  input: unknown,
  allocatedRevision = state.document.revision + 1,
): AuthoringResult {
  const operation = parseOperation(input);
  if (!operation) return authoringFailure(state, 'AUTHORING_ENVELOPE_INVALID');
  if (operation.documentId !== state.document.documentId) {
    return authoringFailure(state, 'AUTHORING_DOCUMENT_MISMATCH');
  }
  if (state.consumedOperationIds.includes(operation.operationId)) {
    return authoringFailure(state, 'AUTHORING_OPERATION_ID_REUSED');
  }
  if (operation.expectedRevision !== state.document.revision) {
    return authoringFailure(state, 'AUTHORING_STALE_REVISION');
  }
  if (!Number.isSafeInteger(allocatedRevision) || allocatedRevision <= state.document.revision) {
    return authoringFailure(state, 'AUTHORING_REVISION_EXHAUSTED');
  }

  if (operation.kind === 'motion.history.undo' || operation.kind === 'motion.history.redo') {
    const source = operation.kind === 'motion.history.undo' ? state.undo : state.redo;
    if (source.length === 0) return authoringFailure(state, 'AUTHORING_HISTORY_EMPTY');
    const record = source.at(-1)!;
    const replay = operation.kind === 'motion.history.undo' ? record.inverse : record.forward;
    const applied = applyOperation(state.document, replay);
    if (!applied.ok) return authoringFailure(state, 'AUTHORING_HISTORY_REPLAY_INVALID');
    const revision = allocatedRevision;
    if (!validateMotionDocument({ ...applied.document, revision }).ok) {
      return authoringFailure(state, 'AUTHORING_HISTORY_REPLAY_INVALID');
    }
    const nextRecord = cloneRecord(record);
    return {
      ok: true,
      state: {
        document: { ...applied.document, revision },
        consumedOperationIds: [...state.consumedOperationIds, operation.operationId],
        undo: operation.kind === 'motion.history.undo'
          ? state.undo.slice(0, -1).map(cloneRecord)
          : [...state.undo.map(cloneRecord), nextRecord],
        redo: operation.kind === 'motion.history.undo'
          ? [...state.redo.map(cloneRecord), nextRecord]
          : state.redo.slice(0, -1).map(cloneRecord),
      },
    };
  }

  if (!operation.kind.startsWith('motion.cue.') && targetsCueOwnedTrack(state.document, operation)) {
    return authoringFailure(state, 'CUE_TRACK_LOCKED');
  }

  if ((state.document.holds ?? []).length > 0 && operation.kind !== 'motion.hold.insert') {
    return authoringFailure(state, 'AUTHORING_HOLD_LOCKED');
  }

  const editOperation = operation as EditOperation;
  const applied = applyOperation(state.document, editOperation);
  if (!applied.ok) return authoringFailure(state, applied.code);
  const candidateValidation = validateMotionDocument({ ...applied.document, revision: allocatedRevision });
  if (!candidateValidation.ok) return authoringFailure(state, 'AUTHORING_CANDIDATE_INVALID');
  return {
    ok: true,
    state: {
      document: { ...applied.document, revision: allocatedRevision },
      consumedOperationIds: [...state.consumedOperationIds, operation.operationId],
      undo: [...state.undo.map(cloneRecord), { forward: structuredClone(editOperation), inverse: applied.inverse }],
      redo: [],
    },
  };
}

function applyOperation(
  document: MotionDocument,
  operation: ReducerOperation,
): { ok: true; document: MotionDocument; inverse: ReducerOperation } | { ok: false; code: string } {
  if (operation.kind === 'motion.keyframe-value.set' || operation.kind === 'motion.keyframe-time.set') {
    return applyEdit(document, operation);
  }
  if (operation.kind.startsWith('motion.cue.')) {
    return applyCueOperation(document, operation as CueAuthoringOperation);
  }
  if (operation.kind === 'motion.hold.insert' || operation.kind === 'motion.internal.hold.remove') {
    return applyHold(document, operation);
  }
  if (operation.kind === 'motion.internal.trajectory.restore') {
    if (sha256Hex(canonicalContentBytes(document)) !== operation.payload.expectedContentDigest
      || !validateMotionDocument(operation.payload.restore).ok) {
      return { ok: false, code: 'AUTHORING_HISTORY_REPLAY_INVALID' };
    }
    const restored = structuredClone(operation.payload.restore);
    const inverse: InternalTrajectoryRestoreOperation = {
      schemaVersion: operation.schemaVersion, operationId: operation.operationId,
      documentId: operation.documentId, expectedRevision: operation.expectedRevision,
      kind: 'motion.internal.trajectory.restore',
      payload: { expectedContentDigest: sha256Hex(canonicalContentBytes(restored)), restore: structuredClone(document) },
    };
    return { ok: true, document: restored, inverse };
  }
  if (operation.kind.startsWith('motion.transform-') || operation.kind.startsWith('motion.keyframe-group-')
    || operation.kind === 'motion.settled-hold.set') {
    return applyTrajectoryOperation(document, operation as TrajectoryAuthoringOperation);
  }
  return applyStructural(document, operation as Exclude<StructuralAuthoringOperation, HoldInsertOperation>
    | InternalTrackDeleteOperation | InternalKeyframeRestoreOperation);
}

export * from './cue-operations.js';
import { applyCueOperation, targetsCueOwnedTrack } from './cue-operations.js';
export * from './structural-authoring.js';
import { applyHold, applyStructural, canonicalIdentitySet, derivedBundleIds } from './structural-authoring.js';
function applyEdit(
  document: MotionDocument,
  operation: KeyframeEditOperation,
): { ok: true; document: MotionDocument; inverse: EditOperation } | { ok: false; code: string } {
  const element = document.elements.find((candidate) => candidate.id === operation.elementId);
  if (!element) return { ok: false, code: 'AUTHORING_ELEMENT_NOT_FOUND' };
  const expandedTrack = document.tracks.find((candidate) => candidate.id === operation.trackId);
  if (!expandedTrack) return { ok: false, code: 'AUTHORING_TRACK_NOT_FOUND' };
  if (expandedTrack.elementId !== element.id) {
    return { ok: false, code: 'AUTHORING_TRACK_ELEMENT_MISMATCH' };
  }
  const keyframeExists = document.rules.some((rule) => rule.tracks.some((track) =>
    track.keyframes.some((keyframe) => keyframe.id === operation.keyframeId)));
  if (!keyframeExists) return { ok: false, code: 'AUTHORING_KEYFRAME_NOT_FOUND' };
  if (!expandedTrack.keyframeIds.includes(operation.keyframeId)) {
    return { ok: false, code: 'AUTHORING_KEYFRAME_TRACK_MISMATCH' };
  }
  const matchingExpanded = document.tracks.filter((candidate) =>
    candidate.ruleId === expandedTrack.ruleId && candidate.property === expandedTrack.property);
  if (matchingExpanded.length !== 1) {
    return { ok: false, code: 'AUTHORING_SHARED_RULE_UNSUPPORTED' };
  }
  if (expandedTrack.property !== 'opacity') {
    return { ok: false, code: 'AUTHORING_PROPERTY_UNSUPPORTED' };
  }
  const rule = document.rules.find((candidate) => candidate.id === expandedTrack.ruleId)!;
  const ruleTrack = rule.tracks.find((candidate) => candidate.property === expandedTrack.property)!;
  const keyframeIndex = ruleTrack.keyframes.findIndex((candidate) =>
    candidate.id === operation.keyframeId);
  const keyframe = ruleTrack.keyframes[keyframeIndex]!;

  let replacement: RuleTrack['keyframes'][number];
  let inverse: EditOperation;
  if (operation.kind === 'motion.keyframe-value.set') {
    const value = operation.payload.value;
    const scaled = value * 1_000_000;
    if (!Number.isFinite(value) || value < 0 || value > 1
      || !Number.isSafeInteger(scaled)) {
      return { ok: false, code: 'AUTHORING_VALUE_INVALID' };
    }
    replacement = { ...keyframe, value: formatCanonicalDecimal(value) };
    inverse = { ...operation, payload: { value: Number(keyframe.value) } };
  } else {
    const targetTime = operation.payload.timeMs;
    const application = document.applications.find((candidate) =>
      candidate.slots.some((slot) => slot.id === expandedTrack.slotId)
      && candidate.bindings.some((binding) => binding.elementId === expandedTrack.elementId));
    const slotIndex = application?.slots.findIndex((slot) => slot.id === expandedTrack.slotId) ?? -1;
    const slot = slotIndex >= 0 ? application!.slots[slotIndex] : undefined;
    const binding = application?.bindings.find((candidate) =>
      candidate.elementId === expandedTrack.elementId);
    const delayMs = binding?.delayOverridesMs[slotIndex];
    if (!slot || delayMs === undefined || slot.durationMs === 0 || slot.iterationCount !== 1) {
      return { ok: false, code: 'AUTHORING_TIME_UNSUPPORTED' };
    }
    if (!Number.isSafeInteger(targetTime)) {
      return { ok: false, code: 'AUTHORING_TIME_UNSUPPORTED' };
    }
    if (targetTime < delayMs || targetTime > delayMs + slot.durationMs) {
      return { ok: false, code: 'AUTHORING_TIME_OUT_OF_RANGE' };
    }
    const numerator = (targetTime - delayMs) * 1_000_000;
    if (!Number.isSafeInteger(numerator) || numerator % slot.durationMs !== 0) {
      return { ok: false, code: 'AUTHORING_TIME_PRECISION_UNREPRESENTABLE' };
    }
    const offset = (numerator / slot.durationMs) / 1_000_000;
    const previous = ruleTrack.keyframes[keyframeIndex - 1];
    const next = ruleTrack.keyframes[keyframeIndex + 1];
    if (previous?.offset === offset || next?.offset === offset) {
      return { ok: false, code: 'AUTHORING_TIME_COLLISION' };
    }
    if ((previous && offset < previous.offset) || (next && offset > next.offset)) {
      return { ok: false, code: 'AUTHORING_TIME_ORDER_INVALID' };
    }
    const currentTime = delayMs + keyframe.offset * slot.durationMs;
    if (!Number.isSafeInteger(currentTime)) {
      return { ok: false, code: 'AUTHORING_TIME_UNSUPPORTED' };
    }
    replacement = { ...keyframe, offset };
    inverse = { ...operation, payload: { timeMs: currentTime } };
  }

  const nextDocument = structuredClone(document);
  const nextRule = nextDocument.rules.find((candidate) => candidate.id === rule.id)!;
  const nextTrack = nextRule.tracks.find((candidate) => candidate.id === ruleTrack.id)!;
  nextTrack.keyframes[keyframeIndex] = replacement;
  return { ok: true, document: nextDocument, inverse };
}

export * from './trajectory-authoring.js';
import {
  applyTrajectoryOperation, completeTrajectoryInsertionBundle, completeTrajectoryMomentBundle,
  projectTrajectorySelection, projectTransformTrajectory, resolveTrajectoryTarget, validPose, validStage,
  validTrajectoryInsertionTargets, validTrajectoryTargets,
} from './trajectory-authoring.js';
export * from './operation-parser.js';
import { parseOperation } from './operation-parser.js';
function cloneRecord(record: EditRecord): EditRecord {
  return structuredClone(record);
}

function authoringFailure(state: AuthoringState, code: string): AuthoringResult {
  return {
    ok: false,
    state,
    diagnostic: {
      code,
      severity: 'error',
      summary: 'The authoring operation was rejected without changing state.',
    },
  };
}

export function deriveElementId(
  structuralFingerprint: string,
  collisionOrdinal: number,
): string {
  return `el_${sha256Hex(`${structuralFingerprint}\0${collisionOrdinal}`).slice(0, 16)}`;
}

export * from './css-motion-semantics.js';
export * from './cue-authoring.js';
export { sha256Hex } from './sha256.js';
