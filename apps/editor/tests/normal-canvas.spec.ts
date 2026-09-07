import type { Page } from '@playwright/test';
import { expect, test } from './test-fixture.ts';
import { randomBytes } from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { launcherShutdown } from './launcher-shutdown.ts';
const root = resolve(import.meta.dirname, '../../..');
let directory: string; let stop: () => Promise<void>;
test.beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'motion-canvas-')); });
test.afterEach(async () => { await stop?.(); await rm(directory, { recursive: true, force: true }); });
async function launch(page: Page) {
  const child = spawn('npm', ['run', 'dev:editor', '--', '--data-dir', directory, '--project', 'Canvas proof', '--port', '0'],
    { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  stop = launcherShutdown(child); let output = '';
  const url = await new Promise<string>((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Launcher timed out')), 20000);
    child.stdout.on('data', chunk => { output += chunk.toString(); const json = output.split('\n').find(line => line.startsWith('{'));
      if (json) { clearTimeout(timer); done(JSON.parse(json).editorUrl); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Launcher exited')); });
  });
  await page.goto(url); await expect(page.locator('[data-project-shot]')).toBeVisible();
  const sessionPath = output.split('\n').find(line => line.startsWith('Local agent session: '))?.slice(21);
  if (!sessionPath) throw new Error('Session was not published');
  return JSON.parse(await readFile(sessionPath, 'utf8')) as { serviceUrl: string; agentCapability: string };
}
const imported = `<!doctype html><html><head><style>
html,body{margin:0;width:640px;height:360px;background:#edf2ff}
#comet{position:absolute;left:120px;top:90px;width:50px;height:50px;background:#5454db;animation:drift 4200ms linear both}
@keyframes drift{0%{transform:translateX(0px)}50%{transform:translateX(120px)}100%{transform:translateX(240px)}}
@media(prefers-reduced-motion:reduce){#comet{animation:none}}
</style></head><body><div id="comet" aria-label="Violet comet"></div></body></html>`;
async function create(page: Page, source?: string) {
  await page.locator('[data-new-shot] summary').click(); await page.getByLabel('Shot name', { exact: true }).fill(source ? 'Imported motion' : 'Moving opening');
  if (source) { await page.getByLabel('Starting point').selectOption('html-css'); await page.getByLabel('Self-contained HTML and CSS').fill(source); }
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  await expect(page.locator('[data-project-shot] option:checked')).toHaveText(source ? 'Imported motion' : 'Moving opening');
}
async function revision(page: Page, expected: number) {
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(expected);
}
for (const kind of ['starter', 'import'] as const) test(`normal ${kind} canvas fits, preserves native mapping and supports keyboard editing at all approved sizes`, async ({ page }) => {
  test.setTimeout(90000); await launch(page); await create(page, kind === 'import' ? imported : undefined);
  await page.getByRole('button', { name: 'Edit motion on canvas', exact: true }).click();
  await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  for (const size of [{ width: 1280, height: 720 }, { width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(size); await page.locator('.preview-stage').scrollIntoViewIfNeeded();
    await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
    const geometry = await page.evaluate(() => {
      const canvas = document.querySelector<HTMLElement>('.preview-canvas')!, stage = document.querySelector<HTMLElement>('.preview-stage')!;
      const c = canvas.getBoundingClientRect(), s = stage.getBoundingClientRect(); const scale = c.width / canvas.offsetWidth;
      const label = document.querySelector<HTMLElement>('.trajectory-waypoint[aria-pressed="true"] .trajectory-waypoint-label')!;
      const l = label.getBoundingClientRect();
      const iframe = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      const selected = document.querySelector<HTMLElement>('[data-preview-object-id][aria-pressed="true"]')!;
      const target = iframe.contentDocument!.querySelector<HTMLElement>(`[data-motion-id="${selected.dataset.previewObjectId}"]`)!.getBoundingClientRect();
      const h = selected.getBoundingClientRect();
      return { centeredX: Math.abs(c.x + c.width / 2 - s.x - s.width / 2), centeredY: Math.abs(c.y + c.height / 2 - s.y - s.height / 2),
        overflow: document.documentElement.scrollWidth > innerWidth, labelFont: parseFloat(getComputedStyle(label).fontSize) * scale,
        labelContained: l.left >= s.left && l.right <= s.right && l.top >= s.top && l.bottom <= s.bottom,
        mappingX: Math.abs(h.x + h.width / 2 - (c.x + (target.x + target.width / 2) * scale)),
        mappingY: Math.abs(h.y + h.height / 2 - (c.y + (target.y + target.height / 2) * scale)),
        targetSize: Math.min(h.width, h.height), native: iframe.contentDocument!.getAnimations().length > 0 && iframe.contentDocument!.getAnimations().every(animation => animation.constructor.name === 'CSSAnimation') };
    });
    expect(geometry.centeredX).toBeLessThan(1); expect(geometry.centeredY).toBeLessThan(1);
    expect(geometry.overflow).toBe(false); expect(geometry.labelFont).toBeGreaterThanOrEqual(11.9);
    expect(geometry.labelContained).toBe(true); expect(geometry.mappingX).toBeLessThan(1); expect(geometry.mappingY).toBeLessThan(1);
    expect(geometry.targetSize).toBeGreaterThanOrEqual(43.9); expect(geometry.native).toBe(true);
    for (const selector of ['[data-play]', '[data-pause]', '[data-shot-mode]', '[data-undo]', '[data-reduced-toggle]']) {
      const control = page.locator(selector); await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox(); expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(size.width);
    }
    await page.locator('.preview-stage').scrollIntoViewIfNeeded(); await page.screenshot({ path: test.info().outputPath(`${kind}-${size.width}x${size.height}.png`) });
  }
  await page.locator('[data-preview-object-id][aria-pressed="true"]').press('ArrowRight'); await revision(page, 1);
  await expect(page.locator('[data-save-status]')).toContainText('Saved locally · revision 1');
  await page.locator('.moment-add').first().press('Enter'); await revision(page, 2);
  await expect(page.locator('input[name="shot-moment"]:checked')).toBeFocused();
  await page.locator('[data-shot-context-remove]').press('Enter'); await revision(page, 3);
  await page.locator('[data-undo]').press('Enter'); await revision(page, 4);
  await page.locator('[data-redo]').press('Enter'); await revision(page, 5);
  await page.locator('[data-reduced-toggle]').press('Enter'); await expect(page.locator('[data-reduced-motion-panel]')).toBeVisible();
  expect(await page.evaluate(() => window.__motionEditor.inspectShotWorkspace().previewMatchesCompiler)).toBe(true);
  const body = page.locator('[data-preview-object-id][aria-pressed="true"]'); await body.scrollIntoViewIfNeeded();
  const bounds = (await body.boundingBox())!; let commands = 0;
  page.on('request', request => { if (request.url().endsWith('/api/v1/commands')) commands += 1; });
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 12, bounds.y + bounds.height / 2 + 8, { steps: 6 });
  await page.mouse.up(); await revision(page, 6); expect(commands).toBe(1);
});

test('normal canvas shows pending, rejection and saved state without losing the committed animation', async ({ page }) => {
  await launch(page); await create(page);
  const before = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await page.getByRole('button', { name: 'Fade', exact: true }).click();
  await page.locator('[data-action-form] [name="end"]').fill('1400');
  await expect(page.locator('[data-save-status]')).toHaveAttribute('data-state', 'draft');
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let reached!: () => void; const request = new Promise<void>(resolve => { reached = resolve; });
  await page.route('**/api/v1/commands', async route => { reached(); await gate; await route.abort('connectionrefused'); });
  await page.getByRole('button', { name: 'Apply action', exact: true }).click(); await request;
  await expect(page.locator('[data-save-status]')).toHaveAttribute('data-state', 'pending');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().exportDigest)).toBe(before.exportDigest);
  release(); await expect(page.locator('[data-action-status]')).toContainText('Action was not applied');
  await expect(page.locator('[data-action-form] [name="end"]')).toHaveValue('1400');
  await expect(page.locator('[data-save-status]')).toHaveAttribute('data-state', 'rejected');
  await expect(page.getByRole('button', { name: 'Apply action', exact: true })).toBeFocused();
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().exportDigest)).toBe(before.exportDigest);
  await page.unroute('**/api/v1/commands');
  await page.getByRole('button', { name: 'Apply action', exact: true }).click(); await revision(page, 1);
  await expect(page.locator('[data-save-status]')).toHaveAttribute('data-state', 'saved');
});

async function cli(args: string[]) {
  return new Promise<Record<string, unknown>>((done, reject) => {
    execFile(process.execPath, ['--import', 'tsx', resolve(root, 'packages/motion-cli/src/cli.ts'), ...args],
      { cwd: root, encoding: 'utf8', timeout: 15000 }, (error, stdout) => {
        if (error) { reject(new Error('CLI operation failed')); return; }
        try { done(JSON.parse(stdout)); } catch { reject(new Error('CLI response invalid')); }
      });
  });
}

test('invalid timing and a claimed agent edit preserve the local draft and explain conflict recovery', async ({ page }) => {
  const session = await launch(page); await create(page);
  await page.getByRole('radio', { name: /Object A Opacity/ }).check(); await page.locator('[data-create-track]').click(); await revision(page, 1);
  const initial = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await page.locator('[data-duration]').fill('-1'); await page.locator('[data-set-duration]').click();
  await expect(page.locator('[data-duration]')).toBeFocused(); await expect(page.locator('[data-duration]')).toHaveValue('-1');
  await expect(page.locator('[data-save-status]')).toHaveAttribute('data-state', 'rejected');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().exportDigest)).toBe(initial.exportDigest);
  await page.locator('[data-duration]').fill('1400'); await page.locator('[data-duration]').focus();
  const common = ['--service', session.serviceUrl, '--document-id', initial.documentId, '--branch-id', 'main',
    '--actor', 'agent', '--capability', session.agentCapability];
  const secret = randomBytes(32).toString('hex');
  const claim = await cli(['claim-acquire', ...common, '--operation-id', 'canvas-claim', '--expected-revision', '1',
    '--scope', 'document', '--claim-secret', secret]); expect(claim.ok).toBe(true);
  expect(await cli(['undo', ...common, '--operation-id', 'canvas-agent-undo', '--expected-revision', '1', '--claim-secret', secret]))
    .toMatchObject({ ok: true, resultingRevision: 2 });
  await revision(page, 2); await expect(page.locator('[data-duration]')).toHaveValue('1400');
  await expect(page.locator('[data-draft-conflict]')).toBeVisible();
  await expect(page.locator('[data-save-status]')).toHaveAttribute('data-state', 'conflict');
  expect(await cli(['claim-release', ...common, '--operation-id', 'canvas-release', '--expected-revision', '2',
    '--claim-id', claim.claimId as string, '--lease-version', '1', '--claim-secret', secret])).toMatchObject({ ok: true });
  await page.locator('[data-discard-draft]').click(); await expect(page.locator('[data-draft-conflict]')).toBeHidden();
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(2);
});

