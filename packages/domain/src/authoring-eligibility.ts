import { projectTrackCreationEligibility } from './index.js';
import { splitCssTimingFunction } from './css-motion-semantics.js';
import { validateMotionDocument, type MotionDocument } from './document.js';
import { cueTargetSnapshots, deriveCueId, type CueSemantic } from './cue-authoring.js';
import { applyCueOperation, projectCueReplacement } from './cue-operations.js';

export type ActionEligibility = { available: boolean; reason: string | null };
export type AuthoringAction = 'move' | 'fade' | 'reveal' | 'type' | 'hold' | 'click' | 'select' | 'drag';
export type AuthoringTarget = { elementId: string; label: string;
  actions: Array<ActionEligibility & { action: AuthoringAction }> };

/** A whole-shot source-time pause. Attached cues require their own semantic retiming. */
export function projectHoldEligibility(document: MotionDocument, cueId: string, durationMs = 1): ActionEligibility {
  const no = (reason: string) => ({ available: false, reason });
  if ((document.holds ?? []).length) return no('AUTHORING_HOLD_COLLISION');
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) return no('AUTHORING_HOLD_INVALID');
  if (!validateMotionDocument(document).ok) return no('AUTHORING_DOCUMENT_INVALID');
  const cue = document.cues.find((candidate) => candidate.id === cueId);
  if (!cue || cue.schemaVersion !== 'motion.cue.v1') return no('AUTHORING_HOLD_CUE_MISSING');
  if (document.cues.some((candidate) => candidate.schemaVersion !== 'motion.cue.v1'))
    return no('AUTHORING_HOLD_ATTACHED_CUES_UNSUPPORTED');
  if (!Number.isSafeInteger(document.durationMs + durationMs)) return no('AUTHORING_HOLD_OVERFLOW');
  for (const app of document.applications) for (const [index, slot] of app.slots.entries()) {
    if (slot.iterationCount !== 1 || slot.direction !== 'normal' || slot.durationMs <= 0 || slot.playState !== 'running')
      return no('AUTHORING_HOLD_TIMING_UNSUPPORTED');
    const rule = document.rules.find((candidate) => candidate.id === slot.ruleId)!;
    for (const binding of app.bindings) for (const track of rule.tracks) {
      const delay = binding.delayOverridesMs[index]!;
      if (delay < 0 || !Number.isSafeInteger(delay + slot.durationMs + durationMs))
        return no('AUTHORING_HOLD_TIMING_UNSUPPORTED');
      const active = delay <= cue.timeMs && cue.timeMs < delay + slot.durationMs;
      if (active && (track.keyframes[0]?.offset !== 0 || track.keyframes.at(-1)?.offset !== 1))
        return no('AUTHORING_HOLD_IMPLICIT_ENDPOINT_UNSUPPORTED');
      const flattenSteps = active && slot.timingFunction.kind === 'steps' && track.keyframes.length === 2
        && track.keyframes.every((frame) => !frame.easing);
      if (flattenSteps && track.keyframes[0]!.value !== track.keyframes[1]!.value
        && !canInterpolateHoldValues(track.property, track.keyframes[0]!.value, track.keyframes[1]!.value))
        return no('AUTHORING_HOLD_INTERPOLATION_UNSUPPORTED');
      for (const [i, frame] of track.keyframes.entries()) {
        const next = track.keyframes[i + 1];
        if (!next || cue.timeMs <= delay + frame.offset * slot.durationMs
          || cue.timeMs >= delay + next.offset * slot.durationMs) continue;
        if (track.interpolation !== 'continuous') {
          if (frame.value !== next.value || slot.timingFunction.kind === 'steps')
            return no('AUTHORING_HOLD_INTERPOLATION_UNSUPPORTED');
          continue;
        }
        if (!canInterpolateHoldValues(track.property, frame.value, next.value))
          return no('AUTHORING_HOLD_INTERPOLATION_UNSUPPORTED');
        const easing = frame.easing ?? slot.timingFunction;
        const flattenedSteps = slot.timingFunction.kind === 'steps' && track.keyframes.length === 2
          && track.keyframes.every((keyframe) => !keyframe.easing);
        if (!flattenedSteps) {
          try { splitCssTimingFunction(easing, (cue.timeMs - delay - frame.offset * slot.durationMs)
            / ((next.offset - frame.offset) * slot.durationMs)); }
          catch { return no('AUTHORING_HOLD_EASING_UNSUPPORTED'); }
        }
      }
    }
  }
  return { available: true, reason: null };
}

