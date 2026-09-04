import { canonicalContentBytes, canonicalJson } from './canonical.js';
import {
  CUE_GENERATOR_ID, CUE_GENERATOR_VERSION, REUSABLE_CUE_GENERATOR_ID, REUSABLE_CUE_GENERATOR_VERSION,
  cueExpansionInput, cueFromExpansion, cueTargetSnapshots, deriveCueId, expandCue, isAuthoringCue,
  replacementInputDigest, type AuthoringCue, type CueReplacementBundle, type CueSemantic,
  type CueTargetSnapshot,
} from './cue-authoring.js';
import { maximumCueMoment, validateAttachedCues, type MotionDocument } from './document.js';
import { sha256Hex } from './sha256.js';
import type {
  AuthoringOperation, CueAuthoringOperation, InternalTrajectoryRestoreOperation, OperationEnvelope,
  ReducerOperation, StageProjection, TrajectoryAuthoringOperation, TrajectoryInsertionTarget,
  TrajectoryTarget,
} from './authoring-types.js';
import type {
  OperationIntentPayload, OperationPreparation, OperationPreparationRequest, PreparedOperationIntent,
} from './operation-preparation.js';
import {
  completeTrajectoryInsertionBundle, completeTrajectoryMomentBundle, projectTrajectorySelection,
  projectTransformTrajectory, resolveTrajectoryTarget,
} from './trajectory-authoring.js';
import { canonicalIdentitySet, refreshInventory } from './structural-authoring.js';

