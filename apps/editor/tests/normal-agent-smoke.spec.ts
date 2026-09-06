import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, test } from './test-fixture.ts';
import { spawnTestServer, waitForTestServer, stopTestServer } from './test-server.ts';

const root = resolve(import.meta.dirname, '../../..');

// Invoke the shipped executable entry, rather than importing runCli into the test.
async function cli(args: string[]) {
  const env = { ...process.env }; delete env.FORCE_COLOR;
  return new Promise<{ code: number; stdout: string; stderr: string }>((done) => {
    execFile(process.execPath, ['--import', 'tsx', resolve(root, 'packages/motion-cli/src/cli.ts'), ...args],
      { cwd: root, env, encoding: 'utf8', timeout: 15000 }, (error, stdout, stderr) => {
        // A child-process Error includes argv (and capabilities); never throw or print it.
        done({ code: error ? typeof error.code === 'number' ? error.code : 1 : 0, stdout, stderr });
      });
  });
}

test('managed normal launch shares human edits and claimed real-CLI edits without accepting stale writes', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-normal-agent-smoke-'));
  // This is the managed entry behind dev:editor; normal-startup.spec also proves its npm wrapper.
  const child = spawnTestServer(process.execPath, ['--import', 'tsx', resolve(root, 'apps/editor/scripts/dev-editor.mjs'),
    '--data-dir', directory, '--project', 'CI smoke', '--port', '0'],
  { cwd: root, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout!.on('data', (chunk) => { output = (output + chunk.toString()).slice(-16000); });
  try {
    const addresses = await waitForTestServer(child);
    const sessionPath = output.split('\n').find((line) => line.startsWith('Local agent session: '))?.slice(21);
    if (!sessionPath) throw new Error('SMOKE_SESSION_NOT_READY');
    const session = JSON.parse(await readFile(sessionPath, 'utf8'));
    expect(session.project).toBe('CI smoke');
    expect(output.includes(session.agentCapability)).toBe(false);
    await page.goto(addresses.editorUrl);
    await page.getByRole('radio', { name: /Orb/ }).check();
    await page.locator('[data-create-track]').click();
    await expect(page.locator('[data-operation-status]')).toContainText('Revision 1');
    const initial = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    const common = ['--service', addresses.serviceUrl, '--document-id', initial.documentId,
      '--branch-id', 'main', '--actor', 'agent', '--capability', session.agentCapability];
    const secrets = [session.agentCapability];
    const invoke = async (args: string[], expectedCode = 0) => {
      const result = await cli(args);
      expect(result.code).toBe(expectedCode); expect(result.stderr.length === 0).toBe(true);
      expect(secrets.some((secret) => result.stdout.includes(secret))).toBe(false);
      try { return JSON.parse(result.stdout); } catch { throw new Error('SMOKE_CLI_RESPONSE_INVALID'); }
    };
    expect(await invoke(['head', ...common])).toMatchObject({ revision: 1 });
    const secretResult = await cli(['claim-secret']);
    expect(secretResult.code).toBe(0); expect(secretResult.stderr.length === 0).toBe(true);
    const secret = secretResult.stdout.trim(); expect(/^[A-Za-z0-9_-]{43}$/.test(secret)).toBe(true); secrets.push(secret);
    const claim = await invoke(['claim-acquire', ...common, '--operation-id', 'smoke-claim',
      '--expected-revision', '1', '--scope', 'document', '--claim-secret', secret]);
    expect(claim).toMatchObject({ ok: true, leaseVersion: 1 });
    expect(await invoke(['undo', ...common, '--operation-id', 'smoke-agent-undo',
      '--expected-revision', '1', '--claim-secret', secret])).toMatchObject({ ok: true, resultingRevision: 2 });
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(2);
    expect(await invoke(['redo', ...common, '--operation-id', 'smoke-agent-redo',
      '--expected-revision', '2', '--claim-secret', secret])).toMatchObject({ ok: true, resultingRevision: 3 });
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(3);
    expect(await invoke(['undo', ...common, '--operation-id', 'smoke-stale',
      '--expected-revision', '1', '--claim-secret', secret], 3)).toMatchObject({ ok: false, code: 'STALE_REVISION' });
    expect(await invoke(['claim-release', ...common, '--operation-id', 'smoke-release', '--expected-revision', '3',
      '--claim-id', claim.claimId, '--lease-version', '1', '--claim-secret', secret])).toMatchObject({ ok: true });
    await page.reload(); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
    const current = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    expect(current.revision).toBe(3); expect(current.contentDigest).toBe(initial.contentDigest);
    expect(await invoke(['export-proof', ...common])).toMatchObject({ revision: 3, exportDigest: current.exportDigest });
    expect(await page.evaluate(() => {
      const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      const animations = frame.contentDocument!.getAnimations();
      return frame.srcdoc === window.__motionEditor.compiledHtml && animations.length > 0
        && animations.every((animation) => animation.constructor.name === 'CSSAnimation');
    })).toBe(true);
    await page.close(); await stopTestServer(child);
    await expect(stat(sessionPath)).rejects.toThrow();
  } finally { await stopTestServer(child); await rm(directory, { recursive: true, force: true }); }
});
