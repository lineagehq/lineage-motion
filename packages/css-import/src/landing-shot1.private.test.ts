import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import valueParser from 'postcss-value-parser';
import { expect, test } from 'vitest';

import { compileMotionDocument, COMPILER_VERSION } from '../../css-compiler/src/index.js';
import { canonicalBytes, type MotionDocument, type TimingFunction } from '../../domain/src/index.js';
import {
  importMotionHtml,
  IMPORTER_VERSION,
  materializeOfflineFontResources,
  type ImportInventory,
} from './index.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const manifestPath = `${repositoryRoot}.private-corpus/landing-shot1-manifest.json`;
const receiptPath = `${repositoryRoot}.motion/receipts/landing-shot1-preflight.json`;
const REQUIRED_WORKSPACE_TIMES = [0, 700, 2100] as const;
const RECEIPT_SCHEMA_VERSION = 'motion.landing-shot1-preflight-receipt.v1';

type InventoryExpectation = Pick<ImportInventory,
  'ruleCount' | 'applicationCount' | 'slotCount' | 'trackCount'
  | 'supportedCount' | 'unsupportedCount' | 'missingCount'>;

type PrivateManifest = {
  schemaVersion: string;
  sourcePath: string;
  expectedSourceDigest: string;
  resourceLockPath?: string;
  expectedInventory: InventoryExpectation;
  workspace: {
    timesMs: number[];
    targetElementIds: string[];
  };
};

type SanitizedReceipt = {
  schemaVersion: typeof RECEIPT_SCHEMA_VERSION;
  importerVersion: typeof IMPORTER_VERSION;
  compilerVersion: typeof COMPILER_VERSION;
  passed: boolean;
  sourceDigest: string | null;
  canonicalDigest: string | null;
  exportDigest: string | null;
  inventoryEqual: boolean;
  inventoryCounts: InventoryExpectation | null;
  propertyCategoryCounts: Record<string, number>;
  timingCategoryCounts: Record<string, number>;
  diagnosticCodes: string[];
  cuePresence: Record<'start' | 'settle' | 'end', boolean>;
  closedTransformCapabilities: Record<'translate' | 'scale' | 'rotate', boolean>;
  tripleExport: { runCount: number; byteIdentical: boolean };
  externalResourcesAbsent: boolean;
};

const emptyReceipt = (): SanitizedReceipt => ({
  schemaVersion: RECEIPT_SCHEMA_VERSION,
  importerVersion: IMPORTER_VERSION,
  compilerVersion: COMPILER_VERSION,
  passed: false,
  sourceDigest: null,
  canonicalDigest: null,
  exportDigest: null,
  inventoryEqual: false,
  inventoryCounts: null,
  propertyCategoryCounts: {},
  timingCategoryCounts: {},
  diagnosticCodes: [],
  cuePresence: { start: false, settle: false, end: false },
  closedTransformCapabilities: { translate: false, scale: false, rotate: false },
  tripleExport: { runCount: 0, byteIdentical: false },
  externalResourcesAbsent: false,
});

