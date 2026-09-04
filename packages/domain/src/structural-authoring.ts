import { canonicalContentBytes, formatCanonicalDecimal, stableStringify } from './canonical.js';
import { sha256Hex } from './sha256.js';
import type { MotionDocument, MotionHold, RuleTrack } from './document.js';
import type {
  HoldInsertOperation, InternalHoldRemoveOperation, InternalKeyframeRestoreOperation,
  InternalTrackDeleteOperation, ReducerOperation, StructuralAuthoringOperation,
} from './authoring-types.js';
import {
  STRUCTURAL_AUTHORING_ELEMENT_IDS, STRUCTURAL_AUTHORING_STATUS_ELEMENT_ID,
  projectTrackCreationEligibility, type StructuralAuthoringElementId, type TrackCreationEligibility,
} from './index.js';

export function applyHold(
  document: MotionDocument,
  operation: HoldInsertOperation | InternalHoldRemoveOperation,
): { ok: true; document: MotionDocument; inverse: ReducerOperation } | { ok: false; code: string } {
  if (operation.kind === 'motion.hold.insert') {
    if (operation.payload.cueId !== 'cue_pair' || operation.payload.durationMs !== 600) {
      return { ok: false, code: 'AUTHORING_HOLD_INVALID' };
    }
    if ((document.holds ?? []).length > 0) return { ok: false, code: 'AUTHORING_HOLD_COLLISION' };
    const cue = document.cues.find((candidate) => candidate.id === 'cue_pair');
    if (!cue || cue.schemaVersion !== 'motion.cue.v1' || cue.timeMs !== 2870 || document.durationMs !== 4660) {
      return { ok: false, code: 'AUTHORING_HOLD_BOUNDARY_MISMATCH' };
    }
    if (document.durationMs > Number.MAX_SAFE_INTEGER - 600) {
      return { ok: false, code: 'AUTHORING_HOLD_OVERFLOW' };
    }
    const hold: MotionHold = {
      schemaVersion: 'motion.hold.v1',
      id: structuralId('hold', `${document.documentId}\0cue_pair\0${2870}\0${600}`),
      cueId: 'cue_pair', sourceTimeMs: 2870, durationMs: 600,
    };
    if (canonicalIdentitySet(document).has(hold.id)) return { ok: false, code: 'AUTHORING_ID_COLLISION' };
    const next = structuredClone(document);
    next.holds = [hold];
    next.durationMs += 600;
    next.cues = next.cues.map((candidate) => candidate.schemaVersion === 'motion.cue.v1' && candidate.timeMs >= 2870
      ? { ...candidate, timeMs: candidate.timeMs + 600 } : candidate);
    const contentDigest = sha256Hex(canonicalContentBytes(next));
    return { ok: true, document: next, inverse: {
      schemaVersion: operation.schemaVersion, operationId: operation.operationId,
      documentId: operation.documentId, expectedRevision: operation.expectedRevision,
      kind: 'motion.internal.hold.remove', payload: { holdId: hold.id, contentDigest },
    } };
  }
  const hold = document.holds?.[0];
  if (!hold || hold.id !== operation.payload.holdId
    || sha256Hex(canonicalContentBytes(document)) !== operation.payload.contentDigest) {
    return { ok: false, code: 'AUTHORING_HOLD_REPLAY_INVALID' };
  }
  const next = structuredClone(document);
  delete next.holds;
  next.durationMs -= hold.durationMs;
  next.cues = next.cues.map((candidate) => candidate.schemaVersion === 'motion.cue.v1'
    && candidate.timeMs >= hold.sourceTimeMs + hold.durationMs
    ? { ...candidate, timeMs: candidate.timeMs - hold.durationMs } : candidate);
  return { ok: true, document: next, inverse: {
    schemaVersion: operation.schemaVersion, operationId: operation.operationId,
    documentId: operation.documentId, expectedRevision: operation.expectedRevision,
    kind: 'motion.hold.insert', payload: { cueId: 'cue_pair', durationMs: 600 },
  } };
}

