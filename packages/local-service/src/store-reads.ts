import { chmodSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { canonicalBytes, canonicalJson, projectWorkspace, sha256Hex, type AuthoringState } from '../../domain/src/index.ts';
import { MAIN_BRANCH_ID, type ActiveClaimList, type ActivityPage, type BranchList, type MotionCommand } from '../../motion-protocol/src/index.ts';
import type { HeadRow } from './sqlite-project-store.js';

export abstract class SqliteProjectStoreBase {
  readonly database: DatabaseSync;
  readonly path: string;

  constructor(path: string) {
    this.path = path;
    this.database = new DatabaseSync(path);
  }

  protected abstract reconstructAuthoringState(documentId: string, headRevision: number): AuthoringState;
  readHead(documentId: string, branchId: string = MAIN_BRANCH_ID) { const row = this.readHeadRow(documentId, branchId);
    return row ? { document: JSON.parse(row.json), canonicalDigest: row.digest } : null; }
  readRevision(documentId: string, revision: number) { const row = this.database.prepare(
    'SELECT canonical_json,canonical_digest FROM revisions WHERE document_id=? AND revision=?').get(documentId, revision) as
    { canonical_json: string; canonical_digest: string } | undefined;
    return row ? { document: JSON.parse(row.canonical_json), canonicalDigest: row.canonical_digest } : null; }
  readEvents(documentId: string, afterCommitSeq: number) {
    const rows = this.database.prepare(`SELECT commit_seq,branch_id,resulting_revision,kind,request_digest,actor_kind,actor_id,affected_ids_json FROM events
      WHERE document_id=? AND commit_seq>? ORDER BY commit_seq`).all(documentId, afterCommitSeq) as Array<{
        commit_seq: number; branch_id: string; resulting_revision: number; kind: MotionCommand['command']['kind'];
        request_digest: string; actor_kind: 'human' | 'agent' | null; actor_id: string | null; affected_ids_json: string | null }>;
    return rows.map((row) => {
      const revision = this.readRevision(documentId, row.resulting_revision) ?? this.readHead(documentId, row.branch_id);
      if (!revision) throw new Error('EVENT_REVISION_MISSING');
      return { documentId, branchId: row.branch_id, revision: row.resulting_revision,
        digest: revision.canonicalDigest, kind: row.kind, commitSeq: row.commit_seq, operationDigest: row.request_digest,
        actor: row.actor_kind ? { kind: row.actor_kind, actorId: row.actor_id } : { kind: 'legacy-unknown' as const, actorId: null },
        affectedIds: row.affected_ids_json ? JSON.parse(row.affected_ids_json) as string[] : [] };
    });
  }
  readWorkspace(documentId: string, branchId: string) { const head = this.readHeadRow(documentId, branchId); if (!head) return null;
    const state = this.reconstructAuthoringState(documentId, head.revision);
    return projectWorkspace(state.document, branchId, { undoAvailable: state.undo.length > 0, redoAvailable: state.redo.length > 0 }); }
  listBranches(documentId: string): BranchList | null { const exists = this.database.prepare('SELECT 1 ok FROM documents WHERE document_id=?').get(documentId);
    if (!exists) return null; const rows = this.database.prepare(`SELECT b.branch_id,b.base_revision,b.head_revision,r.canonical_digest
      FROM branches b JOIN revisions r ON r.document_id=b.document_id AND r.revision=b.head_revision
      WHERE b.document_id=? ORDER BY b.branch_id`).all(documentId) as Array<{ branch_id: string; base_revision: number;
        head_revision: number; canonical_digest: string }>;
    return { schemaVersion: 'motion.branch-list.v1', documentId, branches: rows.map((row) => ({ branchId: row.branch_id,
      baseRevision: row.base_revision, headRevision: row.head_revision, headDigest: row.canonical_digest })) }; }
  listActiveClaims(documentId: string, now: number): ActiveClaimList | null { const exists = this.database.prepare('SELECT 1 ok FROM documents WHERE document_id=?').get(documentId);
    if (!exists) return null; const rows = this.database.prepare(`SELECT claim_id,branch_id,lease_version,expires_at,actor_id FROM claims
      WHERE document_id=? AND active=1 AND expires_at>? ORDER BY claim_id`).all(documentId, now) as Array<{ claim_id: string;
        branch_id: string | null; lease_version: number; expires_at: number; actor_id: string | null }>;
    return { schemaVersion: 'motion.active-claim-list.v1', documentId, claims: rows.map((row) => ({ claimId: row.claim_id,
      scope: row.branch_id === null ? 'document' : 'branch', branchId: row.branch_id,
      holder: row.actor_id ? { kind: 'agent' as const, actorId: row.actor_id }
        : { kind: 'legacy-unknown' as const, actorId: null },
      leaseVersion: row.lease_version, expiresAt: row.expires_at })) }; }
  listActivity(documentId: string, afterCommitSeq: number, limit: number): ActivityPage | null {
    if (!this.database.prepare('SELECT 1 ok FROM documents WHERE document_id=?').get(documentId)) return null;
    const events = this.readEvents(documentId, afterCommitSeq).slice(0, limit);
    const more = events.length === limit && Boolean(this.database.prepare('SELECT 1 ok FROM events WHERE document_id=? AND commit_seq>?')
      .get(documentId, events.at(-1)?.commitSeq ?? afterCommitSeq));
    return { schemaVersion: 'motion.activity-page.v1', documentId, afterCommitSeq, events,
      nextAfterCommitSeq: more ? events.at(-1)!.commitSeq : null };
  }
  readDocumentRevision(documentId: string): { revision: number; canonicalDigest: string } | null {
    try { const row = this.readLastRevision(documentId); return { revision: row.revision, canonicalDigest: row.digest }; }
    catch { return null; }
  }
  snapshot(): unknown { const tables = ['documents', 'branches', 'revisions', 'events', 'claims'] as const;
    return { ...Object.fromEntries(tables.map((table) => [table, this.database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])),
      review_annotations: this.database.prepare(`SELECT annotation_id,document_id,branch_id,anchor_revision,version,state
        FROM review_annotations ORDER BY rowid`).all(),
      review_events: this.database.prepare(`SELECT review_seq,event_id,document_id,branch_id,operation_id,annotation_id,
        annotation_version,kind,sanitized_response_json,actor_kind,actor_id FROM review_events ORDER BY rowid`).all(),
      annotation_snapshots: this.database.prepare(`SELECT snapshot_version,document_id,branch_id,bound_revision,private_digest
        FROM annotation_snapshots ORDER BY rowid`).all(),
      review_handoffs: this.database.prepare(`SELECT handoff_id,document_id,operation_id,sanitized_response_json
        FROM review_handoffs ORDER BY rowid`).all() }; }
  backup(destinationPath: string): void { if (destinationPath === this.path) throw new Error('BACKUP_PATH_INVALID');
    rmSync(destinationPath, { force: true }); this.database.prepare('VACUUM INTO ?').run(destinationPath); chmodSync(destinationPath, 0o600); }
  close(): void { this.database.close(); }
  runtimePragmas(): { journalMode: string; synchronous: number; foreignKeys: number } {
    const journalMode = (this.database.prepare('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode;
    const synchronous = (this.database.prepare('PRAGMA synchronous').get() as { synchronous: number }).synchronous;
    const foreignKeys = (this.database.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number }).foreign_keys;
    return { journalMode, synchronous, foreignKeys };
  }
  proveForeignKeyRefusal(): void {
    const before = this.snapshot(); this.database.exec('BEGIN IMMEDIATE'); let refused = false;
    try { this.database.prepare('INSERT INTO branches(document_id,branch_id,head_revision,base_revision) VALUES(?,?,?,?)')
      .run('missing-document', 'invalid', 0, 0); }
    catch { refused = true; }
    finally { if (this.database.isTransaction) this.database.exec('ROLLBACK'); }
    if (!refused || canonicalJson(this.snapshot()) !== canonicalJson(before)) throw new Error('FOREIGN_KEY_REFUSAL_FAILED');
  }
  protected readHeadRow(documentId: string, branchId: string): HeadRow | null { const row = this.database.prepare(`SELECT b.head_revision revision,
    r.canonical_json json,r.canonical_digest digest FROM branches b JOIN revisions r ON r.document_id=b.document_id
    AND r.revision=b.head_revision WHERE b.document_id=? AND b.branch_id=?`).get(documentId, branchId) as HeadRow | undefined; return row ?? null; }
  protected readLastRevision(documentId: string): Pick<HeadRow, 'revision' | 'digest'> { const row = this.database.prepare(`SELECT d.last_revision revision,
    r.canonical_digest digest FROM documents d JOIN revisions r ON r.document_id=d.document_id AND r.revision=d.last_revision
    WHERE d.document_id=?`).get(documentId) as Pick<HeadRow, 'revision' | 'digest'> | undefined;
    if (!row) throw new Error('DOCUMENT_REVISION_MISSING'); return row; }
  protected eventFor(documentId: string, operationId: string) { const row = this.database.prepare(
    'SELECT commit_seq,branch_id,resulting_revision,kind,request_digest,actor_kind,actor_id,affected_ids_json FROM events WHERE document_id=? AND operation_id=?').get(documentId, operationId) as
    { commit_seq: number; branch_id: string; resulting_revision: number; kind: MotionCommand['command']['kind']; request_digest: string;
      actor_kind: 'human' | 'agent' | null; actor_id: string | null; affected_ids_json: string | null };
    const revision = this.readRevision(documentId, row.resulting_revision) ?? this.readHead(documentId, row.branch_id)!;
    return { documentId, branchId: row.branch_id, revision: row.resulting_revision, digest: revision.canonicalDigest,
      kind: row.kind, commitSeq: row.commit_seq, operationDigest: row.request_digest,
      actor: row.actor_kind ? { kind: row.actor_kind, actorId: row.actor_id } : { kind: 'legacy-unknown' as const, actorId: null },
      affectedIds: row.affected_ids_json ? JSON.parse(row.affected_ids_json) as string[] : [] }; }
  protected verifyPreMigration(): void {
    const integrity = this.database.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    const foreign = this.database.prepare('PRAGMA foreign_key_check').all(); if (integrity.integrity_check !== 'ok' || foreign.length)
      throw new Error('STORE_INTEGRITY_FAILED');
    const hasRevisions = this.database.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='revisions'").get();
    if (!hasRevisions) return;
    const revisions = this.database.prepare('SELECT canonical_json,canonical_digest FROM revisions').all() as Array<{
      canonical_json: string; canonical_digest: string }>;
    for (const row of revisions) {
      try { if (sha256Hex(canonicalBytes(JSON.parse(row.canonical_json))) !== row.canonical_digest)
        throw new Error('STORE_DIGEST_MISMATCH'); }
      catch (error) { if (error instanceof Error && error.message === 'STORE_DIGEST_MISMATCH') throw error;
        throw new Error('STORE_DIGEST_MISMATCH'); }
    }
    const hasBranches = this.database.prepare("SELECT 1 ok FROM sqlite_master WHERE type='table' AND name='branches'").get();
    if (!hasBranches) return;
    const heads = this.database.prepare(`SELECT r.canonical_json,r.canonical_digest FROM branches b
      LEFT JOIN revisions r ON r.document_id=b.document_id AND r.revision=b.head_revision`).all() as Array<{
        canonical_json: string | null; canonical_digest: string | null }>;
    for (const row of heads) {
      if (row.canonical_json === null || row.canonical_digest === null) throw new Error('STORE_BRANCH_HEAD_MISSING');
      if (sha256Hex(canonicalBytes(JSON.parse(row.canonical_json))) !== row.canonical_digest) throw new Error('STORE_DIGEST_MISMATCH');
    }
  }
  protected verify(): void { this.verifyPreMigration(); }
}