test('digest-locked landing Shot 1 complete loop passes the private preflight', async () => {
  const receipt = emptyReceipt();
  await mkdir(dirname(receiptPath), { recursive: true });
  const fail = async (code: string): Promise<never> => {
    receipt.diagnosticCodes = [...new Set([...receipt.diagnosticCodes, code])].sort();
    await writeReceipt(receipt);
    throw new Error(code);
  };

  let manifest: PrivateManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as PrivateManifest;
  } catch {
    await fail('PREFLIGHT_MANIFEST_UNAVAILABLE');
  }
  if (!validManifest(manifest)) await fail('PREFLIGHT_MANIFEST_INVALID');

  let sourceBytes: Uint8Array;
  try {
    sourceBytes = await readFile(manifest.sourcePath);
  } catch {
    await fail('PREFLIGHT_SOURCE_UNAVAILABLE');
  }
  receipt.sourceDigest = digest(sourceBytes);
  if (receipt.sourceDigest !== manifest.expectedSourceDigest) {
    await fail('PREFLIGHT_SOURCE_DIGEST_MISMATCH');
  }

  // The source is decoded only after its owner-approved digest is established.
  const source = new TextDecoder('utf-8', { fatal: true }).decode(sourceBytes);
  let html = source;
  let provenance: Parameters<typeof importMotionHtml>[1];
  if (manifest.resourceLockPath) {
    let lockBytes: Uint8Array;
    let lock: { stylesheet?: { relativePath?: string }; assets?: Array<{ relativePath?: string }> };
    try {
      lockBytes = await readFile(manifest.resourceLockPath);
      lock = JSON.parse(new TextDecoder().decode(lockBytes)) as typeof lock;
    } catch {
      await fail('PREFLIGHT_RESOURCE_LOCK_UNAVAILABLE');
    }
    const relativePaths = [
      lock.stylesheet?.relativePath,
      ...(lock.assets ?? []).map((asset) => asset.relativePath),
    ];
    if (relativePaths.some((path) => !path)) await fail('PREFLIGHT_RESOURCE_LOCK_INVALID');
    const resources = new Map<string, Uint8Array>();
    try {
      for (const relativePath of relativePaths as string[]) {
        resources.set(relativePath, await readFile(resolve(dirname(manifest.resourceLockPath), relativePath)));
      }
    } catch {
      await fail('PREFLIGHT_RESOURCE_BYTES_UNAVAILABLE');
    }
    const materialized = materializeOfflineFontResources({ html, lockBytes, resources });
    if (!materialized.ok) {
      receipt.diagnosticCodes = materialized.diagnostics.map(({ code }) => code).sort();
      await writeReceipt(receipt);
      throw new Error('PREFLIGHT_RESOURCE_MATERIALIZATION_FAILED');
    }
    html = materialized.html;
    provenance = materialized.provenance;
  }

  const imported = importMotionHtml(html, provenance);
  receipt.diagnosticCodes = imported.diagnostics.map(({ code }) => code).sort();
  receipt.inventoryCounts = inventoryCounts(imported.inventory);
  receipt.inventoryEqual = sameInventory(receipt.inventoryCounts, manifest.expectedInventory);
  const hasError = imported.diagnostics.some(({ severity }) => severity === 'error');
  if (hasError) {
    expect(imported.document, 'error diagnostics must fail atomically').toBeNull();
    await writeReceipt(receipt);
    throw new Error('PREFLIGHT_COMPLETE_LOOP_IMPORT_FAILED');
  }
  if (!imported.document) await fail('PREFLIGHT_CANONICAL_DOCUMENT_MISSING');
  if (!receipt.inventoryEqual) await fail('PREFLIGHT_INVENTORY_MISMATCH');

  const document = imported.document;
  receipt.canonicalDigest = digest(canonicalBytes(document));
  receipt.propertyCategoryCounts = countProperties(document);
  receipt.timingCategoryCounts = countTimingFunctions(document);
  receipt.cuePresence = validateWorkspaceTimes(document, manifest.workspace);
  if (Object.values(receipt.cuePresence).some((present) => !present)) {
    await fail('PREFLIGHT_WORKSPACE_BOUNDARY_MISSING');
  }

  const capability = inspectClosedTransformCapabilities(document, manifest.workspace.targetElementIds);
  receipt.closedTransformCapabilities = capability.categories;
  if (!capability.closed) await fail('PREFLIGHT_TRANSFORM_COMPOSITION_UNSUPPORTED');

  const runs = [0, 1, 2].map(() => compileMotionDocument(document));
  const first = runs[0]!;
  receipt.exportDigest = first.exportDigest;
  receipt.tripleExport = {
    runCount: runs.length,
    byteIdentical: runs.every((run) => run.html === first.html
      && run.css === first.css
      && run.exportDigest === first.exportDigest
      && JSON.stringify(run.receipt) === JSON.stringify(first.receipt)),
  };
  if (!receipt.tripleExport.byteIdentical) await fail('PREFLIGHT_TRIPLE_EXPORT_MISMATCH');

  receipt.externalResourcesAbsent = runs.every((run) => noLiveResources(run.html, run.css));
  if (!receipt.externalResourcesAbsent) await fail('PREFLIGHT_LIVE_RESOURCE_SURVIVED');
  receipt.passed = true;
  await writeReceipt(receipt);

  expect(receipt.diagnosticCodes).toEqual([]);
  expect(receipt.passed).toBe(true);
});

function validManifest(value: PrivateManifest): boolean {
  return typeof value === 'object'
    && value !== null
    && typeof value.schemaVersion === 'string'
    && typeof value.sourcePath === 'string'
    && /^[a-f0-9]{64}$/.test(value.expectedSourceDigest)
    && validInventory(value.expectedInventory)
    && Array.isArray(value.workspace?.timesMs)
    && value.workspace.timesMs.length === REQUIRED_WORKSPACE_TIMES.length
    && value.workspace.timesMs.every((time, index) => time === REQUIRED_WORKSPACE_TIMES[index])
    && Array.isArray(value.workspace.targetElementIds)
    && value.workspace.targetElementIds.length > 0
    && value.workspace.targetElementIds.every((id) => typeof id === 'string' && id.length > 0)
    && (value.resourceLockPath === undefined || typeof value.resourceLockPath === 'string');
}

function validInventory(value: InventoryExpectation): boolean {
  return typeof value === 'object' && value !== null
    && Object.values(value).every((count) => Number.isSafeInteger(count) && count >= 0);
}

function inventoryCounts(inventory: ImportInventory): InventoryExpectation {
  return {
    ruleCount: inventory.ruleCount,
    applicationCount: inventory.applicationCount,
    slotCount: inventory.slotCount,
    trackCount: inventory.trackCount,
    supportedCount: inventory.supportedCount,
    unsupportedCount: inventory.unsupportedCount,
    missingCount: inventory.missingCount,
  };
}

