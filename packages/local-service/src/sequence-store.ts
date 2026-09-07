import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { sha256Hex } from '../../domain/src/sha256.ts';
import { applySequenceEdit, sequenceDigest, sequenceDocumentSchema, type SequenceDocument } from '../../domain/src/sequence.ts';
import { sequenceCommandSchema, type SequenceCommand, type SequenceFailure,
  type SequenceResponse, type SequenceReceipt } from '../../motion-protocol/src/sequence.ts';
import type { AuthContext } from '../../project-store/src/index.ts';
import { readProjectCatalog } from './project-catalog.ts';
import { readSequenceRow, sequenceHistory } from './sequence-reads.ts';
import { acquireSequenceClaim, checkSequenceWriter, controlSequenceClaim, sequenceFail } from './sequence-claims.ts';
import type { FaultPoint } from './sqlite-project-store.ts';

/** The caller's validator resolves every immutable source and compiles before writes. */
export function executeSequence(database: DatabaseSync, input: SequenceCommand, auth: AuthContext,
  validateSources: (sequence: SequenceDocument) => SequenceFailure | null,
  fault?: (point: FaultPoint) => void): SequenceResponse {
  const parsed = sequenceCommandSchema.safeParse(input);
  if (!parsed.success || !Number.isSafeInteger(auth.now) || auth.now < 0) return sequenceFail('SEQUENCE_INVALID');
  const command = parsed.data;
  const requestDigest = sha256Hex(canonicalJson(command));
  const privateDigest = sha256Hex(`${auth.actor}\0${auth.capability}\0${auth.claimSecret ?? ''}`);
  database.exec('BEGIN IMMEDIATE');
  try {
    fault?.('after-begin');
    if (readProjectCatalog(database).projectId !== command.projectId) return rollback(sequenceFail('SEQUENCE_PROJECT_MISMATCH'));
    const prior = database.prepare('SELECT * FROM sequence_operations WHERE sequence_id=? AND operation_id=?')
      .get(command.sequenceId, command.operationId) as { request_digest: string; private_context_digest: string; receipt_json: string } | undefined;
    if (prior) return rollback(prior.request_digest === requestDigest && prior.private_context_digest === privateDigest
      ? JSON.parse(prior.receipt_json) as SequenceReceipt : sequenceFail('SEQUENCE_OPERATION_CONFLICT'));
    const row = readSequenceRow(database, command.sequenceId);
    let document: SequenceDocument; let undo: SequenceDocument[] = []; let redo: SequenceDocument[] = [];
    let claim: SequenceReceipt['claim'];
    if (command.kind === 'sequence.create') {
      if (row) return rollback(sequenceFail('SEQUENCE_ALREADY_EXISTS'));
      if (command.expectedRevision !== 0) return rollback(sequenceFail('SEQUENCE_STALE_REVISION'));
      if ((auth.actor === 'agent') !== command.claim) return rollback(sequenceFail('SEQUENCE_UNAUTHORIZED'));
      document = sequenceDocumentSchema.parse({ schemaVersion: 'motion.sequence.v1', projectId: command.projectId,
        sequenceId: command.sequenceId, revision: 0, name: command.name, viewport: command.viewport,
        finalState: 'last-shot-native-end', reducedMotion: 'source-snapshots-with-hard-cuts',
        clips: command.initialClip ? [command.initialClip] : [] });
      const invalid = validateSources(document); if (invalid) return rollback(invalid);
      database.prepare('INSERT INTO sequences VALUES(?,0)').run(command.sequenceId);
      if (command.claim) {
        const acquired = acquireSequenceClaim(database, command, auth); if (!acquired.ok) return rollback(acquired);
        claim = acquired.claim;
      }
      writeRevision(document, undo, redo);
    } else {
      if (!row) return rollback(sequenceFail('SEQUENCE_NOT_FOUND'));
      if (row.revision !== command.expectedRevision) return rollback({ ...sequenceFail('SEQUENCE_STALE_REVISION'), currentRevision: row.revision });
      document = sequenceDocumentSchema.parse(JSON.parse(row.canonical_json));
      if (command.kind.startsWith('sequence.claim.')) {
        const controlled = controlSequenceClaim(database, command, auth); if (!controlled.ok) return rollback(controlled);
        claim = controlled.claim;
      } else {
        const denied = checkSequenceWriter(database, command.sequenceId, auth); if (denied) return rollback(denied);
        undo = sequenceHistory(row.undo_json); redo = sequenceHistory(row.redo_json);
        let next: SequenceDocument;
        if (command.kind === 'sequence.edit') {
          try { next = applySequenceEdit(document, command.edit); }
          catch { return rollback(sequenceFail('SEQUENCE_INVALID')); }
          undo.push(document); redo = [];
        } else if (command.kind === 'sequence.undo') {
          const previous = undo.pop(); if (!previous) return rollback(sequenceFail('SEQUENCE_HISTORY_UNAVAILABLE'));
          next = previous; redo.push(document);
        } else if (command.kind === 'sequence.redo') {
          const following = redo.pop(); if (!following) return rollback(sequenceFail('SEQUENCE_HISTORY_UNAVAILABLE'));
          next = following; undo.push(document);
        } else return rollback(sequenceFail('SEQUENCE_INVALID'));
        if (!Number.isSafeInteger(document.revision + 1)) return rollback(sequenceFail('SEQUENCE_INVALID'));
        document = { ...next, revision: document.revision + 1 };
        const invalid = validateSources(document); if (invalid) return rollback(invalid);
        writeRevision(document, undo, redo);
        database.prepare('UPDATE sequences SET head_revision=? WHERE sequence_id=?').run(document.revision, command.sequenceId);
      }
    }
    const receipt: SequenceReceipt = { ok: true, schemaVersion: 'motion.sequence-receipt.v1', operationId: command.operationId,
      projectId: command.projectId, sequenceId: command.sequenceId, revision: document.revision,
      canonicalDigest: sequenceDigest(document), ...(claim ? { claim } : {}) };
    database.prepare('INSERT INTO sequence_operations VALUES(?,?,?,?,?)')
      .run(command.sequenceId, command.operationId, requestDigest, privateDigest, canonicalJson(receipt));
    fault?.('after-inserts'); fault?.('before-commit'); database.exec('COMMIT'); fault?.('after-commit'); return receipt;
  } catch (error) { if (database.isTransaction) database.exec('ROLLBACK'); throw error; }
  function rollback(response: SequenceResponse): SequenceResponse { database.exec('ROLLBACK'); return response; }
  function writeRevision(document: SequenceDocument, undo: SequenceDocument[], redo: SequenceDocument[]): void {
    database.prepare('INSERT INTO sequence_revisions VALUES(?,?,?,?,?,?)').run(document.sequenceId, document.revision,
      canonicalJson(document), sequenceDigest(document), canonicalJson(undo), canonicalJson(redo));
  }
}
