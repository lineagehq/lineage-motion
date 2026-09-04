import { cssKeyframeTimeQuantizationHalfStep, normalizeCssTimingFunction } from './css-motion-semantics.js';
import { canonicalContentBytes, canonicalJson, formatCanonicalDecimal } from './canonical.js';
import { sha256Hex } from './sha256.js';
import { validateMotionDocument, type MotionDocument, type RuleTrack, type TimelineCue, type TimingFunction } from './document.js';
import type { InternalTrajectoryRestoreOperation, ReducerOperation, StageProjection, TrajectoryAuthoringOperation, TrajectoryInsertionTarget, TrajectoryTarget, TransformPose } from './authoring-types.js';
import { canonicalIdentitySet, structuralId } from './structural-authoring.js';

export type TransformTrajectoryWaypoint = {
  keyframeId: string;
  timeMs: number;
  transformBytes: string;
  pose: TransformPose;
};
export type TransformTrajectoryProjection = {
  eligible: true;
  elementId: string;
  trackId: string;
  ruleId: string;
  slotId: string;
  waypoints: TransformTrajectoryWaypoint[];
} | { eligible: false; elementId: string; code: string };

export type ShotWorkspaceConfig = {
  startMs: number;
  landedMs: number;
  settledMs: number;
  targetElementIds: string[];
};

export function parseTransformPose(value: string): TransformPose | null {
  const source = value.trim();
  if (source === 'none') return { translateXMicrounits: 0, translateYMicrounits: 0, scalePpm: 1_000_000, rotateMicrodegrees: 0 };
  const functions = [...source.matchAll(/([a-zA-Z0-9]+)\(([^()]*)\)/g)];
  if (functions.length === 0 || functions.map((item) => item[0]).join(' ') !== source.replace(/\s+/g, ' ')) return null;
  const pose: TransformPose = { translateXMicrounits: 0, translateYMicrounits: 0, scalePpm: 1_000_000, rotateMicrodegrees: 0 };
  const seen = new Set<string>();
  const decimal = (raw: string): number | null => /^-?(?:\d+|\d*\.\d+)$/.test(raw.trim()) ? Number(raw) : null;
  for (const [, rawName, rawArgs] of functions) {
    const name = rawName!.toLowerCase();
    if (seen.has(name)) return null;
    seen.add(name);
    const args = rawArgs!.split(/\s*,\s*|\s+/).filter(Boolean);
    if (name === 'translate' || name === 'translate3d') {
      if ((name === 'translate' && (args.length < 1 || args.length > 2)) || (name === 'translate3d' && args.length !== 3)) return null;
      if (name === 'translate3d' && !/^0(?:px)?$/.test(args[2]!)) return null;
      const x = parseTranslateLength(args[0]!);
      const y = parseTranslateLength(args[1] ?? '0px');
      if (x === null || y === null) return null;
      pose.translateXMicrounits = x;
      pose.translateYMicrounits = y;
    } else if (name === 'translatex' || name === 'translatey') {
      if (args.length !== 1) return null;
      const length = parseTranslateLength(args[0]!); if (length === null) return null;
      pose[name === 'translatex' ? 'translateXMicrounits' : 'translateYMicrounits'] = length;
    } else if (name === 'scale') {
      if (args.length < 1 || args.length > 2) return null;
      const first = decimal(args[0]!); const second = args[1] ? decimal(args[1]) : first;
      if (first === null || second === null || first !== second) return null;
      pose.scalePpm = Math.round(first * 1_000_000);
    } else if (name === 'rotate') {
      if (args.length !== 1) return null;
      const match = /^(-?(?:\d+|\d*\.\d+))deg$/.exec(args[0]!); if (!match) return null;
      pose.rotateMicrodegrees = Math.round(Number(match[1]) * 1_000_000);
    } else return null;
  }
  return validPose(pose) ? pose : null;
}

export function serializeTransformPose(pose: TransformPose): string {
  if (!validPose(pose)) throw new Error('TRAJECTORY_POSE_INVALID');
  const unit = (value: number, scale: number) => formatCanonicalDecimal(value / scale);
  return `translate(${unit(pose.translateXMicrounits, 1_000_000)}px, ${unit(pose.translateYMicrounits, 1_000_000)}px) scale(${unit(pose.scalePpm, 1_000_000)}) rotate(${unit(pose.rotateMicrodegrees, 1_000_000)}deg)`;
}

