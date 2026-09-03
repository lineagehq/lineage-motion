import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { runCli } from './cli.ts';
import { compileMotionDocument } from '../../css-compiler/src/index.ts';
import { sha256Hex } from '../../domain/src/index.ts';
import { makeClaimAcquireCommand, makeTrackCreateCommand, MotionServiceClient } from '../../motion-protocol/src/index.ts';
import { ReviewServiceClient } from '../../motion-protocol/src/review.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { phase3Seed, temporaryStore } from '../../local-service/src/test-support.ts';

describe('review CLI', () => {
  test('dispatches the same strict review command and prints only the sanitized response', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    const privateBody = `ephemeral-${crypto.randomUUID()}`; const path = join(temporary.directory, 'review-command.json');
    await writeFile(path, JSON.stringify({ schemaVersion: 'review.operation.v1', kind: 'review.annotation.create',
      operationId: 'cli-review', documentId: seed.documentId, branchId: 'main', expectedBranchRevision: 0,
      annotationId: 'cli-note', expectedAnnotationVersion: 0, anchorRevision: 0, body: privateBody }));
    let output = ''; expect(await runCli(['review-dispatch', '--service', service.url, '--document-id', seed.documentId,
      '--branch-id', 'main', '--command-file', path], { stdout: (value) => { output += value; }, stderr: () => undefined })).toBe(0);
    expect(JSON.parse(output)).toMatchObject({ ok: true, annotation: { annotationId: 'cli-note', version: 1 } });
    expect(output).not.toContain(privateBody);
    let listed = ''; expect(await runCli(['review-annotations', '--service', service.url, '--document-id', seed.documentId,
      '--branch-id', 'main'], { stdout: (value) => { listed += value; }, stderr: () => undefined })).toBe(0);
    expect(listed).not.toContain(privateBody); await service.close(); await temporary.cleanup();
  });
  test('rejects an unallowlisted handoff sentinel without echoing it', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    const path = join(temporary.directory, 'invalid-handoff.json'); await writeFile(path, JSON.stringify({
      operationId: 'invalid-cli-handoff', schemaVersion: 'review.handoff-identity.v1', serializerVersion: 'review.serializer.v1',
      documentId: seed.documentId, branchId: 'main', revision: 0, canonicalDigest: 'a'.repeat(64),
      comparisonRecords: [], proofRecords: [], benchmarkRecords: [], unallowlistedSentinel: 'must-not-escape' }));
    let output = ''; expect(await runCli(['review-handoff', '--service', service.url, '--document-id', seed.documentId,
      '--command-file', path], { stdout: (value) => { output += value; }, stderr: () => undefined })).toBe(2);
    expect(output).not.toContain('must-not-escape'); expect(JSON.parse(output)).toMatchObject({ diagnostic: {
      code: 'PROTOCOL_HANDOFF_REQUEST_INVALID' } }); await service.close(); await temporary.cleanup();
  });
  test('uses a real claimed-agent CLI for annotation, comparison, retry, and restart-stable handoff bytes', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed(); const secret = ['cli', 'claim', 'proof',
      'abcdefghijklmnopqrstuvwxyz'].join('-');
    let service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    const agentMotion = new MotionServiceClient(service.url, fetch, { actor: 'agent', capability: 'cli-agent', claimSecret: secret });
    expect(await agentMotion.dispatch(makeClaimAcquireCommand({ operationId: 'cli-agent-claim', documentId: seed.documentId,
      expectedRevision: 0, scope: 'branch' }))).toMatchObject({ ok: true });
    const humanMotion = new MotionServiceClient(service.url);
    expect(await humanMotion.dispatch(makeTrackCreateCommand({ operationId: 'cli-handoff-base', documentId: seed.documentId,
      expectedRevision: 0, elementId: 'el_2dbee68b1ea318c8' }))).toMatchObject({ ok: true });
    const annotationPath = join(temporary.directory, 'agent-annotation.json'); const annotationCommand = {
      schemaVersion: 'review.operation.v1', kind: 'review.annotation.create', operationId: 'cli-agent-annotation',
      documentId: seed.documentId, branchId: 'main', expectedBranchRevision: 1, annotationId: 'cli-agent-note',
      expectedAnnotationVersion: 0, anchorRevision: 0, body: `ephemeral-${crypto.randomUUID()}` } as const;
    await writeFile(annotationPath, JSON.stringify(annotationCommand));
    const invoke = async (args: string[]) => { let stdout = ''; const code = await runCli(args,
      { stdout: (value) => { stdout += value; }, stderr: () => undefined }); return { code, value: JSON.parse(stdout) }; };
    const common = ['--service', service.url, '--actor', 'agent', '--capability', 'cli-agent', '--claim-secret', secret,
      '--document-id', seed.documentId, '--branch-id', 'main'];
    const cliAnnotation = await invoke(['review-dispatch', ...common, '--command-file', annotationPath]);
    expect(cliAnnotation).toMatchObject({ code: 0, value: { ok: true, annotation: { version: 1 } } });
    const agentReview = new ReviewServiceClient(service.url, fetch,
      { actor: 'agent', capability: 'cli-agent', claimSecret: secret });
    expect(await agentReview.dispatch(annotationCommand)).toEqual(cliAnnotation.value);
    const comparison = await invoke(['review-compare', ...common, '--left-revision', '0', '--right-revision', '1']);
    expect(comparison).toMatchObject({ code: 0, value: { changed: true } });
    expect(await agentReview.compare(seed.documentId, 0, 1)).toEqual(comparison.value);
    const head = await humanMotion.head(seed.documentId); const compiled = compileMotionDocument(head.document);
    const handoffPath = join(temporary.directory, 'agent-handoff.json'); const handoffRequest = (operationId: string) => ({
      operationId, schemaVersion: 'review.handoff-identity.v1' as const, serializerVersion: 'review.serializer.v1' as const,
      documentId: seed.documentId, branchId: 'main', revision: 1, canonicalDigest: head.canonicalDigest,
      comparisonRecords: [{ schemaVersion: 'review.comparison-identity.v1' as const, leftRevision: 0,
        leftCanonicalDigest: comparison.value.left.canonicalDigest, rightRevision: 1,
        rightCanonicalDigest: comparison.value.right.canonicalDigest }], proofRecords: [{ schemaVersion: 'review.proof-identity.v1' as const,
        revision: 1, canonicalDigest: head.canonicalDigest, htmlDigest: sha256Hex(compiled.html), cssDigest: sha256Hex(compiled.css),
        exportDigest: compiled.exportDigest }], benchmarkRecords: [] as [] });
    await writeFile(handoffPath, JSON.stringify(handoffRequest('cli-agent-handoff-one')));
    const first = await invoke(['review-handoff', ...common, '--command-file', handoffPath]); expect(first.code).toBe(0);
    expect(await agentReview.handoff(handoffRequest('cli-agent-handoff-one'))).toEqual(first.value);
    expect(await invoke(['review-handoff', ...common, '--command-file', handoffPath])).toEqual(first);
    await writeFile(handoffPath, JSON.stringify(handoffRequest('cli-agent-handoff-two')));
    expect(await invoke(['review-handoff', ...common, '--command-file', handoffPath])).toEqual(first);
    await service.close(); service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    const restartedCommon = common.map((value) => value === common[1] ? service.url : value);
    await writeFile(handoffPath, JSON.stringify(handoffRequest('cli-agent-handoff-restart')));
    const restarted = await invoke(['review-handoff', ...restartedCommon, '--command-file', handoffPath]);
    expect(restarted).toEqual(first); expect(restarted.value.identity.annotationSnapshotVersion)
      .toBe(first.value.identity.annotationSnapshotVersion); expect(restarted.value.bytes).toBe(first.value.bytes);
    await service.close(); await temporary.cleanup();
  });
});