/** Uses the actual expansion/replacement validator; clients must recheck their selected parameters. */
export function projectCueActionEligibility(document: MotionDocument, semantic: CueSemantic): ActionEligibility {
  if ((document.holds ?? []).length) return { available: false, reason: 'AUTHORING_HOLD_LOCKED' };
  if (!validateMotionDocument(document).ok) return { available: false, reason: 'AUTHORING_DOCUMENT_INVALID' };
  try {
    const cueId = deriveCueId(document.documentId, `discovery:${document.revision}:${semantic.kind}`);
    const replacement = projectCueReplacement(document, cueId, semantic);
    if (!replacement.ok) return { available: false, reason: replacement.code };
    const applied = applyCueOperation(document, { schemaVersion: 'motion.operation.v1', operationId: 'discovery:probe',
      documentId: document.documentId, expectedRevision: document.revision, kind: 'motion.cue.create', payload: {
        cueId, semantic, targetSnapshots: cueTargetSnapshots(document, semantic),
        replacementTrackIds: replacement.trackIds, replacementInputDigest: replacement.inputDigest,
      } });
    if (!applied.ok) return { available: false, reason: applied.code };
    return validateMotionDocument(applied.document).ok ? { available: true, reason: null }
      : { available: false, reason: 'AUTHORING_CANDIDATE_INVALID' };
  } catch { return { available: false, reason: 'CUE_PARAMETERS_UNSUPPORTED' }; }
}

/** Labels are authored metadata; duplicate labels do not change stable identity. */
export function projectAuthoringTargets(document: MotionDocument): AuthoringTarget[] {
  return [...document.elements].sort((a, b) => a.id.localeCompare(b.id)).map((element, index) => {
    const id = element.id;
    const peers = document.elements.filter((other) => other.id !== id);
    const end = Math.max(1, Math.floor(document.durationMs / 2));
    const unit = Math.max(1, Math.floor(document.durationMs / 5));
    const cue = (semantic: CueSemantic) => projectCueActionEligibility(document, semantic);
    const peerAction = (make: (peer: string) => CueSemantic): ActionEligibility => {
      const candidates = peers.map((peer) => cue(make(peer.id)));
      return candidates.find((candidate) => candidate.available) ?? candidates[0]
        ?? { available: false, reason: 'CUE_SECOND_TARGET_REQUIRED' };
    };
    const fade = projectTrackCreationEligibility(document, id, 'opacity');

    const actions: Record<AuthoringAction, ActionEligibility> = {
      move: cue({ kind: 'cursor-path', cursorTargetId: id, startMs: 0, arriveMs: end,
        easing: { kind: 'keyword', value: 'linear' },
        waypoints: [{ timeMs: 0, xPpm: 0, yPpm: 0 }, { timeMs: end, xPpm: 100_000, yPpm: 0 }] }),
      fade: { available: fade.available, reason: fade.reason },
      reveal: cue({ kind: 'reveal', targetIds: [id], startMs: 0, completeMs: end }),
      type: element.editableText === undefined ? { available: false, reason: 'CUE_TEXT_TARGET_REQUIRED' }
        : cue({ kind: 'type', targetId: id, startMs: 0, completeMs: end,
          stepCount: Math.max(1, Array.from(element.editableText).length) }),
      hold: projectObjectHoldEligibility(document, [id]),
      click: peerAction((peer) => ({ kind: 'click', cursorTargetId: id, pulseTargetId: peer,
        arriveMs: 0, pressMs: unit, releaseMs: unit * 2, pulseEndMs: unit * 3,
        pressScalePpm: 900_000, pulseRadiusPpm: 100_000, pulseOpacityPpm: 500_000 })),
      select: peerAction((peer) => ({ kind: 'select', cursorTargetId: id, selectedTargetId: peer,
        approachMs: 0, chooseMs: unit, settleMs: unit * 2 })),
      drag: peerAction((peer) => ({ kind: 'drag', cursorTargetId: id, draggedTargetId: peer,
        approachMs: 0, pressMs: unit, moveStartMs: unit * 2, arriveMs: unit * 3, releaseMs: unit * 4,
        grabOffsetXPpm: 0, grabOffsetYPpm: 0,
        waypoints: [{ timeMs: unit * 2, xPpm: 0, yPpm: 0 }, { timeMs: unit * 3, xPpm: 100_000, yPpm: 0 }] })),
    };
    return { elementId: id, label: element.label ?? `Object ${index + 1}`,
      actions: Object.entries(actions).map(([action, result]) => ({ action: action as AuthoringAction, ...result })) };
  });
}

