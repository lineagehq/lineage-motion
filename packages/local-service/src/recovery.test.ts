import { describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { compileMotionDocument } from '../../css-compiler/src/index.ts';
import { canonicalBytes, canonicalContentBytes, projectTrajectorySelection, projectTransformTrajectory,
  type MotionDocument, type TrajectoryAuthoringOperation } from '../../domain/src/index.ts';
import { makeTrajectoryCommand, MotionServiceClient } from '../../motion-protocol/src/index.ts';
import { startLocalMotionService } from './index.ts';
import { createTrajectorySeed } from './seed.ts';
import { phase3Command, phase3Seed, temporaryStore } from './test-support.ts';
import type { FaultPoint } from './sqlite-project-store.ts';

describe('restart and lost-response recovery', () => {
  test.each(['after-begin', 'after-inserts', 'before-commit'] as const)('rolls back an injected %s failure', async (point) => {
    const temporary = await temporaryStore(); const seed = phase3Seed(); let injected = false;
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed,
      fault: (candidate) => { if (!injected && candidate === point) { injected = true; throw new Error(`FAULT_${point}`); } } });
    expect(await new MotionServiceClient(service.url).dispatch(phase3Command(`fault-${point}`))).toEqual({ ok: false,
      code: 'STORAGE_FAILURE', diagnostic: { schemaVersion: 'motion.diagnostic.v1', code: 'STORAGE_FAILURE',
        category: 'storage', retryable: true } });
    expect(service.store.readHead(seed.documentId)?.document.revision).toBe(0); await service.close();
    const restarted = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    expect(restarted.store.readHead(seed.documentId)?.document.revision).toBe(0);
    await restarted.close(); await temporary.cleanup();
  });

  test('recovers a commit whose response was lost and returns its exact stored response', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed(); let injected = false;
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed,
      fault: (point) => { if (!injected && point === 'after-commit') { injected = true; throw new Error('LOST_RESPONSE'); } } });
    const command = phase3Command('lost-response');
    expect(await new MotionServiceClient(service.url).dispatch(command)).toEqual({ ok: false, code: 'STORAGE_FAILURE',
      diagnostic: { schemaVersion: 'motion.diagnostic.v1', code: 'STORAGE_FAILURE', category: 'storage', retryable: true } });
    expect(service.store.readHead(seed.documentId)?.document.revision).toBe(1); await service.close();
    const restarted = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    const retry = await new MotionServiceClient(restarted.url).dispatch(command);
    expect(retry).toMatchObject({ ok: true, operationId: 'lost-response', resultingRevision: 1 });
    const stable = restarted.store.snapshot(); expect(await new MotionServiceClient(restarted.url).dispatch(command)).toEqual(retry);
    expect(restarted.store.snapshot()).toEqual(stable);
    await restarted.close(); await temporary.cleanup();
  });

  test.each(['after-begin', 'after-inserts', 'before-commit', 'after-commit'] as const)(
    'survives real subprocess termination at %s and preserves exact retry semantics', async (point) => {
      const temporary = await temporaryStore(); const seed = phase3Seed(); const command = phase3Command(`process-${point}`);
      const child = await crashService(temporary.databasePath, point);
      await expect(new MotionServiceClient(child.url).dispatch(command)).rejects.toThrow();
      await child.exited;
      const restarted = await restartEventually(temporary.databasePath);
      const head = restarted.store.readHead(seed.documentId)!;
      if (point === 'after-commit') {
        expect(head.document.revision).toBe(1);
        const retry = await new MotionServiceClient(restarted.url).dispatch(command);
        expect(retry).toMatchObject({ ok: true, operationId: `process-${point}`, resultingRevision: 1 });
      } else {
        expect(head.document.revision).toBe(0);
        expect(await new MotionServiceClient(restarted.url).dispatch(command)).toMatchObject({ ok: true, resultingRevision: 1 });
      }
      await restarted.close(); await temporary.cleanup();
    }, 20_000,
  );

  test('creates a SQLite-consistent snapshot containing committed WAL state that opens independently', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    expect(await new MotionServiceClient(service.url).dispatch(phase3Command('wal-backup'))).toMatchObject({ ok: true });
    const backupPath = join(temporary.directory, 'consistent-backup.sqlite'); service.store.backup(backupPath);
    const backupService = await startLocalMotionService({ databasePath: backupPath, seed });
    expect(backupService.store.readHead(seed.documentId)).toEqual(service.store.readHead(seed.documentId));
    expect(backupService.store.snapshot()).toEqual(service.store.snapshot());
    await backupService.close(); await service.close(); await temporary.cleanup();
  });

  test('reconstructs five-operation Undo and Redo lineage across service restarts', async () => {
    const temporary = await temporaryStore(); const seed = createTrajectorySeed(); const ids = seed.elements.map((element) => element.id).sort();
    const stage = { stageDigest: 'a'.repeat(64), widthMicrounits: 800_000_000, heightMicrounits: 450_000_000 };
    let service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    let client = new MotionServiceClient(service.url); const snapshots: MotionDocument[] = [structuredClone(seed)];
    for (let revision = 0; revision < 5; revision += 1) {
      const operation = recoveryTrajectoryOperation(service.store.readHead(seed.documentId)!.document, revision, ids, stage);
      expect(await client.dispatch(makeTrajectoryCommand(operation))).toMatchObject({ ok: true,
        expectedRevision: revision, resultingRevision: revision + 1 });
      snapshots.push(structuredClone(service.store.readHead(seed.documentId)!.document));
    }
    const historicalBytes = await Promise.all(Array.from({ length: 6 }, async (_, revision) =>
      canonicalBytes((await client.revision(seed.documentId, revision)).document)));
    await service.close(); service = await startLocalMotionService({ databasePath: temporary.databasePath, seed }); client = new MotionServiceClient(service.url);
    for (let index = 0; index < 5; index += 1) {
      const expectedRevision = 5 + index; const operation = { schemaVersion: 'motion.operation.v1' as const,
        kind: 'motion.history.undo' as const, operationId: `restart-undo-${index}`, documentId: seed.documentId, expectedRevision };
      expect(await client.dispatch(makeTrajectoryCommand(operation))).toMatchObject({ ok: true,
        expectedRevision, resultingRevision: expectedRevision + 1 });
      expectRestored(service.store.readHead(seed.documentId)!.document, snapshots[4 - index]!);
    }
    await service.close(); service = await startLocalMotionService({ databasePath: temporary.databasePath, seed }); client = new MotionServiceClient(service.url);
    for (let index = 0; index < 5; index += 1) {
      const expectedRevision = 10 + index; const operation = { schemaVersion: 'motion.operation.v1' as const,
        kind: 'motion.history.redo' as const, operationId: `restart-redo-${index}`, documentId: seed.documentId, expectedRevision };
      expect(await client.dispatch(makeTrajectoryCommand(operation))).toMatchObject({ ok: true,
        expectedRevision, resultingRevision: expectedRevision + 1 });
      expectRestored(service.store.readHead(seed.documentId)!.document, snapshots[index + 1]!);
    }
    for (let revision = 0; revision <= 5; revision += 1)
      expect(canonicalBytes((await client.revision(seed.documentId, revision)).document)).toEqual(historicalBytes[revision]);
    const events = (service.store.snapshot() as { events: Array<{ kind: string; resulting_revision: number }> }).events;
    expect(events.slice(-10).map(({ kind, resulting_revision }) => [kind, resulting_revision])).toEqual([
      ...Array.from({ length: 5 }, (_, index) => ['motion.history.undo', 6 + index]),
      ...Array.from({ length: 5 }, (_, index) => ['motion.history.redo', 11 + index]),
    ]);
    await service.close(); await temporary.cleanup();
  });
});

