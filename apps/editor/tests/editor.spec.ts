import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const editorUrl = 'http://127.0.0.1:41738';
let fallbackServer: ChildProcess | undefined;

test.beforeAll(async () => {
  if (await serverReady()) return;
  const root = resolve(import.meta.dirname, '../../..');
  fallbackServer = spawn(process.execPath, [
    resolve(root, 'node_modules/vite/bin/vite.js'), '--config',
    resolve(root, 'apps/editor/vite.config.ts'), '--host', '127.0.0.1', '--port', '41738',
  ], { cwd: root, stdio: 'ignore' });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await serverReady()) return;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('EDITOR_TEST_SERVER_TIMEOUT');
});

test.afterAll(() => fallbackServer?.kill('SIGTERM'));

async function serverReady(): Promise<boolean> {
  try { return (await fetch(editorUrl)).ok; } catch { return false; }
}

test('renders exact compiled output and controls native animations without mutation', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto(editorUrl);
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await expect(page).toHaveTitle('Motion Editor');

  const proof = await page.evaluate(() => {
    const editor = window.__motionEditor;
    const iframe = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    const animations = iframe.contentDocument!.getAnimations();
    return {
      sandbox: iframe.getAttribute('sandbox'),
      exactOutput: iframe.srcdoc === editor.compiledHtml,
      nativeAnimations: animations.length > 0
        && animations.every((animation) => animation.constructor.name === 'CSSAnimation'),
      animationCount: animations.length,
      trackIds: editor.trackIds,
      cueIds: editor.cueIds,
      canonicalProjection: editor.canonicalProjection,
    };
  });
  expect(proof).toEqual(expect.objectContaining({
    sandbox: 'allow-same-origin',
    exactOutput: true,
    nativeAnimations: true,
  }));
  expect(proof.trackIds).toHaveLength(await page.locator('[data-track-id]').count());
  expect(new Set(await page.locator('[data-track-id]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-track-id'))))).toEqual(new Set(proof.trackIds));
  const timelineProof = await page.locator('[data-track-id]').evaluateAll((nodes) => nodes.map((node) => ({
    elementId: node.getAttribute('data-element-id'),
    property: node.getAttribute('data-property'),
    delayMs: Number(node.getAttribute('data-delay-ms')),
    slotCount: Number(node.getAttribute('data-slot-count')),
    timingKind: node.getAttribute('data-timing-kind'),
    declaredKeyframes: Number(node.getAttribute('data-keyframe-count')),
    renderedKeyframes: node.querySelectorAll('[data-keyframe-id]').length,
  })));
  expect(timelineProof.every((row) => row.elementId && row.property
    && Number.isFinite(row.delayMs) && row.declaredKeyframes === row.renderedKeyframes)).toBe(true);
  expect(timelineProof.some((row) => row.slotCount > 1)).toBe(true);
  expect(timelineProof.some((row) => row.timingKind === 'steps')).toBe(true);
  const renderedProjection = await page.evaluate(() => ({
    schemaVersion: 'motion.timeline-projection.v1',
    durationMs: Number(document.querySelector('[data-timeline]')!.getAttribute('data-duration-ms')),
    rows: [...document.querySelectorAll<HTMLElement>('[data-track-id]')].map((row) => ({
      trackId: row.dataset.trackId,
      elementId: row.dataset.elementId,
      property: row.dataset.property,
      ruleId: row.dataset.ruleId,
      applicationId: row.dataset.applicationId,
      activeSlotId: row.dataset.activeSlotId,
      orderedSlotIds: [...row.querySelectorAll<HTMLElement>('[data-slot-id]')]
        .map((slot) => slot.dataset.slotId),
      interpolation: row.dataset.interpolation,
      timing: JSON.parse(row.dataset.timing ?? 'null'),
      delayMs: Number(row.dataset.delayMs),
      keyframes: [...row.querySelectorAll<HTMLElement>('[data-keyframe-id]')].map((keyframe) => ({
        id: keyframe.dataset.keyframeId,
        offset: Number(keyframe.dataset.offset),
        value: keyframe.dataset.value,
        easing: JSON.parse(keyframe.dataset.easing ?? 'null'),
        timeMs: Number(keyframe.dataset.timeMs),
      })),
    })),
    cues: [...document.querySelectorAll<HTMLElement>('[data-cue-id]')].map((cue) => ({
      schemaVersion: cue.dataset.schemaVersion,
      id: cue.dataset.cueId,
      label: cue.dataset.label,
      timeMs: Number(cue.dataset.timeMs),
    })),
    reducedMotion: {
      mode: document.querySelector<HTMLElement>('[data-reduced-motion-panel]')!.dataset.mode,
      css: document.querySelector<HTMLElement>('[data-reduced-motion-panel]')!.dataset.css,
    },
  }));
  expect(renderedProjection).toEqual(proof.canonicalProjection);

  for (const cueId of proof.cueIds) {
    await page.locator(`[data-cue-id="${cueId}"]`).click();
    const state = await page.evaluate(() => window.__motionEditor.readState());
    expect(state.currentTimes.every((time) => time === state.playheadMs)).toBe(true);
    expect(state.playStates.every((playState) => playState === 'paused')).toBe(true);
  }

  await page.locator('[data-scrub]').fill('1000');
  const beforePlay = await page.evaluate(() => window.__motionEditor.readState().currentTimes);
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(180);
  const duringPlay = await page.evaluate(() => window.__motionEditor.readState().currentTimes);
  expect(duringPlay.every((time, index) => time !== null && beforePlay[index] !== null
    && time - beforePlay[index]! >= 50 && time - beforePlay[index]! <= 1000)).toBe(true);
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.readState().playStates))
    .toEqual(Array(proof.animationCount).fill('paused'));
  await page.waitForTimeout(50);
  const afterPause = await page.evaluate(() => window.__motionEditor.readState().currentTimes);
  await page.waitForTimeout(160);
  const pausedInterval = await page.evaluate(() => window.__motionEditor.readState().currentTimes);
  expect(pausedInterval.every((time, index) => time !== null && afterPause[index] !== null
    && Math.abs(time - afterPause[index]!) <= 2)).toBe(true);

  await page.getByRole('button', { name: 'Inspect reduced motion' }).click();
  await expect(page.locator('[data-reduced-motion-panel]')).toBeVisible();
  await expect(page.locator('[data-reduced-motion-panel]')).toContainText('source-snapshot');
  expect(await page.locator('input[type="number"]').count()).toBe(4);
  expect(consoleErrors).toEqual([]);
});

