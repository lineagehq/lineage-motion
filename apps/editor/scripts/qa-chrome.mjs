import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '../../..');
const port = 41739;
const url = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, [
  resolve(root, 'node_modules/vite/bin/vite.js'),
  '--config', resolve(root, 'apps/editor/vite.config.ts'),
  '--host', '127.0.0.1',
  '--port', String(port),
], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });

let browser;
try {
  await waitForServer(url);
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.goto(url);
  await page.locator('[data-editor-ready="true"]').waitFor();

  const initial = await page.evaluate(() => {
    const iframe = document.querySelector('[data-preview]');
    const animations = iframe.contentDocument.getAnimations();
    return {
      sandbox: iframe.getAttribute('sandbox'),
      exactCompilerOutput: iframe.srcdoc === window.__motionEditor.compiledHtml,
      nativeAnimationCount: animations.filter((animation) =>
        animation.constructor.name === 'CSSAnimation').length,
      animationCount: animations.length,
      trackIds: window.__motionEditor.trackIds,
      cueIds: window.__motionEditor.cueIds,
      canonicalProjection: window.__motionEditor.canonicalProjection,
    };
  });
  const renderedTrackIds = await page.locator('[data-track-id]').evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-track-id')));
  const timelineRows = await page.locator('[data-track-id]').evaluateAll((nodes) => nodes.map((node) => ({
    elementId: node.getAttribute('data-element-id'),
    property: node.getAttribute('data-property'),
    delayMs: Number(node.getAttribute('data-delay-ms')),
    slotCount: Number(node.getAttribute('data-slot-count')),
    timingKind: node.getAttribute('data-timing-kind'),
    declaredKeyframes: Number(node.getAttribute('data-keyframe-count')),
    renderedKeyframes: node.querySelectorAll('[data-keyframe-id]').length,
  })));
  const renderedProjection = await page.evaluate(() => ({
    schemaVersion: 'motion.timeline-projection.v1',
    durationMs: Number(document.querySelector('[data-timeline]').getAttribute('data-duration-ms')),
    rows: [...document.querySelectorAll('[data-track-id]')].map((row) => ({
      trackId: row.dataset.trackId,
      elementId: row.dataset.elementId,
      property: row.dataset.property,
      ruleId: row.dataset.ruleId,
      applicationId: row.dataset.applicationId,
      activeSlotId: row.dataset.activeSlotId,
      delayMs: Number(row.dataset.delayMs),
      interpolation: row.dataset.interpolation,
      timing: JSON.parse(row.dataset.timing),
      orderedSlotIds: [...row.querySelectorAll('[data-slot-id]')]
        .map((slot) => slot.dataset.slotId),
      keyframes: [...row.querySelectorAll('[data-keyframe-id]')].map((keyframe) => ({
        id: keyframe.dataset.keyframeId,
        offset: Number(keyframe.dataset.offset),
        value: keyframe.dataset.value,
        easing: JSON.parse(keyframe.dataset.easing),
        timeMs: Number(keyframe.dataset.timeMs),
      })),
    })),
    cues: [...document.querySelectorAll('[data-cue-id]')].map((cue) => ({
      schemaVersion: cue.dataset.schemaVersion,
      id: cue.dataset.cueId,
      label: cue.dataset.label,
      timeMs: Number(cue.dataset.timeMs),
    })),
    reducedMotion: {
      mode: document.querySelector('[data-reduced-motion-panel]').dataset.mode,
      css: document.querySelector('[data-reduced-motion-panel]').dataset.css,
    },
  }));
  let everyCueScrubbed = true;
  for (const cueId of initial.cueIds) {
    await page.locator(`[data-cue-id="${cueId}"]`).click();
    const state = await page.evaluate(() => window.__motionEditor.readState());
    everyCueScrubbed &&= state.currentTimes.every((time) => time === state.playheadMs)
      && state.playStates.every((playState) => playState === 'paused');
  }
  const tolerance = {
    observationWindowMs: 180,
    pauseSettleMs: 50,
    pausedWindowMs: 160,
    minimumAdvanceMs: 50,
    maximumAdvanceMs: 1000,
    maximumPauseDriftMs: 2,
  };
  await page.locator('[data-scrub]').fill('1000');
  const beforePlay = await page.evaluate(() => window.__motionEditor.readState());
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(tolerance.observationWindowMs);
  const duringPlay = await page.evaluate(() => window.__motionEditor.readState());
  await page.getByRole('button', { name: 'Pause' }).click();
  await page.waitForFunction(() =>
    window.__motionEditor.readState().playStates.every((state) => state === 'paused'));
  await page.waitForTimeout(tolerance.pauseSettleMs);
  const afterPause = await page.evaluate(() => window.__motionEditor.readState());
  await page.waitForTimeout(tolerance.pausedWindowMs);
  const pausedInterval = await page.evaluate(() => window.__motionEditor.readState());
  const advanceMs = duringPlay.currentTimes.map((time, index) =>
    time === null || beforePlay.currentTimes[index] === null
      ? null : time - beforePlay.currentTimes[index]);
  const pauseDriftMs = pausedInterval.currentTimes.map((time, index) =>
    time === null || afterPause.currentTimes[index] === null
      ? null : Math.abs(time - afterPause.currentTimes[index]));
  const playPauseNative = advanceMs.length === initial.animationCount
    && advanceMs.every((advance) => advance !== null
      && advance >= tolerance.minimumAdvanceMs && advance <= tolerance.maximumAdvanceMs)
    && pauseDriftMs.every((drift) => drift !== null
      && drift <= tolerance.maximumPauseDriftMs)
    && duringPlay.playStates.every((state) => state === 'running')
    && afterPause.playStates.every((state) => state === 'paused')
    && pausedInterval.playStates.every((state) => state === 'paused');
  await page.getByRole('button', { name: 'Inspect reduced motion' }).click();
  const reducedMotionInspectable = await page.locator('[data-reduced-motion-panel]').isVisible();
  const workflowStates = [await page.evaluate(() => window.__motionEditor.inspectAuthoring())];
  for (const selector of ['[data-create-track]', '[data-add-midpoint]', '[data-set-duration]', '[data-set-delay]']) {
    await page.locator(selector).click();
    workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  }
  await page.locator('select[data-easing]').selectOption('ease-in-out');
  await page.locator('[data-set-easing]').click();
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  await page.getByRole('button', { name: 'Remove midpoint' }).click();
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  const staleEvidence = await page.evaluate(async () => {
    const before = window.__motionEditor.inspectAuthoring();
    const result = await window.__motionEditor.dispatch({ schemaVersion: 'motion.operation.v1',
      operationId: 'chrome:stale-structural', documentId: before.documentId, expectedRevision: 5,
      kind: 'motion.slot-duration.set', elementId: 'el_a2849ff826f3e167',
      trackId: before.selectedTrackId, payload: { durationMs: 1200 } });
    return { result, before, after: window.__motionEditor.inspectAuthoring() };
  });
  const staleAtomic = staleEvidence.result.ok === false
    && staleEvidence.result.code === 'AUTHORING_STALE_REVISION'
    && isDeepStrictEqual(staleEvidence.before, staleEvidence.after);
  let exactHistory = true;
  for (let index = 0; index < 6; index += 1) {
    await page.getByRole('button', { name: 'Undo' }).click();
    const current = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    const expected = workflowStates[5 - index];
    exactHistory &&= current.revision === 7 + index && current.contentDigest === expected.contentDigest
      && current.exportDigest === expected.exportDigest;
  }
  for (let index = 0; index < 6; index += 1) {
    await page.getByRole('button', { name: 'Redo' }).click();
    const current = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    const expected = workflowStates[index + 1];
    exactHistory &&= current.revision === 13 + index && current.contentDigest === expected.contentDigest
      && current.exportDigest === expected.exportDigest;
  }
  const structuralNative = await page.evaluate(() => {
    const iframe = document.querySelector('[data-preview]');
    return iframe.srcdoc === window.__motionEditor.compiledHtml
      && iframe.contentDocument.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation');
  });

  const checks = {
    exactCompilerOutput: initial.exactCompilerOutput,
    minimalSandbox: initial.sandbox === 'allow-same-origin',
    nativeAnimationsOnly: initial.animationCount > 0
      && initial.nativeAnimationCount === initial.animationCount,
    completeTrackRows: renderedTrackIds.length === initial.trackIds.length
      && new Set(renderedTrackIds).size === renderedTrackIds.length
      && initial.trackIds.every((id) => renderedTrackIds.includes(id)),
    completeTrackDetails: timelineRows.every((row) => row.elementId && row.property
      && Number.isFinite(row.delayMs) && row.declaredKeyframes === row.renderedKeyframes),
    canonicalProjectionEqual: isDeepStrictEqual(renderedProjection, initial.canonicalProjection),
    simultaneousSlotsShown: timelineRows.some((row) => row.slotCount > 1),
    stepTimingShown: timelineRows.some((row) => row.timingKind === 'steps'),
    everyCueScrubbed,
    playPauseNative,
    reducedMotionInspectable,
    structuralWorkflow: workflowStates.length === 7 && workflowStates.at(-1).revision === 6,
    staleAtomic,
    exactSixStepHistory: exactHistory,
    structuralNative,
    noConsoleErrors: consoleErrors.length === 0,
  };
  const receipt = {
    schemaVersion: 'motion.chrome-qa.v1',
    passed: Object.values(checks).every(Boolean),
    browser: { name: 'Google Chrome', version: browser.version() },
    viewport: { width: 1280, height: 900 },
    counts: {
      animationCount: initial.animationCount,
      cueCount: initial.cueIds.length,
      trackCount: initial.trackIds.length,
      consoleErrorCount: consoleErrors.length,
    },
    nativeTiming: {
      tolerance,
      beforePlayCurrentTimes: roundTimes(beforePlay.currentTimes),
      duringPlayCurrentTimes: roundTimes(duringPlay.currentTimes),
      afterPauseCurrentTimes: roundTimes(afterPause.currentTimes),
      pausedIntervalCurrentTimes: roundTimes(pausedInterval.currentTimes),
      advanceMs: roundTimes(advanceMs),
      pauseDriftMs: roundTimes(pauseDriftMs),
    },
    checks,
  };
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  await writeFile(
    resolve(root, 'artifacts/t004-chrome-qa.json'),
    `${JSON.stringify(receipt, null, 2)}\n`,
    'utf8',
  );
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.passed) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}

async function waitForServer(target) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (server.exitCode !== null) throw new Error('CHROME_QA_SERVER_EXITED');
    try {
      const response = await fetch(target);
      if (response.ok) return;
    } catch {
      // The local server is still starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('CHROME_QA_SERVER_TIMEOUT');
}

function roundTimes(values) {
  return values.map((value) => value === null ? null : Math.round(value * 1000) / 1000);
}
