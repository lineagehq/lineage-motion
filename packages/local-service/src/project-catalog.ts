import type { DatabaseSync } from 'node:sqlite';
import { canonicalJson, sha256Hex, type MotionDocument } from '../../domain/src/index.ts';
import { parseProjectCatalog, parseShotAdmissionResponse, type ProjectCatalog } from '../../motion-protocol/src/project.ts';
export type ProjectIdentity = { projectId: string; name: string };
export function initializeProject(database: DatabaseSync, seed: MotionDocument, identity?: ProjectIdentity): void {
  const found = database.prepare('SELECT project_id,name,seed_document_id FROM project_catalog WHERE singleton=1').get() as
    { project_id: string; name: string; seed_document_id: string } | undefined;
  const selected = identity ?? { projectId: `project_${sha256Hex(seed.documentId).slice(0, 24)}`, name: 'My animation' };
  if (found) {
    if (found.seed_document_id !== seed.documentId || (identity && (found.project_id !== identity.projectId || found.name !== identity.name)))
      throw new Error('STORE_PROJECT_MISMATCH');
    return;
  }
  database.prepare('INSERT INTO project_catalog VALUES(1,?,?,0,?)').run(selected.projectId, selected.name, seed.documentId);
  database.prepare("INSERT OR IGNORE INTO project_shots VALUES(?,?,'legacy')").run(seed.documentId, 'First shot');
  readProjectCatalog(database);
}
export function readProjectCatalog(database: DatabaseSync): ProjectCatalog {
  const project = database.prepare('SELECT project_id,name,catalog_revision FROM project_catalog WHERE singleton=1').get() as
    { project_id: string; name: string; catalog_revision: number } | undefined;
  if (!project) throw new Error('PROJECT_CATALOG_MISSING');
  const rows = database.prepare(`SELECT s.document_id,s.name,s.source_kind,b.head_revision,r.canonical_digest,r.canonical_json
    FROM project_shots s JOIN branches b ON b.document_id=s.document_id AND b.branch_id='main'
    JOIN revisions r ON r.document_id=b.document_id AND r.revision=b.head_revision ORDER BY s.document_id`).all() as Array<{
      document_id: string; name: string; source_kind: 'legacy' | 'starter' | 'html-css'; head_revision: number;
      canonical_digest: string; canonical_json: string }>;
  const body = { schemaVersion: 'motion.project-catalog.v1' as const, projectId: project.project_id, name: project.name,
    catalogRevision: project.catalog_revision, shots: rows.map(row => ({ documentId: row.document_id, name: row.name,
      branchId: 'main' as const, headRevision: row.head_revision, canonicalDigest: row.canonical_digest,
      durationMs: (JSON.parse(row.canonical_json) as MotionDocument).durationMs, sourceKind: row.source_kind })) };
  return parseProjectCatalog({ ...body, catalogDigest: sha256Hex(canonicalJson(body)) });
}
export function verifyProjectCatalog(database: DatabaseSync): void {
  if (!database.prepare("SELECT 1 FROM sqlite_master WHERE name='project_catalog'").get()) return;
  const count = (database.prepare('SELECT COUNT(*) n FROM documents').get() as { n: number }).n;
  if (!count) return;
  const missing = database.prepare(`SELECT 1 FROM documents d LEFT JOIN project_shots s ON s.document_id=d.document_id
    WHERE s.document_id IS NULL LIMIT 1`).get();
  if (missing) throw new Error('PROJECT_CATALOG_INTEGRITY_FAILED');
  if (!database.prepare('SELECT 1 FROM project_catalog').get()) throw new Error('PROJECT_CATALOG_INTEGRITY_FAILED');
  {
    const catalog = readProjectCatalog(database);
    if (catalog.shots.length !== count) throw new Error('PROJECT_CATALOG_INTEGRITY_FAILED');
    const admissions = database.prepare('SELECT COUNT(*) n FROM shot_admissions').get() as { n: number };
    if (admissions.n !== catalog.catalogRevision) throw new Error('PROJECT_CATALOG_INTEGRITY_FAILED');
    const receipts = database.prepare(`SELECT a.operation_id,a.document_id,a.receipt_json,r.canonical_digest
      FROM shot_admissions a LEFT JOIN revisions r ON r.document_id=a.document_id AND r.revision=0`).all() as Array<{
        operation_id: string; document_id: string; receipt_json: string; canonical_digest: string | null }>;
    for (const row of receipts) {
      const receipt = parseShotAdmissionResponse(JSON.parse(row.receipt_json));
      if (!receipt.ok || receipt.operationId !== row.operation_id || receipt.documentId !== row.document_id
        || receipt.projectId !== catalog.projectId || receipt.canonicalDigest !== row.canonical_digest)
        throw new Error('PROJECT_CATALOG_INTEGRITY_FAILED');
    }
  }
}
