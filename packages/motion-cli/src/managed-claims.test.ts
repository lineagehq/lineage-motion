import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { phase3Seed } from '../../local-service/src/test-support.ts';
import { fixture, invoke, readCredential, startCli } from './managed-test-support.ts';

test('real managed CLI preserves claims, validation, stale failures, explicit lease control and session identity', async () => {
  const f = await fixture(); const seed = phase3Seed(); let now = 1000;
  const service = await startLocalMotionService({ databasePath: join(f.directory, 'project.sqlite'), seed,
    capabilities: { human: randomBytes(32).toString('base64url'), agent: f.capability }, now: () => now });
  const path = await f.writeSession(service.url);
  const common = ['--data-dir', f.dataDir, '--document-id', seed.documentId];
  const run = (name: string, tail: string[] = []) => invoke([name, ...common, ...tail]);
  const acquiredArgs = ['--claim', 'edit', '--scope', 'document', '--operation-id', 'acquire', '--expected-revision', '0'];
  try {
    const acquire = await run('claim-acquire', acquiredArgs); expect(acquire.json).toMatchObject({ ok: true, leaseVersion: 1, expiresAt: 61000 });
    expect((await run('claim-acquire', acquiredArgs)).stdout).toBe(acquire.stdout);
    const credential = await readCredential(path, 'edit');
    expect((await stat(join(dirname(path), 'agent-claims/edit/credential.json'))).mode & 0o777).toBe(0o600);
    expect((await stat(join(dirname(path), 'agent-claims/edit'))).mode & 0o777).toBe(0o700);
    expect(acquire.stdout + acquire.stderr).not.toContain(credential.secret);
    const workspace = await run('workspace'); const elementId = workspace.json.elements.find((e: any) => e.elementId === 'el_2dbee68b1ea318c8').elementId;
    const create = ['--claim', 'edit', '--operation-id', 'create', '--expected-revision', '0', '--element-id', elementId];
    expect((await run('track-create', [...create, '--validate-only'])).json).toMatchObject({ valid: true });
    expect((await run('head')).json.revision).toBe(0);
    expect((await run('track-create', create)).json).toMatchObject({ ok: true, resultingRevision: 1 });
    expect((await run('undo', ['--claim', 'edit', '--operation-id', 'stale', '--expected-revision', '0'])).code).toBe(3);
    expect((await run('head')).json.revision).toBe(1);
    expect((await invoke(['undo', ...common, '--branch-id', 'other', '--claim', 'edit', '--operation-id', 'wrong', '--expected-revision', '1'])).json.diagnostic.code)
      .toBe('CLI_CLAIM_IDENTITY_MISMATCH');
    const file = join(f.directory, 'command.json'); await writeFile(file, JSON.stringify({ protocolVersion: 'motion.protocol.v1',
      operationId: 'file-op', documentId: 'wrong-document', branchId: 'main', expectedRevision: 1,
      command: { schemaVersion: 'motion.operation.v1', kind: 'motion.history.undo', operationId: 'file-op', documentId: 'wrong-document', expectedRevision: 1 } }));
    expect((await run('dispatch', ['--claim', 'edit', '--command-file', file])).json.diagnostic.code).toBe('CLI_COMMAND_IDENTITY_MISMATCH');
    const renew = ['--claim', 'edit', '--operation-id', 'renew', '--expected-revision', '1', '--lease-version', '1'];
    const renewed = await run('claim-renew', renew); expect(renewed.json).toMatchObject({ ok: true, leaseVersion: 2 });
    expect((await run('claim-renew', renew)).stdout).toBe(renewed.stdout);
    expect((await run('claim-renew', [...renew.slice(0, -1), '2'])).json.diagnostic.code).toBe('CLI_CLAIM_REQUEST_CONFLICT');
    const release = ['--claim', 'edit', '--operation-id', 'release', '--expected-revision', '1', '--lease-version', '2'];
    const released = await run('claim-release', release); expect(released.json).toMatchObject({ ok: true, leaseVersion: 3 });
    expect((await run('claim-release', release)).stdout).toBe(released.stdout);
    expect((await run('undo', ['--claim', 'edit', '--operation-id', 'terminal', '--expected-revision', '1'])).json.diagnostic.code).toBe('CLI_CLAIM_INACTIVE');
    const fresh = ['--claim', 'fresh', '--scope', 'branch', '--operation-id', 'acquire-fresh', '--expected-revision', '1'];
    expect((await run('claim-acquire', fresh)).code).toBe(0);
    expect((await readCredential(path, 'fresh')).secret).not.toBe(credential.secret);
    now = 61_001;
    expect((await run('undo', ['--claim', 'fresh', '--operation-id', 'expired', '--expected-revision', '1'])).code).toBe(4);
    expect((await run('head')).json.revision).toBe(1);
    await f.writeSession(service.url, f.project, randomBytes(32).toString('base64url'));
    expect((await run('undo', ['--claim', 'fresh', '--operation-id', 'restart', '--expected-revision', '1'])).json.diagnostic.code).toBe('CLI_SESSION_CHANGED');
    for (const result of [workspace, acquire, renewed, released]) {
      expect(result.stdout + result.stderr).not.toContain(credential.secret);
      expect(result.stdout + result.stderr).not.toContain(f.capability);
    }
  } finally { await service.close(); await f.cleanup(); }
}, 20_000);

