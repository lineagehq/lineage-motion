import type { CueSemantic, CueTargetSnapshot } from './cue-authoring.js';
import type { Diagnostic, MotionDocument, RuleTrack, TimingFunction } from './document.js';
import type { StructuralAuthoringElementId } from './index.js';

export type OperationEnvelope = {
  schemaVersion: 'motion.operation.v1';
  operationId: string;
  documentId: string;
  expectedRevision: number;
};

export type EditTarget = { elementId: string; trackId: string; keyframeId: string };
export type KeyframeValueOperation = OperationEnvelope & EditTarget & {
  kind: 'motion.keyframe-value.set'; payload: { value: number };
};
export type KeyframeTimeOperation = OperationEnvelope & EditTarget & {
  kind: 'motion.keyframe-time.set'; payload: { timeMs: number };
};
export type HistoryOperation = OperationEnvelope & {
  kind: 'motion.history.undo' | 'motion.history.redo';
};
export type TrackCreateOperation = OperationEnvelope & {
  kind: 'motion.track.create'; elementId: StructuralAuthoringElementId;
  payload: { property: 'opacity'; durationMs: 1000; delayMs: 610; easing: 'linear'; startValue: 0; endValue: 1 };
};
export type KeyframeAddOperation = OperationEnvelope & {
  kind: 'motion.keyframe.add'; elementId: StructuralAuthoringElementId;
  trackId: string; payload: { timeMs: number; value: number };
};
export type KeyframeRemoveOperation = OperationEnvelope & {
  kind: 'motion.keyframe.remove'; elementId: StructuralAuthoringElementId;
  trackId: string; keyframeId: string;
};
export type SlotDurationSetOperation = OperationEnvelope & {
  kind: 'motion.slot-duration.set'; elementId: StructuralAuthoringElementId;
  trackId: string; payload: { durationMs: number };
};
export type BindingDelaySetOperation = OperationEnvelope & {
  kind: 'motion.binding-delay.set'; elementId: StructuralAuthoringElementId;
  trackId: string; payload: { delayMs: number };
};
export type SlotEasingSetOperation = OperationEnvelope & {
  kind: 'motion.slot-easing.set'; elementId: StructuralAuthoringElementId;
  trackId: string; payload: { easing: 'linear' | 'ease-in-out' };
};
export type HoldInsertOperation = OperationEnvelope & {
  kind: 'motion.hold.insert'; payload: { cueId: 'cue_pair'; durationMs: 600 };
};
export type TransformPose = {
  translateXMicrounits: number;
  translateYMicrounits: number;
  scalePpm: number;
  rotateMicrodegrees: number;
};
export type StageProjection = {
  stageDigest: string;
  widthMicrounits: number;
  heightMicrounits: number;
};
export type TrajectoryTarget = EditTarget & { expectedTransform: string };
export type TransformPoseSetOperation = OperationEnvelope & TrajectoryTarget & {
  kind: 'motion.transform-pose.set';
  payload: { pose: TransformPose; stage: StageProjection };
};
export type TransformWaypointsTranslateOperation = OperationEnvelope & {
  kind: 'motion.transform-waypoints.translate';
  payload: { targets: TrajectoryTarget[]; deltaXPpm: number; deltaYPpm: number; stage: StageProjection };
};
export type TrajectoryInsertionTarget = {
  elementId: string;
  trackId: string;
  beforeKeyframeId: string;
  afterKeyframeId: string;
  expectedBeforeTransform: string;
  expectedAfterTransform: string;
};
export type TransformWaypointAddOperation = OperationEnvelope & {
  kind: 'motion.transform-waypoint.add';
  payload: { targets: TrajectoryInsertionTarget[]; timeMs: number };
};
export type TransformWaypointRemoveOperation = OperationEnvelope & {
  kind: 'motion.transform-waypoint.remove';
  payload: { targets: TrajectoryTarget[]; timeMs: number };
};
export type KeyframeGroupTimeSetOperation = OperationEnvelope & {
  kind: 'motion.keyframe-group-time.set';
  payload: { targets: TrajectoryTarget[]; sourceTimeMs: number; targetTimeMs: number; landingTimeMs: number; settledTimeMs: number };
};
export type KeyframeGroupEasingSetOperation = OperationEnvelope & {
  kind: 'motion.keyframe-group-easing.set';
  payload: { targets: TrajectoryTarget[]; expectedEasing: TimingFunction; easing: TimingFunction };
};
export type SettledHoldSetOperation = OperationEnvelope & {
  kind: 'motion.settled-hold.set';
  payload: { targets: TrajectoryTarget[]; sourceTimeMs: number; settledTimeMs: number; landingTimeMs: number; boundaryTimeMs: 2100 };
};
export type CueCreateOperation = OperationEnvelope & {
  kind: 'motion.cue.create';
  payload: { cueId: string; semantic: CueSemantic; targetSnapshots: CueTargetSnapshot[];
    replacementTrackIds: string[]; replacementInputDigest: string | null };
};
export type CueUpdateOperation = OperationEnvelope & {
  kind: 'motion.cue.update';
  payload: { cueId: string; expectedExpansionDigest: string; semantic: CueSemantic;
    targetSnapshots: CueTargetSnapshot[] };
};
export type CueDeleteOperation = OperationEnvelope & {
  kind: 'motion.cue.delete'; payload: { cueId: string; expectedExpansionDigest: string;
    expectedReplacementInputDigest: string | null };
};
export type CueDetachOperation = OperationEnvelope & {
  kind: 'motion.cue.detach'; payload: { cueId: string; expectedExpansionDigest: string;
    expectedReplacementInputDigest: string | null };
};
export type CueAuthoringOperation = CueCreateOperation | CueUpdateOperation | CueDeleteOperation | CueDetachOperation;
export type TrajectoryAuthoringOperation = TransformPoseSetOperation | TransformWaypointsTranslateOperation
  | TransformWaypointAddOperation | TransformWaypointRemoveOperation
  | KeyframeGroupTimeSetOperation | KeyframeGroupEasingSetOperation | SettledHoldSetOperation;
