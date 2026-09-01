import { describe, expect, test } from 'vitest';

import { importMotionHtml } from '../../css-import/src/index.js';
import { compileMotionDocument } from '../../css-compiler/src/index.js';
import {
  canonicalContentBytes, createAuthoringState, cueTargetSnapshots, deriveCueId,
  dispatchAuthoringOperation, expandCue, cueExpansionInput, projectCueReplacement, sha256Hex,
  type AuthoringCue, type AuthoringState, type CueAuthoringOperation, type CueSemantic,
} from './index.js';

function scene(): AuthoringState {
  const imported = importMotionHtml(`<!doctype html><html><head><style>
    .seed { animation: seed 2s linear both; }
    @keyframes seed { from { opacity: 0; } to { opacity: 1; } }
  </style></head><body><div class="seed"></div><i></i><b></b><em></em></body></html>`);
  if (!imported.document) throw new Error('synthetic import failed');
  const document = imported.document;
  document.elements.push(
    { id: 'el_cue_cursor', selectorHint: '', structuralFingerprint: 'synthetic/cursor' },
    { id: 'el_cue_pulse', selectorHint: '', structuralFingerprint: 'synthetic/pulse' },
    { id: 'el_cue_reveal', selectorHint: '', structuralFingerprint: 'synthetic/reveal' },
  );
  const unused = document.elements.filter((element) => !document.tracks.some((track) => track.elementId === element.id));
  expect(unused).toHaveLength(3);
  document.durationMs = 2000;
  return createAuthoringState(document);
}

function create(state: AuthoringState, key: string, semantic: CueSemantic): CueAuthoringOperation {
  const cueId = deriveCueId(state.document.documentId, key);
  return { schemaVersion: 'motion.operation.v1', kind: 'motion.cue.create', operationId: `create:${key}`,
    documentId: state.document.documentId, expectedRevision: state.document.revision,
    payload: { cueId, semantic, targetSnapshots: cueTargetSnapshots(state.document, semantic),
      replacementTrackIds: [], replacementInputDigest: null } };
}

function dispatch(state: AuthoringState, operation: CueAuthoringOperation): AuthoringState {
  const result = dispatchAuthoringOperation(state, operation);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.state;
}