test('selects Orb by keyboard and completes exact creation and six-step history', async ({ page }) => {
  const failedRequests: string[] = [];
  page.on('requestfailed', (request) => failedRequests.push(request.failure()?.errorText ?? 'failed'));
  await page.goto(editorUrl);
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select a target' })).toBeDisabled();
  const selectionBefore = await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    Object.assign(iframe.contentWindow!, { __selectionSentinel: 'unchanged' });
    return window.__motionEditor.inspectAuthoring();
  });
  await page.getByRole('radio', { name: /Orb — Opacity/ }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('radio', { name: /Orb — Opacity/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Create Orb opacity track' })).toBeEnabled();
  const selectionAfter = await page.evaluate(() => ({
    state: window.__motionEditor.inspectAuthoring(),
    sentinel: (document.querySelector<HTMLIFrameElement>('[data-preview]')!.contentWindow as unknown as
      { __selectionSentinel?: string }).__selectionSentinel,
  }));
  expect(selectionAfter.sentinel).toBe('unchanged');
  expect(selectionAfter.state).toEqual({ ...selectionBefore,
    selectedCreationElementId: 'el_2dbee68b1ea318c8' });
  await expect(page.getByRole('button', { name: 'Add midpoint' })).toBeDisabled();
  await expect(page.locator('[data-duration]')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remove midpoint' })).toBeDisabled();
  const states = [await page.evaluate(() => window.__motionEditor.inspectAuthoring())];
  for (const [index, name] of ['Create Orb opacity track', 'Add midpoint', 'Apply', 'Apply'].entries()) {
    const button = name === 'Apply' ? page.locator(index === 2 ? '[data-set-duration]' : '[data-set-delay]')
      : page.getByRole('button', { name });
    await button.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-operation-status]')).toContainText(`Revision ${states.length}`);
    states.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
    if (index === 0) await expect(page.locator(`[data-element-id="el_2dbee68b1ea318c8"][data-property="opacity"] .keyframe[data-offset="0"]`)).toBeFocused();
    if (index === 1) await expect(page.locator(`[data-element-id="el_2dbee68b1ea318c8"][data-property="opacity"] .keyframe[data-offset="0.5"]`)).toBeFocused();
  }
  await page.locator('select[data-easing]').selectOption('ease-in-out');
  await page.locator('[data-set-easing]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-operation-status]')).toContainText('Revision 5');
  states.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  await page.getByRole('button', { name: 'Remove midpoint' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-operation-status]')).toContainText('Revision 6');
  states.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  await expect(page.locator(`[data-element-id="el_2dbee68b1ea318c8"][data-property="opacity"] .keyframe[data-offset="1"]`)).toBeFocused();
  expect(states.at(-1)!.revision).toBe(6);
  const created = page.locator(`[data-element-id="el_2dbee68b1ea318c8"][data-property="opacity"]`);
  await expect(created).toHaveCount(1);
  await expect(created.locator('[data-keyframe-id]')).toHaveCount(2);
  await expect(created).toHaveAttribute('data-delay-ms', '700');
  await expect(created).toHaveAttribute('data-timing', JSON.stringify({ kind: 'keyword', value: 'ease-in-out' }));
  expect(await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    return iframe.srcdoc === window.__motionEditor.compiledHtml
      && iframe.contentDocument!.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation');
  })).toBe(true);
  await expect(page.getByRole('radio', { name: /Cursor — Opacity/ })).toBeDisabled();
  await expect(page.locator('[data-choice-reason="el_a2849ff826f3e167"]'))
    .toHaveText('One created track is allowed in this document.');
  await page.locator('[data-duration]').fill('1400.5');
  await page.locator('[data-set-duration]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-duration]')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[data-operation-status]')).toContainText('AUTHORING_DURATION_INVALID');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toEqual(states.at(-1));
  for (let index = 0; index < 6; index += 1) {
    await page.getByRole('button', { name: 'Undo' }).click();
    const current = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    expect(current.revision).toBe(7 + index);
    expect(current.contentDigest).toBe(states[5 - index]!.contentDigest);
    expect(current.exportDigest).toBe(states[5 - index]!.exportDigest);
  }
  for (let index = 0; index < 6; index += 1) {
    await page.getByRole('button', { name: 'Redo' }).click();
    const current = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    expect(current.revision).toBe(13 + index);
    expect(current.contentDigest).toBe(states[index + 1]!.contentDigest);
    expect(current.exportDigest).toBe(states[index + 1]!.exportDigest);
  }
  expect(failedRequests).toEqual([]);
});