export function applyCueOperation(
  document: MotionDocument,
  operation: CueAuthoringOperation,
): { ok: true; document: MotionDocument; inverse: ReducerOperation } | { ok: false; code: string } {
  const before = structuredClone(document);
  const fail = (code: string): { ok: false; code: string } => ({ ok: false, code });
  const cues = document.cues.filter(isAuthoringCue);
  if (operation.kind === 'motion.cue.create') {
    if (cues.some((cue) => cue.id === operation.payload.cueId)
      || canonicalIdentitySet(document).has(operation.payload.cueId)
      || maximumCueMoment(operation.payload.semantic) > document.durationMs) return fail('CUE_CREATE_INVALID');
    let snapshots: CueTargetSnapshot[];
    try { snapshots = cueTargetSnapshots(document, operation.payload.semantic); } catch { return fail('CUE_TARGET_MISSING'); }
    if (canonicalJson(snapshots) !== canonicalJson(operation.payload.targetSnapshots)) return fail('CUE_TARGET_DRIFT');
    const replacement = collectReplacementBundle(document, operation.payload.replacementTrackIds);
    if (!replacement.ok) return replacement;
    if ((replacement.bundle?.inputDigest ?? null) !== operation.payload.replacementInputDigest) return fail('CUE_REPLACEMENT_STALE');
    let expansion;
    try { expansion = expandCue(cueExpansionInput(operation.payload.cueId, operation.payload.semantic,
      operation.payload.targetSnapshots, replacement.bundle)); } catch { return fail('CUE_CREATE_INVALID'); }
    const next = structuredClone(document);
    if (replacement.bundle) removeStructuralBundle(next, replacement.bundle);
    if (hasCueCollision(next, expansion.rules, expansion.applications, expansion.tracks)) return fail('CUE_ID_COLLISION');
    if (hasPropertyOverlap(next, expansion.tracks)) return fail('CUE_PROPERTY_OVERLAP');
    const cue = cueFromExpansion(expansion, replacement.bundle);
    next.rules.push(...structuredClone(expansion.rules));
    next.applications.push(...structuredClone(expansion.applications));
    next.tracks.push(...structuredClone(expansion.tracks));
    next.cues.push(cue);
    if (cue.semantic.kind === 'hold') next.durationMs += cue.semantic.durationMs;
    refreshInventory(next);
    if (cue.semantic.kind === 'click' && cue.semantic.revealCueId) {
      const revealCueId = cue.semantic.revealCueId;
      const reveal = next.cues.find((candidate) => isAuthoringCue(candidate) && candidate.id === revealCueId);
      if (!reveal || !isAuthoringCue(reveal) || reveal.semantic.kind !== 'reveal'
        || reveal.semantic.startMs !== cue.semantic.pressMs) return fail('CUE_SYNC_INVALID');
    }
    return cueResult(before, next, operation);
  }

  const cue = cues.find((candidate) => candidate.id === operation.payload.cueId);
  if (!cue || cue.expansionDigest !== operation.payload.expectedExpansionDigest) return fail('CUE_EXPANSION_STALE');
  const replacementDigest = cue.replacement?.inputDigest ?? null;
  if ('expectedReplacementInputDigest' in operation.payload
    && operation.payload.expectedReplacementInputDigest !== replacementDigest) return fail('CUE_REPLACEMENT_STALE');
  if (validateAttachedCues(document)) return fail('CUE_EXPANSION_DRIFT');
  const next = structuredClone(document);
  const nextCue = next.cues.find((candidate) => candidate.id === cue.id)! as AuthoringCue;

  if (operation.kind === 'motion.cue.update') {
    if (maximumCueMoment(operation.payload.semantic) > document.durationMs) return fail('CUE_UPDATE_INVALID');
    let snapshots: CueTargetSnapshot[];
    try { snapshots = cueTargetSnapshots(document, operation.payload.semantic); } catch { return fail('CUE_TARGET_MISSING'); }
    if (canonicalJson(snapshots) !== canonicalJson(operation.payload.targetSnapshots)) return fail('CUE_TARGET_DRIFT');
    if (cue.replacement && (operation.payload.semantic.kind !== cue.semantic.kind
      || canonicalJson(snapshots.map(({ role, ordinal, elementId }) => ({ role, ordinal, elementId })))
        !== canonicalJson(cue.targetSnapshots.map(({ role, ordinal, elementId }) => ({ role, ordinal, elementId }))))) {
      return fail('CUE_REPLACEMENT_SCOPE_CHANGE');
    }
    let expansion;
    try { expansion = expandCue(cueExpansionInput(cue.id, operation.payload.semantic,
      operation.payload.targetSnapshots, cue.replacement)); } catch { return fail('CUE_UPDATE_INVALID'); }
    removeGeneratedBundle(next, cue);
    if (hasCueCollision(next, expansion.rules, expansion.applications, expansion.tracks)) return fail('CUE_ID_COLLISION');
    if (hasPropertyOverlap(next, expansion.tracks)) return fail('CUE_PROPERTY_OVERLAP');
    Object.assign(nextCue, cueFromExpansion(expansion, cue.replacement));
    if (cue.semantic.kind === 'hold' && operation.payload.semantic.kind === 'hold') {
      next.durationMs += operation.payload.semantic.durationMs - cue.semantic.durationMs;
    }
    next.rules.push(...structuredClone(expansion.rules)); next.applications.push(...structuredClone(expansion.applications));
    next.tracks.push(...structuredClone(expansion.tracks)); refreshInventory(next);
    if (nextCue.semantic.kind === 'click' && nextCue.semantic.revealCueId) {
      const revealCueId = nextCue.semantic.revealCueId;
      const reveal = next.cues.find((candidate) => isAuthoringCue(candidate) && candidate.id === revealCueId);
      if (!reveal || !isAuthoringCue(reveal) || reveal.semantic.kind !== 'reveal'
        || reveal.semantic.startMs !== nextCue.semantic.pressMs) return fail('CUE_SYNC_INVALID');
    }
    return cueResult(before, next, operation);
  }

  if (operation.kind === 'motion.cue.detach') {
    next.cues = next.cues.filter((candidate) => candidate.id !== cue.id);
    for (const track of next.tracks.filter((candidate) => cue.generatedTrackIds.includes(candidate.id))) {
      delete track.cueOwnership;
    }
    refreshInventory(next);
    return cueResult(before, next, operation);
  }

  removeGeneratedBundle(next, cue);
  next.cues = next.cues.filter((candidate) => candidate.id !== cue.id);
  if (operation.kind === 'motion.cue.delete' && cue.semantic.kind === 'hold') next.durationMs -= cue.semantic.durationMs;
  if (operation.kind === 'motion.cue.delete' && cue.replacement) {
    if (hasCueCollision(next, cue.replacement.rules, cue.replacement.applications, cue.replacement.tracks)) return fail('CUE_RESTORE_COLLISION');
    if (hasPropertyOverlap(next, cue.replacement.tracks)) return fail('CUE_RESTORE_OVERLAP');
    next.rules.push(...structuredClone(cue.replacement.rules));
    next.applications.push(...structuredClone(cue.replacement.applications));
    next.tracks.push(...structuredClone(cue.replacement.tracks));
  }
  refreshInventory(next);
  return cueResult(before, next, operation);
}