for (const stage of ['pending', 'committed'] as const) test(`recovers exact acquire after process death with ${stage} request`, async () => {
  const f = await fixture(); const seed = phase3Seed();
  const service = await startLocalMotionService({ databasePath: join(f.directory, 'project.sqlite'), seed,
    capabilities: { human: randomBytes(32).toString('base64url'), agent: f.capability } });
  let hold = true; let reached!: () => void; const barrier = new Promise<void>((resolve) => { reached = resolve; });
  const proxy = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    if (hold && stage === 'pending') { reached(); return; }
    const upstream = await fetch(`${service.url}${request.url}`, { method: request.method!,
      headers: Object.fromEntries(Object.entries(request.headers).filter(([key]) => !['host', 'connection', 'content-length'].includes(key))) as Record<string,string>,
      ...(body ? { body } : {}) });
    const output = await upstream.text();
    if (hold) { reached(); return; }
    response.writeHead(upstream.status, { 'content-type': 'application/json' }); response.end(output);
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const path = await f.writeSession(`http://127.0.0.1:${(proxy.address() as {port:number}).port}`);
  const args = ['claim-acquire', '--data-dir', f.dataDir, '--document-id', seed.documentId, '--claim', 'recover',
    '--scope', 'document', '--operation-id', 'recover-acquire', '--expected-revision', '0'];
  const process = startCli(args);
  try {
    await barrier; const before = await readCredential(path, 'recover');
    process.child.kill('SIGKILL'); await process.closed; hold = false; proxy.closeAllConnections();
    const recovered = await invoke(args); expect(recovered.json).toMatchObject({ ok: true, leaseVersion: 1 });
    expect((await readCredential(path, 'recover')).secret).toBe(before.secret);
    expect((await invoke(args)).stdout).toBe(recovered.stdout);
    const claims = await invoke(['claims', '--data-dir', f.dataDir, '--document-id', seed.documentId]);
    expect(claims.json.claims).toHaveLength(1);
    expect(recovered.stdout + recovered.stderr).not.toContain(before.secret);
    expect(args.join(' ')).not.toContain(before.secret); expect(args.join(' ')).not.toContain(f.capability);
  } finally { process.child.kill('SIGKILL'); await process.closed; proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve())); await service.close(); await f.cleanup(); }
}, 20_000);

test('concurrent processes publish one complete credential and preserve exact acquire identity', async () => {
  const f = await fixture(); const seed = phase3Seed();
  const service = await startLocalMotionService({ databasePath: join(f.directory, 'project.sqlite'), seed,
    capabilities: { human: randomBytes(32).toString('base64url'), agent: f.capability } });
  const path = await f.writeSession(service.url);
  const args = ['claim-acquire', '--data-dir', f.dataDir, '--document-id', seed.documentId,
    '--claim', 'concurrent', '--scope', 'document', '--operation-id', 'acquire-concurrent', '--expected-revision', '0'];
  try {
    const [a, b] = await Promise.all([invoke(args), invoke(args)]);
    expect(a.code).toBe(0); expect(b.stdout).toBe(a.stdout);
    const credential = await readCredential(path, 'concurrent');
    expect(credential.acquireOperationId).toBe('acquire-concurrent');
    const changed = args.map((arg) => arg === 'acquire-concurrent' ? 'different-acquire' : arg);
    expect((await invoke(changed)).json.diagnostic.code).toBe('CLI_CLAIM_HANDLE_USED');
    const claims = await invoke(['claims', '--data-dir', f.dataDir, '--document-id', seed.documentId]);
    expect(claims.json.claims).toHaveLength(1);
    expect((await readCredential(path, 'concurrent')).secret).toBe(credential.secret);
  } finally { await service.close(); await f.cleanup(); }
}, 10_000);