test('an opacity-only import explains the canvas restriction and retains preview and reduced-motion controls', async ({ page }) => {
  await launch(page); await create(page, imported.replace('transform:translateX(0px)', 'opacity:0')
    .replace('transform:translateX(120px)', 'opacity:0.5').replace('transform:translateX(240px)', 'opacity:1'));
  const before = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await expect(page.locator('[data-open-canvas]')).toBeDisabled();
  await expect(page.locator('[data-canvas-availability]')).toContainText('compatible transform animation with three shared moments');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('[data-play]').click(); await page.locator('[data-pause]').click();
  await page.locator('[data-reduced-toggle]').press('Enter'); await expect(page.locator('[data-reduced-motion-panel]')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().exportDigest)).toBe(before.exportDigest);
});

async function scrubTo(page: Page, time: number) {
  await page.locator('[data-scrub]').evaluate((input: HTMLInputElement, value) => {
    input.value = String(value); input.dispatchEvent(new Event('input', { bubbles: true }));
  }, time);
}
async function nativePose(page: Page) {
  return page.locator('[data-preview]').evaluate((frame: HTMLIFrameElement) => {
    const doc = frame.contentDocument!, element = doc.querySelector('#comet')!;
    return { x: new DOMMatrix(frame.contentWindow!.getComputedStyle(element).transform).m41,
      opacity: Number(frame.contentWindow!.getComputedStyle(element).opacity),
      times: doc.getAnimations().map(animation => Number(animation.currentTime)),
      states: doc.getAnimations().map(animation => animation.playState),
      native: doc.getAnimations().every(animation => animation.constructor.name === 'CSSAnimation') };
  });
}

