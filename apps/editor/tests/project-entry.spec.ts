import { expect, test } from './test-fixture.ts';
import { execFileSync, spawn } from 'node:child_process';
import { copyFile, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { launcherShutdown } from './launcher-shutdown.ts';
const root = resolve(import.meta.dirname, '../../..');
let directory: string; const stops: Array<() => Promise<void>> = [];
test.beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'motion-shot-entry-')); });
test.afterEach(async () => { for (const stop of stops.splice(0)) await stop(); await rm(directory, { recursive: true, force: true }); });
async function launch(checkout = root) {
  const child = spawn('npm', ['run', 'dev:editor', '--', '--data-dir', directory, '--project', 'Public storyboard', '--port', '0'],
    { cwd: checkout, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const stop = launcherShutdown(child); stops.push(stop); let output = '';
  const url = await new Promise<string>((done, reject) => {
    const timer = setTimeout(() => reject(new Error('Launcher timed out')), 20000);
    child.stdout.on('data', chunk => { output += chunk.toString(); const json = output.split('\n').find(line => line.startsWith('{'));
      if (json) { clearTimeout(timer); done(JSON.parse(json).editorUrl); } });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Launcher exited')); });
  });
  return { url, stop };
}
const source = `<!doctype html><html><head><style>
html,body { margin:0; width:320px; height:240px; background:#eef2ff; }
#comet { width:35px; height:35px; background:#4f46e5; animation:drift 4200ms linear both; }
#caption { font:20px sans-serif; color:#24324b; }
@keyframes drift { 0% { transform:translateX(0px); } 50% { transform:translateX(80px); } 100% { transform:translateX(160px); } }
</style></head><body><div id="comet" aria-label="Violet comet"></div><p id="caption" aria-label="Mission caption">Ready for lift off</p></body></html>`;

test('normal project creates and imports named shots, preserves exact routing, and reopens after restart', async ({ page }) => {
  const app = await launch(); await page.goto(app.url);
  await expect(page.getByRole('heading', { name: 'Public storyboard' })).toBeVisible();
  const first = await page.locator('[data-project-shot]').inputValue();
  await page.locator('[data-new-shot] summary').click();
  await page.getByLabel('Shot name', { exact: true }).fill('A moving opening');
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  await expect(page.locator('[data-project-shot] option:checked')).toHaveText('A moving opening');
  const second = await page.locator('[data-project-shot]').inputValue(); expect(second).not.toBe(first);
  await page.locator('[data-new-shot] summary').click();
  await page.getByLabel('Shot name', { exact: true }).fill('Comet arrival');
  await page.getByLabel('Starting point').selectOption('html-css');
  await page.getByLabel('Self-contained HTML and CSS').fill(source);
  let receipt: Record<string, unknown> | undefined;
  await page.route('**/api/project/v1/shots', async route => {
    const response = await route.fetch(); receipt = await response.json();
    await route.fulfill({ response });
  });
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  await expect.poll(() => receipt).toBeDefined();
  expect(receipt).toMatchObject({ ok: true, inventory: { trackCount: 1, unsupportedCount: 0, missingCount: 0 } });
  for (const digest of [receipt!.sourceDigest, receipt!.canonicalDigest, receipt!.exportDigest]) expect(digest).toMatch(/^[a-f0-9]{64}$/);
  await expect(page.locator('[data-project-shot] option:checked')).toHaveText('Comet arrival');
  await expect(page.locator('[data-action-target] option')).toHaveText(['Mission caption', 'Violet comet']);
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(0);
  const imported = await page.locator('[data-project-shot]').inputValue();
  const original = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await page.locator('[data-action-target]').selectOption({ label: 'Mission caption' });
  await page.getByRole('button', { name: 'Type', exact: true }).click();
  await page.getByRole('button', { name: 'Apply action', exact: true }).click();
  await expect(page.locator('[data-action-status]')).toContainText('Type applied. Revision 1');
  const authored = await page.evaluate(() => window.__motionEditor.inspectAuthoring()); expect(authored.exportDigest).not.toBe(original.exportDigest);
  await page.locator('[data-project-shot]').selectOption(first);
  await expect(page.locator('[data-project-shot] option:checked')).toHaveText('First shot');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(0);
  await page.locator('[data-project-shot]').selectOption(imported);
  await expect(page.locator('[data-project-shot] option:checked')).toHaveText('Comet arrival');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().exportDigest)).toBe(authored.exportDigest);
  await page.screenshot({ path: test.info().outputPath('named-import-authoring.png'), fullPage: true });
  await page.goto(`${app.url}/?shot=not_a_real_shot`);
  await expect(page.getByRole('heading', { name: 'This shot could not be found' })).toBeVisible();
  await expect(page.locator('[data-editor-ready]')).toHaveCount(0);
  await page.goto('about:blank'); await app.stop(); const restarted = await launch();
  await page.goto(`${restarted.url}/?shot=${imported}`);
  await expect(page.locator('[data-editor-ready]')).toBeVisible();
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().exportDigest)).toBe(authored.exportDigest);
});

