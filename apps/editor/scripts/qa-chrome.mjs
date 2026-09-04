import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from '@playwright/test';
import { finishMainQaEvidence } from './qa-main-evidence.mjs';
import { runMainQaWorkflow } from './qa-main-workflow.mjs';
import { prepareLandingWorkspace } from './qa-landing-workspace.mjs';
import { setupLandingShot1 } from './qa-landing-setup.mjs';
await handleQaCommand(process.argv);
import { handleQaCommand } from './qa-commands.mjs';
const root = resolve(import.meta.dirname, '../../..'); const port = 0;
const mainQaDirectory = await mkdtemp(join(tmpdir(), 'lineage-motion-chrome-main-'));
const server = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
    PHASE3_DATABASE_PATH: join(mainQaDirectory, 'project.sqlite'), PHASE3_EDITOR_PORT: String(port),
    PHASE3_HUMAN_CAPABILITY: randomBytes(32).toString('base64url'),
    PHASE3_AGENT_CAPABILITY: randomBytes(32).toString('base64url') },
});
let browser; try {
  const mainQaContext = await runMainQaWorkflow({ server, root });
  browser = mainQaContext.browser;
  await finishMainQaEvidence(mainQaContext, root);
} finally {
  await browser?.close();
  server.kill('SIGTERM');
  await rm(mainQaDirectory, { recursive: true, force: true });
}
import { runCanvasFirstUxQa } from './qa-canvas.mjs';
import { startIsolatedQaEditor, ensureAdvancedOpen, reserveEphemeralPort, roundTimes, monitorPage, runRealCli, resolveShot1CanonicalEasing, resolveShot1ProofAuthority, assertShot1ProofRouting, observeActionCommit, observeGeometryCommit, currentGeometryRequestId, materializePublicAsymmetricSeed, runAsymmetricAlternatePrimaryQa, runHitOwnershipQa } from './qa-helpers.mjs';
export async function runLandingShot1Qa({ authority, workspaceSmokeOnly }) {
  const setup = await setupLandingShot1({ authority, workspaceSmokeOnly });
  if (setup.deferred) return;
  const { repositoryRoot, privateDocumentPath, canonicalEasing, directory, processHandle } = setup;
  let { targetElementIds } = setup;
  let shotBrowser;
  try {
    const prepared = await prepareLandingWorkspace({ processHandle, authority, workspaceSmokeOnly, repositoryRoot, canonicalEasing, targetElementIds });
    shotBrowser = prepared.shotBrowser;
    targetElementIds = prepared.targetElementIds;
    if (prepared.complete) return;
    const { page, addresses, diagnostics, workspaceState, workspaceChecks, baselinePrimaryControls, baselinePrimaryIndex, primaryMomentInventories, sharedMomentLabels, baselineTiming, sortedBaselineMoments, sortedSharedMoments, penultimate, expectedBaselineSettled, supportedEasingKeywords, effectiveEasing, effectiveEasingControlValue, initialMoments, retimedMoments, heldMoments, groupedInitialMoments, groupedRetimedMoments, groupedHeldMoments, pathAlignmentCommandCount, beforePathAlignment, readMomentAlignment, momentAlignment, exactlyAligned, focusedSurface, readSpatialProof, spatialTargets, primaryInputs, spatialParity } = prepared;
    const original = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    await page.locator('[data-scrub]').fill('700');
    let handle = page.locator('[data-trajectory-overlay] [aria-pressed="true"]'); let box = await handle.boundingBox(); if (!box) throw new Error('LANDING_SHOT1_HANDLE_MISSING');
    const cancelGeometryRequestId = await currentGeometryRequestId(page);
    const draftBaseline = await page.evaluate((elementId) => { const frame = document.querySelector('[data-preview]');
      const target = [...frame.contentDocument.querySelectorAll('[data-motion-id]')].find((item) => item.dataset.motionId === elementId);
      const rect = target.getBoundingClientRect(); frame.dataset.draftLoadCount = '0'; frame.addEventListener('load', () => {
        frame.dataset.draftLoadCount = String(Number(frame.dataset.draftLoadCount) + 1); }); window.__shotDraftDocument = frame.contentDocument;
      return { bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, native: window.__motionEditor.readState() }; }, targetElementIds[0]);
    await page.evaluate(({ elementId, baselineBounds }) => {
      const frame = document.querySelector('[data-preview]'); const frameDocument = frame.contentDocument;
      const activeCss = window.__motionEditor.inspectShotWorkspace().compilerCommit.activeCompilerCss;
      const compilerStyle = [...frameDocument.querySelectorAll('style')].find((style) => style.textContent === `\n${activeCss}`);
      const handles = [...document.querySelectorAll('[data-trajectory-overlay] [data-keyframe-id]')];
      const keys = handles.map((handle) => handle.dataset.keyframeId); const nodes = new Map(keys.map((key, index) => [key, handles[index]]));
      const oracle = { frameCount: 0, releaseFrameCount: 0, documentChanges: 0, styleChanges: 0, nativeStateViolations: 0,
        oldLocationReleaseFrames: 0, handleIdentityGaps: 0, handleOrderGaps: 0, activeHandleGaps: 0, terminalFeedbackGaps: 0,
        stopAfter: null, resolve: null }; window.__shotPaintOracle = oracle;
      const tick = () => {
        const inspected = window.__motionEditor.inspectShotWorkspace(); const currentDocument = frame.contentDocument;
        const animations = currentDocument?.getAnimations() ?? []; const state = window.__motionEditor.readState();
        const currentHandles = [...document.querySelectorAll('[data-trajectory-overlay] [data-keyframe-id]')];
        const currentKeys = currentHandles.map((handle) => handle.dataset.keyframeId);
        const target = currentDocument && [...currentDocument.querySelectorAll('[data-motion-id]')].find((item) => item.dataset.motionId === elementId);
        const rect = target?.getBoundingClientRect(); const atOldLocation = rect
          ? JSON.stringify({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }) === JSON.stringify(baselineBounds) : true;
        oracle.frameCount += 1; if (currentDocument !== frameDocument) oracle.documentChanges += 1;
        if (!compilerStyle?.isConnected || compilerStyle.ownerDocument !== currentDocument) oracle.styleChanges += 1;
        if (animations.length === 0 || animations.some((animation, index) => animation.constructor.name !== 'CSSAnimation'
          || animation.effect?.constructor.name !== 'KeyframeEffect' || animation.timeline?.constructor.name !== 'DocumentTimeline'
          || animation.currentTime !== state.currentTimes[index] || animation.playState !== state.playStates[index])) oracle.nativeStateViolations += 1;
        if (JSON.stringify(currentKeys) !== JSON.stringify(keys)) oracle.handleOrderGaps += 1;
        if (currentHandles.some((handle) => nodes.get(handle.dataset.keyframeId) !== handle || !handle.isConnected)) oracle.handleIdentityGaps += 1;
        if (currentHandles.filter((handle) => handle.getAttribute('aria-pressed') === 'true').length !== 1) oracle.activeHandleGaps += 1;
        if (inspected.waypointReleasePhase !== 'idle') { oracle.releaseFrameCount += 1;
          if (atOldLocation) oracle.oldLocationReleaseFrames += 1;
          const active = currentHandles.find((handle) => handle.getAttribute('aria-pressed') === 'true');
          if (!active || (atOldLocation && active.style.translate === '')) oracle.terminalFeedbackGaps += 1; }
        if (oracle.stopAfter !== null && --oracle.stopAfter === 0) { oracle.resolve({ ...oracle, stopAfter: undefined, resolve: undefined }); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }, { elementId: targetElementIds[0], baselineBounds: draftBaseline.bounds });
    await page.locator('[data-play]').click();
    await page.waitForFunction(() => window.__motionEditor.readState().playStates.every((playState) => playState === 'running'));
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    if (!exactlyAligned(await readMomentAlignment(), momentAlignment.momentMs)
      || (await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)) !== original.revision) throw new Error('LANDING_SHOT1_DRAG_ALIGNMENT_INVALID');
    await page.evaluate(({ x, y }) => { for (let index = 1; index <= 24; index += 1) window.dispatchEvent(new PointerEvent('pointermove', {
      pointerId: 1, buttons: 1, clientX: x + index / 2, clientY: y - index / 3, bubbles: true })); },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 });
    await page.waitForFunction(() => window.__motionEditor.inspectShotWorkspace().activeDraft?.appliedCount > 0);
    const sustainedDraft = await page.evaluate((elementId) => { const frame = document.querySelector('[data-preview]');
      const inspected = window.__motionEditor.inspectShotWorkspace(); const target = [...frame.contentDocument.querySelectorAll('[data-motion-id]')]
        .find((item) => item.dataset.motionId === elementId); const rect = target.getBoundingClientRect();
      return { stableDocument: frame.contentDocument === window.__shotDraftDocument, loadCount: Number(frame.dataset.draftLoadCount),
        geometryRequestId: inspected.geometryPump.lastCommittedRequestId, moveCount: inspected.activeDraft.moveCount,
        appliedCount: inspected.activeDraft.appliedCount, controllerActive: inspected.activeDraft.controllerDraft.active,
        handleFeedback: document.querySelector('[data-trajectory-overlay] [aria-pressed="true"]').style.translate !== '',
        native: window.__motionEditor.readState(), bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } }; }, targetElementIds[0]);
    if (!sustainedDraft.stableDocument || sustainedDraft.loadCount !== 0 || sustainedDraft.geometryRequestId !== cancelGeometryRequestId
      || sustainedDraft.moveCount <= 10 || sustainedDraft.appliedCount >= sustainedDraft.moveCount || !sustainedDraft.controllerActive
      || !sustainedDraft.handleFeedback || JSON.stringify(sustainedDraft.native) !== JSON.stringify(draftBaseline.native)
      || JSON.stringify(sustainedDraft.bounds) === JSON.stringify(draftBaseline.bounds)) throw new Error('LANDING_SHOT1_SUSTAINED_DRAFT_INVALID');
    await page.keyboard.press('Escape');
    await observeActionCommit(page, { revision: original.revision, moments: initialMoments, landing: 700,
      settled: baselineTiming.settled, easing: baselineTiming.easing });
    await page.waitForFunction(() => window.__motionEditor.inspectShotWorkspace().activeDraft === null
      && !window.__motionEditor.inspectShotWorkspace().compilerDraft.active);
    await observeGeometryCommit(page, { sampleCount: initialMoments.length, moments: initialMoments });
    const cancelRestoration = await page.evaluate((elementId) => { const frame = document.querySelector('[data-preview]');
      const target = [...frame.contentDocument.querySelectorAll('[data-motion-id]')].find((item) => item.dataset.motionId === elementId);
      const rect = target.getBoundingClientRect(); const inspected = window.__motionEditor.inspectShotWorkspace(); return {
        stableDocument: frame.contentDocument === window.__shotDraftDocument, loadCount: Number(frame.dataset.draftLoadCount),
        geometryRequestId: inspected.geometryPump.lastCommittedRequestId, native: window.__motionEditor.readState(),
        bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom } }; }, targetElementIds[0]);
    if ((await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)) !== original.revision || !cancelRestoration.stableDocument
      || cancelRestoration.loadCount !== 0 || cancelRestoration.geometryRequestId !== cancelGeometryRequestId
      || JSON.stringify(cancelRestoration.native) !== JSON.stringify(draftBaseline.native)
      || JSON.stringify(cancelRestoration.bounds) !== JSON.stringify(draftBaseline.bounds)) throw new Error('LANDING_SHOT1_IMMEDIATE_CANCEL_MUTATED');
    handle = page.locator('[data-trajectory-overlay] [aria-pressed="true"]');
    box = await handle.boundingBox(); if (!box) throw new Error('LANDING_SHOT1_HANDLE_MISSING_AFTER_CANCEL');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 7, box.y + box.height / 2 - 5);
    await page.waitForFunction(() => window.__motionEditor.inspectShotWorkspace().compilerDraft.active);
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
    await page.mouse.up(); await page.waitForFunction(() => window.__motionEditor.inspectShotWorkspace().activeDraft === null
      && !window.__motionEditor.inspectShotWorkspace().compilerDraft.active);
    if ((await currentGeometryRequestId(page)) !== cancelGeometryRequestId
      || (await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)) !== original.revision) throw new Error('LANDING_SHOT1_POINTER_CANCEL_MUTATED');
    handle = page.locator('[data-trajectory-overlay] [aria-pressed="true"]'); box = await handle.boundingBox(); if (!box) throw new Error('LANDING_SHOT1_HANDLE_MISSING_AFTER_POINTER_CANCEL');
    const frameBox = await page.locator('[data-preview]').boundingBox(); if (!frameBox) throw new Error('LANDING_SHOT1_FRAME_MISSING');
    const offFrameDelta = { x: frameBox.x - 1 - (box.x + box.width / 2), y: -4 };
    const releaseGeometryRequestId = await currentGeometryRequestId(page);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
    const pointer = await page.evaluate(async ({ start, deltaClientCssPixels, elementId, baselineBounds }) => { for (let index = 1; index <= 24; index += 1) {
      window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, buttons: 1, clientX: start.x + deltaClientCssPixels.x * index / 24,
        clientY: start.y + deltaClientCssPixels.y * index / 24, bubbles: true })); }
      const draft = window.__motionEditor.inspectShotWorkspace().activeDraft; window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
      await new Promise((resolve) => requestAnimationFrame(() => resolve()));
      const frame = document.querySelector('[data-preview]'); const target = [...frame.contentDocument.querySelectorAll('[data-motion-id]')]
        .find((item) => item.dataset.motionId === elementId); const rect = target.getBoundingClientRect();
      const terminalHandle = document.querySelector('[data-trajectory-overlay] [aria-pressed="true"]');
      return { deltaClientCssPixels, emitted: { deltaXPpm: draft.operation.payload.deltaXPpm, deltaYPpm: draft.operation.payload.deltaYPpm },
        stage: draft.operation.payload.stage, moveCount: draft.moveCount, appliedCount: draft.appliedCount,
        terminal: { stableDocument: frame.contentDocument === window.__shotDraftDocument, loadCount: Number(frame.dataset.draftLoadCount),
          handleFeedback: terminalHandle?.style.translate !== '', phase: window.__motionEditor.inspectShotWorkspace().waypointReleasePhase,
          oldLocation: JSON.stringify({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }) === JSON.stringify(baselineBounds) } }; },
    { start: { x: box.x + box.width / 2, y: box.y + box.height / 2 }, deltaClientCssPixels: offFrameDelta,
      elementId: targetElementIds[0], baselineBounds: draftBaseline.bounds });
    if (!pointer.terminal.stableDocument || pointer.terminal.loadCount !== 0 || !pointer.terminal.handleFeedback
      || pointer.terminal.phase === 'idle' || pointer.terminal.oldLocation) throw new Error('LANDING_SHOT1_TERMINAL_HANDOFF_INVALID');
    await page.mouse.up();
    await observeActionCommit(page, { revision: 1, moments: initialMoments, landing: 700,
      settled: baselineTiming.settled, easing: baselineTiming.easing });
    await observeGeometryCommit(page, { sampleCount: initialMoments.length, previousRequestId: releaseGeometryRequestId, moments: initialMoments });
    const releaseState = await page.evaluate(() => { const frame = document.querySelector('[data-preview]'); const workspace = window.__motionEditor.inspectShotWorkspace(); return {
      activeDraft: workspace.activeDraft, loadCount: Number(frame.dataset.draftLoadCount), releasePhase: workspace.waypointReleasePhase,
      remountedDocument: frame.contentDocument !== window.__shotDraftDocument, compilerEqual: workspace.previewMatchesCompiler,
      navigationSourceEqual: workspace.previewNavigationSourceMatchesCompiler, promotion: workspace.lastPreviewCommitPromotion }; });
    if (releaseState.activeDraft !== null || releaseState.loadCount !== 0 || releaseState.remountedDocument || !releaseState.compilerEqual
      || releaseState.navigationSourceEqual || releaseState.releasePhase !== 'idle' || !releaseState.promotion.promoted
      || releaseState.promotion.fallbackCode !== null) {
      throw new Error(`LANDING_SHOT1_RELEASE_DRAFT_RESURRECTED_${JSON.stringify({ releaseState, pointer })}`);
    }
    const paintedFrames = await page.evaluate(() => new Promise((resolve) => {
      window.__shotPaintOracle.stopAfter = 2; window.__shotPaintOracle.resolve = resolve;
    }));
    if (paintedFrames.frameCount <= 2 || paintedFrames.releaseFrameCount === 0 || paintedFrames.documentChanges !== 0
      || paintedFrames.styleChanges !== 0 || paintedFrames.nativeStateViolations !== 0 || paintedFrames.oldLocationReleaseFrames !== 0
      || paintedFrames.handleIdentityGaps !== 0 || paintedFrames.handleOrderGaps !== 0 || paintedFrames.activeHandleGaps !== 0
      || paintedFrames.terminalFeedbackGaps !== 0) throw new Error(`LANDING_SHOT1_PAINT_CONTINUITY_INVALID_${JSON.stringify(paintedFrames)}`);
    handle = page.locator('[data-trajectory-overlay] [aria-pressed="true"]');
    const runway = await handle.evaluate((node) => { const frameRect = document.querySelector('[data-preview]').getBoundingClientRect();
      const stageRect = document.querySelector('.preview-stage').getBoundingClientRect(); const handleRect = node.getBoundingClientRect();
      const center = { x: (handleRect.left + handleRect.right) / 2, y: (handleRect.top + handleRect.bottom) / 2 };
      return { partial: handleRect.left < frameRect.left && handleRect.right > frameRect.left,
        whollyVisible: handleRect.left >= stageRect.left && handleRect.right <= stageRect.right && handleRect.top >= stageRect.top && handleRect.bottom <= stageRect.bottom,
        hitTestable: document.elementFromPoint(center.x, center.y) === node }; });
    if (!Object.values(runway).every(Boolean)) throw new Error('LANDING_SHOT1_OFF_FRAME_RUNWAY_INVALID');
    await page.locator('[data-move-together]').check();
    await observeGeometryCommit(page, { sampleCount: groupedInitialMoments.length, moments: groupedInitialMoments });
    const groupedScope = await page.evaluate(() => ({ grouped: document.querySelector('[data-move-together]').checked,
      selectedCount: window.__motionEditor.inspectShotWorkspace().selectedElementIds.length }));
    if (!groupedScope.grouped || groupedScope.selectedCount !== 2) throw new Error('LANDING_SHOT1_GROUP_SCOPE_NOT_COMMITTED');
    await ensureAdvancedOpen(page, '[data-pose-form]');
    const x = page.locator('[data-pose-form] input[name="x"]');
    const scale = page.locator('[data-pose-form] input[name="scale"]');
    const rotate = page.locator('[data-pose-form] input[name="rotate"]');
    const poseBefore = { x: Number(await x.inputValue()), scale: Number(await scale.inputValue()), rotate: Number(await rotate.inputValue()) };
    const poseAfter = { x: poseBefore.x + 8, scale: poseBefore.scale <= 2.99 ? poseBefore.scale + 0.01 : poseBefore.scale - 0.01,
      rotate: poseBefore.rotate <= 179 ? poseBefore.rotate + 1 : poseBefore.rotate - 1 };
    const poseCoverage = { translation: poseAfter.x !== poseBefore.x, scale: poseAfter.scale !== poseBefore.scale,
      rotation: poseAfter.rotate !== poseBefore.rotate, withinBounds: poseAfter.scale >= 0.25 && poseAfter.scale <= 3
        && poseAfter.rotate >= -180 && poseAfter.rotate <= 180 };
    if (!Object.values(poseCoverage).every(Boolean)) throw new Error('LANDING_SHOT1_POSE_COVERAGE_INVALID');
    await x.fill(String(poseAfter.x)); await scale.fill(String(poseAfter.scale)); await rotate.fill(String(poseAfter.rotate));
    let transitionRequestId = await currentGeometryRequestId(page);
    await page.getByRole('button', { name: 'Apply pose' }).click();
    await observeActionCommit(page, { revision: 2, moments: groupedInitialMoments, landing: 700,
      settled: baselineTiming.settled, easing: baselineTiming.easing });
    await observeGeometryCommit(page, { sampleCount: groupedInitialMoments.length, previousRequestId: transitionRequestId, moments: groupedInitialMoments });
    await page.locator('[data-shot-advanced-close]').click();
    transitionRequestId = await currentGeometryRequestId(page);
    const retimeCommandCount = pathAlignmentCommandCount;
    await page.locator('[data-shot-context-time]').fill('840');
    await observeActionCommit(page, { revision: 3, moments: groupedRetimedMoments, landing: 840,
      settled: baselineTiming.settled, easing: baselineTiming.easing });
    await observeGeometryCommit(page, { sampleCount: groupedRetimedMoments.length, previousRequestId: transitionRequestId, moments: groupedRetimedMoments });
    if (!exactlyAligned(await readMomentAlignment(), 840, 3) || pathAlignmentCommandCount !== retimeCommandCount + 1
      || (await currentGeometryRequestId(page)) <= transitionRequestId) throw new Error('LANDING_SHOT1_RETIME_RECONCILIATION_INVALID');
    transitionRequestId = await currentGeometryRequestId(page);
    await page.locator('[data-shot-easing]').selectOption('ease-in-out'); await page.locator('[data-shot-apply-easing]').click();
    await observeActionCommit(page, { revision: 4, moments: groupedRetimedMoments, landing: 840,
      settled: baselineTiming.settled, easing: 'ease-in-out' });
    await observeGeometryCommit(page, { sampleCount: groupedRetimedMoments.length, previousRequestId: transitionRequestId, moments: groupedRetimedMoments });
    transitionRequestId = await currentGeometryRequestId(page);
    await ensureAdvancedOpen(page, '[data-shot-settled]');
    await page.locator('[data-shot-settled]').fill('1820'); await page.locator('[data-shot-hold]').click();
    await observeActionCommit(page, { revision: 5, moments: groupedHeldMoments, landing: 840, settled: 1820, easing: 'ease-in-out' });
    await observeGeometryCommit(page, { sampleCount: groupedHeldMoments.length, previousRequestId: transitionRequestId, moments: groupedHeldMoments });
    const edited = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    const readInteractiveInventory = () => page.evaluate(() => ({
      controls: [...document.querySelectorAll('input[name="shot-moment"]')].map((input) => Number(input.value)),
      handles: [...document.querySelectorAll('[data-trajectory-overlay] [data-keyframe-id]')].map((handle) => ({ keyframeId: handle.dataset.keyframeId,
        timeMs: Number(handle.dataset.timeMs) })),
    }));
    let editedSpatialTargets = []; let editedSpatialParity = authority !== 'public'; let racePreviousRequestId = null; let atomicSwitchProof = null;
    if (authority === 'public') {
      const editedTarget0 = await readSpatialProof(0, 4); let priorRequestId = await currentGeometryRequestId(page); await primaryInputs.nth(1).check();
      await observeGeometryCommit(page, { sampleCount: 4, previousRequestId: priorRequestId, moments: [0, 840, 1820, 2100] });
      const editedTarget1 = await readSpatialProof(1, 4); priorRequestId = await currentGeometryRequestId(page);
      await page.evaluate(() => { const handles = [...document.querySelectorAll('[data-trajectory-overlay] [data-keyframe-id]')];
        const retained = new Map(handles.map((handle) => [handle.dataset.keyframeId, handle])); window.__atomicSwitchNodes = retained;
        const frames = { frameCount: 0, busyFrames: 0, identityGaps: 0, stopAfter: null, resolve: null }; window.__atomicSwitchFrames = frames;
        const tick = () => { const current = [...document.querySelectorAll('[data-trajectory-overlay] [data-keyframe-id]')]; frames.frameCount += 1;
          if (document.querySelector('[data-trajectory-overlay]').getAttribute('aria-busy') !== 'false') frames.busyFrames += 1;
          if (current.length !== handles.length || current.some((handle) => (retained.has(handle.dataset.keyframeId)
            && retained.get(handle.dataset.keyframeId) !== handle) || !handle.isConnected)) frames.identityGaps += 1;
          if (frames.stopAfter !== null && --frames.stopAfter === 0) { frames.resolve({ ...frames, stopAfter: undefined, resolve: undefined }); return; }
          requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
      await primaryInputs.nth(0).check();
      await observeGeometryCommit(page, { sampleCount: 4, previousRequestId: priorRequestId, moments: [0, 840, 1820, 2100] });
      atomicSwitchProof = await page.evaluate(() => new Promise((resolve) => {
        const inspected = window.__motionEditor.inspectShotWorkspace(); const handles = [...document.querySelectorAll('[data-trajectory-overlay] [data-keyframe-id]')];
        const retained = window.__atomicSwitchNodes; const settled = inspected.geometryPump.latestRequestId === inspected.geometryPump.lastCommittedRequestId
          && inspected.geometryPump.lastCommittedRequestId > 0 && !inspected.geometryPump.running && inspected.geometryPump.activeSamplers === 0
          && inspected.geometryPump.pendingRequestId === null && inspected.geometry.length === 4
          && inspected.geometry.every((sample) => Object.values(sample.deltasDevicePixels).every((delta) => delta <= 1))
          && JSON.stringify(handles.map((handle) => Number(handle.dataset.timeMs))) === JSON.stringify([0, 840, 1820, 2100])
          && new Set(handles.map((handle) => handle.dataset.keyframeId)).size === 4
          && handles.every((handle) => (!retained.has(handle.dataset.keyframeId)
            || retained.get(handle.dataset.keyframeId) === handle) && handle.isConnected);
        window.__atomicSwitchFrames.stopAfter = 2; window.__atomicSwitchFrames.resolve = (frames) => resolve({ settled, frames }); }));
      if (!atomicSwitchProof.settled || atomicSwitchProof.frames.frameCount === 0 || atomicSwitchProof.frames.busyFrames !== 0
        || atomicSwitchProof.frames.identityGaps !== 0) throw new Error('LANDING_SHOT1_ATOMIC_SWITCH_INVALID');
      racePreviousRequestId = await currentGeometryRequestId(page); editedSpatialTargets = [editedTarget0, editedTarget1];
      const inventory = await readInteractiveInventory();
      editedSpatialParity = JSON.stringify(inventory.controls) === JSON.stringify([0, 840, 1820, 2100])
        && JSON.stringify(inventory.handles.map((handle) => handle.timeMs)) === JSON.stringify([0, 840, 1820, 2100])
        && inventory.handles.every((handle) => handle.keyframeId) && new Set(inventory.handles.map((handle) => handle.keyframeId)).size === 4
        && editedSpatialTargets.every((target) => JSON.stringify(target.samples.map((sample) => sample.timeMs)) === JSON.stringify([0, 840, 1820, 2100])
          && target.samples.every((sample) => Object.values(sample.deltasDevicePixels).every((delta) => delta <= 1)));
      if (!editedSpatialParity) throw new Error('LANDING_SHOT1_EDITED_SPATIAL_PARITY');
    }
    const scrubber = page.locator('[data-scrub]');
    await scrubber.fill('2100');
    const settledPlaybackBounds = await page.evaluate((elementIds) => { const frame = document.querySelector('[data-preview]');
      return elementIds.map((elementId) => { const target = [...frame.contentDocument.querySelectorAll('[data-motion-id]')]
        .find((item) => item.dataset.motionId === elementId); const rect = target.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; }); }, targetElementIds);
    const endpointCommandCount = pathAlignmentCommandCount;
    await scrubber.fill('2088'); await page.locator('[data-play]').click();
    await page.waitForFunction(() => { const state = window.__motionEditor.readState(); return state.playheadMs === 2100
      && state.currentTimes.length > 0 && state.currentTimes.every((time) => time === 2100)
      && state.playStates.every((playState) => playState === 'paused')
      && Number(document.querySelector('[data-scrub]').value) === 2100 && document.querySelector('[data-playhead]').value === '2100 ms'; });
    const playbackEndpointHold = pathAlignmentCommandCount === endpointCommandCount && await page.evaluate(({ elementIds, expected }) => {
      const frame = document.querySelector('[data-preview]'); return elementIds.map((elementId) => {
        const target = [...frame.contentDocument.querySelectorAll('[data-motion-id]')].find((item) => item.dataset.motionId === elementId);
        const rect = target.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
      }).every((bounds, index) => JSON.stringify(bounds) === JSON.stringify(expected[index]));
    }, { elementIds: targetElementIds, expected: settledPlaybackBounds });
    if (!playbackEndpointHold) throw new Error('LANDING_SHOT1_PLAYBACK_ENDPOINT_HOLD_INVALID');
    const uiSampleTimesMs = [...new Set([0, 700, ...heldMoments, 839, 840, 841, 1819, 1820, 1821, 2099, 2101])]
      .filter((timeMs) => timeMs !== 2100);
    uiSampleTimesMs.push(2100);
    await scrubber.fill('837'); await scrubber.fill('838');
    const readRaceState = () => page.evaluate(() => { const frame = document.querySelector('[data-preview]'); const inspected = window.__motionEditor.inspectShotWorkspace();
      const state = window.__motionEditor.readState(); const animations = frame.contentDocument.getAnimations();
      return { sliderValueMs: Number(document.querySelector('[data-scrub]').value), playheadMs: state.playheadMs,
        controllerCurrentTimesMs: state.currentTimes, nativeCurrentTimesMs: animations.map((animation) => animation.currentTime),
        playStates: animations.map((animation) => animation.playState), geometryCount: inspected.geometry.length, geometryDeltas: inspected.geometry.map((sample) => sample.deltasDevicePixels),
        geometryPump: inspected.geometryPump }; });
    const immediateRaceState = await scrubber.evaluate((input) => { let immediate;
      input.addEventListener('input', () => { const frame = document.querySelector('[data-preview]');
        const inspected = window.__motionEditor.inspectShotWorkspace(); const state = window.__motionEditor.readState();
        const animations = frame.contentDocument.getAnimations(); immediate = { sliderValueMs: Number(input.value), playheadMs: state.playheadMs,
          controllerCurrentTimesMs: state.currentTimes, nativeCurrentTimesMs: animations.map((animation) => animation.currentTime),
          playStates: animations.map((animation) => animation.playState), geometryCount: inspected.geometry.length,
          geometryDeltas: inspected.geometry.map((sample) => sample.deltasDevicePixels), geometryPump: inspected.geometryPump }; }, { once: true });
      input.value = '839'; input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: '839' }));
      if (!immediate) throw new Error('LANDING_SHOT1_IMMEDIATE_SAME_DISPATCH_CAPTURE_MISSING'); return immediate; });
    await observeGeometryCommit(page, { sampleCount: groupedHeldMoments.length, moments: groupedHeldMoments });
    const settledRaceState = await readRaceState();
    const exactRace = [immediateRaceState, settledRaceState].every((state) => state.sliderValueMs === 839 && state.playheadMs === 839
      && state.controllerCurrentTimesMs.every((time) => time === 839) && state.nativeCurrentTimesMs.every((time) => time === 839)
      && state.playStates.every((playState) => playState === 'paused')) && settledRaceState.geometryCount === groupedHeldMoments.length
      && settledRaceState.geometryDeltas.every((deltas) => Object.values(deltas).every((delta) => delta <= 1))
      && settledRaceState.geometryPump.maximumActiveSamplers === 1 && settledRaceState.geometryPump.activeSamplers === 0
      && settledRaceState.geometryPump.pendingRequestId === null
      && settledRaceState.geometryPump.lastCommittedRequestId === settledRaceState.geometryPump.latestRequestId;
    if (!exactRace) throw new Error('LANDING_SHOT1_EXACT_RACE');
    const committedGeometryIdentity = JSON.stringify(settledRaceState.geometryPump);
    const intermediateAlignmentBaseline = { revision: (await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)),
      commandCount: pathAlignmentCommandCount };
    await page.locator('input[name="shot-moment"][value="1820"]').check();
    if (!exactlyAligned(await readMomentAlignment(), 1820, intermediateAlignmentBaseline.revision)
      || pathAlignmentCommandCount !== intermediateAlignmentBaseline.commandCount
      || (await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)) !== intermediateAlignmentBaseline.revision) {
      throw new Error('LANDING_SHOT1_INTERMEDIATE_ALIGNMENT_INVALID');
    }
    const momentOnlyGeometryIdentity = JSON.stringify((await readRaceState()).geometryPump) === committedGeometryIdentity;
    if (!momentOnlyGeometryIdentity) throw new Error('LANDING_SHOT1_MOMENT_RESAMPLED');
    const uiSamples = []; for (const sample of uiSampleTimesMs) {
      const immediateEvidence = await scrubber.evaluate((input, timeMs) => { let immediate;
        const capture = () => { const iframe = document.querySelector('[data-preview]'); const animations = iframe.contentDocument.getAnimations();
          const state = window.__motionEditor.readState(); return { category: 'uiScrub', timeMs, rangeMaxMs: Number(input.max),
            sliderValueMs: Number(input.value), playheadMs: state.playheadMs, controllerCurrentTimesMs: state.currentTimes,
            nativeCurrentTimesMs: animations.map((animation) => animation.currentTime),
            nativeTypes: animations.map((animation) => ({ animation: animation.constructor.name,
              effect: animation.effect?.constructor.name, timeline: animation.timeline?.constructor.name })),
            playStates: animations.map((animation) => animation.playState), previewMatchesCompiler: iframe.srcdoc === window.__motionEditor.compiledHtml }; };
        input.addEventListener('input', () => { immediate = capture(); }, { once: true });
        input.value = String(timeMs);
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: String(timeMs) }));
        if (!immediate) throw new Error('LANDING_SHOT1_UI_SAMPLE_IMMEDIATE_CAPTURE_MISSING');
        return immediate;
      }, sample);
      const stableEvidence = await page.evaluate(async (timeMs) => { const iframe = document.querySelector('[data-preview]');
        await new Promise((resolveRender) => iframe.contentWindow.requestAnimationFrame(() => iframe.contentWindow.requestAnimationFrame(resolveRender)));
        const input = document.querySelector('[data-scrub]'); const animations = iframe.contentDocument.getAnimations();
        const state = window.__motionEditor.readState(); return { category: 'uiScrub', timeMs, rangeMaxMs: Number(input.max),
          sliderValueMs: Number(input.value), playheadMs: state.playheadMs, controllerCurrentTimesMs: state.currentTimes,
          nativeCurrentTimesMs: animations.map((animation) => animation.currentTime),
          nativeTypes: animations.map((animation) => ({ animation: animation.constructor.name,
            effect: animation.effect?.constructor.name, timeline: animation.timeline?.constructor.name })),
          playStates: animations.map((animation) => animation.playState), previewMatchesCompiler: iframe.srcdoc === window.__motionEditor.compiledHtml };
      }, sample);
      const exactSample = (evidence) => evidence.rangeMaxMs === 2101 && evidence.sliderValueMs === sample && evidence.playheadMs === sample
        && evidence.controllerCurrentTimesMs.length > 0 && evidence.controllerCurrentTimesMs.every((time) => time === sample)
        && evidence.nativeCurrentTimesMs.every((time) => time === sample)
        && evidence.nativeTypes.every((types) => types.animation === 'CSSAnimation' && types.effect === 'KeyframeEffect'
          && types.timeline === 'DocumentTimeline')
        && evidence.playStates.every((state) => state === 'paused') && evidence.previewMatchesCompiler;
      if (!exactSample(immediateEvidence)) throw new Error(`LANDING_SHOT1_UI_SAMPLE_IMMEDIATE_${sample}`);
      if (!exactSample(stableEvidence) || JSON.stringify(stableEvidence) !== JSON.stringify(immediateEvidence)) {
        throw new Error(`LANDING_SHOT1_UI_SAMPLE_STABILITY_${sample}`);
      }
      if (JSON.stringify((await readRaceState()).geometryPump) !== committedGeometryIdentity) throw new Error(`LANDING_SHOT1_IDLE_RESAMPLED_${sample}`);
      uiSamples.push({ ...stableEvidence, immediateExact: true, twoFrameStable: true }); }
    const nativePostRange = await page.evaluate(async () => { const iframe = document.querySelector('[data-preview]'); const input = document.querySelector('[data-scrub]');
      const animations = iframe.contentDocument.getAnimations(); animations.forEach((animation) => { animation.pause(); animation.currentTime = 2101; });
      await Promise.all(animations.map((animation) => animation.ready));
      await new Promise((resolveRender) => iframe.contentWindow.requestAnimationFrame(() => iframe.contentWindow.requestAnimationFrame(resolveRender)));
      const state = window.__motionEditor.readState(); return { category: 'nativePostRange', timeMs: 2101, rangeMaxMs: Number(input.max),
        sliderValueMs: Number(input.value), playheadMs: state.playheadMs, controllerCurrentTimesMs: state.currentTimes,
        nativeCurrentTimesMs: animations.map((animation) => animation.currentTime), nativeTypes: animations.map((animation) => ({
          animation: animation.constructor.name, effect: animation.effect?.constructor.name, timeline: animation.timeline?.constructor.name })),
        playStates: animations.map((animation) => animation.playState), previewMounted: iframe.isConnected && iframe.contentDocument?.readyState === 'complete',
        previewMatchesCompiler: iframe.srcdoc === window.__motionEditor.compiledHtml }; });
    if (nativePostRange.rangeMaxMs !== 2101 || nativePostRange.sliderValueMs !== 2100 || nativePostRange.playheadMs !== 2100
      || nativePostRange.nativeCurrentTimesMs.length === 0 || !nativePostRange.nativeCurrentTimesMs.every((time) => time === 2101)
      || !nativePostRange.controllerCurrentTimesMs.every((time) => time === 2101)
      || !nativePostRange.nativeTypes.every((types) => types.animation === 'CSSAnimation' && types.effect === 'KeyframeEffect'
        && types.timeline === 'DocumentTimeline')
      || !nativePostRange.playStates.every((state) => state === 'paused') || !nativePostRange.previewMounted
      || !nativePostRange.previewMatchesCompiler) throw new Error('LANDING_SHOT1_NATIVE_POST_RANGE_2101');
    await scrubber.fill('2100'); const restoration = await page.evaluate(() => { const iframe = document.querySelector('[data-preview]');
      const input = document.querySelector('[data-scrub]'); const animations = iframe.contentDocument.getAnimations(); const state = window.__motionEditor.readState();
      return { method: 'uiScrub', rangeMaxMs: Number(input.max), sliderValueMs: Number(input.value), playheadMs: state.playheadMs,
        controllerCurrentTimesMs: state.currentTimes, nativeCurrentTimesMs: animations.map((animation) => animation.currentTime),
        playStates: animations.map((animation) => animation.playState), previewMatchesCompiler: iframe.srcdoc === window.__motionEditor.compiledHtml }; });
    const exactRestoration = restoration.rangeMaxMs === 2101 && restoration.sliderValueMs === 2100 && restoration.playheadMs === 2100
      && restoration.controllerCurrentTimesMs.length > 0 && restoration.controllerCurrentTimesMs.every((time) => time === 2100)
      && restoration.nativeCurrentTimesMs.every((time) => time === 2100)
      && restoration.playStates.every((state) => state === 'paused') && restoration.previewMatchesCompiler;
    if (!exactRestoration) throw new Error('LANDING_SHOT1_UI_RESTORATION_2100');
    const nativeBoundaryProof = uiSamples.length === uiSampleTimesMs.length
      && [0, 700, 2100].every((timeMs) => uiSamples.some((sample) => sample.timeMs === timeMs))
      && nativePostRange.category === 'nativePostRange' && exactRestoration;
    await page.locator('input[name="shot-moment"][value="840"]').check();
    if (!exactlyAligned(await readMomentAlignment(), 840, 5)
      || JSON.stringify((await readRaceState()).geometryPump) !== committedGeometryIdentity) throw new Error('LANDING_SHOT1_HISTORY_ALIGNMENT_SETUP_INVALID');
    const undoContracts = [
      { revision: 6, moments: groupedRetimedMoments, geometryCount: groupedRetimedMoments.length, landing: 840, settled: baselineTiming.settled, easing: 'ease-in-out' },
      { revision: 7, moments: groupedRetimedMoments, geometryCount: groupedRetimedMoments.length, landing: 840, settled: baselineTiming.settled, easing: baselineTiming.easing },
      { revision: 8, moments: groupedInitialMoments, geometryCount: groupedInitialMoments.length, landing: 700, settled: baselineTiming.settled, easing: baselineTiming.easing },
      { revision: 9, moments: groupedInitialMoments, geometryCount: groupedInitialMoments.length, landing: 700, settled: baselineTiming.settled, easing: baselineTiming.easing },
      { revision: 10, moments: groupedInitialMoments, geometryCount: groupedInitialMoments.length, landing: 700, settled: baselineTiming.settled, easing: baselineTiming.easing },
    ];
    for (const contract of undoContracts) { const priorRequestId = await currentGeometryRequestId(page); const priorCommandCount = pathAlignmentCommandCount;
      await page.locator('[data-undo]').click(); await observeActionCommit(page, contract);
      await observeGeometryCommit(page, { sampleCount: contract.geometryCount, previousRequestId: priorRequestId, moments: contract.moments });
      const expectedMoment = contract.moments.includes(840) ? 840 : 700;
      if (!exactlyAligned(await readMomentAlignment(), expectedMoment, contract.revision)
        || pathAlignmentCommandCount !== priorCommandCount + 1 || (await currentGeometryRequestId(page)) <= priorRequestId) {
        throw new Error('LANDING_SHOT1_UNDO_RECONCILIATION_INVALID');
      } }
    const undone = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    const undoneInventory = await readInteractiveInventory();
    const redoContracts = [
      { revision: 11, moments: groupedInitialMoments, geometryCount: groupedInitialMoments.length, landing: 700, settled: baselineTiming.settled, easing: baselineTiming.easing },
      { revision: 12, moments: groupedInitialMoments, geometryCount: groupedInitialMoments.length, landing: 700, settled: baselineTiming.settled, easing: baselineTiming.easing },
      { revision: 13, moments: groupedRetimedMoments, geometryCount: groupedRetimedMoments.length, landing: 840, settled: baselineTiming.settled, easing: baselineTiming.easing },
      { revision: 14, moments: groupedRetimedMoments, geometryCount: groupedRetimedMoments.length, landing: 840, settled: baselineTiming.settled, easing: 'ease-in-out' },
      { revision: 15, moments: groupedHeldMoments, geometryCount: groupedHeldMoments.length, landing: 840, settled: 1820, easing: 'ease-in-out' },
    ];
    for (const contract of redoContracts) { const priorRequestId = await currentGeometryRequestId(page); const priorCommandCount = pathAlignmentCommandCount;
      await page.locator('[data-redo]').click(); await observeActionCommit(page, contract);
      await observeGeometryCommit(page, { sampleCount: contract.geometryCount, previousRequestId: priorRequestId, moments: contract.moments });
      const expectedMoment = contract.moments.includes(840) ? 840 : 700;
      if (!exactlyAligned(await readMomentAlignment(), expectedMoment, contract.revision)
        || pathAlignmentCommandCount !== priorCommandCount + 1 || (await currentGeometryRequestId(page)) <= priorRequestId) {
        throw new Error('LANDING_SHOT1_REDO_RECONCILIATION_INVALID');
      } }
    const redone = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    const redoneInventory = await readInteractiveInventory(); const exports = await page.evaluate(() => [window.__motionEditor.compiledHtml, window.__motionEditor.compiledHtml, window.__motionEditor.compiledHtml]);
    const asymmetricAlternatePrimary = authority === 'public'
      ? await runAsymmetricAlternatePrimaryQa({ repositoryRoot, directory, browser: shotBrowser, port: port + 500 }) : null;
    const hitOwnership = authority === 'public'
      ? await runHitOwnershipQa({ repositoryRoot, directory, browser: shotBrowser }) : null;
    const checks = { workspaceOpened: workspaceState.open, fiveOperations: edited.revision === 5, exactUndo: undone.contentDigest === original.contentDigest,
      exactRedo: redone.contentDigest === edited.contentDigest && redone.exportDigest === edited.exportDigest,
      historyInventories: JSON.stringify(undoneInventory.controls) === JSON.stringify(groupedInitialMoments)
        && JSON.stringify(undoneInventory.handles.map((handle) => handle.timeMs)) === JSON.stringify(groupedInitialMoments)
        && JSON.stringify(redoneInventory.controls) === JSON.stringify(groupedHeldMoments)
        && JSON.stringify(redoneInventory.handles.map((handle) => handle.timeMs)) === JSON.stringify(groupedHeldMoments),
      tripleExportEqual: exports.every((value) => value === exports[0]), nativeBoundaryProof, playbackEndpointHold, spatialParity, editedSpatialParity, exactRace,
      momentOnlyGeometryIdentity, smoothDrag: true, asymmetricAlternatePrimary: authority !== 'public' || asymmetricAlternatePrimary?.passed === true,
      hitOwnership: authority !== 'public' || hitOwnership?.passed === true,
      poseTranslation: poseCoverage.translation, poseScale: poseCoverage.scale, poseRotation: poseCoverage.rotation,
      previewMatchesCompiler: (await page.evaluate(() => window.__motionEditor.inspectShotWorkspace())).previewMatchesCompiler,
      zeroConsoleErrors: diagnostics.consoleErrors.length === 0, zeroPageErrors: diagnostics.pageErrors.length === 0,
      zeroFailedRequests: diagnostics.failedRequests.length === 0, zeroUnexpectedNetwork: diagnostics.unexpectedNetwork.length === 0, zeroHttpErrors: diagnostics.httpErrors.length === 0 };
    const receipt = { schemaVersion: 'motion.landing-shot1-chrome-qa.v2', passed: Object.values(checks).every(Boolean),
      browser: { name: 'Google Chrome', version: shotBrowser.version() }, privateReference: authority === 'private',
      targetCount: targetElementIds.length, operationCount: 5,
      coverage: { translation: poseCoverage.translation, scale: poseCoverage.scale, rotation: poseCoverage.rotation },
      revisions: { original: original.revision, edited: edited.revision, undone: undone.revision, redone: redone.revision },
      history: { edited: { undoCount: edited.undoCount, redoCount: edited.redoCount }, undone: { undoCount: undone.undoCount, redoCount: undone.redoCount },
        redone: { undoCount: redone.undoCount, redoCount: redone.redoCount } },
      samples: { semanticsVersion: 'motion.landing-shot1-samples.v2', uiScrub: uiSamples, nativePostRange, restoration },
      originalDigest: original.contentDigest, editedDigest: edited.contentDigest, exportDigest: edited.exportDigest,
      errors: diagnostics, checks };
    const sanitizeRaceState = ({ geometryPump, ...state }) => ({ ...state, geometryPump: { running: geometryPump.running,
      activeSamplers: geometryPump.activeSamplers, maximumActiveSamplers: geometryPump.maximumActiveSamplers,
      pending: geometryPump.pendingRequestId !== null, latestCommitted: geometryPump.lastCommittedRequestId === geometryPump.latestRequestId } });
    const spatialReceipt = { schemaVersion: 'motion.shot1-spatial-parity.v1', environment: 'installed-chrome-public-synthetic', passed: spatialParity,
      corpusAuthority: 'fixtures/public-synthetic/landing-shot1.html', browser: { name: 'Google Chrome', version: shotBrowser.version() }, viewport: { width: 1440, height: 900 },
      reviewOracle: { timesMs: [0, 700, 2100], combinations: 6, targets: spatialTargets },
      editedWaypointInventory: { timesMs: [0, 840, 1820, 2100], combinations: 8, targets: editedSpatialTargets },
      focusedUx: { ...focusedSurface, offFrameRunway: runway },
      smoothDrag: { stableDocumentDuringDraft: sustainedDraft.stableDocument, iframeLoadsDuringDraft: sustainedDraft.loadCount,
        pointerMoveCount: sustainedDraft.moveCount, compilerDraftApplicationCount: sustainedDraft.appliedCount,
        geometryRequestIdentityPreserved: sustainedDraft.geometryRequestId === cancelGeometryRequestId,
        nativeStatePreserved: JSON.stringify(sustainedDraft.native) === JSON.stringify(draftBaseline.native),
        escapeRestoredExactly: cancelRestoration.stableDocument && cancelRestoration.loadCount === 0,
        pointerCancelRestoredExactly: true, committedIframeLoads: releaseState.loadCount,
        terminalHandleRetainedUntilCommit: pointer.terminal.handleFeedback, noOldLocationReleaseFrame: !pointer.terminal.oldLocation,
        cssCommitPromoted: releaseState.promotion.promoted, navigationSourceSeparated: !releaseState.navigationSourceEqual,
        committedCompilerEqual: releaseState.compilerEqual, latestReleaseCommitted: true },
      paintContinuity: { everyFrameObserved: paintedFrames.frameCount > 2 && paintedFrames.releaseFrameCount > 0,
        everyFrameNativeExact: paintedFrames.nativeStateViolations === 0,
        stableDocumentAndStyle: paintedFrames.documentChanges === 0 && paintedFrames.styleChanges === 0,
        noOldLocationReleaseFrame: paintedFrames.oldLocationReleaseFrames === 0,
        retainedHandleIdentity: paintedFrames.handleIdentityGaps === 0 && paintedFrames.handleOrderGaps === 0,
        activeAndTerminalContinuous: paintedFrames.activeHandleGaps === 0 && paintedFrames.terminalFeedbackGaps === 0,
        atomicSwitchRequestSettled: authority !== 'public' || atomicSwitchProof.settled,
        atomicSwitchNoPaintedBusy: authority !== 'public' || atomicSwitchProof.frames.busyFrames === 0,
        atomicSwitchRetainedNodes: authority !== 'public' || atomicSwitchProof.frames.identityGaps === 0 },
      asymmetricAlternatePrimary,
      hitOwnership,
      pointer, history: { operationCount: 5, undoCount: 5, redoCount: 5, exactUndo: checks.exactUndo, exactRedo: checks.exactRedo },
      race: { requestedTimeMs: 839, immediate: sanitizeRaceState(immediateRaceState), settled: sanitizeRaceState(settledRaceState) },
      geometryValidity: { idleBoundaryRequestIdentityPreserved: true, momentOnlyRequestIdentityPreserved: momentOnlyGeometryIdentity },
      compiler: { previewMatchesCompiler: checks.previewMatchesCompiler, tripleExportEqual: checks.tripleExportEqual } };
    if (authority === 'public') await writeFile(resolve(directory, 'installed-chrome-spatial-parity.json'), `${JSON.stringify(spatialReceipt, null, 2)}\n`);
    if (authority === 'private') await writeFile(resolve(privateDirectory, 'chrome-qa.json'), `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(receipt)}\n`); if (!receipt.passed) process.exitCode = 1;
  } finally {
    await shotBrowser?.close(); processHandle.kill('SIGTERM'); if (processHandle.exitCode === null) await new Promise((done) => processHandle.once('exit', done));
    await rm(directory, { recursive: true, force: true });
  }
}
