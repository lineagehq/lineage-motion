import { describe, expect, test } from 'vitest';
import { compileMotionDocument } from '../../css-compiler/src/index.ts';
import { canonicalBytes } from '../../domain/src/index.ts';
import { MotionServiceClient, makeTrackCreateCommand } from '../../motion-protocol/src/index.ts';
import { runCli } from '../../motion-cli/src/cli.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { phase3Seed, temporaryStore } from '../../local-service/src/test-support.ts';

describe('CLI/editor protocol parity', () => {
  test('produces byte-identical documents, native compiler output, digests, and receipts from identical bases', async () => {
    const seed = phase3Seed(); const cliTemporary = await temporaryStore(); const editorTemporary = await temporaryStore();
    const cliService = await startLocalMotionService({ databasePath: cliTemporary.databasePath, seed });
    const editorService = await startLocalMotionService({ databasePath: editorTemporary.databasePath, seed });
    const shared = { operationId: 'parity-operation', documentId: seed.documentId, expectedRevision: seed.revision,
      elementId: 'el_2dbee68b1ea318c8' as const };
    let cliOutput = '';
    expect(await runCli(['track-create', '--service', cliService.url, '--operation-id', shared.operationId,
      '--document-id', shared.documentId, '--expected-revision', '0', '--element-id', shared.elementId],
    { stdout: (value) => { cliOutput += value; }, stderr: () => undefined })).toBe(0);
    const editorResponse = await new MotionServiceClient(editorService.url).dispatch(makeTrackCreateCommand(shared));
    expect(JSON.parse(cliOutput)).toEqual(editorResponse);
    const cliHead = await new MotionServiceClient(cliService.url).head(seed.documentId);
    const editorHead = await new MotionServiceClient(editorService.url).head(seed.documentId);
    expect(canonicalBytes(cliHead.document)).toEqual(canonicalBytes(editorHead.document));
    expect(compileMotionDocument(cliHead.document)).toEqual(compileMotionDocument(editorHead.document));
    await cliService.close(); await editorService.close(); await cliTemporary.cleanup(); await editorTemporary.cleanup();
  });
});
