import { expect, test } from './test-fixture.ts';
import type { Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { unzipSync } from 'fflate';
import { invoke } from '../../../packages/motion-cli/src/managed-test-support.ts';
import { spawnTestServer, stopTestServer, waitForTestServer } from './test-server.ts';

const root = resolve(import.meta.dirname, '../../..');
const sampleTimes = [0, 1500, 2999, 3000, 3001, 3499, 3500, 3501, 4500, 5499, 5500, 5501];
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const source = (color: string, duration: number) => `<!doctype html><html><head><style>
html,body{margin:0;width:320px;height:180px;overflow:hidden;background:${color}}
.actor{width:30px;height:30px;background:black;animation:move ${duration}ms linear both}
@keyframes move{from{transform:translateX(0px)}to{transform:translateX(120px)}}
@media(prefers-reduced-motion:reduce){.actor{animation:none;transform:translateX(40px)}}
</style></head><body><div class="actor" aria-label="Moving tile"></div><p aria-label="Caption">Public caption</p></body></html>`;
async function launch(directory: string) {
  const child = spawnTestServer(process.execPath, ['--import', 'tsx', resolve(root, 'apps/editor/scripts/dev-editor.mjs'),
    '--data-dir', directory, '--project', 'Sequence parity', '--port', '0'], { cwd: root });
  try { return { child, ...await waitForTestServer(child) }; }
  catch (error) { await stopTestServer(child); throw error; }
}
const revision = (page: Page, number: number) => expect(page.locator('[data-sequence-summary]')).toContainText(`Saved revision ${number}`);
async function download(page: Page) {
  const button = page.getByRole('button', { name: 'Download full animation', exact: true });
  await expect(button).toBeEnabled(); const event = page.waitForEvent('download'); await button.click();
  return readFile((await (await event).path())!);
}
async function importAndFade(page: Page, name: string, html: string, duration: number) {
  await page.locator('[data-new-shot] summary').click(); await page.getByLabel('Shot name', { exact: true }).fill(name);
  await page.getByLabel('Starting point').selectOption('html-css'); await page.getByLabel('Self-contained HTML and CSS').fill(html);
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  await expect(page.locator('[data-project-shot] option:checked')).toHaveText(name);
  await page.locator('[data-action-target]').selectOption({ label: 'Caption' });
  await page.getByRole('button', { name: 'Fade', exact: true }).click();
  await page.locator('[data-action-form] [name="end"]').fill(String(duration));
  await page.getByRole('button', { name: 'Apply action', exact: true }).click();
  await expect(page.locator('[data-action-status]')).toContainText('Revision 1');
}

test('ordinary UI and CLI assemble equal sequences, hand off edits, and reopen deterministic native exports', async ({ page }) => {
  test.setTimeout(120000);
  const directory = await mkdtemp(join(tmpdir(), 'motion-sequence-parity-'));
  const uiData = join(directory, 'ui'), cliData = join(directory, 'cli');
  let uiApp = await launch(uiData); const cliApp = await launch(cliData);
  const a = source('red', 2000), b = source('blue', 3000);
  const call = async (data: string, name: string, args: string[] = []) => {
    const result = await invoke([name, '--data-dir', data, ...args]);
    expect(result.code, `${name}: ${result.stdout}`).toBe(0); return result.json;
  };
  try {
    await page.goto(uiApp.editorUrl); await importAndFade(page, 'Opening', a, 2000); await importAndFade(page, 'Ending', b, 3000);
    await page.locator('[data-sequence-new] summary').click(); await page.locator('[data-sequence-create] input').fill('Public animation');
    await expect.poll(() => page.locator('[data-sequence-create] select option').allTextContents()).toEqual(expect.arrayContaining(['Opening', 'Ending']));
    await page.locator('[data-sequence-create] select').selectOption({ label: 'Opening' });
    await page.getByRole('button', { name: 'Create animation', exact: true }).click(); await revision(page, 0);
    await page.getByLabel('Saved shot to add').selectOption({ label: 'Ending · 3 s' });
    await page.getByRole('button', { name: 'Add shot', exact: true }).click(); await revision(page, 1);
    await page.getByRole('button', { name: 'Move Ending earlier', exact: true }).click(); await revision(page, 2);
    await page.locator('[data-clip-select]').filter({ hasText: /^Ending$/ }).click();
    await page.getByLabel('End hold (seconds)').fill('0.5'); await page.getByRole('button', { name: 'Apply end hold' }).click(); await revision(page, 3);
    await page.getByRole('button', { name: 'Undo storyboard change' }).click(); await revision(page, 4);
    await page.getByRole('button', { name: 'Redo storyboard change' }).click(); await revision(page, 5);
    const uiArchive = await download(page);
    const ui = await call(uiData, 'sequence');
    const [ending, opening] = ui.sequence.clips;
    expect(ui.sequence.clips.map((clip: { name: string }) => clip.name)).toEqual(['Ending', 'Opening']);
    // Public discovery supplies every identity. The second data directory is an equivalent fresh project.
    const help = (await invoke(['help'])).json; expect(help.sequences).toContain('sequence-clip-hold');
    for (const [clip, html, seconds, handle] of [[opening, a, '2', 'opening'], [ending, b, '3', 'ending']] as const) {
      const project = await call(cliData, 'project'); const path = join(directory, `${handle}.html`); await writeFile(path, html);
      await call(cliData, 'shot-admit', ['--project-id', project.projectId, '--expected-catalog-revision', String(project.catalogRevision),
        '--document-id', clip.source.documentId, '--name', clip.name, '--html-file', path, '--claim', handle, '--operation-id', `admit-${handle}`]);
      const workspace = await call(cliData, 'workspace', ['--document-id', clip.source.documentId]);
      const target = workspace.elements.find((element: { label: string }) => element.label === 'Caption');
      expect(target.actions).toContainEqual(expect.objectContaining({ action: 'fade', available: true }));
      await call(cliData, 'track-create', ['--document-id', clip.source.documentId, '--claim', handle, '--operation-id', `fade-${handle}`,
        '--expected-revision', '0', '--element-id', target.elementId, '--duration-seconds', seconds, '--delay-seconds', '0']);
    }
    const sequenceId = ui.sequence.sequenceId;
    const edit = (name: string, rev: number, args: string[] = []) => call(cliData, name, ['--sequence-id', sequenceId, '--claim', 'assembly',
      '--operation-id', `assembly-${name}-${rev}`, '--expected-revision', String(rev), ...args]);
    await edit('sequence-create', 0, ['--name', 'Public animation', '--viewport-width', '320', '--viewport-height', '180',
      '--clip-id', opening.clipId, '--clip-name', opening.name, '--source-document-id', opening.source.documentId, '--source-revision', '1']);
    await edit('sequence-clip-add', 0, ['--clip-id', ending.clipId, '--name', ending.name, '--index', '1', '--source-document-id', ending.source.documentId, '--source-revision', '1']);
    await edit('sequence-clip-move', 1, ['--clip-id', ending.clipId, '--index', '0']);
    await edit('sequence-clip-hold', 2, ['--clip-id', ending.clipId, '--end-hold-seconds', '0.5']);
    await edit('sequence-undo', 3); await edit('sequence-redo', 4);
    const cli = await call(cliData, 'sequence', ['--sequence-id', sequenceId]);
    expect(cli.sequence).toEqual(ui.sequence); expect(cli.canonicalDigest).toBe(ui.canonicalDigest);
    const cliOutput = join(directory, 'equivalent.zip');
    await call(cliData, 'sequence-export', ['--sequence-id', sequenceId, '--expected-revision', '5', '--output', cliOutput]);
    expect(await readFile(cliOutput)).toEqual(uiArchive);

    // Mixed handoff edits the second shot through the CLI and explicitly adopts its newer pin in the UI.
    const shotArgs = ['--document-id', ending.source.documentId, '--claim', 'mixed-shot'];
    await call(uiData, 'claim-acquire', [...shotArgs, '--operation-id', 'mixed-shot-claim', '--expected-revision', '1', '--scope', 'document']);
    await call(uiData, 'undo', [...shotArgs, '--operation-id', 'mixed-shot-undo', '--expected-revision', '1']);
    await call(uiData, 'redo', [...shotArgs, '--operation-id', 'mixed-shot-redo', '--expected-revision', '2']);
    await call(uiData, 'claim-release', [...shotArgs, '--operation-id', 'mixed-shot-release', '--expected-revision', '3', '--lease-version', '1']);
    const refreshedSources = page.waitForResponse(async response => response.url().endsWith('/api/sequence/v1/sources')
      && response.ok() && (await response.json()).shots.some((shot: { source: { documentId: string; revision: number } }) =>
        shot.source.documentId === ending.source.documentId && shot.source.revision === 3));
    await page.getByRole('button', { name: 'Refresh storyboard', exact: true }).click(); await refreshedSources;
    await page.locator('[data-sequence-cards] > li').first().getByRole('button', { name: 'Update this occurrence' }).click(); await revision(page, 6);
    const common = ['--sequence-id', sequenceId, '--claim', 'mixed-sequence'];
    await call(uiData, 'sequence-claim-acquire', [...common, '--operation-id', 'mixed-sequence-claim', '--expected-revision', '6']);
    const raced = await Promise.all(['One winner', 'Other winner'].map((name, index) => invoke(['sequence-rename', '--data-dir', uiData,
      ...common, '--operation-id', `race-${index}`, '--expected-revision', '6', '--name', name])));
    expect(raced.map(result => result.code).sort()).toEqual([0, 3]);
    expect(raced.find(result => result.code === 3)?.json.code).toBe('SEQUENCE_STALE_REVISION');
    await call(uiData, 'sequence-claim-release', [...common, '--operation-id', 'mixed-sequence-release', '--expected-revision', '7', '--lease-version', '1']);
    await revision(page, 7); await page.locator('[data-sequence-name] input').fill('Mixed final animation');
    await page.getByRole('button', { name: 'Rename animation', exact: true }).click(); await revision(page, 8);
    expect((await call(uiData, 'sequence')).sequence.name).toBe('Mixed final animation');
    await page.getByRole('button', { name: 'Undo storyboard change' }).click(); await revision(page, 9);
    await page.getByRole('button', { name: 'Redo storyboard change' }).click(); await revision(page, 10);
    const saved = await call(uiData, 'sequence'); expect(saved.sequence.clips[0].source.revision).toBe(3);
    const archives = [await download(page), await download(page), await download(page)];
    const openShot = await page.locator('[data-project-shot]').inputValue();
    await page.goto('about:blank'); await stopTestServer(uiApp.child); uiApp = await launch(uiData);
    await page.goto(`${uiApp.editorUrl}/?shot=${encodeURIComponent(openShot)}`);
    await page.getByRole('combobox', { name: 'Current animation', exact: true }).selectOption({ label: 'Mixed final animation' }); await revision(page, 10);
    expect((await call(uiData, 'sequence')).sequence).toEqual(saved.sequence); archives.push(await download(page));
    expect(archives.every(bytes => bytes.equals(archives[0]!))).toBe(true);
    const files = unzipSync(archives[0]!); const receipt = JSON.parse(Buffer.from(files['receipt.json']!).toString('utf8'));
    expect(receipt.revision).toBe(10); expect(receipt.canonicalDigest).toBe(saved.canonicalDigest);
    const previewFrames = new Map<string, Buffer>();
    let geometry: { x: number; y: number; width: number; height: number; parentWidth: number; parentBackground: string; outsideBackground: string; frameBackground: string; colorScheme: string } | null = null;
    for (const reduced of ['no-preference', 'reduce'] as const) {
      await page.emulateMedia({ reducedMotion: reduced });
      for (const time of sampleTimes) {
        await page.locator('[data-sequence-scrub]').evaluate((input: HTMLInputElement, time) => {
          input.value = String(time); input.dispatchEvent(new Event('input', { bubbles: true }));
        }, time);
        const previewState = await page.locator('[data-sequence-preview] iframe').evaluate((frame: HTMLIFrameElement) => {
          const child = [...frame.contentDocument!.querySelectorAll('iframe')].find(child => child.style.visibility === 'visible')!;
          return { state: (frame.contentWindow as any).__motionSequence.readState(),
            animations: child.contentDocument!.getAnimations().map(animation => ({ state: animation.playState, time: animation.currentTime })),
            x: new DOMMatrix(child.contentWindow!.getComputedStyle(child.contentDocument!.querySelector('.actor')!).transform).m41,
            opacity: Number(child.contentWindow!.getComputedStyle(child.contentDocument!.querySelector('p')!).opacity) };
        });
        expect(previewState.animations.every(animation => animation.state === 'paused'), JSON.stringify(previewState)).toBe(true);
        const second = time >= 3500, duration = second ? 2000 : 3000;
        const local = Math.min(duration, second ? time - 3500 : time);
        expect(previewState.x).toBeCloseTo(reduced === 'reduce' ? 40 : 120 * local / duration, 2);
        if (reduced === 'no-preference') expect(previewState.opacity).toBeCloseTo(local / duration, 4);
        previewFrames.set(`${reduced}:${time}`, await page.locator('[data-sequence-preview] iframe').screenshot());
        geometry = await page.locator('[data-sequence-preview] iframe').evaluate((frame: HTMLIFrameElement) => {
          const rect = frame.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, parentWidth: frame.parentElement!.clientWidth,
            parentBackground: getComputedStyle(frame.parentElement!).backgroundColor,
            outsideBackground: getComputedStyle(document.querySelector('.sequence-storyboard')!).backgroundColor,
            frameBackground: getComputedStyle(frame).backgroundColor, colorScheme: getComputedStyle(frame).colorScheme };
        });
      }
    }
    await page.goto('about:blank'); await stopTestServer(uiApp.child); await stopTestServer(cliApp.child);
    for (const [name, bytes] of Object.entries(files)) await writeFile(join(directory, name), bytes);
    const network: string[] = []; page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    await page.goto(pathToFileURL(join(directory, 'animation.html')).href);
    await page.evaluate(() => (window as any).__motionSequence.ready);
    // Independent BA + 500ms hold oracle, never derived from compiler schedule data.
    for (const reduced of ['no-preference', 'reduce'] as const) {
      await page.emulateMedia({ reducedMotion: reduced });
      for (const time of sampleTimes) {
        const sample = await page.evaluate(time => {
          (window as any).__motionSequence.seek(time);
          const frames = [...document.querySelectorAll('iframe')].filter(frame => frame.style.visibility === 'visible');
          const frame = frames[0]!, doc = frame.contentDocument!, view = frame.contentWindow!;
          return { count: frames.length, color: view.getComputedStyle(doc.body).backgroundColor,
            x: new DOMMatrix(view.getComputedStyle(doc.querySelector('.actor')!).transform).m41,
            opacity: Number(view.getComputedStyle(doc.querySelector('p')!).opacity) };
        }, time);
        const second = time >= 3500, local = second ? Math.min(2000, time - 3500) : Math.min(3000, time);
        expect(sample.count).toBe(1); expect(sample.color).toBe(second ? 'rgb(255, 0, 0)' : 'rgb(0, 0, 255)');
        expect(sample.x).toBeCloseTo(reduced === 'reduce' ? 40 : 120 * local / (second ? 2000 : 3000), 2);
        if (reduced === 'no-preference') expect(sample.opacity).toBeCloseTo(local / (second ? 2000 : 3000), 4);
      }
    }
    // Compare exact pixels at the same physical origin. A fractional editor layout
    // otherwise adds a cropped edge pixel and different subpixel rasterization.
    // This renderer embeds the unchanged exported bytes; direct file playback was tested above.
    const comparison = await page.context().newPage();
    try {
      comparison.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
      await comparison.setContent('<!doctype html><html><body style="margin:0"><div><iframe sandbox="allow-scripts allow-same-origin"></iframe></div></body></html>');
      await comparison.evaluate(async ({ html, geometry: g }) => {
        if (!g) throw new Error('PREVIEW_GEOMETRY_REQUIRED');
        document.body.style.background = g.outsideBackground;
        const host = document.querySelector('div')!, frame = document.querySelector('iframe')!;
        Object.assign(host.style, { position: 'absolute', left: `${g.x}px`, top: `${g.y}px`, width: `${g.parentWidth}px`, height: `${g.height}px`, overflow: 'hidden', background: g.parentBackground });
        Object.assign(frame.style, { display: 'block', position: 'absolute', left: '0', top: '0', border: '0', width: `${g.width}px`, height: `${g.height}px`, background: g.frameBackground, colorScheme: g.colorScheme });
        await new Promise<void>(resolve => { frame.onload = () => resolve(); frame.srcdoc = html; });
        await (frame.contentWindow as any).__motionSequence.ready;
        (frame.contentWindow as any).__motionSequence.pause();
      }, { html: Buffer.from(files['animation.html']!).toString('utf8'), geometry });
      for (const reduced of ['no-preference', 'reduce'] as const) {
        await comparison.emulateMedia({ reducedMotion: reduced });
        for (const time of sampleTimes) {
          await comparison.locator('iframe').evaluate((frame: HTMLIFrameElement, time) => (frame.contentWindow as any).__motionSequence.seek(time), time);
          const standaloneFrame = await comparison.locator('iframe').screenshot(), previewFrame = previewFrames.get(`${reduced}:${time}`)!;
          if (digest(standaloneFrame) !== digest(previewFrame)) {
            await writeFile(test.info().outputPath('preview.png'), previewFrame); await writeFile(test.info().outputPath('standalone.png'), standaloneFrame);
          }
          expect(digest(standaloneFrame), `${reduced}:${time}`).toBe(digest(previewFrame));
        }
      }
    } finally { await comparison.close(); }
    expect(network).toEqual([]);
  } finally { await stopTestServer(uiApp.child); await stopTestServer(cliApp.child); await rm(directory, { recursive: true, force: true }); }
});
