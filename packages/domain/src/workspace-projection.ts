import { canonicalBytes, projectTrackCreationEligibility, sha256Hex, type MotionDocument, type TimingFunction } from './index.js';
import { isAuthoringCue, type CueSemantic } from './cue-authoring.js';

export const DURABLE_OPERATION_KINDS = [
  'motion.track.create', 'motion.keyframe-value.set', 'motion.keyframe-time.set', 'motion.keyframe.add',
  'motion.keyframe.remove', 'motion.slot-duration.set', 'motion.binding-delay.set', 'motion.slot-easing.set',
  'motion.hold.insert', 'motion.transform-pose.set', 'motion.transform-waypoints.translate',
  'motion.transform-waypoint.add', 'motion.transform-waypoint.remove',
  'motion.keyframe-group-time.set', 'motion.keyframe-group-easing.set', 'motion.settled-hold.set',
  'motion.cue.create', 'motion.cue.update', 'motion.cue.delete', 'motion.cue.detach',
  'motion.history.undo', 'motion.history.redo', 'motion.branch.create', 'motion.claim.acquire',
  'motion.claim.renew', 'motion.claim.release', 'motion.claim.revoke',
] as const;

export type DurableOperationKind = typeof DURABLE_OPERATION_KINDS[number];
export type WritableValue = { kind: 'number'; value: number } | { kind: 'transform'; value: string };
export type WorkspaceProjection = {
  schemaVersion: 'motion.workspace-projection.v1';
  documentId: string;
  branchId: string;
  revision: number;
  canonicalDigest: string;
  durationMs: number;
  inventory: Omit<MotionDocument['inventory'], 'sourceDigest'>;
  elements: Array<{ elementId: string }>;
  tracks: Array<{ trackId: string; elementId: string; ruleId: string; slotId: string; property: string;
    interpolation: MotionDocument['tracks'][number]['interpolation']; cueId: string | null }>;
  rules: Array<{ ruleId: string; tracks: Array<{ ruleTrackId: string; property: string;
    interpolation: MotionDocument['rules'][number]['tracks'][number]['interpolation']; keyframes: Array<{
      keyframeId: string; offset: number; value: WritableValue | null; easing: TimingFunction | null;
      timings: Array<{ slotId: string; elementId: string; timeMs: number }> }> }> }>;
  slots: Array<{ slotId: string; ruleId: string; durationMs: number; delayMs: number;
    timingFunction: TimingFunction; bindings: Array<{ elementId: string; delayMs: number }> }>;
  cues: Array<{ cueId: string; timeMs: number; semantic: CueSemantic | null; expansionDigest: string | null }>;
  holds: Array<{ holdId: string; cueId: string; sourceTimeMs: number; durationMs: number }>;
  history: { undoAvailable: boolean; redoAvailable: boolean };
  eligibility: Array<{ kind: DurableOperationKind; eligible: boolean; reasonCode: string | null }>;
};

export function projectWorkspace(document: MotionDocument, branchId: string,
  history: { undoAvailable: boolean; redoAvailable: boolean }): WorkspaceProjection {
  const slots = document.applications.flatMap((application) => application.slots.map((slot, slotIndex) => ({
    slotId: slot.id, ruleId: slot.ruleId, durationMs: slot.durationMs, delayMs: slot.delayMs,
    timingFunction: structuredClone(slot.timingFunction), bindings: application.bindings.map((binding) => ({
      elementId: binding.elementId, delayMs: binding.delayOverridesMs[slotIndex] ?? slot.delayMs,
    })).sort((left, right) => left.elementId.localeCompare(right.elementId)),
  })));
  return {
    schemaVersion: 'motion.workspace-projection.v1', documentId: document.documentId, branchId,
    revision: document.revision, canonicalDigest: sha256Hex(canonicalBytes(document)), durationMs: document.durationMs,
    inventory: { ruleCount: document.inventory.ruleCount, applicationCount: document.inventory.applicationCount,
      slotCount: document.inventory.slotCount, trackCount: document.inventory.trackCount,
      supportedCount: document.inventory.supportedCount, unsupportedCount: document.inventory.unsupportedCount,
      missingCount: document.inventory.missingCount, diagnosticCodes: [...document.inventory.diagnosticCodes] },
    elements: document.elements.map(({ id }) => ({ elementId: id }))
      .sort((left, right) => left.elementId.localeCompare(right.elementId)),
    tracks: document.tracks.map((track) => ({ trackId: track.id, elementId: track.elementId, ruleId: track.ruleId,
      slotId: track.slotId, property: track.property, interpolation: track.interpolation,
      cueId: track.cueOwnership?.cueId ?? null })).sort((left, right) => left.trackId.localeCompare(right.trackId)),
    rules: document.rules.map((rule) => ({ ruleId: rule.id, tracks: rule.tracks.map((track) => {
      const timingTargets = document.tracks.filter((candidate) => candidate.ruleId === rule.id && candidate.property === track.property)
        .flatMap((candidate) => slots.filter((slot) => slot.slotId === candidate.slotId).flatMap((slot) =>
          slot.bindings.filter((binding) => binding.elementId === candidate.elementId).map((binding) => ({ slot, binding }))));
      return { ruleTrackId: track.id, property: track.property, interpolation: track.interpolation,
        keyframes: track.keyframes.map((frame) => ({ keyframeId: frame.id, offset: frame.offset,
          value: writableValue(track.property, frame.value), easing: frame.easing ? structuredClone(frame.easing) : null,
          timings: timingTargets.map(({ slot, binding }) => ({ slotId: slot.slotId, elementId: binding.elementId,
            timeMs: binding.delayMs + Math.round(frame.offset * slot.durationMs) }))
            .sort((left, right) => left.slotId.localeCompare(right.slotId) || left.elementId.localeCompare(right.elementId)) })) };
    }).sort((left, right) => left.ruleTrackId.localeCompare(right.ruleTrackId)) }))
      .sort((left, right) => left.ruleId.localeCompare(right.ruleId)),
    slots: slots.sort((left, right) => left.slotId.localeCompare(right.slotId)),
    cues: document.cues.map((cue) => ({ cueId: cue.id, timeMs: cue.timeMs,
      semantic: isAuthoringCue(cue) ? structuredClone(cue.semantic) : null,
      expansionDigest: isAuthoringCue(cue) ? cue.expansionDigest : null })).sort((left, right) => left.cueId.localeCompare(right.cueId)),
    holds: (document.holds ?? []).map((hold) => ({ holdId: hold.id, cueId: hold.cueId,
      sourceTimeMs: hold.sourceTimeMs, durationMs: hold.durationMs })), history,
    eligibility: DURABLE_OPERATION_KINDS.map((kind) => operationEligibility(document, kind, history)),
  };
}

