import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

import { canonicalJson } from '../../domain/src/index.ts';
import { MotionServiceClient } from '../../motion-protocol/src/index.ts';
import { startLocalMotionService } from './index.ts';
import { SqliteProjectStore } from './sqlite-project-store.ts';
import { phase3Command, phase3Seed, temporaryStore } from './test-support.ts';

describe('loopback sole-writer service', () => {
  test('rejects a second lock holder before listen and commits one atomic fixed-main revision', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    await expect(startLocalMotionService({ databasePath: temporary.databasePath, seed })).rejects.toThrow('STORE_LOCKED');
    const client = new MotionServiceClient(service.url); const before = service.store.snapshot();
    const command = phase3Command(); const accepted = await client.dispatch(command);
    expect(accepted).toMatchObject({ ok: true, expectedRevision: 0, resultingRevision: 1,
      receipt: { schemaVersion: 'motion.revision-receipt.v1' } });
    expect(service.store.readHead(seed.documentId)?.document.revision).toBe(1);
    expect(service.store.snapshot()).not.toEqual(before);
    await service.close(); await temporary.cleanup();
  });

  test('serializes same-base races and leaves every table unchanged for stale and invalid requests', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    const client = new MotionServiceClient(service.url);
    const [first, second] = await Promise.all([client.dispatch(phase3Command('race-a', 'el_a2849ff826f3e167')),
      client.dispatch(phase3Command('race-b', 'el_2dbee68b1ea318c8'))]);
    expect([first, second].filter((value) => value.ok)).toHaveLength(1);
    expect([first, second].filter((value) => !value.ok)).toEqual([expect.objectContaining({ code: 'STALE_REVISION' })]);
    const stable = service.store.snapshot();
    expect(await client.dispatch(phase3Command('stale'))).toMatchObject({ ok: false, code: 'STALE_REVISION' });
    const invalid = await fetch(`${service.url}/api/v1/commands`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: canonicalJson({ ...phase3Command('invalid'), selector: '.secret' }) });
    expect(await invalid.json()).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(service.store.snapshot()).toEqual(stable);
    await service.close(); await temporary.cleanup();
  });

  test('returns byte-identical committed retries, conflicts changed payloads, and publishes metadata only after commit', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    const command = phase3Command('retry');
    const authHeaders = { 'content-type': 'application/json', authorization: 'Bearer human-editor', 'x-motion-actor': 'human' };
    const firstRaw = await fetch(`${service.url}/api/v1/commands`, { method: 'POST', headers: authHeaders, body: canonicalJson(command) });
    const first = await firstRaw.text();
    const retry = await fetch(`${service.url}/api/v1/commands`, { method: 'POST', headers: authHeaders, body: canonicalJson(command) });
    expect(await retry.text()).toBe(first);
    const conflict = await new MotionServiceClient(service.url).dispatch({ ...command,
      command: { ...command.command, elementId: 'el_a2849ff826f3e167' } });
    expect(conflict).toEqual({ ok: false, code: 'OPERATION_ID_CONFLICT' });
    const snapshot = JSON.stringify(service.store.snapshot());
    expect(snapshot).toContain('private_payload_json');
    expect(first).not.toContain('selectorHint'); expect(first).not.toContain('presentation');
    await service.close(); await temporary.cleanup();
  });

  test('keeps node:sqlite imports inside the sole adapter', async () => {
    const files = ['index.ts', 'lock-runner.ts', 'migrations.ts', 'paths.ts', 'seed.ts', 'test-support.ts'];
    for (const file of files) expect(await readFile(new URL(file, import.meta.url), 'utf8')).not.toContain("from 'node:sqlite'");
  });

  test('runs with WAL, FULL synchronization, and enforced foreign keys that refuse state without side effects', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    const store = service.store as SqliteProjectStore; expect(store.runtimePragmas()).toEqual({
      journalMode: 'wal', synchronous: 2, foreignKeys: 1 });
    const before = store.snapshot(); expect(() => store.proveForeignKeyRefusal()).not.toThrow(); expect(store.snapshot()).toEqual(before);
    await service.close(); await temporary.cleanup();
  });

  test('fails the service closed immediately when the lock holder dies unexpectedly', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    process.kill(service.lockHolderPid, 'SIGKILL');
    await expect.poll(async () => { try { await fetch(`${service.url}/health`); return false; } catch { return true; } }).toBe(true);
    const replacement = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    expect((await fetch(`${replacement.url}/health`)).ok).toBe(true);
    await replacement.close(); await service.close(); await temporary.cleanup();
  });

  test('fails closed before listening when the store schema is newer than this binary supports', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    (service.store as SqliteProjectStore).database
      .prepare('INSERT INTO schema_migrations(version,checksum,applied_order) VALUES(?,?,?)')
      .run(3, 'future-schema', 3);
    await service.close();
    await expect(startLocalMotionService({ databasePath: temporary.databasePath, seed }))
      .rejects.toThrow('UNSUPPORTED_SCHEMA_VERSION');
    await temporary.cleanup();
  });

  test('authenticates every canonical read and durably replays ordered metadata after a commit cursor', async () => {
    const temporary = await temporaryStore(); const seed = phase3Seed();
    const service = await startLocalMotionService({ databasePath: temporary.databasePath, seed });
    for (const path of [`/api/v1/documents/${seed.documentId}/branches/main/head`,
      `/api/v1/documents/${seed.documentId}/revisions/0`, `/api/v1/documents/${seed.documentId}/revision`,
      `/api/v1/documents/${seed.documentId}/events`]) expect((await fetch(`${service.url}${path}`)).status).toBe(403);
    const client = new MotionServiceClient(service.url);
    await client.dispatch(phase3Command('replay-one')); await client.dispatch(phase3Command('replay-stale'));
    const response = await fetch(`${service.url}/api/v1/documents/${seed.documentId}/events`, { headers: {
      authorization: 'Bearer human-editor', 'x-motion-actor': 'human', 'last-event-id': '0' } });
    expect(response.status).toBe(200); const reader = response.body!.getReader(); const decoder = new TextDecoder();
    let text = ''; while (!text.includes(': connected\n\n')) { const next = await reader.read(); if (next.done) break;
      text += decoder.decode(next.value, { stream: true }); }
    await reader.cancel(); expect(text).toContain('id: 1\nevent: commit\n');
    expect(text).not.toContain('private_payload_json'); expect(text).not.toContain('elementId');
    const parsed = text.split('\n').find((line) => line.startsWith('data: '));
    expect(parsed && JSON.parse(parsed.slice(6))).toEqual(service.store.readEvents(seed.documentId, 0)[0]);
    await service.close(); await temporary.cleanup();
  });
});