function cueResult(before: MotionDocument, next: MotionDocument, operation: CueAuthoringOperation) {
  const inverse: InternalTrajectoryRestoreOperation = { schemaVersion: operation.schemaVersion,
    operationId: operation.operationId, documentId: operation.documentId, expectedRevision: operation.expectedRevision,
    kind: 'motion.internal.trajectory.restore', payload: {
      expectedContentDigest: sha256Hex(canonicalContentBytes(next)), restore: before,
    } };
  return { ok: true as const, document: next, inverse };
}

function collectReplacementBundle(document: MotionDocument, trackIds: string[]):
  { ok: true; bundle?: CueReplacementBundle } | { ok: false; code: string } {
  if (trackIds.length === 0) return { ok: true };
  const requested = document.tracks.filter((track) => trackIds.includes(track.id));
  if (requested.length !== trackIds.length || requested.some((track) => track.cueOwnership)
    || canonicalJson(requested.map((track) => track.id)) !== canonicalJson(trackIds)) return { ok: false, code: 'CUE_REPLACEMENT_INVALID' };
  const closure = closedReplacementTrackIds(document, trackIds);
  const applicationIds = closure.applicationIds; const ruleIds = closure.ruleIds;
  const applications = document.applications.filter((application) => applicationIds.has(application.id));
  const rules = document.rules.filter((rule) => ruleIds.has(rule.id));
  const slotIds = new Set(applications.flatMap((application) => application.slots.map((slot) => slot.id)));
  const tracks = document.tracks.filter((track) => slotIds.has(track.slotId) || ruleIds.has(track.ruleId));
  if (canonicalJson(tracks.map((track) => track.id)) !== canonicalJson(trackIds)) return { ok: false, code: 'CUE_REPLACEMENT_SCOPE_INCOMPLETE' };
  const partial = { schemaVersion: 'motion.cue-replacement.v1' as const, trackIds: [...trackIds], rules: structuredClone(rules),
    applications: structuredClone(applications), tracks: structuredClone(tracks) };
  return { ok: true, bundle: { ...partial, inputDigest: replacementInputDigest(partial) } };
}

