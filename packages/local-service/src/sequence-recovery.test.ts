import { expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { existsSync } from 'node:fs';
import { SqliteProjectStore } from './sqlite-project-store.ts';
import { sequenceTestStore, human, agent } from './sequence-test-support.ts';
const removeSequenceTables = 'DROP TABLE sequence_claims; DROP TABLE sequence_operations; DROP TABLE sequence_revisions; DROP TABLE sequences; DELETE FROM schema_migrations WHERE version=6';
test.each(['after-begin', 'after-inserts', 'before-commit'] as const)('failure at %s rolls back sequence, claim, history and receipt; reopened retry succeeds', async point => {
  let armed = false;
  const t = await sequenceTestStore(at => { if (armed && at === point) { armed = false; throw new Error('SYNTHETIC_FAULT'); } });
  let store = t.store;
  try {
    const command = { ...t.create, claim: true }; const before = store.snapshot(); armed = true;
    expect(() => store.executeSequence(command, agent)).toThrow('SYNTHETIC_FAULT'); expect(store.snapshot()).toEqual(before);
    store.close(); store = new SqliteProjectStore(t.path); store.initialize(t.seed);
    expect(store.snapshot()).toEqual(before);
    expect(store.executeSequence(command, agent)).toMatchObject({ ok: true, revision: 0 });
    expect(store.readSequence(t.base.sequenceId, 1000)!.activeClaim).not.toBeNull();
  } finally { store.close(); await t.cleanup(); }
});
test('a lost committed response replays original receipt after restart and lease expiry without a second mutation', async () => {
  let armed = false;
  const t = await sequenceTestStore(at => { if (armed && at === 'after-commit') { armed = false; throw new Error('LOST_RESPONSE'); } });
  let store = t.store;
  try {
    const command = { ...t.create, claim: true }; armed = true;
    expect(() => store.executeSequence(command, agent)).toThrow('LOST_RESPONSE');
    const committed = store.snapshot(); store.close(); store = new SqliteProjectStore(t.path); store.initialize(t.seed);
    expect(store.executeSequence(command, { ...agent, now: 100000 })).toMatchObject({ ok: true, revision: 0 });
    expect(store.snapshot()).toEqual(committed);
    expect(store.executeSequence(command, { ...agent, capability: 'other-agent' })).toMatchObject({ ok: false, code: 'SEQUENCE_OPERATION_CONFLICT' });
  } finally { store.close(); await t.cleanup(); }
});
test('v5 migration preserves shot bytes and produces a readable pre-migration backup', async () => {
  const t = await sequenceTestStore(); let store = t.store;
  try {
    const head = store.readHead(t.seed.documentId); const catalog = store.readProjectCatalog();
    store.database.exec(removeSequenceTables); store.close();
    store = new SqliteProjectStore(t.path); store.initialize(t.seed);
    expect(store.readHead(t.seed.documentId)).toEqual(head); expect(store.readProjectCatalog()).toEqual(catalog);
    expect(store.listSequences(1000).sequences).toEqual([]);
    expect(existsSync(`${t.path}.backup-v6`)).toBe(true);
    const backup = new DatabaseSync(`${t.path}.backup-v6`, { readOnly: true });
    try { expect(backup.prepare('SELECT MAX(version) version FROM schema_migrations').get()).toMatchObject({ version: 5 }); }
    finally { backup.close(); }
    expect(store.executeSequence(t.create, human)).toMatchObject({ ok: true });
  } finally { store.close(); await t.cleanup(); }
});
test('a failed v6 migration rolls back its earlier DDL and can reopen after the obstruction is removed', async () => {
  const t = await sequenceTestStore(); let store: SqliteProjectStore | undefined = t.store;
  try {
    const before = store.readHead(t.seed.documentId);
    store.database.exec(`${removeSequenceTables}; CREATE TABLE sequence_operations(obstruction TEXT)`); store.close(); store = undefined;
    expect(() => new SqliteProjectStore(t.path)).toThrow();
    const inspect = new DatabaseSync(t.path);
    try {
      expect(inspect.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name IN ('sequences','sequence_revisions','sequence_claims')").all()).toEqual([]);
      expect(inspect.prepare('SELECT MAX(version) version FROM schema_migrations').get()).toMatchObject({ version: 5 });
      inspect.exec('DROP TABLE sequence_operations');
    } finally { inspect.close(); }
    store = new SqliteProjectStore(t.path); store.initialize(t.seed); expect(store.readHead(t.seed.documentId)).toEqual(before);
    expect(store.executeSequence(t.create, human)).toMatchObject({ ok: true });
  } finally { store?.close(); await t.cleanup(); }
});
test.each(['after-inserts', 'before-commit', 'after-commit'] as const)('edit fault %s preserves atomic revision/history/receipt relationships', async point => {
  let armed = false;
  const t = await sequenceTestStore(at => { if (armed && at === point) { armed = false; throw new Error('EDIT_FAULT'); } });
  const { store, base } = t;
  try {
    store.executeSequence(t.create, human); const before = store.snapshot();
    const command = { ...base, operationId: 'edit', kind: 'sequence.edit' as const, edit: { kind: 'clip.hold' as const, clipId: 'clip_one', endHoldMs: 500 } };
    armed = true; expect(() => store.executeSequence(command, human)).toThrow('EDIT_FAULT');
    if (point !== 'after-commit') expect(store.snapshot()).toEqual(before);
    expect(store.executeSequence(command, human)).toMatchObject({ ok: true, revision: 1 });
    expect(store.readSequence(base.sequenceId, 1000)!.sequence.clips[0]!.endHoldMs).toBe(500);
    expect(store.executeSequence({ ...base, expectedRevision: 1, kind: 'sequence.undo', operationId: 'undo' }, human)).toMatchObject({ ok: true, revision: 2 });
    expect(store.readSequence(base.sequenceId, 1000)!.sequence.clips[0]!.endHoldMs).toBe(0);
    expect(store.executeSequence({ ...base, expectedRevision: 2, kind: 'sequence.undo', operationId: 'extra-undo' }, human)).toMatchObject({ ok: false, code: 'SEQUENCE_HISTORY_UNAVAILABLE' });
  } finally { store.close(); await t.cleanup(); }
});
