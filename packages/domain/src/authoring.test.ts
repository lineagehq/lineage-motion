import { describe, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';

import {
  canonicalContentBytes,
  createAuthoringState,
  dispatchAuthoringOperation,
  projectTrackCreationEligibility,
  type AuthoringOperation,
  type AuthoringState,
  type MotionDocument,
} from './index.js';
import { importMotionHtml } from '../../css-import/src/index.js';
import { compileMotionDocument } from '../../css-compiler/src/index.js';

function fixture(): MotionDocument {
  return {
    schemaVersion: 'motion.document.v1', documentId: 'doc', revision: 0, durationMs: 3000,
    presentation: { html: '<div data-motion-id="el"></div>', css: '' },
    elements: [{ id: 'el', selectorHint: '.copy', structuralFingerprint: 'html/body/div[0]' }],
    rules: [{ id: 'rule', sourceName: 'reveal', tracks: [{
      id: 'rule-track', property: 'opacity', interpolation: 'continuous',
      keyframes: [{ id: 'start', offset: 0, value: '0' }, { id: 'end', offset: 1, value: '1' }],
    }] }],
    applications: [{
      id: 'application', bindings: [{ elementId: 'el', delayOverridesMs: [820] }],
      selectorHint: '.copy', slots: [{
        id: 'slot', ruleId: 'rule', durationMs: 1700, delayMs: 820, iterationCount: 1,
        direction: 'normal', fillMode: 'both', playState: 'running',
        timingFunction: { kind: 'keyword', value: 'linear' },
      }],
    }],
    tracks: [{
      id: 'track', elementId: 'el', ruleId: 'rule', slotId: 'slot', property: 'opacity',
      interpolation: 'continuous', keyframeIds: ['start', 'end'],
    }],
    cues: [],
    inventory: {
      sourceDigest: 'a'.repeat(64), ruleCount: 1, applicationCount: 1, slotCount: 1,
      trackCount: 1, supportedCount: 4, unsupportedCount: 0, missingCount: 0,
      diagnosticCodes: [],
    },
    provenance: {
      sourceKind: 'direct', originalSourceDigest: 'a'.repeat(64),
      materializedSourceDigest: 'a'.repeat(64), resourceLockDigest: null,
      stylesheetDigest: null, aggregateFontAssetDigest: null, fontAssetCount: 0,
    },
    reducedMotion: { mode: 'source-snapshot', css: '' },
  };
}

const envelope = (operationId: string, expectedRevision: number) => ({
  schemaVersion: 'motion.operation.v1' as const, operationId, documentId: 'doc', expectedRevision,
});

describe('typed authoring operations', () => {
  test('accepts an explicit document-global revision allocated above a branch head', () => {
    const initial = fixture(); const result = dispatchAuthoringOperation(createAuthoringState(initial), {
      ...envelope('global-revision', 0), kind: 'motion.keyframe-value.set', elementId: 'el', trackId: 'track',
      keyframeId: 'start', payload: { value: 0.25 },
    }, 4);
    expect(result.ok && result.state.document.revision).toBe(4);
  });
  test('inserts only the approved 600 ms cue_pair hold and replays its exact inverse', async () => {
    const source = await readFile(new URL('../../../fixtures/public-synthetic/preview.html', import.meta.url), 'utf8');
    const imported = importMotionHtml(source);
    imported.document!.cues = [
      { schemaVersion: 'motion.cue.v1', id: 'cue_pair', label: 'Pair crosses', timeMs: 2870 },
      { schemaVersion: 'motion.cue.v1', id: 'cue_hold', label: 'Hold inspected', timeMs: 4310 },
      { schemaVersion: 'motion.cue.v1', id: 'cue_rest', label: 'Rest', timeMs: 4660 },
    ];
    let state = createAuthoringState(imported.document!);
    const beforeBytes = canonicalContentBytes(state.document);
    const beforeIds = {
      rules: state.document.rules.map((rule) => rule.id),
      tracks: state.document.tracks.map((track) => track.id),
      keyframes: state.document.rules.flatMap((rule) => rule.tracks.flatMap((track) =>
        track.keyframes.map((keyframe) => keyframe.id))),
    };
    const insert = { ...strictEnvelope(state, 'hold:insert'), kind: 'motion.hold.insert' as const,
      payload: { cueId: 'cue_pair' as const, durationMs: 600 as const } };
    const accepted = dispatchAuthoringOperation(state, insert);
    expect(accepted.ok).toBe(true); if (!accepted.ok) throw new Error(accepted.diagnostic.code);
    state = accepted.state;
    expect(state.document.durationMs).toBe(5260);
    expect(state.document.cues.map(({ id, timeMs }) => ({ id, timeMs }))).toEqual([
      { id: 'cue_pair', timeMs: 3470 }, { id: 'cue_hold', timeMs: 4910 },
      { id: 'cue_rest', timeMs: 5260 },
    ]);
    expect(state.document.holds).toEqual([expect.objectContaining({
      schemaVersion: 'motion.hold.v1', cueId: 'cue_pair', sourceTimeMs: 2870, durationMs: 600,
    })]);
    expect(state.document.holds![0]!.id).toMatch(/^hold_[a-f0-9]{16}$/);
    expect({
      rules: state.document.rules.map((rule) => rule.id), tracks: state.document.tracks.map((track) => track.id),
      keyframes: state.document.rules.flatMap((rule) => rule.tracks.flatMap((track) =>
        track.keyframes.map((keyframe) => keyframe.id))),
    }).toEqual(beforeIds);
    const heldBytes = canonicalContentBytes(state.document);
    const heldCompile = compileMotionDocument(state.document);
    expect(heldCompile.css).toContain('motion_hold_');
    expect(heldCompile.css).toContain('cubic-bezier(');
    expect(heldCompile.css).toContain('steps(1, end)');
    expect(heldCompile.css).not.toContain('setTimeout');
    const collision = dispatchAuthoringOperation(state, { ...insert, operationId: 'hold:collision',
      expectedRevision: state.document.revision });
    expect(collision).toMatchObject({ ok: false, diagnostic: { code: 'AUTHORING_HOLD_COLLISION' } });
    const undone = dispatchAuthoringOperation(state, { ...strictEnvelope(state, 'hold:undo'),
      kind: 'motion.history.undo' });
    expect(undone.ok).toBe(true); if (!undone.ok) throw new Error(undone.diagnostic.code);
    expect(canonicalContentBytes(undone.state.document)).toEqual(beforeBytes);
    const redone = dispatchAuthoringOperation(undone.state, { ...strictEnvelope(undone.state, 'hold:redo'),
      kind: 'motion.history.redo' });
    expect(redone.ok).toBe(true); if (!redone.ok) throw new Error(redone.diagnostic.code);
    expect(canonicalContentBytes(redone.state.document)).toEqual(heldBytes);
    const replayCompile = compileMotionDocument(redone.state.document);
    expect({ html: replayCompile.html, css: replayCompile.css, exportDigest: replayCompile.exportDigest })
      .toEqual({ html: heldCompile.html, css: heldCompile.css, exportDigest: heldCompile.exportDigest });
  });

  test('strictly rejects every non-canonical hold shape without mutation', async () => {
    const source = await readFile(new URL('../../../fixtures/public-synthetic/preview.html', import.meta.url), 'utf8');
    const imported = importMotionHtml(source);
    imported.document!.cues = [
      { schemaVersion: 'motion.cue.v1', id: 'cue_pair', label: 'Pair crosses', timeMs: 2870 },
    ];
    const state = createAuthoringState(imported.document!);
    const base = { ...strictEnvelope(state, 'hold:strict'), kind: 'motion.hold.insert',
      payload: { cueId: 'cue_pair', durationMs: 600 } };
    for (const malformed of [
      { ...base, payload: { ...base.payload, durationMs: 601 } },
      { ...base, payload: { ...base.payload, cueId: 'cue_hold' } },
      { ...base, payload: { ...base.payload, extra: true } },
      { ...base, extra: true },
    ]) {
      const before = structuredClone(state);
      expect(dispatchAuthoringOperation(state, malformed)).toMatchObject({ ok: false,
        diagnostic: { code: 'AUTHORING_ENVELOPE_INVALID' } });
      expect(state).toEqual(before);
    }
  });
  test('creates one isolated track, reshapes it, and exactly replays six undo/redos', async () => {
    const source = await readFile(new URL('../../../fixtures/public-synthetic/preview.html', import.meta.url), 'utf8');
    const imported = importMotionHtml(source);
    expect(imported.document).not.toBeNull();
    let state = createAuthoringState(imported.document!);
    const elementId = 'el_2dbee68b1ea318c8' as const;
    expect(state.document.elements.some((element) => element.id === elementId)).toBe(true);
    const snapshots = [canonicalContentBytes(state.document)];
    const dispatch = (operation: AuthoringOperation) => {
      const result = dispatchAuthoringOperation(state, operation);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.diagnostic.code);
      state = result.state;
      snapshots.push(canonicalContentBytes(state.document));
    };
    dispatch({ ...envelope('create', 0), documentId: state.document.documentId,
      kind: 'motion.track.create', elementId, payload: { property: 'opacity', durationMs: 1000,
        delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 } } as AuthoringOperation);
    const track = state.document.tracks.find((candidate) => candidate.elementId === elementId
      && candidate.property === 'opacity')!;
    expect(track).toBeTruthy();
    expect(state.document.rules.find((rule) => rule.id === track.ruleId)).toMatchObject({
      tracks: [{ property: 'opacity', interpolation: 'continuous', keyframes: [
        { offset: 0, value: '0' }, { offset: 1, value: '1' },
      ] }],
    });
    expect(state.document.applications.filter((application) =>
      application.slots.some((slot) => slot.id === track.slotId))).toHaveLength(1);
    expect(state.document.inventory).toMatchObject({
      ruleCount: imported.document!.inventory.ruleCount + 1,
      applicationCount: imported.document!.inventory.applicationCount + 1,
      slotCount: imported.document!.inventory.slotCount + 1,
      trackCount: imported.document!.inventory.trackCount + 1,
      supportedCount: imported.document!.inventory.supportedCount + 4,
      unsupportedCount: 0, missingCount: 0, diagnosticCodes: [],
    });
    dispatch({ ...envelope('add', 1), documentId: state.document.documentId,
      kind: 'motion.keyframe.add', elementId, trackId: track.id,
      payload: { timeMs: 1110, value: 0.5 } } as AuthoringOperation);
    expect(projectedTimes(state.document, track.id)).toEqual([610, 1110, 1610]);
    const midpointId = state.document.tracks.find((candidate) => candidate.id === track.id)!.keyframeIds[1]!;
    dispatch({ ...envelope('duration', 2), documentId: state.document.documentId,
      kind: 'motion.slot-duration.set', elementId, trackId: track.id,
      payload: { durationMs: 1400 } } as AuthoringOperation);
    expect(projectedTimes(state.document, track.id)).toEqual([610, 1310, 2010]);
    dispatch({ ...envelope('delay', 3), documentId: state.document.documentId,
      kind: 'motion.binding-delay.set', elementId, trackId: track.id,
      payload: { delayMs: 700 } } as AuthoringOperation);
    expect(projectedTimes(state.document, track.id)).toEqual([700, 1400, 2100]);
    dispatch({ ...envelope('easing', 4), documentId: state.document.documentId,
      kind: 'motion.slot-easing.set', elementId, trackId: track.id,
      payload: { easing: 'ease-in-out' } } as AuthoringOperation);
    dispatch({ ...envelope('remove', 5), documentId: state.document.documentId,
      kind: 'motion.keyframe.remove', elementId, trackId: track.id, keyframeId: midpointId } as AuthoringOperation);
    expect(state.document.revision).toBe(6);
    expect(state.document.rules.find((rule) => rule.id === track.ruleId)!.tracks[0]!.keyframes).toHaveLength(2);
    expect(state.document.applications.find((app) => app.slots.some((slot) => slot.id === track.slotId))!)
      .toMatchObject({ bindings: [{ elementId, delayOverridesMs: [700] }], slots: [{ durationMs: 1400,
        delayMs: 700, timingFunction: { kind: 'keyword', value: 'ease-in-out' } }] });
    const staleBefore = structuredClone(state);
    expect(dispatchAuthoringOperation(state, { ...envelope('stale-structural', 5), documentId: state.document.documentId,
      kind: 'motion.slot-duration.set', elementId, trackId: track.id, payload: { durationMs: 1200 } }))
      .toMatchObject({ ok: false, diagnostic: { code: 'AUTHORING_STALE_REVISION' } });
    expect(state).toEqual(staleBefore);
    const primary = snapshots.slice(0, 7);
    for (let index = 0; index < 6; index += 1) {
      const result = dispatchAuthoringOperation(state, { ...envelope(`undo-${index}`, 6 + index),
        documentId: state.document.documentId, kind: 'motion.history.undo' });
      expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.diagnostic.code); state = result.state;
      expect(canonicalContentBytes(state.document)).toEqual(primary[5 - index]);
    }
    for (let index = 0; index < 6; index += 1) {
      const result = dispatchAuthoringOperation(state, { ...envelope(`redo-${index}`, 12 + index),
        documentId: state.document.documentId, kind: 'motion.history.redo' });
      expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.diagnostic.code); state = result.state;
      expect(canonicalContentBytes(state.document)).toEqual(primary[index + 1]);
    }
    expect(state.document.revision).toBe(18);
  });

  test('strictly rejects malformed public structural operations without coercion or mutation', async () => {
    const source = await readFile(new URL('../../../fixtures/public-synthetic/preview.html', import.meta.url), 'utf8');
    const imported = importMotionHtml(source);
    let state = createAuthoringState(imported.document!);
    const documentId = state.document.documentId;
    const elementId = 'el_a2849ff826f3e167';
    const create = { schemaVersion: 'motion.operation.v1', operationId: 'strict:create', documentId,
      expectedRevision: 0, kind: 'motion.track.create', elementId,
      payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 } };
    const malformed = [
      { ...create, extra: true },
      { ...create, elementId: 'el_other' },
      { ...create, payload: { ...create.payload, durationMs: '1000' } },
      { ...create, payload: { ...create.payload, arbitrary: true } },
      { ...create, kind: 'motion.internal.track.delete', trackId: 'x', payload: { bundleDigest: 'x' } },
    ];
    for (const operation of malformed) {
      const before = structuredClone(state);
      expect(dispatchAuthoringOperation(state, operation)).toMatchObject({ ok: false,
        diagnostic: { code: 'AUTHORING_ENVELOPE_INVALID' } });
      expect(state).toEqual(before);
    }
    const created = dispatchAuthoringOperation(state, create);
    expect(created.ok).toBe(true); if (!created.ok) throw new Error(created.diagnostic.code);
    state = created.state;
    const track = state.document.tracks.find((candidate) => candidate.elementId === elementId
      && candidate.property === 'opacity')!;
    const invalid = [
      { ...strictEnvelope(state, 'offset'), kind: 'motion.keyframe.add', elementId, trackId: track.id,
        payload: { timeMs: 1110, value: 0.5, offsetPpm: 500000 } },
      { ...strictEnvelope(state, 'missing'), kind: 'motion.keyframe.add', elementId, trackId: track.id,
        payload: { timeMs: 1110 } },
      { ...strictEnvelope(state, 'precision'), kind: 'motion.keyframe.add', elementId, trackId: track.id,
        payload: { timeMs: 1110, value: 0.1234567 } },
      { ...strictEnvelope(state, 'nan'), kind: 'motion.keyframe.add', elementId, trackId: track.id,
        payload: { timeMs: 1110, value: Number.NaN } },
      { ...strictEnvelope(state, 'ease'), kind: 'motion.slot-easing.set', elementId, trackId: track.id,
        payload: { easing: 'ease' } },
      { ...strictEnvelope(state, 'duration-fraction'), kind: 'motion.slot-duration.set', elementId, trackId: track.id,
        payload: { durationMs: 1400.5 } },
      { ...strictEnvelope(state, 'delay-fraction'), kind: 'motion.binding-delay.set', elementId, trackId: track.id,
        payload: { delayMs: 700.5 } },
    ];
    for (const operation of invalid) {
      const before = structuredClone(state);
      const result = dispatchAuthoringOperation(state, operation);
      expect(result.ok).toBe(false);
      expect(state).toEqual(before);
    }
  });

  test('rejects corrupt, shared, colliding, minimum, and out-of-document candidates atomically', async () => {
    const source = await readFile(new URL('../../../fixtures/public-synthetic/preview.html', import.meta.url), 'utf8');
    const imported = importMotionHtml(source);
    const initial = createAuthoringState(imported.document!);
    const elementId = 'el_a2849ff826f3e167';
    const create = { ...strictEnvelope(initial, 'adverse:create'), kind: 'motion.track.create', elementId,
      payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 } };
    const accepted = dispatchAuthoringOperation(initial, create);
    expect(accepted.ok).toBe(true); if (!accepted.ok) throw new Error(accepted.diagnostic.code);
    const state = accepted.state;
    const track = state.document.tracks.find((candidate) => candidate.elementId === elementId
      && candidate.property === 'opacity')!;
    const cases: Array<[AuthoringState, unknown, string]> = [];
    cases.push([state, { ...strictEnvelope(state, 'minimum'), kind: 'motion.keyframe.remove', elementId,
      trackId: track.id, keyframeId: track.keyframeIds[0] }, 'AUTHORING_KEYFRAME_MINIMUM']);
    cases.push([state, { ...strictEnvelope(state, 'duration-over'), kind: 'motion.slot-duration.set', elementId,
      trackId: track.id, payload: { durationMs: state.document.durationMs } }, 'AUTHORING_PROJECTION_INVALID']);
    cases.push([state, { ...strictEnvelope(state, 'delay-over'), kind: 'motion.binding-delay.set', elementId,
      trackId: track.id, payload: { delayMs: state.document.durationMs } }, 'AUTHORING_PROJECTION_INVALID']);
    const shared = structuredClone(state);
    shared.document.tracks.push({ ...structuredClone(track), id: 'adverse-shared-track' });
    cases.push([shared, { ...strictEnvelope(shared, 'shared'), kind: 'motion.slot-duration.set', elementId,
      trackId: track.id, payload: { durationMs: 1400 } }, 'AUTHORING_BUNDLE_SHARED']);
    const broken = structuredClone(state);
    broken.document.applications.find((app) => app.slots.some((slot) => slot.id === track.slotId))!
      .slots[0]!.ruleId = 'missing-rule';
    cases.push([broken, { ...strictEnvelope(broken, 'broken'), kind: 'motion.slot-duration.set', elementId,
      trackId: track.id, payload: { durationMs: 1400 } }, 'AUTHORING_BUNDLE_MISMATCH']);
    for (const [candidate, operation, code] of cases) {
      const before = structuredClone(candidate);
      expect(dispatchAuthoringOperation(candidate, operation)).toMatchObject({ ok: false,
        diagnostic: { code } });
      expect(candidate).toEqual(before);
    }
    const colliding = createAuthoringState(imported.document!);
    const probe = dispatchAuthoringOperation(colliding, create);
    if (!probe.ok) throw new Error(probe.diagnostic.code);
    const derivedRuleId = probe.state.document.rules.find((rule) =>
      !colliding.document.rules.some((prior) => prior.id === rule.id))!.id;
    colliding.document.cues.push({ schemaVersion: 'motion.cue.v1', id: derivedRuleId,
      label: 'Synthetic collision', timeMs: 0 });
    const beforeCollision = structuredClone(colliding);
    expect(dispatchAuthoringOperation(colliding, create)).toMatchObject({ ok: false,
      diagnostic: { code: 'AUTHORING_ID_COLLISION' } });
    expect(colliding).toEqual(beforeCollision);

    const corrupted = structuredClone(state);
    (corrupted.undo.at(-1)!.inverse as unknown as { payload: { bundleDigest: string } })
      .payload.bundleDigest = 'corrupted';
    const beforeReplay = structuredClone(corrupted);
    expect(dispatchAuthoringOperation(corrupted, { ...strictEnvelope(corrupted, 'corrupt-replay'),
      kind: 'motion.history.undo' })).toMatchObject({ ok: false,
      diagnostic: { code: 'AUTHORING_HISTORY_REPLAY_INVALID' } });
    expect(corrupted).toEqual(beforeReplay);
  });

});

