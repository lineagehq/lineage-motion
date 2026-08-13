import { chmodSync, existsSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { canonicalBytes, canonicalJson, createAuthoringState, dispatchAuthoringOperation, sha256Hex,
  validateMotionDocument, type MotionDocument } from '../../domain/src/index.ts';
import { MAIN_BRANCH_ID, PROTOCOL_VERSION, canonicalResponseBytes,
  type CommandSuccess, type MotionCommand, type RevisionReceipt } from '../../motion-protocol/src/index.ts';
import type { CommitResult, ProjectStore } from '../../project-store/src/index.ts';
import { MIGRATIONS } from './migrations.ts';

export type FaultPoint = 'after-begin' | 'after-inserts' | 'before-commit' | 'after-commit';

export class SqliteProjectStore implements ProjectStore {
  readonly database: DatabaseSync;
  readonly path: string;
  private readonly fault: ((point: FaultPoint) => void) | undefined;
  constructor(path: string, fault?: (point: FaultPoint) => void) {
    this.path = path; this.fault = fault;
    this.database = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.database.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
    this.migrate();
  }
  private migrate(): void {
    this.database.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_order INTEGER NOT NULL UNIQUE)');
    for (const migration of MIGRATIONS) {
      const row = this.database.prepare('SELECT checksum FROM schema_migrations WHERE version=?').get(migration.version) as { checksum: string } | undefined;
      if (row) { if (row.checksum !== migration.checksum) throw new Error('MIGRATION_CHECKSUM_MISMATCH'); continue; }
      if (this.path !== ':memory:' && existsSync(this.path)) this.backup(`${this.path}.backup-v${migration.version}`);
      this.database.exec('BEGIN IMMEDIATE');
      try {
        this.database.exec(migration.sql);
        this.database.prepare('INSERT INTO schema_migrations(version,checksum,applied_order) VALUES(?,?,?)')
          .run(migration.version, migration.checksum, migration.version);
        this.database.exec('COMMIT');
      } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    }
  }
  initialize(seed: MotionDocument): void {
    const valid = validateMotionDocument(seed); if (!valid.ok) throw new Error('SEED_INVALID');
    const existing = this.database.prepare('SELECT document_id FROM documents').all() as Array<{ document_id: string }>;
    if (existing.length) {
      if (existing.length !== 1 || existing[0]!.document_id !== seed.documentId) throw new Error('STORE_DOCUMENT_MISMATCH');
      this.verify(); return;
    }
    const json = canonicalJson(seed); const digest = sha256Hex(canonicalBytes(seed));
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.database.prepare('INSERT INTO documents(document_id,last_revision) VALUES(?,?)').run(seed.documentId, seed.revision);
      this.database.prepare('INSERT INTO revisions(document_id,revision,parent_revision,canonical_json,canonical_digest,creating_event_id) VALUES(?,?,?,?,?,NULL)')
        .run(seed.documentId, seed.revision, null, json, digest);
      this.database.prepare('INSERT INTO branches(document_id,branch_id,head_revision,base_revision) VALUES(?,?,?,?)')
        .run(seed.documentId, MAIN_BRANCH_ID, seed.revision, seed.revision);
      this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  compareAndCommit(command: MotionCommand): CommitResult {
    const requestDigest = sha256Hex(canonicalJson(command));
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.fault?.('after-begin');
      const prior = this.database.prepare('SELECT request_digest,sanitized_receipt_json FROM events WHERE document_id=? AND operation_id=?')
        .get(command.documentId, command.operationId) as { request_digest: string; sanitized_receipt_json: string } | undefined;
      if (prior) {
        this.database.exec('ROLLBACK');
        return prior.request_digest === requestDigest
          ? { response: JSON.parse(prior.sanitized_receipt_json) as CommandSuccess,
            event: this.eventFor(command.documentId, command.operationId), replayed: true }
          : { response: { ok: false, code: 'OPERATION_ID_CONFLICT' } };
      }
      const head = this.readHeadRow(command.documentId);
      if (!head) { this.database.exec('ROLLBACK'); return { response: { ok: false, code: 'VALIDATION' } }; }
      if (head.revision !== command.expectedRevision) {
        this.database.exec('ROLLBACK'); return { response: { ok: false, code: 'STALE_REVISION',
          currentRevision: head.revision, currentDigest: head.digest } };
      }
      const current = JSON.parse(head.json) as MotionDocument;
      const reduced = dispatchAuthoringOperation(createAuthoringState(current), command.command);
      if (!reduced.ok) { this.database.exec('ROLLBACK'); return { response: { ok: false, code: 'VALIDATION' } }; }
      const next = reduced.state.document;
      const canonical = canonicalJson(next); const canonicalDigest = sha256Hex(canonicalBytes(next));
      const receipt: RevisionReceipt = { schemaVersion: 'motion.revision-receipt.v1', protocolVersion: PROTOCOL_VERSION,
        documentId: command.documentId, branchId: MAIN_BRANCH_ID, expectedRevision: command.expectedRevision,
        resultingRevision: next.revision, operationDigest: requestDigest, canonicalDigest,
        inventory: { ruleCount: next.inventory.ruleCount, applicationCount: next.inventory.applicationCount,
          slotCount: next.inventory.slotCount, trackCount: next.inventory.trackCount } };
      const response: CommandSuccess = { ok: true, protocolVersion: PROTOCOL_VERSION, operationId: command.operationId,
        documentId: command.documentId, branchId: MAIN_BRANCH_ID, expectedRevision: command.expectedRevision,
        resultingRevision: next.revision, operationDigest: requestDigest, canonicalDigest, receipt };
      const eventId = `event_${sha256Hex(`${command.documentId}\0${command.operationId}`).slice(0, 24)}`;
      this.database.prepare(`INSERT INTO events(event_id,document_id,branch_id,kind,operation_id,expected_revision,resulting_revision,
        request_digest,private_payload_json,sanitized_receipt_json) VALUES(?,?,?,?,?,?,?,?,?,?)`)
        .run(eventId, command.documentId, MAIN_BRANCH_ID, command.command.kind, command.operationId,
          command.expectedRevision, next.revision, requestDigest, canonicalJson(command.command), canonicalResponseBytes(response));
      this.database.prepare('INSERT INTO revisions(document_id,revision,parent_revision,canonical_json,canonical_digest,creating_event_id) VALUES(?,?,?,?,?,?)')
        .run(command.documentId, next.revision, current.revision, canonical, canonicalDigest, eventId);
      this.fault?.('after-inserts');
      const changed = this.database.prepare('UPDATE branches SET head_revision=? WHERE document_id=? AND branch_id=? AND head_revision=?')
        .run(next.revision, command.documentId, MAIN_BRANCH_ID, current.revision);
      if (changed.changes !== 1) throw new Error('HEAD_COMPARE_AND_SWAP_FAILED');
      this.database.prepare('UPDATE documents SET last_revision=? WHERE document_id=? AND last_revision=?')
        .run(next.revision, command.documentId, current.revision);
      this.fault?.('before-commit'); this.database.exec('COMMIT'); this.fault?.('after-commit');
      return { response, event: this.eventFor(command.documentId, command.operationId), replayed: false };
    } catch (error) {
      if (this.database.isTransaction) this.database.exec('ROLLBACK');
      throw error;
    }
  }
  readHead(documentId: string) { const row = this.readHeadRow(documentId); return row ? { document: JSON.parse(row.json), canonicalDigest: row.digest } : null; }
  readRevision(documentId: string, revision: number) {
    const row = this.database.prepare('SELECT canonical_json,canonical_digest FROM revisions WHERE document_id=? AND revision=?')
      .get(documentId, revision) as { canonical_json: string; canonical_digest: string } | undefined;
    return row ? { document: JSON.parse(row.canonical_json), canonicalDigest: row.canonical_digest } : null;
  }
  snapshot(): unknown {
    const tables = ['documents', 'branches', 'revisions', 'events'] as const;
    return Object.fromEntries(tables.map((table) => [table, this.database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()]));
  }
  backup(destinationPath: string): void {
    if (destinationPath === this.path) throw new Error('BACKUP_PATH_INVALID');
    rmSync(destinationPath, { force: true });
    this.database.prepare('VACUUM INTO ?').run(destinationPath);
    chmodSync(destinationPath, 0o600);
  }
  close(): void { this.database.close(); }
  private readHeadRow(documentId: string): { revision: number; json: string; digest: string } | null {
    const row = this.database.prepare(`SELECT b.head_revision revision,r.canonical_json json,r.canonical_digest digest FROM branches b
      JOIN revisions r ON r.document_id=b.document_id AND r.revision=b.head_revision WHERE b.document_id=? AND b.branch_id='main'`)
      .get(documentId) as { revision: number; json: string; digest: string } | undefined;
    return row ?? null;
  }
  private eventFor(documentId: string, operationId: string) {
    const row = this.database.prepare('SELECT commit_seq,branch_id,resulting_revision,kind FROM events WHERE document_id=? AND operation_id=?')
      .get(documentId, operationId) as { commit_seq: number; branch_id: 'main'; resulting_revision: number; kind: 'motion.track.create' };
    const revision = this.readRevision(documentId, row.resulting_revision)!;
    return { documentId, branchId: row.branch_id, revision: row.resulting_revision, digest: revision.canonicalDigest,
      kind: row.kind, commitSeq: row.commit_seq };
  }
  private verify(): void {
    const integrity = this.database.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    const foreign = this.database.prepare('PRAGMA foreign_key_check').all();
    if (integrity.integrity_check !== 'ok' || foreign.length) throw new Error('STORE_INTEGRITY_FAILED');
    const heads = this.database.prepare(`SELECT r.canonical_json,r.canonical_digest FROM branches b JOIN revisions r
      ON r.document_id=b.document_id AND r.revision=b.head_revision`).all() as Array<{ canonical_json: string; canonical_digest: string }>;
    for (const row of heads) if (sha256Hex(canonicalBytes(JSON.parse(row.canonical_json))) !== row.canonical_digest) throw new Error('STORE_DIGEST_MISMATCH');
  }
}
