import { readFileSync } from 'node:fs';
import { importMotionHtml } from '../../css-import/src/index.js';
import { expect, test } from 'vitest';
import { compileMotionDocument } from '../../css-compiler/src/index.js';
import { canonicalContentBytes, createAuthoringState, dispatchAuthoringOperation, projectAuthoringTargets,
  projectCueActionEligibility, projectHoldEligibility, projectTrackCreationEligibility, projectWorkspace,
  validateMotionDocument, projectShotWorkspace, projectTrajectorySelection, cueTargetSnapshots, deriveCueId, projectCueReplacement, type AuthoringState, type MotionDocument } from './index.js';
import { makeTrackCreateCommand, parseCommand, parseWorkspaceProjection } from '../../motion-protocol/src/index.js';

function scene(): MotionDocument {
  return { schemaVersion: 'motion.document.v1', documentId: 'shot_unfamiliar', revision: 0, durationMs: 3600,
    presentation: { html: '<div data-motion-id="object_91"></div><span data-motion-id="object_73">Hello</span>', css: '' },
    elements: [{ id: 'object_91', label: 'Tile', selectorHint: '.different', structuralFingerprint: 'div[0]' },
      { id: 'object_73', label: 'Tile', selectorHint: '.different-copy', structuralFingerprint: 'span[0]', editableText: 'Hello' }],
    rules: [], applications: [], tracks: [],
    cues: [{ schemaVersion: 'motion.cue.v1', id: 'beat_landing', label: 'Landing', timeMs: 1700 },
      { schemaVersion: 'motion.cue.v1', id: 'beat_finish', label: 'Finish', timeMs: 3400 }],
    inventory: { sourceDigest: 'a'.repeat(64), ruleCount: 0, applicationCount: 0, slotCount: 0, trackCount: 0,
      supportedCount: 0, unsupportedCount: 0, missingCount: 0, diagnosticCodes: [] },
    provenance: { sourceKind: 'direct', originalSourceDigest: 'a'.repeat(64), materializedSourceDigest: 'a'.repeat(64),
      resourceLockDigest: null, stylesheetDigest: null, aggregateFontAssetDigest: null, fontAssetCount: 0 },
    reducedMotion: { mode: 'source-snapshot', css: '' } };
}
function apply(state: AuthoringState, operation: Record<string, unknown>): AuthoringState {
  const result = dispatchAuthoringOperation(state, { schemaVersion: 'motion.operation.v1',
    documentId: state.document.documentId, expectedRevision: state.document.revision,
    operationId: `test:${state.document.revision}`, ...operation });
  if (!result.ok) throw new Error(result.diagnostic.code);
  return result.state;
}
function animated(): AuthoringState {
  return apply(createAuthoringState(scene()), { kind: 'motion.track.create', elementId: 'object_91', payload: {
    property: 'opacity', durationMs: 2200, delayMs: 300, easing: 'linear', startValue: 0.2, endValue: 0.9 } });
}

test('arbitrary static targets expose readable duplicate labels and actual supported actions', () => {
  const document = scene(); expect(validateMotionDocument(document).ok).toBe(true);
  const targets = projectAuthoringTargets(document);
  expect(targets.map((target) => target.label)).toEqual(['Tile', 'Tile']);
  expect(targets.map((target) => target.elementId)).toEqual(['object_73', 'object_91']);
  for (const target of targets) for (const action of ['move', 'fade', 'reveal', 'click', 'select', 'drag'])
    expect(target.actions.find((item) => item.action === action)).toMatchObject({ available: true, reason: null });
  expect(targets[0]!.actions.find((item) => item.action === 'type')).toMatchObject({ available: true });
  expect(targets[1]!.actions.find((item) => item.action === 'type'))
    .toMatchObject({ available: false, reason: 'CUE_TEXT_TARGET_REQUIRED' });
  expect(targets[0]!.actions.find((item) => item.action === 'hold'))
    .toMatchObject({ available: false, reason: 'CUE_HOLD_TARGET_UNANIMATED' });
  const projection = projectWorkspace(document, 'main', { undoAvailable: false, redoAvailable: false });
  expect(projection.elements).toEqual(targets);
  expect(parseWorkspaceProjection(projection)).toEqual(projection);
});