export type StructuralAuthoringOperation = TrackCreateOperation | KeyframeAddOperation
  | KeyframeRemoveOperation | SlotDurationSetOperation | BindingDelaySetOperation
  | SlotEasingSetOperation | HoldInsertOperation;
export type AuthoringOperation = KeyframeValueOperation | KeyframeTimeOperation
  | StructuralAuthoringOperation | TrajectoryAuthoringOperation | CueAuthoringOperation | HistoryOperation;
export type EditOperation = Exclude<AuthoringOperation, HistoryOperation>;
export type KeyframeEditOperation = KeyframeValueOperation | KeyframeTimeOperation;
export type InternalTrackDeleteOperation = OperationEnvelope & {
  kind: 'motion.internal.track.delete'; elementId: StructuralAuthoringElementId;
  trackId: string; payload: { bundleDigest: string };
};
export type InternalKeyframeRestoreOperation = OperationEnvelope & {
  kind: 'motion.internal.keyframe.restore'; elementId: StructuralAuthoringElementId;
  trackId: string; keyframe: RuleTrack['keyframes'][number];
};
export type InternalHoldRemoveOperation = OperationEnvelope & {
  kind: 'motion.internal.hold.remove'; payload: { holdId: string; contentDigest: string };
};
export type InternalTrajectoryRestoreOperation = OperationEnvelope & {
  kind: 'motion.internal.trajectory.restore';
  payload: { expectedContentDigest: string; restore: MotionDocument };
};
export type ReducerOperation = EditOperation | InternalTrackDeleteOperation | InternalKeyframeRestoreOperation
  | InternalHoldRemoveOperation | InternalTrajectoryRestoreOperation;

export type EditRecord = {
  forward: ReducerOperation;
  inverse: ReducerOperation;
};

export type AuthoringState = {
  document: MotionDocument;
  consumedOperationIds: string[];
  undo: EditRecord[];
  redo: EditRecord[];
};

export type AuthoringResult =
  | { ok: true; state: AuthoringState }
  | { ok: false; state: AuthoringState; diagnostic: Diagnostic };
