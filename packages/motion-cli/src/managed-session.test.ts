import { expect, test } from 'vitest';
import { chmod, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createServer } from 'node:http';
import { execFileSync } from 'node:child_process';
import { loadSession } from './session-context.ts';
import { checkout, fixture, invoke } from './managed-test-support.ts';

test('finds exactly this checkout from nested directories and requires explicit project disambiguation', async () => {
  const f = await fixture();
  try {
    await f.writeSession('http://127.0.0.1:1234');
    expect((await invoke(['context', '--data-dir', f.dataDir], join(checkout, 'packages/motion-cli'))).json)
      .toMatchObject({ project: f.project, actor: 'agent', branchId: 'main' });
    await f.writeSession('http://127.0.0.1:1235', 'Other');
    expect((await invoke(['context', '--data-dir', f.dataDir])).json.diagnostic.code).toBe('CLI_PROJECT_AMBIGUOUS');
    expect((await invoke(['projects', '--data-dir', f.dataDir])).json.projects).toEqual(['Other', f.project]);
    expect((await invoke(['context', '--data-dir', f.dataDir, '--project', 'Other'])).json.project).toBe('Other');
    const otherCheckout = join(f.directory, 'other-checkout'); await mkdir(otherCheckout);
    execFileSync('git', ['init', '--quiet', otherCheckout]);
    expect(() => loadSession(undefined, f.dataDir, otherCheckout)).toThrow('CLI_SESSION_NOT_FOUND');
    await f.writeSession('http://127.0.0.1:1236', f.project, f.capability, otherCheckout);
    expect(loadSession(f.project, f.dataDir, otherCheckout).service).toBe('http://127.0.0.1:1236');
    expect(loadSession(f.project, f.dataDir, checkout).service).toBe('http://127.0.0.1:1234');
    execFileSync('git', ['-C', otherCheckout, '-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid',
      'commit', '--allow-empty', '--quiet', '-m', 'Synthetic session isolation fixture']);
    const otherWorktree = join(f.directory, 'other-worktree');
    execFileSync('git', ['-C', otherCheckout, 'worktree', 'add', '--quiet', '--detach', otherWorktree]);
    expect(() => loadSession(f.project, f.dataDir, otherWorktree)).toThrow('CLI_SESSION_NOT_FOUND');
    await f.writeSession('http://127.0.0.1:1237', f.project, f.capability, otherWorktree);
    expect(loadSession(f.project, f.dataDir, otherWorktree).service).toBe('http://127.0.0.1:1237');
    expect(loadSession(f.project, f.dataDir, otherCheckout).service).toBe('http://127.0.0.1:1236');
  } finally { await f.cleanup(); }
});
test('rejects nonlocal endpoints, malformed sessions, unsafe permissions and symlinks without leaking secrets', async () => {
  const f = await fixture(); const path = await f.writeSession('http://127.0.0.1:1234');
  try {
    const session = JSON.parse(await readFile(path, 'utf8'));
    for (const serviceUrl of ['https://example.com', 'http://localhost:1234', 'http://127.0.0.1:1234/redirect',
      'http://secret@127.0.0.1:1234', 'http://127.0.0.1:1234/?token=secret', 'file:///secret']) {
      await writeFile(path, JSON.stringify({ ...session, serviceUrl }));
      const response = await invoke(['head', '--data-dir', f.dataDir, '--document-id', 'doc']);
      expect(response.json.diagnostic.code).toBe('CLI_SESSION_UNSAFE');
      expect(response.stdout + response.stderr).not.toContain(f.capability);
      expect(response.stdout + response.stderr).not.toContain(f.directory);
    }
    await writeFile(path, JSON.stringify(session)); await chmod(path, 0o644);
    expect(() => loadSession(undefined, f.dataDir)).toThrow('CLI_SESSION_UNSAFE');
    await chmod(path, 0o600); await writeFile(path, '{ malformed private-sentinel');
    expect(() => loadSession(undefined, f.dataDir)).toThrow('CLI_SESSION_INVALID');
    const target = join(f.directory, 'unsafe.json'); await writeFile(target, JSON.stringify(session), { mode: 0o600 });
    await rm(path); await symlink(target, path);
    expect(() => loadSession(undefined, f.dataDir)).toThrow('CLI_SESSION_UNSAFE');
    await rm(path); await f.writeSession('http://127.0.0.1:1234');
    await chmod(dirname(path), 0o777);
    expect(() => loadSession(undefined, f.dataDir)).toThrow('CLI_SESSION_UNSAFE');
  } finally { await f.cleanup(); }
});
test('does not forward a capability across a redirect', async () => {
  const f = await fixture(); let targetRequests = 0;
  const target = createServer((_request, response) => { targetRequests++; response.end('{}'); });
  await new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve));
  const redirect = createServer((_request, response) => {
    response.writeHead(302, { location: `http://127.0.0.1:${(target.address() as {port: number}).port}` }); response.end(); });
  await new Promise<void>((resolve) => redirect.listen(0, '127.0.0.1', resolve));
  try {
    await f.writeSession(`http://127.0.0.1:${(redirect.address() as {port: number}).port}`);
    const result = await invoke(['head', '--data-dir', f.dataDir, '--document-id', 'doc']);
    expect(result.code).toBe(7); expect(targetRequests).toBe(0); expect(result.stdout + result.stderr).not.toContain(f.capability);
  } finally { redirect.closeAllConnections(); target.closeAllConnections(); await Promise.all([
    new Promise<void>((resolve) => redirect.close(() => resolve())), new Promise<void>((resolve) => target.close(() => resolve()))]); await f.cleanup(); }
});

