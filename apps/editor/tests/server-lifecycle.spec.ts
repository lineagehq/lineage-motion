import { expect, test } from './test-fixture.ts';
import { mkdtemp, rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { MotionServiceClient, makeTrackCreateCommand, makeTrajectoryCommand } from '../../../packages/motion-protocol/src/index.ts';
import { createPhase3Seed } from '../../../packages/local-service/src/seed.ts';
import { spawnTestServer, waitForTestServer, stopTestServer, serverDiagnostic } from './test-server.ts';

const root = resolve(import.meta.dirname, '../../..');
const launcher = [resolve(root, 'node_modules/vite-node/vite-node.mjs'), resolve(root, 'apps/editor/scripts/serve-editor.mjs')];
const capability = () => randomBytes(32).toString('base64url');
function start(directory: string, human: string, port = 0) {
  return spawnTestServer(process.execPath, launcher, { cwd: root, env: { ...process.env,
    PHASE3_DATABASE_PATH: join(directory, 'project.sqlite'), PHASE3_EDITOR_PORT: String(port),
    PHASE3_HUMAN_CAPABILITY: human, PHASE3_AGENT_CAPABILITY: capability() }, stdio: ['ignore', 'pipe', 'pipe'] });
}
async function unreachable(url: string) {
  await expect.poll(async () => {
    try { await fetch(url, { signal: AbortSignal.timeout(500) }); return false; } catch { return true; }
  }).toBe(true);
}

test('20 real startup/edit/stop cycles include concurrent isolated instances and reopen released database locks', async () => {
  test.setTimeout(120000);
  const documentId = createPhase3Seed(root).documentId;
  for (let batch = 0; batch < 5; batch += 1) {
    const outcomes = await Promise.allSettled([0, 1].map(async (instance) => {
      const directory = await mkdtemp(join(tmpdir(), 'motion-lifecycle-')); const human = capability();
      try {
        for (let revision = 0; revision < 2; revision += 1) {
          const child = start(directory, human);
          let addresses: { editorUrl: string; serviceUrl: string } | undefined;
          try {
            addresses = await waitForTestServer(child);
            expect((await fetch(addresses.editorUrl)).ok).toBe(true);
            const client = new MotionServiceClient(addresses.serviceUrl, fetch, { actor: 'human', capability: human });
            const before = await client.head(documentId); expect(before.document.revision).toBe(revision);
            const operationId = `cycle-${batch}-${instance}-${revision}`;
            const command = revision === 0 ? makeTrackCreateCommand({ operationId, documentId, expectedRevision: revision, elementId: 'el_2dbee68b1ea318c8' })
              : makeTrajectoryCommand({ schemaVersion: 'motion.operation.v1', kind: 'motion.history.undo', operationId, documentId, expectedRevision: revision });
            const result = await client.dispatch(command);
            expect(result).toMatchObject({ ok: true, resultingRevision: revision + 1 });
          } finally { await stopTestServer(child); }
          expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
          if (addresses) { await unreachable(addresses.editorUrl); await unreachable(addresses.serviceUrl); }
        }
      } finally { await rm(directory, { recursive: true, force: true }); }
    }));
    for (const outcome of outcomes) if (outcome.status === 'rejected') throw outcome.reason;
  }
});

test('occupied editor port fails with its actual diagnostic and a port-zero restart succeeds', async () => {
  const listener = createServer(); await new Promise<void>((resolveListen) => listener.listen(0, '127.0.0.1', resolveListen));
  const address = listener.address(); if (!address || typeof address === 'string') throw new Error('listener unavailable');
  const directory = await mkdtemp(join(tmpdir(), 'motion-occupied-')); const human = capability();
  try {
    const child = start(directory, human, address.port);
    await expect(waitForTestServer(child)).rejects.toThrow(/(?:already in use|EADDRINUSE)/);
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(listener.listening).toBe(true);
    const replacement = start(directory, human);
    try { expect((await fetch((await waitForTestServer(replacement)).editorUrl)).ok).toBe(true); }
    finally { await stopTestServer(replacement); }
  } finally {
    await new Promise<void>((done) => listener.close(() => done()));
    await rm(directory, { recursive: true, force: true });
  }
});

test('early exit, missing executable, and timeout are bounded and readable without credentials', async ({}, testInfo) => {
  const secret = capability();
  const child = spawnTestServer(process.execPath, ['-e',
    'process.stderr.write("injected early failure token=" + process.env.TEST_SECRET + "\\n"); process.exit(7)'],
  { env: { ...process.env, TEST_SECRET: secret }, stdio: ['ignore', 'pipe', 'pipe'] });
  await expect(waitForTestServer(child)).rejects.toThrow('TEST_SERVER_EXIT_7');
  const text = serverDiagnostic(child); expect(text).toContain('injected early failure'); expect(text).not.toContain(secret);
  await testInfo.attach('injected-server-diagnostic', { body: text, contentType: 'text/plain' });
  const missing = spawnTestServer('/nonexistent-motion-test-command', [], { stdio: ['ignore', 'pipe', 'pipe'] });
  await expect(waitForTestServer(missing, 500)).rejects.toThrow('TEST_SERVER_SPAWN_ERROR');
  const waiting = spawnTestServer(process.execPath, ['-e', 'process.stderr.write("no ready address\\n"); setInterval(() => {}, 1000)'],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  await expect(waitForTestServer(waiting, 250)).rejects.toThrow('TEST_SERVER_TIMEOUT');
  expect(waiting.exitCode !== null || waiting.signalCode !== null).toBe(true);
  if (process.env.MOTION_DIAGNOSTIC_PROBE === '1') expect('injected deliberate failure').toBe('success');
});

test('interrupted worker closes its detached service child and releases the listener', async () => {
  const helper = new URL('./test-server.ts', import.meta.url).href;
  const server = 'const h = require("node:http").createServer((q,r) => r.end("ok")); h.listen(0,"127.0.0.1", () => { const u = "http://127.0.0.1:" + h.address().port; console.log(JSON.stringify({editorUrl:u,serviceUrl:u})); });';
  const worker = `import { spawnTestServer, waitForTestServer } from ${JSON.stringify(helper)};
    const child = spawnTestServer(process.execPath, ['-e', ${JSON.stringify(server)}], {stdio:['ignore','pipe','pipe']});
    console.log(JSON.stringify(await waitForTestServer(child))); setInterval(() => {}, 1000);`;
  const child = spawnTestServer(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', worker],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const addresses = await waitForTestServer(child);
  expect((await fetch(addresses.editorUrl)).ok).toBe(true);
  // Model Playwright terminating the worker, not a test's ordinary afterEach cleanup.
  child.kill('SIGTERM');
  await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true);
  await unreachable(addresses.editorUrl);
});

test('a server ignoring termination is forcibly stopped within the cleanup bound', async () => {
  const source = 'process.on("SIGTERM", () => {}); console.log(JSON.stringify({editorUrl:"http://127.0.0.1:1",serviceUrl:"http://127.0.0.1:1"})); setInterval(() => {}, 1000);';
  const child = spawnTestServer(process.execPath, ['-e', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  await waitForTestServer(child);
  const started = Date.now(); await stopTestServer(child);
  expect(Date.now() - started).toBeLessThan(4000); expect(child.signalCode).toBe('SIGKILL');
});

test('noisy diagnostics remain bounded and redact credentials split across stream chunks', async () => {
  const secret = capability();
  const source = 'process.stderr.write("x".repeat(9000) + process.env.TEST_SECRET + "\\nreadable failure\\n");' +
    'process.stderr.write(process.env.TEST_SECRET.slice(0,20)); setTimeout(() => { process.stderr.write(process.env.TEST_SECRET.slice(20) + "\\n"); process.exit(9); }, 20);';
  const child = spawnTestServer(process.execPath, ['-e', source], {
    env: { ...process.env, TEST_SECRET: secret }, stdio: ['ignore', 'pipe', 'pipe'] });
  await expect(waitForTestServer(child)).rejects.toThrow('TEST_SERVER_EXIT_9');
  const diagnostic = serverDiagnostic(child);
  expect(diagnostic.length).toBeLessThanOrEqual(8192);
  expect(diagnostic).toContain('readable failure'); expect(diagnostic).toContain('[redacted]');
  expect(diagnostic).not.toContain(secret); expect(diagnostic).not.toContain(secret.slice(20));
});

test('worker interruption during graceful stop still reaps a signal-resistant detached child', async () => {
  const helper = new URL('./test-server.ts', import.meta.url).href;
  const server = 'process.on("SIGTERM",()=>{}); const h = require("node:http").createServer((q,r)=>r.end("ok"));' +
    'h.listen(0,"127.0.0.1",()=>{ const u="http://127.0.0.1:"+h.address().port+"/?pid="+process.pid; console.log(JSON.stringify({editorUrl:u,serviceUrl:u})); });';
  const worker = `import { spawnTestServer, waitForTestServer, stopTestServer } from ${JSON.stringify(helper)};
    const child = spawnTestServer(process.execPath, ['-e', ${JSON.stringify(server)}], {stdio:['ignore','pipe','pipe']});
    const addresses = await waitForTestServer(child); void stopTestServer(child);
    console.log(JSON.stringify(addresses)); setInterval(() => {}, 1000);`;
  const child = spawnTestServer(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', worker],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  const addresses = await waitForTestServer(child);
  const servicePid = Number(new URL(addresses.editorUrl).searchParams.get('pid'));
  try {
    expect((await fetch(addresses.editorUrl)).ok).toBe(true);
    child.kill('SIGTERM');
    await expect.poll(() => child.exitCode !== null || child.signalCode !== null).toBe(true);
    await unreachable(addresses.editorUrl);
    expect(() => process.kill(servicePid, 0)).toThrow();
  } finally {
    // The negative-control implementation must not leave the intentionally stubborn child behind.
    try { process.kill(-servicePid, 'SIGKILL'); } catch { /* Already reaped. */ }
    await stopTestServer(child);
  }
});

test('an oversized unterminated line discards a credential suffix arriving in a later chunk', async () => {
  const secret = capability();
  const source = 'process.stderr.write("x".repeat(9000)+process.env.TEST_SECRET.slice(0,20));' +
    'setTimeout(()=>{ process.stderr.write(process.env.TEST_SECRET.slice(20)+"\\nnext readable failure\\n"); process.exit(9); },100);';
  const child = spawnTestServer(process.execPath, ['-e', source], {
    env: { ...process.env, TEST_SECRET: secret }, stdio: ['ignore', 'pipe', 'pipe'] });
  await expect(waitForTestServer(child)).rejects.toThrow('TEST_SERVER_EXIT_9');
  const diagnostic = serverDiagnostic(child);
  expect(diagnostic).toContain('next readable failure');
  expect(diagnostic).not.toContain(secret.slice(20));
  expect(diagnostic).not.toContain(secret); expect(diagnostic.length).toBeLessThanOrEqual(8192);
});
