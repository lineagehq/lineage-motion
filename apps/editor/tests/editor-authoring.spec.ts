import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

let editorUrl = '';
let serviceServer: ChildProcess | undefined;
let directory = '';

test.beforeEach(async () => {
  const root = resolve(import.meta.dirname, '../../..');
  directory = await mkdtemp(join(tmpdir(), 'lineage-motion-editor-'));
  const humanCapability = randomBytes(32).toString('base64url');
  const agentCapability = randomBytes(32).toString('base64url');
  serviceServer = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: root, env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'editor.sqlite'), PHASE3_EDITOR_PORT: '0',
      PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: agentCapability },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  editorUrl = await new Promise<string>((resolveAddress, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('EDITOR_TEST_SERVER_TIMEOUT')), 10000);
    serviceServer!.stdout!.on('data', (chunk) => { output += chunk.toString();
      const line = output.split('\n').find((candidate) => candidate.startsWith('{'));
      if (line) { clearTimeout(timer); resolveAddress((JSON.parse(line) as { editorUrl: string }).editorUrl); }
    });
    serviceServer!.once('exit', (code) => { clearTimeout(timer); reject(new Error(`EDITOR_TEST_SERVER_EXIT_${code}`)); });
  });
  await expect.poll(async () => { try { return (await fetch(editorUrl)).ok; } catch { return false; } }).toBe(true);
});

test.afterEach(async () => {
  if (serviceServer?.exitCode === null) { serviceServer.kill('SIGTERM');
    await new Promise((resolveExit) => serviceServer!.once('exit', resolveExit)); }
  await rm(directory, { recursive: true, force: true });
});


test('selects Cursor by pointer and creates a distinct deterministic contained bundle', async ({ page }) => {
  await page.goto(editorUrl);
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.getByRole('radio', { name: /Cursor/ }).click();
  const before = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await page.getByRole('button', { name: 'Create Cursor opacity track' }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
  const after = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(after.revision).toBe(1);
  expect(after.selectedCreationElementId).toBe('el_a2849ff826f3e167');
  expect(after.contentDigest).not.toBe(before.contentDigest);
  await expect(page.locator('[data-element-id="el_a2849ff826f3e167"][data-property="opacity"]')).toHaveCount(1);
  await expect(page.getByRole('radio', { name: /Orb/ })).toBeDisabled();
  expect(await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    const target = iframe.contentDocument!.querySelector('[data-motion-id="el_a2849ff826f3e167"]');
    return iframe.srcdoc === window.__motionEditor.compiledHtml && target !== null
      && iframe.contentDocument!.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation');
  })).toBe(true);
});

