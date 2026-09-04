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

describe('typed structural authoring operations', () => {
  test('projects the exact target choices and creates deterministic Orb or Cursor bundles with a one-track cap', async () => {
    const source = await readFile(new URL('../../../fixtures/public-synthetic/preview.html', import.meta.url), 'utf8');
    const imported = importMotionHtml(source);
    const initial = createAuthoringState(imported.document!);
    const cursor = 'el_a2849ff826f3e167' as const;
    const orb = 'el_2dbee68b1ea318c8' as const;
    const statusCopy = 'el_1f3f2908e4fd2401';
    expect(projectTrackCreationEligibility(initial.document, cursor, 'opacity'))
      .toMatchObject({ available: true, reason: null });
    expect(projectTrackCreationEligibility(initial.document, orb, 'opacity'))
      .toMatchObject({ available: true, reason: null });
    expect(projectTrackCreationEligibility(initial.document, statusCopy, 'opacity'))
      .toMatchObject({ available: false, reason: 'TRACK_ALREADY_EXISTS' });
    expect(projectTrackCreationEligibility(initial.document, orb, 'transform'))
      .toMatchObject({ available: false, reason: 'TARGET_PROPERTY_UNSUPPORTED' });
    expect(projectTrackCreationEligibility(initial.document, 'missing', 'opacity'))
      .toMatchObject({ available: false, reason: 'ELEMENT_NOT_FOUND' });

    const create = (elementId: typeof cursor | typeof orb, operationId: string) => ({
      ...strictEnvelope(initial, operationId), kind: 'motion.track.create' as const, elementId,
      payload: { property: 'opacity' as const, durationMs: 1000 as const, delayMs: 610 as const,
        easing: 'linear' as const, startValue: 0 as const, endValue: 1 as const },
    });
    const orbFirst = dispatchAuthoringOperation(initial, create(orb, 'choice:orb'));
    const cursorFirst = dispatchAuthoringOperation(initial, create(cursor, 'choice:cursor'));
    expect(orbFirst.ok).toBe(true); expect(cursorFirst.ok).toBe(true);
    if (!orbFirst.ok || !cursorFirst.ok) throw new Error('choice creation failed');
    const orbTrack = orbFirst.state.document.tracks.find((track) => track.elementId === orb
      && track.property === 'opacity')!;
    const cursorTrack = cursorFirst.state.document.tracks.find((track) => track.elementId === cursor
      && track.property === 'opacity')!;
    expect(orbTrack.id).not.toBe(cursorTrack.id);
    expect(projectTrackCreationEligibility(orbFirst.state.document, cursor, 'opacity'))
      .toMatchObject({ available: false, reason: 'TRACK_LIMIT_REACHED' });
    const beforeRejected = structuredClone(orbFirst.state);
    const rejected = dispatchAuthoringOperation(orbFirst.state, {
      ...create(cursor, 'choice:second'), expectedRevision: 1,
    });
    expect(rejected).toMatchObject({ ok: false,
      diagnostic: { code: 'AUTHORING_TRACK_LIMIT_REACHED' } });
    expect(orbFirst.state).toEqual(beforeRejected);
  });

  test('keeps deterministic endpoints as immutable anchors and midpoint history exact', async () => {
    const source = await readFile(new URL('../../../fixtures/public-synthetic/preview.html', import.meta.url), 'utf8');
    const imported = importMotionHtml(source);
    let state = createAuthoringState(imported.document!);
    const elementId = 'el_a2849ff826f3e167';
    const apply = (operation: unknown) => {
      const result = dispatchAuthoringOperation(state, operation);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.diagnostic.code);
      state = result.state;
    };
    apply({ ...strictEnvelope(state, 'anchor:create'), kind: 'motion.track.create', elementId,
      payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 } });
    const track = state.document.tracks.find((candidate) => candidate.elementId === elementId
      && candidate.property === 'opacity')!;
    apply({ ...strictEnvelope(state, 'anchor:add'), kind: 'motion.keyframe.add', elementId,
      trackId: track.id, payload: { timeMs: 1110, value: 0.5 } });
    const s2 = structuredClone(state);
    const ruleTrack = state.document.rules.find((rule) => rule.id === track.ruleId)!.tracks[0]!;
    const [startId, midpointId, endId] = ruleTrack.keyframes.map((keyframe) => keyframe.id);
    expect(dispatchAuthoringOperation(state, { ...strictEnvelope(state, 'anchor:unknown'),
      kind: 'motion.keyframe.remove', elementId, trackId: track.id, keyframeId: 'kf_unknown' }))
      .toMatchObject({ ok: false, diagnostic: { code: 'AUTHORING_KEYFRAME_NOT_FOUND' } });
    for (const [operationId, keyframeId] of [['anchor:start', startId], ['anchor:end', endId]] as const) {
      const before = structuredClone(state);
      const rejected = dispatchAuthoringOperation(state, { ...strictEnvelope(state, operationId),
        kind: 'motion.keyframe.remove', elementId, trackId: track.id, keyframeId });
      expect(rejected).toMatchObject({ ok: false,
        diagnostic: { code: 'AUTHORING_KEYFRAME_ANCHOR_REQUIRED' } });
      expect(rejected.state).toBe(state);
      expect(state).toEqual(before);
    }
    const beforeRemoveCompile = compileMotionDocument(state.document);
    apply({ ...strictEnvelope(state, 'anchor:start'), kind: 'motion.keyframe.remove', elementId,
      trackId: track.id, keyframeId: midpointId });
    const s3 = structuredClone(state);
    const afterRemoveCompile = compileMotionDocument(state.document);
    expect(state.document.rules.find((rule) => rule.id === track.ruleId)!.tracks[0]!.keyframes
      .map((keyframe) => keyframe.id)).toEqual([startId, endId]);
    expect(state.document.inventory).toEqual(s2.document.inventory);
    apply({ ...strictEnvelope(state, 'anchor:undo'), kind: 'motion.history.undo' });
    expect(canonicalContentBytes(state.document)).toEqual(canonicalContentBytes(s2.document));
    expectCompilerExport(compileMotionDocument(state.document), beforeRemoveCompile);
    apply({ ...strictEnvelope(state, 'anchor:redo'), kind: 'motion.history.redo' });
    expect(canonicalContentBytes(state.document)).toEqual(canonicalContentBytes(s3.document));
    expectCompilerExport(compileMotionDocument(state.document), afterRemoveCompile);
  });

  test('preserves redo and rejected operation-ID availability for anchor rejection', async () => {
    const source = await readFile(new URL('../../../fixtures/public-synthetic/preview.html', import.meta.url), 'utf8');
    const imported = importMotionHtml(source);
    let state = createAuthoringState(imported.document!);
    const elementId = 'el_a2849ff826f3e167';
    const accept = (operation: unknown) => {
      const result = dispatchAuthoringOperation(state, operation);
      if (!result.ok) throw new Error(result.diagnostic.code);
      state = result.state;
    };
    accept({ ...strictEnvelope(state, 'redo:create'), kind: 'motion.track.create', elementId,
      payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 } });
    const track = state.document.tracks.find((candidate) => candidate.elementId === elementId
      && candidate.property === 'opacity')!;
    accept({ ...strictEnvelope(state, 'redo:mid'), kind: 'motion.keyframe.add', elementId,
      trackId: track.id, payload: { timeMs: 1110, value: 0.5 } });
    accept({ ...strictEnvelope(state, 'redo:quarter'), kind: 'motion.keyframe.add', elementId,
      trackId: track.id, payload: { timeMs: 860, value: 0.25 } });
    accept({ ...strictEnvelope(state, 'redo:undo'), kind: 'motion.history.undo' });
    const before = structuredClone(state);
    const startId = state.document.rules.find((rule) => rule.id === track.ruleId)!.tracks[0]!.keyframes[0]!.id;
    expect(dispatchAuthoringOperation(state, { ...strictEnvelope(state, 'redo:reusable'),
      kind: 'motion.keyframe.remove', elementId, trackId: track.id, keyframeId: startId }))
      .toMatchObject({ ok: false, diagnostic: { code: 'AUTHORING_KEYFRAME_ANCHOR_REQUIRED' } });
    expect(state).toEqual(before);
    const midpointId = state.document.rules.find((rule) => rule.id === track.ruleId)!.tracks[0]!.keyframes[1]!.id;
    const reused = dispatchAuthoringOperation(state, { ...strictEnvelope(state, 'redo:reusable'),
      kind: 'motion.keyframe.remove', elementId, trackId: track.id, keyframeId: midpointId });
    expect(reused.ok).toBe(true);
  });
  test('executes the required edit, stale reject, undo, and redo sequence', () => {
    let state = createAuthoringState(fixture());
    const snapshots = [canonicalContentBytes(state.document)];
    const operations: AuthoringOperation[] = [
      { ...envelope('value', 0), kind: 'motion.keyframe-value.set', elementId: 'el', trackId: 'track', keyframeId: 'start', payload: { value: 0.25 } },
      { ...envelope('time', 1), kind: 'motion.keyframe-time.set', elementId: 'el', trackId: 'track', keyframeId: 'end', payload: { timeMs: 2180 } },
    ];
    for (const operation of operations) {
      const result = dispatchAuthoringOperation(state, operation);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.diagnostic.code);
      state = result.state;
      snapshots.push(canonicalContentBytes(state.document));
    }
    expect(state.document.revision).toBe(2);
    expect(state.document.rules[0]!.tracks[0]!.keyframes).toEqual([
      { id: 'start', offset: 0, value: '0.25' },
      { id: 'end', offset: 0.8, value: '1' },
    ]);

    const beforeReject = structuredClone(state);
    const stale = dispatchAuthoringOperation(state, {
      ...envelope('stale', 1), kind: 'motion.keyframe-value.set', elementId: 'el',
      trackId: 'track', keyframeId: 'start', payload: { value: 0.5 },
    });
    expect(stale).toEqual({ ok: false, state, diagnostic: expect.objectContaining({ code: 'AUTHORING_STALE_REVISION' }) });
    expect(state).toEqual(beforeReject);

    const expectedContent = [snapshots[1], snapshots[0], snapshots[1], snapshots[2]];
    for (const [index, kind] of [
      'motion.history.undo', 'motion.history.undo', 'motion.history.redo', 'motion.history.redo',
    ].entries()) {
      const result = dispatchAuthoringOperation(state, {
        ...envelope(`history-${index}`, state.document.revision), kind,
      } as AuthoringOperation);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.diagnostic.code);
      state = result.state;
      expect(state.document.revision).toBe(index + 3);
      expect(canonicalContentBytes(state.document)).toEqual(expectedContent[index]);
    }
  });

  test('consumes accepted IDs, preserves rejected IDs, and clears redo only after a new edit', () => {
    let state = createAuthoringState(fixture());
    const edited = dispatchAuthoringOperation(state, {
      ...envelope('same', 0), kind: 'motion.keyframe-value.set', elementId: 'el', trackId: 'track', keyframeId: 'start', payload: { value: 0.25 },
    });
    if (!edited.ok) throw new Error(edited.diagnostic.code);
    state = edited.state;
    expect(dispatchAuthoringOperation(state, { ...envelope('same', 1), kind: 'motion.history.undo' })).toMatchObject({ ok: false, diagnostic: { code: 'AUTHORING_OPERATION_ID_REUSED' } });
    const undone = dispatchAuthoringOperation(state, { ...envelope('undo', 1), kind: 'motion.history.undo' });
    if (!undone.ok) throw new Error(undone.diagnostic.code);
    state = undone.state;
    expect(state.redo).toHaveLength(1);
    expect(dispatchAuthoringOperation(state, { ...envelope('bad', 1), kind: 'motion.history.redo' })).toMatchObject({ ok: false, diagnostic: { code: 'AUTHORING_STALE_REVISION' } });
    expect(state.redo).toHaveLength(1);
    const divergent = dispatchAuthoringOperation(state, {
      ...envelope('diverge', 2), kind: 'motion.keyframe-value.set', elementId: 'el', trackId: 'track', keyframeId: 'start', payload: { value: 0.5 },
    });
    expect(divergent.ok && divergent.state.redo).toHaveLength(0);
  });

  test.each([
    ['AUTHORING_ENVELOPE_INVALID', { schemaVersion: 'wrong' }],
    ['AUTHORING_DOCUMENT_MISMATCH', { ...envelope('x', 0), kind: 'motion.history.undo', documentId: 'other' }],
    ['AUTHORING_ELEMENT_NOT_FOUND', { ...envelope('x', 0), kind: 'motion.keyframe-value.set', elementId: 'missing', trackId: 'track', keyframeId: 'start', payload: { value: 0.2 } }],
    ['AUTHORING_VALUE_INVALID', { ...envelope('x', 0), kind: 'motion.keyframe-value.set', elementId: 'el', trackId: 'track', keyframeId: 'start', payload: { value: 0.1234567 } }],
    ['AUTHORING_TIME_COLLISION', { ...envelope('x', 0), kind: 'motion.keyframe-time.set', elementId: 'el', trackId: 'track', keyframeId: 'end', payload: { timeMs: 820 } }],
    ['AUTHORING_TIME_OUT_OF_RANGE', { ...envelope('x', 0), kind: 'motion.keyframe-time.set', elementId: 'el', trackId: 'track', keyframeId: 'end', payload: { timeMs: 3000 } }],
    ['AUTHORING_TIME_PRECISION_UNREPRESENTABLE', { ...envelope('x', 0), kind: 'motion.keyframe-time.set', elementId: 'el', trackId: 'track', keyframeId: 'end', payload: { timeMs: 2181 } }],
    ['AUTHORING_HISTORY_EMPTY', { ...envelope('x', 0), kind: 'motion.history.undo' }],
  ])('rejects atomically with %s', (code, operation) => {
    const state = createAuthoringState(fixture());
    const before = structuredClone(state);
    const result = dispatchAuthoringOperation(state, operation);
    expect(result).toMatchObject({ ok: false, diagnostic: { code } });
    expect(state).toEqual(before);
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