test('general structural timing/values survive exact undo and redo while other targets remain independent', () => {
  const initial = createAuthoringState(scene());
  const command = makeTrackCreateCommand({ operationId: 'create:custom', documentId: initial.document.documentId,
    expectedRevision: 0, elementId: 'object_91', durationMs: 2200, delayMs: 300, startValue: 0.2, endValue: 0.9 });
  expect(parseCommand(command)).toEqual({ ok: true, command });
  const created = dispatchAuthoringOperation(initial, command.command);
  expect(created.ok).toBe(true); if (!created.ok) return;
  expect(projectTrackCreationEligibility(created.state.document, 'object_73', 'opacity').available).toBe(true);
  expect(projectAuthoringTargets(created.state.document).find((target) => target.elementId === 'object_91')!
    .actions.find((item) => item.action === 'hold')?.available).toBe(true);
  const content = canonicalContentBytes(created.state.document);
  const undone = apply(created.state, { kind: 'motion.history.undo' });
  expect(canonicalContentBytes(undone.document)).toEqual(canonicalContentBytes(initial.document));
  const redone = apply(undone, { kind: 'motion.history.redo' });
  expect(canonicalContentBytes(redone.document)).toEqual(content);
  const invalid = dispatchAuthoringOperation(initial, { ...command.command, payload: { ...command.command.payload, durationMs: 4000 } });
  expect(invalid).toMatchObject({ ok: false, diagnostic: { code: 'AUTHORING_TRACK_CREATE_INVALID' } });
  expect(initial.document).toEqual(scene());
});

test('chosen hold ripples later cues and total duration without changing source tracks and undoes exactly', () => {
  const initial = animated(); initial.document.holds = [];
  const before = canonicalContentBytes(initial.document);
  const held = apply(initial, { kind: 'motion.hold.insert', payload: { cueId: 'beat_landing', durationMs: 430 } });
  expect(held.document.durationMs).toBe(4030);
  expect(held.document.cues.map((cue) => [cue.id, cue.timeMs])).toEqual([['beat_landing', 2130], ['beat_finish', 3830]]);
  expect(held.document.rules).toEqual(initial.document.rules);
  expect(held.document.applications).toEqual(initial.document.applications);
  expect(projectWorkspace(held.document, 'main', { undoAvailable: true, redoAvailable: false }).eligibility
    .find((entry) => entry.kind === 'motion.history.undo')?.eligible).toBe(true);
  const undone = apply(held, { kind: 'motion.history.undo' });
  expect(canonicalContentBytes(undone.document)).toEqual(before);
  expect(canonicalContentBytes(apply(undone, { kind: 'motion.history.redo' }).document))
    .toEqual(canonicalContentBytes(held.document));
});

test('hold and cue discovery reject unsupported timing or unavailable text before mutation', () => {
  for (const change of [
    (document: MotionDocument) => { document.applications[0]!.slots[0]!.iterationCount = 2; },
    (document: MotionDocument) => { document.applications[0]!.slots[0]!.direction = 'reverse'; },
    (document: MotionDocument) => { document.applications[0]!.slots[0]!.durationMs = 0; },
  ]) {
    const state = animated(); change(state.document); const before = structuredClone(state);
    expect(projectHoldEligibility(state.document, 'beat_landing').available).toBe(false);
    expect(dispatchAuthoringOperation(state, { schemaVersion: 'motion.operation.v1', operationId: 'hold:bad',
      documentId: state.document.documentId, expectedRevision: state.document.revision, kind: 'motion.hold.insert',
      payload: { cueId: 'beat_landing', durationMs: 430 } }).ok).toBe(false);
    expect(state).toEqual(before);
  }
  expect(projectCueActionEligibility(scene(), { kind: 'type', targetId: 'object_91', startMs: 0, completeMs: 500, stepCount: 3 }).available)
    .toBe(false);
  expect(projectHoldEligibility(scene(), 'missing')).toEqual({ available: false, reason: 'AUTHORING_HOLD_CUE_MISSING' });
});


