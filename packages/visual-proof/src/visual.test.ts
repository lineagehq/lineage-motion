import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

import { compileMotionDocument } from '../../css-compiler/src/index.js';
import { importMotionHtml } from '../../css-import/src/index.js';
import { deriveSamplePlan, runControlledVisualProof } from './index.js';

const fixturePath = fileURLToPath(
  new URL('../../../fixtures/public-synthetic/foundation.html', import.meta.url),
);

describe('controlled Chromium visual proof', () => {
  test('replays a neutral baseline three times and matches exact compiler pixels', async () => {
    const source = await readFile(fixturePath, 'utf8');
    const imported = importMotionHtml(source);
    expect(imported.document).not.toBeNull();
    const compiled = compileMotionDocument(imported.document!);
    const plan = deriveSamplePlan(imported.document!, [0, 600, imported.document!.durationMs]);

    const proof = await runControlledVisualProof({
      baselineHtml: source,
      compiledHtml: compiled.html,
      samplePlan: plan,
      outputDirectory: 'test-results/visual-proof-public',
      viewport: { width: 900, height: 700 },
    });

    expect(proof.passed).toBe(true);
    expect(proof.baselineStability).toEqual({
      replayCount: 3,
      sampleCount: plan.sampleTimesMs.length,
      correspondingHashesEqual: true,
    });
    expect(proof.network).toEqual({ liveRequestCount: 0, abortedUnexpectedRequestCount: 0 });
    expect(proof.pixelComparison).toEqual({
      comparisonCount: plan.sampleTimesMs.length,
      changedPixels: 0,
      changedPixelRatio: 0,
      maximumChannelDelta: 0,
    });
    expect(proof.readiness.every((receipt) => receipt.domReady
      && receipt.fontsReady && receipt.stableLayoutConsecutiveCount >= 3)).toBe(true);
  }, 60_000);
});
