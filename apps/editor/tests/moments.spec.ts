import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

async function startCanvasFirstEditor(label: string): Promise<{
  editorUrl: string;
  close: () => Promise<void>;
}> {
  const root = resolve(import.meta.dirname, '../../..');
  const directory = await mkdtemp(join(tmpdir(), `lineage-motion-${label}-`));
  const child: ChildProcess = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: root,
    env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'moments.sqlite'), PHASE3_EDITOR_PORT: '0',
      PHASE3_HUMAN_CAPABILITY: randomBytes(32).toString('base64url'),
      PHASE3_AGENT_CAPABILITY: randomBytes(32).toString('base64url'), LANDING_SHOT1_WORKSPACE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    const { editorUrl } = await new Promise<{ editorUrl: string }>((resolveAddress, reject) => {
      let output = ''; const timer = setTimeout(() => reject(new Error(`${label.toUpperCase()}_SERVER_TIMEOUT`)), 10_000);
      child.stdout!.on('data', (chunk) => { output += chunk.toString();
        const line = output.split('\n').find((candidate) => candidate.startsWith('{'));
        if (line) { clearTimeout(timer); resolveAddress(JSON.parse(line)); }
      });
      child.once('exit', (code) => { clearTimeout(timer); reject(new Error(`${label.toUpperCase()}_SERVER_EXIT_${code}`)); });
    });
    return { editorUrl, close: async () => {
      if (child.exitCode === null) { child.kill('SIGTERM'); await new Promise((resolveExit) => child.once('exit', resolveExit)); }
      await rm(directory, { recursive: true, force: true });
    } };
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGTERM');
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}

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

    for (const viewport of [{ width: 1440, height: 900 }, { width: 680, height: 900 }]) {
      await page.setViewportSize(viewport);
      await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
      const interactionGeometry = await page.evaluate(() => ({
        handles: [...document.querySelectorAll<HTMLElement>('.trajectory-waypoint, .preview-transform-handle')]
          .filter((node) => !node.hidden && getComputedStyle(node).visibility !== 'hidden')
          .map((node) => {
            const size = node.matches('.trajectory-waypoint')
              ? getComputedStyle(node, '::before')
              : node.getBoundingClientRect();
            return { width: parseFloat(String(size.width)), height: parseFloat(String(size.height)) };
          }),
        railVisible: document.querySelector<HTMLElement>('[data-preview-control-rail]')!.getBoundingClientRect().bottom <= innerHeight,
        railBottom: document.querySelector<HTMLElement>('[data-preview-control-rail]')!.getBoundingClientRect().bottom,
        viewportHeight: innerHeight,
        objectBarOverlapsSelection: (() => {
          const bar = document.querySelector<HTMLElement>('[data-shot-object-bar]')!.getBoundingClientRect();
          const selection = document.querySelector<HTMLElement>('[data-preview-selection]')!.getBoundingClientRect();
          return bar.left < selection.right && bar.right > selection.left && bar.top < selection.bottom && bar.bottom > selection.top;
        })(),
      }));
      expect(interactionGeometry.railVisible, JSON.stringify({ viewport, interactionGeometry })).toBe(true);
      expect(interactionGeometry.handles.every(({ width, height }) => width >= 44 && height >= 44),
        JSON.stringify({ viewport, handles: interactionGeometry.handles })).toBe(true);
      expect(interactionGeometry.objectBarOverlapsSelection).toBe(false);
      expect(await canvasLabelsOverlap()).toBe(false);
    }
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.route('**/operations/prepare', async (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({
      ok: false, code: 'VALIDATION', diagnostic: { schemaVersion: 'motion.diagnostic.v1', code: 'REJECTED_ADD', category: 'domain', retryable: false },
    }) }));
    const rejectedAdd = page.locator('.moment-add').first();
    await rejectedAdd.focus();
    await rejectedAdd.click();
    await expect(page.locator('[data-service-diagnostic]')).toContainText('REJECTED_ADD');
    expect(await momentValues()).toEqual([0, 700, 2100]);
    await expect(page.getByRole('radio', { name: 'Point 1 700 ms' })).toBeChecked();
    await expect(page.locator('.moment-add').first()).toBeFocused();
    await page.unroute('**/operations/prepare');

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

