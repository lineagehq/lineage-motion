import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import { compileMotionDocument, COMPILER_VERSION } from '../../css-compiler/src/index.js';
import {
  importMotionHtml,
  IMPORTER_VERSION,
  materializeOfflineFontResources,
} from '../../css-import/src/index.js';
import { canonicalBytes } from '../../domain/src/index.js';
import { deriveSamplePlan, runControlledVisualProof } from './index.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('private baseline is stable and exactly matches deterministic compiler pixels offline', async () => {
  const manifest = JSON.parse(
    await readFile(`${repositoryRoot}.private-corpus/manifest.json`, 'utf8'),
  ) as { sourcePath: string; resourceLockPath: string };
  const source = await readFile(manifest.sourcePath, 'utf8');
  const lockBytes = await readFile(manifest.resourceLockPath);
  const lock = JSON.parse(lockBytes.toString('utf8')) as {
    assets: Array<{ relativePath: string }>;
    stylesheet: { relativePath: string };
  };
  const lockDirectory = dirname(manifest.resourceLockPath);
  const resources = new Map<string, Uint8Array>();
  for (const relativePath of [
    lock.stylesheet.relativePath,
    ...lock.assets.map((asset) => asset.relativePath),
  ]) {
    resources.set(relativePath, await readFile(resolve(lockDirectory, relativePath)));
  }
  const materialized = materializeOfflineFontResources({ html: source, lockBytes, resources });
  expect(materialized.ok).toBe(true);
  if (!materialized.ok) throw new Error('PRIVATE_VISUAL_MATERIALIZATION_FAILED');
  const imported = importMotionHtml(materialized.html, materialized.provenance);
  expect(imported.document).not.toBeNull();
  if (!imported.document) throw new Error('PRIVATE_VISUAL_IMPORT_FAILED');

  const canonical = canonicalBytes(imported.document);
  const exports = [0, 1, 2].map(() => compileMotionDocument(imported.document!));
  const stableTimesMs = [
    0,
    Math.round(imported.document.durationMs * 0.25),
    Math.round(imported.document.durationMs * 0.5),
    Math.round(imported.document.durationMs * 0.75),
    imported.document.durationMs,
  ];
  const samplePlan = deriveSamplePlan(imported.document, stableTimesMs);
  expect(samplePlan.boundaries).toHaveLength(33);
  expect(samplePlan.endpointHandling).toHaveLength(33);
  const visualDirectory = `${repositoryRoot}.motion/visual-proof`;
  await mkdir(visualDirectory, { recursive: true });
  await writeFile(
    `${visualDirectory}/sample-plan.json`,
    `${JSON.stringify(samplePlan, null, 2)}\n`,
  );
  const proof = await runControlledVisualProof({
    baselineHtml: materialized.html,
    compiledHtml: exports[0]!.html,
    samplePlan,
    outputDirectory: `${visualDirectory}/screenshots`,
    viewport: { width: 1440, height: 900 },
  });

  const encodedAssets = lock.assets.map((asset) =>
    Buffer.from(resources.get(asset.relativePath)!).toString('base64'));
  const baselineEmbeddedAssetCount = encodedAssets.filter((encoded) =>
    materialized.html.includes(encoded)).length;
  const compiledEmbeddedAssetCount = encodedAssets.filter((encoded) =>
    exports[0]!.html.includes(encoded)).length;
  const hash = (value: string | Uint8Array): string =>
    createHash('sha256').update(value).digest('hex');
  const sequenceDigest = (hashes: string[]): string => hash(hashes.join('\n'));
  const playwrightPackage = JSON.parse(
    await readFile(`${repositoryRoot}node_modules/@playwright/test/package.json`, 'utf8'),
  ) as { version: string };
  const browserDescriptors = JSON.parse(
    await readFile(`${repositoryRoot}node_modules/playwright-core/browsers.json`, 'utf8'),
  ) as { browsers: Array<{ name: string; revision: string }> };
  const chromiumRevision = browserDescriptors.browsers.find((browser) =>
    browser.name === 'chromium')?.revision;
  expect(chromiumRevision).toBeTruthy();
  const endpointHandling = {
    beforeOutOfRangeCount: samplePlan.endpointHandling.filter((endpoint) =>
      endpoint.before.status === 'out-of-range').length,
    afterOutOfRangeCount: samplePlan.endpointHandling.filter((endpoint) =>
      endpoint.after.status === 'out-of-range').length,
    sampledSideCount: samplePlan.endpointHandling.reduce((count, endpoint) =>
      count + Number(endpoint.before.status === 'sampled')
        + Number(endpoint.after.status === 'sampled'), 0),
  };
  const exportByteIdentical = exports.every((candidate) =>
    candidate.html === exports[0]!.html
      && candidate.css === exports[0]!.css
      && candidate.exportDigest === exports[0]!.exportDigest
      && JSON.stringify(candidate.receipt) === JSON.stringify(exports[0]!.receipt));
  const receipt = {
    schemaVersion: 'motion.visual-proof-receipt.v1',
    importerVersion: IMPORTER_VERSION,
    compilerVersion: COMPILER_VERSION,
    passed: proof.passed
      && baselineEmbeddedAssetCount === lock.assets.length
      && compiledEmbeddedAssetCount === lock.assets.length
      && exportByteIdentical,
    sourceDigests: {
      original: materialized.provenance.originalSourceDigest,
      materialized: materialized.provenance.materializedSourceDigest,
      canonical: hash(canonical),
      export: exports[0]!.exportDigest,
    },
    browser: {
      engine: 'chromium',
      version: proof.browserVersion,
      playwrightVersion: playwrightPackage.version,
      revision: chromiumRevision!,
      viewport: { width: 1440, height: 900 },
    },
    fonts: {
      resourceLockDigest: materialized.provenance.resourceLockDigest,
      aggregateAssetDigest: materialized.provenance.aggregateFontAssetDigest,
      assetCount: materialized.provenance.fontAssetCount,
      baselineEmbeddedAssetCount,
      compiledEmbeddedAssetCount,
      samePinnedBytes: baselineEmbeddedAssetCount === lock.assets.length
        && compiledEmbeddedAssetCount === lock.assets.length,
    },
    sampling: {
      durationMs: imported.document.durationMs,
      stableSampleCount: samplePlan.stableTimesMs.length,
      derivedBoundaryCount: samplePlan.boundaries.length,
      sampleCount: samplePlan.sampleTimesMs.length,
      endpointHandling: {
        ...endpointHandling,
        allBoundarySidesAccountedFor: endpointHandling.sampledSideCount
          + endpointHandling.beforeOutOfRangeCount
          + endpointHandling.afterOutOfRangeCount === samplePlan.boundaries.length * 2,
      },
    },
    readiness: {
      captureCount: proof.readiness.length,
      domReadyCount: proof.readiness.filter((entry) => entry.domReady).length,
      fontsReadyCount: proof.readiness.filter((entry) => entry.fontsReady).length,
      minimumStableLayoutConsecutiveCount: Math.min(
        ...proof.readiness.map((entry) => entry.stableLayoutConsecutiveCount),
      ),
    },
    network: proof.network,
    baselineStability: {
      ...proof.baselineStability,
      replaySequenceDigests: proof.baselineFrameHashes.map(sequenceDigest),
    },
    visualEquivalence: {
      thresholds: {
        changedPixels: 0,
        changedPixelRatio: 0,
        maximumChannelDelta: 0,
      },
      ...proof.pixelComparison,
      compiledSequenceDigest: sequenceDigest(proof.compiledFrameHashes),
    },
    exportDeterminism: {
      runCount: exports.length,
      htmlDigests: exports.map((candidate) => hash(candidate.html)),
      cssDigests: exports.map((candidate) => hash(candidate.css)),
      exportDigests: exports.map((candidate) => candidate.exportDigest),
      compilerReceiptDigests: exports.map((candidate) => hash(JSON.stringify(candidate.receipt))),
      byteIdentical: exportByteIdentical,
    },
  };
  await mkdir(`${repositoryRoot}docs/evidence`, { recursive: true });
  await writeFile(
    `${repositoryRoot}docs/evidence/t005-visual-proof.json`,
    `${JSON.stringify(receipt, null, 2)}\n`,
  );
  await writeFile(
    `${visualDirectory}/proof-detail.json`,
    `${JSON.stringify({
      samplePlan,
      baselineFrameHashes: proof.baselineFrameHashes,
      compiledFrameHashes: proof.compiledFrameHashes,
    }, null, 2)}\n`,
  );

  expect(receipt.passed).toBe(true);
  expect(receipt.network).toEqual({ liveRequestCount: 0, abortedUnexpectedRequestCount: 0 });
  expect(receipt.baselineStability.correspondingHashesEqual).toBe(true);
  expect(new Set(receipt.baselineStability.replaySequenceDigests)).toHaveLength(1);
  expect(receipt.visualEquivalence).toMatchObject({
    changedPixels: 0,
    changedPixelRatio: 0,
    maximumChannelDelta: 0,
  });
  expect(receipt.exportDeterminism.byteIdentical).toBe(true);
  expect(receipt.sampling.endpointHandling.allBoundarySidesAccountedFor).toBe(true);
}, 120_000);