test('retains a rejected creation draft and clears it only after accepted application', async ({ page }) => {
  await page.goto(editorUrl);
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.getByRole('radio', { name: /Orb/ }).click();
  const rejected = await page.evaluate(async () => {
    const before = window.__motionEditor.inspectAuthoring();
    const result = await window.__motionEditor.dispatch({
      schemaVersion: 'motion.operation.v1', operationId: 'browser:stale-create', documentId: before.documentId,
      expectedRevision: 1, kind: 'motion.track.create', elementId: 'el_2dbee68b1ea318c8',
      payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 },
    });
    return { before, result, after: window.__motionEditor.inspectAuthoring() };
  });
  expect(rejected.result).toEqual({ ok: false, code: 'STALE_REVISION' });
  expect(rejected.after).toMatchObject({ revision: rejected.before.revision, contentDigest: rejected.before.contentDigest,
    exportDigest: rejected.before.exportDigest, compiledHtml: rejected.before.compiledHtml, draftDirty: true,
    draftConflictRevision: 0, draftStaleBaseRevision: 0, immutableRefetchCount: rejected.before.immutableRefetchCount + 1 });
  expect(rejected.after).toMatchObject({ revision: 0, draftDirty: true,
    selectedCreationElementId: 'el_2dbee68b1ea318c8', consumedOperationIds: [] });

  await page.getByRole('button', { name: 'Create Orb opacity track' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('Revision 1');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({
    revision: 1, draftDirty: false, draftStaleBaseRevision: null,
    selectedCreationElementId: 'el_2dbee68b1ea318c8',
  });
});

test('authors value and time through canonical operations with atomic history and native remounts', async ({ page }) => {
  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => failedRequests.push(request.failure()?.errorText ?? 'failed'));
  await page.goto(editorUrl);
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();

  const editable = page.locator('.keyframe:not(:disabled)');
  await page.locator('.inspect-panel').getByText('Inspect all tracks', { exact: true }).click();
  await expect(editable).toHaveCount(2);
  await editable.first().click();
  const s0 = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await page.locator('input[data-value]').fill('0.25');
  await page.getByRole('button', { name: 'Set value' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('Revision 1');
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
  const s1 = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(s1.revision).toBe(1);
  expect(s1.contentDigest).not.toBe(s0.contentDigest);
  expect(s1.compiledHtml).not.toBe(s0.compiledHtml);
  await page.locator('input[data-value]').fill('1.2');
  const invalidValueBaseline = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await page.getByRole('button', { name: 'Set value' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('Opacity value:');
  await expect(page.locator('input[data-value]')).toHaveAttribute('aria-invalid', 'true');
  const invalidValueAfter = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(invalidValueAfter).toEqual(invalidValueBaseline);
  expect(invalidValueAfter.draftDirty).toBe(true);
  expect(invalidValueAfter.draftValues['[data-value]']).toBe('1.2');

  await editable.last().focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('input[data-value]')).toBeFocused();
  await page.locator('[data-time]').fill('2180');
  await page.getByRole('button', { name: 'Set time' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('Revision 2');
  const s2 = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(s2.revision).toBe(2);
  expect(s2.contentDigest).not.toBe(s1.contentDigest);
  expect(await editable.last().getAttribute('data-time-ms')).toBe('2180');
  await expect(page.locator('[data-track-id][data-selected="true"]')).toHaveCount(1);
  await expect(page.locator('[data-preview-selection]')).toBeVisible();
  const selectionBox = await page.locator('[data-preview-selection]').boundingBox();
  expect(selectionBox).not.toBeNull();
  expect(selectionBox!.width).toBeGreaterThan(0);
  expect(selectionBox!.height).toBeGreaterThan(0);

  const rejected = await page.evaluate(async () => {
    const before = window.__motionEditor.inspectAuthoring();
    const keyframe = document.querySelector<HTMLElement>('.keyframe:not(:disabled)')!;
    const row = keyframe.closest<HTMLElement>('[data-track-id]')!;
    const result = await window.__motionEditor.dispatch({
      schemaVersion: 'motion.operation.v1', operationId: 'browser:stale', documentId: before.documentId,
      expectedRevision: 1, kind: 'motion.keyframe-value.set', elementId: row.dataset.elementId!,
      trackId: row.dataset.trackId!, keyframeId: keyframe.dataset.keyframeId!, payload: { value: 0.5 },
    });
    return { result, before, after: window.__motionEditor.inspectAuthoring(), srcdoc: (document.querySelector('[data-preview]') as HTMLIFrameElement).srcdoc };
  });
  expect(rejected.result).toEqual({ ok: false, code: 'STALE_REVISION' });
  expect(rejected.after).toMatchObject({ revision: rejected.before.revision, contentDigest: rejected.before.contentDigest,
    exportDigest: rejected.before.exportDigest, compiledHtml: rejected.before.compiledHtml,
    immutableRefetchCount: rejected.before.immutableRefetchCount + 1 });
  expect(rejected.srcdoc).toBe(s2.compiledHtml);
  expect(consoleErrors).toEqual(['Failed to load resource: the server responded with a status of 409 (Conflict)']);
  consoleErrors.length = 0;

  const expected = [s1, s0, s1, s2];
  for (const [index, name] of ['Undo', 'Undo', 'Redo', 'Redo'].entries()) {
    await page.getByRole('button', { name }).click();
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(index + 3);
    const current = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    expect(current.revision).toBe(index + 3);
    expect(current.contentDigest).toBe(expected[index]!.contentDigest);
    expect(current.exportDigest).toBe(expected[index]!.exportDigest);
    expect(current.compiledHtml).toBe(expected[index]!.compiledHtml);
  }

  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(7);
  await editable.first().click();
  await page.locator('input[data-value]').fill('0.5');
  await page.getByRole('button', { name: 'Set value' }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(8);
  expect((await page.evaluate(() => window.__motionEditor.inspectAuthoring())).redoCount).toBe(0);
  await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();

  await page.locator('[data-scrub]').fill('2181');
  expect(await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    return iframe.srcdoc === window.__motionEditor.compiledHtml
      && iframe.contentDocument!.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation');
  })).toBe(true);
  await page.getByRole('button', { name: 'Play' }).click();
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.getByRole('button', { name: 'Inspect reduced motion' }).click();
  await expect(page.locator('[data-reduced-motion-panel]')).toBeVisible();
  expect(consoleErrors).toEqual([]);
  expect(failedRequests).toEqual([]);
});

test('keeps the workflow responsive with overflow local to the track inspection', async ({ page }) => {
  for (const width of [1440, 1099, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(editorUrl);
    await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
    const layout = await page.evaluate(() => {
      const workflow = document.querySelector('.workflow')!.getBoundingClientRect();
      const preview = document.querySelector('.preview-panel')!.getBoundingClientRect();
      return { documentWidth: document.documentElement.scrollWidth, viewportWidth: innerWidth,
        workflowTop: workflow.top, workflowLeft: workflow.left, previewTop: preview.top, previewLeft: preview.left };
    });
    expect(layout.documentWidth).toBeLessThanOrEqual(layout.viewportWidth);
    if (width === 1440) {
      expect(Math.abs(layout.workflowTop - layout.previewTop)).toBeLessThan(2);
      expect(layout.previewLeft).toBeGreaterThan(layout.workflowLeft);
    } else {
      expect(layout.previewTop).toBeGreaterThan(layout.workflowTop);
    }
    if (width <= 768) {
      await page.locator('.inspect-panel').getByText('Inspect all tracks', { exact: true }).click();
      const overflow = await page.locator('.timeline-panel').evaluate((node) => ({
        local: node.scrollWidth > node.clientWidth,
        document: document.documentElement.scrollWidth <= innerWidth,
      }));
      expect(overflow).toEqual({ local: true, document: true });
    }
  }
});
