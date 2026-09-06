import { expect, test } from '@playwright/test';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
type Running = { child: ChildProcess; editorUrl: string; serviceUrl: string; output: () => string; stop: () => Promise<void> };
let directory = ''; const running: Running[] = [];
test.beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'motion-normal-start-')); });
test.afterEach(async () => { for (const app of running.splice(0)) await app.stop(); await rm(directory, { recursive: true, force: true }); });
async function launch(project = 'My animation', extra: string[] = [], checkout = root): Promise<Running> {
  const child = spawn('npm', ['run', 'dev:editor', '--', '--data-dir', directory, '--project', project, '--port', '0', ...extra],
    { cwd: checkout, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = ''; child.stdout!.on('data', (chunk) => { output += chunk.toString(); });
  child.stderr!.on('data', (chunk) => { output += chunk.toString(); });
  const stop = async () => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = new Promise<void>((done) => child.once('exit', () => done()));
    process.kill(-child.pid!, 'SIGTERM');
    await Promise.race([exited, new Promise<never>((_, reject) => {
      const timer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} reject(new Error('Launcher shutdown timed out')); }, 5000);
      timer.unref(); exited.then(() => clearTimeout(timer));
    })]);
  };
  let app: Running;
  try {
    const addresses = await new Promise<{ editorUrl: string; serviceUrl: string }>((done, reject) => {
      const timeout = setTimeout(() => reject(new Error('Normal launcher timed out')), 15000);
      child.stdout!.on('data', () => {
        const line = output.split('\n').find((value) => value.startsWith('{'));
        if (line) { clearTimeout(timeout); done(JSON.parse(line)); }
      });
      child.once('exit', () => { clearTimeout(timeout); reject(new Error(output)); });
    });
    app = { child, ...addresses, output: () => output, stop }; running.push(app); return app;
  } catch (error) { await stop(); throw error; }
}