test('responsive canvas controls keep exclusive hit ownership across every moment', async ({ page }) => {
  test.setTimeout(90_000);
  const editor = await startCanvasFirstEditor('responsive-hit-ownership');
  try {
    const commandKinds: string[] = [];
    page.on('request', (request) => { if (request.url().endsWith('/api/v1/commands')) {
      commandKinds.push((request.postDataJSON() as { command: { kind: string } }).command.kind);
    } });
    await page.goto(editor.editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
    await page.evaluate(() => window.__motionEditor.disconnectEvents());
    const waitForRevision = async (revision: number) => expect.poll(() =>
      page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(revision);
    await page.locator('.moment-add').first().click(); await waitForRevision(1);
    await page.locator('.moment-add').last().click(); await waitForRevision(2);
    await page.locator('[data-shot-context-easing]').selectOption('linear');
    await page.locator('[data-shot-apply-easing]').click(); await waitForRevision(3);
    await page.locator('[data-undo]').click(); await waitForRevision(4);
    await expect(page.locator('[data-undo]')).toBeEnabled(); await expect(page.locator('[data-redo]')).toBeEnabled();
    const expectedMoments = [0, 350, 700, 1400, 2100];
    expect(await page.locator('input[name="shot-moment"]').evaluateAll((inputs) =>
      inputs.map((input) => Number((input as HTMLInputElement).value)))).toEqual(expectedMoments);

    for (const viewport of [{ width: 680, height: 900 }, { width: 430, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame()))));
      await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
      for (const moment of expectedMoments) {
        const radio = page.locator(`input[name="shot-moment"][value="${moment}"]`);
        await radio.evaluate((input) => input.parentElement!.scrollIntoView({ block: 'nearest', inline: 'center' }));
        await expect.poll(() => radio.evaluate((input) => { const bounds = input.parentElement!.getBoundingClientRect();
          return bounds.width > 0 && bounds.height > 0; })).toBe(true);
        const chipBounds = await radio.evaluate((input) => { const bounds = input.parentElement!.getBoundingClientRect();
          return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
        });
        const revisionBeforeClick = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
        const chipOwnerBeforeClick = await page.evaluate(({ x, y }) => { const owner = document.elementFromPoint(x, y);
          return { tag: owner?.tagName, classes: owner?.className, text: owner?.textContent,
            inMoment: Boolean(owner?.closest('[data-shot-moments]')), inHistory: Boolean(owner?.closest('[data-shot-history-slot]')) };
        }, { x: chipBounds!.x + chipBounds!.width / 2, y: chipBounds!.y + chipBounds!.height / 2 });
        await page.mouse.click(chipBounds!.x + chipBounds!.width / 2, chipBounds!.y + chipBounds!.height / 2);
        expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(revisionBeforeClick);
        await expect(radio, JSON.stringify({ viewport, moment, chipBounds, chipOwnerBeforeClick })).toBeChecked();
        await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
        await page.locator('.preview-stage').scrollIntoViewIfNeeded();
        const ownership = await page.evaluate(() => {
          const rect = (selector: string) => document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
          const objectBar = rect('[data-shot-object-bar]'); const stage = rect('.preview-stage');
          const dock = rect('[data-shot-context-dock]'); const rail = rect('[data-preview-control-rail]');
          const history = rect('[data-shot-history-slot]');
          const ownsCenter = (node: HTMLElement) => { const bounds = node.getBoundingClientRect();
            const owner = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
            return owner === node || node.contains(owner) || owner?.closest('[data-preview-control-key]') === node;
          };
          const handles = [...document.querySelectorAll<HTMLElement>('.preview-transform-handle:not([hidden])')]
            .filter((node) => { const bounds = node.getBoundingClientRect();
              return bounds.left + bounds.width / 2 >= 0 && bounds.right - bounds.width / 2 <= innerWidth
                && bounds.top + bounds.height / 2 >= 0 && bounds.bottom - bounds.height / 2 <= innerHeight;
            });
          return {
            tracksDoNotOverlap: objectBar.bottom <= stage.top + .5 && stage.bottom <= dock.top + .5
              && dock.bottom <= rail.top + .5 && rail.bottom <= history.top + .5,
            allCanvasHandlesOwnTheirCenters: handles.length === 5 && handles.every(ownsCenter),
          };
        });
        expect(ownership, JSON.stringify({ viewport, moment })).toEqual({
          tracksDoNotOverlap: true,
          allCanvasHandlesOwnTheirCenters: true,
        });
      }
    }
    expect(commandKinds).toEqual([
      'motion.transform-waypoint.add', 'motion.transform-waypoint.add', 'motion.keyframe-group-easing.set', 'motion.history.undo',
    ]);
  } finally {
    await editor.close();
  }
});

