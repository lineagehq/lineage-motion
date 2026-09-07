import { expect, test } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { sequenceTestStore, human } from './sequence-test-support.ts';
import { SqliteProjectStore } from './sqlite-project-store.ts';

test.each(['undo_json', 'redo_json'] as const)('startup rejects %s content that disagrees with its immutable revision', async field => {
  const t = await sequenceTestStore();
  try {
    expect(t.store.executeSequence(t.create, human).ok).toBe(true);
    expect(t.store.executeSequence({ ...t.base, operationId: 'rename', kind: 'sequence.edit',
      edit: { kind: 'sequence.rename', name: 'Accepted name' } }, human).ok).toBe(true);
    let revision = 1;
    if (field === 'redo_json') {
      expect(t.store.executeSequence({ ...t.base, expectedRevision: 1, operationId: 'undo', kind: 'sequence.undo' }, human).ok).toBe(true);
      revision = 2;
    }
    const before = t.store.readSequence(t.base.sequenceId, human.now)!.canonicalDigest;
    const row = t.store.database.prepare(`SELECT ${field} AS history FROM sequence_revisions WHERE sequence_id=? AND revision=?`)
      .get(t.base.sequenceId, revision) as { history: string };
    const history = JSON.parse(row.history); history[0].name = 'Never accepted';
    t.store.database.prepare(`UPDATE sequence_revisions SET ${field}=? WHERE sequence_id=? AND revision=?`)
      .run(JSON.stringify(history), t.base.sequenceId, revision);
    t.store.close();
    expect(() => new SqliteProjectStore(t.path)).toThrow('SEQUENCE_HISTORY_INVALID');
    const raw = new DatabaseSync(t.path);
    try { expect(raw.prepare('SELECT canonical_digest FROM sequence_revisions WHERE sequence_id=? AND revision=?')
      .get(t.base.sequenceId, revision)).toMatchObject({ canonical_digest: before }); }
    finally { raw.close(); }
  } finally { try { t.store.close(); } catch {} await t.cleanup(); }
});
