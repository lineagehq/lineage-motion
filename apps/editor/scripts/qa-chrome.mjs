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
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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
  const freshWorkflow = await page.evaluate(() => ({
    noFalseKeyframeClaim: document.querySelector('[data-selection]')?.textContent.includes('No keyframe selected') === true,
    inspectionCollapsed: !document.querySelector('.inspect-panel').open,
    uniqueApplyNames: [...document.querySelectorAll('[data-set-duration], [data-set-delay], [data-set-easing]')]
      .map((button) => button.textContent.trim()),
    documentContained: document.documentElement.scrollWidth <= innerWidth,
  }));
  await page.locator('.inspect-panel').getByText('Inspect all tracks', { exact: true }).click();
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
  await page.getByRole('button', { name: 'Inspect reduced motion' }).click();
  await page.locator('.inspect-panel').getByText('Inspect all tracks', { exact: true }).click();
  await page.evaluate(() => {
    const iframe = document.querySelector('[data-preview]');
    iframe.contentWindow.__selectionSentinel = 'selection-only';
  });
  await page.getByRole('radio', { name: /Orb/ }).focus();
  await page.keyboard.press('Space');
  const selectionOnly = await page.evaluate(() => ({
    state: window.__motionEditor.inspectAuthoring(),
    sentinel: document.querySelector('[data-preview]').contentWindow.__selectionSentinel,
  }));
  const selectionEphemeral = selectionOnly.state.revision === 0
    && selectionOnly.state.undoCount === 0 && selectionOnly.state.consumedOperationIds.length === 0
    && selectionOnly.state.selectedCreationElementId === 'el_2dbee68b1ea318c8'
    && selectionOnly.sentinel === 'selection-only';
  const workflowStates = [await page.evaluate(() => window.__motionEditor.inspectAuthoring())];
  const scrollBeforeCreate = await page.evaluate(() => scrollY);
  await page.locator('[data-create-track]').click();
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 1);
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  const createContinuity = await page.evaluate((scrollBefore) => ({
    focus: document.activeElement?.hasAttribute('data-add-midpoint') === true,
    noScroll: scrollY === scrollBefore,
    duration: document.querySelector('[data-duration]').value,
    delay: document.querySelector('[data-delay]').value,
    easing: document.querySelector('[data-easing]').value,
  }), scrollBeforeCreate);
  await page.locator('[data-add-midpoint]').click();
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 2);
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  const shapeFocusEvidence = await page.evaluate((scrollBefore) => ({
    valueFocused: document.activeElement?.hasAttribute('data-value') === true,
    valueEnabled: !document.querySelector('[data-value]').disabled,
    timeEnabled: !document.querySelector('[data-time]').disabled,
    midpointSelected: document.querySelector('[data-selection]').textContent.includes('Selected opacity keyframe')
      && document.querySelector('[data-element-id="el_2dbee68b1ea318c8"] .keyframe[data-offset="0.5"]')
        ?.getAttribute('aria-pressed') === 'true',
    noScroll: scrollY === scrollBefore,
  }), scrollBeforeCreate);
  await page.locator('[data-duration]').fill('1400');
  const durationDraftVisible = await page.locator('.timing-control:has([data-duration]) em').isVisible();
  await page.locator('[data-set-duration]').click();
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 3);
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  const durationDraftCleared = await page.locator('.timing-control:has([data-duration]) em').isHidden();
  await page.locator('[data-delay]').fill('700');
  await page.locator('[data-set-delay]').click();
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 4);
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  await page.locator('select[data-easing]').selectOption('ease-in-out');
  await page.locator('[data-set-easing]').click();
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 5);
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  await page.getByRole('button', { name: 'Remove midpoint' }).click();
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 6);
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  const staleEvidence = await page.evaluate(async () => {
    const before = window.__motionEditor.inspectAuthoring();
    const result = await window.__motionEditor.dispatch({ schemaVersion: 'motion.operation.v1',
      operationId: 'chrome:stale-structural', documentId: before.documentId, expectedRevision: 5,
      kind: 'motion.slot-duration.set', elementId: 'el_2dbee68b1ea318c8',
      trackId: before.selectedTrackId, payload: { durationMs: 1200 } });
    return { result, before, after: window.__motionEditor.inspectAuthoring() };
  });
  const staleAtomic = staleEvidence.result.ok === false
    && staleEvidence.result.code === 'AUTHORING_STALE_REVISION'
    && isDeepStrictEqual(staleEvidence.before, staleEvidence.after);
  await page.locator('[data-duration]').fill('1400.5');
  await page.locator('[data-set-duration]').focus();
  await page.keyboard.press('Enter');
  const validationEvidence = await page.evaluate(() => ({
    state: window.__motionEditor.inspectAuthoring(),
    invalid: document.querySelector('[data-duration]').getAttribute('aria-invalid'),
    focus: document.activeElement?.getAttribute('data-set-duration') !== null,
    appliedDuration: document.querySelector('[data-applied-duration]').textContent,
    draftDuration: document.querySelector('[data-duration]').value,
  }));
  const invalidAtomic = validationEvidence.invalid === 'true' && validationEvidence.focus
    && validationEvidence.appliedDuration === 'Applied · 1400 ms'
    && validationEvidence.draftDuration === '1400.5'
    && isDeepStrictEqual(validationEvidence.state, workflowStates.at(-1));
  let exactHistory = true;
  let historyUiRehydrated = true;
  let undoSixClampProven = false;
  let redoOneReverseContinuity = false;
  let historySelectionTruth = true;
  let disabledEditAtomic = true;
  for (let index = 0; index < 6; index += 1) {
    if (index === 5) await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForFunction((revision) => window.__motionEditor.inspectAuthoring().revision === revision
      && document.activeElement?.hasAttribute('data-undo'), 7 + index);
    const current = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    const expected = workflowStates[5 - index];
    exactHistory &&= current.revision === 7 + index && current.contentDigest === expected.contentDigest
      && current.exportDigest === expected.exportDigest;
    const anchor = await page.locator('[data-undo]').evaluate((button) => ({
      topBefore: Number(button.dataset.historyViewportTopBefore),
      topAfter: Number(button.dataset.historyViewportTopAfter),
      scrollBefore: Number(button.dataset.historyScrollBefore),
      scrollAfter: Number(button.dataset.historyScrollAfter),
      maxScrollAfter: Number(button.dataset.historyMaxScrollAfter),
    }));
    historyUiRehydrated &&= await page.evaluate(() =>
      document.querySelectorAll('.timing-control em:not([hidden])').length === 0
      && document.querySelector('[data-duration]').getAttribute('aria-invalid') === 'false'
      && document.querySelector('[data-delay]').getAttribute('aria-invalid') === 'false');
    historyUiRehydrated &&= Math.abs(anchor.topAfter - anchor.topBefore) <= 0.1
      || (anchor.scrollAfter === anchor.maxScrollAfter && anchor.topAfter > anchor.topBefore);
    if (index >= 4) {
      historySelectionTruth &&= current.selectedTrackId === null
        && current.selectedKeyframeId === null
        && await page.locator('[data-track-id][data-selected="true"]').count() === 0
        && current.selectedCreationElementId === 'el_2dbee68b1ea318c8'
        && await page.getByText('No keyframe selected', { exact: true }).isVisible()
        && await page.locator('input[data-value]').isDisabled()
        && await page.locator('input[data-time]').isDisabled()
        && await page.getByRole('button', { name: 'Set value' }).isDisabled();
    }
    if (index === 5) {
      const beforeAttempt = current;
      await page.getByRole('button', { name: 'Set value' }).evaluate((button) => button.click());
      disabledEditAtomic &&= isDeepStrictEqual(beforeAttempt,
        await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
    }
    if (index === 5) {
      undoSixClampProven = Math.abs(anchor.topAfter - anchor.topBefore) <= 0.1;
    }
  }
  for (let index = 0; index < 6; index += 1) {
    await page.getByRole('button', { name: 'Redo' }).click();
    await page.waitForFunction((revision) => window.__motionEditor.inspectAuthoring().revision === revision
      && document.activeElement?.hasAttribute('data-redo'), 13 + index);
    const current = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    const expected = workflowStates[index + 1];
    exactHistory &&= current.revision === 13 + index && current.contentDigest === expected.contentDigest
      && current.exportDigest === expected.exportDigest;
    const anchor = await page.locator('[data-redo]').evaluate((button) => ({
      topBefore: Number(button.dataset.historyViewportTopBefore),
      topAfter: Number(button.dataset.historyViewportTopAfter),
      scrollBefore: Number(button.dataset.historyScrollBefore),
      scrollAfter: Number(button.dataset.historyScrollAfter),
      maxScrollAfter: Number(button.dataset.historyMaxScrollAfter),
    }));
    historyUiRehydrated &&= await page.evaluate(() =>
      document.querySelectorAll('.timing-control em:not([hidden])').length === 0
      && document.querySelector('[data-duration]').getAttribute('aria-invalid') === 'false'
      && document.querySelector('[data-delay]').getAttribute('aria-invalid') === 'false');
    historyUiRehydrated &&= Math.abs(anchor.topAfter - anchor.topBefore) <= 0.1
      || (anchor.scrollAfter === anchor.maxScrollAfter && anchor.topAfter > anchor.topBefore);
    if (index <= 1) {
      const selectedOffset = await page.locator(
        `[data-element-id="el_2dbee68b1ea318c8"][data-property="opacity"] .keyframe[data-offset="${index === 0 ? '0' : '0.5'}"]`)
        .getAttribute('data-keyframe-id');
      historySelectionTruth &&= current.selectedTrackId === workflowStates[1].selectedTrackId
        && current.selectedKeyframeId === selectedOffset
        && await page.locator('[data-track-id][data-selected="true"]')
          .getAttribute('data-element-id') === 'el_2dbee68b1ea318c8'
        && await page.getByText('Selected opacity keyframe', { exact: true }).isVisible()
        && await page.locator('input[data-value]').isEnabled()
        && await page.locator('input[data-time]').isEnabled();
    }
    if (index === 0) {
      redoOneReverseContinuity = Math.abs(anchor.topAfter - anchor.topBefore) <= 0.1;
    }
  }
  const historyRehydrated = await page.evaluate(() => ({
    duration: document.querySelector('[data-duration]').value,
    delay: document.querySelector('[data-delay]').value,
    easing: document.querySelector('[data-easing]').value,
    appliedDuration: document.querySelector('[data-applied-duration]').textContent,
  }));
  const structuralNative = await page.evaluate(() => {
    const iframe = document.querySelector('[data-preview]');
    return iframe.srcdoc === window.__motionEditor.compiledHtml
      && iframe.contentDocument.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation');
  });
  const cursorPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await cursorPage.goto(url);
  await cursorPage.locator('[data-editor-ready="true"]').waitFor();
  await cursorPage.getByRole('radio', { name: /Cursor/ }).click();
  await cursorPage.getByRole('button', { name: 'Create Cursor opacity track' }).click();
  const cursorAlternate = await cursorPage.evaluate(() => {
    const iframe = document.querySelector('[data-preview]');
    return { state: window.__motionEditor.inspectAuthoring(),
      exact: iframe.srcdoc === window.__motionEditor.compiledHtml,
      native: iframe.contentDocument.getAnimations().every((animation) =>
        animation.constructor.name === 'CSSAnimation') };
  });
  await cursorPage.close();
  const orbTrackId = workflowStates[1].selectedTrackId;
  const cursorDistinct = cursorAlternate.state.revision === 1
    && cursorAlternate.state.selectedCreationElementId === 'el_a2849ff826f3e167'
    && cursorAlternate.state.selectedTrackId !== orbTrackId
    && cursorAlternate.exact && cursorAlternate.native;

  const responsive = {};
  for (const width of [1440, 1099, 768, 390]) {
    const responsivePage = await browser.newPage({ viewport: { width, height: 1000 } });
    await responsivePage.goto(url);
    await responsivePage.locator('[data-editor-ready="true"]').waitFor();
    responsive[width] = await responsivePage.evaluate(() => {
      const workflow = document.querySelector('.workflow').getBoundingClientRect();
      const preview = document.querySelector('.preview-panel').getBoundingClientRect();
      return { contained: document.documentElement.scrollWidth <= innerWidth,
        twoColumn: Math.abs(workflow.top - preview.top) < 2 && preview.left > workflow.left,
        oneColumn: preview.top > workflow.top };
    });
    if (width <= 768) {
      await responsivePage.locator('.inspect-panel').getByText('Inspect all tracks', { exact: true }).click();
      responsive[width].localTrackOverflow = await responsivePage.locator('.timeline-panel')
        .evaluate((node) => node.scrollWidth > node.clientWidth && document.documentElement.scrollWidth <= innerWidth);
      await responsivePage.locator('.inspect-panel').getByText('Inspect all tracks', { exact: true }).click();
    }
    const responsiveInitial = await responsivePage.evaluate(() => window.__motionEditor.inspectAuthoring());
    await responsivePage.getByRole('radio', { name: /Orb/ }).click();
    await responsivePage.locator('[data-create-track]').click();
    await responsivePage.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 1);
    const responsiveCreated = await responsivePage.evaluate(() => window.__motionEditor.inspectAuthoring());
    await responsivePage.locator('[data-undo]').evaluate((button) => button.scrollIntoView({ block: 'center' }));
    await responsivePage.locator('[data-undo]').click();
    await responsivePage.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 2
      && document.activeElement?.hasAttribute('data-undo'));
    const responsiveUndo = await responsivePage.locator('[data-undo]').evaluate((button) => ({
      state: window.__motionEditor.inspectAuthoring(),
      topBefore: Number(button.dataset.historyViewportTopBefore),
      topAfter: Number(button.dataset.historyViewportTopAfter),
      scrollAfter: Number(button.dataset.historyScrollAfter),
      maxScrollAfter: Number(button.dataset.historyMaxScrollAfter),
    }));
    await responsivePage.locator('[data-redo]').click();
    await responsivePage.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 3
      && document.activeElement?.hasAttribute('data-redo'));
    const responsiveRedo = await responsivePage.locator('[data-redo]').evaluate((button) => ({
      state: window.__motionEditor.inspectAuthoring(),
      topBefore: Number(button.dataset.historyViewportTopBefore),
      topAfter: Number(button.dataset.historyViewportTopAfter),
      scrollAfter: Number(button.dataset.historyScrollAfter),
      maxScrollAfter: Number(button.dataset.historyMaxScrollAfter),
      contained: document.documentElement.scrollWidth <= innerWidth,
    }));
    const anchoredOrClamped = (evidence) => Math.abs(evidence.topAfter - evidence.topBefore) <= 0.1
      || (evidence.scrollAfter === evidence.maxScrollAfter && evidence.topAfter > evidence.topBefore);
    responsive[width].historyAnchor = anchoredOrClamped(responsiveUndo)
      && anchoredOrClamped(responsiveRedo) && responsiveRedo.contained
      && responsiveUndo.state.contentDigest === responsiveInitial.contentDigest
      && responsiveRedo.state.contentDigest === responsiveCreated.contentDigest;
    await responsivePage.close();
  }
  const responsiveContract = responsive[1440].twoColumn && responsive[1440].contained
    && [1099, 768, 390].every((width) => responsive[width].oneColumn && responsive[width].contained)
    && responsive[768].localTrackOverflow && responsive[390].localTrackOverflow;
  const responsiveHistoryAnchors = [1440, 1099, 768, 390]
    .every((width) => responsive[width].historyAnchor);

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
    freshStateTruthful: freshWorkflow.noFalseKeyframeClaim && freshWorkflow.inspectionCollapsed,
    uniqueApplyNames: isDeepStrictEqual(freshWorkflow.uniqueApplyNames,
      ['Apply duration', 'Apply delay', 'Apply easing']),
    initialDocumentContained: freshWorkflow.documentContained,
    selectionEphemeral,
    structuralWorkflow: workflowStates.length === 7 && workflowStates.at(-1).revision === 6,
    createContinuity: createContinuity.focus && createContinuity.noScroll
      && createContinuity.duration === '1000' && createContinuity.delay === '610'
      && createContinuity.easing === 'linear',
    shapeFocusIntentional: Object.values(shapeFocusEvidence).every(Boolean),
    draftTruthConditional: durationDraftVisible && durationDraftCleared,
    staleAtomic,
    invalidAtomic,
    exactSixStepHistory: exactHistory,
    historyUiRehydrated,
    historySelectionTruth,
    disabledEditAtomic,
    undoSixClampProven,
    redoOneReverseContinuity,
    historyRehydrated: historyRehydrated.duration === '1400' && historyRehydrated.delay === '700'
      && historyRehydrated.easing === 'ease-in-out'
      && historyRehydrated.appliedDuration === 'Applied · 1400 ms',
    responsiveContract,
    responsiveHistoryAnchors,
    structuralNative,
    cursorDistinct,
    noConsoleErrors: consoleErrors.length === 0,
  };
  const receipt = {
    schemaVersion: 'motion.target-selection-chrome-qa.v1',
    passed: Object.values(checks).every(Boolean),
    browser: { name: 'Google Chrome', version: browser.version() },
    viewport: { width: 1280, height: 720 },
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
    responsive,
    checks,
  };
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  await Promise.all([
    writeFile(resolve(root, 'artifacts/t005-ux-simplification-chrome-qa.json'), receiptText, 'utf8'),
    writeFile(resolve(root, 'artifacts/t002-target-selection-chrome-qa.json'), receiptText, 'utf8'),
    writeFile(resolve(root, 'artifacts/t004-chrome-qa.json'), receiptText, 'utf8'),
  ]);
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