function sameInventory(actual: InventoryExpectation, expected: InventoryExpectation): boolean {
  return Object.entries(actual).every(([key, count]) =>
    expected[key as keyof InventoryExpectation] === count);
}

function countProperties(document: MotionDocument): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const track of document.rules.flatMap((rule) => rule.tracks)) {
    counts[track.property] = (counts[track.property] ?? 0) + 1;
  }
  return ordered(counts);
}

function countTimingFunctions(document: MotionDocument): Record<string, number> {
  const counts: Record<string, number> = {};
  const add = (timing: TimingFunction | undefined): void => {
    if (timing) counts[timing.kind] = (counts[timing.kind] ?? 0) + 1;
  };
  for (const application of document.applications) {
    for (const slot of application.slots) add(slot.timingFunction);
  }
  for (const keyframe of document.rules.flatMap((rule) => rule.tracks)
    .flatMap((track) => track.keyframes)) add(keyframe.easing);
  return ordered(counts);
}

function validateWorkspaceTimes(
  document: MotionDocument,
  workspace: PrivateManifest['workspace'],
): SanitizedReceipt['cuePresence'] {
  const matched = workspace.timesMs.map((timeMs) => {
    const cueMatches = document.cues.filter((cue) => cue.timeMs === timeMs);
    const targetHasKeyframe = workspace.targetElementIds.every((elementId) => {
      const tracks = document.tracks.filter((track) => track.elementId === elementId);
      return tracks.some((track) => {
        const application = document.applications.find((candidate) =>
          candidate.slots.some((slot) => slot.id === track.slotId)
          && candidate.bindings.some((binding) => binding.elementId === elementId));
        const slot = application?.slots.find((candidate) => candidate.id === track.slotId);
        const binding = application?.bindings.find((candidate) => candidate.elementId === elementId);
        const ruleTrack = document.rules.find((rule) => rule.id === track.ruleId)
          ?.tracks.find((candidate) => candidate.id === track.id);
        const slotIndex = application?.slots.findIndex((candidate) => candidate.id === track.slotId) ?? -1;
        const delay = binding?.delayOverridesMs[slotIndex];
        return slot !== undefined && delay !== undefined && ruleTrack !== undefined
          && ruleTrack.keyframes.some((keyframe) => delay + (keyframe.offset * slot.durationMs) === timeMs);
      });
    });
    return targetHasKeyframe && (cueMatches.length === 0 || cueMatches.every((cue) => cue.timeMs === timeMs));
  });
  return { start: matched[0] ?? false, settle: matched[1] ?? false, end: matched[2] ?? false };
}

function inspectClosedTransformCapabilities(
  document: MotionDocument,
  targetElementIds: string[],
): { closed: boolean; categories: SanitizedReceipt['closedTransformCapabilities'] } {
  const categories = { translate: false, scale: false, rotate: false };
  let valueCount = 0;
  for (const targetId of targetElementIds) {
    const transformTracks = document.tracks.filter((track) =>
      track.elementId === targetId && track.property === 'transform');
    if (transformTracks.length !== 1) return { closed: false, categories };
    const track = transformTracks[0]!;
    const ruleTrack = document.rules.find((rule) => rule.id === track.ruleId)
      ?.tracks.find((candidate) => candidate.id === track.id);
    if (!ruleTrack) return { closed: false, categories };
    for (const keyframe of ruleTrack.keyframes) {
      valueCount += 1;
      const parsed = valueParser(keyframe.value);
      for (const node of parsed.nodes) {
        if (node.type === 'space' || node.type === 'comment') continue;
        if (node.type !== 'function') return { closed: false, categories };
        const name = node.value.toLowerCase();
        if (['translate', 'translatex', 'translatey', 'translate3d'].includes(name)) {
          categories.translate = true;
        } else if (['scale', 'scalex', 'scaley', 'scale3d'].includes(name)) {
          categories.scale = true;
        } else if (['rotate', 'rotatez'].includes(name)) {
          categories.rotate = true;
        } else {
          return { closed: false, categories };
        }
        if (node.nodes.some((argument) => argument.type === 'function' && argument.value === 'var')) {
          return { closed: false, categories };
        }
      }
    }
  }
  return { closed: valueCount > 0, categories };
}

function noLiveResources(html: string, css: string): boolean {
  const combined = `${html}\n${css}`;
  return !/(?:https?:|@import\b|\blocal\s*\(|<script\b|\b(?:src|href)\s*=\s*["'](?!data:)|url\s*\(\s*(?!["']?data:))/i.test(combined);
}

function ordered(counts: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function digest(input: string | Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}

async function writeReceipt(receipt: SanitizedReceipt): Promise<void> {
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
}