test('normal canvas transport plays the full document after the editable trajectory ends', async ({ page }) => {
  await launch(page);
  await create(page, imported.replace('drift 4200ms linear both', 'drift 1000ms linear both, reveal 3000ms linear both')
    .replace('@media', '@keyframes reveal{from{opacity:0}to{opacity:1}}\n@media'));
  await expect(page.locator('[data-scrub]')).toHaveAttribute('max', '3000');
  await page.locator('[data-open-canvas]').click();
  await expect(page.locator('[data-scrub]')).toHaveAttribute('max', '3000');
  await scrubTo(page, 2000);
  const middle = await nativePose(page);
  expect(middle.native).toBe(true); expect(middle.times).toEqual([2000, 2000]);
  expect(middle.x).toBeCloseTo(240, 3); expect(middle.opacity).toBeCloseTo(2 / 3, 3);
  await page.locator('[data-play]').click();
  await expect.poll(async () => (await nativePose(page)).opacity).toBeGreaterThan(0.8);
  await expect(page.locator('[data-playhead]')).toHaveText('3 s');
  const end = await nativePose(page); expect(end.opacity).toBe(1); expect(end.times).toEqual([3000, 3000]);
  expect(end.states.every(state => state === 'paused')).toBe(true);
  // Playing again at the document endpoint restarts the entire animation.
  await page.locator('[data-play]').click();
  await expect.poll(async () => (await nativePose(page)).opacity).toBeLessThan(0.5);
  await page.locator('[data-pause]').click();
  await page.locator('[data-preview-object-id][aria-pressed="true"]').press('ArrowRight'); await revision(page, 1);
  await expect(page.locator('[data-scrub]')).toHaveAttribute('max', '3000');
});

test('imported canvas holds its actual final pose through its own Settle boundary and supports undo', async ({ page }) => {
  await launch(page); await create(page, imported); await page.locator('[data-open-canvas]').click();
  await page.locator('[data-shot-advanced-toggle]').click();
  await page.getByText('Settled hold', { exact: true }).click();
  await expect(page.locator('[data-shot-settled]')).toHaveAttribute('max', '4199');
  await page.locator('[data-shot-settled]').fill('3000'); await page.locator('[data-shot-hold]').click(); await revision(page, 1);
  for (const time of [2999, 3000, 3001, 4199, 4200]) {
    await scrubTo(page, time); const pose = await nativePose(page);
    expect(pose.native).toBe(true); expect(pose.times).toEqual([time]);
    expect(pose.x).toBeCloseTo(time < 3000 ? 120 + 120 * (time - 2100) / 900 : 240, 2);
  }
  await page.locator('[data-shot-advanced-close]').click();
  await page.locator('[data-undo]').click(); await revision(page, 2);
  await scrubTo(page, 3000); expect((await nativePose(page)).x).toBeCloseTo(240 * 3000 / 4200, 2);
});
