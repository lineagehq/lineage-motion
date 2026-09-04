import type { CueSemantic, CueTargetSnapshot } from './cue-authoring.js';
import { timingFunctionSchema } from './document.js';
import type { AuthoringOperation, StageProjection, TrajectoryInsertionTarget, TrajectoryTarget, TransformPose } from './authoring-types.js';
import { validPose, validStage, validTrajectoryInsertionTargets, validTrajectoryTargets } from './trajectory-authoring.js';
import { STRUCTURAL_AUTHORING_ELEMENT_IDS, type StructuralAuthoringElementId } from './index.js';

export function isValidAuthoringOperationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

export function parseOperation(input: unknown): AuthoringOperation | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 'motion.operation.v1'
    || !isValidAuthoringOperationId(value.operationId)
    || typeof value.documentId !== 'string' || value.documentId.length === 0
    || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0
    || !['motion.keyframe-value.set', 'motion.keyframe-time.set', 'motion.track.create',
      'motion.keyframe.add', 'motion.keyframe.remove', 'motion.slot-duration.set',
      'motion.binding-delay.set', 'motion.slot-easing.set',
      'motion.hold.insert',
      'motion.cue.create', 'motion.cue.update', 'motion.cue.delete', 'motion.cue.detach',
      'motion.transform-pose.set', 'motion.transform-waypoints.translate',
      'motion.transform-waypoint.add', 'motion.transform-waypoint.remove',
      'motion.keyframe-group-time.set', 'motion.keyframe-group-easing.set', 'motion.settled-hold.set',
      'motion.history.undo', 'motion.history.redo'].includes(String(value.kind))) {
    return null;
  }
  const baseKeys = ['schemaVersion', 'operationId', 'documentId', 'expectedRevision', 'kind'];
  const base = value as unknown as AuthoringOperation;
  if (base.kind === 'motion.history.undo' || base.kind === 'motion.history.redo') {
    return hasExactObjectKeys(value, baseKeys) ? base : null;
  }
  if (base.kind === 'motion.cue.create' || base.kind === 'motion.cue.update'
    || base.kind === 'motion.cue.delete' || base.kind === 'motion.cue.detach') {
    const payload = plainRecord(value.payload);
    if (!payload || !hasExactObjectKeys(value, [...baseKeys, 'payload'])
      || typeof payload.cueId !== 'string' || !/^cue_[a-f0-9]{24}$/.test(payload.cueId)) return null;
    if (base.kind === 'motion.cue.create') {
      return hasExactObjectKeys(payload, ['cueId', 'semantic', 'targetSnapshots', 'replacementTrackIds', 'replacementInputDigest'])
        && validCueSemanticRecord(payload.semantic) && validCueTargetSnapshotRecords(payload.targetSnapshots)
        && Array.isArray(payload.replacementTrackIds) && payload.replacementTrackIds.every((id) => typeof id === 'string')
        && (payload.replacementInputDigest === null || isDigest(payload.replacementInputDigest)) ? base : null;
    }
    if (base.kind === 'motion.cue.update') {
      return hasExactObjectKeys(payload, ['cueId', 'expectedExpansionDigest', 'semantic', 'targetSnapshots'])
        && isDigest(payload.expectedExpansionDigest) && validCueSemanticRecord(payload.semantic)
        && validCueTargetSnapshotRecords(payload.targetSnapshots) ? base : null;
    }
    return hasExactObjectKeys(payload, ['cueId', 'expectedExpansionDigest', 'expectedReplacementInputDigest'])
      && isDigest(payload.expectedExpansionDigest)
      && (payload.expectedReplacementInputDigest === null || isDigest(payload.expectedReplacementInputDigest)) ? base : null;
  }
  if (base.kind === 'motion.hold.insert') {
    const payload = plainRecord(value.payload);
    return hasExactObjectKeys(value, [...baseKeys, 'payload']) && payload
      && hasExactObjectKeys(payload, ['cueId', 'durationMs'])
      && payload.cueId === 'cue_pair' && payload.durationMs === 600 ? base : null;
  }
  if (base.kind === 'motion.transform-pose.set') {
    const payload = plainRecord(value.payload); const pose = plainRecord(payload?.pose); const stage = plainRecord(payload?.stage);
    return typeof value.elementId === 'string' && typeof value.trackId === 'string' && typeof value.keyframeId === 'string'
      && typeof value.expectedTransform === 'string' && hasExactObjectKeys(value, [...baseKeys, 'elementId', 'trackId', 'keyframeId', 'expectedTransform', 'payload'])
      && payload && hasExactObjectKeys(payload, ['pose', 'stage']) && pose && parsePoseRecord(pose) && stage && parseStageRecord(stage) ? base : null;
  }
  if (base.kind === 'motion.transform-waypoint.add') {
    const payload = plainRecord(value.payload); if (!payload || !hasExactObjectKeys(value, [...baseKeys, 'payload'])
      || !hasExactObjectKeys(payload, ['targets', 'timeMs']) || !Number.isSafeInteger(payload.timeMs)
      || !Array.isArray(payload.targets)) return null;
    const targets = payload.targets.map(plainRecord);
    return targets.every((target) => target && hasExactObjectKeys(target,
      ['elementId', 'trackId', 'beforeKeyframeId', 'afterKeyframeId', 'expectedBeforeTransform', 'expectedAfterTransform'])
      && Object.values(target).every((member) => typeof member === 'string'))
      && validTrajectoryInsertionTargets(payload.targets as TrajectoryInsertionTarget[]) ? base : null;
  }
  if (base.kind === 'motion.transform-waypoints.translate' || base.kind === 'motion.transform-waypoint.remove'
    || base.kind === 'motion.keyframe-group-time.set'
    || base.kind === 'motion.keyframe-group-easing.set' || base.kind === 'motion.settled-hold.set') {
    const payload = plainRecord(value.payload); if (!payload || !hasExactObjectKeys(value, [...baseKeys, 'payload'])) return null;
    const targets = payload.targets; if (!Array.isArray(targets) || !targets.every((target) => {
      const item = plainRecord(target); return item && hasExactObjectKeys(item, ['elementId', 'trackId', 'keyframeId', 'expectedTransform'])
        && ['elementId', 'trackId', 'keyframeId', 'expectedTransform'].every((key) => typeof item[key] === 'string');
    }) || !validTrajectoryTargets(targets as TrajectoryTarget[])) return null;
    if (base.kind === 'motion.transform-waypoints.translate') {
      const stage = plainRecord(payload.stage); return hasExactObjectKeys(payload, ['targets', 'deltaXPpm', 'deltaYPpm', 'stage'])
        && Number.isSafeInteger(payload.deltaXPpm) && Number.isSafeInteger(payload.deltaYPpm) && stage && parseStageRecord(stage) ? base : null;
    }
    if (base.kind === 'motion.transform-waypoint.remove') return hasExactObjectKeys(payload, ['targets', 'timeMs'])
      && Number.isSafeInteger(payload.timeMs) ? base : null;
    if (base.kind === 'motion.keyframe-group-time.set') return hasExactObjectKeys(payload, ['targets', 'sourceTimeMs', 'targetTimeMs', 'landingTimeMs', 'settledTimeMs'])
      && ['sourceTimeMs', 'targetTimeMs', 'landingTimeMs', 'settledTimeMs'].every((key) => Number.isSafeInteger(payload[key])) ? base : null;
    if (base.kind === 'motion.keyframe-group-easing.set') return hasExactObjectKeys(payload, ['targets', 'expectedEasing', 'easing'])
      && timingFunctionSchema.safeParse(payload.expectedEasing).success && timingFunctionSchema.safeParse(payload.easing).success ? base : null;
    return hasExactObjectKeys(payload, ['targets', 'sourceTimeMs', 'settledTimeMs', 'landingTimeMs', 'boundaryTimeMs'])
      && ['sourceTimeMs', 'settledTimeMs', 'landingTimeMs', 'boundaryTimeMs'].every((key) => Number.isSafeInteger(payload[key])) && payload.boundaryTimeMs === 2100 ? base : null;
  }
  const fixedElement = STRUCTURAL_AUTHORING_ELEMENT_IDS.includes(value.elementId as StructuralAuthoringElementId);
  if (base.kind === 'motion.track.create') {
    const payload = plainRecord(value.payload);
    return fixedElement && hasExactObjectKeys(value, [...baseKeys, 'elementId', 'payload'])
      && payload && hasExactObjectKeys(payload,
        ['property', 'durationMs', 'delayMs', 'easing', 'startValue', 'endValue'])
      && payload.property === 'opacity' && payload.durationMs === 1000 && payload.delayMs === 610
      && payload.easing === 'linear' && payload.startValue === 0 && payload.endValue === 1 ? base : null;
  }
  if (base.kind === 'motion.keyframe.add') {
    const payload = plainRecord(value.payload);
    return fixedElement && typeof value.trackId === 'string'
      && hasExactObjectKeys(value, [...baseKeys, 'elementId', 'trackId', 'payload'])
      && payload && hasExactObjectKeys(payload, ['timeMs', 'value'])
      && typeof payload.timeMs === 'number' && typeof payload.value === 'number' ? base : null;
  }
  if (base.kind === 'motion.keyframe.remove') {
    return fixedElement && typeof value.trackId === 'string' && typeof value.keyframeId === 'string'
      && hasExactObjectKeys(value, [...baseKeys, 'elementId', 'trackId', 'keyframeId']) ? base : null;
  }
  if (base.kind === 'motion.slot-duration.set' || base.kind === 'motion.binding-delay.set'
    || base.kind === 'motion.slot-easing.set') {
    const payload = plainRecord(value.payload);
    const member = base.kind === 'motion.slot-duration.set' ? 'durationMs'
      : base.kind === 'motion.binding-delay.set' ? 'delayMs' : 'easing';
    return fixedElement && typeof value.trackId === 'string'
      && hasExactObjectKeys(value, [...baseKeys, 'elementId', 'trackId', 'payload'])
      && payload && hasExactObjectKeys(payload, [member])
      && (member === 'easing' ? typeof payload[member] === 'string'
        : typeof payload[member] === 'number') ? base : null;
  }
  if (typeof value.elementId !== 'string' || typeof value.trackId !== 'string'
    || typeof value.keyframeId !== 'string'
    || !hasExactObjectKeys(value, [...baseKeys, 'elementId', 'trackId', 'keyframeId', 'payload'])) return null;
  const payload = plainRecord(value.payload);
  if (!payload) return null;
  if (base.kind === 'motion.keyframe-value.set'
    && (!hasExactObjectKeys(payload, ['value']) || typeof payload.value !== 'number')) return null;
  if (base.kind === 'motion.keyframe-time.set'
    && (!hasExactObjectKeys(payload, ['timeMs']) || typeof payload.timeMs !== 'number')) return null;
  return base;
}

