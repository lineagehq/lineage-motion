import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

test('the canvas uses repeatable moments through the shared durable operation path', async ({ page }) => {
  test.setTimeout(90_000);
  const root = resolve(import.meta.dirname, '../../..');
  const directory = await mkdtemp(join(tmpdir(), 'lineage-motion-moments-'));
  const child: ChildProcess = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: root,
    env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'moments.sqlite'), PHASE3_EDITOR_PORT: '0',
      PHASE3_HUMAN_CAPABILITY: randomBytes(32).toString('base64url'),
      PHASE3_AGENT_CAPABILITY: randomBytes(32).toString('base64url'), LANDING_SHOT1_WORKSPACE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const { editorUrl } = await new Promise<{ editorUrl: string }>((resolveAddress, reject) => {
      let output = ''; const timer = setTimeout(() => reject(new Error('MOMENTS_SERVER_TIMEOUT')), 10_000);
      child.stdout!.on('data', (chunk) => { output += chunk.toString();
        const line = output.split('\n').find((candidate) => candidate.startsWith('{'));
        if (line) { clearTimeout(timer); resolveAddress(JSON.parse(line)); }
      });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`MOMENTS_SERVER_EXIT_${code}`)); });
    });
    const commandBodies: string[] = [];
    page.on('request', (request) => { if (request.url().endsWith('/api/v1/commands')) commandBodies.push(request.postData() ?? ''); });
    await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
    expect(new URL(page.url()).hostname).toBe('lineage-motion.localhost');
    const workspace = page.locator('[data-shot-workspace]');
    await expect(workspace).toBeVisible();
    await expect(workspace.getByRole('heading', { name: 'Shape motion directly on the canvas' })).toBeAttached();
    await expect(workspace.locator('[data-shot-advanced]')).not.toHaveAttribute('open', '');
    const momentValues = () => page.locator('input[name="shot-moment"]').evaluateAll((inputs) =>
      inputs.map((input) => Number((input as HTMLInputElement).value)));
    const canvasMomentLabels = () => page.locator('.trajectory-waypoint').evaluateAll((handles) => handles.map((handle) => ({
      name: handle.querySelector('.trajectory-waypoint-name')?.textContent,
      time: handle.querySelector('.trajectory-waypoint-time')?.textContent,
      ariaLabel: handle.getAttribute('aria-label'),
    })));
    const canvasLabelsOverlap = () => page.locator('.trajectory-waypoint-label').evaluateAll((labels) => labels.some((label, index) => {
      const current = label.getBoundingClientRect();
      return labels.slice(0, index).some((prior) => { const other = prior.getBoundingClientRect();
        return current.left < other.right && current.right > other.left && current.top < other.bottom && current.bottom > other.top; });
    }));
    expect(await momentValues()).toEqual([0, 700, 2100]);
    await expect.poll(canvasMomentLabels).toEqual([
      { name: 'Start', time: '0 ms', ariaLabel: 'Start, 0 ms, compiler-native target bounds' },
      { name: 'Point 1', time: '700 ms', ariaLabel: 'Point 1, 700 ms, compiler-native target bounds' },
      { name: 'Settle', time: '2100 ms', ariaLabel: 'Settle, 2100 ms, compiler-native target bounds' },
    ]);
    await expect(page.locator('.moment-add')).toHaveCount(2);
    const baseline = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    const dock = page.locator('[data-shot-context-dock]');
    await expect(dock.locator('[data-shot-context-name]')).toHaveText('Point 1');
    await expect(dock.locator('[data-shot-context-time]')).toHaveValue('700');
    await expect(dock.locator('[data-shot-context-easing]')).toHaveValue('ease-out');

    await page.locator('.moment-add').first().click();
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
    expect(await momentValues()).toEqual([0, 350, 700, 2100]);
    const pointOne = page.getByRole('radio', { name: 'Point 1 350 ms' });
    await expect(pointOne).toBeChecked();
    await expect(pointOne).toBeFocused();
    await expect(dock.locator('[data-shot-context-name]')).toHaveText('Point 1');
    await expect(dock.locator('[data-shot-context-time]')).toHaveValue('350');
    await expect(page.locator('[data-shot-moments]').getByText('Point 1', { exact: true })).toBeVisible();
    await expect(page.locator('[data-shot-moments]').getByText('Point 2', { exact: true })).toBeVisible();
    await expect.poll(canvasMomentLabels).toEqual([
      { name: 'Start', time: '0 ms', ariaLabel: 'Start, 0 ms, compiler-native target bounds' },
      { name: 'Point 1', time: '350 ms', ariaLabel: 'Point 1, 350 ms, compiler-native target bounds' },
      { name: 'Point 2', time: '700 ms', ariaLabel: 'Point 2, 700 ms, compiler-native target bounds' },
      { name: 'Settle', time: '2100 ms', ariaLabel: 'Settle, 2100 ms, compiler-native target bounds' },
    ]);
    expect(await canvasLabelsOverlap()).toBe(false);
    await workspace.getByRole('radio', { name: 'Primary Object 2' }).check();
    expect(await momentValues()).toEqual([0, 700, 2100]);
    await expect.poll(canvasMomentLabels).toEqual([
      { name: 'Start', time: '0 ms', ariaLabel: 'Start, 0 ms, compiler-native target bounds' },
      { name: 'Point 1', time: '700 ms', ariaLabel: 'Point 1, 700 ms, compiler-native target bounds' },
      { name: 'Settle', time: '2100 ms', ariaLabel: 'Settle, 2100 ms, compiler-native target bounds' },
    ]);
    await workspace.getByRole('radio', { name: 'Primary Object 1' }).check();
    expect(await momentValues()).toEqual([0, 350, 700, 2100]);
    await page.locator('input[name="shot-moment"][value="350"]').check();

    await workspace.locator('[data-shot-moment-time]').fill('420');
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(2);
    expect(await momentValues()).toEqual([0, 420, 700, 2100]);
    await expect(page.locator('input[name="shot-moment"][value="420"]')).toBeChecked();
    await workspace.locator('[data-shot-easing]').selectOption('ease-in-out');
    await workspace.locator('[data-shot-apply-easing]').click();
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(3);

    await dock.locator('[data-shot-context-remove]').click();
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(4);
    expect(await momentValues()).toEqual([0, 700, 2100]);
    await expect(page.getByRole('radio', { name: 'Start 0 ms' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Start 0 ms' })).toBeFocused();
    expect((await page.evaluate(() => window.__motionEditor.inspectAuthoring())).contentDigest).toBe(baseline.contentDigest);
    await page.locator('[data-undo]').click();
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(5);
    expect(await momentValues()).toEqual([0, 420, 700, 2100]);
    await page.locator('[data-redo]').click();
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(6);
    expect(await momentValues()).toEqual([0, 700, 2100]);

    expect(commandBodies.map((bytes) => (JSON.parse(bytes) as { command: { kind: string } }).command.kind)).toEqual([
      'motion.transform-waypoint.add', 'motion.keyframe-group-time.set', 'motion.keyframe-group-easing.set',
      'motion.transform-waypoint.remove', 'motion.history.undo', 'motion.history.redo',
    ]);
    expect((JSON.parse(commandBodies[0]!) as { command: { intent: { elementIds: string[] } } }).command.intent.elementIds).toHaveLength(1);
    expect(commandBodies.every((bytes) => !/expectedTransform|selectorHint|structuralFingerprint|\/Users\//.test(bytes))).toBe(true);
    expect(await page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      return frame.srcdoc === window.__motionEditor.compiledHtml
        && frame.contentDocument!.getAnimations().length > 0
        && frame.contentDocument!.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation'); })).toBe(true);
  } finally {
    if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise((resolveExit) => child.once('exit', resolveExit)); }
    await rm(directory, { recursive: true, force: true });
  }
});
