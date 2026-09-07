import { expect, test } from 'vitest';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { createTrajectorySeed } from '../../local-service/src/seed.ts';
import { phase3Seed } from '../../local-service/src/test-support.ts';
import { fixture, invoke, readCredential, startCli } from './managed-test-support.ts';

test('immutable managed admission recovers committed response loss, rejects changed source, and authorizes the new shot', async () => {
  const f = await fixture(); const service = await startLocalMotionService({ databasePath: join(f.directory, 'project.sqlite'), seed: phase3Seed(),
    capabilities: { human: randomBytes(32).toString('base64url'), agent: f.capability }, project: { projectId: 'synthetic_project', name: f.project } });
  let hold = true; let reached!: () => void; const barrier = new Promise<void>((resolve) => { reached = resolve; });
  const proxy = createServer(async (request, response) => {
    const chunks = []; for await (const chunk of request) chunks.push(chunk); const body = Buffer.concat(chunks).toString();
    const upstream = await fetch(`${service.url}${request.url}`, { method: request.method!,
      headers: Object.fromEntries(Object.entries(request.headers).filter(([key]) => !['host', 'connection', 'content-length'].includes(key))) as Record<string,string>,
      ...(body ? { body } : {}) });
    const output = await upstream.text();
    if (hold) { reached(); return; }
    response.writeHead(upstream.status, { 'content-type': 'application/json' }); response.end(output);
  });
  await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
  const path = await f.writeSession(`http://127.0.0.1:${(proxy.address() as {port:number}).port}`);
  const sourceFile = join(f.directory, 'shot.html');
  await writeFile(sourceFile, '<style>@keyframes drift{from{transform:translateX(0px)}to{transform:translateX(40px)}}.moving{animation:drift 4.25s linear forwards}</style><div class="moving" aria-label="Moving tile"></div><div aria-label="Title">Synthetic source sentinel</div>');
  const args = ['shot-admit', '--data-dir', f.dataDir, '--project-id', 'synthetic_project', '--expected-catalog-revision', '0',
    '--document-id', 'new_document', '--name', 'New shot', '--claim', 'new', '--html-file', sourceFile, '--operation-id', 'admit-new'];
  const child = startCli(args);
  try {
    await barrier; const pending = await readCredential(path, 'new'); child.child.kill('SIGKILL'); await child.closed;
    hold = false; proxy.closeAllConnections();
    const blocked = await invoke(['undo', '--data-dir', f.dataDir, '--document-id', 'new_document', '--claim', 'new',
      '--expected-revision', '0', '--operation-id', 'before-recovery']);
    expect(blocked.json.diagnostic.code).toBe('CLI_CLAIM_PENDING');
    const help = (await invoke(['help'])).json;
    expect(help.recovery[blocked.json.diagnostic.code]).toContain('shot-admit for admission');
    const recovered = await invoke(args); expect(recovered.json).toMatchObject({ ok: true, claim: { leaseVersion: 1 } });
    expect((await readCredential(path, 'new')).secret).toBe(pending.secret);
    expect((await invoke(args)).stdout).toBe(recovered.stdout);
    const catalog = await invoke(['project', '--data-dir', f.dataDir]); expect(catalog.json.shots).toHaveLength(2);
    await writeFile(sourceFile, (await readFile(sourceFile, 'utf8')).replace('40px', '50px'));
    expect((await invoke(args)).json.diagnostic.code).toBe('CLI_CLAIM_REQUEST_CONFLICT');
    const workspace = await invoke(['workspace', '--data-dir', f.dataDir, '--document-id', 'new_document']);
    expect(workspace.json.durationMs).toBe(4250);
    const title = workspace.json.elements.find((element: any) => element.label === 'Title');
    expect(title.actions).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'fade', available: true })]));
    const invalid = await invoke(['track-create', '--data-dir', f.dataDir, '--document-id', 'new_document', '--claim', 'new',
      '--element-id', title.elementId, '--duration-seconds', '2.2', '--delay-seconds', '0.3', '--end-value', '1.1',
      '--operation-id', 'invalid-opacity', '--expected-revision', '0']);
    expect(invalid.code).toBe(2); expect(invalid.stdout).not.toContain('STORAGE_FAILURE');
    expect((await invoke(['head', '--data-dir', f.dataDir, '--document-id', 'new_document'])).json.revision).toBe(0);
    expect((await invoke(['track-create', '--data-dir', f.dataDir, '--document-id', 'new_document', '--claim', 'new',
      '--element-id', title.elementId, '--duration-seconds', '2.2', '--delay-seconds', '0.3', '--start-value', '0.08', '--end-value', '0.9',
      '--operation-id', 'imported-fade', '--expected-revision', '0'])).json).toMatchObject({ ok: true, resultingRevision: 1 });
    expect(recovered.stdout + recovered.stderr).not.toContain(pending.secret);
    expect(recovered.stdout + recovered.stderr).not.toContain('Synthetic source sentinel');
    const directory = join(path, '..', 'agent-claims/new');
    expect(await readFile(join(directory, 'credential.json'), 'utf8')).not.toContain('Synthetic source sentinel');
  } finally { child.child.kill('SIGKILL'); await child.closed; proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve())); await service.close(); await f.cleanup(); }
}, 20_000);

test('settled hold uses discovered targets and ordinary units beyond the old fixed boundary', async () => {
  const f = await fixture(); const seed = createTrajectorySeed(); seed.documentId = 'scaled_trajectory'; seed.durationMs *= 2;
  for (const cue of seed.cues) cue.timeMs *= 2;
  for (const app of seed.applications) {
    for (const slot of app.slots) { slot.durationMs *= 2; slot.delayMs *= 2; }
    for (const binding of app.bindings) binding.delayOverridesMs = binding.delayOverridesMs.map((delay) => delay * 2);
  }
  const service = await startLocalMotionService({ databasePath: join(f.directory, 'project.sqlite'), seed,
    capabilities: { human: randomBytes(32).toString('base64url'), agent: f.capability } });
  await f.writeSession(service.url);
  const common = ['--data-dir', f.dataDir, '--document-id', seed.documentId];
  try {
    const workspace = (await invoke(['workspace', ...common])).json;
    const targets = [...new Set(workspace.tracks.filter((track: any) => track.property === 'transform').map((track: any) => track.elementId))] as string[];
    expect((await invoke(['claim-acquire', ...common, '--claim', 'scaled', '--scope', 'document', '--operation-id', 'scaled-claim', '--expected-revision', '0'])).code).toBe(0);
    const args = ['settled-hold-set', ...common, '--claim', 'scaled', '--operation-id', 'scaled-hold', '--expected-revision', '0',
      ...targets.flatMap((id) => ['--element-id', id]), '--source-time-seconds', '4.2', '--settled-time-seconds', '3.64',
      '--landing-time-seconds', '1.68', '--boundary-time-seconds', '4.2'];
    expect((await invoke([...args, '--validate-only'])).json).toMatchObject({ valid: true });
    expect((await invoke(args)).json).toMatchObject({ ok: true, resultingRevision: 1 });
    expect((await invoke(['head', ...common])).json.revision).toBe(1);
  } finally { await service.close(); await f.cleanup(); }
}, 15_000);
