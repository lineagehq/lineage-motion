import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { canonicalBytes, canonicalJson, createAuthoringState, dispatchAuthoringOperation, materializePreparedIntent,
  prepareOperationIntent, projectWorkspace, sha256Hex, validateMotionDocument, type AuthoringOperation,
  type AuthoringState, type MotionDocument, type OperationPreparation, type OperationPreparationRequest,
  type PreparedOperationIntent } from '../../domain/src/index.ts';
import { compileMotionDocument } from '../../css-compiler/src/index.ts';
import { MAIN_BRANCH_ID, PROTOCOL_VERSION, canonicalResponseBytes, type CommandSuccess, type ControlReceipt,
  type ActiveClaimList, type ActivityPage, type BranchList, type CommandFailure, type MotionCommand,
  type MotionDiagnostic, type RevisionReceipt } from '../../motion-protocol/src/index.ts';
import { canonicalReviewResponseBytes, reviewFailure, type AnnotationList, type ReviewCommand, type ReviewEvent,
  type ReviewFailure, type ReviewResponse, type ReviewSuccess, type RevisionComparison } from '../../motion-protocol/src/review.ts';
import { REVIEW_PROTOCOL_VERSION, REVIEW_SERIALIZER_VERSION, annotationSnapshotBytes, annotationSnapshotDigest,
  createHandoffReceipt, type AnnotationPrivateSnapshotEntry, type HandoffIdentityInput,
  type HandoffReceipt } from '../../review-domain/src/index.ts';
import type { AuthContext, CommitResult, ProjectStore } from '../../project-store/src/index.ts';
import { MIGRATIONS } from './migrations.ts';

export type FaultPoint = 'after-begin' | 'after-inserts' | 'before-commit' | 'after-commit';
type HeadRow = { revision: number; json: string; digest: string };
type ClaimRow = { claim_id: string; document_id: string; branch_id: string | null; token_hash: string;
  lease_version: number; expires_at: number; active: number; actor_id: string | null };