export function projectTransformTrajectory(document: MotionDocument, elementId: string): TransformTrajectoryProjection {
  if (!validateMotionDocument(document).ok) return { eligible: false, elementId, code: 'TRAJECTORY_DOCUMENT_INVALID' };
  const tracks = document.tracks.filter((track) => track.elementId === elementId && track.property === 'transform');
  if (tracks.length !== 1) return { eligible: false, elementId, code: tracks.length ? 'TRAJECTORY_TRACK_AMBIGUOUS' : 'TRAJECTORY_TRACK_MISSING' };
  const track = tracks[0]!;
  const rule = document.rules.find((candidate) => candidate.id === track.ruleId);
  const ruleTrack = rule?.tracks.find((candidate) => candidate.property === 'transform');
  const application = document.applications.find((candidate) => candidate.slots.some((slot) => slot.id === track.slotId));
  const slotIndex = application?.slots.findIndex((slot) => slot.id === track.slotId) ?? -1;
  const slot = application?.slots[slotIndex];
  const binding = application?.bindings.find((candidate) => candidate.elementId === elementId);
  if (!rule || !ruleTrack || !application || !slot || !binding || slotIndex < 0) return { eligible: false, elementId, code: 'TRAJECTORY_RELATIONSHIP_INVALID' };
  if (document.tracks.filter((candidate) => candidate.ruleId === rule.id && candidate.property === 'transform').length !== 1) {
    return { eligible: false, elementId, code: 'TRAJECTORY_SHARED_RULE_AMBIGUOUS' };
  }
  const delay = binding.delayOverridesMs[slotIndex]; if (delay === undefined || slot.iterationCount !== 1 || slot.direction !== 'normal') return { eligible: false, elementId, code: 'TRAJECTORY_TIMING_UNSUPPORTED' };
  const projectedTimes = projectTrajectoryKeyframeTimes(ruleTrack, delay, slot.durationMs, document.durationMs);
  if (!projectedTimes) return { eligible: false, elementId, code: 'TRAJECTORY_TIME_UNREPRESENTABLE' };
  const waypoints: TransformTrajectoryWaypoint[] = [];
  for (const keyframe of ruleTrack.keyframes) {
    const timeMs = projectedTimes.get(keyframe.id)!;
    const pose = parseTransformPose(keyframe.value);
    if (!pose) return { eligible: false, elementId, code: 'TRAJECTORY_TRANSFORM_UNSUPPORTED' };
    waypoints.push({ keyframeId: keyframe.id, timeMs, transformBytes: keyframe.value, pose });
  }
  return { eligible: true, elementId, trackId: track.id, ruleId: rule.id, slotId: slot.id, waypoints };
}

export function projectShotWorkspace(document: MotionDocument, config: ShotWorkspaceConfig): {
  eligible: boolean; code: string | null; startMs: number; landedMs: number; settledMs: number;
  trajectories: TransformTrajectoryProjection[]; continuityTimesMs: number[];
} {
  if (!exactShotConfig(config) || config.startMs !== 0 || config.landedMs !== 700 || config.settledMs !== 2100
    || config.targetElementIds.length !== 2 || new Set(config.targetElementIds).size !== 2) {
    return { eligible: false, code: 'SHOT_CONFIG_INVALID', startMs: config.startMs, landedMs: config.landedMs, settledMs: config.settledMs, trajectories: [], continuityTimesMs: [] };
  }
  const trajectories = config.targetElementIds.map((id) => projectTransformTrajectory(document, id));
  if (trajectories.some((item) => !item.eligible)) return { eligible: false, code: 'SHOT_TARGET_INELIGIBLE', ...config, trajectories, continuityTimesMs: [] };
  if (trajectories.some((item) => item.eligible && ![0, 700, 2100].every((time) => item.waypoints.some((point) => point.timeMs === time)))) {
    return { eligible: false, code: 'SHOT_BOUNDARY_KEYFRAME_MISSING', ...config, trajectories, continuityTimesMs: [] };
  }
  return { eligible: true, code: null, ...config, trajectories,
    continuityTimesMs: [...new Set(document.cues.filter((cue): cue is TimelineCue => cue.schemaVersion === 'motion.cue.v1')
      .map((cue) => cue.timeMs).filter((time) => time > 2100).concat(document.durationMs > 2100 ? [2101] : []))].sort((a, b) => a - b) };
}