test('failed import leaves catalog unchanged and switching requires discarding an unapplied draft', async ({ page }) => {
  const app = await launch(); await page.goto(app.url);
  const first = await page.locator('[data-project-shot]').inputValue();
  await page.locator('[data-new-shot] summary').click(); await page.getByLabel('Shot name', { exact: true }).fill('Next shot');
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  await expect(page.locator('[data-project-shot] option')).toHaveCount(2);
  const next = await page.locator('[data-project-shot]').inputValue();
  await page.locator('[data-action-form] input[name=start]').fill('125');
  await page.locator('[data-project-shot]').selectOption(first);
  await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name: 'Stay here' }).click();
  await expect(page.locator('[data-project-shot]')).toHaveValue(next);
  await page.locator('[data-project-shot]').selectOption(first); await page.getByRole('button', { name: 'Discard changes and switch' }).click();
  await expect(page.locator('[data-project-shot]')).toHaveValue(first);
  await page.locator('[data-new-shot] summary').click(); await page.getByLabel('Shot name', { exact: true }).fill('Rejected');
  await page.getByLabel('Starting point').selectOption('html-css');
  await page.getByLabel('Self-contained HTML and CSS').fill('<html><script>alert("unsupported")</script><body>Rejected script</body></html>');
  const before = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  await expect(page.locator('[data-entry-status]')).toContainText('Shot was not created');
  await expect(page.locator('[data-project-shot] option')).toHaveCount(2);
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().exportDigest)).toBe(before.exportDigest);
  await page.locator('[data-project-shot]').selectOption(next);
  await expect(page.getByRole('dialog')).toBeVisible(); await page.getByRole('button', { name: 'Discard changes and switch' }).click();
  await expect(page.locator('[data-project-shot]')).toHaveValue(next);
});

for (const [cueId, cueLabel, boundary, duration] of [['trajectory_start', 'Start', 0, 300], ['trajectory_landed', 'Landed', 700, 450]] as const) test(`chosen source pause at ${cueLabel} reports its submitted values, ripples, and undoes exactly`, async ({ page }) => {
  const app = await launch(); await page.goto(app.url);
  await page.locator('[data-new-shot] summary').click(); await page.getByLabel('Shot name', { exact: true }).fill('Boundary study');
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  await expect(page.locator('[data-project-shot] option:checked')).toHaveText('Boundary study');
  const before = await page.evaluate(() => ({ state: window.__motionEditor.inspectAuthoring(), timeline: window.__motionEditor.canonicalProjection }));
  await page.getByText('Pause the whole shot', { exact: true }).click();
  await page.locator('[data-whole-pause] select').selectOption(cueId);
  await page.getByLabel('Pause duration (ms)').fill('0');
  await expect(page.getByRole('button', { name: 'Insert whole-shot pause' })).toBeDisabled();
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().exportDigest)).toBe(before.state.exportDigest);
  await page.getByLabel('Pause duration (ms)').fill(String(duration));
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let reached!: () => void; const pending = new Promise<void>(resolve => { reached = resolve; });
  await page.route('**/api/v1/commands', async route => { reached(); await gate; await route.continue(); });
  try {
    await page.getByRole('button', { name: 'Insert whole-shot pause' }).press('Enter'); await pending;
    await expect(page.getByLabel('Pause duration (ms)')).toBeDisabled();
    // Adversarial async probe: alter form state despite the ordinary pending-input guard.
    await page.getByLabel('Pause duration (ms)').evaluate((input: HTMLInputElement) => { input.value = '900'; });
    await page.locator('[data-whole-pause] select').evaluate((select: HTMLSelectElement, value) => { select.value = value; }, cueId === 'trajectory_start' ? 'trajectory_landed' : 'trajectory_start');
    await expect(page.locator('[data-action-status]')).not.toContainText('Whole-shot pause applied');
  } finally { release(); }
  await expect(page.locator('[data-action-status]')).toContainText(`Whole-shot pause applied: ${duration} ms before ${cueLabel}.`);
  await expect(page.locator('[data-operation-status]')).toContainText(`${duration} ms hold inserted before ${cueLabel}. Revision 1.`);
  await page.unroute('**/api/v1/commands');
  const after = await page.evaluate(() => window.__motionEditor.canonicalProjection);
  expect(after.durationMs).toBe(before.timeline.durationMs + duration);
  for (const cue of before.timeline.cues) expect(after.cues.find(item => item.id === cue.id)?.timeMs).toBe(cue.timeMs >= boundary ? cue.timeMs + duration : cue.timeMs);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(2);
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().contentDigest)).toBe(before.state.contentDigest);
  await expect(page.locator('[data-action-status]')).toBeEmpty();
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(3);
  expect(await page.evaluate(() => window.__motionEditor.canonicalProjection)).toEqual(after);
  await expect(page.locator('[data-action-status]')).toBeEmpty();
});

