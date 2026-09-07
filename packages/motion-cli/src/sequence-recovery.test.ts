import { expect, test } from 'vitest';
import { createServer } from 'node:http';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { MotionServiceClient, makeTrackCreateCommand } from '../../motion-protocol/src/index.ts';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { sequenceFixture } from './sequence-test-support.ts';
import { invoke, startCli } from './managed-test-support.ts';

test('killed CLI recovers create, source-pinned edit, renewal and release using the exact private request', async () => {
  const f = await sequenceFixture(); let blockOperation: string | undefined; let reached: (() => void) | undefined;
  const proxy = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString('utf8');
      const upstream = await fetch(`${f.service.url}${request.url}`, { method: request.method!,
        headers: Object.fromEntries(Object.entries(request.headers).filter(([key]) => !['host', 'connection', 'content-length'].includes(key))) as Record<string, string>,
        ...(body ? { body } : {}) });
      const output = await upstream.text();
      if (body && JSON.parse(body).operationId === blockOperation) { reached?.(); return; }
      response.writeHead(upstream.status, { 'content-type': 'application/json' }); response.end(output);
    } catch { response.writeHead(503); response.end('{}'); }
  });
  await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
  const path = await f.writeSession(`http://127.0.0.1:${(proxy.address() as { port: number }).port}`);
  const session = JSON.parse(await readFile(path, 'utf8'));
  await writeFile(path, JSON.stringify({ ...session, projectId: 'sequence_project' }));
  const common = [...f.common, '--sequence-id', 'story', '--claim', 'story'];
  const args = (name: string, revision: number, op: string, extra: string[] = []) => [name, ...common, '--expected-revision', String(revision), '--operation-id', op, ...extra];
  const loseResponse = async (command: string[]) => {
    blockOperation = command[command.indexOf('--operation-id') + 1];
    const barrier = new Promise<void>(resolve => { reached = resolve; }); const child = startCli(command);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([barrier, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('COMMIT_NOT_REACHED')), 7000); })]); }
    finally { clearTimeout(timer); child.child.kill('SIGKILL'); await child.closed; blockOperation = undefined; proxy.closeAllConnections(); }
  };
  try {
    const create = args('sequence-create', 0, 'create', ['--name', 'Story', '--viewport-width', '320', '--viewport-height', '180']);
    await loseResponse(create);
    expect((await invoke(args('sequence-rename', 0, 'premature', ['--name', 'Premature']))).json.diagnostic.code).toBe('CLI_CLAIM_PENDING');
    const directory = join(dirname(path), 'agent-sequence-claims', 'story');
    const credential = await readFile(join(directory, 'credential.json'), 'utf8');
    const created = await invoke(create); expect(created.json).toMatchObject({ ok: true, revision: 0, claim: { leaseVersion: 1 } });
    expect((await invoke(create)).stdout).toBe(created.stdout);
    expect(await readFile(join(directory, 'credential.json'), 'utf8')).toBe(credential);
    const add = args('sequence-clip-add', 0, 'add-three', ['--clip-id', 'three', '--name', 'Three seconds', '--index', '0', '--source-document-id', 'shot_three', '--source-revision', '0']);
    await loseResponse(add);
    const document = f.service.store.readHead('shot_three')!.document;
    expect(await new MotionServiceClient(f.service.url, fetch, f.auth).dispatch(makeTrackCreateCommand({ operationId: 'source-change',
      documentId: document.documentId, expectedRevision: 0, elementId: document.elements.find(element => element.selectorHint === '.tile')!.id }))).toMatchObject({ ok: true });
    const recovered = await invoke(add); expect(recovered.json).toMatchObject({ ok: true, revision: 1 });
    expect((await invoke(add)).stdout).toBe(recovered.stdout);
    expect(f.service.store.readSequence('story', 1000)!.sequence.clips).toMatchObject([{ clipId: 'three', source: { revision: 0 } }]);
    expect((await invoke(add.map(value => value === 'Three seconds' ? 'Changed input' : value))).json.diagnostic.code).toBe('CLI_CLAIM_REQUEST_CONFLICT');
    const renew = args('sequence-claim-renew', 1, 'renew', ['--lease-version', '1']);
    await loseResponse(renew); expect((await invoke(renew)).json).toMatchObject({ ok: true, claim: { leaseVersion: 2 } });
    const release = args('sequence-claim-release', 1, 'release', ['--lease-version', '2']);
    await loseResponse(release); const released = await invoke(release);
    expect(released.json).toMatchObject({ ok: true, claim: { leaseVersion: 3 } });
    expect((await invoke(release)).stdout).toBe(released.stdout);
    expect((await invoke(add)).stdout).toBe(recovered.stdout);
    expect((await invoke(args('sequence-rename', 1, 'after-release', ['--name', 'Blocked']))).json.diagnostic.code).toBe('CLI_CLAIM_INACTIVE');
    const acquire = args('sequence-claim-acquire', 1, 'acquire-again');
    acquire[acquire.indexOf('--claim') + 1] = 'again';
    await loseResponse(acquire); const acquired = await invoke(acquire);
    expect(acquired.json).toMatchObject({ ok: true, claim: { leaseVersion: 1 } });
    const revoke = await invoke(['sequence-claim-revoke', '--service', f.service.url, '--actor', 'human', '--capability', f.auth.capability,
      '--sequence-id', 'story', '--expected-revision', '1', '--operation-id', 'revoke-again', '--claim-id', acquired.json.claim.claimId, '--lease-version', '1']);
    expect(revoke.json).toMatchObject({ ok: true, claim: { leaseVersion: 2 } });
    expect((await invoke(acquire)).stdout).toBe(acquired.stdout);
    expect((await invoke(args('sequence-rename', 1, 'revoked', ['--name', 'Blocked']).map((value, index, input) => input[index - 1] === '--claim' ? 'again' : value))).json.code).toBe('SEQUENCE_CLAIM_EXPIRED');
    expect(f.service.store.listSequences(1000).sequences).toHaveLength(1);
    expect(f.service.store.readSequence('story', 1000)!.sequence.revision).toBe(1);
    for (const result of [created, recovered, released]) {
      expect(result.stdout + result.stderr).not.toContain(JSON.parse(credential).secret);
      expect(result.stdout + result.stderr).not.toContain(f.capability);
      expect(result.stdout + result.stderr).not.toContain(f.directory);
    }
  } finally { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); await f.cleanup(); }
}, 25_000);