export function projectTrajectorySelection(document: MotionDocument, orderedElementIds: string[], momentMs: number): {
  eligible: boolean; code: string | null; targets: TrajectoryTarget[];
} {
  if (!Number.isSafeInteger(momentMs) || orderedElementIds.length === 0 || new Set(orderedElementIds).size !== orderedElementIds.length) return { eligible: false, code: 'TRAJECTORY_SELECTION_INVALID', targets: [] };
  const targets: TrajectoryTarget[] = [];
  for (const elementId of orderedElementIds) {
    const projected = projectTransformTrajectory(document, elementId);
    if (!projected.eligible) return { eligible: false, code: projected.code, targets: [] };
    const waypoint = projected.waypoints.find((item) => item.timeMs === momentMs);
    if (!waypoint) return { eligible: false, code: 'TRAJECTORY_MOMENT_MISSING', targets: [] };
    targets.push({ elementId, trackId: projected.trackId, keyframeId: waypoint.keyframeId, expectedTransform: waypoint.transformBytes });
  }
  targets.sort((left, right) => `${left.elementId}\0${left.trackId}\0${left.keyframeId}`
    .localeCompare(`${right.elementId}\0${right.trackId}\0${right.keyframeId}`));
  return { eligible: true, code: null, targets };
}

export function applyTrajectoryOperation(document: MotionDocument, operation: TrajectoryAuthoringOperation): { ok: true; document: MotionDocument; inverse: ReducerOperation } | { ok: false; code: string } {
  const before = structuredClone(document);
  const next = structuredClone(document);
  if (operation.kind === 'motion.transform-waypoint.add') {
    const { targets, timeMs } = operation.payload;
    if (!validTrajectoryInsertionTargets(targets) || !completeTrajectoryInsertionBundle(next, targets)
      || !Number.isSafeInteger(timeMs) || timeMs <= 0 || timeMs >= 2100) {
      return { ok: false, code: 'AUTHORING_TRAJECTORY_INSERT_INVALID' };
    }
    for (const target of targets) {
      const trajectory = projectTransformTrajectory(next, target.elementId);
      if (!trajectory.eligible || trajectory.trackId !== target.trackId
        || trajectory.waypoints.some((waypoint) => waypoint.timeMs === timeMs)) {
        return { ok: false, code: 'AUTHORING_TRAJECTORY_INSERT_STALE' };
      }
      const beforePoint = trajectory.waypoints.find((waypoint) => waypoint.keyframeId === target.beforeKeyframeId);
      const afterPoint = trajectory.waypoints.find((waypoint) => waypoint.keyframeId === target.afterKeyframeId);
      if (!beforePoint || !afterPoint || beforePoint.transformBytes !== target.expectedBeforeTransform
        || afterPoint.transformBytes !== target.expectedAfterTransform
        || !(beforePoint.timeMs < timeMs && timeMs < afterPoint.timeMs)) {
        return { ok: false, code: 'AUTHORING_TRAJECTORY_INSERT_STALE' };
      }
      const adjacentIndex = trajectory.waypoints.findIndex((waypoint) => waypoint.keyframeId === beforePoint.keyframeId);
      if (trajectory.waypoints[adjacentIndex + 1]?.keyframeId !== afterPoint.keyframeId) {
        return { ok: false, code: 'AUTHORING_TRAJECTORY_INSERT_STALE' };
      }
      const track = next.tracks.find((candidate) => candidate.id === target.trackId)!;
      const rule = next.rules.find((candidate) => candidate.id === track.ruleId)!;
      const ruleTrack = rule.tracks.find((candidate) => candidate.property === 'transform')!;
      const application = next.applications.find((candidate) => candidate.slots.some((slot) => slot.id === track.slotId))!;
      const slotIndex = application.slots.findIndex((slot) => slot.id === track.slotId);
      const slot = application.slots[slotIndex]!;
      const binding = application.bindings.find((candidate) => candidate.elementId === target.elementId)!;
      const delayMs = binding.delayOverridesMs[slotIndex]!;
      const offset = trajectoryOffsetForTime(timeMs, delayMs, slot.durationMs);
      if (offset === null || offset <= 0 || offset >= 1 || !Number.isSafeInteger(offset * 1_000_000)) {
        return { ok: false, code: 'AUTHORING_TRAJECTORY_TIME_UNREPRESENTABLE' };
      }
      const ratio = (timeMs - beforePoint.timeMs) / (afterPoint.timeMs - beforePoint.timeMs);
      const interpolate = (left: number, right: number) => Math.round(left + (right - left) * ratio);
      const pose: TransformPose = {
        translateXMicrounits: interpolate(beforePoint.pose.translateXMicrounits, afterPoint.pose.translateXMicrounits),
        translateYMicrounits: interpolate(beforePoint.pose.translateYMicrounits, afterPoint.pose.translateYMicrounits),
        scalePpm: interpolate(beforePoint.pose.scalePpm, afterPoint.pose.scalePpm),
        rotateMicrodegrees: interpolate(beforePoint.pose.rotateMicrodegrees, afterPoint.pose.rotateMicrodegrees),
      };
      if (!validPose(pose)) return { ok: false, code: 'AUTHORING_TRAJECTORY_INSERT_INVALID' };
      const keyframeId = structuralId('kf', `${track.id}\0transform\0${Math.round(offset * 1_000_000)}`);
      if (canonicalIdentitySet(next).has(keyframeId)) return { ok: false, code: 'AUTHORING_ID_COLLISION' };
      const sourceFrame = ruleTrack.keyframes.find((frame) => frame.id === beforePoint.keyframeId)!;
      const insertion = ruleTrack.keyframes.findIndex((frame) => frame.offset > offset);
      if (insertion < 1) return { ok: false, code: 'AUTHORING_TRAJECTORY_INSERT_INVALID' };
      ruleTrack.keyframes.splice(insertion, 0, {
        id: keyframeId,
        offset,
        value: serializeTransformPose(pose),
        ...(sourceFrame.easing ? { easing: structuredClone(sourceFrame.easing) } : {}),
      });
      track.keyframeIds = ruleTrack.keyframes.map((frame) => frame.id);
    }
    const inverse: InternalTrajectoryRestoreOperation = { schemaVersion: operation.schemaVersion,
      operationId: operation.operationId, documentId: operation.documentId, expectedRevision: operation.expectedRevision,
      kind: 'motion.internal.trajectory.restore', payload: {
        expectedContentDigest: sha256Hex(canonicalContentBytes(next)), restore: before,
      } };
    return { ok: true, document: next, inverse };
  }
  const targets = operation.kind === 'motion.transform-pose.set' ? [{ elementId: operation.elementId, trackId: operation.trackId, keyframeId: operation.keyframeId, expectedTransform: operation.expectedTransform }] : operation.payload.targets;
  if (!validTrajectoryTargets(targets)) return { ok: false, code: 'AUTHORING_TRAJECTORY_BUNDLE_INVALID' };
  const resolved = targets.map((target) => resolveTrajectoryTarget(next, target));
  if (resolved.some((item) => !item)) return { ok: false, code: 'AUTHORING_TRAJECTORY_TARGET_INVALID' };
  const entries = resolved as NonNullable<ReturnType<typeof resolveTrajectoryTarget>>[];
  if (operation.kind === 'motion.transform-waypoint.remove') {
    const { timeMs } = operation.payload;
    if (!Number.isSafeInteger(timeMs) || timeMs <= 0 || timeMs >= 2100
      || !completeTrajectoryMomentBundle(next, entries, timeMs)) {
      return { ok: false, code: 'AUTHORING_TRAJECTORY_REMOVE_INVALID' };
    }
    for (const entry of uniqueRuleEntries(entries)) {
      if (entry.timeMs !== timeMs || entry.ruleTrack.keyframes.length <= 3) {
        return { ok: false, code: 'AUTHORING_TRAJECTORY_REMOVE_INVALID' };
      }
      const index = entry.ruleTrack.keyframes.findIndex((frame) => frame.id === entry.keyframe.id);
      if (index <= 0 || index >= entry.ruleTrack.keyframes.length - 1) {
        return { ok: false, code: 'AUTHORING_TRAJECTORY_REMOVE_INVALID' };
      }
      entry.ruleTrack.keyframes.splice(index, 1);
      entry.track.keyframeIds = entry.ruleTrack.keyframes.map((frame) => frame.id);
    }
  } else if (operation.kind === 'motion.transform-pose.set') {
    if (!validStage(operation.payload.stage) || !validPose(operation.payload.pose)) return { ok: false, code: 'AUTHORING_TRAJECTORY_PAYLOAD_INVALID' };
    const value = serializeTransformPose(operation.payload.pose);
    if (value === entries[0]!.keyframe.value) return { ok: false, code: 'AUTHORING_ZERO_CHANGE' };
    entries[0]!.keyframe.value = value;
  } else if (operation.kind === 'motion.transform-waypoints.translate') {
    const { deltaXPpm, deltaYPpm, stage } = operation.payload;
    if (!validStage(stage) || !Number.isSafeInteger(deltaXPpm) || !Number.isSafeInteger(deltaYPpm)
      || (deltaXPpm === 0 && deltaYPpm === 0) || Math.abs(deltaXPpm) > 1_000_000 || Math.abs(deltaYPpm) > 1_000_000) return { ok: false, code: 'AUTHORING_TRAJECTORY_PAYLOAD_INVALID' };
    const dx = stage.widthMicrounits * deltaXPpm / 1_000_000; const dy = stage.heightMicrounits * deltaYPpm / 1_000_000;
    if (!Number.isSafeInteger(dx) || !Number.isSafeInteger(dy)) return { ok: false, code: 'AUTHORING_TRAJECTORY_PRECISION_INVALID' };
    for (const entry of entries) { const pose = parseTransformPose(entry.keyframe.value)!;
      entry.keyframe.value = serializeTransformPose({ ...pose, translateXMicrounits: pose.translateXMicrounits + dx, translateYMicrounits: pose.translateYMicrounits + dy }); }
  } else if (operation.kind === 'motion.keyframe-group-time.set') {
    const { sourceTimeMs, targetTimeMs, landingTimeMs, settledTimeMs } = operation.payload;
    if (![sourceTimeMs, targetTimeMs, landingTimeMs, settledTimeMs].every(Number.isSafeInteger)
      || targetTimeMs < 1 || targetTimeMs > 2100 || landingTimeMs < 1 || landingTimeMs >= settledTimeMs || settledTimeMs > 2100
      || sourceTimeMs === targetTimeMs) return { ok: false, code: 'AUTHORING_TRAJECTORY_TIME_INVALID' };
    if (!completeTrajectoryMomentBundle(next, entries, sourceTimeMs)) return { ok: false, code: 'AUTHORING_TRAJECTORY_BUNDLE_INCOMPLETE' };
    for (const entry of uniqueRuleEntries(entries)) { if (entry.timeMs !== sourceTimeMs) return { ok: false, code: 'AUTHORING_TRAJECTORY_TIME_STALE' };
      const offset = (targetTimeMs - entry.delayMs) / entry.slot.durationMs;
      if (!Number.isFinite(offset) || offset < 0 || offset > 1 || !Number.isSafeInteger(offset * 1_000_000)
        || entry.ruleTrack.keyframes.some((frame) => frame.id !== entry.keyframe.id && frame.offset === offset)) return { ok: false, code: 'AUTHORING_TRAJECTORY_TIME_COLLISION' };
      entry.keyframe.offset = offset; entry.ruleTrack.keyframes.sort((a, b) => a.offset - b.offset);
      entry.track.keyframeIds = entry.ruleTrack.keyframes.map((frame) => frame.id); }
  } else if (operation.kind === 'motion.keyframe-group-easing.set') {
    let expected: TimingFunction; let easing: TimingFunction;
    try { expected = normalizeCssTimingFunction(operation.payload.expectedEasing); easing = normalizeCssTimingFunction(operation.payload.easing); } catch { return { ok: false, code: 'AUTHORING_TRAJECTORY_EASING_INVALID' }; }
    if (canonicalJson(expected) === canonicalJson(easing)) return { ok: false, code: 'AUTHORING_ZERO_CHANGE' };
    for (const entry of uniqueRuleEntries(entries)) { if (canonicalJson(entry.keyframe.easing ?? entry.slot.timingFunction) !== canonicalJson(expected)) return { ok: false, code: 'AUTHORING_TRAJECTORY_EASING_STALE' }; entry.keyframe.easing = easing; }
  } else {
    const { sourceTimeMs, settledTimeMs, landingTimeMs, boundaryTimeMs } = operation.payload;
    if (boundaryTimeMs !== 2100 || !Number.isSafeInteger(settledTimeMs) || settledTimeMs <= landingTimeMs || settledTimeMs >= 2100 || sourceTimeMs !== 2100
      || !completeTrajectoryMomentBundle(next, entries, sourceTimeMs)) return { ok: false, code: 'AUTHORING_TRAJECTORY_HOLD_INVALID' };
    for (const entry of uniqueRuleEntries(entries)) {
      const projectedTimes = projectTrajectoryKeyframeTimes(entry.ruleTrack, entry.delayMs,
        entry.slot.durationMs, next.durationMs);
      if (!projectedTimes || entry.timeMs !== sourceTimeMs
        || entry.ruleTrack.keyframes.some((frame) => { const time = projectedTimes.get(frame.id)!;
          return time > settledTimeMs && time < 2100; })) return { ok: false, code: 'AUTHORING_TRAJECTORY_HOLD_COLLISION' };
      const settledOffset = trajectoryOffsetForTime(settledTimeMs, entry.delayMs, entry.slot.durationMs);
      const boundaryOffset = trajectoryOffsetForTime(boundaryTimeMs, entry.delayMs, entry.slot.durationMs);
      if (settledOffset === null || boundaryOffset === null || settledOffset <= 0 || settledOffset >= 1) {
        return { ok: false, code: 'AUTHORING_TRAJECTORY_TIME_UNREPRESENTABLE' };
      }
      const holdKeyframeId = structuralId('hold_kf', `${entry.track.id}\0${boundaryTimeMs}`);
      if (entry.ruleTrack.keyframes.some((frame) => frame.id === holdKeyframeId)) {
        return { ok: false, code: 'AUTHORING_TRAJECTORY_HOLD_COLLISION' };
      }
      const candidate = structuredClone(entry.ruleTrack);
      const sourceKeyframe = candidate.keyframes.find((frame) => frame.id === entry.keyframe.id)!;
      sourceKeyframe.offset = settledOffset;
      candidate.keyframes.push({ id: holdKeyframeId, offset: boundaryOffset, value: entry.keyframe.value });
      candidate.keyframes.sort((a, b) => a.offset - b.offset);
      const candidateTimes = projectTrajectoryKeyframeTimes(candidate, entry.delayMs,
        entry.slot.durationMs, next.durationMs);
      if (!candidateTimes || candidateTimes.get(sourceKeyframe.id) !== settledTimeMs
        || candidateTimes.get(holdKeyframeId) !== boundaryTimeMs) {
        return { ok: false, code: 'AUTHORING_TRAJECTORY_TIME_UNREPRESENTABLE' };
      }
      entry.ruleTrack.keyframes = candidate.keyframes;
      entry.track.keyframeIds = entry.ruleTrack.keyframes.map((frame) => frame.id);
    }
  }
  if (sha256Hex(canonicalContentBytes(before)) === sha256Hex(canonicalContentBytes(next))) return { ok: false, code: 'AUTHORING_ZERO_CHANGE' };
  const inverse: InternalTrajectoryRestoreOperation = { schemaVersion: operation.schemaVersion, operationId: operation.operationId,
    documentId: operation.documentId, expectedRevision: operation.expectedRevision, kind: 'motion.internal.trajectory.restore',
    payload: { expectedContentDigest: sha256Hex(canonicalContentBytes(next)), restore: before } };
  return { ok: true, document: next, inverse };
}

