import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';
import { compileMotionDocument } from '../../css-compiler/src/index.js';
import { importMotionHtml } from '../../css-import/src/index.js';
import { projectShotWorkspace } from '../../domain/src/index.js';
import { deriveSamplePlan, runControlledVisualProof } from './index.js';

const fixtureUrl = new URL('../../../fixtures/public-synthetic/trajectory-representability.html', import.meta.url);

describe('controlled Chromium trajectory representability proof', () => {
  test('matches projected near-integer and unitless-zero source pixels', async () => {
    const source = await readFile(fixtureUrl, 'utf8');
    const imported = importMotionHtml(source); expect(imported.diagnostics).toEqual([]);
    expect(imported.document).not.toBeNull(); const document = imported.document!;
    const targetElementIds = document.elements.map((element) => element.id).sort();
    expect(projectShotWorkspace(document,
      { startMs: 0, landedMs: 700, settledMs: 2100, targetElementIds }).eligible).toBe(true);
    const proof = await runControlledVisualProof({ baselineHtml: source,
      compiledHtml: compileMotionDocument(document).html,
      samplePlan: deriveSamplePlan(document, [0, 700, 2100]),
      outputDirectory: 'test-results/trajectory-representability',
      viewport: { width: 320, height: 180 } });
    expect(proof.passed).toBe(true);
    expect(proof.baselineStability).toEqual({
      replayCount: 3, sampleCount: 7, correspondingHashesEqual: true,
    });
    const firstFrameHashes = proof.baselineFrameHashes.map((replay) => replay[0]);
    expect(new Set(firstFrameHashes).size).toBe(1);
    expect(proof.compiledFrameHashes[0]).toBe(firstFrameHashes[0]);
    expect(proof.network).toEqual({ liveRequestCount: 0, abortedUnexpectedRequestCount: 0 });
    expect(proof.pixelComparison).toEqual({
      comparisonCount: 7, changedPixels: 0, changedPixelRatio: 0, maximumChannelDelta: 0,
    });
  }, 60_000);
});