test('keyboard order and activation cover the complete canvas-first workflow', async ({ page }) => {
  test.setTimeout(90_000);
  const editor = await startCanvasFirstEditor('keyboard-workflow');
  try {
    await page.goto(editor.editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
    await page.evaluate(() => window.__motionEditor.disconnectEvents());
    const waitForRevision = async (revision: number) => expect.poll(() =>
      page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(revision);
    const objectTwo = page.getByRole('radio', { name: 'Primary Object 2' }); await objectTwo.focus(); await objectTwo.press('Space');
    await expect(objectTwo).toBeChecked();
    const body = page.getByRole('button', { name: 'Object 2; drag to move' }); await body.focus(); await body.press('ArrowRight'); await waitForRevision(1);
    const objectOne = page.getByRole('radio', { name: 'Primary Object 1' }); await objectOne.focus();
    const visited = ['object'];
    for (let index = 0; index < 80 && visited.at(-1) !== 'history'; index += 1) {
      await page.keyboard.press('Tab');
      const surface = await page.evaluate(() => {
        const active = document.activeElement;
        if (active?.closest('[data-shot-object-bar]')) return 'object';
        if (active?.closest('.preview-stage')) return 'canvas';
        if (active?.closest('[data-preview-control-rail]')) return 'rail';
        if (active?.closest('[data-shot-advanced]')) return 'advanced';
        if (active?.closest('[data-shot-context-dock]')) return 'dock';
        if (active?.closest('[data-shot-history-slot]')) return 'history';
        return null;
      });
      if (surface && surface !== visited.at(-1)) visited.push(surface);
    }
    expect(visited).toEqual(['object', 'canvas', 'rail', 'dock', 'advanced', 'history']);
    expect(await page.evaluate(() => {
      const selectors = ['[data-shot-object-bar]', '.preview-stage', '[data-preview-control-rail]', '[data-shot-context-dock]',
        '[data-shot-advanced]', '[data-shot-history-slot]'];
      const nodes = selectors.map((selector) => document.querySelector(selector)!);
      return nodes.slice(0, -1).every((node, index) => Boolean(node.compareDocumentPosition(nodes[index + 1]!)
        & Node.DOCUMENT_POSITION_FOLLOWING));
    })).toBe(true);

    await objectTwo.focus(); await objectTwo.press('Space'); await expect(objectTwo).toBeChecked();
    const scale = page.getByRole('slider', { name: 'bottom right uniform scale handle for Object 2' });
    await scale.focus(); await scale.press('ArrowUp'); await waitForRevision(2);
    const rotate = page.getByRole('slider', { name: 'Rotation handle for Object 2' });
    await rotate.focus(); await rotate.press('ArrowRight'); await waitForRevision(3);
    const point = page.getByRole('radio', { name: 'Point 1 700 ms' }); await point.focus(); await point.press('Space');
    const add = page.locator('.moment-add').first(); await add.focus(); await add.press('Enter'); await waitForRevision(4);
    await expect(page.getByRole('radio', { name: 'Point 1 350 ms' })).toBeFocused();
    const time = page.locator('[data-shot-context-time]'); await time.focus(); await time.press('PageUp');
    await expect(time).not.toHaveValue('350'); await waitForRevision(5);
    await expect.poll(() => page.locator('input[name="shot-moment"]:checked').inputValue()).not.toBe('350');
    await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
    const easing = page.locator('[data-shot-context-easing]'); await expect(easing).toBeEnabled();
    await easing.focus(); await easing.press('g');
    await expect(easing).toHaveValue('ease-out');
    const applyMovement = page.locator('[data-shot-apply-easing]'); await applyMovement.focus(); await applyMovement.press('Enter'); await waitForRevision(6);
    const play = page.locator('[data-play]'); await play.focus(); await play.press('Enter');
    const pause = page.locator('[data-pause]'); await pause.focus(); await pause.press('Enter');
    const scrubber = page.locator('[data-scrub]'); await scrubber.focus(); await scrubber.press('Home');
    expect(await page.evaluate(() => window.__motionEditor.readState())).toMatchObject({ playheadMs: 0, playStates: ['paused', 'paused'] });
    const remove = page.locator('[data-shot-context-remove]'); await remove.focus(); await remove.press('Enter'); await waitForRevision(7);
    const undo = page.locator('[data-undo]'); await undo.focus(); await undo.press('Enter'); await waitForRevision(8);
    const redo = page.locator('[data-redo]'); await redo.focus(); await redo.press('Enter'); await waitForRevision(9);
    const advanced = page.locator('[data-shot-advanced-toggle]'); await advanced.focus(); await advanced.press('Enter');
    await expect(page.locator('[data-shot-advanced-drawer]')).toBeVisible(); await page.keyboard.press('Escape'); await expect(advanced).toBeFocused();
    expect(await page.evaluate(() => document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc
      === window.__motionEditor.compiledHtml)).toBe(true);
  } finally {
    await editor.close();
  }
});
