import { canonicalJson, sha256Hex } from '../../domain/src/index.ts';
import { compileMotionDocument } from '../../css-compiler/src/index.ts';
import { exportRequestSchema, type ExportReceipt, type ExportResponse } from '../../motion-protocol/src/export.ts';
import type { ProjectStore } from '../../project-store/src/index.ts';

/** Read and compile synchronously so no mutation can interleave with the revision check. */
export function exportShot(store: ProjectStore, input: unknown): ExportResponse {
  const parsed = exportRequestSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'EXPORT_REQUEST_INVALID' };
  const request = parsed.data;
  if (store.readProjectCatalog().projectId !== request.projectId)
    return { ok: false, code: 'EXPORT_PROJECT_MISMATCH' };
  const snapshot = store.readHead(request.documentId, request.branchId);
  if (!snapshot) return { ok: false, code: 'EXPORT_SHOT_NOT_FOUND' };
  if (snapshot.document.revision !== request.expectedRevision)
    return { ok: false, code: 'EXPORT_STALE_REVISION', currentRevision: snapshot.document.revision };
  const { document } = snapshot;
  const inventory = document.inventory;
  if (inventory.unsupportedCount || inventory.missingCount) return { ok: false, code: 'EXPORT_UNSUPPORTED' };
  let compiled;
  try { compiled = compileMotionDocument(document); }
  catch { return { ok: false, code: 'EXPORT_UNSUPPORTED' }; }
  // A byte-order mark overrides legacy source charset declarations for standalone files.
  const html = `\uFEFF${compiled.html}`; const css = `\uFEFF${compiled.css}`;
  const receipt: ExportReceipt = { schemaVersion: 'motion.export-receipt.v1', encoding: 'utf-8-bom', projectId: request.projectId,
    documentId: document.documentId, branchId: request.branchId, revision: document.revision,
    canonicalDigest: snapshot.canonicalDigest, sourceDigest: inventory.sourceDigest, exportDigest: compiled.exportDigest,
    htmlDigest: sha256Hex(html), cssDigest: sha256Hex(css), reducedMotionDigest: sha256Hex(document.reducedMotion.css),
    inventory: { ruleCount: inventory.ruleCount, applicationCount: inventory.applicationCount, slotCount: inventory.slotCount,
      trackCount: inventory.trackCount, supportedCount: inventory.supportedCount, unsupportedCount: 0, missingCount: 0 } };
  return { ok: true, schemaVersion: 'motion.export-bundle.v1', receipt,
    files: { 'animation.html': html, 'animation.css': css, 'receipt.json': canonicalJson(receipt) } };
}
