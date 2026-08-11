import { expect, test } from '@playwright/test';

test('renders exact compiled output and controls native animations without mutation', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto('/');
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();

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
  expect(await page.locator('input:not([type="range"]), textarea, [contenteditable="true"]').count()).toBe(0);
  expect(consoleErrors).toEqual([]);
});
