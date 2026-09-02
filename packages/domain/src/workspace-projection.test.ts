import { describe, expect, test } from 'vitest';

import { canonicalJson, projectWorkspace } from './index.js';
import { createPhase3Seed } from '../../local-service/src/seed.js';

describe('motion.workspace-projection.v1', () => {
  test('is canonical, deterministic, writable, and presentation-private', () => {
    const seed = createPhase3Seed();
    const first = projectWorkspace(seed, 'main', { undoAvailable: false, redoAvailable: false });
    const second = projectWorkspace(structuredClone(seed), 'main', { undoAvailable: false, redoAvailable: false });
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    expect(first.eligibility).toHaveLength(27);
    expect(first.eligibility.find((item) => item.kind === 'motion.history.undo'))
      .toEqual({ kind: 'motion.history.undo', eligible: false, reasonCode: 'AUTHORING_HISTORY_EMPTY' });
    expect(first.rules.flatMap((rule) => rule.tracks).flatMap((track) => track.keyframes)
      .some((frame) => frame.value !== null)).toBe(true);
    const bytes = canonicalJson(first);
    for (const forbidden of ['presentation', 'selectorHint', 'structuralFingerprint', 'editableText',
      'sourceName', 'sourceDigest', 'originalSourceDigest', 'resourceLockDigest', '<style', '<div', 'https://']) {
      expect(bytes).not.toContain(forbidden);
    }
  });
  test('projects every slot-specific keyframe time and state-derived operation eligibility', () => {
    const seed = createPhase3Seed(); const sourceTrack = seed.tracks[0]!;
    const sourceRule = seed.rules.find((rule) => rule.id === sourceTrack.ruleId)!;
    const sourceRuleTrack = sourceRule.tracks.find((track) => track.property === sourceTrack.property)!;
    seed.applications.push({ id: 'application_multi', selectorHint: '', bindings: [{ elementId: sourceTrack.elementId,
      delayOverridesMs: [300] }], slots: [{ id: 'slot_multi', ruleId: sourceTrack.ruleId, durationMs: 2000,
      delayMs: 100, iterationCount: 1, direction: 'normal', fillMode: 'both', playState: 'running',
      timingFunction: { kind: 'keyword', value: 'linear' } }] });
    seed.tracks.push({ ...sourceTrack, id: 'track_multi', slotId: 'slot_multi' });
    const projection = projectWorkspace(seed, 'main', { undoAvailable: true, redoAvailable: false });
    const projectedFrame = projection.rules.find((rule) => rule.ruleId === sourceRule.id)!.tracks
      .find((track) => track.ruleTrackId === sourceRuleTrack.id)!.keyframes[0]!;
    expect(projectedFrame.timings).toContainEqual({ slotId: 'slot_multi', elementId: sourceTrack.elementId,
      timeMs: 300 + Math.round(projectedFrame.offset * 2000) });
    expect(new Set(projectedFrame.timings.map((timing) => timing.slotId)).size).toBeGreaterThan(1);
    expect(projection.eligibility.find((item) => item.kind === 'motion.history.undo'))
      .toEqual({ kind: 'motion.history.undo', eligible: true, reasonCode: null });
    expect(projection.eligibility.find((item) => item.kind === 'motion.claim.renew'))
      .toEqual({ kind: 'motion.claim.renew', eligible: false, reasonCode: 'CLAIM_CONTEXT_REQUIRED' });
    const held = structuredClone(seed); held.holds = [{ schemaVersion: 'motion.hold.v1', id: 'hold_synthetic',
      cueId: 'cue_pair', sourceTimeMs: 2870, durationMs: 600 }];
    const heldProjection = projectWorkspace(held, 'main', { undoAvailable: true, redoAvailable: true });
    expect(heldProjection.eligibility.find((item) => item.kind === 'motion.cue.create'))
      .toEqual({ kind: 'motion.cue.create', eligible: false, reasonCode: 'AUTHORING_HOLD_LOCKED' });
    expect(heldProjection.eligibility.find((item) => item.kind === 'motion.history.undo'))
      .toEqual({ kind: 'motion.history.undo', eligible: false, reasonCode: 'AUTHORING_HOLD_LOCKED' });
    expect(heldProjection.eligibility.find((item) => item.kind === 'motion.history.redo'))
      .toEqual({ kind: 'motion.history.redo', eligible: false, reasonCode: 'AUTHORING_HOLD_LOCKED' });
    expect(heldProjection.eligibility.find((item) => item.kind === 'motion.hold.insert'))
      .toEqual({ kind: 'motion.hold.insert', eligible: false, reasonCode: 'AUTHORING_HOLD_COLLISION' });
  });
});