function operationEligibility(document: MotionDocument, kind: DurableOperationKind,
  history: { undoAvailable: boolean; redoAvailable: boolean }): { kind: DurableOperationKind; eligible: boolean; reasonCode: string | null } {
  const answer = (eligible: boolean, reasonCode: string | null = null) => ({ kind, eligible, reasonCode });
  if (kind === 'motion.branch.create' || kind === 'motion.claim.acquire') return answer(true);
  if (kind === 'motion.claim.renew' || kind === 'motion.claim.release' || kind === 'motion.claim.revoke')
    return answer(false, 'CLAIM_CONTEXT_REQUIRED');
  if ((document.holds ?? []).length > 0 && kind !== 'motion.hold.insert') return answer(false, 'AUTHORING_HOLD_LOCKED');
  if (kind === 'motion.history.undo') return answer(history.undoAvailable, history.undoAvailable ? null : 'AUTHORING_HISTORY_EMPTY');
  if (kind === 'motion.history.redo') return answer(history.redoAvailable, history.redoAvailable ? null : 'AUTHORING_HISTORY_EMPTY');
  const editableTracks = document.tracks.filter((track) => !track.cueOwnership);
  const opacityTracks = editableTracks.filter((track) => track.property === 'opacity');
  const transformTracks = editableTracks.filter((track) => track.property === 'transform');
  const structuralTracks = opacityTracks.filter((track) => ['el_a2849ff826f3e167', 'el_2dbee68b1ea318c8'].includes(track.elementId));
  if (kind === 'motion.track.create') {
    const candidates = ['el_a2849ff826f3e167', 'el_2dbee68b1ea318c8'].map((elementId) =>
      projectTrackCreationEligibility(document, elementId, 'opacity'));
    const available = candidates.some((candidate) => candidate.available);
    return answer(available, available ? null : `AUTHORING_${candidates[0]?.reason ?? 'TRACK_CREATE_UNAVAILABLE'}`);
  }
  if (kind === 'motion.keyframe-value.set' || kind === 'motion.keyframe-time.set')
    return answer(opacityTracks.length > 0, opacityTracks.length ? null : 'AUTHORING_TRACK_NOT_FOUND');
  if (['motion.keyframe.add', 'motion.slot-duration.set', 'motion.binding-delay.set', 'motion.slot-easing.set'].includes(kind))
    return answer(structuralTracks.length > 0, structuralTracks.length ? null : 'AUTHORING_TRACK_NOT_FOUND');
  if (kind === 'motion.keyframe.remove') {
    const removable = structuralTracks.some((candidate) => {
      const rule = document.rules.find((item) => item.id === candidate.ruleId);
      return (rule?.tracks.find((item) => item.property === candidate.property)?.keyframes.length ?? 0) > 2;
    });
    return answer(removable, removable ? null : structuralTracks.length ? 'AUTHORING_KEYFRAME_MINIMUM' : 'AUTHORING_TRACK_NOT_FOUND');
  }
  if (kind === 'motion.hold.insert') {
    const available = !(document.holds ?? []).length && document.cues.some((cue) => cue.id === 'cue_pair');
    return answer(available, available ? null : (document.holds ?? []).length ? 'AUTHORING_HOLD_COLLISION' : 'AUTHORING_HOLD_CUE_MISSING');
  }
  if (kind.startsWith('motion.transform-') || kind.startsWith('motion.keyframe-group-') || kind === 'motion.settled-hold.set')
    return answer(transformTracks.length > 0, transformTracks.length ? null : 'AUTHORING_TRAJECTORY_TARGET_INVALID');
  if (kind === 'motion.cue.create') return answer(document.elements.length > 0, document.elements.length ? null : 'CUE_TARGET_MISSING');
  if (kind === 'motion.cue.update' || kind === 'motion.cue.delete' || kind === 'motion.cue.detach') {
    const hasCue = document.cues.some(isAuthoringCue); return answer(hasCue, hasCue ? null : 'CUE_TARGET_MISSING');
  }
  return answer(false, 'OPERATION_UNAVAILABLE');
}

function writableValue(property: string, raw: string): WritableValue | null {
  if (property === 'transform' && raw.length <= 512) return { kind: 'transform', value: raw };
  if (!['opacity', 'scale', 'left', 'top'].includes(property)) return null;
  const match = raw.match(/^(-?(?:\d+\.?\d*|\.\d+))(?:px|%)?$/);
  if (!match) return null;
  const value = Number(match[1]); return Number.isFinite(value) ? { kind: 'number', value } : null;
}
