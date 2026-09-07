import { expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { canonicalJson } from '../../domain/src/index.ts';
import { SqliteProjectStore } from './sqlite-project-store.ts';
import { MIGRATIONS } from './migrations.ts';
import { phase3Command, phase3Seed, temporaryStore } from './test-support.ts';
import type { ShotAdmissionCommand } from '../../motion-protocol/src/project.ts';
const human = { actor: 'human' as const, capability: 'human-editor', now: 1000 };
const agent = { actor: 'agent' as const, capability: 'cli-agent', claimSecret: 'r'.repeat(64), now: 1000 };
function command(store: SqliteProjectStore, claimed = false): ShotAdmissionCommand {
  return { protocolVersion: 'motion.project-protocol.v1', kind: 'motion.shot.admit', operationId: 'admit-recovery',
    projectId: store.readProjectCatalog().projectId, expectedCatalogRevision: 0, documentId: 'recovery_shot', name: 'Recovered',
    source: { kind: 'starter', starterId: 'trajectory' }, claim: claimed ? { scope: 'document', documentId: 'recovery_shot' } : null };
}
test.each(['after-begin', 'after-inserts', 'before-commit'] as const)('rolls back admission and its claim at %s, then reopens and retries', async point => {
  const temporary = await temporaryStore(); let store: SqliteProjectStore | undefined;
  try {
    let armed = true;
    store = new SqliteProjectStore(temporary.databasePath, at => { if (armed && at === point) { armed = false; throw new Error('FAULT'); } });
    store.initialize(phase3Seed()); const input = command(store, true); const before = store.snapshot();
    expect(() => store!.admitShot(input, agent)).toThrow('FAULT'); expect(store.snapshot()).toEqual(before);
    store.close(); store = new SqliteProjectStore(temporary.databasePath); store.initialize(phase3Seed());
    expect(store.snapshot()).toEqual(before); expect(store.admitShot(input, agent)).toMatchObject({ ok: true, catalogRevision: 1 });
    expect(store.listActiveClaims(input.documentId, 1000)?.claims).toHaveLength(1);
  } finally { store?.close(); await temporary.cleanup(); }
});
test('lost admission response is exactly replayed across restart, but rotated capability cannot impersonate the old retry', async () => {
  const temporary = await temporaryStore(); let store: SqliteProjectStore | undefined;
  try {
    store = new SqliteProjectStore(temporary.databasePath, at => { if (at === 'after-commit') throw new Error('LOST'); });
    store.initialize(phase3Seed()); const input = command(store, true);
    expect(() => store!.admitShot(input, agent)).toThrow('LOST'); const before = store.snapshot();
    store.close(); store = new SqliteProjectStore(temporary.databasePath); store.initialize(phase3Seed());
    const receipt = store.admitShot(input, agent); expect(receipt).toMatchObject({ ok: true, catalogRevision: 1, claim: { leaseVersion: 1 } });
    expect(store.admitShot(input, { ...agent, now: 2000 })).toEqual(receipt); expect(store.snapshot()).toEqual(before);
    expect(store.admitShot(input, { ...agent, capability: 'rotated-agent' })).toMatchObject({ ok: false, code: 'OPERATION_ID_CONFLICT' });
    expect(store.snapshot()).toEqual(before);
  } finally { store?.close(); await temporary.cleanup(); }
});
test('migration5 preserves legacy revisions, claims and history; its backup opens at the prior schema', async () => {
  const temporary = await temporaryStore(); let store: SqliteProjectStore | undefined;
  try {
    store = new SqliteProjectStore(temporary.databasePath); store.initialize(phase3Seed());
    expect(store.execute(phase3Command(), human).response.ok).toBe(true);
    const before = store.snapshot() as Record<string, unknown>; const head = store.readHead(phase3Seed().documentId);
    // Model a real v4 database by retaining its unchanged tables and checksummed migration records.
    store.database.exec('DROP TABLE sequence_claims; DROP TABLE sequence_operations; DROP TABLE sequence_revisions; DROP TABLE sequences; '
      + 'DROP TABLE shot_admissions; DROP TABLE project_shots; DROP TABLE project_catalog; DELETE FROM schema_migrations WHERE version>=5');
    store.close(); store = new SqliteProjectStore(temporary.databasePath); store.initialize(phase3Seed());
    expect(store.readHead(phase3Seed().documentId)).toEqual(head);
    const after = store.snapshot() as Record<string, unknown>;
    for (const key of Object.keys(before).filter(key => !['project_catalog', 'project_shots', 'shot_admissions'].includes(key)))
      expect(after[key]).toEqual(before[key]);
    expect(store.readWorkspace(phase3Seed().documentId, 'main')?.history.undoAvailable).toBe(true);
    expect(store.admitShot(command(store), human)).toMatchObject({ ok: true });
    expect(existsSync(`${temporary.databasePath}.backup-v5`)).toBe(true);
    const backup = new DatabaseSync(`${temporary.databasePath}.backup-v5`);
    try {
      expect(backup.prepare('SELECT version,checksum FROM schema_migrations ORDER BY version').all()).toEqual(
        MIGRATIONS.slice(0, 4).map(({ version, checksum }) => ({ version, checksum })));
      expect(backup.prepare('SELECT last_revision FROM documents').get()).toMatchObject({ last_revision: 1 });
    } finally { backup.close(); }
  } finally { store?.close(); await temporary.cleanup(); }
});
test('rejects catalog omissions, mismatched project and mismatched seed without changing persisted data', async () => {
  const temporary = await temporaryStore(); let store: SqliteProjectStore | undefined;
  try {
    store = new SqliteProjectStore(temporary.databasePath); store.initialize(phase3Seed());
    const before = canonicalJson(store.snapshot());
    expect(() => store!.initialize(phase3Seed(), { projectId: 'other', name: 'Other' })).toThrow('STORE_PROJECT_MISMATCH');
    expect(canonicalJson(store.snapshot())).toBe(before);
    store.database.prepare('DELETE FROM project_shots').run(); store.close();
    store = undefined;
    expect(() => new SqliteProjectStore(temporary.databasePath)).toThrow('PROJECT_CATALOG_INTEGRITY_FAILED');
  } finally { store?.close(); await temporary.cleanup(); }
});
test('failed migration5 leaves no partial catalog table and preserves its v4 backup for repair', async () => {
  const temporary = await temporaryStore();
  try {
    const store = new SqliteProjectStore(temporary.databasePath); store.initialize(phase3Seed());
    const head = store.readHead(phase3Seed().documentId);
    store.database.exec('DROP TABLE sequence_claims; DROP TABLE sequence_operations; DROP TABLE sequence_revisions; DROP TABLE sequences; '
      + 'DROP TABLE shot_admissions; DROP TABLE project_shots; DROP TABLE project_catalog; DELETE FROM schema_migrations WHERE version>=5');
    // A conflicting table makes migration fail after its first CREATE; all migration writes must roll back.
    store.database.exec('CREATE TABLE project_shots(sentinel TEXT); INSERT INTO project_shots VALUES(\'kept\')'); store.close();
    expect(() => new SqliteProjectStore(temporary.databasePath)).toThrow();
    const raw = new DatabaseSync(temporary.databasePath);
    try {
      expect(raw.prepare("SELECT name FROM sqlite_master WHERE name='project_catalog'").get()).toBeUndefined();
      expect(raw.prepare('SELECT * FROM project_shots').all()).toEqual([{ sentinel: 'kept' }]);
      expect(raw.prepare('SELECT MAX(version) version FROM schema_migrations').get()).toMatchObject({ version: 4 });
      expect(raw.prepare('SELECT canonical_digest FROM revisions').get()).toMatchObject({ canonical_digest: head!.canonicalDigest });
    } finally { raw.close(); }
    expect(existsSync(`${temporary.databasePath}.backup-v5`)).toBe(true);
  } finally { await temporary.cleanup(); }
});
test('migration binds project identity atomically before initialization so an interrupted startup can reopen', async () => {
  const temporary = await temporaryStore(); let store: SqliteProjectStore | undefined;
  try {
    store = new SqliteProjectStore(temporary.databasePath); store.initialize(phase3Seed());
    store.database.exec('DROP TABLE sequence_claims; DROP TABLE sequence_operations; DROP TABLE sequence_revisions; DROP TABLE sequences; '
      + 'DROP TABLE shot_admissions; DROP TABLE project_shots; DROP TABLE project_catalog; DELETE FROM schema_migrations WHERE version>=5');
    store.close();
    const project = { projectId: 'named_project', name: 'Named animation' };
    store = new SqliteProjectStore(temporary.databasePath, undefined, project);
    // No initialize call before close: migration must not leave an unbound durable catalog.
    store.close(); store = new SqliteProjectStore(temporary.databasePath, undefined, project); store.initialize(phase3Seed(), project);
    expect(store.readProjectCatalog()).toMatchObject({ ...project, catalogRevision: 0 });
  } finally { store?.close(); await temporary.cleanup(); }
});