function strictEnvelope(state: AuthoringState, operationId: string) {
  return { schemaVersion: 'motion.operation.v1' as const, operationId,
    documentId: state.document.documentId, expectedRevision: state.document.revision };
}

function projectedTimes(document: MotionDocument, trackId: string): number[] {
  const track = document.tracks.find((candidate) => candidate.id === trackId)!;
  const ruleTrack = document.rules.find((rule) => rule.id === track.ruleId)!.tracks
    .find((candidate) => candidate.property === track.property)!;
  const application = document.applications.find((app) => app.slots.some((slot) => slot.id === track.slotId))!;
  const slotIndex = application.slots.findIndex((slot) => slot.id === track.slotId);
  const slot = application.slots[slotIndex]!;
  const delay = application.bindings.find((binding) => binding.elementId === track.elementId)!
    .delayOverridesMs[slotIndex]!;
  return ruleTrack.keyframes.map((keyframe) => delay + keyframe.offset * slot.durationMs);
}

function expectCompilerExport(
  actual: ReturnType<typeof compileMotionDocument>,
  expected: ReturnType<typeof compileMotionDocument>,
): void {
  expect(actual.html).toBe(expected.html);
  expect(actual.css).toBe(expected.css);
  expect(actual.exportDigest).toBe(expected.exportDigest);
  expect(actual.receipt.inventory).toEqual(expected.receipt.inventory);
}