test('ordinary command creates through public controls, survives restart, and isolates projects', async ({ page, context }) => {
  const app = await launch();
  await page.goto(app.editorUrl);
  await page.getByRole('radio', { name: /Orb/ }).check();
  await page.locator('[data-create-track]').click();
  await expect(page.locator('[data-operation-status]')).toContainText('Revision 1');
  const status = await page.locator('[data-operation-status]').textContent(); expect(status).not.toContain('SERVICE_REQUIRED');
  await page.screenshot({ path: test.info().outputPath('normal-created.png'), fullPage: true });
  const before = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  const folders = await readdir(directory); const projects = await readdir(join(directory, folders[0]!));
  const session = join(directory, folders[0]!, projects[0]!, 'session.json');
  const sessionValue = JSON.parse(await readFile(session, 'utf8'));
  expect((await stat(session)).mode & 0o777).toBe(0o600);
  expect(app.output()).not.toContain(sessionValue.agentCapability);
  await page.close(); await app.stop();
  await expect.poll(async () => { try { await fetch(app.serviceUrl + '/health'); return false; } catch { return true; } }).toBe(true);
  await expect(stat(session)).rejects.toThrow();
  const reopened = await launch(); const other = await launch('Second animation');
  expect(reopened.editorUrl).not.toBe(other.editorUrl);
  const firstPage = await context.newPage(); await firstPage.goto(reopened.editorUrl);
  await expect(firstPage.locator('[data-editor-ready="true"]')).toBeVisible();
  expect(await firstPage.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({
    revision: 1, contentDigest: before.contentDigest, exportDigest: before.exportDigest });
  const secondPage = await context.newPage(); await secondPage.goto(other.editorUrl);
  await expect(secondPage.locator('[data-editor-ready="true"]')).toBeVisible();
  expect(await secondPage.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(0);
  await firstPage.close(); await secondPage.close();
});

test('occupied port and unavailable storage fail with recovery instructions and release project lock', async () => {
  const occupied = createServer(); await new Promise<void>((done) => occupied.listen(0, '127.0.0.1', done));
  const address = occupied.address(); if (!address || typeof address === 'string') throw new Error('No port');
  try { await expect(launch('My animation', ['--port', String(address.port)])).rejects.toThrow('port is unavailable'); }
  finally { await new Promise<void>((done) => occupied.close(() => done())); }
  const recovered = await launch(); await recovered.stop();
  const file = join(directory, 'file'); await writeFile(file, 'synthetic');
  await expect(launch('Other', ['--data-dir', file])).rejects.toThrow('writable');
  const unwritable = join(directory, 'unwritable'); await mkdir(unwritable, { mode: 0o500 });
  try { await expect(launch('Other', ['--data-dir', unwritable])).rejects.toThrow('writable'); }
  finally { await chmod(unwritable, 0o700); }
});

test('missing service renders a retry screen without advertising saved edits', async ({ page }) => {
  const app = await launch();
  await page.route('**/api/v1/**', (route) => route.abort('connectionrefused'));
  await page.goto(app.editorUrl);
  await expect(page.getByRole('heading', { name: 'Your local project could not connect' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible();
  await expect(page.locator('[data-create-track]')).toHaveCount(0);
  await page.unroute('**/api/v1/**'); await page.getByRole('button', { name: 'Retry connection' }).click();
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
});


test('the same project name in a second worktree has independent storage', async ({ page, context }) => {
  const checkout = join(directory, 'second-checkout');
  execFileSync('git', ['worktree', 'add', '--detach', checkout, 'HEAD'], { cwd: root, stdio: 'ignore' });
  try {
    // Share installed dependencies only; app source and managed data identities remain separate.
    await symlink(join(root, 'node_modules'), join(checkout, 'node_modules'), 'dir');
    const first = await launch(); const second = await launch('My animation', [], checkout);
    await page.goto(first.editorUrl); await page.getByRole('radio', { name: /Orb/ }).check();
    await page.locator('[data-create-track]').click();
    await expect(page.locator('[data-operation-status]')).toContainText('Revision 1');
    const other = await context.newPage(); await other.goto(second.editorUrl);
    await expect(other.locator('[data-editor-ready="true"]')).toBeVisible();
    expect(await other.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(0);
    await other.getByRole('radio', { name: /Orb/ }).check(); await other.locator('[data-create-track]').click();
    await expect(other.locator('[data-operation-status]')).toContainText('Revision 1');
    await page.reload(); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
    await page.close(); await other.close(); await first.stop(); await second.stop();
  } finally {
    for (const app of running) await app.stop();
    await rm(join(checkout, 'node_modules'));
    execFileSync('git', ['worktree', 'remove', checkout], { cwd: root, stdio: 'ignore' });
  }
});


test('data directory containment rejects dot-prefix children and symlinks into the checkout', async () => {
  const name = `..local-data-${randomUUID()}`;
  const child = join(root, name);
  try {
    // Both absolute and relative spelling must fail before creating an in-Git directory.
    await expect(launch('Boundary', ['--data-dir', child])).rejects.toThrow('outside the checkout');
    await expect(launch('Boundary', ['--data-dir', name])).rejects.toThrow('outside the checkout');
    await expect(stat(child)).rejects.toThrow();
    await expect(launch('Boundary', ['--data-dir', root])).rejects.toThrow('outside the checkout');
    await mkdir(child);
    const alias = join(directory, 'outside-alias'); await symlink(child, alias, 'dir');
    await expect(launch('Boundary', ['--data-dir', alias])).rejects.toThrow('outside the checkout');
    expect(await readdir(child)).toEqual([]);
    const checkoutAlias = join(directory, 'checkout-alias'); await symlink(root, checkoutAlias, 'dir');
    await expect(launch('Boundary', ['--data-dir', checkoutAlias])).rejects.toThrow('outside the checkout');
    // A real external child beginning with two dots is valid; the path component matters.
    const allowed = join(directory, '..allowed'); await mkdir(allowed);
    const allowedAlias = join(directory, 'allowed-alias'); await symlink(allowed, allowedAlias, 'dir');
    const app = await launch('Boundary', ['--data-dir', allowedAlias]); await app.stop();
  } finally {
    for (const app of running) await app.stop();
    await rm(child, { recursive: true, force: true });
  }
});