export function resolveTrajectoryTarget(document: MotionDocument, target: TrajectoryTarget) {
  const track = document.tracks.find((item) => item.id === target.trackId && item.elementId === target.elementId && item.property === 'transform');
  const rule = track && document.rules.find((item) => item.id === track.ruleId); const ruleTrack = rule?.tracks.find((item) => item.property === 'transform');
  const application = track && document.applications.find((item) => item.slots.some((slot) => slot.id === track.slotId));
  const slotIndex = application?.slots.findIndex((slot) => slot.id === track?.slotId) ?? -1; const slot = application?.slots[slotIndex];
  const binding = application?.bindings.find((item) => item.elementId === target.elementId); const delayMs = binding?.delayOverridesMs[slotIndex];
  const keyframe = ruleTrack?.keyframes.find((item) => item.id === target.keyframeId);
  if (!track || !ruleTrack || !application || !slot || delayMs === undefined || !keyframe || keyframe.value !== target.expectedTransform || !parseTransformPose(keyframe.value)) return null;
  const projectedTimes = projectTrajectoryKeyframeTimes(ruleTrack, delayMs, slot.durationMs, document.durationMs);
  if (!projectedTimes) return null;
  const timeMs = projectedTimes.get(keyframe.id); if (timeMs === undefined) return null;
  return { track, ruleTrack, application, slot, delayMs, keyframe, timeMs };
}
function uniqueRuleEntries<T extends { ruleTrack: RuleTrack }>(entries: T[]): T[] { return entries.filter((entry, index) => entries.findIndex((candidate) => candidate.ruleTrack.id === entry.ruleTrack.id) === index); }
export function completeTrajectoryMomentBundle(document: MotionDocument, entries: NonNullable<ReturnType<typeof resolveTrajectoryTarget>>[], timeMs: number): boolean {
  const selectedRuleIds = new Set(entries.map((entry) => entry.track.ruleId));
  const expected: string[] = [];
  for (const track of document.tracks.filter((candidate) => candidate.property === 'transform' && selectedRuleIds.has(candidate.ruleId))) {
    const projection = projectTransformTrajectory(document, track.elementId); if (!projection.eligible) return false;
    const point = projection.waypoints.find((item) => item.timeMs === timeMs);
    if (point) expected.push(`${track.id}\0${point.keyframeId}`);
  }
  expected.sort();
  const actual = entries.map((entry) => `${entry.track.id}\0${entry.keyframe.id}`).sort(); return canonicalJson(expected) === canonicalJson(actual);
}
export function completeTrajectoryInsertionBundle(document: MotionDocument, targets: TrajectoryInsertionTarget[]): boolean {
  const selectedRuleIds = new Set(targets.map((target) => document.tracks.find((track) => track.id === target.trackId)?.ruleId)
    .filter((ruleId): ruleId is string => Boolean(ruleId)));
  const expected = document.tracks.filter((track) => track.property === 'transform' && selectedRuleIds.has(track.ruleId))
    .map((track) => `${track.elementId}\0${track.id}`).sort();
  const actual = targets.map((target) => `${target.elementId}\0${target.trackId}`).sort();
  return canonicalJson(expected) === canonicalJson(actual);
}
function projectTrajectoryKeyframeTimes(ruleTrack: RuleTrack, delayMs: number, durationMs: number,
  maximumTimeMs: number): Map<string, number> | null {
  const maximumDeltaMilliseconds = cssKeyframeTimeQuantizationHalfStep(durationMs);
  if (![delayMs, durationMs, maximumTimeMs].every(Number.isSafeInteger)
    || delayMs < 0 || durationMs <= 0 || maximumTimeMs < 0
    || new Set(ruleTrack.keyframes.map((keyframe) => keyframe.id)).size !== ruleTrack.keyframes.length) return null;
  const projected = new Map<string, number>(); const occupied = new Set<number>();
  for (const keyframe of ruleTrack.keyframes) {
    if (!Number.isFinite(keyframe.offset) || keyframe.offset < 0 || keyframe.offset > 1) return null;
    const sourceTimeMs = delayMs + keyframe.offset * durationMs;
    const integerTimeMs = Math.round(sourceTimeMs);
    const lowerBoundaryMs = integerTimeMs - maximumDeltaMilliseconds;
    const upperBoundaryMs = integerTimeMs + maximumDeltaMilliseconds;
    if (!Number.isFinite(sourceTimeMs) || !Number.isSafeInteger(integerTimeMs)
      || sourceTimeMs < 0 || sourceTimeMs > maximumTimeMs
      || !(sourceTimeMs > lowerBoundaryMs && sourceTimeMs < upperBoundaryMs)
      || occupied.has(integerTimeMs)) return null;
    occupied.add(integerTimeMs); projected.set(keyframe.id, integerTimeMs);
  }
  return projected;
}
function trajectoryOffsetForTime(timeMs: number, delayMs: number, durationMs: number): number | null {
  if (![timeMs, delayMs, durationMs].every(Number.isSafeInteger) || delayMs < 0 || durationMs <= 0) return null;
  const offset = (timeMs - delayMs) / durationMs;
  return Number.isFinite(offset) && offset >= 0 && offset <= 1 ? offset : null;
}
function parseTranslateLength(raw: string): number | null {
  const source = raw.trim();
  if (/^[+-]?(?:0+(?:\.0*)?|\.0+)(?:e[+-]?\d+)?$/i.test(source)) return 0;
  const px = /^(-?(?:\d+|\d*\.\d+))px$/.exec(source);
  if (!px) return null;
  const [, sign = '', whole = '', fraction = ''] = /^(-?)(\d*)(?:\.(\d+))?$/.exec(px[1]!)!;
  if (fraction.length > 6 && /[1-9]/.test(fraction.slice(6))) return null;
  const magnitude = BigInt(whole || '0') * 1_000_000n + BigInt(fraction.slice(0, 6).padEnd(6, '0') || '0');
  const microunits = sign === '-' ? -magnitude : magnitude;
  if (microunits < BigInt(Number.MIN_SAFE_INTEGER) || microunits > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(microunits);
}
export function validTrajectoryTargets(value: TrajectoryTarget[]): boolean { return value.length > 0 && value.every((target) => target && typeof target.elementId === 'string' && typeof target.trackId === 'string' && typeof target.keyframeId === 'string' && typeof target.expectedTransform === 'string') && new Set(value.map((target) => `${target.elementId}\0${target.trackId}\0${target.keyframeId}`)).size === value.length && value.every((target, index) => index === 0 || `${value[index - 1]!.elementId}\0${value[index - 1]!.trackId}` < `${target.elementId}\0${target.trackId}`); }
export function validTrajectoryInsertionTargets(value: TrajectoryInsertionTarget[]): boolean {
  if (!Array.isArray(value) || value.length === 0) return false;
  const keys = value.map((target) => `${target.elementId}\0${target.trackId}`);
  return new Set(keys).size === keys.length && value.every((target, index) => target
    && ['elementId', 'trackId', 'beforeKeyframeId', 'afterKeyframeId', 'expectedBeforeTransform', 'expectedAfterTransform']
      .every((key) => typeof target[key as keyof TrajectoryInsertionTarget] === 'string')
    && (index === 0 || keys[index - 1]! < keys[index]!));
}
export function validPose(pose: TransformPose): boolean { return [pose.translateXMicrounits, pose.translateYMicrounits, pose.scalePpm, pose.rotateMicrodegrees].every(Number.isSafeInteger) && pose.scalePpm > 0 && pose.scalePpm <= 10_000_000; }
export function validStage(stage: StageProjection): boolean { return /^[a-f0-9]{64}$/.test(stage.stageDigest) && Number.isSafeInteger(stage.widthMicrounits) && stage.widthMicrounits > 0 && Number.isSafeInteger(stage.heightMicrounits) && stage.heightMicrounits > 0; }
function exactShotConfig(config: ShotWorkspaceConfig): boolean { return config && Object.keys(config).sort().join(',') === 'landedMs,settledMs,startMs,targetElementIds' && [config.startMs, config.landedMs, config.settledMs].every(Number.isSafeInteger) && Array.isArray(config.targetElementIds) && config.targetElementIds.every((id) => typeof id === 'string'); }
