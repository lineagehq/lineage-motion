import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { expect, test } from 'vitest';

import {
  collectSceneCInertnessCertificate,
  runFiveSceneClosure,
  type FiveSceneAlias,
  type FiveSceneInput,
} from './five-scene.js';
import { materializeOfflineFontResources } from './materialize.js';

type PrivateEntry = Readonly<{
  sourceFile?: string;
  resourceLockFile?: string;
  resourceFiles?: Readonly<Record<string, string>>;
  ownerCorrectionFile?: string;
  sceneEProjection?: FiveSceneInput['sceneEProjection'];
  candidateObservations?: FiveSceneInput['candidateObservations'];
}>;
type PrivateManifest = Readonly<{ schemaVersion: 'motion.five-scene-private-input.v1';
  scenes: Readonly<Record<FiveSceneAlias, PrivateEntry>> }>;

test('runs the exact private snapshot three times or records every unavailable alias as a deferral', async () => {
  const manifestPath = process.env.PHASE4_FIVE_SCENE_INPUT_MANIFEST;
  const manifest = manifestPath
    ? JSON.parse(await readFile(manifestPath, 'utf8')) as PrivateManifest : null;
  if (manifest && manifest.schemaVersion !== 'motion.five-scene-private-input.v1') {
    throw new Error('PRIVATE_FIVE_SCENE_MANIFEST_INVALID');
  }
  const scenes = await loadScenes(manifest);
  const runs = [runFiveSceneClosure({ scenes }), runFiveSceneClosure({ scenes }),
    runFiveSceneClosure({ scenes })];
  expect(runs.every(({ scenes: results }) => results.length === 5)).toBe(true);
  expect(new Set(runs.map(({ receipt }) => JSON.stringify(receipt)))).toHaveLength(1);
  expect(runs[0]!.scenes.every(({ outcome, diagnosticCodes }) =>
    outcome !== 'deferred' || diagnosticCodes.length > 0)).toBe(true);
  const sceneEInput = scenes['scene-e'];
  if (sceneEInput.source && sceneEInput.sceneEProjection
    && sceneEInput.sceneEProjection.originalSourceDigest === sha(sceneEInput.source)) {
    const sceneE = runs[0]!.scenes[4]!;
    expect(sceneE.untouchedLedger).toMatchObject({
      originalSourceDigest: sha(sceneEInput.source),
      diagnosticCode: 'IMPORT_PSEUDO_ELEMENT_MOTION',
      applicationCount: sceneEInput.sceneEProjection.expectedPseudoApplicationCount,
    });
    expect(sceneE.projectionLedger).toMatchObject({
      originalSourceDigest: sha(sceneEInput.source),
      removedDiagnosticCode: 'IMPORT_PSEUDO_ELEMENT_MOTION',
      removedApplicationCount: sceneEInput.sceneEProjection.expectedPseudoApplicationCount,
    });
    expect(sceneE.diagnosticCodes).toContain('IMPORT_PSEUDO_ELEMENT_MOTION');
    expect(sceneE.diagnosticCodes).not.toContain('IMPORT_PROJECTION_INVALID');
  }
  if (!manifest) {
    expect(runs[0]!.scenes.every(({ diagnosticCodes }) =>
      diagnosticCodes.includes('IMPORT_ALIAS_UNAVAILABLE'))).toBe(true);
  }
  const receiptText = `${JSON.stringify(runs[0]!.receipt, null, 2)}\n`;
  expect(receiptText).not.toMatch(/<html|selector|filename|sourceText|\/Users\/|https?:|screenshot|credential|database/i);
  const receiptPath = resolve('.motion/receipts/phase4-five-scene-closure.json');
  await mkdir(dirname(receiptPath), { recursive: true });
  await writeFile(receiptPath, receiptText, { mode: 0o600 });
});

async function loadScenes(manifest: PrivateManifest | null): Promise<Record<FiveSceneAlias, FiveSceneInput>> {
  const aliases: FiveSceneAlias[] = ['scene-a', 'scene-b', 'scene-c', 'scene-d', 'scene-e'];
  const output = Object.fromEntries(aliases.map((alias) => [alias, {}])) as Record<FiveSceneAlias, FiveSceneInput>;
  if (!manifest) return output;
  for (const alias of aliases) {
    const entry = manifest.scenes[alias];
    if (!entry?.sourceFile) continue;
    const source = await readFile(entry.sourceFile, 'utf8');
    let fontMaterialization: FiveSceneInput['fontMaterialization'];
    if (entry.resourceLockFile && entry.resourceFiles) {
      fontMaterialization = { lockBytes: await readFile(entry.resourceLockFile), resources: new Map(
        await Promise.all(Object.entries(entry.resourceFiles).map(async ([key, path]) =>
          [key, await readFile(path)] as const)),
      ) };
    }
    let ownerCorrection: FiveSceneInput['ownerCorrection'];
    if (entry.ownerCorrectionFile) {
      const correctedSource = await readFile(entry.ownerCorrectionFile, 'utf8');
      ownerCorrection = { originalSourceDigest: sha(source), correctedSource,
        correctedSourceDigest: sha(correctedSource) };
    }
    let sceneCCertificate: FiveSceneInput['sceneCCertificate'];
    if (alias === 'scene-c' && fontMaterialization) {
      const materialized = materializeOfflineFontResources({ html: source, ...fontMaterialization });
      if (materialized.ok) sceneCCertificate = await collectSceneCInertnessCertificate(materialized.html) ?? undefined;
    }
    output[alias] = { source, ...(fontMaterialization ? { fontMaterialization } : {}),
      ...(ownerCorrection ? { ownerCorrection } : {}),
      ...(sceneCCertificate ? { sceneCCertificate } : {}),
      ...(entry.sceneEProjection ? { sceneEProjection: entry.sceneEProjection } : {}),
      ...(entry.candidateObservations ? { candidateObservations: entry.candidateObservations } : {}) };
  }
  return output;
}

function sha(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