test('trajectory workspace and settled hold use loaded durations and selected target count', () => {
  const source = readFileSync(new URL('../../../fixtures/public-synthetic/landing-shot1.html', import.meta.url), 'utf8');
  const imported = importMotionHtml(source); if (!imported.document) throw new Error('PUBLIC_IMPORT_FAILED');
  const document = structuredClone(imported.document); document.documentId = 'shot_scaled';
  document.durationMs *= 2;
  for (const cue of document.cues) cue.timeMs *= 2;
  for (const app of document.applications) {
    for (const slot of app.slots) { slot.durationMs *= 2; slot.delayMs *= 2; }
    for (const binding of app.bindings) binding.delayOverridesMs = binding.delayOverridesMs.map((delay) => delay * 2);
  }
  const ids = document.elements.map((element) => element.id);
  expect(projectShotWorkspace(document, { startMs: 0, landedMs: 1400, settledMs: 4200,
    targetElementIds: [ids[0]!] }).eligible).toBe(true);
  const targets = projectTrajectorySelection(document, ids, 4200).targets;
  const initial = createAuthoringState(document);
  const held = apply(initial, { kind: 'motion.settled-hold.set', payload: {
    targets, sourceTimeMs: 4200, settledTimeMs: 3640, landingTimeMs: 1680, boundaryTimeMs: 4200 } });
  expect(validateMotionDocument(held.document).ok).toBe(true);
  expect(canonicalContentBytes(apply(held, { kind: 'motion.history.undo' }).document))
    .toEqual(canonicalContentBytes(document));
});


test('whole-shot pause rejects attached cue metadata and unsupported crossing interpolation visibly', () => {
  const document = scene();
  const semantic = { kind: 'reveal' as const, targetIds: ['object_91'], startMs: 0, completeMs: 1800 };
  const cueId = deriveCueId(document.documentId, 'new-reveal');
  const replacement = projectCueReplacement(document, cueId, semantic);
  if (!replacement.ok) throw new Error(replacement.code);
  const authored = apply(createAuthoringState(document), { kind: 'motion.cue.create', payload: {
    cueId, semantic, targetSnapshots: cueTargetSnapshots(document, semantic),
    replacementTrackIds: replacement.trackIds, replacementInputDigest: replacement.inputDigest } });
  expect(projectHoldEligibility(authored.document, 'beat_landing'))
    .toEqual({ available: false, reason: 'AUTHORING_HOLD_ATTACHED_CUES_UNSUPPORTED' });
  const matrix = animated().document;
  matrix.rules[0]!.tracks[0]!.property = 'transform';
  matrix.rules[0]!.tracks[0]!.keyframes[0]!.value = 'matrix(1,0,0,1,0,0)';
  matrix.rules[0]!.tracks[0]!.keyframes[1]!.value = 'matrix(0,1,-1,0,0,0)';
  matrix.tracks[0]!.property = 'transform';
  expect(validateMotionDocument(matrix).ok).toBe(true);
  expect(projectHoldEligibility(matrix, 'beat_landing'))
    .toEqual({ available: false, reason: 'AUTHORING_HOLD_INTERPOLATION_UNSUPPORTED' });
});


test.each([
  ['background-color', '#000000', '#ffffff', 'continuous'],
  ['visibility', 'visible', 'hidden', 'discrete'],
  ['transform', 'translateX(0%)', 'translateX(100%)', 'continuous'],
] as const)('unsupported crossing %s fails before mutation and cannot compile a fabricated pause',
  (property, from, to, interpolation) => {
    const state = animated();
    const track = state.document.rules[0]!.tracks[0]!;
    track.property = property; track.interpolation = interpolation;
    track.keyframes[0]!.value = from; track.keyframes[1]!.value = to;
    state.document.tracks[0]!.property = property;
    state.document.tracks[0]!.interpolation = interpolation;
    expect(validateMotionDocument(state.document).ok).toBe(true);
    expect(() => compileMotionDocument(state.document)).not.toThrow();
    const before = canonicalContentBytes(state.document);
    expect(projectHoldEligibility(state.document, 'beat_landing').available).toBe(false);
    expect(dispatchAuthoringOperation(state, { schemaVersion: 'motion.operation.v1', operationId: 'bad:pause',
      documentId: state.document.documentId, expectedRevision: state.document.revision,
      kind: 'motion.hold.insert', payload: { cueId: 'beat_landing', durationMs: 430 } }).ok).toBe(false);
    expect(canonicalContentBytes(state.document)).toEqual(before);
    const held = apply(animated(), { kind: 'motion.hold.insert', payload: { cueId: 'beat_landing', durationMs: 430 } });
    held.document.rules = structuredClone(state.document.rules);
    held.document.tracks = structuredClone(state.document.tracks);
    expect(validateMotionDocument(held.document).ok).toBe(true);
    expect(() => compileMotionDocument(held.document)).toThrow('COMPILER_HOLD_INTERPOLATION_UNSUPPORTED');
  });


