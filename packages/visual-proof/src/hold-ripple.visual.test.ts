import { writeFile, readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

import { compileMotionDocument } from '../../css-compiler/src/index.js';
import { importMotionHtml } from '../../css-import/src/index.js';
import {
  canonicalContentBytes, createAuthoringState, dispatchAuthoringOperation, sha256Hex,
} from '../../domain/src/index.js';
import { buildTimeline } from '../../preview-runtime/src/index.js';
import { runHoldRippleVisualProof } from './index.js';

describe('controlled 600 ms hold/ripple raster proof', () => {
  test('proves corresponding t-1/t/t+1 native frames and writes a sanitized receipt', async () => {
    const source = await readFile(
      new URL('../../../fixtures/public-synthetic/preview.html', import.meta.url), 'utf8');
    const imported = importMotionHtml(source);
    imported.document!.cues = [
      { schemaVersion: 'motion.cue.v1', id: 'cue_pair', label: 'Pair crosses', timeMs: 2870 },
      { schemaVersion: 'motion.cue.v1', id: 'cue_hold', label: 'Hold inspected', timeMs: 4310 },
      { schemaVersion: 'motion.cue.v1', id: 'cue_rest', label: 'Rest', timeMs: 4660 },
    ];
    const initial = createAuthoringState(imported.document!);
    const baseline = compileMotionDocument(initial.document);
    const heldResult = dispatchAuthoringOperation(initial, {
      schemaVersion: 'motion.operation.v1', operationId: 'visual:hold',
      documentId: initial.document.documentId, expectedRevision: 0,
      kind: 'motion.hold.insert', payload: { cueId: 'cue_pair', durationMs: 600 },
    });
    expect(heldResult.ok).toBe(true);
    if (!heldResult.ok) throw new Error(heldResult.diagnostic.code);
    const held = compileMotionDocument(heldResult.state.document);
    const samples = [
      { label: 'hold-t-1', sourceTimeMs: 2869, storyTimeMs: 2869 },
      { label: 'hold-t', sourceTimeMs: 2870, storyTimeMs: 2870 },
      { label: 'hold-end-t-1', sourceTimeMs: 2870, storyTimeMs: 3469 },
      { label: 'hold-end-t+1', sourceTimeMs: 2871, storyTimeMs: 3471 },
      { label: 'step-t-1', sourceTimeMs: 3309, storyTimeMs: 3909 },
      { label: 'step-t+1', sourceTimeMs: 3311, storyTimeMs: 3911 },
      { label: 'rest-t-1', sourceTimeMs: 4659, storyTimeMs: 5259 },
    ];
    const proof = await runHoldRippleVisualProof({
      baselineHtml: baseline.html, heldHtml: held.html, samples,
      viewport: { width: 900, height: 560 },
    });
    if (!proof.passed) throw new Error(JSON.stringify(proof, null, 2));
    expect(proof.samples.every((sample) => sample.changedPixels === 0)).toBe(true);
    const timeline = buildTimeline(heldResult.state.document);
    const receipt = {
      schemaVersion: 'motion.hold-ripple-evidence.v1', passed: proof.passed,
      operation: { kind: 'motion.hold.insert', cueId: 'cue_pair', sourceTimeMs: 2870,
        durationMs: 600, holdId: heldResult.state.document.holds![0]!.id },
      digests: {
        source: imported.inventory.sourceDigest,
        canonicalBefore: sha256Hex(canonicalContentBytes(initial.document)),
        canonicalAfter: sha256Hex(canonicalContentBytes(heldResult.state.document)),
        exportBefore: baseline.exportDigest, exportAfter: held.exportDigest,
      },
      inventory: imported.inventory,
      projection: {
        durationBeforeMs: 4660, durationAfterMs: timeline.durationMs,
        cues: timeline.cues.map(({ id, timeMs }) => ({ id, timeMs })),
        stableTrackIds: timeline.rows.map((row) => row.trackId),
      },
      nativeCss: { scriptFree: !/<script|requestAnimationFrame|setTimeout/i.test(held.html),
        compilerVersion: held.receipt.compilerVersion, deterministic: held.receipt.deterministic },
      visual: proof,
      commands: [
        'npm exec -- vitest run packages/visual-proof/src/hold-ripple.visual.test.ts --sequence.concurrent false',
      ],
    };
    await writeFile(new URL('../../../docs/evidence/t002-phase2-hold-ripple.json', import.meta.url),
      `${JSON.stringify(receipt, null, 2)}\n`, 'utf8');
  }, 120_000);
});
