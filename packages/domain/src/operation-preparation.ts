import type { CueSemantic } from './cue-authoring.js';
import type { TimingFunction, TransformPose } from './index.js';

export const PREPARABLE_OPERATION_KINDS = [
  'motion.transform-pose.set', 'motion.transform-waypoints.translate',
  'motion.transform-waypoint.add', 'motion.transform-waypoint.remove',
  'motion.keyframe-group-time.set', 'motion.keyframe-group-easing.set', 'motion.settled-hold.set',
  'motion.cue.create', 'motion.cue.update', 'motion.cue.delete', 'motion.cue.detach',
] as const;

export type PreparableOperationKind = typeof PREPARABLE_OPERATION_KINDS[number];
export type ViewportIntent = { widthCssPixels: number; heightCssPixels: number };
export type OperationIntentPayload =
  | { kind: 'motion.transform-pose.set'; elementId: string; momentMs: number; pose: TransformPose; viewport: ViewportIntent }
  | { kind: 'motion.transform-waypoints.translate'; elementIds: string[]; momentMs: number;
    deltaXPpm: number; deltaYPpm: number; viewport: ViewportIntent }
  | { kind: 'motion.transform-waypoint.add'; elementIds: string[]; timeMs: number }
  | { kind: 'motion.transform-waypoint.remove'; elementIds: string[]; timeMs: number }
  | { kind: 'motion.keyframe-group-time.set'; elementIds: string[]; sourceTimeMs: number; targetTimeMs: number;
    landingTimeMs: number; settledTimeMs: number }
  | { kind: 'motion.keyframe-group-easing.set'; elementIds: string[]; momentMs: number;
    expectedEasing: TimingFunction; easing: TimingFunction }
  | { kind: 'motion.settled-hold.set'; elementIds: string[]; sourceTimeMs: number; settledTimeMs: number;
    landingTimeMs: number; boundaryTimeMs: 2100 }
  | { kind: 'motion.cue.create'; creationKey: string; semantic: CueSemantic }
  | { kind: 'motion.cue.update'; cueId: string; semantic: CueSemantic }
  | { kind: 'motion.cue.delete' | 'motion.cue.detach'; cueId: string };

export type OperationPreparationRequest = {
  schemaVersion: 'motion.operation-preparation-request.v1';
  documentId: string;
  branchId: string;
  expectedRevision: number;
  kind: PreparableOperationKind;
  intent: OperationIntentPayload;
};

export type PreparedOperationIntent = {
  schemaVersion: 'motion.operation-intent.v1';
  operationId: string;
  documentId: string;
  expectedRevision: number;
  kind: PreparableOperationKind;
  derivationDigest: string;
  intent: OperationIntentPayload;
};

export type OperationPreparation = {
  schemaVersion: 'motion.operation-preparation.v1';
  documentId: string;
  branchId: string;
  revision: number;
  canonicalDigest: string;
  exportDigest: string;
  kind: PreparableOperationKind;
  normalizedIntent: OperationIntentPayload | null;
  resolvedElementIds: string[];
  resolvedTrackIds: string[];
  resolvedKeyframeIds: string[];
  resolvedCueId: string | null;
  resolvedTargetElementIds: string[];
  resolvedReplacementTrackIds: string[];
  expectedExpansionDigest: string | null;
  expectedReplacementInputDigest: string | null;
  stage: { stageDigest: string; widthMicrounits: number; heightMicrounits: number } | null;
  derivationDigest: string | null;
  eligibility: boolean;
  reasonCode: string | null;
};