test('accepts only the legacy session or the exact stored-project-ID extension and binds its fingerprint', async () => {
  const f = await fixture(); const path = await f.writeSession('http://127.0.0.1:1234');
  try {
    const original = JSON.parse(await readFile(path, 'utf8'));
    const oldContext = loadSession(undefined, f.dataDir); expect(oldContext.projectId).toBeUndefined();
    await writeFile(path, JSON.stringify({ ...original, projectId: 'saved_project_01' }));
    const stored = loadSession(undefined, f.dataDir); expect(stored.projectId).toBe('saved_project_01');
    expect(stored.fingerprint).not.toBe(oldContext.fingerprint);
    expect((await invoke(['context', '--data-dir', f.dataDir])).json).toMatchObject({ project: f.project, projectId: 'saved_project_01' });
    await writeFile(path, JSON.stringify({ ...original, projectId: 'different_project' }));
    expect(loadSession(undefined, f.dataDir).fingerprint).not.toBe(stored.fingerprint);
    for (const extension of [{ projectId: null }, { projectId: 1 }, { projectId: '' }, { projectId: '../unsafe' },
      { projectId: 'x'.repeat(129) }, { projectId: 'saved_project_01', unknown: 'private-sentinel' }]) {
      await writeFile(path, JSON.stringify({ ...original, ...extension }));
      expect(() => loadSession(undefined, f.dataDir)).toThrow('CLI_SESSION_INVALID');
    }
  } finally { await f.cleanup(); }
});

test('catalog validation prefers stored identity over launcher display name and rejects a different ID', async () => {
  const f = await fixture(); let name = 'My animation';
  const service = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ schemaVersion: 'motion.project-catalog.v1', projectId: 'stored_project', name,
      catalogRevision: 0, catalogDigest: 'a'.repeat(64), shots: [] }));
  });
  await new Promise<void>((resolve) => service.listen(0, '127.0.0.1', resolve));
  const path = await f.writeSession(`http://127.0.0.1:${(service.address() as {port: number}).port}`);
  try {
    const original = JSON.parse(await readFile(path, 'utf8'));
    await writeFile(path, JSON.stringify({ ...original, projectId: 'stored_project' }));
    expect((await invoke(['project', '--data-dir', f.dataDir])).json).toMatchObject({ projectId: 'stored_project', name: 'My animation' });
    name = f.project;
    await writeFile(path, JSON.stringify({ ...original, projectId: 'wrong_project' }));
    expect((await invoke(['project', '--data-dir', f.dataDir])).json.diagnostic.code).toBe('CLI_PROJECT_MISMATCH');
  } finally { service.closeAllConnections(); await new Promise<void>((resolve) => service.close(() => resolve())); await f.cleanup(); }
});