describe('deterministic cursor, click, and reveal cue authoring', () => {
  test('expands selector-independent snapshots to byte-identical owned tracks', () => {
    const state = scene(); const [cursor] = state.document.elements.filter((element) =>
      !state.document.tracks.some((track) => track.elementId === element.id));
    const semantic: CueSemantic = { kind: 'cursor-path', cursorTargetId: cursor!.id, startMs: 100, arriveMs: 700,
      easing: { kind: 'keyword', value: 'ease-out' }, waypoints: [
        { timeMs: 100, xPpm: 50_000, yPpm: 100_000 }, { timeMs: 400, xPpm: 300_000, yPpm: 400_000 },
        { timeMs: 700, xPpm: 600_000, yPpm: 500_000 },
      ] };
    const input = cueExpansionInput(deriveCueId(state.document.documentId, 'cursor'), semantic,
      cueTargetSnapshots(state.document, semantic));
    const runs = [expandCue(input), expandCue(input), expandCue(input)];
    expect(new Set(runs.map((run) => run.inputDigest))).toHaveLength(1);
    expect(new Set(runs.map((run) => run.expansionDigest))).toHaveLength(1);
    expect(runs[0]).toEqual(runs[1]);
    expect(runs[0]!.rules[0]!.tracks[2]!.keyframes.map((frame) => frame.value)).toEqual([
      'translate(5vw, 10vh)', 'translate(30vw, 40vh)', 'translate(60vw, 50vh)',
    ]);
    expect(runs[0]!.rules[0]!.tracks.map((track) => track.property)).toEqual(['left', 'top', 'transform', 'opacity']);
    expect(runs[0]!.rules[0]!.tracks[0]!.keyframes.map((frame) => frame.value)).toEqual(['0px', '0px']);
    expect(runs[0]!.rules[0]!.tracks[1]!.keyframes.map((frame) => frame.value)).toEqual(['0px', '0px']);
    expect(runs[0]!.rules[0]!.tracks[3]!.keyframes.map((frame) => frame.value)).toEqual(['1', '1']);
    expect(runs[0]!.tracks.map((track) => track.property)).toEqual(['left', 'top', 'transform', 'opacity']);
    expect(JSON.stringify(runs[0])).not.toMatch(/selectorHint":"[^\"]|Date|candidate/i);
  });

  test('creates, updates, locks, detaches, and exactly replays the complete lifecycle', () => {
    let state = scene(); const targets = state.document.elements.filter((element) =>
      !state.document.tracks.some((track) => track.elementId === element.id));
    const [cursor, pulse, revealTarget] = targets;
    const revealSemantic: CueSemantic = { kind: 'reveal', targetIds: [revealTarget!.id], startMs: 800, completeMs: 1200 };
    state = dispatch(state, create(state, 'reveal', revealSemantic));
    const revealCue = state.document.cues.find((cue) => cue.schemaVersion === 'motion.authoring-cue.v1')!;
    const pathSemantic: CueSemantic = { kind: 'cursor-path', cursorTargetId: cursor!.id, startMs: 100, arriveMs: 700,
      easing: { kind: 'keyword', value: 'ease-out' }, waypoints: [
        { timeMs: 100, xPpm: 50_000, yPpm: 100_000 }, { timeMs: 700, xPpm: 600_000, yPpm: 500_000 },
      ] };
    state = dispatch(state, { ...create(state, 'path', pathSemantic), operationId: 'create:path' });
    const clickSemantic: CueSemantic = { kind: 'click', cursorTargetId: cursor!.id, pulseTargetId: pulse!.id,
      arriveMs: 700, pressMs: 800, releaseMs: 920, pulseEndMs: 1300, pressScalePpm: 820_000,
      pulseRadiusPpm: 18_000_000, pulseOpacityPpm: 700_000, revealCueId: revealCue.id };
    state = dispatch(state, { ...create(state, 'click', clickSemantic), operationId: 'create:click' });
    const click = state.document.cues.find((cue) => cue.schemaVersion === 'motion.authoring-cue.v1'
      && cue.semantic.kind === 'click')! as AuthoringCue;
    expect(state.document.tracks.filter((track) => track.cueOwnership)).toHaveLength(8);
    const lockedTrack = state.document.tracks.find((track) => track.cueOwnership)!;
    const beforeLocked = sha256Hex(canonicalContentBytes(state.document));
    const locked = dispatchAuthoringOperation(state, { schemaVersion: 'motion.operation.v1', kind: 'motion.keyframe-value.set',
      operationId: 'locked-edit', documentId: state.document.documentId, expectedRevision: state.document.revision,
      elementId: lockedTrack.elementId, trackId: lockedTrack.id, keyframeId: lockedTrack.keyframeIds[0], payload: { value: .5 } });
    expect(locked).toMatchObject({ ok: false, diagnostic: { code: 'CUE_TRACK_LOCKED' } });
    expect(sha256Hex(canonicalContentBytes(locked.state.document))).toBe(beforeLocked);

    const updatedSemantic = { ...click.semantic, releaseMs: 980 } as CueSemantic;
    state = dispatch(state, { schemaVersion: 'motion.operation.v1', kind: 'motion.cue.update', operationId: 'update:click',
      documentId: state.document.documentId, expectedRevision: state.document.revision,
      payload: { cueId: click.id, expectedExpansionDigest: click.expansionDigest, semantic: updatedSemantic,
        targetSnapshots: cueTargetSnapshots(state.document, updatedSemantic) } });
    const updated = state.document.cues.find((cue) => cue.id === click.id && cue.schemaVersion === 'motion.authoring-cue.v1')! as AuthoringCue;
    const beforeDetach = compileMotionDocument(state.document);
    state = dispatch(state, { schemaVersion: 'motion.operation.v1', kind: 'motion.cue.detach', operationId: 'detach:click',
      documentId: state.document.documentId, expectedRevision: state.document.revision,
      payload: { cueId: updated.id, expectedExpansionDigest: updated.expansionDigest, expectedReplacementInputDigest: null } });
    const afterDetach = compileMotionDocument(state.document);
    expect(afterDetach.html).toBe(beforeDetach.html); expect(afterDetach.css).toBe(beforeDetach.css);
    expect(state.document.cues.some((cue) => cue.id === click.id)).toBe(false);
    expect(state.document.tracks.filter((track) => updated.generatedTrackIds.includes(track.id))
      .every((track) => !track.cueOwnership)).toBe(true);

    const detachedDigest = sha256Hex(canonicalContentBytes(state.document));
    const undo = dispatchAuthoringOperation(state, { schemaVersion: 'motion.operation.v1', kind: 'motion.history.undo',
      operationId: 'undo:detach', documentId: state.document.documentId, expectedRevision: state.document.revision });
    expect(undo.ok).toBe(true); if (!undo.ok) return;
    expect(compileMotionDocument(undo.state.document).css).toBe(beforeDetach.css);
    const redo = dispatchAuthoringOperation(undo.state, { schemaVersion: 'motion.operation.v1', kind: 'motion.history.redo',
      operationId: 'redo:detach', documentId: state.document.documentId, expectedRevision: undo.state.document.revision });
    expect(redo.ok).toBe(true); if (!redo.ok) return;
    expect(sha256Hex(canonicalContentBytes(redo.state.document))).toBe(detachedDigest);
  });

  test('rejects replacement-backed target scope changes without changing canonical content', () => {
    let state = scene();
    const seedTrack = state.document.tracks[0]!;
    const sourceTarget = state.document.elements.find((element) => element.id === seedTrack.elementId)!;
    const unusedTarget = state.document.elements.find((element) => !state.document.tracks.some((track) =>
      track.elementId === element.id))!;
    const semantic: CueSemantic = { kind: 'reveal', targetIds: [sourceTarget.id], startMs: 100, completeMs: 500 };
    const cueId = deriveCueId(state.document.documentId, 'replacement-reveal');
    const replacement = projectCueReplacement(state.document, cueId, semantic);
    expect(replacement.ok).toBe(true); if (!replacement.ok) throw new Error(replacement.code);
    state = dispatch(state, { schemaVersion: 'motion.operation.v1', kind: 'motion.cue.create', operationId: 'replace:create',
      documentId: state.document.documentId, expectedRevision: 0, payload: { cueId, semantic,
        targetSnapshots: cueTargetSnapshots(state.document, semantic), replacementTrackIds: [seedTrack.id],
        replacementInputDigest: replacement.inputDigest } });
    const cue = state.document.cues.find((candidate) => candidate.id === cueId)! as AuthoringCue;
    const before = sha256Hex(canonicalContentBytes(state.document));
    const moved: CueSemantic = { ...semantic, targetIds: [unusedTarget.id] };
    const result = dispatchAuthoringOperation(state, { schemaVersion: 'motion.operation.v1', kind: 'motion.cue.update',
      operationId: 'replace:move', documentId: state.document.documentId, expectedRevision: state.document.revision,
      payload: { cueId, expectedExpansionDigest: cue.expansionDigest, semantic: moved,
        targetSnapshots: cueTargetSnapshots(state.document, moved) } });
    expect(result).toMatchObject({ ok: false, diagnostic: { code: 'CUE_REPLACEMENT_SCOPE_CHANGE' } });
    expect(sha256Hex(canonicalContentBytes(result.state.document))).toBe(before);
  });
});
