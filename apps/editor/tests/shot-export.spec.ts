import { expect, test } from './test-fixture.ts';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { invoke } from '../../../packages/motion-cli/src/managed-test-support.ts';
import { spawnTestServer, waitForTestServer, stopTestServer } from './test-server.ts';
const root = resolve(import.meta.dirname, '../../..');

async function launch(directory: string) {
  const child = spawnTestServer(process.execPath, ['--import', 'tsx', resolve(root, 'apps/editor/scripts/dev-editor.mjs'),
    '--data-dir', directory, '--project', 'Export study', '--port', '0'],
  { cwd: root, env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
  try { return { child, ...await waitForTestServer(child) }; }
  catch (error) { await stopTestServer(child); throw error; }
}

test('normal UI and CLI deliver identical standalone archives across three runs and restart', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-export-journey-')); let app = await launch(directory);
  try {
    await page.goto(app.editorUrl);
    await page.getByRole('radio', { name: /Orb/ }).check(); await page.locator('[data-create-track]').click();
    await expect(page.locator('[data-operation-status]')).toContainText('Revision 1');
    const shot = await page.locator('[data-project-shot]').inputValue();
    const download = page.getByRole('button', { name: 'Download animation', exact: true });
    const archives: Buffer[] = [];
    for (let run = 0; run < 4; run++) {
      if (run === 3) {
        await page.goto('about:blank'); await stopTestServer(app.child); app = await launch(directory);
        await page.goto(`${app.editorUrl}/?shot=${shot}`);
      }
      await expect(download).toBeEnabled();
      const event = page.waitForEvent('download'); await download.click(); const result = await event;
      const path = await result.path(); expect(path).not.toBeNull(); const bytes = await readFile(path!); archives.push(bytes);
      const output = join(directory, `cli-${run}.zip`);
      const cli = await invoke(['export', '--data-dir', directory, '--document-id', shot, '--expected-revision', '1', '--output', output]);
      expect(cli.code).toBe(0); expect(await readFile(output)).toEqual(bytes);
      expect(cli.stdout).not.toContain('<html');
    }
    expect(archives.every(bytes => bytes.equals(archives[0]!))).toBe(true);
    const files = unzipSync(archives[0]!); expect(Object.keys(files)).toEqual(['animation.html', 'animation.css', 'receipt.json']);
    await page.goto('about:blank'); await stopTestServer(app.child);
    for (const [name, bytes] of Object.entries(files)) await writeFile(join(directory, name), bytes);
    const external: string[] = []; page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
    await page.goto(pathToFileURL(join(directory, 'animation.html')).href);
    expect(await page.evaluate(() => document.getAnimations().some(animation => animation.constructor.name === 'CSSAnimation'))).toBe(true);
    expect(external).toEqual([]);
  } finally { await stopTestServer(app.child); await rm(directory, { recursive: true, force: true }); }
});

test('drafts and changes during export cannot download a mislabeled saved revision', async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), 'motion-export-draft-')); const app = await launch(directory);
  try {
    await page.goto(app.editorUrl);
    await page.getByRole('radio', { name: /Orb/ }).check(); await page.locator('[data-create-track]').click();
    await expect(page.locator('[data-operation-status]')).toContainText('Revision 1');
    const download = page.getByRole('button', { name: 'Download animation', exact: true });
    await expect(download).toBeEnabled();
    let release!: () => void; let reached!: () => void;
    const gate = new Promise<void>(done => { release = done; }); const intercepted = new Promise<void>(done => { reached = done; });
    await page.route('**/api/export/v1/shot', async route => { reached(); await gate; await route.continue(); });
    const downloads: string[] = []; page.on('download', event => downloads.push(event.suggestedFilename()));
    try {
      await download.click(); await intercepted;
      await page.getByLabel('Duration draft').fill('1800');
      release(); await expect(page.locator('[data-export-status]')).toContainText('selected animation changed');
      await expect(download).toBeDisabled(); expect(downloads).toEqual([]);
      await page.getByRole('button', { name: 'Apply duration', exact: true }).click();
      await expect(page.locator('[data-operation-status]')).toContainText('Revision 2'); await expect(download).toBeEnabled();
      const shot = await page.locator('[data-project-shot]').inputValue();
      const stale = await invoke(['export', '--data-dir', directory, '--document-id', shot, '--expected-revision', '1', '--output', join(directory, 'stale.zip')]);
      expect(stale.code).toBe(3); expect(stale.json.code).toBe('EXPORT_STALE_REVISION');
      await expect(readFile(join(directory, 'stale.zip'))).rejects.toThrow();
    } finally { release(); }
  } finally { await stopTestServer(app.child); await rm(directory, { recursive: true, force: true }); }
});