test('normal actions preserve keyboard focus and can be updated, detached, deleted, and undone', async ({ page }) => {
  const app = await launch(); await page.goto(app.url);
  await page.locator('[data-new-shot] summary').click(); await page.getByLabel('Shot name', { exact: true }).fill('Interaction study');
  await page.getByLabel('Starting point').selectOption('reusable-cues');
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  await expect(page.locator('[data-project-shot] option:checked')).toHaveText('Interaction study');
  const options = page.locator('[data-action-target] option');
  const labels = await options.allTextContents(); expect(labels.some(label => !label.startsWith('Object '))).toBe(true);
  // Pick a text target by the same visible eligibility controls a person uses.
  for (let index = 0; index < labels.length; index += 1) {
    await page.locator('[data-action-target]').selectOption({ index });
    if (await page.getByRole('button', { name: 'Type', exact: true }).isEnabled()) break;
  }
  await page.getByRole('button', { name: 'Type', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Type', exact: true })).toBeFocused();
  await page.locator('[data-action-form] input[name=end]').fill('900');
  await page.getByRole('button', { name: 'Apply action', exact: true }).press('Enter');
  await expect(page.locator('[data-action-status]')).toContainText('Type applied. Revision 1');
  await page.getByRole('region', { name: 'Created actions' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('[data-action-form] input[name=start]')).toBeFocused();
  await page.locator('[data-action-form] input[name=end]').fill('1200');
  await page.getByRole('button', { name: 'Update action', exact: true }).click();
  await expect(page.locator('[data-action-status]')).toContainText('Revision 2');
  await page.getByRole('region', { name: 'Created actions' }).getByRole('button', { name: 'Detach', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(3);
  await expect(page.getByRole('region', { name: 'Created actions' }).getByRole('button', { name: 'Edit', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(4);
  await page.getByRole('region', { name: 'Created actions' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(5);
});


test('the advertised ephemeral port survives a config restart without another service writer', async ({ page }) => {
  const checkout = join(directory, 'restart-checkout');
  execFileSync('git', ['worktree', 'add', '--detach', checkout, 'HEAD'], { cwd: root, stdio: 'ignore' });
  try {
    await symlink(join(root, 'node_modules'), join(checkout, 'node_modules'), 'dir');
    for (const file of ['apps/editor/scripts/dev-editor.mjs', 'apps/editor/scripts/editor-server.mjs'])
      await copyFile(join(root, file), join(checkout, file));
    const app = await launch(checkout); await page.goto(app.url);
    await expect(page.locator('[data-editor-ready]')).toBeVisible();
    await page.getByRole('radio', { name: /Orb/ }).check(); await page.locator('[data-create-track]').click();
    await expect(page.locator('[data-operation-status]')).toContainText('Revision 1');
    const before = await page.evaluate(() => window.__motionEditor.inspectAuthoring().exportDigest);
    const config = join(checkout, 'apps/editor/vite.config.ts');
    const initial = await readFile(config, 'utf8');
    // Vite reloads the connected page itself after its configuration restart.
    const reloaded = page.waitForEvent('load', { timeout: 15000 });
    await writeFile(config, initial.replace('humanCapability: process.env.', 'restartProof: "port-preserved", humanCapability: process.env.'));
    await expect.poll(async () => {
      try { return (await (await fetch(`${app.url}/@id/__x00__virtual:motion-document`)).text()).includes('port-preserved'); } catch { return false; }
    }, { timeout: 15000 }).toBe(true);
    await reloaded; await expect(page.locator('[data-editor-ready]')).toBeVisible();
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().exportDigest)).toBe(before);
    await app.stop();
    await expect.poll(async () => { try { await fetch(app.url); return false; } catch { return true; } }).toBe(true);
  } finally {
    for (const stop of stops.splice(0)) await stop();
    execFileSync('git', ['worktree', 'remove', '--force', checkout], { cwd: root, stdio: 'ignore' });
  }
});

test('remote edits invalidate action drafts and pending preparation prevents cross-shot navigation', async ({ page, context }) => {
  const app = await launch(); await page.goto(app.url);
  const first = await page.locator('[data-project-shot]').inputValue();
  await page.locator('[data-new-shot] summary').click(); await page.getByLabel('Shot name', { exact: true }).fill('Concurrent study');
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  await expect(page.locator('[data-project-shot] option:checked')).toHaveText('Concurrent study');
  const shot = await page.locator('[data-project-shot]').inputValue();
  await page.locator('[data-action-target]').selectOption({ label: 'Object A' });
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.locator('[data-action-form] input[name=end]').fill('2400');
  const other = await context.newPage(); await other.goto(`${app.url}/?shot=${shot}`);
  await other.locator('[data-action-target]').selectOption({ label: 'Object B' });
  await other.getByRole('button', { name: 'Fade', exact: true }).click();
  await other.getByRole('button', { name: 'Apply action', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
  await expect(page.getByRole('button', { name: 'Apply action', exact: true })).toBeDisabled();
  await expect(page.locator('[data-action-explanation]')).toContainText('saved shot changed');
  await expect(page.locator('[data-action-form] input[name=end]')).toHaveValue('2400');
  await page.getByRole('button', { name: 'Discard action draft', exact: true }).click();
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  let release!: () => void; let reached!: () => void;
  const gate = new Promise<void>(done => { release = done; }); const intercepted = new Promise<void>(done => { reached = done; });
  await page.route('**/operations/prepare', async route => { reached(); await gate; await route.continue(); });
  try {
    await page.getByRole('button', { name: 'Apply action', exact: true }).click(); await intercepted;
    await page.locator('[data-project-shot]').selectOption(first);
    await expect(page.locator('[data-entry-status]')).toContainText('Wait for the current change');
    await expect(page.locator('[data-project-shot]')).toHaveValue(shot);
    await expect(page.locator('[data-action-form] input[name=end]')).toBeDisabled();
    release(); await expect(page.locator('[data-action-status]')).toContainText('Move applied. Revision 2');
    await page.locator('[data-project-shot]').selectOption(first);
    await expect(page.locator('[data-project-shot]')).toHaveValue(first);
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(0);
  } finally { release(); await other.close(); }
});

test('normal interaction starter exposes the remaining supported cue actions without a mode restart', async ({ page }) => {
  test.setTimeout(60000);
  const app = await launch(); await page.goto(app.url);
  for (const action of ['Reveal', 'Click', 'Select', 'Drag', 'Hold selected object']) {
    await page.locator('[data-new-shot] summary').click(); await page.getByLabel('Shot name', { exact: true }).fill(`${action} study`);
    await page.getByLabel('Starting point').selectOption('reusable-cues');
    await page.getByRole('button', { name: 'Create shot', exact: true }).click();
    await expect(page.locator('[data-project-shot] option:checked')).toHaveText(`${action} study`);
    const count = await page.locator('[data-action-target] option').count(); let found = false;
    for (let index = 0; index < count; index += 1) {
      await page.locator('[data-action-target]').selectOption({ index });
      if (await page.getByRole('button', { name: action, exact: true }).isEnabled()) { found = true; break; }
    }
    expect(found, `${action} should have an eligible target in the public interaction starter`).toBe(true);
    const before = await page.evaluate(() => window.__motionEditor.inspectAuthoring().exportDigest);
    await page.getByRole('button', { name: action, exact: true }).click();
    await expect(page.getByRole('button', { name: 'Apply action', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Apply action', exact: true }).click();
    await expect(page.locator('[data-action-status]')).toContainText(`${action} applied. Revision 1`);
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().exportDigest)).not.toBe(before);
    const native = await page.locator('[data-preview]').evaluate((frame: HTMLIFrameElement) =>
      frame.contentDocument!.getAnimations().length > 0 && frame.contentDocument!.getAnimations().every(animation => animation.constructor.name === 'CSSAnimation'));
    expect(native).toBe(true);
  }
});

test('a custom fade midpoint follows its actual timing and survives timing changes and undo', async ({ page }) => {
  const app = await launch(); await page.goto(app.url);
  await page.locator('[data-new-shot] summary').click(); await page.getByLabel('Shot name', { exact: true }).fill('Custom fade');
  await page.getByLabel('Starting point').selectOption('html-css'); await page.getByLabel('Self-contained HTML and CSS').fill(source);
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  await expect(page.locator('[data-project-shot] option:checked')).toHaveText('Custom fade');
  await page.locator('[data-action-target]').selectOption({ label: 'Mission caption' });
  await page.getByRole('button', { name: 'Fade', exact: true }).click();
  await page.locator('[data-action-form] input[name=start]').fill('120');
  await page.locator('[data-action-form] input[name=end]').fill('1920');
  await page.getByRole('button', { name: 'Apply action', exact: true }).click();
  await expect(page.locator('[data-action-status]')).toContainText('Fade applied. Revision 1');
  await page.getByRole('button', { name: 'Add midpoint', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(2);
  const middle = await page.evaluate(() => window.__motionEditor.canonicalProjection.rows.find(row => row.property === 'opacity')!.keyframes.find(frame => frame.offset === .5));
  expect(middle?.timeMs).toBe(1020);
  await page.getByLabel('Duration draft').fill('2000'); await page.getByRole('button', { name: 'Apply duration', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(3);
  const moved = await page.evaluate(() => window.__motionEditor.canonicalProjection.rows.find(row => row.property === 'opacity')!.keyframes.find(frame => frame.offset === .5));
  expect(moved).toMatchObject({ id: middle?.id, timeMs: 1120 });
  await page.getByRole('button', { name: 'Remove midpoint', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(4);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(5);
  expect(await page.evaluate(() => window.__motionEditor.canonicalProjection.rows.find(row => row.property === 'opacity')!.keyframes.find(frame => frame.offset === .5))).toEqual(moved);
});

test('a lost admission response retries the same creation instead of duplicating the shot', async ({ page }) => {
  const app = await launch(); await page.goto(app.url);
  await page.locator('[data-new-shot] summary').click(); await page.getByLabel('Shot name', { exact: true }).fill('One intended shot');
  let lost = false; const requests: string[] = [];
  await page.route('**/api/project/v1/shots', async route => {
    requests.push(route.request().postData()!);
    if (!lost) { lost = true; await route.fetch(); await route.abort('connectionreset'); }
    else await route.continue();
  });
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  await expect(page.locator('[data-entry-status]')).toContainText('Could not confirm creation');
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  await expect(page.locator('[data-project-shot] option:checked')).toHaveText('One intended shot');
  await expect(page.locator('[data-project-shot] option')).toHaveCount(2);
  expect(requests).toHaveLength(2); expect(requests[1]).toBe(requests[0]);
});

for (const removal of ['Delete', 'Detach'] as const) test(`remote ${removal.toLowerCase()} preserves an edited action draft until explicit discard`, async ({ page, context }) => {
  const app = await launch(); await page.goto(app.url);
  const first = await page.locator('[data-project-shot]').inputValue();
  await page.locator('[data-new-shot] summary').click(); await page.getByLabel('Shot name', { exact: true }).fill('Edited action');
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  await expect(page.locator('[data-project-shot] option:checked')).toHaveText('Edited action');
  const shot = await page.locator('[data-project-shot]').inputValue();
  await page.locator('[data-action-target]').selectOption({ label: 'Object A' });
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.getByRole('button', { name: 'Apply action', exact: true }).click();
  await expect(page.locator('[data-action-status]')).toContainText('Move applied. Revision 1');
  await page.getByRole('region', { name: 'Created actions' }).getByRole('button', { name: 'Edit', exact: true }).click();
  await page.locator('[data-action-form] input[name=end]').fill('2400');
  const selected = await page.locator('[data-action-target]').inputValue();
  const other = await context.newPage(); await other.goto(`${app.url}/?shot=${shot}`);
  await other.getByRole('region', { name: 'Created actions' }).getByRole('button', { name: removal, exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(2);
  await expect(page.locator('[data-action-form]')).toHaveAttribute('data-project-draft', 'true');
  await expect(page.locator('[data-action-form] input[name=end]')).toHaveValue('2400');
  await expect(page.locator('[data-action-target]')).toHaveValue(selected);
  await expect(page.getByRole('button', { name: 'Update action', exact: true })).toBeDisabled();
  await expect(page.locator('[data-action-explanation]')).toContainText('saved shot changed');
  await page.locator('[data-project-shot]').selectOption(first);
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Stay here', exact: true }).click();
  await expect(page.locator('[data-project-shot]')).toHaveValue(shot);
  await expect(page.locator('[data-action-form] input[name=end]')).toHaveValue('2400');
  await page.getByRole('button', { name: 'Discard action draft', exact: true }).click();
  await expect(page.locator('[data-action-form]')).toHaveAttribute('data-project-draft', 'false');
  await page.locator('[data-project-shot]').selectOption(first);
  await expect(page.locator('[data-project-shot]')).toHaveValue(first);
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(0);
  await other.close();
});

for (const pending of [false, true]) test(`delayed shot admission preserves a subsequently started ${pending ? 'pending operation' : 'action draft'}`, async ({ page }) => {
  const app = await launch(); await page.goto(app.url);
  const first = await page.locator('[data-project-shot]').inputValue();
  await page.locator('[data-new-shot] summary').click(); await page.getByLabel('Shot name', { exact: true }).fill('Delayed creation');
  let releaseAdmission!: () => void; let reachedAdmission!: () => void;
  const admissionGate = new Promise<void>(done => { releaseAdmission = done; });
  const admissionReached = new Promise<void>(done => { reachedAdmission = done; });
  await page.route('**/api/project/v1/shots', async route => {
    const response = await route.fetch(); reachedAdmission(); await admissionGate; await route.fulfill({ response });
  });
  let releaseOperation!: () => void; let reachedOperation!: () => void;
  const operationGate = new Promise<void>(done => { releaseOperation = done; });
  const operationReached = new Promise<void>(done => { reachedOperation = done; });
  if (pending) await page.route('**/operations/prepare', async route => { reachedOperation(); await operationGate; await route.continue(); });
  try {
    await page.getByRole('button', { name: 'Create shot', exact: true }).click(); await admissionReached;
    for (const control of await page.locator('[data-shot-create] input, [data-shot-create] select, [data-shot-create] textarea').all()) await expect(control).toBeDisabled();
    await expect(page.getByLabel('Shot name', { exact: true })).toHaveValue('Delayed creation');
    await page.getByRole('button', { name: 'Move', exact: true }).click();
    await page.locator('[data-action-form] input[name=end]').fill('2400');
    if (pending) { await page.getByRole('button', { name: 'Apply action', exact: true }).click(); await operationReached; }
    releaseAdmission();
    await expect(page.locator('[data-project-shot] option')).toHaveCount(2);
    for (const control of await page.locator('[data-shot-create] input, [data-shot-create] select, [data-shot-create] textarea').all()) await expect(control).toBeEnabled();
    await expect(page.getByLabel('Shot name', { exact: true })).toHaveValue('Delayed creation');
    await expect(page.locator('[data-project-shot]')).toHaveValue(first);
    await expect(page.locator('[data-action-form] input[name=end]')).toHaveValue('2400');
    const created = await page.locator('[data-project-shot] option', { hasText: 'Delayed creation' }).getAttribute('value');
    expect(created).toBeTruthy();
    if (pending) {
      await expect(page.locator('[data-entry-status]')).toContainText('Wait for the current change');
      await expect(page.getByRole('dialog')).not.toBeVisible();
      releaseOperation(); await expect(page.locator('[data-action-status]')).toContainText('Move applied. Revision 1');
      await page.locator('[data-project-shot]').selectOption(created!);
    } else {
      await expect(page.getByRole('dialog')).toBeVisible();
      await page.getByRole('button', { name: 'Stay here', exact: true }).click();
      await expect(page.locator('[data-action-form] input[name=end]')).toHaveValue('2400');
      await page.locator('[data-project-shot]').selectOption(created!);
      await page.getByRole('button', { name: 'Discard changes and switch', exact: true }).click();
    }
    await expect(page.locator('[data-project-shot] option:checked')).toHaveText('Delayed creation');
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(0);
    await page.locator('[data-project-shot]').selectOption(first);
    await expect(page.locator('[data-project-shot]')).toHaveValue(first);
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(pending ? 1 : 0);
  } finally { releaseAdmission(); releaseOperation(); }
});

test('discarding a blocking opacity track draft preserves the shot and new-shot input with keyboard recovery', async ({ page }) => {
  const app = await launch(); await page.goto(app.url);
  await expect(page.locator('[data-editor-ready]')).toBeVisible();
  const first = await page.locator('[data-project-shot]').inputValue();
  const before = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await page.getByRole('radio', { name: /Orb/ }).check();
  await page.locator('[data-new-shot] summary').click();
  await page.getByLabel('Shot name', { exact: true }).fill('Preserved opening');
  await page.getByRole('button', { name: 'Create shot', exact: true }).press('Enter');
  await expect(page.locator('[data-entry-status]')).toContainText('An opacity track draft is blocking creation');
  await expect(page.locator('[data-project-shot] option')).toHaveCount(1);
  // The next focusable control after Create shot is the contextual recovery.
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Discard opacity track draft', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('radio', { name: /Orb/ })).not.toBeChecked();
  await expect(page.getByLabel('Shot name', { exact: true })).toHaveValue('Preserved opening');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toEqual(before);
  await expect(page.getByRole('button', { name: 'Create shot', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-project-shot] option:checked')).toHaveText('Preserved opening');
  await page.locator('[data-project-shot]').selectOption(first);
  await expect(page.locator('[data-project-shot]')).toHaveValue(first);
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().exportDigest)).toBe(before.exportDigest);
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(before.revision);
});

test('track draft recovery preserves timing and action drafts and refuses to discard during a pending save', async ({ page }) => {
  const app = await launch(); await page.goto(app.url);
  await expect(page.locator('[data-editor-ready]')).toBeVisible();
  await page.getByRole('radio', { name: /Orb/ }).check(); await page.locator('[data-create-track]').click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
  await page.getByRole('radio', { name: /Cursor/ }).check();
  await page.getByRole('radio', { name: /Orb/ }).check();
  await page.getByLabel('Duration draft').fill('2345');
  await page.getByRole('button', { name: 'Move', exact: true }).click();
  await page.locator('[data-action-form] input[name=end]').fill('2400');
  await page.locator('[data-new-shot] summary').click(); await page.getByLabel('Shot name', { exact: true }).fill('Still pending');
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  const before = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await expect(page.getByLabel(/Duration draft/)).toHaveValue('2345');
  await page.getByRole('button', { name: 'Discard opacity track draft', exact: true }).click();
  await expect(page.getByLabel(/Duration draft/)).toHaveValue('2345');
  await expect(page.getByRole('button', { name: 'Apply duration', exact: true })).toBeEnabled();
  await expect(page.locator('.timing-control').filter({ has: page.locator('[data-duration]') })).toHaveAttribute('data-draft', 'true');
  await expect(page.locator('[data-action-form] input[name=end]')).toHaveValue('2400');
  await expect(page.locator('[data-entry-status]')).toContainText('Other editing drafts remain');
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  await expect(page.locator('[data-project-shot] option')).toHaveCount(1);
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toEqual(before);
  await page.getByRole('radio', { name: /Cursor/ }).check();
  await page.getByRole('button', { name: 'Create shot', exact: true }).click();
  let release!: () => void; let reached!: () => void;
  const gate = new Promise<void>(done => { release = done; }); const intercepted = new Promise<void>(done => { reached = done; });
  await page.route('**/operations/prepare', async route => { reached(); await gate; await route.continue(); });
  try {
    await page.getByRole('button', { name: 'Apply action', exact: true }).click(); await intercepted;
    await page.getByRole('button', { name: 'Discard opacity track draft', exact: true }).click();
    await expect(page.locator('[data-entry-status]')).toContainText('Wait for the current change');
    await expect(page.getByRole('radio', { name: /Cursor/ })).toBeChecked();
    await expect(page.getByLabel('Shot name', { exact: true })).toHaveValue('Still pending');
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
    release(); await expect(page.locator('[data-action-status]')).toContainText('Move applied. Revision 2');
    await expect(page.locator('[data-project-shot] option')).toHaveCount(1);
  } finally { release(); }
});
