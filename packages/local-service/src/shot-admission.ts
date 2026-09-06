import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson, sha256Hex } from '../../domain/src/index.ts';
import { parseShotAdmissionCommand, type ShotAdmissionCommand, type ShotAdmissionFailure,
  type ShotAdmissionResponse, type ShotAdmissionReceipt } from '../../motion-protocol/src/project.ts';
import type { AuthContext } from '../../project-store/src/index.ts';
import type { FaultPoint } from './sqlite-project-store.ts';
import { actorId } from './store-support.ts';
import { readProjectCatalog } from './project-catalog.ts';
import { prepareShot } from './shot-source.ts';
export function admitShot(database: DatabaseSync, input: ShotAdmissionCommand, auth: AuthContext,
  fault?: (point: FaultPoint) => void): ShotAdmissionResponse {
  let command: ShotAdmissionCommand;
  try { command = parseShotAdmissionCommand(input); } catch { return fail('VALIDATION', 'PROJECT_COMMAND_INVALID'); }
  if (auth.actor === 'agent' && (!command.claim || command.claim.documentId !== command.documentId
    || !auth.claimSecret || auth.claimSecret.length < 32)) return fail('UNAUTHORIZED_CLAIM', 'NEW_DOCUMENT_CLAIM_REQUIRED');
  if (auth.actor === 'human' && command.claim !== null) return fail('UNAUTHORIZED_CLAIM', 'ACTOR_FORBIDDEN');
  const requestDigest = sha256Hex(canonicalJson(command));
  const privateDigest = sha256Hex(`${auth.actor}\0${auth.capability}\0${auth.claimSecret ?? ''}`);
  database.exec('BEGIN IMMEDIATE');
  try {
    fault?.('after-begin');
    const catalog = readProjectCatalog(database);
    if (catalog.projectId !== command.projectId) return rollback(fail('PROJECT_MISMATCH', 'PROJECT_MISMATCH'));
    const prior = database.prepare('SELECT request_digest,private_context_digest,receipt_json FROM shot_admissions WHERE operation_id=?')
      .get(command.operationId) as { request_digest: string; private_context_digest: string; receipt_json: string } | undefined;
    if (prior) return rollback(prior.request_digest === requestDigest && prior.private_context_digest === privateDigest
      ? JSON.parse(prior.receipt_json) as ShotAdmissionReceipt : fail('OPERATION_ID_CONFLICT', 'OPERATION_ID_CONFLICT'));
    if (command.expectedCatalogRevision !== catalog.catalogRevision) return rollback({ ...fail('STALE_CATALOG_REVISION', 'STALE_CATALOG_REVISION'), currentCatalogRevision: catalog.catalogRevision });
    if (catalog.catalogRevision === Number.MAX_SAFE_INTEGER) return rollback(fail('VALIDATION', 'CATALOG_REVISION_EXHAUSTED'));
    if (database.prepare('SELECT 1 FROM documents WHERE document_id=?').get(command.documentId))
      return rollback(fail('DOCUMENT_ALREADY_EXISTS', 'DOCUMENT_ALREADY_EXISTS'));
    const prepared = prepareShot(command);
    if ('ok' in prepared) return rollback(prepared);
    database.prepare('INSERT INTO documents VALUES(?,0)').run(command.documentId);
    database.prepare('INSERT INTO revisions VALUES(?,0,NULL,?,?,NULL)').run(command.documentId,
      canonicalJson(prepared.document), prepared.canonicalDigest);
    database.prepare("INSERT INTO branches VALUES(?,'main',0,0)").run(command.documentId);
    database.prepare('INSERT INTO project_shots VALUES(?,?,?)').run(command.documentId, command.name, command.source.kind);
    database.prepare('UPDATE project_catalog SET catalog_revision=catalog_revision+1 WHERE singleton=1').run();
    let claim: ShotAdmissionReceipt['claim'];
    if (auth.actor === 'agent') {
      const claimId = `claim_${sha256Hex(`${command.documentId}\0${command.operationId}\0${privateDigest}`).slice(0, 24)}`;
      const expiresAt = auth.now + 60_000;
      if (!Number.isSafeInteger(expiresAt) || expiresAt < 0) return rollback(fail('VALIDATION', 'CLAIM_TIME_INVALID'));
      database.prepare(`INSERT INTO claims(claim_id,document_id,branch_id,token_hash,holder_kind,lease_version,expires_at,active,actor_id)
        VALUES(?,?,NULL,?,'agent',1,?,1,?)`).run(claimId, command.documentId, sha256Hex(auth.claimSecret!), expiresAt, actorId(auth));
      claim = { claimId, scope: 'document', leaseVersion: 1, expiresAt };
    }
    const next = readProjectCatalog(database);
    const receipt: ShotAdmissionReceipt = { ok: true, schemaVersion: 'motion.shot-admission.v1', operationId: command.operationId,
      projectId: command.projectId, documentId: command.documentId, name: command.name, branchId: 'main', headRevision: 0,
      catalogRevision: next.catalogRevision, catalogDigest: next.catalogDigest, sourceDigest: prepared.inventory.sourceDigest,
      canonicalDigest: prepared.canonicalDigest, exportDigest: prepared.exportDigest, inventory: prepared.inventory,
      ...(claim ? { claim } : {}) };
    database.prepare('INSERT INTO shot_admissions VALUES(?,?,?,?,?)').run(command.operationId, requestDigest, privateDigest,
      command.documentId, canonicalJson(receipt));
    fault?.('after-inserts'); fault?.('before-commit'); database.exec('COMMIT'); fault?.('after-commit'); return receipt;
  } catch (error) { if (database.isTransaction) database.exec('ROLLBACK'); throw error; }
  function rollback(response: ShotAdmissionResponse): ShotAdmissionResponse { database.exec('ROLLBACK'); return response; }
}
function fail(code: ShotAdmissionFailure['code'], diagnosticCode: string): ShotAdmissionFailure {
  return { ok: false, code, diagnosticCode };
}
