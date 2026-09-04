import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { currentGeometryRequestId, ensureAdvancedOpen, monitorPage, observeActionCommit, observeGeometryCommit, observeServerAddress } from './qa-helpers.mjs';

export async function prepareLandingWorkspace({ processHandle, authority, workspaceSmokeOnly, repositoryRoot, canonicalEasing, targetElementIds }) {
    const addresses = await observeServerAddress(processHandle, 'LANDING_SHOT1_SERVER');
    const shotBrowser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await shotBrowser.newPage({ viewport: { width: 1440, height: 900 } });
    const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], unexpectedNetwork: [], httpErrors: [] };
    monitorPage(page, [addresses.editorUrl, addresses.serviceUrl], diagnostics); await page.goto(addresses.editorUrl); await page.locator('[data-editor-ready="true"]').waitFor();
    await observeGeometryCommit(page, { sampleCount: authority === 'public' ? 3 : null });
    const workspaceState = await page.evaluate(() => { const workspace = document.querySelector('[data-shot-workspace]');
      const objects = [...document.querySelectorAll('[data-shot-targets] input[name="shot-primary"]')];
      const editCheckboxes = [...document.querySelectorAll('[data-shot-targets] input[type="checkbox"]')];
      const moments = [...document.querySelectorAll('input[name="shot-moment"]')];
      const pose = document.querySelector('[data-pose-form] input[name="x"]');
      const inspected = window.__motionEditor.inspectShotWorkspace();
      return { visible: workspace instanceof HTMLElement && !workspace.hidden, objectCount: objects.length, editCheckboxCount: editCheckboxes.length,
        selectedCount: objects.filter((input) => input.checked).length, targetElementIds: objects.map((input) => input.value),
        moments: moments.map((input) => Number(input.value)), landedSelected: moments.some((input) => input.value === '700' && input.checked),
        momentSelected: moments.some((input) => input.checked),
        poseEditable: pose instanceof HTMLInputElement && !pose.disabled, open: inspected.open, momentMs: inspected.momentMs,
        previewMatchesCompiler: inspected.previewMatchesCompiler }; });
    if (authority === 'public') targetElementIds = [...workspaceState.targetElementIds].sort();
    if (targetElementIds.length !== 2) throw new Error('LANDING_SHOT1_TARGET_COUNT');
    const workspaceChecks = { visible: workspaceState.visible, objectCount: workspaceState.objectCount === 2, noPerObjectEditCheckboxes: workspaceState.editCheckboxCount === 0,
      selectedCount: workspaceState.selectedCount === 1,
      targetBinding: JSON.stringify(workspaceState.targetElementIds) === JSON.stringify(targetElementIds),
      moments: authority === 'public' ? JSON.stringify(workspaceState.moments) === JSON.stringify([0, 700, 2100])
        : workspaceState.moments.length >= 2 && workspaceState.moments.every((timeMs, index, moments) => Number.isSafeInteger(timeMs)
          && (index === 0 || timeMs > moments[index - 1])),
      landedSelected: authority === 'public' ? workspaceState.landedSelected : workspaceState.momentSelected,
      poseEditable: workspaceState.poseEditable, open: workspaceState.open,
      moment: authority === 'public' ? workspaceState.momentMs === 700 : workspaceState.moments.includes(workspaceState.momentMs),
      previewMatchesCompiler: workspaceState.previewMatchesCompiler };
    if (!Object.values(workspaceChecks).every(Boolean)) throw new Error(`LANDING_SHOT1_WORKSPACE_NOT_INITIALIZED_${Object.entries(workspaceChecks).filter(([, passed]) => !passed).map(([name]) => name).join('_')}`);
    const baselinePrimaryControls = page.locator('[data-shot-targets] input[name="shot-primary"]');
    const baselinePrimaryIndex = await baselinePrimaryControls.evaluateAll((controls) =>
      controls.findIndex((control) => control.checked));
    const primaryMomentInventories = [];
    for (let index = 0; index < await baselinePrimaryControls.count(); index += 1) {
      if (index !== baselinePrimaryIndex) {
        const priorRequestId = await currentGeometryRequestId(page);
        await baselinePrimaryControls.nth(index).check();
        await observeGeometryCommit(page, { sampleCount: null, previousRequestId: priorRequestId });
      }
      primaryMomentInventories.push(await page.locator('input[name="shot-moment"]').evaluateAll((controls) =>
        controls.map((control) => Number(control.value))));
    }
    if (baselinePrimaryIndex !== primaryMomentInventories.length - 1) {
      const priorRequestId = await currentGeometryRequestId(page);
      await baselinePrimaryControls.nth(baselinePrimaryIndex).check();
      await observeGeometryCommit(page, { sampleCount: null, previousRequestId: priorRequestId });
    }
    const sharedMomentLabels = primaryMomentInventories[0]?.filter((timeMs) =>
      primaryMomentInventories.every((moments) => moments.includes(timeMs))) ?? [];
    const baselineTiming = await page.evaluate(({ sharedMoments, effectiveEasings }) => {
      const moments = [...document.querySelectorAll('input[name="shot-moment"]')].map((input) => Number(input.value));
      const landing = Number(document.querySelector('[data-shot-context-time]').value);
      const settled = sharedMoments.length > 3 ? sharedMoments.at(-2) : sharedMoments.at(-1);
      const easingControl = document.querySelector('[data-shot-easing]');
      return { moments, sharedMoments, landing, settled, endpoint: sharedMoments.at(-1), easing: easingControl.value,
        supportedOptions: [...easingControl.options].map((option) => option.value),
        effectiveEasings, effectiveCount: effectiveEasings.length };
    }, { sharedMoments: sharedMomentLabels, effectiveEasings: canonicalEasing.effectiveEasings });
    const sortedBaselineMoments = [...new Set(baselineTiming.moments)].sort((left, right) => left - right);
    if (JSON.stringify(sortedBaselineMoments) !== JSON.stringify(baselineTiming.moments)
      || baselineTiming.landing !== 700 || baselineTiming.endpoint !== 2100) {
      throw new Error('LANDING_SHOT1_CANONICAL_TIMING_BOUNDARY_MISMATCH');
    }
    const sortedSharedMoments = [...new Set(baselineTiming.sharedMoments)].sort((left, right) => left - right);
    if (JSON.stringify(sortedSharedMoments) !== JSON.stringify(baselineTiming.sharedMoments)
      || ![0, 700, 2100].every((timeMs) => sortedSharedMoments.includes(timeMs))) {
      throw new Error('LANDING_SHOT1_CANONICAL_SHARED_MOMENTS_INVALID');
    }
    const penultimate = sortedSharedMoments.at(-2);
    const expectedBaselineSettled = sortedSharedMoments.length > 3
      && penultimate > baselineTiming.landing && penultimate < baselineTiming.endpoint
      ? penultimate : 2100;
    if (baselineTiming.settled !== expectedBaselineSettled) {
      throw new Error('LANDING_SHOT1_CANONICAL_SETTLED_LABEL_MISMATCH');
    }
    const supportedEasingKeywords = ['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'];
    const effectiveEasing = baselineTiming.effectiveEasings[0];
    if (baselineTiming.effectiveCount !== targetElementIds.length || !effectiveEasing
      || baselineTiming.effectiveEasings.some((timing) => JSON.stringify(timing) !== JSON.stringify(effectiveEasing))) {
      throw new Error('LANDING_SHOT1_CANONICAL_EASING_NON_UNIFORM');
    }
    const effectiveEasingControlValue = effectiveEasing.kind === 'keyword'
      ? effectiveEasing.value : 'custom';
    if ((effectiveEasing.kind === 'keyword' && !supportedEasingKeywords.includes(effectiveEasing.value))
      || !baselineTiming.supportedOptions.includes(effectiveEasingControlValue)) {
      throw new Error('LANDING_SHOT1_CANONICAL_EASING_UNSUPPORTED');
    }
    if (baselineTiming.easing !== effectiveEasingControlValue) {
      throw new Error('LANDING_SHOT1_CANONICAL_EASING_LABEL_MISMATCH');
    }
    if (workspaceSmokeOnly) {
      const nativePreview = await page.evaluate(() => { const frame = document.querySelector('[data-preview]'); const animations = frame.contentDocument.getAnimations();
        return frame.srcdoc === window.__motionEditor.compiledHtml && animations.length > 0 && animations.every((animation) => animation.constructor.name === 'CSSAnimation'
          && animation.effect?.constructor.name === 'KeyframeEffect' && animation.timeline?.constructor.name === 'DocumentTimeline'); });
      await observeGeometryCommit(page, { sampleCount: null });
      const original = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
      const projectionSafe = await page.evaluate(() => { const projection = window.__motionEditor.inspectShotWorkspace().projection;
        if (!projection) return false; const widthMicrounits = projection.sourceWidthCssPixels * 1_000_000;
        const heightMicrounits = projection.sourceHeightCssPixels * 1_000_000;
        return Number.isSafeInteger(projection.sourceWidthCssPixels) && projection.sourceWidthCssPixels > 0
          && Number.isSafeInteger(projection.sourceHeightCssPixels) && projection.sourceHeightCssPixels > 0
          && Number.isSafeInteger(widthMicrounits) && Number.isSafeInteger(heightMicrounits)
          && Math.abs(projection.scaleX - projection.scaleY) * projection.sourceWidthCssPixels * projection.devicePixelRatio <= 1; });
      await ensureAdvancedOpen(page, '[data-pose-form]');
      const x = page.locator('[data-pose-form] input[name="x"]'); await x.fill(String(Number(await x.inputValue()) + 1));
      const poseGeometryRequestId = await currentGeometryRequestId(page);
      await page.getByRole('button', { name: 'Apply pose' }).click();
      await observeActionCommit(page, { revision: 1 });
      await observeGeometryCommit(page, { sampleCount: null, previousRequestId: poseGeometryRequestId });
      const undoGeometryRequestId = await currentGeometryRequestId(page);
      await page.locator('[data-undo]').click(); await observeActionCommit(page, { revision: 2 });
      await observeGeometryCommit(page, { sampleCount: null, previousRequestId: undoGeometryRequestId });
      const restored = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
      const reversibleEdit = restored.contentDigest === original.contentDigest && restored.exportDigest === original.exportDigest;
      if (await page.getByRole('button', { name: 'Path' }).getAttribute('aria-pressed') !== 'true') {
        await page.getByRole('button', { name: 'Path' }).click();
      }
      await observeGeometryCommit(page, { sampleCount: null });
      const aggregateGeometry = await page.evaluate(() => {
        const inspected = window.__motionEditor.inspectShotWorkspace();
        const handle = document.querySelector('[data-trajectory-overlay] [aria-pressed="true"]');
        const rect = handle?.getBoundingClientRect();
        return {
          sampleCount: inspected.geometry.length,
          moments: [...document.querySelectorAll('input[name="shot-moment"]')].map((input) => Number(input.value)),
          maximumDeltaDevicePixels: Math.max(0, ...inspected.geometry.flatMap((sample) => Object.values(sample.deltasDevicePixels))),
          selectedHandleVisible: handle instanceof HTMLElement && rect !== undefined && rect.width > 0 && rect.height > 0,
        };
      });
      if (!nativePreview || !projectionSafe || !reversibleEdit || diagnostics.consoleErrors.length || diagnostics.pageErrors.length || diagnostics.failedRequests.length
        || diagnostics.unexpectedNetwork.length || diagnostics.httpErrors.length) throw new Error('LANDING_SHOT1_PRIVATE_WORKSPACE_SMOKE_FAILED');
      process.stdout.write(`${JSON.stringify({ schemaVersion: 'motion.shot1-private-workspace-smoke.v1', passed: true,
        uniformProjection: true, reversibleEdit: true, trackedPrivateDetails: false, aggregateGeometry })}\n`);
      return { complete: true, shotBrowser, targetElementIds };
    }
    const initialMoments = baselineTiming.moments;
    const retimedMoments = [...new Set(initialMoments.map((timeMs) => timeMs === 700 ? 840 : timeMs))].sort((left, right) => left - right);
    const heldMoments = [...new Set([...retimedMoments, 1820])].sort((left, right) => left - right);
    const groupedInitialMoments = sortedSharedMoments;
    const groupedRetimedMoments = [...new Set(groupedInitialMoments.map((timeMs) => timeMs === 700 ? 840 : timeMs))]
      .sort((left, right) => left - right);
    const groupedHeldMoments = [...new Set([...groupedRetimedMoments, 1820])].sort((left, right) => left - right);
    if (![0, 700, 2100].every((timeMs) => initialMoments.includes(timeMs))) {
      throw new Error('LANDING_SHOT1_REQUIRED_MOMENTS_MISSING');
    }
    if (![0, 700, 2100].every((timeMs) => groupedInitialMoments.includes(timeMs))) {
      throw new Error('LANDING_SHOT1_GROUPED_REQUIRED_MOMENTS_MISSING');
    }
    const pathAlignmentCommandCount = { value: 0 }; page.on('request', (request) => { if (request.url().endsWith('/api/v1/commands')) pathAlignmentCommandCount.value += 1; });
    const beforePathAlignment = await page.evaluate(() => ({ revision: window.__motionEditor.inspectAuthoring().revision,
      momentMs: window.__motionEditor.inspectShotWorkspace().momentMs, native: window.__motionEditor.readState(),
      slider: Number(document.querySelector('[data-scrub]').value), visibleTime: document.querySelector('[data-playhead]').value }));
    if (await page.getByRole('button', { name: 'Path' }).getAttribute('aria-pressed') !== 'true') await page.getByRole('button', { name: 'Path' }).click();
    await observeGeometryCommit(page, { sampleCount: initialMoments.length, moments: initialMoments });
    const readMomentAlignment = () => page.evaluate(() => ({ revision: window.__motionEditor.inspectAuthoring().revision,
      momentMs: window.__motionEditor.inspectShotWorkspace().momentMs, native: window.__motionEditor.readState(),
      slider: Number(document.querySelector('[data-scrub]').value), visibleTime: document.querySelector('[data-playhead]').value }));
    let momentAlignment = await readMomentAlignment();
    const exactlyAligned = (state, timeMs, revision = beforePathAlignment.revision) => state.revision === revision && state.momentMs === timeMs
      && state.native.playheadMs === timeMs && state.native.currentTimes.length > 0 && state.native.currentTimes.every((time) => time === timeMs)
      && state.native.playStates.every((playState) => playState === 'paused') && state.slider === timeMs && state.visibleTime === `${timeMs} ms`;
    if (!exactlyAligned(momentAlignment, beforePathAlignment.momentMs) || pathAlignmentCommandCount.value !== 0) throw new Error('LANDING_SHOT1_PATH_ALIGNMENT_INVALID');
    if (authority === 'public') {
      await page.evaluate(() => { const handles = [...document.querySelectorAll('[data-trajectory-overlay] [data-keyframe-id]')];
        window.__shotAlignmentNodes = new Map(handles.map((handle) => [handle.dataset.keyframeId, handle])); });
      for (const timeMs of [0, 700, 2100, 700]) { await page.locator(`input[name="shot-moment"][value="${timeMs}"]`).check();
        momentAlignment = await readMomentAlignment(); if (!exactlyAligned(momentAlignment, timeMs)) throw new Error('LANDING_SHOT1_RADIO_ALIGNMENT_INVALID'); }
      await page.locator('[data-trajectory-overlay] [data-keyframe-id][data-time-ms="0"]').click();
      if (!exactlyAligned(await readMomentAlignment(), 0)) throw new Error('LANDING_SHOT1_WAYPOINT_ALIGNMENT_INVALID');
      await page.locator('input[name="shot-moment"][value="700"]').check(); momentAlignment = await readMomentAlignment();
      const retained = await page.evaluate(() => [...document.querySelectorAll('[data-trajectory-overlay] [data-keyframe-id]')]
        .every((handle) => window.__shotAlignmentNodes.get(handle.dataset.keyframeId) === handle && handle.isConnected));
      if (!exactlyAligned(momentAlignment, 700) || !retained || pathAlignmentCommandCount.value !== 0) throw new Error('LANDING_SHOT1_WAYPOINT_IDENTITY_ALIGNMENT_INVALID');
    }
    const focusedSurface = await page.evaluate(() => { const visible = (selector) => { const node = document.querySelector(selector);
      if (!(node instanceof HTMLElement)) return false; const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0
        && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth; };
      return { controls: visible('[data-shot-object-bar]') && visible('[data-shot-context-dock]'), history: visible('[data-undo]'), frame: visible('[data-preview]'),
        transport: visible('.transport'), handle: visible('[data-trajectory-overlay] [aria-pressed="true"]'),
        genericWorkflowAbsent: getComputedStyle(document.querySelector('.workflow')).display === 'none',
        branchControlsAbsent: !visible('.branch-controls') }; });
    if (!Object.values(focusedSurface).every(Boolean)) throw new Error(`LANDING_SHOT1_FOCUSED_SURFACE_INVALID_${JSON.stringify(focusedSurface)}`);
    const readSpatialProof = async (targetIndex, expectedSampleCount) => {
      await page.waitForFunction((count) => document.querySelector('[data-trajectory-overlay]').getAttribute('aria-busy') === 'false'
        && window.__motionEditor.inspectShotWorkspace().geometry.length === count, expectedSampleCount);
      return page.evaluate((index) => { const inspected = window.__motionEditor.inspectShotWorkspace(); const frame = document.querySelector('[data-preview]');
        const overlay = document.querySelector('[data-trajectory-overlay]'); const frameRect = frame.getBoundingClientRect(); const overlayRect = overlay.getBoundingClientRect();
        const animations = frame.contentDocument.getAnimations(); return { targetIndex: index,
          projection: { schemaVersion: inspected.projection.schemaVersion, sourceWidthCssPixels: inspected.projection.sourceWidthCssPixels,
            sourceHeightCssPixels: inspected.projection.sourceHeightCssPixels, scaleX: inspected.projection.scaleX, scaleY: inspected.projection.scaleY,
            devicePixelRatio: inspected.projection.devicePixelRatio },
          rootEdgeDeltasDevicePixels: { left: Math.abs(frameRect.left - overlayRect.left) * devicePixelRatio,
            top: Math.abs(frameRect.top - overlayRect.top) * devicePixelRatio, right: Math.abs(frameRect.right - overlayRect.right) * devicePixelRatio,
            bottom: Math.abs(frameRect.bottom - overlayRect.bottom) * devicePixelRatio },
          samples: inspected.geometry.map((sample) => ({ timeMs: sample.timeMs, deltasDevicePixels: sample.deltasDevicePixels })),
          fontsReady: frame.contentDocument.fonts.status === 'loaded', nativeTypes: animations.map((animation) => ({ animation: animation.constructor.name,
            effect: animation.effect?.constructor.name, timeline: animation.timeline?.constructor.name, currentTime: animation.currentTime,
            playState: animation.playState })) }; }, targetIndex);
    };
    const spatialTargets = authority === 'public' ? [await readSpatialProof(0, 3)] : [];
    const primaryInputs = page.locator('[data-shot-targets] input[name="shot-primary"]');
    if (authority === 'public') { let priorRequestId = await currentGeometryRequestId(page); await primaryInputs.nth(1).check();
      await observeGeometryCommit(page, { sampleCount: 3, previousRequestId: priorRequestId, moments: [0, 700, 2100] });
      spatialTargets.push(await readSpatialProof(1, 3)); priorRequestId = await currentGeometryRequestId(page); await primaryInputs.nth(0).check();
      await observeGeometryCommit(page, { sampleCount: 3, previousRequestId: priorRequestId, moments: [0, 700, 2100] }); }
    const spatialParity = authority !== 'public' || (spatialTargets.length === 2 && spatialTargets.every((target) => target.projection.schemaVersion === 'motion.preview-overlay-projection.v1'
      && target.projection.sourceWidthCssPixels === 800 && target.projection.sourceHeightCssPixels === 450
      && Math.abs(target.projection.scaleX - target.projection.scaleY) * 800 * target.projection.devicePixelRatio <= 1
      && Object.values(target.rootEdgeDeltasDevicePixels).every((delta) => delta <= 1)
      && JSON.stringify(target.samples.map((sample) => sample.timeMs)) === JSON.stringify([0, 700, 2100])
      && target.samples.every((sample) => Object.values(sample.deltasDevicePixels).every((delta) => delta <= 1))
      && target.fontsReady && target.nativeTypes.length > 0 && target.nativeTypes.every((native) => native.animation === 'CSSAnimation'
        && native.effect === 'KeyframeEffect' && native.timeline === 'DocumentTimeline'
        && native.currentTime === momentAlignment.momentMs && native.playState === 'paused')));
    if (!spatialParity) throw new Error('LANDING_SHOT1_SPATIAL_PARITY');
    return { complete: false, shotBrowser, page, targetElementIds, addresses, diagnostics, workspaceState, workspaceChecks, baselinePrimaryControls, baselinePrimaryIndex, primaryMomentInventories, sharedMomentLabels, baselineTiming, sortedBaselineMoments, sortedSharedMoments, penultimate, expectedBaselineSettled, supportedEasingKeywords, effectiveEasing, effectiveEasingControlValue, initialMoments, retimedMoments, heldMoments, groupedInitialMoments, groupedRetimedMoments, groupedHeldMoments, pathAlignmentCommandCount, beforePathAlignment, readMomentAlignment, momentAlignment, exactlyAligned, focusedSurface, readSpatialProof, spatialTargets, primaryInputs, spatialParity };
}