export function projectCueReplacement(document: MotionDocument, cueId: string, semantic: CueSemantic):
  { ok: true; trackIds: string[]; inputDigest: string | null } | { ok: false; code: string } {
  try {
    if (semantic.kind === 'hold') {
      const initial = document.tracks.filter((track) => semantic.targetIds.includes(track.elementId)).map((track) => track.id);
      const contributingTargetIds = new Set(document.tracks.filter((track) => initial.includes(track.id))
        .map((track) => track.elementId));
      if (semantic.targetIds.some((targetId) => !contributingTargetIds.has(targetId))) {
        return { ok: false, code: 'CUE_HOLD_TARGET_UNANIMATED' };
      }
      const projected = collectReplacementBundle(document, closedReplacementTrackIds(document, initial).trackIds);
      if (!projected.ok || !projected.bundle) return projected.ok
        ? { ok: false, code: 'CUE_REPLACEMENT_INVALID' } : projected;
      for (const sourceTrack of projected.bundle.tracks) {
        const application: MotionDocument['applications'][number] | undefined = projected.bundle.applications
          .find((candidate: MotionDocument['applications'][number]) => candidate.slots.some((slot) => slot.id === sourceTrack.slotId));
        const slotIndex = application?.slots.findIndex((slot: MotionDocument['applications'][number]['slots'][number]) =>
          slot.id === sourceTrack.slotId) ?? -1;
        const slot = application?.slots[slotIndex];
        const binding = application?.bindings.find((candidate: MotionDocument['applications'][number]['bindings'][number]) =>
          candidate.elementId === sourceTrack.elementId);
        const ruleTrack = projected.bundle.rules.find((rule) => rule.id === sourceTrack.ruleId)?.tracks
          .find((track) => track.property === sourceTrack.property);
        if (!slot || !binding || !ruleTrack || !ruleTrack.keyframes.some((frame) =>
          binding.delayOverridesMs[slotIndex]! + frame.offset * slot.durationMs === semantic.enterMs)) {
          return { ok: false, code: 'CUE_HOLD_ENTER_BOUNDARY_MISSING' };
        }
      }
      return { ok: true, trackIds: projected.bundle.trackIds, inputDigest: projected.bundle.inputDigest };
    }
    const expansion = expandCue(cueExpansionInput(cueId, semantic, cueTargetSnapshots(document, semantic)));
    const initial = document.tracks.filter((track) => expansion.tracks.some((generated) =>
      generated.elementId === track.elementId && generated.property === track.property)).map((track) => track.id);
    const projected = collectReplacementBundle(document, closedReplacementTrackIds(document, initial).trackIds);
    if (!projected.ok) return projected;
    return { ok: true, trackIds: projected.bundle?.trackIds ?? [], inputDigest: projected.bundle?.inputDigest ?? null };
  } catch { return { ok: false, code: 'CUE_REPLACEMENT_INVALID' }; }
}

type PreparedMaterialization = { preparation: OperationPreparation; operation: TrajectoryAuthoringOperation | CueAuthoringOperation | null };