function expectRestored(actual: MotionDocument, expected: MotionDocument): void {
  expect(canonicalContentBytes(actual)).toEqual(canonicalContentBytes(expected));
  const actualCompiled = compileMotionDocument(actual); const expectedCompiled = compileMotionDocument(expected);
  expect({ html: actualCompiled.html, css: actualCompiled.css, exportDigest: actualCompiled.exportDigest })
    .toEqual({ html: expectedCompiled.html, css: expectedCompiled.css, exportDigest: expectedCompiled.exportDigest });
}

function recoveryTrajectoryOperation(document: MotionDocument, revision: number, ids: string[], stage: {
  stageDigest: string; widthMicrounits: number; heightMicrounits: number }): TrajectoryAuthoringOperation {
  const envelope = { schemaVersion: 'motion.operation.v1' as const, operationId: `restart-trajectory-${revision}`,
    documentId: document.documentId, expectedRevision: revision };
  if (revision === 0) {
    const selected = projectTrajectorySelection(document, [ids[0]!], 700); const trajectory = projectTransformTrajectory(document, ids[0]!);
    if (!selected.eligible || !trajectory.eligible) throw new Error('RECOVERY_POSE_UNAVAILABLE');
    const current = trajectory.waypoints.find((point) => point.timeMs === 700); if (!current) throw new Error('RECOVERY_POSE_MISSING');
    return { ...envelope, kind: 'motion.transform-pose.set', ...selected.targets[0]!,
      payload: { pose: { ...current.pose, scalePpm: current.pose.scalePpm + 100_000 }, stage } };
  }
  const moment = revision < 3 ? 700 : revision === 3 ? 840 : 2100;
  const selected = projectTrajectorySelection(document, ids, moment); if (!selected.eligible) throw new Error(selected.code!);
  if (revision === 1) return { ...envelope, kind: 'motion.transform-waypoints.translate',
    payload: { targets: selected.targets, deltaXPpm: 10_000, deltaYPpm: -10_000, stage } };
  if (revision === 2) return { ...envelope, kind: 'motion.keyframe-group-time.set',
    payload: { targets: selected.targets, sourceTimeMs: 700, targetTimeMs: 840, landingTimeMs: 840, settledTimeMs: 2100 } };
  if (revision === 3) return { ...envelope, kind: 'motion.keyframe-group-easing.set', payload: { targets: selected.targets,
    expectedEasing: { kind: 'keyword', value: 'ease-out' }, easing: { kind: 'keyword', value: 'ease-in-out' } } };
  return { ...envelope, kind: 'motion.settled-hold.set', payload: { targets: selected.targets,
    sourceTimeMs: 2100, settledTimeMs: 1820, landingTimeMs: 840, boundaryTimeMs: 2100 } };
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
    try { return await startLocalMotionService({ databasePath, seed: phase3Seed() }); }
    catch (error) { lastError = error; await new Promise((resolveDelay) => setTimeout(resolveDelay, 25)); }
  }
  throw lastError;
}
