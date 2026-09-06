import { link, mkdtemp, open, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { sha256Hex } from '../../domain/src/index.ts';
import { createExportArchive } from '../../motion-protocol/src/export-archive.ts';
import type { ExportBundle } from '../../motion-protocol/src/export.ts';

/** Publish only a complete, synced archive. Hard-link creation never replaces an existing destination. */
export async function writeExportArtifact(outputPath: string, bundle: ExportBundle): Promise<{
  archiveDigest: string; warning?: 'EXPORT_STAGING_CLEANUP_FAILED';
}> {
  const bytes = createExportArchive(bundle);
  const destination = resolve(outputPath);
  let staging: string | undefined; let failure: string | undefined; let cleanupFailed = false;
  try {
    staging = await mkdtemp(join(dirname(destination), '.motion-export-'));
    const path = join(staging, 'archive.zip');
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(bytes); await file.sync(); }
    finally { await file.close(); }
    await link(path, destination);
  } catch (error) {
    failure = (error as NodeJS.ErrnoException).code === 'EEXIST' ? 'EXPORT_OUTPUT_EXISTS' : 'EXPORT_OUTPUT_UNAVAILABLE';
  } finally {
    if (staging) {
      try { await rm(staging, { recursive: true, force: true }); }
      catch { cleanupFailed = true; }
    }
  }
  if (failure) throw new Error(cleanupFailed ? 'EXPORT_OUTPUT_AND_CLEANUP_FAILED' : failure);
  // Publication succeeded even if removing its private staging link did not.
  return { archiveDigest: sha256Hex(bytes), ...(cleanupFailed ? { warning: 'EXPORT_STAGING_CLEANUP_FAILED' as const } : {}) };
}