export function applyStructural(
  document: MotionDocument,
  operation: Exclude<StructuralAuthoringOperation, HoldInsertOperation>
    | InternalTrackDeleteOperation | InternalKeyframeRestoreOperation,
): { ok: true; document: MotionDocument; inverse: ReducerOperation } | { ok: false; code: string } {
  const element = document.elements.find((candidate) => candidate.id === operation.elementId);
  if (!element) return { ok: false, code: 'AUTHORING_ELEMENT_NOT_FOUND' };
  if (operation.kind === 'motion.keyframe.remove') {
    const candidateTrack = document.tracks.find((candidate) => candidate.id === operation.trackId);
    if (!candidateTrack) return { ok: false, code: 'AUTHORING_TRACK_NOT_FOUND' };
    if (candidateTrack.elementId !== element.id || candidateTrack.property !== 'opacity') {
      return { ok: false, code: 'AUTHORING_TRACK_ELEMENT_MISMATCH' };
    }
    const candidateBundle = resolveIsolatedOpacityBundle(document, candidateTrack.id);
    if (!candidateBundle.ok) return candidateBundle;
    if (candidateBundle.ruleTrack.keyframes.length <= 2) {
      return { ok: false, code: 'AUTHORING_KEYFRAME_MINIMUM' };
    }
    if (!candidateBundle.ruleTrack.keyframes.some((keyframe) => keyframe.id === operation.keyframeId)) {
      return { ok: false, code: 'AUTHORING_KEYFRAME_NOT_FOUND' };
    }
    const anchors = derivedBundleIds(document.documentId, operation.elementId);
    if (operation.keyframeId === anchors.startId || operation.keyframeId === anchors.endId) {
      return { ok: false, code: 'AUTHORING_KEYFRAME_ANCHOR_REQUIRED' };
    }
  }
  const next = structuredClone(document);
  const payload: Record<string, unknown> = 'payload' in operation ? operation.payload : {};
  if (operation.kind === 'motion.track.create') {
    if (payload.property !== 'opacity' || payload.durationMs !== 1000 || payload.delayMs !== 610
      || payload.easing !== 'linear' || payload.startValue !== 0 || payload.endValue !== 1) {
      return { ok: false, code: 'AUTHORING_TRACK_CREATE_INVALID' };
    }
    const eligibility = projectTrackCreationEligibility(document, element.id, String(payload.property));
    if (!eligibility.available) {
      const codes: Record<NonNullable<TrackCreationEligibility['reason']>, string> = {
        DOCUMENT_INVALID: 'AUTHORING_DOCUMENT_INVALID', ELEMENT_NOT_FOUND: 'AUTHORING_ELEMENT_NOT_FOUND',
        TARGET_PROPERTY_UNSUPPORTED: 'AUTHORING_TARGET_PROPERTY_UNSUPPORTED',
        SHARED_PROPERTY_UNSUPPORTED: 'AUTHORING_SHARED_PROPERTY_UNSUPPORTED',
        PROPERTY_CONFLICT: 'AUTHORING_PROPERTY_CONFLICT', TRACK_ALREADY_EXISTS: 'AUTHORING_TRACK_ALREADY_EXISTS',
        TRACK_LIMIT_REACHED: 'AUTHORING_TRACK_LIMIT_REACHED', ID_COLLISION: 'AUTHORING_ID_COLLISION',
      };
      return { ok: false, code: codes[eligibility.reason!] };
    }
    const { base, ruleId, applicationId, slotId, ruleTrackId, trackId, startId, endId } =
      derivedBundleIds(document.documentId, operation.elementId);
    const sourceName = `created_${sha256Hex(base).slice(0, 16)}`;
    const rule = { id: ruleId, sourceName, tracks: [{
      id: ruleTrackId, property: 'opacity', interpolation: 'continuous' as const,
      keyframes: [{ id: startId, offset: 0, value: '0' }, { id: endId, offset: 1, value: '1' }],
    }] };
    const application = { id: applicationId,
      bindings: [{ elementId: element.id, delayOverridesMs: [610] }], selectorHint: element.selectorHint,
      slots: [{ id: slotId, ruleId, durationMs: 1000, delayMs: 610, iterationCount: 1 as const,
        direction: 'normal' as const, fillMode: 'both' as const, playState: 'running' as const,
        timingFunction: { kind: 'keyword' as const, value: 'linear' as const } }] };
    const expanded = { id: trackId, elementId: element.id, ruleId, slotId, property: 'opacity',
      interpolation: 'continuous' as const, keyframeIds: [startId, endId] };
    next.rules.push(rule); next.applications.push(application); next.tracks.push(expanded);
    refreshInventory(next);
    return { ok: true, document: next, inverse: { schemaVersion: operation.schemaVersion,
      operationId: operation.operationId, documentId: operation.documentId,
      expectedRevision: operation.expectedRevision, kind: 'motion.internal.track.delete',
      elementId: operation.elementId, trackId,
      payload: { bundleDigest: sha256Hex(canonicalBundleBytes({ rule, application, expanded })) } } };
  }
  const track = document.tracks.find((candidate) => candidate.id === operation.trackId);
  if (!track) return { ok: false, code: 'AUTHORING_TRACK_NOT_FOUND' };
  if (track.elementId !== element.id || track.property !== 'opacity') {
    return { ok: false, code: 'AUTHORING_TRACK_ELEMENT_MISMATCH' };
  }
  const bundle = resolveIsolatedOpacityBundle(next, track.id);
  if (!bundle.ok) return bundle;
  const { rule, ruleTrack, application, slotIndex, slot, binding } = bundle;
  if (operation.kind === 'motion.internal.track.delete') {
    const currentBundle = { rule, application,
      expanded: next.tracks.find((candidate) => candidate.id === track.id)! };
    if (sha256Hex(canonicalBundleBytes(currentBundle)) !== operation.payload.bundleDigest) {
      return { ok: false, code: 'AUTHORING_BUNDLE_MISMATCH' };
    }
    next.rules = next.rules.filter((candidate) => candidate.id !== track.ruleId);
    next.applications = next.applications.filter((candidate) => candidate.id !== application.id);
    next.tracks = next.tracks.filter((candidate) => candidate.id !== track.id);
    refreshInventory(next);
    return { ok: true, document: next, inverse: { schemaVersion: operation.schemaVersion,
      operationId: operation.operationId, documentId: operation.documentId,
      expectedRevision: operation.expectedRevision, kind: 'motion.track.create',
      elementId: operation.elementId,
      payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear',
        startValue: 0, endValue: 1 } } };
  }
  if (operation.kind === 'motion.internal.keyframe.restore') {
    const restored = operation.keyframe;
    if (ruleTrack.keyframes.some((keyframe) => keyframe.id === restored.id
      || keyframe.offset === restored.offset)) return { ok: false, code: 'AUTHORING_ID_COLLISION' };
    const insertion = ruleTrack.keyframes.findIndex((keyframe) => keyframe.offset > restored.offset);
    if (insertion < 0) return { ok: false, code: 'AUTHORING_TIME_ORDER_INVALID' };
    ruleTrack.keyframes.splice(insertion, 0, structuredClone(restored));
    next.tracks.find((candidate) => candidate.id === track.id)!.keyframeIds.splice(insertion, 0, restored.id);
    return { ok: true, document: next, inverse: { schemaVersion: operation.schemaVersion,
      operationId: operation.operationId, documentId: operation.documentId,
      expectedRevision: operation.expectedRevision, kind: 'motion.keyframe.remove',
      elementId: operation.elementId, trackId: track.id, keyframeId: restored.id } };
  }
  if (operation.kind === 'motion.keyframe.add') {
    const timeMs = payload.timeMs;
    const value = payload.value;
    if (!Number.isSafeInteger(timeMs) || typeof value !== 'number') {
      return { ok: false, code: 'AUTHORING_KEYFRAME_INVALID' };
    }
    const numerator = ((timeMs as number) - binding.delayOverridesMs[slotIndex]!) * 1_000_000;
    if (!Number.isSafeInteger(numerator) || numerator % slot.durationMs !== 0) {
      return { ok: false, code: 'AUTHORING_TIME_PRECISION_UNREPRESENTABLE' };
    }
    const offsetPpm = numerator / slot.durationMs;
    if (!Number.isSafeInteger(offsetPpm) || offsetPpm <= 0 || offsetPpm >= 1_000_000
      || typeof value !== 'number' || value < 0 || value > 1
      || !Number.isSafeInteger(value * 1_000_000)) {
      return { ok: false, code: 'AUTHORING_KEYFRAME_INVALID' };
    }
    if (ruleTrack.keyframes.some((keyframe) => keyframe.offset * 1_000_000 === offsetPpm)) {
      return { ok: false, code: 'AUTHORING_TIME_COLLISION' };
    }
    const keyframeId = structuralId('kf', `${document.documentId}\0${element.id}\0opacity\0${offsetPpm}`);
    if (document.rules.some((owner) => owner.tracks.some((candidate) =>
      candidate.keyframes.some((keyframe) => keyframe.id === keyframeId)))) {
      return { ok: false, code: 'AUTHORING_ID_COLLISION' };
    }
    const insertion = ruleTrack.keyframes.findIndex((keyframe) => keyframe.offset > offsetPpm / 1_000_000);
    const keyframe = { id: keyframeId, offset: offsetPpm / 1_000_000, value: formatCanonicalDecimal(value) };
    ruleTrack.keyframes.splice(insertion, 0, keyframe);
    const expanded = next.tracks.find((candidate) => candidate.id === track.id)!;
    expanded.keyframeIds.splice(insertion, 0, keyframeId);
    return { ok: true, document: next, inverse: { ...operation, kind: 'motion.keyframe.remove', keyframeId,
    } };
  }
  if (operation.kind === 'motion.keyframe.remove') {
    if (ruleTrack.keyframes.length <= 2) return { ok: false, code: 'AUTHORING_KEYFRAME_MINIMUM' };
    const index = ruleTrack.keyframes.findIndex((keyframe) => keyframe.id === operation.keyframeId);
    if (index < 0) return { ok: false, code: 'AUTHORING_KEYFRAME_NOT_FOUND' };
    const removed = ruleTrack.keyframes[index]!;
    ruleTrack.keyframes.splice(index, 1);
    next.tracks.find((candidate) => candidate.id === track.id)!.keyframeIds.splice(index, 1);
    return { ok: true, document: next, inverse: { schemaVersion: operation.schemaVersion,
      operationId: operation.operationId, documentId: operation.documentId,
      expectedRevision: operation.expectedRevision, kind: 'motion.internal.keyframe.restore',
      elementId: operation.elementId, trackId: track.id,
      keyframe: structuredClone(removed) } };
  }
  if (operation.kind === 'motion.slot-duration.set') {
    if (!Number.isSafeInteger(payload.durationMs) || (payload.durationMs as number) <= 0) {
      return { ok: false, code: 'AUTHORING_DURATION_INVALID' };
    }
    if (!projectionsValid(document, ruleTrack, binding.delayOverridesMs[slotIndex]!, payload.durationMs as number)) {
      return { ok: false, code: 'AUTHORING_PROJECTION_INVALID' };
    }
    const old = slot.durationMs; slot.durationMs = payload.durationMs as number;
    return { ok: true, document: next, inverse: { ...operation, payload: { durationMs: old } } };
  }
  if (operation.kind === 'motion.binding-delay.set') {
    if (!Number.isSafeInteger(payload.delayMs) || (payload.delayMs as number) < 0) {
      return { ok: false, code: 'AUTHORING_DELAY_INVALID' };
    }
    if (!projectionsValid(document, ruleTrack, payload.delayMs as number, slot.durationMs)) {
      return { ok: false, code: 'AUTHORING_PROJECTION_INVALID' };
    }
    const old = binding.delayOverridesMs[slotIndex]!;
    binding.delayOverridesMs[slotIndex] = payload.delayMs as number;
    slot.delayMs = payload.delayMs as number;
    return { ok: true, document: next, inverse: { ...operation, payload: { delayMs: old } } };
  }
  if (operation.kind === 'motion.slot-easing.set') {
    if (payload.easing !== 'linear' && payload.easing !== 'ease-in-out') {
      return { ok: false, code: 'AUTHORING_EASING_INVALID' };
    }
    const old = slot.timingFunction;
    slot.timingFunction = { kind: 'keyword', value: payload.easing };
    return { ok: true, document: next, inverse: { ...operation,
      payload: { easing: old.kind === 'keyword' && old.value === 'ease-in-out'
        ? 'ease-in-out' : 'linear' } } };
  }
  return { ok: false, code: 'AUTHORING_ENVELOPE_INVALID' };
}

