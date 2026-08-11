import { describe, expect, test } from 'vitest';

import {
  canonicalContentBytes,
  createAuthoringState,
  dispatchAuthoringOperation,
  type AuthoringOperation,
  type MotionDocument,
} from './index.js';

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