export function prepareOperationIntent(document: MotionDocument, branchId: string, canonicalDigest: string,
  exportDigest: string, request: OperationPreparationRequest): PreparedMaterialization {
  const empty = (reasonCode: string): PreparedMaterialization => ({ operation: null, preparation: {
    schemaVersion: 'motion.operation-preparation.v1', documentId: request.documentId, branchId,
    revision: document.revision, canonicalDigest, exportDigest, kind: request.kind,
    normalizedIntent: null, resolvedElementIds: [], resolvedTrackIds: [],
    resolvedKeyframeIds: [], resolvedCueId: null, resolvedTargetElementIds: [], resolvedReplacementTrackIds: [],
    expectedExpansionDigest: null, expectedReplacementInputDigest: null, stage: null,
    derivationDigest: null, eligibility: false, reasonCode,
  } });
  if (request.documentId !== document.documentId || request.branchId !== branchId
    || request.expectedRevision !== document.revision || request.kind !== request.intent.kind) return empty('DERIVATION_STALE');
  try {
    if (!validPublicIntentIdentity(request.intent)) return empty('DERIVATION_INVALID');
    const normalizedIntent = normalizeOperationIntent(request.intent);
    const base = { schemaVersion: 'motion.operation.v1' as const, operationId: 'prepared-operation',
      documentId: document.documentId, expectedRevision: document.revision };
    let operation: TrajectoryAuthoringOperation | CueAuthoringOperation;
    let stage: StageProjection | null = null;
    if (normalizedIntent.kind === 'motion.transform-waypoint.add') {
      const targets: TrajectoryInsertionTarget[] = [];
      for (const elementId of normalizedIntent.elementIds) {
        const trajectory = projectTransformTrajectory(document, elementId);
        if (!trajectory.eligible) return empty(trajectory.code);
        const afterIndex = trajectory.waypoints.findIndex((waypoint) => waypoint.timeMs > normalizedIntent.timeMs);
        const beforePoint = afterIndex > 0 ? trajectory.waypoints[afterIndex - 1] : undefined;
        const afterPoint = afterIndex > 0 ? trajectory.waypoints[afterIndex] : undefined;
        if (!beforePoint || !afterPoint || normalizedIntent.timeMs <= 0 || normalizedIntent.timeMs >= 2100) {
          return empty('AUTHORING_TRAJECTORY_INSERT_INVALID');
        }
        targets.push({ elementId, trackId: trajectory.trackId, beforeKeyframeId: beforePoint.keyframeId,
          afterKeyframeId: afterPoint.keyframeId, expectedBeforeTransform: beforePoint.transformBytes,
          expectedAfterTransform: afterPoint.transformBytes });
      }
      targets.sort((left, right) => `${left.elementId}\0${left.trackId}`.localeCompare(`${right.elementId}\0${right.trackId}`));
      if (!completeTrajectoryInsertionBundle(document, targets)) return empty('AUTHORING_TRAJECTORY_BUNDLE_INCOMPLETE');
      operation = { ...base, kind: normalizedIntent.kind, payload: { targets, timeMs: normalizedIntent.timeMs } };
    } else if (normalizedIntent.kind === 'motion.transform-waypoint.remove') {
      const selected = projectTrajectorySelection(document, normalizedIntent.elementIds, normalizedIntent.timeMs);
      if (!selected.eligible) return empty(selected.code ?? 'AUTHORING_TRAJECTORY_TARGET_INVALID');
      const resolved = selected.targets.map((target) => resolveTrajectoryTarget(document, target));
      if (resolved.some((entry) => !entry)
        || !completeTrajectoryMomentBundle(document,
          resolved as NonNullable<ReturnType<typeof resolveTrajectoryTarget>>[], normalizedIntent.timeMs)) {
        return empty('AUTHORING_TRAJECTORY_BUNDLE_INCOMPLETE');
      }
      operation = { ...base, kind: normalizedIntent.kind, payload: { targets: selected.targets,
        timeMs: normalizedIntent.timeMs } };
    } else if (normalizedIntent.kind === 'motion.transform-pose.set') {
      const selected = projectTrajectorySelection(document, [normalizedIntent.elementId], normalizedIntent.momentMs);
      if (!selected.eligible || selected.targets.length !== 1) return empty(selected.code ?? 'AUTHORING_TRAJECTORY_TARGET_INVALID');
      stage = stageFromViewport(exportDigest, normalizedIntent.viewport);
      operation = { ...base, kind: normalizedIntent.kind, ...selected.targets[0]!,
        payload: { pose: normalizedIntent.pose, stage } };
    } else if (normalizedIntent.kind === 'motion.transform-waypoints.translate') {
      const selected = projectTrajectorySelection(document, normalizedIntent.elementIds, normalizedIntent.momentMs);
      if (!selected.eligible) return empty(selected.code ?? 'AUTHORING_TRAJECTORY_TARGET_INVALID');
      stage = stageFromViewport(exportDigest, normalizedIntent.viewport);
      operation = { ...base, kind: normalizedIntent.kind, payload: { targets: selected.targets,
        deltaXPpm: normalizedIntent.deltaXPpm, deltaYPpm: normalizedIntent.deltaYPpm, stage } };
    } else if (normalizedIntent.kind === 'motion.keyframe-group-time.set') {
      const selected = projectTrajectorySelection(document, normalizedIntent.elementIds, normalizedIntent.sourceTimeMs);
      if (!selected.eligible) return empty(selected.code ?? 'AUTHORING_TRAJECTORY_TARGET_INVALID');
      operation = { ...base, kind: normalizedIntent.kind, payload: { targets: selected.targets,
        sourceTimeMs: normalizedIntent.sourceTimeMs, targetTimeMs: normalizedIntent.targetTimeMs,
        landingTimeMs: normalizedIntent.landingTimeMs, settledTimeMs: normalizedIntent.settledTimeMs } };
    } else if (normalizedIntent.kind === 'motion.keyframe-group-easing.set') {
      const selected = projectTrajectorySelection(document, normalizedIntent.elementIds, normalizedIntent.momentMs);
      if (!selected.eligible) return empty(selected.code ?? 'AUTHORING_TRAJECTORY_TARGET_INVALID');
      operation = { ...base, kind: normalizedIntent.kind, payload: { targets: selected.targets,
        expectedEasing: normalizedIntent.expectedEasing, easing: normalizedIntent.easing } };
    } else if (normalizedIntent.kind === 'motion.settled-hold.set') {
      const selected = projectTrajectorySelection(document, normalizedIntent.elementIds, normalizedIntent.sourceTimeMs);
      if (!selected.eligible) return empty(selected.code ?? 'AUTHORING_TRAJECTORY_TARGET_INVALID');
      operation = { ...base, kind: normalizedIntent.kind, payload: { targets: selected.targets,
        sourceTimeMs: normalizedIntent.sourceTimeMs, settledTimeMs: normalizedIntent.settledTimeMs,
        landingTimeMs: normalizedIntent.landingTimeMs, boundaryTimeMs: normalizedIntent.boundaryTimeMs } };
    } else if (normalizedIntent.kind === 'motion.cue.create') {
      const cueId = deriveCueId(document.documentId, normalizedIntent.creationKey);
      const replacement = projectCueReplacement(document, cueId, normalizedIntent.semantic);
      if (!replacement.ok) return empty(replacement.code);
      operation = { ...base, kind: normalizedIntent.kind, payload: { cueId, semantic: normalizedIntent.semantic,
        targetSnapshots: cueTargetSnapshots(document, normalizedIntent.semantic), replacementTrackIds: replacement.trackIds,
        replacementInputDigest: replacement.inputDigest } };
    } else {
      const cue = document.cues.find((candidate): candidate is AuthoringCue => isAuthoringCue(candidate)
        && candidate.id === normalizedIntent.cueId);
      if (!cue) return empty('CUE_TARGET_MISSING');
      if (normalizedIntent.kind === 'motion.cue.update') operation = { ...base, kind: normalizedIntent.kind,
        payload: { cueId: cue.id, expectedExpansionDigest: cue.expansionDigest, semantic: normalizedIntent.semantic,
          targetSnapshots: cueTargetSnapshots(document, normalizedIntent.semantic) } };
      else operation = { ...base, kind: normalizedIntent.kind, payload: { cueId: cue.id,
        expectedExpansionDigest: cue.expansionDigest, expectedReplacementInputDigest: cue.replacement?.inputDigest ?? null } };
    }
    const hiddenDerivation = { schemaVersion: 'motion.operation-derivation.v1', documentId: document.documentId,
      branchId, revision: document.revision, canonicalDigest, exportDigest, normalizedIntent, operation: {
        ...operation, operationId: null,
      } };
    const derivationDigest = sha256Hex(canonicalJson(hiddenDerivation));
    const targets = operationTargets(operation);
    const insertionTargets = operation.kind === 'motion.transform-waypoint.add' ? operation.payload.targets : [];
    const cuePayload = operation.kind.startsWith('motion.cue.') ? operation.payload : null;
    const cue = cuePayload && 'cueId' in cuePayload ? document.cues.find((candidate) => candidate.id === cuePayload.cueId) : undefined;
    return { operation, preparation: { schemaVersion: 'motion.operation-preparation.v1', documentId: document.documentId,
      branchId, revision: document.revision, canonicalDigest, exportDigest, kind: request.kind, normalizedIntent,
      resolvedElementIds: [...new Set([...targets.map((target) => target.elementId), ...insertionTargets.map((target) => target.elementId)])],
      resolvedTrackIds: [...new Set([...targets.map((target) => target.trackId), ...insertionTargets.map((target) => target.trackId)])],
      resolvedKeyframeIds: [...new Set([...targets.map((target) => target.keyframeId),
        ...insertionTargets.flatMap((target) => [target.beforeKeyframeId, target.afterKeyframeId])])],
      resolvedCueId: cuePayload && 'cueId' in cuePayload ? cuePayload.cueId : null,
      resolvedTargetElementIds: cuePayload && 'semantic' in cuePayload ? semanticElementIds(cuePayload.semantic) : [],
      resolvedReplacementTrackIds: cuePayload && 'replacementTrackIds' in cuePayload ? [...cuePayload.replacementTrackIds] : [],
      expectedExpansionDigest: cue?.schemaVersion === 'motion.authoring-cue.v1' ? cue.expansionDigest : null,
      expectedReplacementInputDigest: cue?.schemaVersion === 'motion.authoring-cue.v1' ? cue.replacement?.inputDigest ?? null : null,
      stage, derivationDigest, eligibility: true, reasonCode: null } };
  } catch (error) { return empty(error instanceof Error ? error.message : 'DERIVATION_INVALID'); }
}

