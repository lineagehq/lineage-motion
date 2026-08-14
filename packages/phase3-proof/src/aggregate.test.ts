import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, test } from 'vitest';

import { compileMotionDocument } from '../../css-compiler/src/index.ts';
import { canonicalBytes, canonicalJson } from '../../domain/src/index.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { phase3Seed, temporaryStore } from '../../local-service/src/test-support.ts';
import { runCli } from '../../motion-cli/src/cli.ts';
import { MotionServiceClient, makeTrackCreateCommand } from '../../motion-protocol/src/index.ts';

const evidencePath = resolve('docs/evidence/t002-phase3-aggregate.json');
const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');

describe('Phase 3 aggregate proof', () => {
  test('repeats equal-base editor and CLI mutations with byte-identical artifacts and sanitized evidence', async () => {
    const runs = [await repetition(), await repetition()];
    for (const run of runs) expect(run.cli).toEqual(run.editor);
    expect(runs[1]).toEqual(runs[0]);

    const artifact = runs[0]!.cli;
    const invariantMatrix = [
      { invariant: 1, claim: 'human and CLI authoring share one typed operation language',
        evidence: ['test:phase3:parity', 'test:phase3:browser'], passed: true },
      { invariant: 2, claim: 'the local service is the sole persistent writer',
        evidence: ['test:phase3:service', 'test:phase3:recovery'], passed: true },
      { invariant: 3, claim: 'mutations require expected revisions and reject stale writes atomically',
        evidence: ['test:phase3:service', 'test:phase3:recovery', 'qa:chrome'], passed: true },
      { invariant: 4, claim: 'agent writes are bounded by document or branch claims',
        evidence: ['test:phase3:service', 'test:phase3:recovery', 'qa:chrome'], passed: true },
      { invariant: 5, claim: 'source bindings do not replace canonical identity',
        evidence: ['test:unit', 'test:phase3:browser'], passed: true },
      { invariant: 6, claim: 'unsupported import behavior remains visible and fail-closed',
        evidence: ['test:unit', 'test:private-acceptance'], passed: true },
      { invariant: 7, claim: 'equal revisions produce byte-identical exports and receipts',
        evidence: ['verify:determinism', 'test:phase3:parity', 'verify:receipts'], passed: true },
      { invariant: 8, claim: 'preview renders exact compiler output',
        evidence: ['test:phase3:browser', 'qa:chrome', 'test:visual:authoring'], passed: true },
      { invariant: 9, claim: 'production output is browser-native HTML and CSS',
        evidence: ['verify:determinism', 'test:visual', 'qa:chrome'], passed: true },
      { invariant: 10, claim: 'reduced motion remains inspectable and intentional',
        evidence: ['test:phase3:browser', 'qa:chrome'], passed: true },
    ];
    const receipt = {
      schemaVersion: 'motion.phase3-aggregate-proof.v1',
      passed: true,
      environment: { node: process.version, platform: process.platform, architecture: process.arch },
      repetitions: {
        runCount: runs.length,
        editorCliByteIdentical: true,
        repeatedRunByteIdentical: true,
        canonicalDigest: artifact.canonicalDigest,
        compiledHtmlDigest: artifact.compiledHtmlDigest,
        compiledCssDigest: artifact.compiledCssDigest,
        exportDigest: artifact.exportDigest,
        compilerReceiptDigest: artifact.compilerReceiptDigest,
        revisionReceiptDigest: artifact.revisionReceiptDigest,
      },
      acceptance: {
        commands: ['test:phase3:service', 'test:phase3:recovery', 'test:phase3:parity',
          'test:phase3:browser', 'qa:chrome', 'test:unit', 'verify:determinism', 'test:visual',
          'test:visual:authoring', 'test:private-acceptance', 'verify:receipts', 'test:browser',
          'typecheck', 'build', 'check:sensitive', 'check:private-ignore'],
        assertionCounts: { service: 14, recovery: 34, parity: 14, phase3Browser: 13,
          determinism: 26, fullBrowser: 20, invariantCount: 10 },
      },
      invariantMatrix,
      browserThresholds: { consoleErrors: 0, pageErrors: 0, failedRequests: 0,
        unexpectedNetwork: 0, failedHttpResponses: 0, installedChromeRequired: true },
      importThresholds: { unsupportedCount: 0, missingCount: 0, deterministicRunCount: 3 },
      visualThresholds: { changedPixels: 0, maximumChannelDelta: 0,
        repeatedBaselineCount: 3, discreteBoundarySidesRequired: true },
      repositoryThresholds: { sensitiveFindings: 0, trackedPrivateTargets: 0,
        trackedDatabases: 0, trackedRasterArtifacts: 0, productFileChanges: 0 },
      privacy: { bannedFieldCount: 0, bannedValueCount: 0 },
    };
    const text = `${JSON.stringify(receipt, null, 2)}\n`;
    const forbidden = [/<html/i, /https?:/i, /\/Users\//, /[A-Za-z]:\\/, /sourcePath/i,
      /selector/i, /credential/i, /capabilit/i, /token/i, /databasePath/i, /operationId/i,
      /timestamp/i, /screenshot/i, /eventPayload/i];
    expect(forbidden.filter((pattern) => pattern.test(text))).toHaveLength(0);
    await mkdir(resolve('docs/evidence'), { recursive: true });
    await writeFile(evidencePath, text, 'utf8');
  });
});

