import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { unzipSync, strFromU8 } from 'fflate';
import { startLocalMotionService, type LocalMotionService } from '../../local-service/src/index.ts';
import { phase3Seed, phase3Command } from '../../local-service/src/test-support.ts';
import { MotionServiceClient } from '../../motion-protocol/src/index.ts';
import { sha256Hex } from '../../domain/src/index.ts';
import { fixture, invoke } from './managed-test-support.ts';

test('managed export uses explicit saved revision, deterministic bytes, and sanitized receipts without a claim', async () => {
  const f = await fixture(); const human = randomBytes(32).toString('base64url');
  const options = { databasePath: join(f.directory, 'project.sqlite'), seed: phase3Seed(),
    project: { projectId: 'public_export_project', name: f.project }, capabilities: { human, agent: f.capability } };
  let service: LocalMotionService | undefined = await startLocalMotionService(options);
  await f.writeSession(service.url);
  const common = ['--data-dir', f.dataDir, '--document-id', options.seed.documentId];
  try {
    const help = (await invoke(['export', '--help'])).json;
    expect(help.requiredOptions).toContain('--expected-revision');
    expect(help.requiredOptions).toContain('--output FILE.zip');
    const before = service.store.snapshot(); const archives: Buffer[] = []; const receipts: unknown[] = [];
    for (let run = 0; run < 4; run++) {
      if (run === 3) { await service.close(); service = await startLocalMotionService(options); await f.writeSession(service.url); }
      const output = join(f.directory, `public-${run}.zip`);
      const result = await invoke(['export', ...common, '--expected-revision', '0', '--output', output]);
      expect(result.code).toBe(0); expect(result.json).toMatchObject({ ok: true, receipt: { revision: 0, projectId: options.project.projectId } });
      const bytes = await readFile(output); archives.push(bytes); receipts.push(result.json);
      expect(result.json.archiveDigest).toBe(sha256Hex(bytes));
      expect(strFromU8(unzipSync(bytes)['receipt.json']!)).toContain(result.json.receipt.exportDigest);
      expect(result.stdout + result.stderr).not.toContain(f.capability);
      expect(result.stdout + result.stderr).not.toContain(output);
      expect(result.stdout).not.toContain('<html');
    }
    expect(archives.every(bytes => bytes.equals(archives[0]!))).toBe(true);
    expect(receipts.every(value => JSON.stringify(value) === JSON.stringify(receipts[0]))).toBe(true);
    expect(service.store.snapshot()).toEqual(before);
    const existing = join(f.directory, 'public-0.zip');
    expect((await invoke(['export', ...common, '--expected-revision', '0', '--output', existing])).json.code).toBe('EXPORT_OUTPUT_EXISTS');
    expect(await readFile(existing)).toEqual(archives[0]);
    const rejected = join(f.directory, 'rejected.zip');
    expect((await invoke(['export', ...common, '--output', rejected])).json.diagnostic.code).toBe('CLI_REVISION_REQUIRED');
    expect((await invoke(['export', ...common, '--project-id', 'wrong_project', '--expected-revision', '0', '--output', rejected])).json.diagnostic.code).toBe('CLI_PROJECT_MISMATCH');
    expect(await new MotionServiceClient(service.url, fetch, { actor: 'human', capability: human }).dispatch(phase3Command('after-export'))).toMatchObject({ ok: true });
    expect((await invoke(['export', ...common, '--expected-revision', '0', '--output', rejected])).json.code).toBe('EXPORT_STALE_REVISION');
    expect(await readdir(f.directory)).not.toContain('rejected.zip');
  } finally { await service?.close(); await f.cleanup(); }
}, 15_000);
