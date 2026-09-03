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
    expect([runs[0]!.inputDigest, runs[0]!.expansionDigest]).toEqual([
      'b1c58f9b5eacc128cfea5da868a6486d27baf55c41c73c85a78898918e2ad9cc',
      '10e4aef1f64de7ea6a3b5ad37ff98204dbb8bda6b4718ca411ffec459b29345e',
    ]);
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

describe('deterministic reusable cue breadth', () => {
  const reusableScene = (): AuthoringState => {
    const imported = importMotionHtml(`<!doctype html><html><head><style>
      .hold { animation: hold-source 2s linear both; }
      .hold-two { animation: hold-source-two 2s linear both; }
      .hold-missing-boundary { animation: hold-missing 2s linear both; }
      @keyframes hold-source { 0% { opacity: 0; } 50% { opacity: .5; } 100% { opacity: 1; } }
      @keyframes hold-source-two { 0% { transform: scale(.8); } 50% { transform: scale(1); } 100% { transform: scale(1.2); } }
      @keyframes hold-missing { 0% { opacity: 0; } 40% { opacity: .4; } 100% { opacity: 1; } }
    </style></head><body><div class="hold"></div><section class="hold-two"></section>
      <aside class="hold-missing-boundary"></aside><span></span><i></i><b></b></body></html>`);
    if (!imported.document) throw new Error('synthetic import failed');
    imported.document.elements.push(
      { id: 'el_type', selectorHint: '', structuralFingerprint: 'synthetic/type', editableText: 'Synthetic text' },
      { id: 'el_cursor', selectorHint: '', structuralFingerprint: 'synthetic/cursor' },
      { id: 'el_selected', selectorHint: '', structuralFingerprint: 'synthetic/selected' },
      { id: 'el_highlight', selectorHint: '', structuralFingerprint: 'synthetic/highlight' },
      { id: 'el_dragged', selectorHint: '', structuralFingerprint: 'synthetic/dragged' },
    );
    imported.document.durationMs = 3000;
    return createAuthoringState(imported.document);
  };

  test('materializes Type as a stepped width reveal without changing text', () => {
    const state = reusableScene();
    const semantic = { kind: 'type', targetId: 'el_type', startMs: 200, completeMs: 1000, stepCount: 8 } as unknown as CueSemantic;
    const expansion = expandCue(cueExpansionInput(deriveCueId(state.document.documentId, 'type'), semantic,
      cueTargetSnapshots(state.document, semantic)));
    expect(expansion.rules).toHaveLength(1);
    expect(expansion.rules[0]!.tracks).toEqual([expect.objectContaining({ property: 'clip-path', interpolation: 'step',
      keyframes: [expect.objectContaining({ offset: 0, value: 'inset(0 100% 0 0)' }),
        expect.objectContaining({ offset: 1, value: 'inset(0 0% 0 0)' })] })]);
    expect(expansion.applications[0]!.slots[0]).toMatchObject({ durationMs: 800, delayMs: 200,
      fillMode: 'both', timingFunction: { kind: 'steps', count: 8, position: 'end' } });
    expect(state.document.elements.find((element) => element.id === 'el_type')!.editableText).toBe('Synthetic text');
  });

  test('rejects Type on a non-text target and rejects overlapping Select and Drag roles', () => {
    const state = reusableScene();
    const invalid = [
      { kind: 'type', targetId: 'el_dragged', startMs: 0, completeMs: 500, stepCount: 5 },
      { kind: 'select', cursorTargetId: 'el_cursor', selectedTargetId: 'el_cursor', approachMs: 0, chooseMs: 100, settleMs: 200 },
      { kind: 'drag', cursorTargetId: 'el_dragged', draggedTargetId: 'el_dragged', approachMs: 0, pressMs: 100,
        moveStartMs: 200, arriveMs: 600, releaseMs: 700, grabOffsetXPpm: 0, grabOffsetYPpm: 0,
        waypoints: [{ timeMs: 200, xPpm: 0, yPpm: 0 }, { timeMs: 600, xPpm: 100_000, yPpm: 100_000 }] },
    ] as CueSemantic[];
    for (const [index, semantic] of invalid.entries()) expect(() => expandCue(cueExpansionInput(
      deriveCueId(state.document.documentId, `invalid-reusable-${index}`), semantic, cueTargetSnapshots(state.document, semantic),
    ))).toThrow();
  });

  test('materializes Select with approach, choose, settle, and an existing highlight boundary', () => {
    const state = reusableScene();
    const semantic = { kind: 'select', cursorTargetId: 'el_cursor', selectedTargetId: 'el_selected',
      highlightTargetId: 'el_highlight', approachMs: 100, chooseMs: 400, settleMs: 700 } as unknown as CueSemantic;
    const expansion = expandCue(cueExpansionInput(deriveCueId(state.document.documentId, 'select'), semantic,
      cueTargetSnapshots(state.document, semantic)));
    expect(expansion.tracks.map((track) => [track.elementId, track.property])).toEqual([
      ['el_cursor', 'scale'], ['el_highlight', 'opacity'], ['el_highlight', 'visibility'],
    ]);
    const visibility = expansion.rules.flatMap((rule) => rule.tracks).find((track) => track.property === 'visibility')!;
    expect(visibility.keyframes.map((frame) => [frame.offset, frame.value])).toEqual([[0, 'hidden'], [0.5, 'visible'], [1, 'visible']]);
  });

  test('materializes Drag with one stored grab offset and coordinated cursor/object arrivals', () => {
    const state = reusableScene();
    const semantic = { kind: 'drag', cursorTargetId: 'el_cursor', draggedTargetId: 'el_dragged',
      approachMs: 100, pressMs: 300, moveStartMs: 400, arriveMs: 900, releaseMs: 1000,
      grabOffsetXPpm: 20_000, grabOffsetYPpm: -30_000, waypoints: [
        { timeMs: 400, xPpm: 100_000, yPpm: 200_000 }, { timeMs: 650, xPpm: 450_000, yPpm: 500_000 },
        { timeMs: 900, xPpm: 700_000, yPpm: 600_000 },
      ] } as unknown as CueSemantic;
    const expansion = expandCue(cueExpansionInput(deriveCueId(state.document.documentId, 'drag'), semantic,
      cueTargetSnapshots(state.document, semantic)));
    const transforms = expansion.rules.flatMap((rule) => rule.tracks).filter((track) => track.property === 'transform');
    expect(transforms).toHaveLength(2);
    expect(expansion.tracks.filter((track) => ['left', 'top'].includes(track.property)).map((track) =>
      [track.elementId, track.property])).toEqual([
      ['el_cursor', 'left'], ['el_cursor', 'top'], ['el_dragged', 'left'], ['el_dragged', 'top'],
    ]);
    expect(transforms[0]!.keyframes.map((frame) => frame.value)).toEqual([
      'translate(12vw, 17vh)', 'translate(12vw, 17vh)', 'translate(12vw, 17vh)',
      'translate(47vw, 47vh)', 'translate(72vw, 57vh)', 'translate(72vw, 57vh)',
    ]);
    expect(transforms[1]!.keyframes.map((frame) => frame.value)).toEqual([
      'translate(10vw, 20vh)', 'translate(45vw, 50vh)', 'translate(70vw, 60vh)', 'translate(70vw, 60vh)',
    ]);
  });

  test('materializes Hold by duplicating an explicit enter boundary and shifting later source timing', () => {
    const state = reusableScene();
    const sourceTrack = state.document.tracks[0]!;
    const semantic = { kind: 'hold', targetIds: [sourceTrack.elementId], enterMs: 1000, durationMs: 500,
      exitMs: 1500 } as unknown as CueSemantic;
    const cueId = deriveCueId(state.document.documentId, 'hold');
    const replacement = projectCueReplacement(state.document, cueId, semantic);
    expect(replacement).toMatchObject({ ok: true, trackIds: [sourceTrack.id] });
    if (!replacement.ok) throw new Error(replacement.code);
    const operation = create(state, 'hold', semantic);
    if (operation.kind !== 'motion.cue.create') throw new Error('expected create');
    expect(operation.payload.replacementTrackIds).toEqual([]);
    operation.payload.replacementTrackIds = replacement.trackIds;
    operation.payload.replacementInputDigest = replacement.inputDigest;
    const next = dispatch(state, operation).document;
    const hold = next.cues.find((cue): cue is AuthoringCue => cue.schemaVersion === 'motion.authoring-cue.v1'
      && cue.semantic.kind === 'hold')!;
    const rule = next.rules.find((candidate) => hold.generatedRuleIds.includes(candidate.id))!;
    expect(rule.tracks[0]!.keyframes.map((frame) => [frame.offset, frame.value])).toEqual([
      [0, '0'], [0.4, '.5'], [0.6, '.5'], [1, '1'],
    ]);
    expect(next.durationMs).toBe(3500);
  });

  test('requires every Hold target to contribute an animated track with the explicit enter boundary', () => {
    const state = reusableScene();
    const animatedTargetIds = [...new Set(state.document.tracks.map((track) => track.elementId))];
    const validTargetIds = animatedTargetIds.slice(0, 2);
    const valid = { kind: 'hold', targetIds: validTargetIds, enterMs: 1000, durationMs: 500,
      exitMs: 1500 } as CueSemantic;
    const cueId = deriveCueId(state.document.documentId, 'multi-hold');
    const replacement = projectCueReplacement(state.document, cueId, valid);
    expect(replacement).toMatchObject({ ok: true });
    if (!replacement.ok) throw new Error(replacement.code);
    const operation = create(state, 'multi-hold', valid);
    if (operation.kind !== 'motion.cue.create') throw new Error('expected create');
    operation.payload.replacementTrackIds = replacement.trackIds;
    operation.payload.replacementInputDigest = replacement.inputDigest;
    const next = dispatch(state, operation).document;
    expect(next.tracks.filter((track) => track.cueOwnership?.cueId === cueId).map((track) => track.elementId).sort())
      .toEqual([...validTargetIds].sort());

    const before = { revision: state.document.revision, bytes: canonicalContentBytes(state.document) };
    const mixed = { ...valid, targetIds: [validTargetIds[0]!, 'el_type'] };
    expect(projectCueReplacement(state.document, deriveCueId(state.document.documentId, 'mixed-hold'), mixed))
      .toEqual({ ok: false, code: 'CUE_HOLD_TARGET_UNANIMATED' });
    const missingBoundary = { ...valid, targetIds: [validTargetIds[0]!, animatedTargetIds[2]!] };
    expect(projectCueReplacement(state.document, deriveCueId(state.document.documentId, 'boundary-hold'), missingBoundary))
      .toEqual({ ok: false, code: 'CUE_HOLD_ENTER_BOUNDARY_MISSING' });
    expect({ revision: state.document.revision, bytes: canonicalContentBytes(state.document) }).toEqual(before);
  });

  test('preserves every source playback field while inserting Hold time', () => {
    const state = reusableScene();
    const sourceTrack = state.document.tracks[0]!;
    const sourceApplication = state.document.applications.find((application) =>
      application.slots.some((slot) => slot.id === sourceTrack.slotId))!;
    const sourceSlot = sourceApplication.slots.find((slot) => slot.id === sourceTrack.slotId)!;
    Object.assign(sourceSlot, { iterationCount: 'infinite', direction: 'alternate-reverse', fillMode: 'backwards',
      playState: 'paused', timingFunction: { kind: 'keyword', value: 'ease-in-out' }, delayMs: 17 });
    const semantic = { kind: 'hold', targetIds: [sourceTrack.elementId], enterMs: 1000, durationMs: 500,
      exitMs: 1500 } as CueSemantic;
    const cueId = deriveCueId(state.document.documentId, 'metadata-hold');
    const replacement = projectCueReplacement(state.document, cueId, semantic);
    if (!replacement.ok) throw new Error(replacement.code);
    const operation = create(state, 'metadata-hold', semantic);
    if (operation.kind !== 'motion.cue.create') throw new Error('expected create');
    operation.payload.replacementTrackIds = replacement.trackIds;
    operation.payload.replacementInputDigest = replacement.inputDigest;
    const next = dispatch(state, operation).document;
    const cue = next.cues.find((candidate): candidate is AuthoringCue => candidate.schemaVersion === 'motion.authoring-cue.v1'
      && candidate.semantic.kind === 'hold')!;
    const generated = next.applications.find((application) => cue.generatedApplicationIds.includes(application.id))!;
    expect(generated.slots[0]).toMatchObject({ iterationCount: 'infinite', direction: 'alternate-reverse',
      fillMode: 'backwards', playState: 'paused', timingFunction: { kind: 'keyword', value: 'ease-in-out' }, delayMs: 17 });
  });

  test('fails Hold closed when its target has no explicit value boundary at enter', () => {
    const state = reusableScene();
    const semantic = { kind: 'hold', targetIds: [state.document.tracks[0]!.elementId], enterMs: 900,
      durationMs: 500, exitMs: 1400 } as unknown as CueSemantic;
    expect(projectCueReplacement(state.document, deriveCueId(state.document.documentId, 'invalid-hold'), semantic))
      .toEqual({ ok: false, code: 'CUE_HOLD_ENTER_BOUNDARY_MISSING' });
  });
});
