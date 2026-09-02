import { describe, expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runCli } from './cli.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { createTrajectorySeed } from '../../local-service/src/seed.ts';
import { phase3Seed, temporaryStore } from '../../local-service/src/test-support.ts';
import { cueTargetSnapshots, deriveCueId, projectCueReplacement,
  type CueAuthoringOperation, type CueSemantic } from '../../domain/src/index.ts';

const capabilities = {
  human: randomBytes(32).toString('base64url'),
  agent: randomBytes(32).toString('base64url'),
};

describe('branch and claim CLI', () => {
  test('returns exact sanitized protocol diagnostics for malformed and schema-invalid command files', async () => {
    const temp = await temporaryStore(); const malformedPath = join(temp.directory, 'malformed-command.json');
    const invalidPath = join(temp.directory, 'invalid-command.json'); const rejectedNeedle = 'rejected-private-command-value';
    await writeFile(malformedPath, `{ "protocolVersion": "${rejectedNeedle}"`, { mode: 0o600 });
    await writeFile(invalidPath, JSON.stringify({ protocolVersion: 'motion.protocol.v1', rejectedNeedle }), { mode: 0o600 });
    const invoke = async (name: 'validate' | 'dispatch', path: string) => { let stdout = ''; let stderr = '';
      const code = await runCli([name, '--service', 'http://unused.invalid', '--capability', 'synthetic',
        '--document-id', 'doc', '--command-file', path], {
        stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; },
      }); return { code, stdout, stderr, json: JSON.parse(stdout) as Record<string, unknown> }; };
    for (const name of ['validate', 'dispatch'] as const) {
      const malformed = await invoke(name, malformedPath); expect(malformed).toMatchObject({ code: 2, stderr: '', json: {
        ok: false, code: 'VALIDATION', diagnostic: { schemaVersion: 'motion.diagnostic.v1',
          code: 'PROTOCOL_COMMAND_INVALID', category: 'protocol', retryable: false, fieldPath: '$' },
      } });
      const invalid = await invoke(name, invalidPath); expect(invalid).toMatchObject({ code: 2, stderr: '', json: {
        ok: false, code: 'VALIDATION', diagnostic: { schemaVersion: 'motion.diagnostic.v1',
          code: 'PROTOCOL_COMMAND_INVALID', category: 'protocol', retryable: false, fieldPath: '$.operationId' },
      } });
      for (const result of [malformed, invalid]) {
        expect(result.stdout).toBe(`${JSON.stringify(result.json)}\n`);
        expect(result.stdout).not.toContain(rejectedNeedle); expect(result.stdout).not.toContain(temp.directory);
        expect(result.stdout).not.toContain('CLI_SERVICE_FAILURE'); expect(result.stdout).not.toContain('STORAGE_FAILURE');
      }
    }
    await temp.cleanup();
  });

  test('provides canonical executable discovery and truthful local diagnostics without service access', async () => {
    const invoke = async (args: string[]) => { let stdout = ''; let stderr = ''; const code = await runCli(args,
      { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } });
      return { code, stdout, stderr, json: JSON.parse(stdout) as Record<string, unknown> }; };
    const help = await invoke(['help']);
    expect(help).toMatchObject({ code: 0, stderr: '', json: { schemaVersion: 'motion.cli-command-list.v1' } });
    expect(help.json.mutations).toEqual(expect.arrayContaining([expect.objectContaining({
      name: 'track-create', kind: 'motion.track.create', construction: 'service-discovery-and-options',
      requiredOptions: expect.arrayContaining(['--element-id', '--expected-revision']),
    }), expect.objectContaining({
      name: 'waypoint-add', kind: 'motion.transform-waypoint.add', construction: 'service-discovery-and-options',
      requiredOptions: expect.arrayContaining(['--element-id (repeatable)', '--time-ms', '--expected-revision']),
    }), expect.objectContaining({
      name: 'waypoint-remove', kind: 'motion.transform-waypoint.remove', construction: 'service-discovery-and-options',
      requiredOptions: expect.arrayContaining(['--element-id (repeatable)', '--time-ms', '--expected-revision']),
    }), expect.objectContaining({
      name: 'cue-create', kind: 'motion.cue.create', construction: 'service-discovery-and-options',
      requiredOptions: expect.arrayContaining(['--creation-key', '--semantic']),
    })]));
    const commandHelp = await invoke(['track-create', '--help']);
    expect(commandHelp.json).toMatchObject({ schemaVersion: 'motion.cli-command.v1', name: 'track-create',
      kind: 'motion.track.create', stableIdsFrom: ['workspace', 'claims'] });
    const unknown = await invoke(['not-a-command']);
    expect(unknown).toMatchObject({ code: 2, stderr: '', json: { ok: false, code: 'VALIDATION', diagnostic: {
      schemaVersion: 'motion.diagnostic.v1', code: 'CLI_OPTIONS_INVALID', category: 'protocol', retryable: false,
    } } });
    const missingSemantic = await invoke(['cue-create', '--service', 'http://invalid.localhost', '--capability', 'synthetic',
      '--document-id', 'doc', '--operation-id', 'cue-op', '--expected-revision', '0']);
    expect(missingSemantic).toMatchObject({ code: 2, stderr: '', json: { ok: false, code: 'VALIDATION', diagnostic: {
      schemaVersion: 'motion.diagnostic.v1', code: 'CLI_OPTION_REQUIRED', category: 'protocol', retryable: false,
    } } });
    for (const result of [help, commandHelp, unknown, missingSemantic])
      expect(result.stdout).toBe(`${JSON.stringify(result.json)}\n`);
  });

  test('discovers, validates, claims, mutates, and observes using only service projections', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temp.databasePath, seed, capabilities });
    const secret = ['service-only', 'agent-workflow', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const invoke = async (args: string[]) => { let stdout = ''; let stderr = ''; const code = await runCli(args,
      { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } });
      return { code, stdout, stderr, json: stdout ? JSON.parse(stdout) as Record<string, unknown> : null }; };
    const common = ['--service', service.url, '--document-id', seed.documentId, '--actor', 'agent',
      '--capability', capabilities.agent];

    const vocabulary = await invoke(['operation-kinds', '--service', service.url]);
    expect(vocabulary.code).toBe(0); expect((vocabulary.json!.operations as string[])).toHaveLength(27);
    const workspace = await invoke(['workspace', ...common]);
    expect(workspace.code).toBe(0); expect(workspace.json).toMatchObject({
      schemaVersion: 'motion.workspace-projection.v1', revision: 0, history: { undoAvailable: false, redoAvailable: false },
    });
    const elementId = String((workspace.json!.elements as Array<{ elementId: string }>).find(({ elementId: candidate }) =>
      candidate === 'el_a2849ff826f3e167' || candidate === 'el_2dbee68b1ea318c8')!.elementId);
    const command = { protocolVersion: 'motion.protocol.v1', operationId: 'agent-discovered-create',
      documentId: seed.documentId, branchId: 'main', expectedRevision: 0, command: {
        schemaVersion: 'motion.operation.v1', kind: 'motion.track.create', operationId: 'agent-discovered-create',
        documentId: seed.documentId, expectedRevision: 0, elementId,
        payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 },
      } };
    const commandPath = join(temp.directory, 'discovered-command.json');
    await writeFile(commandPath, JSON.stringify(command), { mode: 0o600 });
    const validation = await invoke(['validate', ...common, '--command-file', commandPath]);
    expect(validation.code).toBe(4); expect(validation.json).toMatchObject({ schemaVersion: 'motion.command-validation.v1',
      valid: false, response: { diagnostic: { code: 'CLAIM_REQUIRED' } } });
    expect(validation.stdout).not.toContain(commandPath); expect(validation.stdout).not.toContain(secret);

    const acquired = await invoke(['claim-acquire', ...common, '--operation-id', 'agent-discovered-claim',
      '--expected-revision', '0', '--scope', 'document', '--claim-secret', secret]);
    expect(acquired.code).toBe(0); expect(acquired.json).toMatchObject({ ok: true, leaseVersion: 1 });
    const claims = await invoke(['claims', ...common]);
    expect(claims.json).toMatchObject({ schemaVersion: 'motion.active-claim-list.v1',
      claims: [{ claimId: acquired.json!.claimId, holder: { kind: 'agent' } }] });
    const valid = await invoke(['validate', ...common, '--command-file', commandPath, '--claim-secret', secret]);
    expect(valid.json).toEqual({ schemaVersion: 'motion.command-validation.v1', valid: true, response: { ok: true } });
    const mutated = await invoke(['track-create', ...common, '--operation-id', 'agent-discovered-create',
      '--expected-revision', '0', '--element-id', elementId, '--claim-secret', secret]);
    expect(mutated.code).toBe(0); expect(mutated.json).toMatchObject({ ok: true, resultingRevision: 1 });

    const observed = await invoke(['head', ...common]);
    expect(observed.json).toMatchObject({ schemaVersion: 'motion.workspace-projection.v1', revision: 1,
      history: { undoAvailable: true } });
    const branches = await invoke(['branches', ...common]);
    expect(branches.json).toMatchObject({ schemaVersion: 'motion.branch-list.v1', branches: [{ branchId: 'main', headRevision: 1 }] });
    const activity = await invoke(['activity', ...common, '--after', '0', '--limit', '10']);
    expect(activity.json).toMatchObject({ schemaVersion: 'motion.activity-page.v1' });
    expect(activity.json!.events).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: 'motion.track.create', revision: 1, actor: expect.objectContaining({ kind: 'agent' }),
      affectedIds: expect.arrayContaining([elementId]),
    })]));
    const history = await invoke(['history', ...common]);
    expect(history.json).toMatchObject({ revision: 1, history: { undoAvailable: true, redoAvailable: false } });
    const proof = await invoke(['export-proof', ...common]);
    expect(proof.json).toMatchObject({ schemaVersion: 'motion.export-proof.v1', revision: 1,
      exportDigest: expect.stringMatching(/^[a-f0-9]{64}$/) });
    for (const output of [workspace.stdout, validation.stdout, acquired.stdout, claims.stdout, valid.stdout,
      mutated.stdout, observed.stdout, branches.stdout, activity.stdout, history.stdout, proof.stdout]) {
      expect(output).not.toContain(secret); expect(output).not.toContain(commandPath);
      expect(output).toBe(`${JSON.stringify(JSON.parse(output))}\n`);
    }
    await service.close(); await temp.cleanup();
  });

  test('dispatches the same strict cue operation bundle and never echoes its path or source records', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temp.databasePath, seed, capabilities });
    const target = seed.elements[0]!; const semantic: CueSemantic = { kind: 'reveal', targetIds: [target.id],
      startMs: 100, completeMs: 500 }; const cueId = deriveCueId(seed.documentId, 'cli-reveal');
    const replacement = projectCueReplacement(seed, cueId, semantic);
    expect(replacement.ok).toBe(true); if (!replacement.ok) throw new Error(replacement.code);
    const operation: CueAuthoringOperation = { schemaVersion: 'motion.operation.v1', kind: 'motion.cue.create',
      operationId: 'cli-cue-create', documentId: seed.documentId, expectedRevision: 0,
      payload: { cueId, semantic, targetSnapshots: cueTargetSnapshots(seed, semantic),
        replacementTrackIds: replacement.trackIds, replacementInputDigest: replacement.inputDigest } };
    let stdout = ''; let stderr = '';
    const code = await runCli(['cue-create', '--service', service.url, '--operation-id', operation.operationId,
      '--document-id', seed.documentId, '--expected-revision', '0', '--creation-key', 'cli-reveal',
      '--semantic', 'reveal', '--target-id', target.id, '--start-ms', '100', '--complete-ms', '500',
      '--capability', capabilities.human], { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } });
    expect(code).toBe(0); expect(JSON.parse(stdout)).toMatchObject({ ok: true, resultingRevision: 1,
      receipt: { inventory: { trackCount: expect.any(Number) } } });
    expect(stdout).not.toContain('structuralFingerprint');
    await service.close(); await temp.cleanup();
  });
  test('dispatches a strict local trajectory bundle without echoing its bytes or path', async () => {
    const temp = await temporaryStore(); const seed = createTrajectorySeed(); const service = await startLocalMotionService({ databasePath: temp.databasePath, seed, capabilities });
    const ids = seed.elements.map((element) => element.id).sort();
    let stdout = ''; let stderr = '';
    const code = await runCli(['waypoints-translate', '--service', service.url, '--operation-id', 'cli-trajectory',
      '--document-id', seed.documentId, '--expected-revision', '0', ...ids.flatMap((id) => ['--element-id', id]),
      '--moment-ms', '700', '--delta-x-ppm', '1000', '--delta-y-ppm', '0', '--viewport-width', '800',
      '--viewport-height', '450', '--capability', capabilities.human],
    { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } });
    expect(code).toBe(0); expect(JSON.parse(stdout)).toMatchObject({ ok: true, resultingRevision: 1 });
    expect(stdout).not.toContain('expectedTransform');
    stdout = ''; stderr = '';
    expect(await runCli(['undo', '--service', service.url, '--operation-id', 'cli-undo', '--document-id', seed.documentId,
      '--expected-revision', '1', '--capability', capabilities.human], { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } })).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, expectedRevision: 1, resultingRevision: 2 });
    stdout = ''; stderr = '';
    expect(await runCli(['redo', '--service', service.url, '--operation-id', 'cli-redo', '--document-id', seed.documentId,
      '--expected-revision', '2', '--capability', capabilities.human], { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } })).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, expectedRevision: 2, resultingRevision: 3 });
    expect(stdout).not.toContain('expectedTransform');
    stdout = ''; stderr = '';
    expect(await runCli(['waypoint-add', '--service', service.url, '--operation-id', 'cli-waypoint-add',
      '--document-id', seed.documentId, '--expected-revision', '3', ...ids.flatMap((id) => ['--element-id', id]),
      '--time-ms', '350', '--capability', capabilities.human],
    { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } })).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, resultingRevision: 4 });
    expect(stdout).not.toContain('expectedTransform');
    stdout = ''; stderr = '';
    expect(await runCli(['waypoint-remove', '--service', service.url, '--operation-id', 'cli-waypoint-remove',
      '--document-id', seed.documentId, '--expected-revision', '4', ...ids.flatMap((id) => ['--element-id', id]),
      '--time-ms', '350', '--capability', capabilities.human],
    { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } })).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ ok: true, resultingRevision: 5 });
    expect(stdout).not.toContain('expectedTransform');
    await service.close(); await temp.cleanup();
  });
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
    expect(JSON.parse(output)).toEqual({ ok: false, code: 'UNAUTHORIZED_CLAIM', diagnostic: {
      schemaVersion: 'motion.diagnostic.v1', code: 'CLAIM_REQUIRED', category: 'authorization', retryable: false,
    } });
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