test('selects Cursor by pointer and creates a distinct deterministic contained bundle', async ({ page }) => {
  await page.goto(editorUrl);
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.getByRole('radio', { name: /Cursor — Opacity/ }).click();
  const before = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await page.getByRole('button', { name: 'Create Cursor opacity track' }).click();
  const after = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(after.revision).toBe(1);
  expect(after.selectedCreationElementId).toBe('el_a2849ff826f3e167');
  expect(after.contentDigest).not.toBe(before.contentDigest);
  await expect(page.locator('[data-element-id="el_a2849ff826f3e167"][data-property="opacity"]')).toHaveCount(1);
  await expect(page.getByRole('radio', { name: /Orb — Opacity/ })).toBeDisabled();
  expect(await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    const target = iframe.contentDocument!.querySelector('[data-motion-id="el_a2849ff826f3e167"]');
    return iframe.srcdoc === window.__motionEditor.compiledHtml && target !== null
      && iframe.contentDocument!.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation');
  })).toBe(true);
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
  await page.getByRole('button', { name: 'Set value' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('Opacity value:');
  await expect(page.locator('input[data-value]')).toHaveAttribute('aria-invalid', 'true');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toEqual(s1);

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
  expect(rejected.result).toEqual({ ok: false, code: 'AUTHORING_STALE_REVISION' });
  expect(rejected.after).toEqual(rejected.before);
  expect(rejected.srcdoc).toBe(s2.compiledHtml);

  const expected = [s1, s0, s1, s2];
  for (const [index, name] of ['Undo', 'Undo', 'Redo', 'Redo'].entries()) {
    await page.getByRole('button', { name }).click();
    const current = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    expect(current.revision).toBe(index + 3);
    expect(current.contentDigest).toBe(expected[index]!.contentDigest);
    expect(current.exportDigest).toBe(expected[index]!.exportDigest);
    expect(current.compiledHtml).toBe(expected[index]!.compiledHtml);
  }

  await page.getByRole('button', { name: 'Undo' }).click();
  await editable.first().click();
  await page.locator('input[data-value]').fill('0.5');
  await page.getByRole('button', { name: 'Set value' }).click();
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
