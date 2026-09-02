import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { importMotionHtml } from '../../css-import/src/index.js';
import { compileMotionDocument } from '../../css-compiler/src/index.js';
import { canonicalBytes, canonicalJson, createAuthoringState, dispatchAuthoringOperation, prepareOperationIntent,
  sha256Hex, type MotionDocument, type OperationIntentPayload, type OperationPreparationRequest } from './index.js';

function imported(source: string): MotionDocument {
  const result = importMotionHtml(source); if (!result.document) throw new Error(result.diagnostics[0]?.code); return result.document;
}
const landing = imported(readFileSync(resolve(import.meta.dirname,
  '../../../fixtures/public-synthetic/landing-shot1.html'), 'utf8'));
const landingIds = landing.elements.map((element) => element.id).sort();

function prepare(document: MotionDocument, intent: OperationIntentPayload) {
  const compiled = compileMotionDocument(document); const request: OperationPreparationRequest = {
    schemaVersion: 'motion.operation-preparation-request.v1', documentId: document.documentId, branchId: 'main',
    expectedRevision: document.revision, kind: intent.kind, intent,
  };
  return prepareOperationIntent(document, 'main', sha256Hex(canonicalBytes(document)), compiled.exportDigest, request);
}

describe('stateless operation preparation', () => {
  test('prepares all six directly applicable trajectory intents deterministically without private source authority', () => {
    const intents: OperationIntentPayload[] = [
      { kind: 'motion.transform-pose.set', elementId: landingIds[0]!, momentMs: 700,
        pose: { translateXMicrounits: 1, translateYMicrounits: 2, scalePpm: 1_000_000, rotateMicrodegrees: 0 },
        viewport: { widthCssPixels: 800, heightCssPixels: 450 } },
      { kind: 'motion.transform-waypoints.translate', elementIds: [...landingIds].reverse(), momentMs: 700,
        deltaXPpm: 10_000, deltaYPpm: -10_000, viewport: { widthCssPixels: 800, heightCssPixels: 450 } },
      { kind: 'motion.transform-waypoint.add', elementIds: [...landingIds].reverse(), timeMs: 350 },
      { kind: 'motion.keyframe-group-time.set', elementIds: landingIds, sourceTimeMs: 700,
        targetTimeMs: 710, landingTimeMs: 840, settledTimeMs: 2100 },
      { kind: 'motion.keyframe-group-easing.set', elementIds: landingIds, momentMs: 700,
        expectedEasing: { kind: 'keyword', value: 'linear' }, easing: { kind: 'keyword', value: 'ease-in-out' } },
      { kind: 'motion.settled-hold.set', elementIds: landingIds, sourceTimeMs: 2100,
        settledTimeMs: 1820, landingTimeMs: 840, boundaryTimeMs: 2100 },
    ];
    for (const intent of intents) {
      const runs = [prepare(landing, intent), prepare(landing, intent), prepare(landing, intent)];
      expect(runs[0]!.preparation.eligibility, intent.kind).toBe(true);
      expect(new Set(runs.map((run) => canonicalJson(run.preparation)))).toHaveLength(1);
      const publicBytes = canonicalJson(runs[0]!.preparation);
      for (const forbidden of ['structuralFingerprint', 'expectedTransform', 'targetSnapshots', 'selectorHint',
        'presentation', '<div', 'https://']) expect(publicBytes).not.toContain(forbidden);
    }
    const translated = prepare(landing, intents[1]!).preparation;
    expect(translated.resolvedElementIds).toEqual(landingIds);
    expect(translated.stage).toMatchObject({ widthMicrounits: 800_000_000, heightMicrounits: 450_000_000 });
  });

  test('prepares removal only after a complete shared point exists', () => {
    const add = prepare(landing, { kind: 'motion.transform-waypoint.add', elementIds: landingIds, timeMs: 350 });
    expect(add.preparation.eligibility).toBe(true); expect(add.operation).not.toBeNull();
    const added = dispatchAuthoringOperation(createAuthoringState(landing), add.operation!);
    expect(added.ok).toBe(true); if (!added.ok) return;
    const removeIntent = { kind: 'motion.transform-waypoint.remove' as const, elementIds: [...landingIds].reverse(), timeMs: 350 };
    const runs = [prepare(added.state.document, removeIntent), prepare(added.state.document, removeIntent)];
    expect(runs[0]!.preparation).toMatchObject({ eligibility: true, resolvedElementIds: landingIds });
    expect(canonicalJson(runs[0]!.preparation)).toBe(canonicalJson(runs[1]!.preparation));
  });

  test('prepares the four cue lifecycle intents using only stable public identities', () => {
    const document = imported('<!doctype html><style>.seed{animation:seed 2s linear both}@keyframes seed{from{opacity:0}to{opacity:1}}</style><div class="seed"></div><i></i>');
    document.elements.push({ id: 'el_cue_target', selectorHint: '', structuralFingerprint: 'synthetic/target' });
    document.durationMs = 2000;
    const semantic = { kind: 'reveal' as const, targetIds: ['el_cue_target'], startMs: 100, completeMs: 500 };
    const created = prepare(document, { kind: 'motion.cue.create', creationKey: 'proof-cue', semantic });
    expect(created.preparation).toMatchObject({ eligibility: true, resolvedCueId: expect.stringMatching(/^cue_/),
      resolvedTargetElementIds: ['el_cue_target'] });
    expect(created.operation).not.toBeNull();
    const dispatched = dispatchAuthoringOperation(createAuthoringState(document), created.operation!);
    expect(dispatched.ok).toBe(true); if (!dispatched.ok) return;
    const next = dispatched.state.document; const cueId = created.preparation.resolvedCueId!;
    const updated = prepare(next, { kind: 'motion.cue.update', cueId,
      semantic: { ...semantic, completeMs: 600 } });
    const deleted = prepare(next, { kind: 'motion.cue.delete', cueId });
    const detached = prepare(next, { kind: 'motion.cue.detach', cueId });
    for (const result of [updated, deleted, detached]) {
      expect(result.preparation.eligibility).toBe(true);
      expect(result.preparation.resolvedCueId).toBe(cueId);
      expect(canonicalJson(result.preparation)).not.toMatch(/structuralFingerprint|targetSnapshots|selectorHint|replacement":/);
    }
  });

  test('fails closed for stale identity and invalid viewport without inventing a derivation digest', () => {
    const intent: OperationIntentPayload = { kind: 'motion.transform-pose.set', elementId: landingIds[0]!, momentMs: 700,
      pose: { translateXMicrounits: 0, translateYMicrounits: 0, scalePpm: 1_000_000, rotateMicrodegrees: 0 },
      viewport: { widthCssPixels: 0, heightCssPixels: 450 } };
    expect(prepare(landing, intent).preparation).toMatchObject({ eligibility: false,
      reasonCode: 'TRAJECTORY_STAGE_INVALID', derivationDigest: null });
    const compiled = compileMotionDocument(landing); const stale = prepareOperationIntent(landing, 'main',
      sha256Hex(canonicalBytes(landing)), compiled.exportDigest, { schemaVersion: 'motion.operation-preparation-request.v1',
        documentId: landing.documentId, branchId: 'main', expectedRevision: 1, kind: intent.kind, intent });
    expect(stale.preparation).toMatchObject({ eligibility: false, reasonCode: 'DERIVATION_STALE', derivationDigest: null });
    const hostile = prepare(landing, { ...intent, elementId: '/private/local/path',
      viewport: { widthCssPixels: 800, heightCssPixels: 450 } });
    expect(hostile.preparation).toMatchObject({ eligibility: false, reasonCode: 'DERIVATION_INVALID',
      normalizedIntent: null, derivationDigest: null });
    expect(canonicalJson(hostile.preparation)).not.toContain('/private/local/path');
  });
});