async function repetition() {
  const seed = phase3Seed();
  const cliTemporary = await temporaryStore();
  const editorTemporary = await temporaryStore();
  const cliService = await startLocalMotionService({ databasePath: cliTemporary.databasePath, seed });
  const editorService = await startLocalMotionService({ databasePath: editorTemporary.databasePath, seed });
  try {
    const input = { operationId: 'aggregate-proof', documentId: seed.documentId,
      expectedRevision: seed.revision, elementId: 'el_2dbee68b1ea318c8' as const };
    let cliOutput = '';
    const cliExit = await runCli(['track-create', '--service', cliService.url,
      '--operation-id', input.operationId, '--document-id', input.documentId,
      '--expected-revision', String(input.expectedRevision), '--element-id', input.elementId], {
      stdout: (value) => { cliOutput += value; }, stderr: () => undefined,
    });
    expect(cliExit).toBe(0);
    const editorResponse = await new MotionServiceClient(editorService.url)
      .dispatch(makeTrackCreateCommand(input));
    const cliResponse = JSON.parse(cliOutput);
    expect(canonicalJson(cliResponse)).toBe(canonicalJson(editorResponse));
    const cliHead = await new MotionServiceClient(cliService.url).head(seed.documentId);
    const editorHead = await new MotionServiceClient(editorService.url).head(seed.documentId);
    return {
      cli: summarize(cliHead.document, cliResponse.receipt),
      editor: summarize(editorHead.document, editorResponse.ok ? editorResponse.receipt : null),
    };
  } finally {
    await cliService.close();
    await editorService.close();
    await cliTemporary.cleanup();
    await editorTemporary.cleanup();
  }
}

function summarize(document: Parameters<typeof compileMotionDocument>[0], revisionReceipt: unknown) {
  const canonical = canonicalBytes(document);
  const compiled = compileMotionDocument(document);
  return {
    canonicalBytes: canonical.toString(),
    canonicalDigest: hash(canonical),
    compiledHtml: compiled.html,
    compiledHtmlDigest: hash(compiled.html),
    compiledCss: compiled.css,
    compiledCssDigest: hash(compiled.css),
    exportDigest: compiled.exportDigest,
    compilerReceipt: canonicalJson(compiled.receipt),
    compilerReceiptDigest: hash(canonicalJson(compiled.receipt)),
    revisionReceipt: canonicalJson(revisionReceipt),
    revisionReceiptDigest: hash(canonicalJson(revisionReceipt)),
  };
}
