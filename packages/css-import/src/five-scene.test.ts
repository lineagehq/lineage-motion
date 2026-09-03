import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';

import { compileMotionDocument } from '../../css-compiler/src/index.js';
import {
  inspectFiveSceneClosure,
  collectSceneCInertnessCertificate,
  runFiveSceneClosure,
  type FiveSceneCandidateObservation,
} from './five-scene.js';

const animationSource = (extra = '') => `<!doctype html><html><head><style>
  .target { animation: appear 1000ms steps(2, end) both; ${extra} }
  @keyframes appear { from { opacity: 0; visibility: hidden; } to { opacity: 1; visibility: visible; } }
</style></head><body><div class="target"></div></body></html>`;

const observations: FiveSceneCandidateObservation[] = [{
  category: 'reveal',
  targetIds: ['el_opaque'],
  startMs: 0,
  endMs: 1000,
  evidenceKinds: ['progressive-reveal', 'discrete-visibility-boundary'],
}];

describe('five-scene closure', () => {
  test('processes every alias in fixed order and makes unavailable prerequisites explicit', () => {
    const result = runFiveSceneClosure({
      scenes: {
        'scene-a': {},
        'scene-b': { source: animationSource() },
        'scene-c': { source: animationSource('transition: opacity 200ms;') },
        'scene-d': { source: animationSource(), candidateObservations: observations },
        'scene-e': { source: animationSource() },
      },
    });

    expect(result.scenes.map(({ alias }) => alias)).toEqual([
      'scene-a', 'scene-b', 'scene-c', 'scene-d', 'scene-e',
    ]);
    expect(result.scenes[0]).toMatchObject({ outcome: 'deferred',
      diagnosticCodes: ['IMPORT_ALIAS_UNAVAILABLE'], candidateStatus: 'unavailable' });
    expect(result.scenes[1]).toMatchObject({ outcome: 'deferred',
      diagnosticCodes: expect.arrayContaining(['IMPORT_RULE_MISSING']), candidateStatus: 'unavailable' });
    expect(result.scenes[2]).toMatchObject({ outcome: 'deferred',
      diagnosticCodes: expect.arrayContaining(['IMPORT_TRANSITION_UNSUPPORTED']), candidateStatus: 'unavailable' });
    expect(result.scenes[3]).toMatchObject({ outcome: 'imported', candidateStatus: 'available', candidateCount: 1 });
    expect(result.scenes[4]).toMatchObject({ outcome: 'imported' });
    expect(result.receipt).toMatchObject({
      schemaVersion: 'motion.five-scene-closure-receipt.v1',
      aliasCount: 5,
      exercisedAliasCount: 5,
      candidateNoncanonical: true,
      zeroNetwork: true,
    });
    expect(JSON.stringify(result.receipt)).not.toMatch(/sourceText|selector|filename|path|url|screenshot/i);
  });

  test('retains untouched and projected Scene E ledgers without hiding pseudo motion', () => {
    const source = `<!doctype html><html><head><style>
      .target { animation: appear 1s both; }
      .target::before { content: ""; animation: pulse 200ms both; }
      @keyframes appear { from { opacity: 0; } to { opacity: 1; } }
      @keyframes pulse { from { transform: scale(1); } to { transform: scale(1.1); } }
    </style></head><body><div class="target"></div></body></html>`;
    const first = runFiveSceneClosure({ scenes: {
      'scene-a': {}, 'scene-b': {}, 'scene-c': {}, 'scene-d': {},
      'scene-e': { source, sceneEProjection: { originalSourceDigest: sha(source),
        applicationOrdinals: [1], expectedPseudoApplicationCount: 1 } },
    } });
    const second = runFiveSceneClosure({ scenes: {
      'scene-a': {}, 'scene-b': {}, 'scene-c': {}, 'scene-d': {},
      'scene-e': { source, sceneEProjection: { originalSourceDigest: sha(source),
        applicationOrdinals: [1], expectedPseudoApplicationCount: 1 } },
    } });
    const scene = first.scenes[4]!;
    expect(scene).toMatchObject({ outcome: 'projected',
      untouchedLedger: { diagnosticCode: 'IMPORT_PSEUDO_ELEMENT_MOTION', applicationCount: 1 },
      projectionLedger: { removedApplicationCount: 1,
        removedDiagnosticCode: 'IMPORT_PSEUDO_ELEMENT_MOTION', retainedApplicationCount: 1 },
    });
    expect(scene.document).not.toBeNull();
    expect(first.receipt).toEqual(second.receipt);
  });

  test('retains valid Scene E ledgers when missing fonts keep projected import ineligible', () => {
    const source = `<!doctype html><html><head><style>
      @import url("https://invalid.example/font.css");
      .target { animation: appear 1s both; }
      .target::before { content: ""; animation: pulse 200ms both; }
      @keyframes appear { from { opacity: 0; } to { opacity: 1; } }
      @keyframes pulse { from { transform: scale(1); } to { transform: scale(1.1); } }
    </style></head><body><div class="target"></div></body></html>`;
    const result = runFiveSceneClosure({ scenes: {
      'scene-a': {}, 'scene-b': {}, 'scene-c': {}, 'scene-d': {},
      'scene-e': { source, sceneEProjection: { originalSourceDigest: sha(source),
        applicationOrdinals: [1], expectedPseudoApplicationCount: 1 } },
    } });
    const scene = result.scenes[4]!;

    expect(scene).toMatchObject({ outcome: 'deferred', document: null,
      diagnosticCodes: ['IMPORT_EXTERNAL_RESOURCE', 'IMPORT_PSEUDO_ELEMENT_MOTION'],
      candidateStatus: 'unavailable',
      untouchedLedger: { diagnosticCode: 'IMPORT_PSEUDO_ELEMENT_MOTION', applicationCount: 1 },
      projectionLedger: { removedApplicationCount: 1,
        removedDiagnosticCode: 'IMPORT_PSEUDO_ELEMENT_MOTION', retainedApplicationCount: 1 },
    });
    expect(scene.diagnosticCodes).not.toContain('IMPORT_PROJECTION_INVALID');
    expect(result.receipt.scenes[4]).toMatchObject({ outcome: 'deferred',
      canonicalDocumentDigest: null, untouchedPseudoApplicationCount: 1,
      projectedPseudoApplicationCount: 1 });
  });

  test('accepts only an exact closed Scene C inertness certificate', () => {
    const source = animationSource('transition: color 200ms;');
    const declarationRemovedSource = source.replace('transition: color 200ms;', '');
    const result = runFiveSceneClosure({ scenes: {
      'scene-a': {}, 'scene-b': {}, 'scene-d': {}, 'scene-e': {},
      'scene-c': { source, sceneCCertificate: {
        schemaVersion: 'motion.scene-c-inert-certificate.v1',
        sourceDigest: sha(source), declarationOrdinal: 0,
        declarationRemovedSourceDigest: sha(declarationRemovedSource),
        staticScriptFree: true, targetPropertySetClosed: true, cascadeResolved: true,
        reachableStateProbeCount: 3, zeroTransitionAnimations: true,
        exactRenderedEquality: true, unexpectedNetworkRequestCount: 0,
      } },
    } });
    expect(result.scenes[2]).toMatchObject({ outcome: 'imported',
      diagnosticCodes: ['IMPORT_TRANSITION_INERT'] });
    expect(result.scenes[2]!.document).not.toBeNull();

    const rejected = runFiveSceneClosure({ scenes: {
      'scene-a': {}, 'scene-b': {}, 'scene-d': {}, 'scene-e': {},
      'scene-c': { source, sceneCCertificate: {
        schemaVersion: 'motion.scene-c-inert-certificate.v1', sourceDigest: sha(source),
        declarationOrdinal: 0, declarationRemovedSourceDigest: sha(declarationRemovedSource),
        staticScriptFree: true, targetPropertySetClosed: true, cascadeResolved: true,
        reachableStateProbeCount: 3, zeroTransitionAnimations: false,
        exactRenderedEquality: true, unexpectedNetworkRequestCount: 0,
      } },
    } });
    expect(rejected.scenes[2]).toMatchObject({ outcome: 'deferred', document: null });
  });

  test('collects Scene C evidence in installed Chrome without retaining visual samples', async () => {
    const source = animationSource('transition: color 200ms;');
    const certificate = await collectSceneCInertnessCertificate(source);
    expect(certificate).toMatchObject({ staticScriptFree: true, targetPropertySetClosed: true,
      cascadeResolved: true, reachableStateProbeCount: 3, zeroTransitionAnimations: true,
      exactRenderedEquality: true, unexpectedNetworkRequestCount: 0 });
    expect(JSON.stringify(certificate)).not.toMatch(/<html|selector|screenshot/i);
    expect(await collectSceneCInertnessCertificate(animationSource('transition: opacity 200ms;')))
      .toBeNull();
  }, 30_000);

  test('candidate add, remove, and reorder cannot change canonical or compiler identity', () => {
    const source = animationSource();
    const run = (candidateObservations: FiveSceneCandidateObservation[]) => runFiveSceneClosure({ scenes: {
      'scene-a': {}, 'scene-b': {}, 'scene-c': {}, 'scene-e': {},
      'scene-d': { source, candidateObservations },
    } }).scenes[3]!;
    const variants = [run([]), run(observations), run([...observations,
      { ...observations[0]!, category: 'select' as const }].reverse())];
    const compiled = variants.map(({ document }) => compileMotionDocument(document!));
    expect(new Set(variants.map(({ document }) => JSON.stringify(document))).size).toBe(1);
    expect(new Set(compiled.map(({ exportDigest }) => exportDigest)).size).toBe(1);
    expect(new Set(compiled.map(({ receipt }) => JSON.stringify(receipt))).size).toBe(1);
    expect(variants.map(({ candidateCount }) => candidateCount).sort()).toEqual([0, 1, 2]);
    expect(inspectFiveSceneClosure({ scenes: variants.map(({ alias, outcome, candidateStatus, candidateCount,
      diagnosticCodes }) => ({ alias, outcome, candidateStatus, candidateCount, diagnosticCodes })) }))
      .toEqual(variants.map(({ alias, outcome, candidateStatus, candidateCount, diagnosticCodes }) =>
        ({ alias, outcome, candidateStatus, candidateCount, diagnosticCodes })));
  });
});

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
