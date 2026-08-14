import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { runCli } from './cli.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { phase3Seed, temporaryStore } from '../../local-service/src/test-support.ts';

const capabilities = {
  human: randomBytes(32).toString('base64url'),
  agent: randomBytes(32).toString('base64url'),
};

describe('branch and claim CLI', () => {
  test('uses shared commands and maps authorization distinctly', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed(); const service = await startLocalMotionService({
      databasePath: temp.databasePath, seed, capabilities });
    let output = ''; const io = { stdout: (value: string) => { output += value; }, stderr: () => undefined };
    expect(await runCli(['branch-create', '--service', service.url, '--operation-id', 'cli-branch', '--document-id', seed.documentId,
      '--expected-revision', '0', '--new-branch-id', 'cli-feature', '--capability', capabilities.human], io)).toBe(0);
    expect(JSON.parse(output)).toMatchObject({ ok: true, receipt: { kind: 'motion.branch.create' } }); output = '';
    expect(await runCli(['track-create', '--service', service.url, '--actor', 'agent', '--operation-id', 'unauthorized',
      '--document-id', seed.documentId, '--expected-revision', '0', '--element-id', 'el_2dbee68b1ea318c8',
      '--capability', capabilities.agent], io)).toBe(4);
    expect(JSON.parse(output)).toEqual({ ok: false, code: 'UNAUTHORIZED_CLAIM' });
    await service.close(); await temp.cleanup();
  });

  test('runs real acquire retry, renew, release, reacquire, and human revoke commands', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed(); const service = await startLocalMotionService({
      databasePath: temp.databasePath, seed, now: () => 1_000, capabilities });
    const secret = ['real', 'cli', 'lifecycle', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const invoke = async (args: string[]) => { let stdout = ''; let stderr = ''; const code = await runCli(args,
      { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } });
      return { code, stdout, stderr, response: stdout ? JSON.parse(stdout) as Record<string, unknown> : null }; };
    const common = ['--service', service.url, '--document-id', seed.documentId, '--branch-id', 'main',
      '--expected-revision', '0', '--capability', capabilities.agent];
    const acquireArgs = ['claim-acquire', ...common, '--operation-id', 'cli-acquire-lifecycle', '--scope', 'document',
      '--claim-secret', secret];
    const acquired = await invoke(acquireArgs); expect(acquired.code).toBe(0); expect(acquired.stderr).toBe('');
    expect(acquired.response).toMatchObject({ ok: true, claimId: expect.stringMatching(/^claim_/), leaseVersion: 1,
      receipt: { kind: 'motion.claim.acquire', claimId: expect.stringMatching(/^claim_/), leaseVersion: 1 } });
    expect((await invoke(acquireArgs)).stdout).toBe(acquired.stdout);
    const claimId = String(acquired.response!.claimId);
    const renewed = await invoke(['claim-renew', ...common, '--operation-id', 'cli-renew-lifecycle', '--claim-id', claimId,
      '--lease-version', '1', '--claim-secret', secret]);
    expect(renewed).toMatchObject({ code: 0, response: { ok: true, claimId, leaseVersion: 2,
      receipt: { kind: 'motion.claim.renew', claimId, leaseVersion: 2 } } });
    const released = await invoke(['claim-release', ...common, '--operation-id', 'cli-release-lifecycle', '--claim-id', claimId,
      '--lease-version', '2', '--claim-secret', secret]);
    expect(released).toMatchObject({ code: 0, response: { ok: true, claimId, leaseVersion: 3,
      receipt: { kind: 'motion.claim.release', claimId, leaseVersion: 3 } } });
    const reacquired = await invoke(['claim-acquire', ...common, '--operation-id', 'cli-reacquire-lifecycle', '--scope', 'document',
      '--claim-secret', secret]);
    expect(reacquired).toMatchObject({ code: 0, response: { ok: true, leaseVersion: 1 } });
    const revoked = await invoke(['claim-revoke', ...common, '--operation-id', 'cli-human-revoke', '--claim-id',
      String(reacquired.response!.claimId), '--lease-version', '1', '--actor', 'human',
      '--capability', capabilities.human]);
    expect(revoked).toMatchObject({ code: 0, response: { ok: true, leaseVersion: 2,
      receipt: { kind: 'motion.claim.revoke', leaseVersion: 2 } } });
    for (const output of [acquired.stdout, renewed.stdout, released.stdout, reacquired.stdout, revoked.stdout])
      expect(output).not.toContain(secret);
    await service.close(); await temp.cleanup();
  });

  test('runs the full document-claim lifecycle on diverged heads with global CAS and branch-coherent metadata', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed(); const service = await startLocalMotionService({
      databasePath: temp.databasePath, seed, now: () => 2_000, capabilities });
    const invoke = async (args: string[]) => { let stdout = ''; const code = await runCli(args,
      { stdout: (value) => { stdout += value; }, stderr: () => undefined });
      return { code, response: JSON.parse(stdout) as Record<string, unknown> }; };
    const human = ['--service', service.url, '--document-id', seed.documentId, '--capability', capabilities.human];
    const agent = ['--service', service.url, '--document-id', seed.documentId, '--capability', capabilities.agent];
    expect((await invoke(['branch-create', ...human, '--operation-id', 'diverged-cli-branch', '--expected-revision', '0',
      '--new-branch-id', 'feature'])).code).toBe(0);
    expect((await invoke(['track-create', ...human, '--operation-id', 'diverged-cli-main', '--expected-revision', '0',
      '--element-id', 'el_a2849ff826f3e167'])).response).toMatchObject({ resultingRevision: 1, branchId: 'main' });
    expect((await invoke(['track-create', ...human, '--operation-id', 'diverged-cli-feature', '--branch-id', 'feature',
      '--expected-revision', '0', '--element-id', 'el_2dbee68b1ea318c8'])).response)
      .toMatchObject({ resultingRevision: 2, branchId: 'feature' });
    const secret = ['diverged-cli', 'claim-proof', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const acquired = await invoke(['claim-acquire', ...agent, '--operation-id', 'diverged-cli-acquire', '--branch-id', 'feature',
      '--expected-revision', '2', '--scope', 'document', '--claim-secret', secret]);
    expect(acquired.response).toMatchObject({ ok: true, resultingRevision: 2, leaseVersion: 1 });
    const claimId = String(acquired.response.claimId);
    const renewed = await invoke(['claim-renew', ...agent, '--operation-id', 'diverged-cli-renew', '--branch-id', 'feature',
      '--expected-revision', '2', '--claim-id', claimId, '--lease-version', '1', '--claim-secret', secret]);
    expect(renewed.response).toMatchObject({ ok: true, resultingRevision: 2, leaseVersion: 2 });
    const released = await invoke(['claim-release', ...agent, '--operation-id', 'diverged-cli-release', '--branch-id', 'feature',
      '--expected-revision', '2', '--claim-id', claimId, '--lease-version', '2', '--claim-secret', secret]);
    expect(released.response).toMatchObject({ ok: true, resultingRevision: 2, leaseVersion: 3 });
    const reacquired = await invoke(['claim-acquire', ...agent, '--operation-id', 'diverged-cli-reacquire', '--branch-id', 'feature',
      '--expected-revision', '2', '--scope', 'document', '--claim-secret', secret]);
    const revoked = await invoke(['claim-revoke', ...human, '--actor', 'human', '--operation-id', 'diverged-cli-revoke',
      '--branch-id', 'main', '--expected-revision', '2', '--claim-id', String(reacquired.response.claimId), '--lease-version', '1']);
    expect(revoked.response).toMatchObject({ ok: true, resultingRevision: 1, leaseVersion: 2,
      receipt: { kind: 'motion.claim.revoke', resultingRevision: 1 } });
    const snapshot = service.store.snapshot() as { events: Array<{ operation_id: string; branch_id: string;
      resulting_revision: number }>; documents: Array<{ last_revision: number }> };
    const revokeEvent = snapshot.events.find((event) => event.operation_id === 'diverged-cli-revoke');
    expect(revokeEvent).toMatchObject({ branch_id: 'main', resulting_revision: 1 });
    expect(snapshot.documents[0]?.last_revision).toBe(2);
    await service.close(); await temp.cleanup();
  });
});