function operationTargets(operation: TrajectoryAuthoringOperation | CueAuthoringOperation): TrajectoryTarget[] {
  if (operation.kind === 'motion.transform-pose.set') return [{ elementId: operation.elementId,
    trackId: operation.trackId, keyframeId: operation.keyframeId, expectedTransform: operation.expectedTransform }];
  if (operation.kind === 'motion.transform-waypoints.translate' || operation.kind === 'motion.transform-waypoint.remove'
    || operation.kind === 'motion.keyframe-group-time.set'
    || operation.kind === 'motion.keyframe-group-easing.set' || operation.kind === 'motion.settled-hold.set') {
    return operation.payload.targets;
  }
  return [];
}

export function materializePreparedIntent(document: MotionDocument, branchId: string, canonicalDigest: string,
  exportDigest: string, intent: PreparedOperationIntent): { ok: true; operation: TrajectoryAuthoringOperation | CueAuthoringOperation }
  | { ok: false; code: string } {
  const prepared = prepareOperationIntent(document, branchId, canonicalDigest, exportDigest, {
    schemaVersion: 'motion.operation-preparation-request.v1', documentId: intent.documentId, branchId,
    expectedRevision: intent.expectedRevision, kind: intent.kind, intent: intent.intent,
  });
  if (!prepared.operation || !prepared.preparation.derivationDigest) return { ok: false,
    code: prepared.preparation.reasonCode ?? 'DERIVATION_INVALID' };
  if (prepared.preparation.derivationDigest !== intent.derivationDigest) return { ok: false, code: 'DERIVATION_STALE' };
  return { ok: true, operation: { ...prepared.operation, operationId: intent.operationId } };
}

