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

test('UI-only and help-driven CLI author equivalent shots, then safely hand off a saved edit', async ({ page }) => {
  test.setTimeout(60000);
  const directory = await mkdtemp(join(tmpdir(), 'motion-shot-parity-'));
  const uiData = join(directory, 'ui'); const cliData = join(directory, 'cli');
  const uiApp = await launch(uiData); const cliApp = await launch(cliData);
  const source = '<!doctype html><html><head><style>html,body{margin:0;width:320px;height:240px}.comet{width:30px;height:30px;background:blue;animation:travel 4200ms linear both}@keyframes travel{from{transform:translateX(0px)}to{transform:translateX(120px)}}</style></head><body><div class="comet" aria-label="Comet"></div><p aria-label="Caption">Public caption</p></body></html>';
  try {
    await page.goto(uiApp.editorUrl); await page.locator('[data-new-shot] summary').click();
    await page.getByLabel('Shot name', { exact: true }).fill('Equivalent shot');
    await page.getByLabel('Starting point').selectOption('html-css');
    await page.getByLabel('Self-contained HTML and CSS').fill(source);
    await page.getByRole('button', { name: 'Create shot', exact: true }).click();
    await expect(page.locator('[data-project-shot] option:checked')).toHaveText('Equivalent shot');
    await page.locator('[data-action-target]').selectOption({ label: 'Caption' });
    await page.getByRole('button', { name: 'Fade', exact: true }).click();
    await page.getByRole('button', { name: 'Apply action', exact: true }).click();
    await expect(page.locator('[data-action-status]')).toContainText('Revision 1');
    await page.getByRole('button', { name: 'Add midpoint', exact: true }).click();
    await expect(page.locator('[data-operation-status]')).toContainText('Revision 2');
    await page.getByLabel('Duration draft').fill('1800'); await page.getByRole('button', { name: 'Apply duration', exact: true }).click();
    await expect(page.locator('[data-operation-status]')).toContainText('Revision 3');
    await page.getByLabel('Delay draft').fill('200'); await page.getByRole('button', { name: 'Apply delay', exact: true }).click();
    await expect(page.locator('[data-operation-status]')).toContainText('Revision 4');
    await page.getByLabel('Easing draft').selectOption('ease-in-out'); await page.getByRole('button', { name: 'Apply easing', exact: true }).click();
    await expect(page.locator('[data-operation-status]')).toContainText('Revision 5');
    await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('[data-operation-status]')).toContainText('Revision 6');
    await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(page.locator('[data-operation-status]')).toContainText('Revision 7');
    const event = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download animation', exact: true }).click();
    const uiArchive = await readFile((await (await event).path())!);
    const receipt = JSON.parse(Buffer.from(unzipSync(uiArchive)['receipt.json']!).toString('utf8'));
    const help = (await invoke(['help'])).json;
    expect(help.reads.some((command: {name:string}) => command.name === 'workspace')).toBe(true);
    const catalog = (await invoke(['project', '--data-dir', cliData])).json;
    const sourcePath = join(directory, 'public.html'); await writeFile(sourcePath, source);
    expect((await invoke(['shot-admit', '--data-dir', cliData, '--project-id', catalog.projectId,
      '--expected-catalog-revision', String(catalog.catalogRevision), '--document-id', receipt.documentId, '--name', 'Equivalent shot',
      '--html-file', sourcePath, '--claim', 'equivalent', '--operation-id', 'equivalent-admit'])).code).toBe(0);
    const common = ['--data-dir', cliData, '--document-id', receipt.documentId];
    let workspace = (await invoke(['workspace', ...common])).json;
    const target = workspace.elements.find((element: {label:string}) => element.label === 'Caption');
    expect(target.actions).toEqual(expect.arrayContaining([expect.objectContaining({ action: 'fade', available: true })]));
    const edit = async (command: string, revision: number, args: string[] = []) => {
      expect((await invoke([command, '--help'])).code).toBe(0);
      const result = await invoke([command, ...common, '--claim', 'equivalent', '--expected-revision', String(revision),
        '--operation-id', `equivalent-${revision}`, ...args]);
      expect(result.json).toMatchObject({ ok: true, resultingRevision: revision + 1 });
    };
    await edit('track-create', 0, ['--element-id', target.elementId, '--duration-seconds', '2.1', '--delay-seconds', '0']);
    workspace = (await invoke(['workspace', ...common])).json;
    const track = workspace.tracks.find((item: {elementId:string;property:string}) => item.elementId === target.elementId && item.property === 'opacity');
    await edit('keyframe-add', 1, ['--track-id', track.trackId, '--time-seconds', '1.05', '--value', '0.5']);
    await edit('slot-duration-set', 2, ['--track-id', track.trackId, '--duration-seconds', '1.8']);
    await edit('binding-delay-set', 3, ['--track-id', track.trackId, '--delay-seconds', '0.2']);
    await edit('slot-easing-set', 4, ['--track-id', track.trackId, '--easing', 'ease-in-out']);
    await edit('undo', 5); await edit('redo', 6);
    const cliOutput = join(directory, 'equivalent.zip');
    const exported = await invoke(['export', ...common, '--expected-revision', '7', '--output', cliOutput]);
    expect(exported.json.receipt.canonicalDigest).toBe(receipt.canonicalDigest);
    expect(await readFile(cliOutput)).toEqual(uiArchive);
    // Switch to the UI project's ordinary managed session for a mixed handoff.
    const mixed = ['--data-dir', uiData, '--document-id', receipt.documentId, '--claim', 'handoff'];
    expect((await invoke(['claim-acquire', ...mixed, '--expected-revision', '7', '--operation-id', 'handoff-acquire', '--scope', 'document'])).code).toBe(0);
    expect((await invoke(['undo', ...mixed, '--expected-revision', '7', '--operation-id', 'handoff-undo'])).code).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(8);
    expect((await invoke(['redo', ...mixed, '--expected-revision', '8', '--operation-id', 'handoff-redo'])).code).toBe(0);
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(9);
    expect((await invoke(['undo', ...mixed, '--expected-revision', '7', '--operation-id', 'handoff-stale'])).json.code).toBe('STALE_REVISION');
    expect((await invoke(['claim-release', ...mixed, '--expected-revision', '9', '--operation-id', 'handoff-release', '--lease-version', '1'])).code).toBe(0);
    await page.reload(); await expect(page.locator('[data-editor-ready]')).toBeVisible();
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().exportDigest)).toBe(receipt.exportDigest);
  } finally { await stopTestServer(uiApp.child); await stopTestServer(cliApp.child); await rm(directory, { recursive: true, force: true }); }
});