export function structuralId(prefix: string, seed: string): string {
  return `${prefix}_${sha256Hex(seed).slice(0, 16)}`;
}

function canonicalBundleBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(stableStringify(value));
}

export function canonicalIdentitySet(document: MotionDocument): Set<string> {
  return new Set([
    ...document.elements.map((candidate) => candidate.id), ...document.cues.map((candidate) => candidate.id),
    ...(document.holds ?? []).map((candidate) => candidate.id),
    ...document.rules.map((rule) => rule.id), ...document.applications.map((app) => app.id),
    ...document.applications.flatMap((app) => app.slots.map((slot) => slot.id)),
    ...document.rules.flatMap((rule) => rule.tracks.flatMap((track) =>
      [track.id, ...track.keyframes.map((keyframe) => keyframe.id)])),
    ...document.tracks.map((track) => track.id),
  ]);
}

export function derivedBundleIds(documentId: string, elementId: StructuralAuthoringElementId): {
  base: string; ruleId: string; applicationId: string; slotId: string;
  ruleTrackId: string; trackId: string; startId: string; endId: string;
} {
  const base = `${documentId}\0${elementId}\0opacity`;
  const ruleId = structuralId('rule', base);
  const slotId = structuralId('slot', `${base}\0${ruleId}`);
  return {
    base,
    ruleId,
    applicationId: structuralId('app', base),
    slotId,
    ruleTrackId: structuralId('rule_track', `${base}\0${ruleId}`),
    trackId: structuralId('track', `${base}\0${slotId}\0${ruleId}`),
    startId: structuralId('kf', `${base}\0${0}`),
    endId: structuralId('kf', `${base}\0${1_000_000}`),
  };
}