function normalizeOperationIntent(intent: OperationIntentPayload): OperationIntentPayload {
  const value = structuredClone(intent);
  if ('elementIds' in value) value.elementIds = [...new Set(value.elementIds)].sort();
  return value;
}

function validPublicIntentIdentity(intent: OperationIntentPayload): boolean {
  const stable = (value: string) => /^[A-Za-z0-9._:-]{1,128}$/.test(value);
  if ('elementId' in intent && !stable(intent.elementId)) return false;
  if ('elementIds' in intent && (!intent.elementIds.length || intent.elementIds.some((id) => !stable(id)))) return false;
  if ('cueId' in intent && !/^cue_[a-f0-9]{24}$/.test(intent.cueId)) return false;
  if ('creationKey' in intent && !stable(intent.creationKey)) return false;
  if ('semantic' in intent) {
    const ids = semanticElementIds(intent.semantic);
    if (ids.some((id) => !stable(id))) return false;
    if (intent.semantic.kind === 'click' && intent.semantic.revealCueId
      && !/^cue_[a-f0-9]{24}$/.test(intent.semantic.revealCueId)) return false;
  }
  return true;
}

function stageFromViewport(exportDigest: string, viewport: { widthCssPixels: number; heightCssPixels: number }): StageProjection {
  const widthMicrounits = viewport.widthCssPixels * 1_000_000;
  const heightMicrounits = viewport.heightCssPixels * 1_000_000;
  if (!Number.isSafeInteger(widthMicrounits) || widthMicrounits <= 0
    || !Number.isSafeInteger(heightMicrounits) || heightMicrounits <= 0) throw new Error('TRAJECTORY_STAGE_INVALID');
  return { stageDigest: sha256Hex(`${exportDigest}\0${widthMicrounits}\0${heightMicrounits}`),
    widthMicrounits, heightMicrounits };
}

