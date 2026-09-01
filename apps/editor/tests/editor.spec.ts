import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const editorUrl = 'http://127.0.0.1:41745';
let fallbackServer: ChildProcess | undefined;

test.beforeAll(async () => {
  if (await serverReady()) return;
  const root = resolve(import.meta.dirname, '../../..');
  fallbackServer = spawn(process.execPath, [
    resolve(root, 'node_modules/vite/bin/vite.js'), '--config',
    resolve(root, 'apps/editor/vite.config.ts'), '--host', '127.0.0.1', '--port', '41745',
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
  await expect(page.locator('[data-shot-workspace]')).toBeHidden();
  await expect(page.locator('[data-shot-targets] input')).toHaveCount(0);
  expect(await page.evaluate(() => window.__motionEditor.inspectShotWorkspace())).toMatchObject({ open: false });

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

  await page.locator('.inspect-panel').getByText('Inspect all tracks', { exact: true }).click();
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
  expect(await page.locator('input[type="number"]:visible').count()).toBe(4);
  expect(consoleErrors).toEqual([]);
});

test('inserts the fixed hold from Time, ripples native preview and timeline, then reverses exactly', async ({ page }) => {
  await page.goto(editorUrl);
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const before = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await expect(page.getByRole('button', { name: 'Insert 600 ms hold' })).toBeEnabled();
  await page.getByRole('button', { name: 'Insert 600 ms hold' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText(
    '600 ms hold inserted before Pair crosses. Revision 1.',
  );
  await expect(page.locator('[data-hold-status]')).toHaveText(
    '600 ms hold inserted · Pair crosses at 3470 ms · duration 5260 ms',
  );
  await expect(page.getByRole('button', { name: 'Insert 600 ms hold' })).toBeDisabled();
  await expect(page.locator('[data-duration]')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Add midpoint' })).toBeDisabled();
  expect(await page.locator('[data-timeline]').getAttribute('data-duration-ms')).toBe('5260');
  expect((await page.locator('[data-cue-id]').evaluateAll((nodes) => nodes.map((node) => ({
    id: (node as HTMLElement).dataset.cueId, timeMs: Number((node as HTMLElement).dataset.timeMs),
  })))).filter((cue) => ['cue_pair', 'cue_hold', 'cue_rest'].includes(cue.id ?? ''))).toEqual([
    { id: 'cue_pair', timeMs: 3470 }, { id: 'cue_hold', timeMs: 4910 },
    { id: 'cue_rest', timeMs: 5260 },
  ]);
  const held = await page.evaluate(() => {
    const editor = window.__motionEditor;
    const iframe = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    return {
      state: editor.inspectAuthoring(), projection: editor.canonicalProjection,
      exactOutput: iframe.srcdoc === editor.compiledHtml,
      native: iframe.contentDocument!.getAnimations().every((animation) =>
        animation.constructor.name === 'CSSAnimation'),
      scriptFree: !/<script|requestAnimationFrame|setTimeout/i.test(editor.compiledHtml),
    };
  });
  expect(held.exactOutput).toBe(true); expect(held.native).toBe(true); expect(held.scriptFree).toBe(true);
  expect(held.projection.holds).toEqual([expect.objectContaining({
    cueId: 'cue_pair', sourceTimeMs: 2870, durationMs: 600,
  })]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('[data-hold-status]')).toHaveText('No hold inserted · Pair crosses at 2870 ms');
  const undone = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(undone.contentDigest).toBe(before.contentDigest);
  expect(undone.exportDigest).toBe(before.exportDigest);
  await page.getByRole('button', { name: 'Redo' }).click();
  const redone = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(redone.contentDigest).toBe(held.state.contentDigest);
  expect(redone.exportDigest).toBe(held.state.exportDigest);
});

test('guides a first-time author through truthful creation, timing, focus, and exact history', async ({ page }) => {
  const failedRequests: string[] = [];
  let commandRequestCount = 0;
  page.on('requestfailed', (request) => failedRequests.push(request.failure()?.errorText ?? 'failed'));
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/commands')) commandRequestCount += 1;
  });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto(editorUrl);
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Select an element' })).toBeDisabled();
  await expect(page.getByText('No keyframe selected', { exact: true })).toBeVisible();
  await expect(page.getByText('Selected opacity keyframe', { exact: true })).toHaveCount(0);
  await expect(page.locator('.inspect-panel')).not.toHaveAttribute('open', '');
  await expect(page.locator('code:visible')).toHaveCount(0);
  const selectionBefore = await page.evaluate(() => {
    const iframe = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    Object.assign(iframe.contentWindow!, { __selectionSentinel: 'unchanged' });
    return window.__motionEditor.inspectAuthoring();
  });
  await page.getByRole('radio', { name: /Orb/ }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('radio', { name: /Orb/ })).toBeChecked();
  await expect(page.getByRole('button', { name: 'Create Orb opacity track' })).toBeEnabled();
  const selectionAfter = await page.evaluate(() => ({
    state: window.__motionEditor.inspectAuthoring(),
    sentinel: (document.querySelector<HTMLIFrameElement>('[data-preview]')!.contentWindow as unknown as
      { __selectionSentinel?: string }).__selectionSentinel,
  }));
  expect(selectionAfter.sentinel).toBe('unchanged');
  expect(selectionAfter.state).toEqual({ ...selectionBefore,
    selectedCreationElementId: 'el_2dbee68b1ea318c8', draftDirty: true });
  await expect(page.getByRole('button', { name: 'Add midpoint' })).toBeDisabled();
  await expect(page.locator('[data-duration]')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Remove midpoint' })).toBeDisabled();
  const states = [await page.evaluate(() => window.__motionEditor.inspectAuthoring())];
  const beforeCreateScroll = await page.evaluate(() => scrollY);
  await page.getByRole('button', { name: 'Create Orb opacity track' }).press('Enter');
  await expect(page.locator('[data-operation-status]')).toContainText('Revision 1');
  states.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  expect(states.at(-1)).toEqual(expect.objectContaining({ draftDirty: false, draftStaleBaseRevision: null }));
  await expect(page.getByRole('button', { name: 'Add midpoint' })).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(beforeCreateScroll);
  await expect(page.locator('[data-duration]')).toHaveValue('1000');
  await expect(page.locator('[data-delay]')).toHaveValue('610');
  await expect(page.locator('select[data-easing]')).toHaveValue('linear');
  await expect(page.locator('[data-applied-duration]')).toHaveText('Applied · 1000 ms');
  await expect(page.locator('[data-applied-delay]')).toHaveText('Applied · 610 ms');
  await expect(page.locator('[data-applied-easing]')).toHaveText('Applied · linear');
  await expect(page.locator('.timing-control em:visible')).toHaveCount(0);
  const beforeMidpointScroll = await page.evaluate(() => scrollY);
  await page.getByRole('button', { name: 'Add midpoint' }).press('Enter');
  await expect(page.locator('[data-operation-status]')).toContainText('Revision 2');
  states.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  await expect(page.locator('input[data-value]')).toBeEnabled();
  await expect(page.locator('input[data-time]')).toBeEnabled();
  await expect(page.locator('input[data-value]')).toBeFocused();
  await expect(page.getByText('Selected opacity keyframe', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => scrollY)).toBe(beforeMidpointScroll);
  expect(states.at(-1)!.selectedKeyframeId).toBe(await page.locator(
    `[data-element-id="el_2dbee68b1ea318c8"] .keyframe[data-offset="0.5"]`).getAttribute('data-keyframe-id'));
  await page.locator('[data-duration]').fill('1400');
  await expect(page.locator('[data-applied-duration]')).toHaveText('Applied · 1000 ms');
  await expect(page.locator('.timing-control:has([data-duration]) em')).toBeVisible();
  await page.getByRole('button', { name: 'Apply duration' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('Revision 3');
  states.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  await expect(page.locator('[data-applied-duration]')).toHaveText('Applied · 1400 ms');
  await expect(page.locator('.timing-control:has([data-duration]) em')).toBeHidden();
  await page.locator('[data-delay]').fill('700');
  await expect(page.locator('[data-applied-delay]')).toHaveText('Applied · 610 ms');
  await expect(page.locator('.timing-control:has([data-delay]) em')).toBeVisible();
  await page.getByRole('button', { name: 'Apply delay' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('Revision 4');
  states.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  await expect(page.locator('[data-applied-delay]')).toHaveText('Applied · 700 ms');
  await expect(page.locator('.timing-control:has([data-delay]) em')).toBeHidden();
  await page.locator('select[data-easing]').selectOption('ease-in-out');
  await expect(page.locator('[data-applied-easing]')).toHaveText('Applied · linear');
  await expect(page.locator('.timing-control:has([data-easing]) em')).toBeVisible();
  await page.getByRole('button', { name: 'Apply easing' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('Revision 5');
  states.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  await expect(page.locator('.timing-control:has([data-easing]) em')).toBeHidden();
  await page.getByRole('button', { name: 'Remove midpoint' }).press('Enter');
  await expect(page.locator('[data-operation-status]')).toContainText('Revision 6');
  states.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  await expect(page.getByRole('button', { name: 'Add midpoint' })).toBeFocused();
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
  await expect(page.getByRole('radio', { name: /Cursor/ })).toBeDisabled();
  await expect(page.locator('[data-choice-reason="el_a2849ff826f3e167"]'))
    .toHaveText('One created track is allowed in this document.');
  await page.locator('[data-duration]').fill('1400.5');
  const invalidBaseline = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  const invalidRequestBaseline = commandRequestCount;
  const appliedDurationBaseline = await page.locator('[data-applied-duration]').textContent();
  await page.locator('[data-set-duration]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-duration]')).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('[data-operation-status]')).toContainText('AUTHORING_DURATION_INVALID');
  await expect(page.locator('[data-applied-duration]')).toHaveText('Applied · 1400 ms');
  await expect(page.locator('[data-duration]')).toHaveValue('1400.5');
  await expect(page.locator('.timing-control:has([data-duration]) em')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Apply duration' })).toBeFocused();
  await expect(page.locator('[data-operation-status]')).toHaveText(
    'Enter a whole-number duration greater than 0. (AUTHORING_DURATION_INVALID) Revision 6 unchanged.');
  expect(await page.locator('[data-applied-duration]').textContent()).toBe(appliedDurationBaseline);
  expect(commandRequestCount).toBe(invalidRequestBaseline);
  const invalidAfter = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect({
    revision: invalidAfter.revision,
    contentDigest: invalidAfter.contentDigest,
    exportDigest: invalidAfter.exportDigest,
    compiledHtml: invalidAfter.compiledHtml,
    undoCount: invalidAfter.undoCount,
    redoCount: invalidAfter.redoCount,
    consumedOperationIds: invalidAfter.consumedOperationIds,
    selectedTrackId: invalidAfter.selectedTrackId,
    selectedKeyframeId: invalidAfter.selectedKeyframeId,
    selectedCreationElementId: invalidAfter.selectedCreationElementId,
  }).toEqual({
    revision: invalidBaseline.revision,
    contentDigest: invalidBaseline.contentDigest,
    exportDigest: invalidBaseline.exportDigest,
    compiledHtml: invalidBaseline.compiledHtml,
    undoCount: invalidBaseline.undoCount,
    redoCount: invalidBaseline.redoCount,
    consumedOperationIds: invalidBaseline.consumedOperationIds,
    selectedTrackId: invalidBaseline.selectedTrackId,
    selectedKeyframeId: invalidBaseline.selectedKeyframeId,
    selectedCreationElementId: invalidBaseline.selectedCreationElementId,
  });
  expect(invalidAfter.draftValues['[data-duration]']).toBe('1400.5');
  for (let index = 0; index < 6; index += 1) {
    if (index === 5) await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('[data-operation-status]')).toContainText(`Revision ${7 + index}.`);
    await expect(page.getByRole('button', { name: 'Undo' })).toBeFocused();
    const anchor = await page.getByRole('button', { name: 'Undo' }).evaluate((button) => ({
      topBefore: Number(button.dataset.historyViewportTopBefore),
      topAfter: Number(button.dataset.historyViewportTopAfter),
      scrollBefore: Number(button.dataset.historyScrollBefore),
      scrollAfter: Number(button.dataset.historyScrollAfter),
      maxScrollAfter: Number(button.dataset.historyMaxScrollAfter),
    }));
    const anchoredOrMaxClamped = Math.abs(anchor.topAfter - anchor.topBefore) < .1
      || (anchor.scrollAfter === anchor.maxScrollAfter && anchor.topAfter > anchor.topBefore);
    expect(anchoredOrMaxClamped, `Undo ${index + 1} must preserve its viewport anchor or prove max clamp`).toBe(true);
    if (index === 5) {
      expect(anchor.topAfter).toBeCloseTo(anchor.topBefore, 1);
    }
    await expect(page.locator('.timing-control em:visible')).toHaveCount(0);
    await expect(page.locator('[data-duration]')).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('[data-delay]')).toHaveAttribute('aria-invalid', 'false');
    const current = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    expect(current.revision).toBe(7 + index);
    expect(current.contentDigest).toBe(states[5 - index]!.contentDigest);
    expect(current.exportDigest).toBe(states[5 - index]!.exportDigest);
    if (index >= 4) {
      expect(current.selectedTrackId).toBeNull();
      expect(current.selectedKeyframeId).toBeNull();
      expect(await page.locator('[data-track-id][data-selected="true"]').count()).toBe(0);
      expect(current.selectedCreationElementId).toBe('el_2dbee68b1ea318c8');
      await expect(page.getByText('No keyframe selected', { exact: true })).toBeVisible();
      await expect(page.locator('input[data-value]')).toBeDisabled();
      await expect(page.locator('input[data-time]')).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Set value' })).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Set time' })).toBeDisabled();
    }
    if (index === 5) {
      const beforeAttempt = current;
      await page.getByRole('button', { name: 'Set value' })
        .evaluate((button) => (button as HTMLButtonElement).click());
      expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toEqual(beforeAttempt);
    }
  }
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-applied-duration]')).toHaveText('Applied — create a track first');
  await expect(page.locator('.timing-control em:visible')).toHaveCount(0);
  for (let index = 0; index < 6; index += 1) {
    await page.getByRole('button', { name: 'Redo' }).click();
    await expect(page.locator('[data-operation-status]')).toContainText(`Revision ${13 + index}.`);
    await expect(page.getByRole('button', { name: 'Redo' })).toBeFocused();
    const anchor = await page.getByRole('button', { name: 'Redo' }).evaluate((button) => ({
      topBefore: Number(button.dataset.historyViewportTopBefore),
      topAfter: Number(button.dataset.historyViewportTopAfter),
      scrollBefore: Number(button.dataset.historyScrollBefore),
      scrollAfter: Number(button.dataset.historyScrollAfter),
      maxScrollAfter: Number(button.dataset.historyMaxScrollAfter),
    }));
    const anchoredOrMaxClamped = Math.abs(anchor.topAfter - anchor.topBefore) < .1
      || (anchor.scrollAfter === anchor.maxScrollAfter && anchor.topAfter > anchor.topBefore);
    expect(anchoredOrMaxClamped, `Redo ${index + 1} must preserve its viewport anchor or prove max clamp`).toBe(true);
    if (index === 0) expect(anchor.topAfter).toBeCloseTo(anchor.topBefore, 1);
    await expect(page.locator('.timing-control em:visible')).toHaveCount(0);
    await expect(page.locator('[data-duration]')).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('[data-delay]')).toHaveAttribute('aria-invalid', 'false');
    const current = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    expect(current.revision).toBe(13 + index);
    expect(current.contentDigest).toBe(states[index + 1]!.contentDigest);
    expect(current.exportDigest).toBe(states[index + 1]!.exportDigest);
    if (index <= 1) {
      await expect(page.locator('[data-track-id][data-selected="true"]'))
        .toHaveAttribute('data-element-id', 'el_2dbee68b1ea318c8');
      expect(current.selectedTrackId).toBe(states[1]!.selectedTrackId);
      await expect(page.getByText('Selected opacity keyframe', { exact: true })).toBeVisible();
      await expect(page.locator('input[data-value]')).toBeEnabled();
      await expect(page.locator('input[data-time]')).toBeEnabled();
      const expectedOffset = index === 0 ? '0' : '0.5';
      expect(current.selectedKeyframeId).toBe(await page.locator(
        `[data-element-id="el_2dbee68b1ea318c8"][data-property="opacity"] .keyframe[data-offset="${expectedOffset}"]`)
        .getAttribute('data-keyframe-id'));
    }
  }
  await expect(page.getByRole('button', { name: 'Redo' })).toHaveAttribute('aria-disabled', 'true');
  await expect(page.locator('[data-duration]')).toHaveValue('1400');
  await expect(page.locator('[data-delay]')).toHaveValue('700');
  await expect(page.locator('select[data-easing]')).toHaveValue('ease-in-out');
  await expect(page.locator('.timing-control em:visible')).toHaveCount(0);
  expect(failedRequests).toEqual([]);
});

test('selects Cursor by pointer and creates a distinct deterministic contained bundle', async ({ page }) => {
  await page.goto(editorUrl);
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.getByRole('radio', { name: /Cursor/ }).click();
  const before = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await page.getByRole('button', { name: 'Create Cursor opacity track' }).click();
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
  expect(rejected.result).toEqual({ ok: false, code: 'AUTHORING_STALE_REVISION' });
  expect(rejected.after).toEqual(rejected.before);
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