test.each([
  ['opacity:0', '50%{opacity:.5}100%{opacity:1}', 'linear', 500, 'AUTHORING_HOLD_IMPLICIT_ENDPOINT_UNSUPPORTED'],
  ['opacity:0', '0%{opacity:0}50%{opacity:.5}', 'linear', 1500, 'AUTHORING_HOLD_IMPLICIT_ENDPOINT_UNSUPPORTED'],
  ['', 'from{transform:rotate(0deg)}to{transform:rotate(90deg)}', 'steps(4,end)', 0, 'AUTHORING_HOLD_INTERPOLATION_UNSUPPORTED'],
] as const)('pause discovery rejects unsupported implicit or stepped segments (%s, %s)', (base, frames, easing, time, reason) => {
  const imported = importMotionHtml(`<style>.box{${base};animation:a 2000ms ${easing} both}@keyframes a{${frames}}</style><div class="box"></div>`);
  expect(imported.inventory.unsupportedCount).toBe(0);
  expect(imported.inventory.missingCount).toBe(0);
  const document = imported.document!;
  document.cues = [{ schemaVersion: 'motion.cue.v1', id: 'chosen', label: 'Chosen', timeMs: time }];
  expect(() => compileMotionDocument(document)).not.toThrow();
  const state = createAuthoringState(document); const before = canonicalContentBytes(document);
  expect(projectHoldEligibility(document, 'chosen', 500)).toEqual({ available: false, reason });
  expect(dispatchAuthoringOperation(state, { schemaVersion: 'motion.operation.v1', operationId: 'unsupported:hold',
    documentId: document.documentId, expectedRevision: 0, kind: 'motion.hold.insert',
    payload: { cueId: 'chosen', durationMs: 500 } }).ok).toBe(false);
  expect(canonicalContentBytes(state.document)).toEqual(before);
});


test.each([0.0079, 0.007899, 0.007901, 0.000001, 0, 1])('six-decimal opacity %s survives canonical creation and exact history', (value) => {
  const initial = createAuthoringState(scene());
  const created = apply(initial, { kind: 'motion.track.create', elementId: 'object_91', payload: {
    property: 'opacity', durationMs: 1000, delayMs: 0, easing: 'linear', startValue: value, endValue: 1 } });
  expect(Number(created.document.rules[0]!.tracks[0]!.keyframes[0]!.value)).toBe(value);
  const content = canonicalContentBytes(created.document);
  const undone = apply(created, { kind: 'motion.history.undo' });
  expect(canonicalContentBytes(undone.document)).toEqual(canonicalContentBytes(initial.document));
  expect(canonicalContentBytes(apply(undone, { kind: 'motion.history.redo' }).document)).toEqual(content);
  const invalid = dispatchAuthoringOperation(initial, { schemaVersion: 'motion.operation.v1', operationId: 'too:precise',
    documentId: initial.document.documentId, expectedRevision: 0, kind: 'motion.track.create', elementId: 'object_91',
    payload: { property: 'opacity', durationMs: 1000, delayMs: 0, easing: 'linear', startValue: 0.0079001, endValue: 1 } });
  expect(invalid).toMatchObject({ ok: false, diagnostic: { code: 'AUTHORING_TRACK_CREATE_INVALID' } });
});