export function parseAuthoringOperation(input: unknown): AuthoringOperation | null { return parseOperation(input); }

function validCueSemanticRecord(value: unknown): value is CueSemantic {
  const semantic = plainRecord(value); if (!semantic || typeof semantic.kind !== 'string') return false;
  const allInteger = (keys: string[]): boolean => keys.every((key) => Number.isSafeInteger(semantic[key]));
  if (semantic.kind === 'cursor-path') {
    return hasExactObjectKeys(semantic, ['kind', 'cursorTargetId', 'startMs', 'arriveMs', 'easing', 'waypoints'])
      && typeof semantic.cursorTargetId === 'string' && allInteger(['startMs', 'arriveMs'])
      && timingFunctionSchema.safeParse(semantic.easing).success && Array.isArray(semantic.waypoints)
      && semantic.waypoints.every((point) => { const record = plainRecord(point); return record
        && hasExactObjectKeys(record, ['timeMs', 'xPpm', 'yPpm']) && Object.values(record).every(Number.isSafeInteger); });
  }
  if (semantic.kind === 'click') {
    const expected = ['kind', 'cursorTargetId', 'pulseTargetId', 'arriveMs', 'pressMs', 'releaseMs', 'pulseEndMs',
      'pressScalePpm', 'pulseRadiusPpm', 'pulseOpacityPpm'];
    if ('revealCueId' in semantic) expected.push('revealCueId');
    return hasExactObjectKeys(semantic, expected) && typeof semantic.cursorTargetId === 'string'
      && typeof semantic.pulseTargetId === 'string' && (!('revealCueId' in semantic) || typeof semantic.revealCueId === 'string')
      && allInteger(['arriveMs', 'pressMs', 'releaseMs', 'pulseEndMs', 'pressScalePpm', 'pulseRadiusPpm', 'pulseOpacityPpm']);
  }
  if (semantic.kind === 'reveal') return hasExactObjectKeys(semantic, ['kind', 'targetIds', 'startMs', 'completeMs'])
    && Array.isArray(semantic.targetIds) && semantic.targetIds.every((id) => typeof id === 'string')
    && allInteger(['startMs', 'completeMs']);
  if (semantic.kind === 'type') return hasExactObjectKeys(semantic, ['kind', 'targetId', 'startMs', 'completeMs', 'stepCount'])
    && typeof semantic.targetId === 'string' && allInteger(['startMs', 'completeMs', 'stepCount']);
  if (semantic.kind === 'select') {
    const keys = ['kind', 'cursorTargetId', 'selectedTargetId', 'approachMs', 'chooseMs', 'settleMs'];
    if ('highlightTargetId' in semantic) keys.push('highlightTargetId');
    return hasExactObjectKeys(semantic, keys) && typeof semantic.cursorTargetId === 'string'
      && typeof semantic.selectedTargetId === 'string'
      && (!('highlightTargetId' in semantic) || typeof semantic.highlightTargetId === 'string')
      && allInteger(['approachMs', 'chooseMs', 'settleMs']);
  }
  if (semantic.kind === 'drag') return hasExactObjectKeys(semantic, ['kind', 'cursorTargetId', 'draggedTargetId',
    'approachMs', 'pressMs', 'moveStartMs', 'arriveMs', 'releaseMs', 'grabOffsetXPpm', 'grabOffsetYPpm', 'waypoints'])
    && typeof semantic.cursorTargetId === 'string' && typeof semantic.draggedTargetId === 'string'
    && allInteger(['approachMs', 'pressMs', 'moveStartMs', 'arriveMs', 'releaseMs', 'grabOffsetXPpm', 'grabOffsetYPpm'])
    && Array.isArray(semantic.waypoints) && semantic.waypoints.every((point) => { const record = plainRecord(point); return record
      && hasExactObjectKeys(record, ['timeMs', 'xPpm', 'yPpm']) && Object.values(record).every(Number.isSafeInteger); });
  return semantic.kind === 'hold' && hasExactObjectKeys(semantic, ['kind', 'targetIds', 'enterMs', 'durationMs', 'exitMs'])
    && Array.isArray(semantic.targetIds) && semantic.targetIds.every((id) => typeof id === 'string')
    && allInteger(['enterMs', 'durationMs', 'exitMs']);
}

function validCueTargetSnapshotRecords(value: unknown): value is CueTargetSnapshot[] {
  return Array.isArray(value) && value.every((snapshot) => { const record = plainRecord(snapshot); return record
    && hasExactObjectKeys(record, record.contentKind === undefined
      ? ['role', 'ordinal', 'elementId', 'structuralFingerprint']
      : ['role', 'ordinal', 'elementId', 'structuralFingerprint', 'contentKind'])
    && typeof record.role === 'string' && Number.isSafeInteger(record.ordinal) && typeof record.elementId === 'string'
    && typeof record.structuralFingerprint === 'string' && (record.contentKind === undefined || record.contentKind === 'text'); });
}

function isDigest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }

function parsePoseRecord(value: Record<string, unknown>): boolean { return hasExactObjectKeys(value, ['translateXMicrounits', 'translateYMicrounits', 'scalePpm', 'rotateMicrodegrees']) && Object.values(value).every(Number.isSafeInteger) && validPose(value as TransformPose); }
function parseStageRecord(value: Record<string, unknown>): boolean { return hasExactObjectKeys(value, ['stageDigest', 'widthMicrounits', 'heightMicrounits']) && validStage(value as StageProjection); }

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function hasExactObjectKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}
