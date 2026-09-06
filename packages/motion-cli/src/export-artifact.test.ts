import { afterEach, expect, test, vi } from 'vitest';
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, rm: vi.fn(actual.rm) };
});
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { sha256Hex } from '../../domain/src/index.ts';
import { exportShot } from '../../local-service/src/shot-export.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { phase3Seed } from '../../local-service/src/test-support.ts';
import { writeExportArtifact } from './export-artifact.ts';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.reverse()) await close(); cleanup.length = 0; });
test('publishes complete artifact bytes once and cannot overwrite files or symlinks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-export-public-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const service = await startLocalMotionService({ databasePath: join(directory, 'project.sqlite'), seed: phase3Seed() });
  cleanup.push(() => service.close());
  const bundle = exportShot(service.store, { schemaVersion: 'motion.export-request.v1',
    projectId: service.store.readProjectCatalog().projectId, documentId: phase3Seed().documentId,
    branchId: 'main', expectedRevision: 0 });
  if (!bundle.ok) throw new Error('EXPORT_FAILED');
  const destination = join(directory, 'animation.zip');
  const receipt = await writeExportArtifact(destination, bundle);
  const bytes = await readFile(destination);
  expect(receipt.archiveDigest).toBe(sha256Hex(bytes));
  expect(Object.fromEntries(Object.entries(unzipSync(bytes)).map(([name, data]) => [name, strFromU8(data)]))).toEqual(bundle.files);
  await expect(writeExportArtifact(destination, bundle)).rejects.toThrow('EXPORT_OUTPUT_EXISTS');
  expect(await readFile(destination)).toEqual(bytes);
  const protectedFile = join(directory, 'keep.txt'); await writeFile(protectedFile, 'Keep this content');
  const linkedOutput = join(directory, 'linked.zip'); await symlink(protectedFile, linkedOutput);
  await expect(writeExportArtifact(linkedOutput, bundle)).rejects.toThrow('EXPORT_OUTPUT_EXISTS');
  expect(await readFile(protectedFile, 'utf8')).toBe('Keep this content');
  await expect(writeExportArtifact(join(directory, 'absent', 'animation.zip'), bundle)).rejects.toThrow('EXPORT_OUTPUT_UNAVAILABLE');
  expect((await readdir(directory)).filter((name) => name.startsWith('.motion-export-'))).toEqual([]);
  const published = join(directory, 'cleanup-warning.zip');
  vi.mocked(rm).mockRejectedValueOnce(new Error('Private staging path must not escape'));
  const warning = await writeExportArtifact(published, bundle);
  expect(warning).toEqual({ archiveDigest: sha256Hex(await readFile(published)), warning: 'EXPORT_STAGING_CLEANUP_FAILED' });
  expect(await readFile(published)).toEqual(bytes);
  expect(JSON.stringify(warning)).not.toContain(directory);
  vi.mocked(rm).mockRejectedValueOnce(new Error('Private staging path must not escape'));
  await expect(writeExportArtifact(published, bundle)).rejects.toThrow(/^EXPORT_OUTPUT_AND_CLEANUP_FAILED$/);
  expect(await readFile(published)).toEqual(bytes);
});