test('restart preserves sequence/export and requires a fresh managed claim context for the new endpoint', async () => {
  const f = await sequenceFixture();
  try {
    const result = await f.mutate('sequence-create', 0, 'create-story', ['--name', 'Story', '--viewport-width', '320', '--viewport-height', '180',
      '--clip-id', 'opening', '--clip-name', 'Opening', '--source-document-id', 'shot_two', '--source-revision', '0']);
    expect(result.code).toBe(0);
    const before = (await f.read()).json;
    const first = join(f.directory, 'before.zip'); const second = join(f.directory, 'after.zip');
    expect((await f.read('sequence-export', ['--expected-revision', '0', '--output', first])).code).toBe(0);
    await f.service.close();
    const restarted = await startLocalMotionService(f.settings);
    try {
      await f.writeSession(restarted.url);
      expect((await f.read()).json).toEqual(before);
      expect((await f.read('sequence-export', ['--expected-revision', '0', '--output', second])).code).toBe(0);
      expect(await readFile(first)).toEqual(await readFile(second));
      expect((await f.mutate('sequence-rename', 0, 'old-context', ['--name', 'Old'])).json.diagnostic.code).toBe('CLI_SESSION_CHANGED');
    } finally { await restarted.close(); }
  } finally { await rm(f.directory, { recursive: true, force: true }); }
}, 12_000);
