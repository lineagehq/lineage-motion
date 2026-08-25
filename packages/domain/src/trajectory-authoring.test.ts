import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { importMotionHtml } from '../../css-import/src/index.js';
import { canonicalContentBytes, createAuthoringState, dispatchAuthoringOperation, projectTrajectorySelection,
  projectTransformTrajectory, sha256Hex, type AuthoringOperation, type MotionDocument } from './index.js';

const source = readFileSync(resolve(import.meta.dirname, '../../../fixtures/public-synthetic/landing-shot1.html'), 'utf8');
const imported = importMotionHtml(source); if (!imported.document) throw new Error(imported.diagnostics[0]?.code);
const base = imported.document; const ids = base.elements.map((element) => element.id).sort();
const stage = { stageDigest: 'a'.repeat(64), widthMicrounits: 800_000_000, heightMicrounits: 450_000_000 };
const envelope = (kind: AuthoringOperation['kind'], revision: number, operationId: string) => ({ schemaVersion: 'motion.operation.v1' as const, kind, operationId, documentId: base.documentId, expectedRevision: revision });

function holdOperation(document: MotionDocument, operationId: string, targets = projectTrajectorySelection(document, ids, 2100).targets) {
  return { ...envelope('motion.settled-hold.set', document.revision, operationId),
    payload: { targets, sourceTimeMs: 2100, settledTimeMs: 1820, landingTimeMs: 840, boundaryTimeMs: 2100 as const } };
}

function addWaypointAt(document: MotionDocument, timeMs: number) {
  for (const track of document.tracks.filter((candidate) => candidate.property === 'transform')) {
    const ruleTrack = document.rules.find((rule) => rule.id === track.ruleId)!.tracks.find((candidate) => candidate.property === 'transform')!;
    const application = document.applications.find((candidate) => candidate.slots.some((slot) => slot.id === track.slotId))!;
    const slotIndex = application.slots.findIndex((slot) => slot.id === track.slotId);
    const delayMs = application.bindings.find((binding) => binding.elementId === track.elementId)!.delayOverridesMs[slotIndex]!;
    const source = ruleTrack.keyframes.at(-1)!;
    ruleTrack.keyframes.push({ id: `hostile_${track.id}_${timeMs}`, offset: (timeMs - delayMs) / application.slots[slotIndex]!.durationMs,
      value: source.value });
    ruleTrack.keyframes.sort((a, b) => a.offset - b.offset);
    track.keyframeIds = ruleTrack.keyframes.map((keyframe) => keyframe.id);
  }
}

