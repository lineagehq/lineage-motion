import { describe, expect, test } from 'vitest';
import { spawn } from 'node:child_process';
import { join, resolve } from 'node:path';
import { MotionServiceClient } from '../../motion-protocol/src/index.ts';
import { startLocalMotionService } from './index.ts';
import { phase3Command, phase3Seed, temporaryStore } from './test-support.ts';
import type { FaultPoint } from './sqlite-project-store.ts';

describe('restart and lost-response recovery', () => {
  test.each(['after-begin', 'after-inserts', 'before-commit'] as const)('rolls back an injected %s failure', async (point) => {
    const temporary = await temporaryStore(); const seed = phase3Seed(); let injected = false;
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed,
      fault: (candidate) => { if (!injected && candidate === point) { injected = true; throw new Error(`FAULT_${point}`); } } });
    expect(await new MotionServiceClient(service.url).dispatch(phase3Command(`fault-${point}`))).toEqual({ ok: false, code: 'STORAGE_FAILURE' });
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
    expect(await new MotionServiceClient(service.url).dispatch(command)).toEqual({ ok: false, code: 'STORAGE_FAILURE' });
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
});

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
