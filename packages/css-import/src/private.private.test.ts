import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';

import { compileMotionDocument, COMPILER_VERSION } from '../../css-compiler/src/index.js';
import { canonicalBytes } from '../../domain/src/index.js';
import {
  importMotionHtml,
  IMPORTER_VERSION,
  materializeOfflineFontResources,
} from './index.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));

test('private first scene imports completely and compiles deterministically with sanitized evidence', async () => {
  const manifest = JSON.parse(
    await readFile(`${repositoryRoot}.private-corpus/manifest.json`, 'utf8'),
  ) as { sourcePath: string; resourceLockPath: string };
  const source = await readFile(manifest.sourcePath, 'utf8');
  const lockBytes = await readFile(manifest.resourceLockPath);
  const lock = JSON.parse(lockBytes.toString('utf8')) as {
    stylesheet: { relativePath: string };
    assets: Array<{ relativePath: string }>;
  };
  const lockDirectory = dirname(manifest.resourceLockPath);
  const resourcePaths = [
    lock.stylesheet.relativePath,
    ...lock.assets.map((asset) => asset.relativePath),
  ];
  const resources = new Map<string, Uint8Array>();
  for (const relativePath of resourcePaths) {
    resources.set(relativePath, await readFile(resolve(lockDirectory, relativePath)));
  }
  const materialized = materializeOfflineFontResources({
    html: source,
    lockBytes,
    resources,
  });
  const receiptDirectory = `${repositoryRoot}.motion/receipts`;
  await mkdir(receiptDirectory, { recursive: true });

  if (!materialized.ok) {
    await writeFile(`${receiptDirectory}/t002-private.json`, `${JSON.stringify({
      schemaVersion: 'motion.private-import-receipt.v1',
      importerVersion: IMPORTER_VERSION,
      passed: false,
      diagnosticCodes: materialized.diagnostics.map((diagnostic) => diagnostic.code),
    }, null, 2)}\n`);
    expect(materialized.diagnostics).toEqual([]);
    throw new Error('PRIVATE_MATERIALIZATION_ATOMIC_FAILURE');
  }

  const imported = importMotionHtml(materialized.html, materialized.provenance);

  if (!imported.document) {
    await writeFile(`${receiptDirectory}/t002-private.json`, `${JSON.stringify({
      schemaVersion: 'motion.private-import-receipt.v1',
      importerVersion: IMPORTER_VERSION,
      passed: false,
      materializedSourceDigest: imported.inventory.sourceDigest,
      inventory: imported.inventory,
      diagnosticCodes: imported.diagnostics.map((diagnostic) => diagnostic.code),
    }, null, 2)}\n`);
    expect(imported.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([]);
    throw new Error('PRIVATE_IMPORT_ATOMIC_FAILURE');
  }

  const canonical = canonicalBytes(imported.document);
  const runs = [0, 1, 2].map(() => compileMotionDocument(imported.document!));
  const hash = (input: string | Uint8Array): string =>
    createHash('sha256').update(input).digest('hex');
  const orderedSlotInventory = imported.document.applications.map((application, applicationOrdinal) => ({
    applicationOrdinal,
    bindings: application.bindings,
    slots: application.slots.map((slot, slotOrdinal) => ({
      slotOrdinal,
      slotId: slot.id,
      ruleId: slot.ruleId,
      durationMs: slot.durationMs,
      delayMs: slot.delayMs,
      iterationCount: slot.iterationCount,
      direction: slot.direction,
      fillMode: slot.fillMode,
      playState: slot.playState,
      timingFunction: slot.timingFunction,
    })),
  }));
  const trackInventory = imported.document.tracks.map((track) => ({
    elementId: track.elementId,
    slotId: track.slotId,
    ruleId: track.ruleId,
    property: track.property,
    interpolation: track.interpolation,
    keyframeCount: track.keyframeIds.length,
  }));
  const receipt = {
    schemaVersion: 'motion.private-import-receipt.v1',
    importerVersion: IMPORTER_VERSION,
    compilerVersion: COMPILER_VERSION,
    passed: true,
    originalSourceDigest: materialized.provenance.originalSourceDigest,
    materializedSourceDigest: materialized.provenance.materializedSourceDigest,
    resourceLockDigest: materialized.provenance.resourceLockDigest,
    stylesheetDigest: materialized.provenance.stylesheetDigest,
    aggregateFontAssetDigest: materialized.provenance.aggregateFontAssetDigest,
    fontAssetCount: materialized.provenance.fontAssetCount,
    canonicalDigest: hash(canonical),
    exportDigest: runs[0]!.exportDigest,
    inventory: imported.inventory,
    orderedSlotInventory,
    staggeredDelaysMs: imported.document.applications.flatMap((application) =>
      application.bindings.flatMap((binding) => binding.delayOverridesMs),
    ),
    simultaneousApplicationCount: orderedSlotInventory.filter((application) =>
      application.slots.length === 2,
    ).length,
    stepTimedSlotCount: orderedSlotInventory.flatMap((application) => application.slots)
      .filter((slot) => slot.timingFunction.kind === 'steps').length,
    trackInventory,
    diagnosticCodes: imported.diagnostics.map((diagnostic) => diagnostic.code),
    determinism: {
      runCount: runs.length,
      htmlDigests: runs.map((run) => hash(run.html)),
      cssDigests: runs.map((run) => hash(run.css)),
      exportDigests: runs.map((run) => run.exportDigest),
      compilerReceiptDigests: runs.map((run) => hash(JSON.stringify(run.receipt))),
      byteIdentical: runs.every((run) =>
        run.html === runs[0]!.html
        && run.css === runs[0]!.css
        && run.exportDigest === runs[0]!.exportDigest
        && JSON.stringify(run.receipt) === JSON.stringify(runs[0]!.receipt),
      ),
    },
  };
  await writeFile(`${receiptDirectory}/t002-private.json`, `${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(`${repositoryRoot}.motion/private-canonical.json`, canonical);
  await writeFile(`${repositoryRoot}.motion/private-materialized.html`, materialized.html);

  expect(imported.diagnostics).toEqual([]);
  expect(imported.inventory).toMatchObject({
    ruleCount: 9,
    applicationCount: 8,
    unsupportedCount: 0,
    missingCount: 0,
  });
  expect(receipt.simultaneousApplicationCount).toBe(1);
  expect(receipt.stepTimedSlotCount).toBe(2);
  expect(receipt.staggeredDelaysMs).toEqual([
    0, 100, 200, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  expect(receipt.trackInventory).toHaveLength(imported.inventory.trackCount);
  expect(receipt.determinism.byteIdentical).toBe(true);
  expect(new Set(receipt.determinism.htmlDigests)).toHaveLength(1);
  expect(new Set(receipt.determinism.cssDigests)).toHaveLength(1);
  expect(new Set(receipt.determinism.exportDigests)).toHaveLength(1);
  expect(new Set(receipt.determinism.compilerReceiptDigests)).toHaveLength(1);
  expect(runs[0]!.receipt.provenance).toEqual(imported.document.provenance);
  expect(runs[0]!.html).not.toMatch(/https?:|@import|local\(|url\((?!["']?data:)/i);
  for (const asset of lock.assets) {
    const encoded = Buffer.from(resources.get(asset.relativePath)!).toString('base64');
    expect(materialized.html).toContain(encoded);
    expect(runs[0]!.html).toContain(encoded);
  }
});
