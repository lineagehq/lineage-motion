import { strToU8, zipSync } from 'fflate';
import { parseExportResponse, type ExportBundle } from './export.ts';

/** Fixed names, file order and ZIP timestamps make browser and CLI archives identical. */
export function createExportArchive(bundle: ExportBundle): Uint8Array<ArrayBuffer> {
  parseExportResponse(bundle, { schemaVersion: 'motion.export-request.v1',
    projectId: bundle.receipt.projectId, documentId: bundle.receipt.documentId,
    branchId: bundle.receipt.branchId, expectedRevision: bundle.receipt.revision });
  const files = Object.fromEntries(['animation.html', 'animation.css', 'receipt.json'].map((name) =>
    [name, strToU8(bundle.files[name as keyof typeof bundle.files])]));
  // ZIP stores local calendar fields. Construct local midnight rather than a
  // UTC instant so the encoded date is identical across host time zones.
  return zipSync(files, { level: 0, mtime: new Date(1980, 0, 1, 0, 0, 0), os: 0, attrs: 0 });
}
