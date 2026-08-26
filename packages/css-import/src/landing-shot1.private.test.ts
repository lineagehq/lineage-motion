import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from 'vitest';
import { compileMotionDocument } from '../../css-compiler/src/index.js';
import { canonicalBytes, projectShotWorkspace, sha256Hex } from '../../domain/src/index.js';
import { authenticateExpectedAdmissionRoot, inspectAdmissionPackage, sha256, stableJson,
  type AdmissionPackage, type ExpectedAdmissionRoot } from '../../browser-resolved-preprocessor/src/index.js';
import { importMotionHtml } from './index.js';

const root = resolve(import.meta.dirname, '../../..');
const fixedDirectory = resolve(root, '.motion/private/shot1-purpose-built-v1');
const outputDirectory = resolve(root, '.motion/private/landing-shot1-canonical-editing');
const receiptPath = resolve(root, '.motion/receipts/t002-private.json');
const RECEIPT_SCHEMA_VERSION = 'motion.private-import-receipt.v2';

test('owner-approved purpose-built authority imports completely into the exact Shot 1 workspace', async () => {
  await unlink(receiptPath).catch(() => undefined);
  const expectedRoot = JSON.parse(await readFile(resolve(fixedDirectory, 'approved-expected-root.json'), 'utf8')) as ExpectedAdmissionRoot;
  const authenticated = authenticateExpectedAdmissionRoot(expectedRoot, sha256(stableJson(expectedRoot)));
  expect(authenticated).not.toBeNull();
  const admission = JSON.parse(await readFile(resolve(fixedDirectory, 'admission-package.json'), 'utf8')) as AdmissionPackage;
  expect(inspectAdmissionPackage(admission, authenticated!).integrity).toBe('valid');
  expect(admission.expectedRoot.ownerInputLockSha256).toBe(expectedRoot.ownerInputLockSha256);
  expect(admission.receipt).toMatchObject({ admitted: true, stableIdentityProven: true, replayEquivalent: true, resetEquivalent: true, zeroErrors: true, zeroReplayRequests: true });
  expect(admission.receipt.diagnosticCodes).toEqual([]);
  const replay = admission.candidatePackage.replayPackage;
  const source = replay.html.includes('</head>') ? replay.html.replace('</head>', `<style>${replay.css}</style></head>`) : `<style>${replay.css}</style>${replay.html}`;
  const evidence = admission.candidatePackage.detailedEvidence;
  const imported = importMotionHtml(source, undefined, { captureNamespaceSha256: evidence.captureNamespaceSha256,
    admissionPackageSha256: admission.sha256, provenance: evidence.provenance });
  expect(imported.diagnostics).toEqual([]); expect(imported.document).not.toBeNull();
  expect(imported.inventory).toMatchObject({ ruleCount: 2, applicationCount: 2, slotCount: 2,
    trackCount: 3, unsupportedCount: 0, missingCount: 0, diagnosticCodes: [] });
  const document = imported.document!; const targetElementIds = document.elements.map((element) => element.id).sort();
  expect(targetElementIds).toHaveLength(2);
  const workspace = projectShotWorkspace(document, { startMs: 0, landedMs: 700, settledMs: 2100, targetElementIds });
  expect(workspace.eligible).toBe(true);
  expect(workspace.trajectories).toHaveLength(2);
  const runs = [compileMotionDocument(document), compileMotionDocument(document), compileMotionDocument(document)];
  expect(new Set(runs.map((run) => run.exportDigest))).toHaveLength(1);
  expect(new Set(runs.map((run) => `${run.html}\0${run.css}`))).toHaveLength(1);
  expect(new Set(runs.map((run) => stableJson(run.receipt)))).toHaveLength(1);
  const receipt = {
    schemaVersion: RECEIPT_SCHEMA_VERSION,
    authority: 'authenticated-v3',
    passed: true,
    admission: {
      authenticated: true,
      integrityValid: true,
      admitted: admission.receipt.admitted,
      stableIdentityProven: admission.receipt.stableIdentityProven,
      replayEquivalent: admission.receipt.replayEquivalent,
      resetEquivalent: admission.receipt.resetEquivalent,
      zeroErrors: admission.receipt.zeroErrors,
      zeroReplayRequests: admission.receipt.zeroReplayRequests,
      diagnosticCodes: admission.receipt.diagnosticCodes,
    },
    import: {
      documentPresent: true,
      diagnosticCodes: imported.diagnostics.map(({ code }) => code),
      inventory: {
        ruleCount: imported.inventory.ruleCount,
        applicationCount: imported.inventory.applicationCount,
        slotCount: imported.inventory.slotCount,
        trackCount: imported.inventory.trackCount,
        unsupportedCount: imported.inventory.unsupportedCount,
        missingCount: imported.inventory.missingCount,
      },
    },
    workspace: { eligible: workspace.eligible, targetCount: targetElementIds.length,
      trajectoryCount: workspace.trajectories.length },
    determinism: { runCount: runs.length, byteIdentical: true },
    privacy: { aggregateOnly: true, liveValueCount: 0 },
  } as const;
  expect(receipt.admission).toMatchObject({ authenticated: true, integrityValid: true, admitted: true,
    stableIdentityProven: true, replayEquivalent: true, resetEquivalent: true, zeroErrors: true,
    zeroReplayRequests: true, diagnosticCodes: [] });
  expect(receipt.import.diagnosticCodes).toEqual([]);
  await mkdir(resolve(root, '.motion/receipts'), { recursive: true });
  await writeFile(receiptPath, `${stableJson(receipt)}\n`, { mode: 0o600 });
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(resolve(outputDirectory, 'canonical-document.json'), `${stableJson(document)}\n`, { mode: 0o600 });
  await writeFile(resolve(outputDirectory, 'detailed-proof.json'), `${stableJson({ schemaVersion: 'motion.landing-shot1-canonical-editing-detail.v1',
    approvedDigestVerified: true, activeAdmissionIntegrity: true, activeAdmissionSha256: sha256(stableJson(admission)),
    canonicalDigest: sha256Hex(canonicalBytes(document)), exportDigest: runs[0]!.exportDigest,
    targetCount: targetElementIds.length, trajectoryCount: workspace.trajectories.length, tripleExportEqual: true })}\n`, { mode: 0o600 });
});
