import { describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { MotionServiceClient, makeBranchCreateCommand, makeClaimAcquireCommand, makeClaimControlCommand,
  makeTrackCreateCommand } from '../../motion-protocol/src/index.ts';
import { startLocalMotionService } from './index.ts';
import { phase3Seed, temporaryStore } from './test-support.ts';
import { corruptMigrationChecksum, corruptStoredHead, createCorruptDatabase, createLegacyV1Database, inspectMigrationFixture,
  poisonLegacyV1Migration, rawDatabaseDigest } from './sqlite-project-store.ts';
import { compileMotionDocument } from '../../css-compiler/src/index.ts';
import type { MotionCommand } from '../../motion-protocol/src/index.ts';
import type { FaultPoint } from './sqlite-project-store.ts';

const recoverySecret = ['matrix', 'proof', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-');
const controlKinds = ['branch-create', 'claim-acquire', 'claim-renew', 'claim-release', 'claim-revoke'] as const;
const faultPoints = ['after-begin', 'after-inserts', 'before-commit', 'after-commit'] as const;

describe('branch/claim bounded recovery', () => {
  test.each(controlKinds.flatMap((kind) => faultPoints.map((point) => [kind, point] as const)))(
    'real-process %s at %s exposes only pre/post state and retries exactly once', async (kind, point) => {
      const temp = await temporaryStore(); const seed = phase3Seed();
      let command: MotionCommand; let actor: 'human' | 'agent' = 'human';
      if (kind === 'branch-create') command = makeBranchCreateCommand({ operationId: `matrix-${kind}-${point}`,
        documentId: seed.documentId, expectedRevision: 0, branchId: `feature-${point}` });
      else if (kind === 'claim-acquire') { actor = 'agent'; command = makeClaimAcquireCommand({
        operationId: `matrix-${kind}-${point}`, documentId: seed.documentId, expectedRevision: 0, scope: 'document' }); }
      else {
        const setup = await startLocalMotionService({ databasePath: temp.databasePath, seed, now: () => 100 });
        const setupClient = matrixClient(setup.url, 'agent');
        const acquired = await setupClient.dispatch(makeClaimAcquireCommand({ operationId: `matrix-setup-${kind}-${point}`,
          documentId: seed.documentId, expectedRevision: 0, scope: 'document' }));
        if (!acquired.ok || !acquired.claimId || !acquired.leaseVersion) throw new Error('MATRIX_SETUP_FAILED');
        await setup.close(); actor = kind === 'claim-revoke' ? 'human' : 'agent';
        command = makeClaimControlCommand({ kind: `motion.claim.${kind.slice(6)}` as 'motion.claim.renew',
          operationId: `matrix-${kind}-${point}`, documentId: seed.documentId, expectedRevision: 0,
          claimId: acquired.claimId, leaseVersion: acquired.leaseVersion });
      }
      const baseline = await startLocalMotionService({ databasePath: temp.databasePath, seed, now: () => 100 });
      const before = baseline.store.snapshot(); await baseline.close();
      const child = await crashService(temp.databasePath, point);
      await expect(matrixClient(child.url, actor).dispatch(command)).rejects.toThrow(); await child.exited;
      const restarted = await restartEventually(temp.databasePath);
      const operationRows = () => ((restarted.store.snapshot() as { events: Array<{ operation_id: string }> }).events
        .filter((event) => event.operation_id === command.operationId));
      if (point === 'after-commit') expect(operationRows()).toHaveLength(1);
      else { expect(restarted.store.snapshot()).toEqual(before); expect(operationRows()).toHaveLength(0); }
      const retry = await matrixClient(restarted.url, actor).dispatch(command); expect(retry).toMatchObject({ ok: true });
      const stable = restarted.store.snapshot(); const exactRetry = await matrixClient(restarted.url, actor).dispatch(command);
      expect(exactRetry).toEqual(retry); expect(restarted.store.snapshot()).toEqual(stable); expect(operationRows()).toHaveLength(1);
      const replay = restarted.store.readEvents(seed.documentId, 0).filter((event) => event.kind === command.command.kind
        && event.commitSeq === (stable as { events: Array<{ commit_seq: number; operation_id: string }> }).events
          .find((event) => event.operation_id === command.operationId)?.commit_seq);
      expect(replay).toHaveLength(1); await restarted.close(); await temp.cleanup();
    }, 20_000,
  );
  test('migrates v1 transactionally while preserving the main head and export digest', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed(); createLegacyV1Database(temp.databasePath, seed);
    const before = compileMotionDocument(seed).exportDigest; const service = await startLocalMotionService({ databasePath: temp.databasePath, seed });
    const head = service.store.readHead(seed.documentId)!; expect(head.document).toEqual(seed);
    expect(compileMotionDocument(head.document).exportDigest).toBe(before);
    expect((service.store as unknown as { database: { prepare(sql: string): { get(): unknown } } }).database
      .prepare('SELECT checksum FROM schema_migrations WHERE version=2').get()).toEqual({ checksum: 'phase3-branches-claims-v2' });
    await service.close(); await temp.cleanup();
  });
  test('rolls a failed v2 migration fully back and refuses corrupt, dangling, and digest-invalid stores', async () => {
    const migration = await temporaryStore(); const seed = phase3Seed(); createLegacyV1Database(migration.databasePath, seed);
    poisonLegacyV1Migration(migration.databasePath);
    await expect(startLocalMotionService({ databasePath: migration.databasePath, seed })).rejects.toThrow();
    expect(inspectMigrationFixture(migration.databasePath)).toEqual({ versions: [1], mainOnlyConstraint: true });
    await migration.cleanup();
    for (const mode of ['digest', 'dangling'] as const) {
      const temp = await temporaryStore(); const service = await startLocalMotionService({ databasePath: temp.databasePath, seed });
      await service.close(); corruptStoredHead(temp.databasePath, mode);
      await expect(startLocalMotionService({ databasePath: temp.databasePath, seed }))
        .rejects.toThrow(mode === 'digest' ? 'STORE_DIGEST_MISMATCH' : 'STORE_BRANCH_HEAD_MISSING');
      await temp.cleanup();
    }
    const corrupt = await temporaryStore(); createCorruptDatabase(corrupt.databasePath);
    await expect(startLocalMotionService({ databasePath: corrupt.databasePath, seed })).rejects.toThrow(); await corrupt.cleanup();
  });
  test('refuses checksum mismatch and invalid v1 content before migration without writing either database', async () => {
    const seed = phase3Seed(); const checksum = await temporaryStore();
    const current = await startLocalMotionService({ databasePath: checksum.databasePath, seed }); await current.close();
    corruptMigrationChecksum(checksum.databasePath, 2); const checksumBefore = rawDatabaseDigest(checksum.databasePath);
    await expect(startLocalMotionService({ databasePath: checksum.databasePath, seed })).rejects.toThrow('MIGRATION_CHECKSUM_MISMATCH');
    expect(rawDatabaseDigest(checksum.databasePath)).toBe(checksumBefore); await checksum.cleanup();

    const legacy = await temporaryStore(); createLegacyV1Database(legacy.databasePath, seed);
    corruptStoredHead(legacy.databasePath, 'digest'); const legacyBefore = rawDatabaseDigest(legacy.databasePath);
    await expect(startLocalMotionService({ databasePath: legacy.databasePath, seed })).rejects.toThrow('STORE_DIGEST_MISMATCH');
    expect(rawDatabaseDigest(legacy.databasePath)).toBe(legacyBefore);
    expect(inspectMigrationFixture(legacy.databasePath)).toEqual({ versions: [1], mainOnlyConstraint: true });
    await legacy.cleanup();
  });
  test('returns the byte-identical acquisition after a lost response and stores only a verifier', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed(); let injected = false;
    const secret = ['lost', 'claim', 'proof', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const service = await startLocalMotionService({ databasePath: temp.databasePath, seed, now: () => 100,
      fault: (point) => { if (!injected && point === 'after-commit') { injected = true; throw new Error('LOST'); } } });
    const client = new MotionServiceClient(service.url, (...args) => fetch(...args), { actor: 'agent', capability: 'cli-agent', claimSecret: secret });
    const command = makeClaimAcquireCommand({ operationId: 'lost-acquire', documentId: seed.documentId, expectedRevision: 0, scope: 'document' });
    expect(await client.dispatch(command)).toEqual({ ok: false, code: 'STORAGE_FAILURE', diagnostic: {
      schemaVersion: 'motion.diagnostic.v1', code: 'STORAGE_FAILURE', category: 'storage', retryable: true,
    } }); await service.close();
    const restarted = await startLocalMotionService({ databasePath: temp.databasePath, seed, now: () => 100 });
    const retryClient = new MotionServiceClient(restarted.url, (...args) => fetch(...args), { actor: 'agent', capability: 'cli-agent', claimSecret: secret });
    const retry = await retryClient.dispatch(command); expect(retry).toMatchObject({ ok: true, leaseVersion: 1 });
    const stored = restarted.store.snapshot() as { claims: unknown[] }; const snapshot = JSON.stringify(stored);
    expect(snapshot).not.toContain(secret); expect(stored.claims).toHaveLength(1);
    expect(await retryClient.dispatch(command)).toEqual(retry); await restarted.close(); await temp.cleanup();
  });
  test('restarts with diverged heads and an idempotent document lease transition intact', async () => {
    const temp = await temporaryStore(); const seed = phase3Seed(); const secret = ['restart', 'lease', 'proof',
      '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-'); let service = await startLocalMotionService({
      databasePath: temp.databasePath, seed, now: () => 100 }); let human = new MotionServiceClient(service.url);
    await human.dispatch(makeBranchCreateCommand({ operationId: 'restart-branch', documentId: seed.documentId,
      expectedRevision: 0, branchId: 'feature' }));
    await human.dispatch(makeTrackCreateCommand({ operationId: 'restart-main', documentId: seed.documentId,
      expectedRevision: 0, elementId: 'el_a2849ff826f3e167' }));
    await human.dispatch(makeTrackCreateCommand({ operationId: 'restart-feature', documentId: seed.documentId,
      branchId: 'feature', expectedRevision: 0, elementId: 'el_2dbee68b1ea318c8' }));
    let client = new MotionServiceClient(service.url, (...args) => fetch(...args),
      { actor: 'agent', capability: 'cli-agent', claimSecret: secret });
    const acquired = await client.dispatch(makeClaimAcquireCommand({ operationId: 'restart-acquire', documentId: seed.documentId,
      branchId: 'main', expectedRevision: 2, scope: 'document' }));
    if (!acquired.ok) throw new Error('RESTART_ACQUIRE_FAILED');
    const renew = makeClaimControlCommand({ kind: 'motion.claim.renew', operationId: 'restart-renew', documentId: seed.documentId,
      branchId: 'main', expectedRevision: 2, claimId: acquired.claimId!, leaseVersion: 1 });
    const renewed = await client.dispatch(renew); expect(renewed).toMatchObject({ ok: true, resultingRevision: 1, leaseVersion: 2 });
    const mainBefore = await human.head(seed.documentId, 'main'); const featureBefore = await human.head(seed.documentId, 'feature');
    await service.close(); service = await startLocalMotionService({ databasePath: temp.databasePath, seed, now: () => 100 });
    human = new MotionServiceClient(service.url); client = new MotionServiceClient(service.url, (...args) => fetch(...args),
      { actor: 'agent', capability: 'cli-agent', claimSecret: secret });
    expect(await human.head(seed.documentId, 'main')).toEqual(mainBefore);
    expect(await human.head(seed.documentId, 'feature')).toEqual(featureBefore);
    expect(await client.dispatch(renew)).toEqual(renewed);
    const release = await client.dispatch(makeClaimControlCommand({ kind: 'motion.claim.release', operationId: 'restart-release',
      documentId: seed.documentId, branchId: 'main', expectedRevision: 2, claimId: acquired.claimId!, leaseVersion: 2 }));
    expect(release).toMatchObject({ ok: true, resultingRevision: 1, leaseVersion: 3 });
    expect(await client.dispatch(makeTrackCreateCommand({ operationId: 'restart-after-release', documentId: seed.documentId,
      branchId: 'main', expectedRevision: 1, elementId: 'el_2dbee68b1ea318c8' })))
      .toEqual({ ok: false, code: 'UNAUTHORIZED_CLAIM', diagnostic: { schemaVersion: 'motion.diagnostic.v1',
        code: 'CLAIM_EXPIRED', category: 'authorization', retryable: true } });
    expect(JSON.stringify(service.store.snapshot())).not.toContain(secret);
    await service.close(); await temp.cleanup();
  });
});

function matrixClient(url: string, actor: 'human' | 'agent') {
  return new MotionServiceClient(url, (...args) => fetch(...args), { actor,
    capability: actor === 'human' ? 'human-editor' : 'cli-agent', ...(actor === 'agent' ? { claimSecret: recoverySecret } : {}) });
}
async function crashService(databasePath: string, point: FaultPoint): Promise<{ url: string; exited: Promise<void> }> {
  const root = resolve(import.meta.dirname, '../../..');
  const child = spawn('npm', ['exec', 'vite-node', '--', resolve(import.meta.dirname, 'crash-fixture.ts'), databasePath, point],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
  const url = await new Promise<string>((resolveUrl, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('CRASH_FIXTURE_TIMEOUT')), 8000);
    child.stdout.on('data', (chunk) => { output += chunk.toString(); const line = output.split('\n').find((value) => value.startsWith('{'));
      if (line) { clearTimeout(timer); resolveUrl((JSON.parse(line) as { url: string }).url); } });
    child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`CRASH_FIXTURE_EXIT_${code}`)); });
  });
  return { url, exited };
}
async function restartEventually(databasePath: string) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { return await startLocalMotionService({ databasePath, seed: phase3Seed(), now: () => 100 }); }
    catch (error) { lastError = error; await new Promise((resolveDelay) => setTimeout(resolveDelay, 25)); }
  }
  throw lastError;
}