describe('trajectory authoring', () => {
  test('canonicalizes reverse asymmetric selection while retaining each target identity and exact atomic history', () => {
    const asymmetric = structuredClone(base); const firstId = ids[0]!;
    const expanded = asymmetric.tracks.find((track) => track.elementId === firstId && track.property === 'transform')!;
    const ruleTrack = asymmetric.rules.find((rule) => rule.id === expanded.ruleId)!.tracks.find((track) => track.property === 'transform')!;
    const landed = ruleTrack.keyframes.find((keyframe) => keyframe.offset === 0.1)!;
    ruleTrack.keyframes.push({ ...landed, id: 'kf_domain_asymmetric_1400', offset: 0.2 });
    ruleTrack.keyframes.sort((left, right) => left.offset - right.offset);
    for (const track of asymmetric.tracks.filter((candidate) => candidate.ruleId === expanded.ruleId && candidate.property === 'transform')) {
      track.keyframeIds = ruleTrack.keyframes.map((keyframe) => keyframe.id);
    }
    const beforeTargets = ids.map((elementId) => { const trajectory = projectTransformTrajectory(asymmetric, elementId);
      if (!trajectory.eligible) throw new Error(trajectory.code); return trajectory.waypoints.find((waypoint) => waypoint.timeMs === 700)!; });
    const reverse = projectTrajectorySelection(asymmetric, [...ids].reverse(), 700);
    expect(reverse.eligible).toBe(true); if (!reverse.eligible) return;
    expect(reverse.targets.map((target) => target.elementId)).toEqual(ids);
    expect(reverse.targets).toEqual(ids.map((elementId, index) => ({ elementId,
      trackId: projectTransformTrajectory(asymmetric, elementId).eligible
        ? (projectTransformTrajectory(asymmetric, elementId) as { trackId: string }).trackId : '',
      keyframeId: beforeTargets[index]!.keyframeId, expectedTransform: beforeTargets[index]!.transformBytes })));
    const initialDigest = sha256Hex(canonicalContentBytes(asymmetric));
    const moved = dispatchAuthoringOperation(createAuthoringState(asymmetric), { ...envelope('motion.transform-waypoints.translate', 0, 'reverse-group'),
      payload: { targets: reverse.targets, deltaXPpm: 10_000, deltaYPpm: -10_000, stage } });
    expect(moved.ok).toBe(true); if (!moved.ok) return; expect(moved.state.document.revision).toBe(1);
    for (const [index, elementId] of ids.entries()) {
      const trajectory = projectTransformTrajectory(moved.state.document, elementId); if (!trajectory.eligible) throw new Error(trajectory.code);
      const waypoint = trajectory.waypoints.find((candidate) => candidate.timeMs === 700)!;
      expect(waypoint.pose.translateXMicrounits - beforeTargets[index]!.pose.translateXMicrounits).toBe(8_000_000);
      expect(waypoint.pose.translateYMicrounits - beforeTargets[index]!.pose.translateYMicrounits).toBe(-4_500_000);
    }
    const editedDigest = sha256Hex(canonicalContentBytes(moved.state.document));
    const undone = dispatchAuthoringOperation(moved.state, envelope('motion.history.undo', 1, 'reverse-undo'));
    expect(undone.ok).toBe(true); if (!undone.ok) return; expect(sha256Hex(canonicalContentBytes(undone.state.document))).toBe(initialDigest);
    const redone = dispatchAuthoringOperation(undone.state, envelope('motion.history.redo', 2, 'reverse-redo'));
    expect(redone.ok).toBe(true); if (!redone.ok) return; expect(sha256Hex(canonicalContentBytes(redone.state.document))).toBe(editedDigest);
  });

  test('moves two waypoints atomically and undo/redo is exact', () => {
    const selection = projectTrajectorySelection(base, ids, 700); if (!selection.eligible) throw new Error(selection.code!);
    let state = createAuthoringState(base);
    const moved = dispatchAuthoringOperation(state, { ...envelope('motion.transform-waypoints.translate', 0, 'move-1'),
      payload: { targets: selection.targets, deltaXPpm: 10_000, deltaYPpm: -10_000, stage } });
    expect(moved.ok).toBe(true); if (!moved.ok) return; state = moved.state;
    expect(state.document.revision).toBe(1);
    const edited = sha256Hex(canonicalContentBytes(state.document));
    const undo = dispatchAuthoringOperation(state, envelope('motion.history.undo', 1, 'undo-1')); expect(undo.ok).toBe(true); if (!undo.ok) return;
    expect(sha256Hex(canonicalContentBytes(undo.state.document))).toBe(sha256Hex(canonicalContentBytes(base)));
    const redo = dispatchAuthoringOperation(undo.state, envelope('motion.history.redo', 2, 'redo-1')); expect(redo.ok).toBe(true); if (!redo.ok) return;
    expect(sha256Hex(canonicalContentBytes(redo.state.document))).toBe(edited);
  });

  test('accepts serializer-produced decimal bytes in a sequential atomic group commit', () => {
    const first = projectTrajectorySelection(base, [ids[0]!], 700); if (!first.eligible) throw new Error(first.code!);
    const pointer = dispatchAuthoringOperation(createAuthoringState(base), {
      ...envelope('motion.transform-waypoints.translate', 0, 'pointer-1'),
      payload: { targets: first.targets, deltaXPpm: 1, deltaYPpm: -1, stage },
    });
    expect(pointer.ok).toBe(true); if (!pointer.ok) return;
    expect(pointer.state.document.revision).toBe(1);
    const selected = projectTrajectorySelection(pointer.state.document, ids, 700);
    expect(selected.eligible).toBe(true); if (!selected.eligible) return;
    expect(selected.targets.map((target) => target.elementId)).toEqual(ids);
    expect(selected.targets.some((target) => /\.\d+px/.test(target.expectedTransform))).toBe(true);
    const grouped = dispatchAuthoringOperation(pointer.state, {
      ...envelope('motion.transform-waypoints.translate', 1, 'group-2'),
      payload: { targets: selected.targets, deltaXPpm: 10_000, deltaYPpm: 0, stage },
    });
    expect(grouped.ok).toBe(true); if (!grouped.ok) return;
    expect(grouped.state.document.revision).toBe(2);
    expect(projectTrajectorySelection(grouped.state.document, ids, 700).eligible).toBe(true);
  });

  test('pose, time, easing, and settled hold are bounded and reversible', () => {
    let state = createAuthoringState(base);
    const one = projectTrajectorySelection(state.document, [ids[0]!], 700); if (!one.eligible) throw new Error(one.code!);
    const pose = projectTransformTrajectory(state.document, ids[0]!); if (!pose.eligible) throw new Error(pose.code);
    const current = pose.waypoints.find((point) => point.timeMs === 700)!;
    let result = dispatchAuthoringOperation(state, { ...envelope('motion.transform-pose.set', 0, 'pose-1'), ...one.targets[0],
      payload: { pose: { ...current.pose, scalePpm: 1_100_000 }, stage } }); expect(result.ok).toBe(true); if (!result.ok) return; state = result.state;
    let both = projectTrajectorySelection(state.document, ids, 700); if (!both.eligible) throw new Error(both.code!);
    result = dispatchAuthoringOperation(state, { ...envelope('motion.keyframe-group-time.set', 1, 'time-1'), payload: { targets: both.targets, sourceTimeMs: 700, targetTimeMs: 840, landingTimeMs: 840, settledTimeMs: 2100 } }); expect(result.ok, result.ok ? '' : result.diagnostic.code).toBe(true); if (!result.ok) return; state = result.state;
    both = projectTrajectorySelection(state.document, ids, 840); if (!both.eligible) throw new Error(both.code!);
    result = dispatchAuthoringOperation(state, { ...envelope('motion.keyframe-group-easing.set', 2, 'ease-1'), payload: { targets: both.targets, expectedEasing: { kind: 'keyword', value: 'ease-out' }, easing: { kind: 'keyword', value: 'ease-in-out' } } }); expect(result.ok).toBe(true); if (!result.ok) return; state = result.state;
    both = projectTrajectorySelection(state.document, ids, 2100); if (!both.eligible) throw new Error(both.code!);
    result = dispatchAuthoringOperation(state, { ...envelope('motion.settled-hold.set', 3, 'hold-1'), payload: { targets: both.targets, sourceTimeMs: 2100, settledTimeMs: 1820, landingTimeMs: 840, boundaryTimeMs: 2100 } }); expect(result.ok).toBe(true); if (!result.ok) return;
    expect(ids.every((id) => { const trajectory = projectTransformTrajectory(result.state.document, id); return trajectory.eligible && trajectory.waypoints.some((point) => point.timeMs === 1820) && trajectory.waypoints.some((point) => point.timeMs === 2100); })).toBe(true);
    const heldDigest = sha256Hex(canonicalContentBytes(result.state.document));
    const undone = dispatchAuthoringOperation(result.state, envelope('motion.history.undo', 4, 'hold-undo'));
    expect(undone.ok).toBe(true); if (!undone.ok) return;
    expect(sha256Hex(canonicalContentBytes(undone.state.document))).toBe(sha256Hex(canonicalContentBytes(state.document)));
    const redone = dispatchAuthoringOperation(undone.state, envelope('motion.history.redo', 5, 'hold-redo'));
    expect(redone.ok).toBe(true); if (!redone.ok) return;
    expect(sha256Hex(canonicalContentBytes(redone.state.document))).toBe(heldDigest);
  });

  test('settled hold rejects existing-time collisions and duplicate targets atomically', () => {
    const collision = structuredClone(base); addWaypointAt(collision, 1820);
    const collisionSelection = projectTrajectorySelection(collision, ids, 2100);
    expect(collisionSelection.eligible).toBe(true); if (!collisionSelection.eligible) return;
    const collisionBefore = sha256Hex(canonicalContentBytes(collision));
    const collided = dispatchAuthoringOperation(createAuthoringState(collision),
      holdOperation(collision, 'hold-collision', collisionSelection.targets));
    expect(collided.ok).toBe(false);
    expect(sha256Hex(canonicalContentBytes(collided.state.document))).toBe(collisionBefore);

    const selection = projectTrajectorySelection(base, ids, 2100); if (!selection.eligible) throw new Error(selection.code!);
    const duplicate = dispatchAuthoringOperation(createAuthoringState(base),
      holdOperation(base, 'hold-duplicate', [selection.targets[0]!, selection.targets[0]!]));
    expect(duplicate.ok).toBe(false);
    expect(sha256Hex(canonicalContentBytes(duplicate.state.document))).toBe(sha256Hex(canonicalContentBytes(base)));
  });

  test('stale or partial bundles reject without changing any member', () => {
    const selection = projectTrajectorySelection(base, ids, 700); if (!selection.eligible) throw new Error(selection.code!);
    const before = sha256Hex(canonicalContentBytes(base));
    const partial = dispatchAuthoringOperation(createAuthoringState(base), { ...envelope('motion.keyframe-group-time.set', 0, 'partial'), payload: { targets: [selection.targets[0]], sourceTimeMs: 700, targetTimeMs: 900, landingTimeMs: 900, settledTimeMs: 2100 } });
    expect(partial.ok).toBe(false); expect(sha256Hex(canonicalContentBytes(partial.state.document))).toBe(before);
  });
});
