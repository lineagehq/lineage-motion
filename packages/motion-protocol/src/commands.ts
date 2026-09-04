import type {
  CueAuthoringOperation,
  HistoryOperation,
  PreparedOperationIntent,
  TrajectoryAuthoringOperation,
} from '../../domain/src/index.ts';
import {
  MAIN_BRANCH_ID,
  PROTOCOL_VERSION,
  commandSchema,
  type ClaimAcquireCommand,
  type CueCommand,
  type MotionCommand,
  type OperationIntentCommand,
  type TrackCreateCommand,
} from './index.js';

function envelope(operation: MotionCommand['command'], branch: string): MotionCommand {
  return commandSchema.parse({
    protocolVersion: PROTOCOL_VERSION, operationId: operation.operationId, documentId: operation.documentId,
    branchId: branch, expectedRevision: operation.expectedRevision, command: operation,
  });
}

export function makeTrackCreateCommand(input: { operationId: string; documentId: string; expectedRevision: number;
  branchId?: string; elementId: 'el_a2849ff826f3e167' | 'el_2dbee68b1ea318c8' }): TrackCreateCommand {
  return envelope({ schemaVersion: 'motion.operation.v1', kind: 'motion.track.create', operationId: input.operationId,
    documentId: input.documentId, expectedRevision: input.expectedRevision, elementId: input.elementId,
    payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 } }, input.branchId ?? MAIN_BRANCH_ID) as TrackCreateCommand;
}

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
  expectedRevision: number; branchId: string }): MotionCommand {
  return envelope({ schemaVersion: 'motion.control.v1', kind: 'motion.branch.create', operationId: input.operationId,
    documentId: input.documentId, expectedRevision: input.expectedRevision,
    payload: { branchId: input.branchId } }, input.sourceBranchId ?? MAIN_BRANCH_ID);
}

export function makeClaimAcquireCommand(input: { operationId: string; documentId: string; branchId?: string;
  expectedRevision: number; scope: 'document' | 'branch' }): ClaimAcquireCommand {
  const branch = input.branchId ?? MAIN_BRANCH_ID;
  return envelope({ schemaVersion: 'motion.control.v1', kind: 'motion.claim.acquire', operationId: input.operationId,
    documentId: input.documentId, expectedRevision: input.expectedRevision,
    payload: input.scope === 'document' ? { scope: 'document' } : { scope: 'branch', branchId: branch } }, branch) as ClaimAcquireCommand;
}

export function makeClaimControlCommand(input: { kind: 'motion.claim.renew' | 'motion.claim.release' | 'motion.claim.revoke';
  operationId: string; documentId: string; branchId?: string; expectedRevision: number; claimId: string;
  leaseVersion: number }): MotionCommand {
  return envelope({ schemaVersion: 'motion.control.v1', kind: input.kind,
    operationId: input.operationId, documentId: input.documentId, expectedRevision: input.expectedRevision,
    payload: { claimId: input.claimId, leaseVersion: input.leaseVersion } }, input.branchId ?? MAIN_BRANCH_ID);
}