export class SqliteProjectStore implements ProjectStore {
  readonly database: DatabaseSync; readonly path: string;
  constructor(path: string, private readonly fault?: (point: FaultPoint) => void) {
    this.path = path; this.database = new DatabaseSync(path); if (path !== ':memory:') chmodSync(path, 0o600);
    this.database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;'); this.verifyPreMigration();
    this.database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;'); this.migrate();
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
  prepareOperation(request: OperationPreparationRequest): OperationPreparation | null {
    const head = this.readHeadRow(request.documentId, request.branchId); if (!head) return null;
    const document = JSON.parse(head.json) as MotionDocument; const compiled = compileMotionDocument(document);
    return prepareOperationIntent(document, request.branchId, head.digest, compiled.exportDigest, request).preparation;
  }
  execute(command: MotionCommand, auth: AuthContext): CommitResult {
    const publicDigest = sha256Hex(canonicalJson(command));
    const privateDigest = sha256Hex(`${auth.actor}\0${auth.capability}\0${auth.claimSecret ?? ''}`);
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.fault?.('after-begin');
      const materialized = this.materialize(command);
      if (!materialized.ok) { this.database.exec('ROLLBACK'); return { response: materialized.response }; }
      const effective = materialized.command; const privatePayload = canonicalJson(effective.command);
      const prior = this.database.prepare('SELECT request_digest,private_context_digest,private_payload_json,sanitized_receipt_json FROM events WHERE document_id=? AND operation_id=?')
        .get(command.documentId, command.operationId) as { request_digest: string; private_context_digest: string;
          private_payload_json: string; sanitized_receipt_json: string } | undefined;
      if (prior) { this.database.exec('ROLLBACK'); return prior.request_digest === publicDigest
        && prior.private_context_digest === privateDigest && prior.private_payload_json === privatePayload
        ? { response: JSON.parse(prior.sanitized_receipt_json) as CommandSuccess,
          event: this.eventFor(command.documentId, command.operationId), replayed: true }
        : { response: failure('OPERATION_ID_CONFLICT', 'OPERATION_ID_CONFLICT', 'protocol', false) }; }
      const checked = this.validateMaterialized(effective, auth);
      if (!checked.ok) { this.database.exec('ROLLBACK'); return { response: checked }; }
      const result = isAuthoringKind(effective.command.kind)
        ? this.author(effective, auth, publicDigest, privateDigest)
        : this.control(effective, auth, publicDigest, privateDigest);
      if (!('event' in result)) { this.database.exec('ROLLBACK'); return result; }
      this.fault?.('before-commit'); this.database.exec('COMMIT'); this.fault?.('after-commit'); return result;
    } catch (error) { if (this.database.isTransaction) this.database.exec('ROLLBACK'); throw error; }
  }
  executeReview(command: ReviewCommand, auth: AuthContext): { response: ReviewResponse; event?: ReviewEvent; replayed?: boolean } {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.fault?.('after-begin');
      const requestJson = canonicalJson(command);
      const head = this.readHeadRow(command.documentId, command.branchId);
      if (!head) { this.database.exec('ROLLBACK'); return { response: reviewFailure('VALIDATION', 'BRANCH_NOT_FOUND', 'target', false) }; }
      if (auth.actor === 'agent' && !this.authorizedClaim(command.documentId, command.branchId, auth)) {
        this.database.exec('ROLLBACK'); return { response: reviewFailure('UNAUTHORIZED_CLAIM',
          this.claimDiagnostic(command.documentId, command.branchId, auth)?.diagnostic.code ?? 'CLAIM_REQUIRED', 'authorization', false) }; }
      const privateContextDigest = this.reviewAuthDigest(command.documentId, command.branchId, auth);
      const prior = this.database.prepare(`SELECT private_request_json,private_context_digest,sanitized_response_json FROM review_events
        WHERE document_id=? AND operation_id=?`).get(command.documentId, command.operationId) as
        { private_request_json: string; private_context_digest: string; sanitized_response_json: string } | undefined;
      if (prior) { this.database.exec('ROLLBACK'); return prior.private_request_json === requestJson
        && prior.private_context_digest === privateContextDigest
        ? { response: JSON.parse(prior.sanitized_response_json) as ReviewSuccess,
          event: this.reviewEventFor(command.documentId, command.operationId), replayed: true }
        : { response: reviewFailure('OPERATION_ID_CONFLICT', 'OPERATION_ID_CONFLICT', 'protocol', false) }; }
      if (head.revision !== command.expectedBranchRevision) { this.database.exec('ROLLBACK'); return { response:
        reviewFailure('STALE_BRANCH_REVISION', 'STALE_BRANCH_REVISION', 'revision', true, { currentBranchRevision: head.revision }) }; }
      const row = this.database.prepare(`SELECT anchor_revision,version,state,private_body FROM review_annotations
        WHERE document_id=? AND branch_id=? AND annotation_id=?`).get(command.documentId, command.branchId, command.annotationId) as
        { anchor_revision: number; version: number; state: 'open' | 'resolved' | 'deleted'; private_body: string } | undefined;
      if (command.kind === 'review.annotation.create') {
        if (command.expectedAnnotationVersion !== 0 || row) { this.database.exec('ROLLBACK'); return { response:
          reviewFailure('STALE_ANNOTATION_VERSION', 'STALE_ANNOTATION_VERSION', 'revision', true,
            { currentAnnotationVersion: row?.version ?? 0 }) }; }
        if (!this.revisionReachable(command.documentId, head.revision, command.anchorRevision)) { this.database.exec('ROLLBACK'); return { response:
          reviewFailure('VALIDATION', 'ANCHOR_REVISION_NOT_REACHABLE', 'revision', false) }; }
        this.database.prepare(`INSERT INTO review_annotations(annotation_id,document_id,branch_id,anchor_revision,version,state,private_body)
          VALUES(?,?,?,?,1,'open',?)`).run(command.annotationId, command.documentId, command.branchId, command.anchorRevision, command.body);
      } else {
        if (!row || row.version !== command.expectedAnnotationVersion) { this.database.exec('ROLLBACK'); return { response:
          reviewFailure('STALE_ANNOTATION_VERSION', 'STALE_ANNOTATION_VERSION', 'revision', true,
            { currentAnnotationVersion: row?.version ?? 0 }) }; }
        if (row.state === 'deleted') { this.database.exec('ROLLBACK'); return { response:
          reviewFailure('VALIDATION', 'ANNOTATION_DELETED', 'domain', false) }; }
        const state = command.kind === 'review.annotation.resolve' ? 'resolved'
          : command.kind === 'review.annotation.reopen' ? 'open'
            : command.kind === 'review.annotation.delete' ? 'deleted' : row.state;
        if ((command.kind === 'review.annotation.resolve' && row.state !== 'open')
          || (command.kind === 'review.annotation.reopen' && row.state !== 'resolved')) {
          this.database.exec('ROLLBACK'); return { response: reviewFailure('VALIDATION', 'ANNOTATION_STATE_INVALID', 'domain', false) };
        }
        this.database.prepare(`UPDATE review_annotations SET version=version+1,state=?,private_body=?
          WHERE document_id=? AND branch_id=? AND annotation_id=? AND version=?`).run(state,
            command.kind === 'review.annotation.edit' ? command.body : row.private_body,
            command.documentId, command.branchId, command.annotationId, row.version);
      }
      const annotation = this.annotationProjection(command.documentId, command.branchId, command.annotationId)!;
      const response: ReviewSuccess = { ok: true, protocolVersion: REVIEW_PROTOCOL_VERSION, operationId: command.operationId,
        documentId: command.documentId, branchId: command.branchId, annotation, receipt: {
          schemaVersion: 'review.receipt.v1', protocolVersion: REVIEW_PROTOCOL_VERSION, operationId: command.operationId,
          documentId: command.documentId, branchId: command.branchId, annotationId: command.annotationId,
          annotationVersion: annotation.version, kind: command.kind } };
      const eventId = `review_event_${sha256Hex(`${command.documentId}\0${command.operationId}`).slice(0, 24)}`;
      this.database.prepare(`INSERT INTO review_events(event_id,document_id,branch_id,operation_id,annotation_id,
        annotation_version,kind,private_request_json,sanitized_response_json,actor_kind,actor_id,private_context_digest)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(eventId, command.documentId, command.branchId, command.operationId, command.annotationId, annotation.version,
          command.kind, requestJson, canonicalReviewResponseBytes(response), auth.actor, actorId(auth), privateContextDigest);
      this.fault?.('after-inserts'); this.fault?.('before-commit'); this.database.exec('COMMIT'); this.fault?.('after-commit');
      return { response, event: this.reviewEventFor(command.documentId, command.operationId), replayed: false };
    } catch (error) { if (this.database.isTransaction) this.database.exec('ROLLBACK'); throw error; }
  }
  listAnnotations(documentId: string, branchId: string): AnnotationList | null {
    if (!this.readHeadRow(documentId, branchId)) return null;
    const rows = this.database.prepare(`SELECT annotation_id,anchor_revision,version,state FROM review_annotations
      WHERE document_id=? AND branch_id=? ORDER BY annotation_id`).all(documentId, branchId) as Array<{
        annotation_id: string; anchor_revision: number; version: number; state: 'open' | 'resolved' | 'deleted' }>;
    return { schemaVersion: 'review.annotation-list.v1', documentId, branchId, annotations: rows.map((row) => ({
      annotationId: row.annotation_id, documentId, branchId, anchorRevision: row.anchor_revision,
      version: row.version, state: row.state })) };
  }
  readReviewEvents(documentId: string, afterReviewSeq: number): ReviewEvent[] {
    const rows = this.database.prepare(`SELECT review_seq,branch_id,operation_id,annotation_id,annotation_version,kind,actor_kind,actor_id
      FROM review_events WHERE document_id=? AND review_seq>? ORDER BY review_seq`).all(documentId, afterReviewSeq) as Array<{
        review_seq: number; branch_id: string; operation_id: string; annotation_id: string; annotation_version: number;
        kind: ReviewCommand['kind']; actor_kind: 'human' | 'agent'; actor_id: string }>;
    return rows.map((row) => ({ schemaVersion: 'review.event.v1', protocolVersion: REVIEW_PROTOCOL_VERSION,
      reviewSeq: row.review_seq, documentId, branchId: row.branch_id, operationId: row.operation_id,
      annotationId: row.annotation_id, annotationVersion: row.annotation_version, kind: row.kind,
      actor: { kind: row.actor_kind, actorId: row.actor_id } }));
  }
  compareRevisions(documentId: string, left: number, right: number): RevisionComparison | null {
    const a = this.readRevision(documentId, left); const b = this.readRevision(documentId, right); if (!a || !b) return null;
    return { schemaVersion: 'review.comparison.v1', documentId,
      left: { revision: left, canonicalDigest: a.canonicalDigest }, right: { revision: right, canonicalDigest: b.canonicalDigest },
      changed: a.canonicalDigest !== b.canonicalDigest, unsupported: [], missing: [] };
  }
  createHandoff(operationId: string, input: Omit<HandoffIdentityInput, 'annotationSnapshotVersion' | 'annotationSnapshotDigest'>,
    auth: AuthContext): HandoffReceipt | ReviewFailure {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const privateRequest = canonicalJson(input);
      const privateContextDigest = sha256Hex(`${auth.actor}\0${auth.capability}`);
      const prior = this.database.prepare(`SELECT private_request_json,private_context_digest,sanitized_response_json FROM review_handoffs
        WHERE document_id=? AND operation_id=?`).get(input.documentId, operationId) as
        { private_request_json: string; private_context_digest: string; sanitized_response_json: string } | undefined;
      if (prior) { this.database.exec('ROLLBACK'); return prior.private_request_json === privateRequest
        && prior.private_context_digest === privateContextDigest
        ? JSON.parse(prior.sanitized_response_json) as HandoffReceipt
        : reviewFailure('OPERATION_ID_CONFLICT', 'OPERATION_ID_CONFLICT', 'protocol', false); }
      const revision = this.readRevision(input.documentId, input.revision); const head = this.readHeadRow(input.documentId, input.branchId);
      if (!revision || !head || revision.canonicalDigest !== input.canonicalDigest)
        { this.database.exec('ROLLBACK'); return reviewFailure('VALIDATION', 'HANDOFF_REVISION_INVALID', 'revision', false); }
      for (const record of input.comparisonRecords) {
        const left = this.readRevision(input.documentId, record.leftRevision); const right = this.readRevision(input.documentId, record.rightRevision);
        if (!left || !right || left.canonicalDigest !== record.leftCanonicalDigest || right.canonicalDigest !== record.rightCanonicalDigest)
          { this.database.exec('ROLLBACK'); return reviewFailure('VALIDATION', 'HANDOFF_COMPARISON_INVALID', 'revision', false); }
      }
      for (const record of input.proofRecords) {
        const found = this.readRevision(input.documentId, record.revision); if (!found) { this.database.exec('ROLLBACK');
          return reviewFailure('VALIDATION', 'HANDOFF_PROOF_INVALID', 'revision', false); }
        const compiled = compileMotionDocument(found.document);
        if (found.canonicalDigest !== record.canonicalDigest || sha256Hex(compiled.html) !== record.htmlDigest
          || sha256Hex(compiled.css) !== record.cssDigest || compiled.exportDigest !== record.exportDigest) {
          this.database.exec('ROLLBACK'); return reviewFailure('VALIDATION', 'HANDOFF_PROOF_INVALID', 'domain', false);
        }
      }
      const entries = this.database.prepare(`SELECT annotation_id,anchor_revision,version,state,private_body FROM review_annotations
        WHERE document_id=? AND branch_id=? ORDER BY annotation_id`).all(input.documentId, input.branchId) as Array<{
          annotation_id: string; anchor_revision: number; version: number; state: 'open' | 'resolved' | 'deleted'; private_body: string }>;
      const privateEntries: AnnotationPrivateSnapshotEntry[] = entries.map((row) => ({ annotationId: row.annotation_id,
        documentId: input.documentId, branchId: input.branchId, anchorRevision: row.anchor_revision, version: row.version,
        state: row.state, body: row.private_body }));
      const snapshotJson = annotationSnapshotBytes(privateEntries); const snapshotDigest = annotationSnapshotDigest(privateEntries);
      this.database.prepare(`INSERT OR IGNORE INTO annotation_snapshots(document_id,branch_id,bound_revision,private_digest,private_snapshot_json)
        VALUES(?,?,?,?,?)`).run(input.documentId, input.branchId, input.revision, snapshotDigest, snapshotJson);
      const snapshot = this.database.prepare(`SELECT snapshot_version FROM annotation_snapshots WHERE document_id=? AND branch_id=?
        AND bound_revision=? AND private_digest=?`).get(input.documentId, input.branchId, input.revision, snapshotDigest) as { snapshot_version: number };
      const identity: HandoffIdentityInput = { ...input, annotationSnapshotVersion: snapshot.snapshot_version,
        annotationSnapshotDigest: snapshotDigest, serializerVersion: REVIEW_SERIALIZER_VERSION };
      let receipt: HandoffReceipt; try { receipt = createHandoffReceipt(identity); }
      catch (error) { this.database.exec('ROLLBACK'); return reviewFailure('VALIDATION',
        error instanceof Error ? error.message : 'HANDOFF_INVALID', 'domain', false); }
      const handoffId = `handoff_${sha256Hex(`${input.documentId}\0${operationId}`).slice(0, 24)}`;
      this.database.prepare(`INSERT INTO review_handoffs(handoff_id,document_id,operation_id,private_request_json,
        sanitized_response_json,private_context_digest) VALUES(?,?,?,?,?,?)`).run(handoffId, input.documentId,
          operationId, privateRequest, canonicalJson(receipt), privateContextDigest);
      this.database.exec('COMMIT'); return receipt;
    } catch (error) { if (this.database.isTransaction) this.database.exec('ROLLBACK'); throw error; }
  }
  private annotationProjection(documentId: string, branchId: string, annotationId: string) {
    return this.listAnnotations(documentId, branchId)?.annotations.find((item) => item.annotationId === annotationId) ?? null;
  }
  private reviewEventFor(documentId: string, operationId: string): ReviewEvent {
    const row = this.database.prepare('SELECT review_seq FROM review_events WHERE document_id=? AND operation_id=?')
      .get(documentId, operationId) as { review_seq: number };
    return this.readReviewEvents(documentId, row.review_seq - 1)[0]!;
  }
  private revisionReachable(documentId: string, headRevision: number, anchorRevision: number): boolean {
    let cursor: number | null = headRevision;
    while (cursor !== null) { if (cursor === anchorRevision) return true;
      const row = this.database.prepare('SELECT parent_revision FROM revisions WHERE document_id=? AND revision=?')
        .get(documentId, cursor) as { parent_revision: number | null } | undefined; if (!row) return false; cursor = row.parent_revision; }
    return false;
  }
  private reviewAuthDigest(documentId: string, branchId: string, auth: AuthContext): string {
    if (auth.actor === 'human') return sha256Hex(`${auth.actor}\0${auth.capability}`);
    const tokenHash = sha256Hex(auth.claimSecret ?? '');
    const claim = this.database.prepare(`SELECT claim_id,lease_version,expires_at FROM claims WHERE document_id=?
      AND active=1 AND expires_at>? AND token_hash=? AND (branch_id IS NULL OR branch_id=?) LIMIT 1`)
      .get(documentId, auth.now, tokenHash, branchId) as { claim_id: string; lease_version: number; expires_at: number } | undefined;
    if (!claim) throw new Error('REVIEW_AUTH_CONTEXT_MISSING');
    return sha256Hex(`${auth.actor}\0${auth.capability}\0${claim.claim_id}\0${claim.lease_version}\0${claim.expires_at}\0${tokenHash}`);
  }
  validate(command: MotionCommand, auth: AuthContext): { ok: true } | CommandFailure {
    const materialized = this.materialize(command); if (!materialized.ok) return materialized.response;
    const prior = this.database.prepare('SELECT request_digest,private_context_digest,private_payload_json FROM events WHERE document_id=? AND operation_id=?')
      .get(command.documentId, command.operationId) as { request_digest: string; private_context_digest: string;
        private_payload_json: string } | undefined;
    if (prior) { const publicDigest = sha256Hex(canonicalJson(command));
      const privateDigest = sha256Hex(`${auth.actor}\0${auth.capability}\0${auth.claimSecret ?? ''}`);
      return prior.request_digest === publicDigest && prior.private_context_digest === privateDigest
        && prior.private_payload_json === canonicalJson(materialized.command.command) ? { ok: true }
        : failure('OPERATION_ID_CONFLICT', 'OPERATION_ID_CONFLICT', 'protocol', false); }
    return this.validateMaterialized(materialized.command, auth);
  }
  private validateMaterialized(command: MotionCommand, auth: AuthContext): { ok: true } | CommandFailure {
    const head = this.readHeadRow(command.documentId, command.branchId);
    if (!head) { const document = this.database.prepare('SELECT 1 ok FROM documents WHERE document_id=?').get(command.documentId);
      return failure('VALIDATION', document ? 'BRANCH_NOT_FOUND' : 'DOCUMENT_NOT_FOUND', 'target', false,
        { affectedIds: document ? [command.branchId] : [command.documentId] }); }
    const operation = command.command;
    if (isAuthoringKind(operation.kind)) {
      if (head.revision !== command.expectedRevision) return stale(head.revision, head.digest);
      const claim = this.claimDiagnostic(command.documentId, command.branchId, auth);
      if (auth.actor === 'agent' && claim) return claim;
      const last = this.readLastRevision(command.documentId).revision;
      if (last >= Number.MAX_SAFE_INTEGER) return failure('VALIDATION', 'AUTHORING_REVISION_EXHAUSTED', 'domain', false);
      const state = operation.kind === 'motion.history.undo' || operation.kind === 'motion.history.redo'
        ? this.reconstructAuthoringState(command.documentId, head.revision) : createAuthoringState(JSON.parse(head.json));
      const reduced = dispatchAuthoringOperation(state, operation, last + 1);
      return reduced.ok ? { ok: true } : reducerFailure(reduced.diagnostic.code,
        { affectedIds: affectedIds(command) });
    }
    if (operation.kind === 'motion.branch.create') {
      if (auth.actor !== 'human') return forbidden();
      if (head.revision !== command.expectedRevision) return stale(head.revision, head.digest);
      const exists = this.database.prepare('SELECT 1 ok FROM branches WHERE document_id=? AND branch_id=?')
        .get(command.documentId, operation.payload.branchId);
      return exists ? failure('VALIDATION', 'BRANCH_ALREADY_EXISTS', 'target', false,
        { affectedIds: [operation.payload.branchId] }) : { ok: true };
    }
    if (operation.kind === 'motion.claim.acquire') {
      if (auth.actor !== 'agent') return forbidden();
      const applicable = operation.payload.scope === 'document' ? this.readLastRevision(command.documentId) : head;
      if (applicable.revision !== command.expectedRevision) return stale(applicable.revision, applicable.digest);
      if (!auth.claimSecret || auth.claimSecret.length < 32) return claimFailure('CLAIM_SECRET_INVALID', false);
      const targetBranch = operation.payload.scope === 'branch' ? operation.payload.branchId : null;
      const overlap = this.database.prepare(`SELECT 1 ok FROM claims WHERE document_id=? AND active=1 AND expires_at>?
        AND (branch_id IS NULL OR ? IS NULL OR branch_id=?) LIMIT 1`).get(command.documentId, auth.now, targetBranch, targetBranch);
      return overlap ? claimFailure('CLAIM_OVERLAP', true) : { ok: true };
    }
    if (auth.actor !== (operation.kind === 'motion.claim.revoke' ? 'human' : 'agent')) return forbidden();
    const leaseOperation = operation as Extract<MotionCommand['command'], { kind: 'motion.claim.renew' | 'motion.claim.release' | 'motion.claim.revoke' }>;
    const claim = this.database.prepare('SELECT * FROM claims WHERE claim_id=? AND document_id=?')
      .get(leaseOperation.payload.claimId, command.documentId) as ClaimRow | undefined;
    if (!claim) return claimFailure('CLAIM_REQUIRED', false);
    const applicable = claim.branch_id === null ? this.readLastRevision(command.documentId) : head;
    if (applicable.revision !== command.expectedRevision) return stale(applicable.revision, applicable.digest);
    if (!claim.active || claim.expires_at <= auth.now) return claimFailure('CLAIM_EXPIRED', true);
    if (claim.branch_id !== null && claim.branch_id !== command.branchId) return claimFailure('CLAIM_SCOPE_MISMATCH', false);
    if (claim.lease_version !== leaseOperation.payload.leaseVersion) return claimFailure('CLAIM_LEASE_STALE', true);
    if (operation.kind !== 'motion.claim.revoke' && (!auth.claimSecret || sha256Hex(auth.claimSecret) !== claim.token_hash))
      return claimFailure('CLAIM_SECRET_INVALID', false);
    return { ok: true };
  }
  private materialize(command: MotionCommand): { ok: true; command: MotionCommand } | { ok: false; response: CommandFailure } {
    if (command.command.schemaVersion !== 'motion.operation-intent.v1') return { ok: true, command };
    const row = this.database.prepare('SELECT canonical_json,canonical_digest FROM revisions WHERE document_id=? AND revision=?')
      .get(command.documentId, command.expectedRevision) as { canonical_json: string; canonical_digest: string } | undefined;
    if (!row) return { ok: false, response: failure('VALIDATION', 'DERIVATION_STALE', 'revision', true) };
    const document = JSON.parse(row.canonical_json) as MotionDocument; const compiled = compileMotionDocument(document);
    const result = materializePreparedIntent(document, command.branchId, row.canonical_digest, compiled.exportDigest,
      command.command as PreparedOperationIntent);
    if (!result.ok) return { ok: false, response: failure('VALIDATION', result.code,
      result.code === 'DERIVATION_STALE' ? 'revision' : 'domain', result.code === 'DERIVATION_STALE') };
    return { ok: true, command: { ...command, command: result.operation } as MotionCommand };
  }
  private author(command: MotionCommand, auth: AuthContext, publicDigest: string, privateDigest: string): CommitResult {
    if (!isAuthoringKind(command.command.kind)) throw new Error('AUTHOR_KIND');
    const head = this.readHeadRow(command.documentId, command.branchId); if (!head) return { response:
      failure('VALIDATION', 'BRANCH_NOT_FOUND', 'target', false, { affectedIds: [command.branchId] }) };
    if (head.revision !== command.expectedRevision) return { response: { ok: false, code: 'STALE_REVISION',
      currentRevision: head.revision, currentDigest: head.digest, diagnostic: stale(head.revision, head.digest).diagnostic } };
    if (auth.actor === 'agent' && !this.authorizedClaim(command.documentId, command.branchId, auth))
      return { response: this.claimDiagnostic(command.documentId, command.branchId, auth) ?? claimFailure('CLAIM_REQUIRED', false) };
    const last = (this.database.prepare('SELECT last_revision FROM documents WHERE document_id=?').get(command.documentId) as { last_revision: number }).last_revision;
    if (last >= Number.MAX_SAFE_INTEGER) return { response: failure('VALIDATION', 'AUTHORING_REVISION_EXHAUSTED', 'domain', false) };
    const nextRevision = last + 1; const state = command.command.kind === 'motion.history.undo' || command.command.kind === 'motion.history.redo'
      ? this.reconstructAuthoringState(command.documentId, head.revision) : createAuthoringState(JSON.parse(head.json));
    const reduced = dispatchAuthoringOperation(state, command.command, nextRevision);
    if (!reduced.ok) return { response: reducerFailure(reduced.diagnostic.code, { affectedIds: affectedIds(command) }) };
    const next = reduced.state.document; const canonical = canonicalJson(next); const canonicalDigest = sha256Hex(canonicalBytes(next));
    const receipt: RevisionReceipt = { schemaVersion: 'motion.revision-receipt.v1', protocolVersion: PROTOCOL_VERSION,
      documentId: command.documentId, branchId: command.branchId, expectedRevision: command.expectedRevision,
      resultingRevision: nextRevision, operationDigest: publicDigest, canonicalDigest,
      inventory: { ruleCount: next.inventory.ruleCount, applicationCount: next.inventory.applicationCount,
        slotCount: next.inventory.slotCount, trackCount: next.inventory.trackCount } };
    const response: CommandSuccess = { ok: true, protocolVersion: PROTOCOL_VERSION, operationId: command.operationId,
      documentId: command.documentId, branchId: command.branchId, expectedRevision: command.expectedRevision,
      resultingRevision: nextRevision, operationDigest: publicDigest, canonicalDigest, receipt };
    const eventId = this.eventId(command); this.insertEvent(eventId, command, nextRevision, publicDigest, privateDigest, response, auth);
    this.database.prepare('INSERT INTO revisions(document_id,revision,parent_revision,canonical_json,canonical_digest,creating_event_id) VALUES(?,?,?,?,?,?)')
      .run(command.documentId, nextRevision, head.revision, canonical, canonicalDigest, eventId); this.fault?.('after-inserts');
    const branch = this.database.prepare('UPDATE branches SET head_revision=? WHERE document_id=? AND branch_id=? AND head_revision=?')
      .run(nextRevision, command.documentId, command.branchId, head.revision);
    const doc = this.database.prepare('UPDATE documents SET last_revision=? WHERE document_id=? AND last_revision=?')
      .run(nextRevision, command.documentId, last);
    if (branch.changes !== 1 || doc.changes !== 1) throw new Error('REVISION_COMPARE_AND_SWAP_FAILED');
    return { response, event: this.eventFor(command.documentId, command.operationId), replayed: false };
  }
  private reconstructAuthoringState(documentId: string, headRevision: number): AuthoringState {
    const chain: Array<{ revision: number; parent_revision: number | null; canonical_json: string; creating_event_id: string | null }> = [];
    let cursor: number | null = headRevision;
    while (cursor !== null) {
      const row = this.database.prepare('SELECT revision,parent_revision,canonical_json,creating_event_id FROM revisions WHERE document_id=? AND revision=?')
        .get(documentId, cursor) as { revision: number; parent_revision: number | null; canonical_json: string; creating_event_id: string | null } | undefined;
      if (!row) throw new Error('AUTHORING_LINEAGE_MISSING'); chain.push(row); cursor = row.parent_revision;
    }
    chain.reverse(); let state = createAuthoringState(JSON.parse(chain[0]!.canonical_json));
    for (const row of chain.slice(1)) {
      if (!row.creating_event_id) throw new Error('AUTHORING_LINEAGE_EVENT_MISSING');
      const event = this.database.prepare('SELECT private_payload_json FROM events WHERE event_id=?').get(row.creating_event_id) as { private_payload_json: string } | undefined;
      if (!event) throw new Error('AUTHORING_LINEAGE_EVENT_MISSING');
      const operation = JSON.parse(event.private_payload_json) as AuthoringOperation;
      const replay = dispatchAuthoringOperation(state, operation, row.revision);
      if (!replay.ok || canonicalJson(replay.state.document) !== row.canonical_json) throw new Error('AUTHORING_LINEAGE_CORRUPT');
      state = replay.state;
    }
    return state;
  }
  private control(command: MotionCommand, auth: AuthContext, publicDigest: string, privateDigest: string): CommitResult {
    const operation = command.command; if (isAuthoringKind(operation.kind)) throw new Error('CONTROL_KIND');
    if (operation.kind === 'motion.branch.create' && auth.actor !== 'human') return { response: forbidden() };
    if ((operation.kind === 'motion.claim.acquire' || operation.kind === 'motion.claim.renew' || operation.kind === 'motion.claim.release')
      && auth.actor !== 'agent') return { response: forbidden() };
    if (operation.kind === 'motion.claim.revoke' && auth.actor !== 'human') return { response: forbidden() };
    const head = this.readHeadRow(command.documentId, command.branchId); if (!head) return { response:
      failure('VALIDATION', 'BRANCH_NOT_FOUND', 'target', false, { affectedIds: [command.branchId] }) };
    let applicableRevision = head.revision; let applicableDigest = head.digest; let claim: ClaimRow | undefined;
    if (operation.kind === 'motion.claim.renew' || operation.kind === 'motion.claim.release' || operation.kind === 'motion.claim.revoke') {
      claim = this.database.prepare('SELECT * FROM claims WHERE claim_id=? AND document_id=?').get(operation.payload.claimId, command.documentId) as ClaimRow | undefined;
      if (!claim) return { response: claimFailure('CLAIM_REQUIRED', false) };
      if (claim.branch_id === null) ({ revision: applicableRevision, digest: applicableDigest } = this.readLastRevision(command.documentId));
    } else if (operation.kind === 'motion.claim.acquire' && operation.payload.scope === 'document') {
      ({ revision: applicableRevision, digest: applicableDigest } = this.readLastRevision(command.documentId));
    }
    if (applicableRevision !== command.expectedRevision) return { response: { ok: false, code: 'STALE_REVISION',
      currentRevision: applicableRevision, currentDigest: applicableDigest,
      diagnostic: stale(applicableRevision, applicableDigest).diagnostic } };
    let claimId: string | undefined; let leaseVersion: number | undefined; let expiresAt: number | undefined;
    if (operation.kind === 'motion.branch.create') {
      const exists = this.database.prepare('SELECT 1 ok FROM branches WHERE document_id=? AND branch_id=?')
        .get(command.documentId, operation.payload.branchId); if (exists) return { response:
          failure('VALIDATION', 'BRANCH_ALREADY_EXISTS', 'target', false, { affectedIds: [operation.payload.branchId] }) };
      this.database.prepare('INSERT INTO branches(document_id,branch_id,head_revision,base_revision) VALUES(?,?,?,?)')
        .run(command.documentId, operation.payload.branchId, head.revision, head.revision);
    } else if (operation.kind === 'motion.claim.acquire') {
      if (!auth.claimSecret || auth.claimSecret.length < 32) return { response: claimFailure('CLAIM_SECRET_INVALID', false) };
      const targetBranch = operation.payload.scope === 'branch' ? operation.payload.branchId : null;
      const overlap = this.database.prepare(`SELECT 1 ok FROM claims WHERE document_id=? AND active=1 AND expires_at>?
        AND (branch_id IS NULL OR ? IS NULL OR branch_id=?) LIMIT 1`).get(command.documentId, auth.now, targetBranch, targetBranch);
      if (overlap) return { response: claimFailure('CLAIM_OVERLAP', true) };
      claimId = `claim_${sha256Hex(`${command.documentId}\0${command.operationId}\0${privateDigest}`).slice(0, 24)}`;
      leaseVersion = 1; expiresAt = auth.now + 60_000;
      this.database.prepare('INSERT INTO claims(claim_id,document_id,branch_id,token_hash,holder_kind,lease_version,expires_at,active,actor_id) VALUES(?,?,?,?,?,?,?,1,?)')
        .run(claimId, command.documentId, targetBranch, sha256Hex(auth.claimSecret), 'agent', leaseVersion, expiresAt, actorId(auth));
    } else {
      if (!claim) return { response: claimFailure('CLAIM_REQUIRED', false) };
      if (!claim.active || claim.expires_at <= auth.now) return { response: claimFailure('CLAIM_EXPIRED', true) };
      if (claim.lease_version !== (operation as { payload: { leaseVersion: number } }).payload.leaseVersion)
        return { response: claimFailure('CLAIM_LEASE_STALE', true) };
      if (claim.branch_id !== null && claim.branch_id !== command.branchId) return { response: claimFailure('CLAIM_SCOPE_MISMATCH', false) };
      if (operation.kind !== 'motion.claim.revoke' && (!auth.claimSecret || sha256Hex(auth.claimSecret) !== claim.token_hash))
        return { response: claimFailure('CLAIM_SECRET_INVALID', false) };
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
    this.insertEvent(this.eventId(command), command, resultingRevision, publicDigest, privateDigest, response, auth); this.fault?.('after-inserts');
    return { response, event: this.eventFor(command.documentId, command.operationId), replayed: false };
  }
  private authorizedClaim(documentId: string, branchId: string, auth: AuthContext): boolean {
    if (!auth.claimSecret) return false; const tokenHash = sha256Hex(auth.claimSecret);
    return Boolean(this.database.prepare(`SELECT 1 ok FROM claims WHERE document_id=? AND active=1 AND expires_at>?
      AND token_hash=? AND (branch_id IS NULL OR branch_id=?) LIMIT 1`).get(documentId, auth.now, tokenHash, branchId));
  }
  private claimDiagnostic(documentId: string, branchId: string, auth: AuthContext): CommandFailure | null {
    if (!auth.claimSecret) return claimFailure('CLAIM_REQUIRED', false);
    const tokenHash = sha256Hex(auth.claimSecret);
    const claim = this.database.prepare(`SELECT * FROM claims WHERE document_id=? AND token_hash=?
      ORDER BY active DESC,expires_at DESC LIMIT 1`).get(documentId, tokenHash) as ClaimRow | undefined;
    if (!claim) return claimFailure('CLAIM_SECRET_INVALID', false);
    if (!claim.active || claim.expires_at <= auth.now) return claimFailure('CLAIM_EXPIRED', true);
    if (claim.branch_id !== null && claim.branch_id !== branchId) return claimFailure('CLAIM_SCOPE_MISMATCH', false);
    return null;
  }
  private insertEvent(eventId: string, command: MotionCommand, resultingRevision: number, requestDigest: string,
    privateDigest: string, response: CommandSuccess, auth?: AuthContext): void {
    this.database.prepare(`INSERT INTO events(event_id,document_id,branch_id,kind,operation_id,expected_revision,resulting_revision,
      request_digest,private_context_digest,private_payload_json,sanitized_receipt_json,actor_kind,actor_id,affected_ids_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(eventId, command.documentId, command.branchId, command.command.kind, command.operationId, command.expectedRevision,
        resultingRevision, requestDigest, privateDigest, canonicalJson(command.command), canonicalResponseBytes(response),
        auth?.actor ?? null, auth ? actorId(auth) : null, canonicalJson(affectedIds(command)));
  }
  private eventId(command: MotionCommand): string { return `event_${sha256Hex(`${command.documentId}\0${command.operationId}`).slice(0, 24)}`; }
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
  private readHeadRow(documentId: string, branchId: string): HeadRow | null { const row = this.database.prepare(`SELECT b.head_revision revision,
    r.canonical_json json,r.canonical_digest digest FROM branches b JOIN revisions r ON r.document_id=b.document_id
    AND r.revision=b.head_revision WHERE b.document_id=? AND b.branch_id=?`).get(documentId, branchId) as HeadRow | undefined; return row ?? null; }
  private readLastRevision(documentId: string): Pick<HeadRow, 'revision' | 'digest'> { const row = this.database.prepare(`SELECT d.last_revision revision,
    r.canonical_digest digest FROM documents d JOIN revisions r ON r.document_id=d.document_id AND r.revision=d.last_revision
    WHERE d.document_id=?`).get(documentId) as Pick<HeadRow, 'revision' | 'digest'> | undefined;
    if (!row) throw new Error('DOCUMENT_REVISION_MISSING'); return row; }
  private eventFor(documentId: string, operationId: string) { const row = this.database.prepare(
    'SELECT commit_seq,branch_id,resulting_revision,kind,request_digest,actor_kind,actor_id,affected_ids_json FROM events WHERE document_id=? AND operation_id=?').get(documentId, operationId) as
    { commit_seq: number; branch_id: string; resulting_revision: number; kind: MotionCommand['command']['kind']; request_digest: string;
      actor_kind: 'human' | 'agent' | null; actor_id: string | null; affected_ids_json: string | null };
    const revision = this.readRevision(documentId, row.resulting_revision) ?? this.readHead(documentId, row.branch_id)!;
    return { documentId, branchId: row.branch_id, revision: row.resulting_revision, digest: revision.canonicalDigest,
      kind: row.kind, commitSeq: row.commit_seq, operationDigest: row.request_digest,
      actor: row.actor_kind ? { kind: row.actor_kind, actorId: row.actor_id } : { kind: 'legacy-unknown' as const, actorId: null },
      affectedIds: row.affected_ids_json ? JSON.parse(row.affected_ids_json) as string[] : [] }; }
  private verifyPreMigration(): void {
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
  private verify(): void { this.verifyPreMigration(); }
}

function isAuthoringKind(kind: string): kind is AuthoringOperation['kind'] {
  return ['motion.track.create', 'motion.keyframe-value.set', 'motion.keyframe-time.set', 'motion.keyframe.add',
    'motion.keyframe.remove', 'motion.slot-duration.set', 'motion.binding-delay.set', 'motion.slot-easing.set',
    'motion.hold.insert', 'motion.transform-pose.set', 'motion.transform-waypoints.translate',
    'motion.transform-waypoint.add', 'motion.transform-waypoint.remove',
    'motion.keyframe-group-time.set', 'motion.keyframe-group-easing.set', 'motion.settled-hold.set',
    'motion.cue.create', 'motion.cue.update', 'motion.cue.delete', 'motion.cue.detach',
    'motion.history.undo', 'motion.history.redo'].includes(kind);
}

function actorId(auth: Pick<AuthContext, 'actor' | 'capability'>): string {
  return `actor_${sha256Hex(`${auth.actor}\0${auth.capability}`).slice(0, 24)}`;
}
function affectedIds(command: MotionCommand): string[] {
  const operation = command.command as MotionCommand['command'] & { elementId?: string; trackId?: string; keyframeId?: string;
    payload?: { cueId?: string; claimId?: string; branchId?: string; targets?: Array<{ elementId: string; trackId: string; keyframeId: string }> } };
  const ids = [operation.elementId, operation.trackId, operation.keyframeId, operation.payload?.cueId,
    operation.payload?.claimId, operation.payload?.branchId,
    ...(operation.payload?.targets ?? []).flatMap((target) => [target.elementId, target.trackId, target.keyframeId])]
    .filter((value): value is string => Boolean(value));
  return [...new Set(ids)].sort();
}
function failure(code: CommandFailure['code'], diagnosticCode: string, category: MotionDiagnostic['category'], retryable: boolean,
  extra: Pick<MotionDiagnostic, 'affectedIds' | 'currentRevision' | 'currentDigest'> = {}): CommandFailure {
  return { ok: false, code, diagnostic: { schemaVersion: 'motion.diagnostic.v1', code: diagnosticCode, category, retryable, ...extra } };
}
function stale(currentRevision: number, currentDigest: string): CommandFailure { return { ...failure('STALE_REVISION',
  'STALE_REVISION', 'revision', true, { currentRevision, currentDigest }), currentRevision, currentDigest }; }
function forbidden(): CommandFailure { return failure('UNAUTHORIZED_CLAIM', 'ACTOR_FORBIDDEN', 'authorization', false); }
function claimFailure(code: string, retryable: boolean): CommandFailure {
  return failure('UNAUTHORIZED_CLAIM', code, 'authorization', retryable);
}
function reducerFailure(code: string, extra: Pick<MotionDiagnostic, 'affectedIds'> = {}): CommandFailure {
  const category: MotionDiagnostic['category'] = /(?:NOT_FOUND|TARGET_MISSING|TARGET_INVALID)$/.test(code) ? 'target' : 'domain';
  return failure('VALIDATION', code, category, false, extra);
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

/** Synthetic failure fixtures remain inside the sole SQLite adapter. */
export function poisonLegacyV1Migration(path: string): void {
  const database = new DatabaseSync(path); try { database.exec('CREATE TABLE claims(blocker TEXT NOT NULL)'); } finally { database.close(); }
}
export function inspectMigrationFixture(path: string): { versions: number[]; mainOnlyConstraint: boolean } {
  const database = new DatabaseSync(path); try {
    const versions = (database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>)
      .map((row) => row.version);
    const sql = (database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='branches'").get() as { sql: string }).sql;
    return { versions, mainOnlyConstraint: sql.includes("CHECK(branch_id = 'main')") };
  } finally { database.close(); }
}
export function corruptStoredHead(path: string, mode: 'digest' | 'dangling'): void {
  const database = new DatabaseSync(path); try {
    if (mode === 'digest') database.prepare("UPDATE revisions SET canonical_digest=? WHERE revision=(SELECT head_revision FROM branches WHERE branch_id='main')")
      .run('0'.repeat(64));
    else database.prepare("UPDATE branches SET head_revision=999 WHERE branch_id='main'").run();
  } finally { database.close(); }
}
export function createCorruptDatabase(path: string): void { writeFileSync(path, 'not a sqlite database', { mode: 0o600 }); }
export function corruptMigrationChecksum(path: string, version: number): void {
  const database = new DatabaseSync(path); try { database.prepare('UPDATE schema_migrations SET checksum=? WHERE version=?')
    .run('synthetic-checksum-mismatch', version); } finally { database.close(); }
}
export function rawDatabaseDigest(path: string): string { return sha256Hex(readFileSync(path)); }
