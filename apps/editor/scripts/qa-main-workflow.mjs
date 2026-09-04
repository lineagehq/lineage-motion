import { chromium } from '@playwright/test';
import { isDeepStrictEqual } from 'node:util';
import { monitorPage, observeServerAddress } from './qa-helpers.mjs';

export async function runMainQaWorkflow({ server, root }) {
  const { editorUrl: url, serviceUrl: mainServiceUrl } = await observeServerAddress(server, 'CHROME_QA');
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const unexpectedNetwork = [];
  const httpErrors = [];
  monitorPage(page, [url, mainServiceUrl], { consoleErrors, pageErrors, failedRequests, unexpectedNetwork, httpErrors });
  let editorCommandRequestCount = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/commands')) editorCommandRequestCount += 1;
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
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 1
    && document.activeElement?.hasAttribute('data-add-midpoint'));
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  const createContinuity = await page.evaluate((scrollBefore) => ({
    focus: document.activeElement?.hasAttribute('data-add-midpoint') === true,
    noScroll: scrollY === scrollBefore,
    duration: document.querySelector('[data-duration]').value,
    delay: document.querySelector('[data-delay]').value,
    easing: document.querySelector('[data-easing]').value,
  }), scrollBeforeCreate);
  await page.locator('[data-add-midpoint]').click();
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 2
    && document.activeElement?.hasAttribute('data-value'));
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
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 3
    && document.querySelector('[data-operation-status]').textContent.includes('Revision 3')
    && document.querySelector('.timing-control:has([data-duration]) em').hidden);
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  const durationDraftCleared = await page.locator('.timing-control:has([data-duration]) em').isHidden();
  await page.locator('[data-delay]').fill('700');
  await page.locator('[data-set-delay]').click();
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 4
    && document.querySelector('[data-operation-status]').textContent.includes('Revision 4')
    && document.querySelector('.timing-control:has([data-delay]) em').hidden);
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  await page.locator('select[data-easing]').selectOption('ease-in-out');
  await page.locator('[data-set-easing]').click();
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 5
    && document.querySelector('[data-operation-status]').textContent.includes('Revision 5')
    && document.querySelector('.timing-control:has([data-easing]) em').hidden);
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  await page.getByRole('button', { name: 'Remove midpoint' }).click();
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 6
    && document.activeElement?.hasAttribute('data-add-midpoint'));
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  const staleEvidence = await page.evaluate(async () => {
    const before = window.__motionEditor.inspectAuthoring();
    const result = await window.__motionEditor.dispatch({ schemaVersion: 'motion.operation.v1',
      operationId: 'chrome:stale-structural', documentId: before.documentId, expectedRevision: 5,
      kind: 'motion.slot-duration.set', elementId: 'el_2dbee68b1ea318c8',
      trackId: before.selectedTrackId, payload: { durationMs: 1200 } });
    return { result, before, after: window.__motionEditor.inspectAuthoring() };
  });
  const expectedStaleConsoleIndex = consoleErrors.indexOf(
    'Failed to load resource: the server responded with a status of 409 (Conflict)');
  const expectedStaleConsole = expectedStaleConsoleIndex >= 0;
  if (expectedStaleConsole) consoleErrors.splice(expectedStaleConsoleIndex, 1);
  const expectedStaleHttpIndex = httpErrors.findIndex((error) => error.status === 409 && error.resourceType === 'fetch');
  const expectedStaleHttp = expectedStaleHttpIndex >= 0;
  if (expectedStaleHttp) httpErrors.splice(expectedStaleHttpIndex, 1);
  const staleAtomic = staleEvidence.result.ok === false
    && staleEvidence.result.code === 'STALE_REVISION' && expectedStaleConsole && expectedStaleHttp
    && staleEvidence.before.revision === staleEvidence.after.revision
    && staleEvidence.before.contentDigest === staleEvidence.after.contentDigest
    && staleEvidence.before.exportDigest === staleEvidence.after.exportDigest
    && staleEvidence.before.compiledHtml === staleEvidence.after.compiledHtml
    && staleEvidence.after.immutableRefetchCount === staleEvidence.before.immutableRefetchCount + 1;
  await page.locator('[data-duration]').fill('1400.5');
  const invalidBaseline = {
    state: await page.evaluate(() => window.__motionEditor.inspectAuthoring()),
    appliedDuration: await page.locator('[data-applied-duration]').textContent(),
    commandRequestCount: editorCommandRequestCount,
  };
  await page.locator('[data-set-duration]').focus();
  await page.keyboard.press('Enter');
  const validationEvidence = await page.evaluate(() => ({
    state: window.__motionEditor.inspectAuthoring(),
    invalid: document.querySelector('[data-duration]').getAttribute('aria-invalid'),
    focus: document.activeElement?.getAttribute('data-set-duration') !== null
      || document.activeElement?.getAttribute('data-duration') !== null,
    appliedDuration: document.querySelector('[data-applied-duration]').textContent,
    draftDuration: document.querySelector('[data-duration]').value,
    diagnostic: document.querySelector('[data-operation-status]').textContent,
  }));
  const atomicState = (state) => ({
    revision: state.revision,
    contentDigest: state.contentDigest,
    exportDigest: state.exportDigest,
    compiledHtml: state.compiledHtml,
    undoCount: state.undoCount,
    redoCount: state.redoCount,
    consumedOperationIds: state.consumedOperationIds,
    selectedTrackId: state.selectedTrackId,
    selectedKeyframeId: state.selectedKeyframeId,
    selectedCreationElementId: state.selectedCreationElementId,
  });
  const invalidAtomic = validationEvidence.invalid === 'true' && validationEvidence.focus
    && validationEvidence.appliedDuration === invalidBaseline.appliedDuration
    && validationEvidence.draftDuration === '1400.5'
    && validationEvidence.diagnostic === 'Enter a whole-number duration greater than 0. (AUTHORING_DURATION_INVALID) Revision 6 unchanged.'
    && editorCommandRequestCount === invalidBaseline.commandRequestCount
    && isDeepStrictEqual(atomicState(validationEvidence.state), atomicState(invalidBaseline.state));
  let exactHistory = true;
  let historyUiRehydrated = true;
  let undoSixClampProven = false;
  let redoOneReverseContinuity = false;
  let historySelectionTruth = true;
  let disabledEditAtomic = true;
  const historyObservations = [];
  const historyStartState = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  const anchorPreserved = (anchor) => Math.abs(anchor.topAfter - anchor.topBefore) <= 0.1
    || (anchor.scrollAfter === anchor.maxScrollAfter && anchor.topAfter > anchor.topBefore)
    || (anchor.scrollAfter === 0 && anchor.topAfter < anchor.topBefore);
  for (let index = 0; index < 6; index += 1) {
    if (index === 5) await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForFunction(({ revision, final }) => window.__motionEditor.inspectAuthoring().revision === revision
      && (final ? document.querySelector('[data-undo]').disabled : document.activeElement?.hasAttribute('data-undo'))
      && document.querySelector('[data-undo]').hasAttribute('data-history-viewport-top-after')
      && document.querySelector('[data-operation-status]').textContent.includes(`Revision ${revision}`),
    { revision: 7 + index, final: index === 5 }, { timeout: 5000 }).catch(async () => {
        const observed = await page.evaluate(() => ({ revision: window.__motionEditor.inspectAuthoring().revision,
          focus: document.activeElement?.getAttributeNames(), undoDisabled: document.querySelector('[data-undo]').disabled,
          redoDisabled: document.querySelector('[data-redo]').disabled,
          status: document.querySelector('[data-operation-status]').textContent }));
        throw new Error(`CHROME_HISTORY_UNDO_WAIT_${index}:${JSON.stringify({ start: {
          revision: historyStartState.revision, serviceBacked: historyStartState.serviceBacked,
          consumedOperationIds: historyStartState.consumedOperationIds }, observed })}`);
      });
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
      && document.querySelector('[data-duration]').getAttribute('aria-invalid') !== 'true'
      && document.querySelector('[data-delay]').getAttribute('aria-invalid') !== 'true');
    historyUiRehydrated &&= anchorPreserved(anchor);
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
    historyObservations.push({ direction: 'undo', index, anchor, selectedTrackId: current.selectedTrackId,
      selectedKeyframeId: current.selectedKeyframeId, selectedCreationElementId: current.selectedCreationElementId,
      selectedRowCount: await page.locator('[data-track-id][data-selected="true"]').count(),
      valueEnabled: await page.locator('input[data-value]').isEnabled(),
      timeEnabled: await page.locator('input[data-time]').isEnabled() });
  }
  for (let index = 0; index < 6; index += 1) {
    await page.getByRole('button', { name: 'Redo' }).click();
    await page.waitForFunction(({ revision, final }) => window.__motionEditor.inspectAuthoring().revision === revision
      && (final ? document.querySelector('[data-redo]').disabled : document.activeElement?.hasAttribute('data-redo'))
      && document.querySelector('[data-redo]').hasAttribute('data-history-viewport-top-after')
      && document.querySelector('[data-operation-status]').textContent.includes(`Revision ${revision}`),
    { revision: 13 + index, final: index === 5 });
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
      && document.querySelector('[data-duration]').getAttribute('aria-invalid') !== 'true'
      && document.querySelector('[data-delay]').getAttribute('aria-invalid') !== 'true');
    historyUiRehydrated &&= anchorPreserved(anchor);
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
      redoOneReverseContinuity = anchorPreserved(anchor);
    }
    historyObservations.push({ direction: 'redo', index, anchor, selectedTrackId: current.selectedTrackId,
      selectedKeyframeId: current.selectedKeyframeId, selectedCreationElementId: current.selectedCreationElementId,
      selectedRowCount: await page.locator('[data-track-id][data-selected="true"]').count(),
      valueEnabled: await page.locator('input[data-value]').isEnabled(),
      timeEnabled: await page.locator('input[data-time]').isEnabled() });
  }
  const historyRehydrated = await page.evaluate(() => ({
    duration: document.querySelector('[data-duration]').value,
    delay: document.querySelector('[data-delay]').value,
    easing: document.querySelector('[data-easing]').value,
    appliedDuration: document.querySelector('[data-applied-duration]').textContent,
  }));
  return { browser, url, mainServiceUrl, page, consoleErrors, pageErrors, failedRequests, unexpectedNetwork, httpErrors, editorCommandRequestCount, initial, renderedTrackIds, timelineRows, renderedProjection, freshWorkflow, everyCueScrubbed, tolerance, beforePlay, duringPlay, afterPause, pausedInterval, advanceMs, pauseDriftMs, playPauseNative, reducedMotionInspectable, selectionOnly, selectionEphemeral, workflowStates, scrollBeforeCreate, createContinuity, shapeFocusEvidence, durationDraftVisible, durationDraftCleared, staleEvidence, expectedStaleConsoleIndex, expectedStaleConsole, expectedStaleHttpIndex, expectedStaleHttp, staleAtomic, invalidBaseline, validationEvidence, atomicState, invalidAtomic, exactHistory, historyUiRehydrated, undoSixClampProven, redoOneReverseContinuity, historySelectionTruth, disabledEditAtomic, historyObservations, historyStartState, anchorPreserved, historyRehydrated };
}