function resolveIsolatedOpacityBundle(document: MotionDocument, trackId: string):
  | { ok: true; rule: MotionDocument['rules'][number]; ruleTrack: RuleTrack;
    application: MotionDocument['applications'][number]; slotIndex: number;
    slot: MotionDocument['applications'][number]['slots'][number];
    binding: MotionDocument['applications'][number]['bindings'][number] }
  | { ok: false; code: string } {
  const expanded = document.tracks.find((track) => track.id === trackId);
  if (!expanded) return { ok: false, code: 'AUTHORING_TRACK_NOT_FOUND' };
  if (!STRUCTURAL_AUTHORING_ELEMENT_IDS.includes(expanded.elementId as StructuralAuthoringElementId)) {
    return { ok: false, code: 'AUTHORING_BUNDLE_MISMATCH' };
  }
  const elementId = expanded.elementId as StructuralAuthoringElementId;
  const ids = derivedBundleIds(document.documentId, elementId);
  if (expanded.id !== ids.trackId
    || expanded.property !== 'opacity' || expanded.ruleId !== ids.ruleId
    || expanded.slotId !== ids.slotId || expanded.interpolation !== 'continuous') {
    return { ok: false, code: 'AUTHORING_BUNDLE_MISMATCH' };
  }
  const rules = document.rules.filter((rule) => rule.id === expanded.ruleId);
  const owners = document.applications.filter((application) =>
    application.slots.some((slot) => slot.id === expanded.slotId));
  if (rules.length !== 1 || owners.length !== 1) {
    return { ok: false, code: 'AUTHORING_BUNDLE_REFERENCE_INVALID' };
  }
  const rule = rules[0]!;
  const application = owners[0]!;
  const slotIndex = application.slots.findIndex((slot) => slot.id === expanded.slotId);
  const slot = application.slots[slotIndex];
  const ruleTrack = rule.tracks.find((candidate) => candidate.property === 'opacity');
  const binding = application.bindings.find((candidate) =>
    candidate.elementId === elementId);
  const sourceName = `created_${sha256Hex(ids.base).slice(0, 16)}`;
  if (!slot || !ruleTrack || !binding || rule.id !== ids.ruleId || rule.sourceName !== sourceName
    || application.id !== ids.applicationId
    || slot.id !== ids.slotId || ruleTrack.id !== ids.ruleTrackId || slot.ruleId !== rule.id
    || rule.tracks.length !== 1 || application.slots.length !== 1 || application.bindings.length !== 1
    || binding.delayOverridesMs.length !== 1 || slot.delayMs !== binding.delayOverridesMs[0]
    || ruleTrack.keyframes.length < 2 || ruleTrack.keyframes[0]?.id !== ids.startId
    || ruleTrack.keyframes.at(-1)?.id !== ids.endId
    || ruleTrack.keyframes.some((keyframe) => {
      const offsetPpm = keyframe.offset * 1_000_000;
      return !Number.isSafeInteger(offsetPpm)
        || keyframe.id !== structuralId('kf', `${ids.base}\0${offsetPpm}`);
    })
    || expanded.keyframeIds.length !== ruleTrack.keyframes.length
    || expanded.keyframeIds.some((id, index) => id !== ruleTrack.keyframes[index]?.id)) {
    return { ok: false, code: 'AUTHORING_BUNDLE_MISMATCH' };
  }
  const ruleUsers = document.tracks.filter((candidate) => candidate.ruleId === rule.id);
  const slotUsers = document.tracks.filter((candidate) => candidate.slotId === slot.id);
  const ruleSlotUsers = document.applications.flatMap((candidate) => candidate.slots)
    .filter((candidate) => candidate.ruleId === rule.id);
  if (ruleUsers.length !== 1 || slotUsers.length !== 1 || ruleSlotUsers.length !== 1) {
    return { ok: false, code: 'AUTHORING_BUNDLE_SHARED' };
  }
  return { ok: true, rule, ruleTrack, application, slotIndex, slot, binding };
}

function projectionsValid(
  document: MotionDocument,
  ruleTrack: RuleTrack,
  delayMs: number,
  durationMs: number,
): boolean {
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || !Number.isSafeInteger(durationMs)
    || durationMs <= 0) return false;
  return ruleTrack.keyframes.every((keyframe) => {
    const offsetPpm = keyframe.offset * 1_000_000;
    if (!Number.isSafeInteger(offsetPpm)) return false;
    const numerator = offsetPpm * durationMs;
    if (!Number.isSafeInteger(numerator) || numerator % 1_000_000 !== 0) return false;
    const projected = delayMs + numerator / 1_000_000;
    return Number.isSafeInteger(projected) && projected >= 0 && projected <= document.durationMs;
  });
}

export function refreshInventory(document: MotionDocument): void {
  document.inventory.ruleCount = document.rules.length;
  document.inventory.applicationCount = document.applications.length;
  document.inventory.slotCount = document.applications.reduce((count, application) => count + application.slots.length, 0);
  document.inventory.trackCount = document.tracks.length;
  document.inventory.supportedCount = document.inventory.ruleCount + document.inventory.applicationCount
    + document.inventory.slotCount + document.inventory.trackCount;
}
