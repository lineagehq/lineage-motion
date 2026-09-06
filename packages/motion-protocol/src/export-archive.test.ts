import { expect, test } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { canonicalJson, sha256Hex } from '../../domain/src/index.ts';
import { createExportArchive } from './export-archive.ts';
import type { ExportBundle } from './export.ts';

function bundle(): ExportBundle {
  const html = '<!doctype html><meta charset="utf-8"><style>p{color:blue}</style><p>Synthetic café</p>';
  const css = 'p{color:blue}';
  const receipt: ExportBundle['receipt'] = { schemaVersion: 'motion.export-receipt.v1',
    projectId: 'project', documentId: 'shot', branchId: 'main', revision: 0,
    canonicalDigest: sha256Hex('canonical'), sourceDigest: sha256Hex('source'),
    exportDigest: sha256Hex(`${html}\0${css}`), htmlDigest: sha256Hex(html), cssDigest: sha256Hex(css),
    reducedMotionDigest: sha256Hex(''), inventory: { ruleCount: 0, applicationCount: 0, slotCount: 0,
      trackCount: 0, supportedCount: 0, unsupportedCount: 0, missingCount: 0 } };
  return { ok: true, schemaVersion: 'motion.export-bundle.v1', receipt,
    files: { 'animation.html': html, 'animation.css': css, 'receipt.json': canonicalJson(receipt) } };
}

test('archive preserves all UTF-8 artifact bytes with deterministic names and timestamps', () => {
  const input = bundle(); const archives = [0, 1, 2].map(() => createExportArchive(input));
  expect(archives[1]).toEqual(archives[0]); expect(archives[2]).toEqual(archives[0]);
  const files = unzipSync(archives[0]!);
  expect(Object.keys(files)).toEqual(['animation.html', 'animation.css', 'receipt.json']);
  expect(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, strFromU8(bytes)]))).toEqual(input.files);
  const header = new DataView(archives[0]!.buffer);
  expect(header.getUint16(10, true)).toBe(0); // midnight
  expect(header.getUint16(12, true)).toBe(33); // 1980-01-01
});

test('a modified artifact cannot be packaged with a stale receipt', () => {
  const input = bundle(); input.files['animation.css'] += '\np{color:red}';
  expect(() => createExportArchive(input)).toThrow('EXPORT_RESPONSE_MISMATCH');
});
