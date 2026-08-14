import { chmodSync, existsSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { canonicalBytes, canonicalJson, createAuthoringState, dispatchAuthoringOperation, sha256Hex,
  validateMotionDocument, type MotionDocument } from '../../domain/src/index.ts';
import { MAIN_BRANCH_ID, PROTOCOL_VERSION, canonicalResponseBytes, type CommandSuccess, type ControlReceipt,
  type MotionCommand, type RevisionReceipt } from '../../motion-protocol/src/index.ts';
import type { AuthContext, CommitResult, ProjectStore } from '../../project-store/src/index.ts';
import { MIGRATIONS } from './migrations.ts';

export type FaultPoint = 'after-begin' | 'after-inserts' | 'before-commit' | 'after-commit';
type HeadRow = { revision: number; json: string; digest: string };
type ClaimRow = { claim_id: string; document_id: string; branch_id: string | null; token_hash: string;
  lease_version: number; expires_at: number; active: number };

export class SqliteProjectStore implements ProjectStore {
  readonly database: DatabaseSync; readonly path: string;
  constructor(path: string, private readonly fault?: (point: FaultPoint) => void) {
    this.path = path; this.database = new DatabaseSync(path); if (path !== ':memory:') chmodSync(path, 0o600);
    this.database.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;'); this.migrate();
  }
  private migrate(): void {
    this.database.exec('CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_order INTEGER NOT NULL UNIQUE)');
    const newest = this.database.prepare('SELECT MAX(version) version FROM schema_migrations').get() as { version: number | null };
    const supported = MIGRATIONS.at(-1)?.version ?? 0; if (newest.version !== null && newest.version > supported) throw new Error('UNSUPPORTED_SCHEMA_VERSION');
    for (const migration of MIGRATIONS) {
      const row = this.database.prepare('SELECT checksum FROM schema_migrations WHERE version=?').get(migration.version) as { checksum: string } | undefined;
      if (row) { if (row.checksum !== migration.checksum) throw new Error('MIGRATION_CHECKSUM_MISMATCH'); continue; }
      if (this.path !== ':memory:' && existsSync(this.path)) this.backup(`${this.path}.backup-v${migration.version}`);
      this.database.exec('BEGIN IMMEDIATE'); try { this.database.exec(migration.sql);
        this.database.prepare('INSERT INTO schema_migrations(version,checksum,applied_order) VALUES(?,?,?)')
          .run(migration.version, migration.checksum, migration.version); this.database.exec('COMMIT');
      } catch (error) { this.database.exec('ROLLBACK'); throw error; }
    }
  }
  initialize(seed: MotionDocument): void {
    if (!validateMotionDocument(seed).ok) throw new Error('SEED_INVALID');
    const existing = this.database.prepare('SELECT document_id FROM documents').all() as Array<{ document_id: string }>;
    if (existing.length) { if (existing.length !== 1 || existing[0]!.document_id !== seed.documentId) throw new Error('STORE_DOCUMENT_MISMATCH');
      this.verify(); return; }
    const json = canonicalJson(seed); const digest = sha256Hex(canonicalBytes(seed)); this.database.exec('BEGIN IMMEDIATE');
    try { this.database.prepare('INSERT INTO documents(document_id,last_revision) VALUES(?,?)').run(seed.documentId, seed.revision);
      this.database.prepare('INSERT INTO revisions(document_id,revision,parent_revision,canonical_json,canonical_digest,creating_event_id) VALUES(?,?,?,?,?,NULL)')
        .run(seed.documentId, seed.revision, null, json, digest);
      this.database.prepare('INSERT INTO branches(document_id,branch_id,head_revision,base_revision) VALUES(?,?,?,?)')
        .run(seed.documentId, MAIN_BRANCH_ID, seed.revision, seed.revision); this.database.exec('COMMIT');
    } catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  compareAndCommit(command: MotionCommand, auth: AuthContext = { actor: 'human', capability: 'human-editor', now: Date.now() }): CommitResult {
    return this.execute(command, auth);
  }
  execute(command: MotionCommand, auth: AuthContext): CommitResult {
    const publicDigest = sha256Hex(canonicalJson(command));
    const privateDigest = sha256Hex(`${auth.actor}\0${auth.capability}\0${auth.claimSecret ?? ''}`);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.fault?.('after-begin');
      const prior = this.database.prepare('SELECT request_digest,private_context_digest,private_payload_json,sanitized_receipt_json FROM events WHERE document_id=? AND operation_id=?')
        .get(command.documentId, command.operationId) as { request_digest: string; private_context_digest: string;
          private_payload_json: string; sanitized_receipt_json: string } | undefined;
      if (prior) { this.database.exec('ROLLBACK'); return prior.request_digest === publicDigest
        && prior.private_context_digest === privateDigest && prior.private_payload_json === canonicalJson(command.command)
        ? { response: JSON.parse(prior.sanitized_receipt_json) as CommandSuccess,
          event: this.eventFor(command.documentId, command.operationId), replayed: true }
        : { response: { ok: false, code: 'OPERATION_ID_CONFLICT' } }; }
      const result = command.command.kind === 'motion.track.create'
        ? this.author(command, auth, publicDigest, privateDigest)
        : this.control(command, auth, publicDigest, privateDigest);
      if (!('event' in result)) { this.database.exec('ROLLBACK'); return result; }
      this.fault?.('before-commit'); this.database.exec('COMMIT'); this.fault?.('after-commit'); return result;
    } catch (error) { if (this.database.isTransaction) this.database.exec('ROLLBACK'); throw error; }
  }
  private author(command: MotionCommand, auth: AuthContext, publicDigest: string, privateDigest: string): CommitResult {
    if (command.command.kind !== 'motion.track.create') throw new Error('AUTHOR_KIND');
    const head = this.readHeadRow(command.documentId, command.branchId); if (!head) return { response: { ok: false, code: 'VALIDATION' } };
    if (head.revision !== command.expectedRevision) return { response: { ok: false, code: 'STALE_REVISION',
      currentRevision: head.revision, currentDigest: head.digest } };
    if (auth.actor === 'agent' && !this.authorizedClaim(command.documentId, command.branchId, auth))
      return { response: { ok: false, code: 'UNAUTHORIZED_CLAIM' } };
    const last = (this.database.prepare('SELECT last_revision FROM documents WHERE document_id=?').get(command.documentId) as { last_revision: number }).last_revision;
    if (last >= Number.MAX_SAFE_INTEGER) return { response: { ok: false, code: 'VALIDATION' } };
    const nextRevision = last + 1; const reduced = dispatchAuthoringOperation(createAuthoringState(JSON.parse(head.json)), command.command, nextRevision);
    if (!reduced.ok) return { response: { ok: false, code: 'VALIDATION' } };
    const next = reduced.state.document; const canonical = canonicalJson(next); const canonicalDigest = sha256Hex(canonicalBytes(next));
    const receipt: RevisionReceipt = { schemaVersion: 'motion.revision-receipt.v1', protocolVersion: PROTOCOL_VERSION,
      documentId: command.documentId, branchId: command.branchId, expectedRevision: command.expectedRevision,
      resultingRevision: nextRevision, operationDigest: publicDigest, canonicalDigest,
      inventory: { ruleCount: next.inventory.ruleCount, applicationCount: next.inventory.applicationCount,
        slotCount: next.inventory.slotCount, trackCount: next.inventory.trackCount } };
    const response: CommandSuccess = { ok: true, protocolVersion: PROTOCOL_VERSION, operationId: command.operationId,
      documentId: command.documentId, branchId: command.branchId, expectedRevision: command.expectedRevision,
      resultingRevision: nextRevision, operationDigest: publicDigest, canonicalDigest, receipt };
    const eventId = this.eventId(command); this.insertEvent(eventId, command, nextRevision, publicDigest, privateDigest, response);
    this.database.prepare('INSERT INTO revisions(document_id,revision,parent_revision,canonical_json,canonical_digest,creating_event_id) VALUES(?,?,?,?,?,?)')
      .run(command.documentId, nextRevision, head.revision, canonical, canonicalDigest, eventId); this.fault?.('after-inserts');
    const branch = this.database.prepare('UPDATE branches SET head_revision=? WHERE document_id=? AND branch_id=? AND head_revision=?')
      .run(nextRevision, command.documentId, command.branchId, head.revision);
    const doc = this.database.prepare('UPDATE documents SET last_revision=? WHERE document_id=? AND last_revision=?')
      .run(nextRevision, command.documentId, last);
    if (branch.changes !== 1 || doc.changes !== 1) throw new Error('REVISION_COMPARE_AND_SWAP_FAILED');
    return { response, event: this.eventFor(command.documentId, command.operationId), replayed: false };
  }
  private control(command: MotionCommand, auth: AuthContext, publicDigest: string, privateDigest: string): CommitResult {
    const operation = command.command; if (operation.kind === 'motion.track.create') throw new Error('CONTROL_KIND');
    if (operation.kind === 'motion.branch.create' && auth.actor !== 'human') return { response: { ok: false, code: 'UNAUTHORIZED_CLAIM' } };
    if ((operation.kind === 'motion.claim.acquire' || operation.kind === 'motion.claim.renew' || operation.kind === 'motion.claim.release')
      && auth.actor !== 'agent') return { response: { ok: false, code: 'UNAUTHORIZED_CLAIM' } };
    if (operation.kind === 'motion.claim.revoke' && auth.actor !== 'human') return { response: { ok: false, code: 'UNAUTHORIZED_CLAIM' } };
    const head = this.readHeadRow(command.documentId, command.branchId); if (!head) return { response: { ok: false, code: 'VALIDATION' } };
    let applicableRevision = head.revision; let applicableDigest = head.digest; let claim: ClaimRow | undefined;
    if (operation.kind === 'motion.claim.renew' || operation.kind === 'motion.claim.release' || operation.kind === 'motion.claim.revoke') {
      claim = this.database.prepare('SELECT * FROM claims WHERE claim_id=? AND document_id=?').get(operation.payload.claimId, command.documentId) as ClaimRow | undefined;
      if (!claim) return { response: { ok: false, code: 'UNAUTHORIZED_CLAIM' } };
      if (claim.branch_id === null) ({ revision: applicableRevision, digest: applicableDigest } = this.readLastRevision(command.documentId));
    } else if (operation.kind === 'motion.claim.acquire' && operation.payload.scope === 'document') {
      ({ revision: applicableRevision, digest: applicableDigest } = this.readLastRevision(command.documentId));
    }
    if (applicableRevision !== command.expectedRevision) return { response: { ok: false, code: 'STALE_REVISION',
      currentRevision: applicableRevision, currentDigest: applicableDigest } };
    let claimId: string | undefined; let leaseVersion: number | undefined; let expiresAt: number | undefined;
    if (operation.kind === 'motion.branch.create') {
      const exists = this.database.prepare('SELECT 1 ok FROM branches WHERE document_id=? AND branch_id=?')
        .get(command.documentId, operation.payload.branchId); if (exists) return { response: { ok: false, code: 'VALIDATION' } };
      this.database.prepare('INSERT INTO branches(document_id,branch_id,head_revision,base_revision) VALUES(?,?,?,?)')
        .run(command.documentId, operation.payload.branchId, head.revision, head.revision);
    } else if (operation.kind === 'motion.claim.acquire') {
      if (!auth.claimSecret || auth.claimSecret.length < 32) return { response: { ok: false, code: 'UNAUTHORIZED_CLAIM' } };
      const targetBranch = operation.payload.scope === 'branch' ? operation.payload.branchId : null;
      const overlap = this.database.prepare(`SELECT 1 ok FROM claims WHERE document_id=? AND active=1 AND expires_at>?
        AND (branch_id IS NULL OR ? IS NULL OR branch_id=?) LIMIT 1`).get(command.documentId, auth.now, targetBranch, targetBranch);
      if (overlap) return { response: { ok: false, code: 'UNAUTHORIZED_CLAIM' } };
      claimId = `claim_${sha256Hex(`${command.documentId}\0${command.operationId}\0${privateDigest}`).slice(0, 24)}`;
      leaseVersion = 1; expiresAt = auth.now + 60_000;
      this.database.prepare('INSERT INTO claims(claim_id,document_id,branch_id,token_hash,holder_kind,lease_version,expires_at,active) VALUES(?,?,?,?,?,?,?,1)')
        .run(claimId, command.documentId, targetBranch, sha256Hex(auth.claimSecret), 'agent', leaseVersion, expiresAt);
    } else {
      if (!claim || !claim.active || claim.expires_at <= auth.now || claim.lease_version !== operation.payload.leaseVersion)
        return { response: { ok: false, code: 'UNAUTHORIZED_CLAIM' } };
      if (claim.branch_id !== null && claim.branch_id !== command.branchId) return { response: { ok: false, code: 'UNAUTHORIZED_CLAIM' } };
      if (operation.kind !== 'motion.claim.revoke' && (!auth.claimSecret || sha256Hex(auth.claimSecret) !== claim.token_hash))
        return { response: { ok: false, code: 'UNAUTHORIZED_CLAIM' } };
      claimId = claim.claim_id; leaseVersion = claim.lease_version + 1;
      if (operation.kind === 'motion.claim.renew') { expiresAt = auth.now + 60_000;
        this.database.prepare('UPDATE claims SET lease_version=?,expires_at=? WHERE claim_id=? AND lease_version=?')
          .run(leaseVersion, expiresAt, claimId, claim.lease_version);
      } else this.database.prepare('UPDATE claims SET lease_version=?,active=0 WHERE claim_id=? AND lease_version=?')
        .run(leaseVersion, claimId, claim.lease_version);
    }
    const resultingRevision = head.revision; const receipt: ControlReceipt = { schemaVersion: 'motion.control-receipt.v1',
      protocolVersion: PROTOCOL_VERSION, kind: operation.kind, documentId: command.documentId, branchId: command.branchId,
      expectedRevision: command.expectedRevision, resultingRevision, operationDigest: publicDigest,
      ...(claimId ? { claimId } : {}), ...(leaseVersion ? { leaseVersion } : {}) };
    const response: CommandSuccess = { ok: true, protocolVersion: PROTOCOL_VERSION, operationId: command.operationId,
      documentId: command.documentId, branchId: command.branchId, expectedRevision: command.expectedRevision,
      resultingRevision, operationDigest: publicDigest, ...(claimId ? { claimId } : {}),
      ...(leaseVersion ? { leaseVersion } : {}), ...(expiresAt ? { expiresAt } : {}), receipt };
    this.insertEvent(this.eventId(command), command, resultingRevision, publicDigest, privateDigest, response); this.fault?.('after-inserts');
    return { response, event: this.eventFor(command.documentId, command.operationId), replayed: false };
  }
  private authorizedClaim(documentId: string, branchId: string, auth: AuthContext): boolean {
    if (!auth.claimSecret) return false; const tokenHash = sha256Hex(auth.claimSecret);
    return Boolean(this.database.prepare(`SELECT 1 ok FROM claims WHERE document_id=? AND active=1 AND expires_at>?
      AND token_hash=? AND (branch_id IS NULL OR branch_id=?) LIMIT 1`).get(documentId, auth.now, tokenHash, branchId));
  }
  private insertEvent(eventId: string, command: MotionCommand, resultingRevision: number, requestDigest: string,
    privateDigest: string, response: CommandSuccess): void {
    this.database.prepare(`INSERT INTO events(event_id,document_id,branch_id,kind,operation_id,expected_revision,resulting_revision,
      request_digest,private_context_digest,private_payload_json,sanitized_receipt_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(eventId, command.documentId, command.branchId, command.command.kind, command.operationId, command.expectedRevision,
        resultingRevision, requestDigest, privateDigest, canonicalJson(command.command), canonicalResponseBytes(response));
  }
  private eventId(command: MotionCommand): string { return `event_${sha256Hex(`${command.documentId}\0${command.operationId}`).slice(0, 24)}`; }
  readHead(documentId: string, branchId: string = MAIN_BRANCH_ID) { const row = this.readHeadRow(documentId, branchId);
    return row ? { document: JSON.parse(row.json), canonicalDigest: row.digest } : null; }
  readRevision(documentId: string, revision: number) { const row = this.database.prepare(
    'SELECT canonical_json,canonical_digest FROM revisions WHERE document_id=? AND revision=?').get(documentId, revision) as
    { canonical_json: string; canonical_digest: string } | undefined;
    return row ? { document: JSON.parse(row.canonical_json), canonicalDigest: row.canonical_digest } : null; }
  readDocumentRevision(documentId: string): { revision: number; canonicalDigest: string } | null {
    try { const row = this.readLastRevision(documentId); return { revision: row.revision, canonicalDigest: row.digest }; }
    catch { return null; }
  }
  snapshot(): unknown { const tables = ['documents', 'branches', 'revisions', 'events', 'claims'] as const;
    return Object.fromEntries(tables.map((table) => [table, this.database.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all()])); }
  backup(destinationPath: string): void { if (destinationPath === this.path) throw new Error('BACKUP_PATH_INVALID');
    rmSync(destinationPath, { force: true }); this.database.prepare('VACUUM INTO ?').run(destinationPath); chmodSync(destinationPath, 0o600); }
  close(): void { this.database.close(); }
  private readHeadRow(documentId: string, branchId: string): HeadRow | null { const row = this.database.prepare(`SELECT b.head_revision revision,
    r.canonical_json json,r.canonical_digest digest FROM branches b JOIN revisions r ON r.document_id=b.document_id
    AND r.revision=b.head_revision WHERE b.document_id=? AND b.branch_id=?`).get(documentId, branchId) as HeadRow | undefined; return row ?? null; }
  private readLastRevision(documentId: string): Pick<HeadRow, 'revision' | 'digest'> { const row = this.database.prepare(`SELECT d.last_revision revision,
    r.canonical_digest digest FROM documents d JOIN revisions r ON r.document_id=d.document_id AND r.revision=d.last_revision
    WHERE d.document_id=?`).get(documentId) as Pick<HeadRow, 'revision' | 'digest'> | undefined;
    if (!row) throw new Error('DOCUMENT_REVISION_MISSING'); return row; }
  private eventFor(documentId: string, operationId: string) { const row = this.database.prepare(
    'SELECT commit_seq,branch_id,resulting_revision,kind FROM events WHERE document_id=? AND operation_id=?').get(documentId, operationId) as
    { commit_seq: number; branch_id: string; resulting_revision: number; kind: MotionCommand['command']['kind'] };
    const revision = this.readRevision(documentId, row.resulting_revision) ?? this.readHead(documentId, row.branch_id)!;
    return { documentId, branchId: row.branch_id, revision: row.resulting_revision, digest: revision.canonicalDigest,
      kind: row.kind, commitSeq: row.commit_seq }; }
  private verify(): void { const integrity = this.database.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    const foreign = this.database.prepare('PRAGMA foreign_key_check').all(); if (integrity.integrity_check !== 'ok' || foreign.length)
      throw new Error('STORE_INTEGRITY_FAILED'); const heads = this.database.prepare(`SELECT r.canonical_json,r.canonical_digest FROM branches b
      JOIN revisions r ON r.document_id=b.document_id AND r.revision=b.head_revision`).all() as Array<{ canonical_json: string; canonical_digest: string }>;
    for (const row of heads) if (sha256Hex(canonicalBytes(JSON.parse(row.canonical_json))) !== row.canonical_digest) throw new Error('STORE_DIGEST_MISMATCH'); }
}

/** Synthetic migration fixture creation stays inside the sole SQLite adapter. */
export function createLegacyV1Database(path: string, seed: MotionDocument): void {
  const database = new DatabaseSync(path); try {
    database.exec('PRAGMA foreign_keys=ON;'); database.exec(MIGRATIONS[0].sql);
    database.prepare('INSERT INTO schema_migrations(version,checksum,applied_order) VALUES(1,?,1)').run(MIGRATIONS[0].checksum);
    const canonical = canonicalJson(seed); const digest = sha256Hex(canonicalBytes(seed));
    database.prepare('INSERT INTO documents(document_id,last_revision) VALUES(?,?)').run(seed.documentId, seed.revision);
    database.prepare('INSERT INTO revisions(document_id,revision,parent_revision,canonical_json,canonical_digest,creating_event_id) VALUES(?,?,?,?,?,NULL)')
      .run(seed.documentId, seed.revision, null, canonical, digest);
    database.prepare('INSERT INTO branches(document_id,branch_id,head_revision,base_revision) VALUES(?,?,?,?)')
      .run(seed.documentId, MAIN_BRANCH_ID, seed.revision, seed.revision);
  } finally { database.close(); chmodSync(path, 0o600); }
}
