import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('sanitized aggregate receipts prove every exact acceptance threshold', async () => {
  const visualText = await readFile(
    `${repositoryRoot}docs/evidence/t005-visual-proof.json`,
    'utf8',
  ).catch(() => null);
  expect(visualText).not.toBeNull();
  if (visualText === null) return;
  const chromeText = await readFile(`${repositoryRoot}artifacts/t004-chrome-qa.json`, 'utf8');
  const importText = await readFile(`${repositoryRoot}.motion/receipts/t002-private.json`, 'utf8');
  const visual = JSON.parse(visualText);
  const chrome = JSON.parse(chromeText);
  const privateImport = JSON.parse(importText);

  expect(visual).toMatchObject({
    schemaVersion: 'motion.visual-proof-receipt.v1',
    passed: true,
    fonts: { samePinnedBytes: true },
    network: { liveRequestCount: 0, abortedUnexpectedRequestCount: 0 },
    baselineStability: { replayCount: 3, correspondingHashesEqual: true },
    visualEquivalence: {
      thresholds: { changedPixels: 0, changedPixelRatio: 0, maximumChannelDelta: 0 },
      changedPixels: 0,
      changedPixelRatio: 0,
      maximumChannelDelta: 0,
    },
    exportDeterminism: { runCount: 3, byteIdentical: true },
  });
  expect(visual.readiness.minimumStableLayoutConsecutiveCount).toBeGreaterThanOrEqual(3);
  expect(visual.sampling.derivedBoundaryCount).toBe(33);
  expect(visual.sampling.endpointHandling.allBoundarySidesAccountedFor).toBe(true);
  expect(new Set(visual.baselineStability.replaySequenceDigests)).toHaveLength(1);
  expect(chrome).toMatchObject({
    passed: true,
    checks: {
      exactCompilerOutput: true,
      canonicalProjectionEqual: true,
      nativeAnimationsOnly: true,
      playPauseNative: true,
      noConsoleErrors: true,
    },
  });
  expect(privateImport).toMatchObject({
    passed: true,
    inventory: { ruleCount: 9, applicationCount: 8, unsupportedCount: 0, missingCount: 0 },
    determinism: { runCount: 3, byteIdentical: true },
  });
  for (const text of [visualText, chromeText, importText]) {
    expect(text).not.toMatch(/\/Users\/|[A-Za-z]:\\|sourcePath|selectorHint|presigned/i);
  }
});
