import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { canonicalJson } from '../../domain/src/index.ts';
import { MotionServiceClient, makeBranchCreateCommand, makeClaimAcquireCommand,
  makeTrackCreateCommand } from '../../motion-protocol/src/index.ts';
import { runCli } from '../../motion-cli/src/cli.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { phase3Seed, temporaryStore } from '../../local-service/src/test-support.ts';

const capabilities = {
  human: randomBytes(32).toString('base64url'),
  agent: randomBytes(32).toString('base64url'),
};

describe('branch control editor/CLI parity', () => {
  test('returns byte-identical branch control responses from equal stores', async () => {
    const seed = phase3Seed(); const a = await temporaryStore(); const b = await temporaryStore();
    const cliService = await startLocalMotionService({ databasePath: a.databasePath, seed, capabilities });
    const editorService = await startLocalMotionService({ databasePath: b.databasePath, seed, capabilities });
    let output = ''; expect(await runCli(['branch-create', '--service', cliService.url, '--operation-id', 'parity-branch',
      '--document-id', seed.documentId, '--expected-revision', '0', '--new-branch-id', 'feature',
      '--capability', capabilities.human],
    { stdout: (value) => { output += value; }, stderr: () => undefined })).toBe(0);
    const editorClient = new MotionServiceClient(editorService.url, (...args) => fetch(...args),
      { actor: 'human', capability: capabilities.human });
    const editor = await editorClient.dispatch(makeBranchCreateCommand({ operationId: 'parity-branch',
      documentId: seed.documentId, expectedRevision: 0, branchId: 'feature' }));
    expect(output).toBe(canonicalJson(editor));
    expect(await new MotionServiceClient(cliService.url, (...args) => fetch(...args),
      { actor: 'human', capability: capabilities.human }).head(seed.documentId, 'feature'))
      .toEqual(await editorClient.head(seed.documentId, 'feature'));
    await cliService.close(); await editorService.close(); await a.cleanup(); await b.cleanup();
  });
  test('keeps real CLI and shared-client document claims byte-identical on equal diverged heads', async () => {
    const seed = phase3Seed(); const a = await temporaryStore(); const b = await temporaryStore();
    const cliService = await startLocalMotionService({ databasePath: a.databasePath, seed, now: () => 500, capabilities });
    const editorService = await startLocalMotionService({ databasePath: b.databasePath, seed, now: () => 500, capabilities });
    for (const service of [cliService, editorService]) { const human = new MotionServiceClient(service.url,
      (...args) => fetch(...args), { actor: 'human', capability: capabilities.human });
      await human.dispatch(makeBranchCreateCommand({ operationId: 'parity-diverge-branch', documentId: seed.documentId,
        expectedRevision: 0, branchId: 'feature' }));
      await human.dispatch(makeTrackCreateCommand({ operationId: 'parity-diverge-main', documentId: seed.documentId,
        expectedRevision: 0, elementId: 'el_a2849ff826f3e167' }));
      await human.dispatch(makeTrackCreateCommand({ operationId: 'parity-diverge-feature', documentId: seed.documentId,
        branchId: 'feature', expectedRevision: 0, elementId: 'el_2dbee68b1ea318c8' })); }
    const secret = ['parity', 'document', 'claim', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-'); let output = '';
    expect(await runCli(['claim-acquire', '--service', cliService.url, '--operation-id', 'parity-document-claim',
      '--document-id', seed.documentId, '--branch-id', 'main', '--expected-revision', '2', '--scope', 'document',
      '--claim-secret', secret, '--capability', capabilities.agent],
    { stdout: (value) => { output += value; }, stderr: () => undefined })).toBe(0);
    const shared = await new MotionServiceClient(editorService.url, (...args) => fetch(...args),
      { actor: 'agent', capability: capabilities.agent, claimSecret: secret }).dispatch(makeClaimAcquireCommand({
      operationId: 'parity-document-claim', documentId: seed.documentId, branchId: 'main', expectedRevision: 2, scope: 'document' }));
    expect(output).toBe(canonicalJson(shared)); expect(shared).toMatchObject({ ok: true, expectedRevision: 2, resultingRevision: 1 });
    expect(output).not.toContain(secret);
    await cliService.close(); await editorService.close(); await a.cleanup(); await b.cleanup();
  });
});