function semanticElementIds(semantic: CueSemantic): string[] {
  const ids = semantic.kind === 'reveal' || semantic.kind === 'hold' ? semantic.targetIds
    : semantic.kind === 'type' ? [semantic.targetId]
      : semantic.kind === 'cursor-path' ? [semantic.cursorTargetId]
        : semantic.kind === 'click' ? [semantic.cursorTargetId, semantic.pulseTargetId]
          : semantic.kind === 'select' ? [semantic.cursorTargetId, semantic.selectedTargetId,
            ...(semantic.highlightTargetId ? [semantic.highlightTargetId] : [])]
            : [semantic.cursorTargetId, semantic.draggedTargetId];
  return [...new Set(ids)].sort();
}

function closedReplacementTrackIds(document: MotionDocument, initialTrackIds: string[]): {
  trackIds: string[]; applicationIds: Set<string>; ruleIds: Set<string> } {
  const initial = document.tracks.filter((track) => initialTrackIds.includes(track.id));
  const applicationIds = new Set(document.applications.filter((application) => application.slots.some((slot) =>
    initial.some((track) => track.slotId === slot.id))).map((application) => application.id));
  const ruleIds = new Set<string>(); let changed = true;
  while (changed) {
    changed = false;
    for (const application of document.applications.filter((candidate) => applicationIds.has(candidate.id))) {
      for (const slot of application.slots) if (!ruleIds.has(slot.ruleId)) { ruleIds.add(slot.ruleId); changed = true; }
    }
    for (const application of document.applications) if (!applicationIds.has(application.id)
      && application.slots.some((slot) => ruleIds.has(slot.ruleId))) { applicationIds.add(application.id); changed = true; }
  }
  const slotIds = new Set(document.applications.filter((application) => applicationIds.has(application.id))
    .flatMap((application) => application.slots.map((slot) => slot.id)));
  return { applicationIds, ruleIds, trackIds: document.tracks.filter((track) =>
    slotIds.has(track.slotId) || ruleIds.has(track.ruleId)).map((track) => track.id) };
}

function removeStructuralBundle(document: MotionDocument, bundle: CueReplacementBundle): void {
  const ruleIds = new Set(bundle.rules.map((rule) => rule.id)); const appIds = new Set(bundle.applications.map((application) => application.id));
  const trackIds = new Set(bundle.tracks.map((track) => track.id));
  document.rules = document.rules.filter((rule) => !ruleIds.has(rule.id));
  document.applications = document.applications.filter((application) => !appIds.has(application.id));
  document.tracks = document.tracks.filter((track) => !trackIds.has(track.id));
}

function removeGeneratedBundle(document: MotionDocument, cue: AuthoringCue): void {
  document.rules = document.rules.filter((rule) => !cue.generatedRuleIds.includes(rule.id));
  document.applications = document.applications.filter((application) => !cue.generatedApplicationIds.includes(application.id));
  document.tracks = document.tracks.filter((track) => !cue.generatedTrackIds.includes(track.id));
}

function hasCueCollision(document: MotionDocument, rules: MotionDocument['rules'], applications: MotionDocument['applications'],
  tracks: MotionDocument['tracks']): boolean {
  const ids = canonicalIdentitySet(document); return [...rules, ...applications, ...tracks].some((record) => ids.has(record.id))
    || rules.some((rule) => document.rules.some((existing) => existing.sourceName === rule.sourceName));
}

function hasPropertyOverlap(document: MotionDocument, tracks: MotionDocument['tracks']): boolean {
  return tracks.some((track) => document.tracks.some((existing) => existing.elementId === track.elementId
    && existing.property === track.property));
}

export function targetsCueOwnedTrack(document: MotionDocument, operation: AuthoringOperation): boolean {
  const owned = new Set(document.tracks.filter((track) => track.cueOwnership).map((track) => track.id));
  if ('trackId' in operation && typeof operation.trackId === 'string' && owned.has(operation.trackId)) return true;
  if ('payload' in operation && operation.payload && typeof operation.payload === 'object' && 'targets' in operation.payload
    && Array.isArray(operation.payload.targets)) return operation.payload.targets.some((target) => target && typeof target === 'object'
      && 'trackId' in target && owned.has(String(target.trackId)));
  return false;
}
