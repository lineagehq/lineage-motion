import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { sequenceDigest, sequenceDocumentSchema, sequenceDuration, type SequenceDocument } from '../../domain/src/sequence.ts';
import type { SequenceCatalog, SequenceSnapshot } from '../../motion-protocol/src/sequence.ts';

export type SequenceRow = { revision: number; canonical_json: string; canonical_digest: string; undo_json: string; redo_json: string };
export function readSequenceRow(database: DatabaseSync, sequenceId: string): SequenceRow | undefined {
  return database.prepare(`SELECT r.revision,r.canonical_json,r.canonical_digest,r.undo_json,r.redo_json
    FROM sequences s JOIN sequence_revisions r ON r.sequence_id=s.sequence_id AND r.revision=s.head_revision
    WHERE s.sequence_id=?`).get(sequenceId) as SequenceRow | undefined;
}
export function sequenceHistory(json: string): SequenceDocument[] {
  const values: unknown = JSON.parse(json);
  if (!Array.isArray(values)) throw new Error('SEQUENCE_HISTORY_INVALID');
  return values.map(value => sequenceDocumentSchema.parse(value));
}
export function readSequence(database: DatabaseSync, sequenceId: string, now: number): SequenceSnapshot | null {
  const row = readSequenceRow(database, sequenceId); if (!row) return null;
  const sequence = sequenceDocumentSchema.parse(JSON.parse(row.canonical_json));
  if (sequenceDigest(sequence) !== row.canonical_digest) throw new Error('SEQUENCE_DIGEST_MISMATCH');
  const claim = database.prepare(`SELECT claim_id,lease_version,expires_at FROM sequence_claims
    WHERE sequence_id=? AND active=1 AND expires_at>? ORDER BY claim_id`).get(sequenceId, now) as
    { claim_id: string; lease_version: number; expires_at: number } | undefined;
  return { schemaVersion: 'motion.sequence-snapshot.v1', sequence, canonicalDigest: row.canonical_digest,
    undoAvailable: sequenceHistory(row.undo_json).length > 0, redoAvailable: sequenceHistory(row.redo_json).length > 0,
    activeClaim: claim ? { claimId: claim.claim_id, leaseVersion: claim.lease_version, expiresAt: claim.expires_at } : null };
}
export function listSequences(database: DatabaseSync, projectId: string, now: number): SequenceCatalog {
  const rows = database.prepare('SELECT sequence_id FROM sequences ORDER BY sequence_id').all() as Array<{ sequence_id: string }>;
  return { schemaVersion: 'motion.sequence-catalog.v1', projectId, sequences: rows.map(row => {
    const snapshot = readSequence(database, row.sequence_id, now)!; const sequence = snapshot.sequence;
    return { sequenceId: sequence.sequenceId, name: sequence.name, revision: sequence.revision,
      canonicalDigest: snapshot.canonicalDigest, durationMs: sequenceDuration(sequence), viewport: sequence.viewport,
      clipCount: sequence.clips.length };
  }) };
}
export function verifySequences(database: DatabaseSync): void {
  const exists = database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sequences'").get();
  if (!exists) return;
  const revisions = database.prepare('SELECT * FROM sequence_revisions').all() as Array<SequenceRow & { sequence_id: string }>;
  for (const row of revisions) {
    const sequence = sequenceDocumentSchema.parse(JSON.parse(row.canonical_json));
    if (sequence.sequenceId !== row.sequence_id || sequence.revision !== row.revision
      || sequenceDigest(sequence) !== row.canonical_digest || canonicalJson(sequence) !== row.canonical_json)
      throw new Error('SEQUENCE_REVISION_INVALID');
    for (const prior of [...sequenceHistory(row.undo_json), ...sequenceHistory(row.redo_json)]) {
      if (prior.sequenceId !== sequence.sequenceId || prior.projectId !== sequence.projectId)
        throw new Error('SEQUENCE_HISTORY_INVALID');
      const accepted = database.prepare('SELECT canonical_json FROM sequence_revisions WHERE sequence_id=? AND revision=?')
        .get(prior.sequenceId, prior.revision) as { canonical_json: string } | undefined;
      if (!accepted || canonicalJson(prior) !== accepted.canonical_json) throw new Error('SEQUENCE_HISTORY_INVALID');
    }
  }
  const missing = database.prepare(`SELECT 1 FROM sequences s LEFT JOIN sequence_revisions r
    ON r.sequence_id=s.sequence_id AND r.revision=s.head_revision WHERE r.sequence_id IS NULL`).get();
  if (missing) throw new Error('SEQUENCE_HEAD_MISSING');
}