function safeTransform(value: string): boolean {
  const number = '-?(?:\\d+(?:\\.\\d*)?|\\.\\d+)';
  const component = `(?:translate[XY]\\(${number}px\\)|translate\\(${number}px(?:,? +${number}px)?\\)|scale[XY]?\\(${number}(?:,? +${number})?\\))`;
  return new RegExp(`^${component}(?: +${component})*$`).test(value);
}


/** Object holds replace only the selected closed track bundle, unlike a whole-shot pause. */
export function projectObjectHoldEligibility(document: MotionDocument, targetIds: string[]): ActionEligibility {
  const tracks = document.tracks.filter((track) => targetIds.includes(track.elementId));
  if (!tracks.length) return { available: false, reason: 'CUE_HOLD_TARGET_UNANIMATED' };
  let rejection: ActionEligibility = { available: false, reason: 'CUE_HOLD_ENTER_BOUNDARY_MISSING' };
  const seen = new Set<string>();
  for (const track of tracks) {
    const app = document.applications.find((candidate) => candidate.slots.some((slot) => slot.id === track.slotId));
    const index = app?.slots.findIndex((slot) => slot.id === track.slotId) ?? -1;
    const slot = app?.slots[index];
    const delay = app?.bindings.find((binding) => binding.elementId === track.elementId)?.delayOverridesMs[index];
    const frames = document.rules.find((rule) => rule.id === track.ruleId)?.tracks.find((item) => item.property === track.property)?.keyframes;
    if (!slot || delay === undefined || !frames) continue;
    for (const frame of frames) {
      const enterMs = delay + frame.offset * slot.durationMs;
      const durationMs = Math.min(Math.max(1, Math.floor(slot.durationMs / 4)), document.durationMs - enterMs);
      const key = `${enterMs}:${durationMs}`;
      if (durationMs <= 0 || seen.has(key)) continue;
      seen.add(key);
      const result = projectCueActionEligibility(document, { kind: 'hold', targetIds, enterMs, durationMs, exitMs: enterMs + durationMs });
      if (result.available) return result;
      rejection = result;
    }
  }
  return rejection;
}

/** Supported scalar CSS interpolation shared by admission eligibility and compilation. */
export function canInterpolateHoldValues(property: string, from: string, to: string): boolean {
  const number = /^-?(?:\d+\.?\d*|\.\d+)$/;
  if (property === 'opacity') return [from, to].every((value) => number.test(value)
    && Number(value) >= 0 && Number(value) <= 1);
  if (property !== 'transform' || !safeTransform(from) || !safeTransform(to)) return false;
  const numbers = /-?(?:\d+\.?\d*|\.\d+)/g;
  return from.replace(numbers, '#') === to.replace(numbers, '#');
}
