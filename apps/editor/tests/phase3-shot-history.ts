import { expect, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runCli } from '../../../packages/motion-cli/src/cli.ts';
import { compileMotionDocument } from '../../../packages/css-compiler/src/index.ts';
import { canonicalContentBytes, projectTrajectorySelection, sha256Hex } from '../../../packages/domain/src/index.ts';
import { MotionServiceClient } from '../../../packages/motion-protocol/src/index.ts';
import { createPhase3Seed, createTrajectorySeed } from '../../../packages/local-service/src/seed.ts';
import { createPreviewOverlayProjection, previewPointerDeltaToPpm } from '../../../packages/preview-runtime/src/index.ts';
import { runShotGesture } from './phase3-shot-gesture.js';

export async function runShotHistory(context: Awaited<ReturnType<typeof runShotGesture>>) {
  const { page, directory, humanCapability, agentCapability, root, port, seed, targetElementIds, inheritedTargets, runtimeSeedPath, processHandle, addresses, editorUrl, serviceUrl, commandBytes, preparationBytes, commandStatuses, consoleErrors, workspace, layoutContract, readGeometry, closedGeometry, advancedMotion, objectInputs, primaryInputs, focusedLayout, beforePathAlignment, readMomentAlignment, awaitShotMutationSettlement, previewToolbar, referenceSegments, referenceWaypoints, referenceGeometryBeforeSwitch, canvasObjectTargets, selectedReferenceSegments, settledObjectBounds, finishedEndpointBaseline, finishedEndpointArrival, rejectedTimingBaseline, priorNativeTimeMs, readSpatialProof, spatialTargets, initialPrimaryCommitId, changedPrimaryCommitId, readInteractiveInventory, beforeResizeCommitId, original, committedSrcdoc, landed, box, activeHit, armGestureProjectionProbe, takeGestureProjection, draftBaseline, cancelledPointerStart, cancelledGestureProjection, cancelledPointerEnd, cancelledDraft, cancelledExpectedDelta, cancelledRestoration, pointerCancelDraft, pointerCancelRestoration, iframeBox, offFrameDelta, releasedPointerStart, releasedGestureProjection, releasedPointerEnd, releasedDraft, releasedExpectedDelta, terminalRelease, remountedCommitId, releasedWire, postRelease, paintedFrames, runway, revisionOne, currentGroup, x, failedPublicationBaseline, failedPublicationGeometry, groupedCommand, retimeGeometryRequestId, timingCommands } = context;
  const edited = await page.evaluate(() => window.__motionEditor.inspectAuthoring()); expect(edited.contentDigest).not.toBe(original.contentDigest);
  expect(commandBytes).toHaveLength(5);
  expect(preparationBytes).toHaveLength(5);
  const preparedKinds = preparationBytes.map((bytes) => (JSON.parse(bytes) as { kind: string }).kind);
  expect(preparedKinds).toEqual(['motion.transform-waypoints.translate', 'motion.transform-waypoints.translate',
    'motion.keyframe-group-time.set', 'motion.keyframe-group-easing.set', 'motion.settled-hold.set']);
  expect(preparationBytes.every((bytes) => !/expectedTransform|targetSnapshots|replacementTrackIds|"targets"/.test(bytes))).toBe(true);
  await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  const editedInventory = await readInteractiveInventory();
  expect(editedInventory.controls).toEqual([0, 840, 1820, 2100]);
  expect(editedInventory.handles.map((handle) => handle.timeMs)).toEqual([0, 840, 1820, 2100]);
  expect(editedInventory.handles.map((handle) => handle.keyframeId).every(Boolean)).toBe(true);
  expect(new Set(editedInventory.handles.map((handle) => handle.keyframeId)).size).toBe(4);
  const editedTarget1 = await readSpatialProof(1, 4);
  await primaryInputs.nth(0).check();
  const editedTarget0 = await readSpatialProof(0, 4);
  const atomicSwitchBaseline = await page.evaluate(() => { const inspected = window.__motionEditor.inspectShotWorkspace() as unknown as {
    geometryPump: { lastCommittedRequestId: number }; geometry: Array<{ deltasDevicePixels: Record<string, number> }> };
    const handles = [...document.querySelectorAll<HTMLElement>('[data-trajectory-overlay] [data-keyframe-id]')];
    const retained = new Map(handles.map((handle) => [handle.dataset.keyframeId!, handle]));
    (window as unknown as { __atomicSwitchNodes: Map<string, HTMLElement> }).__atomicSwitchNodes = retained;
    const frames = { frameCount: 0, busyFrames: 0, identityGaps: 0, stopAfter: null as number | null,
      resolve: null as null | ((value: unknown) => void) };
    (window as unknown as { __atomicSwitchFrames: typeof frames }).__atomicSwitchFrames = frames;
    const tick = () => { const current = [...document.querySelectorAll<HTMLElement>('[data-trajectory-overlay] [data-keyframe-id]')];
      frames.frameCount += 1; if (document.querySelector('[data-trajectory-overlay]')?.getAttribute('aria-busy') !== 'false') frames.busyFrames += 1;
      if (current.length !== handles.length || current.some((handle) => (retained.has(handle.dataset.keyframeId!)
        && retained.get(handle.dataset.keyframeId!) !== handle) || !handle.isConnected)) frames.identityGaps += 1;
      if (frames.stopAfter !== null && --frames.stopAfter === 0) { frames.resolve?.({ ...frames, stopAfter: undefined, resolve: undefined }); return; }
      requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
    return { requestId: inspected.geometryPump.lastCommittedRequestId, keys: handles.map((handle) => handle.dataset.keyframeId) };
  });
  await primaryInputs.nth(1).check();
  const editedSpatialTargets = [editedTarget0, editedTarget1];
  for (const target of editedSpatialTargets) {
    expect(target.samples.map((sample) => sample.timeMs)).toEqual([0, 840, 1820, 2100]);
    expect(target.samples.every((sample) => Object.values(sample.deltasDevicePixels).every((delta) => delta <= 1))).toBe(true);
  }
  await expect.poll(() => page.evaluate(({ requestId, keys }) => { const inspected = window.__motionEditor.inspectShotWorkspace() as unknown as {
    geometryPump: { running: boolean; activeSamplers: number; latestRequestId: number; pendingRequestId: number | null;
      lastCommittedRequestId: number }; geometry: Array<{ deltasDevicePixels: Record<string, number> }> };
    const handles = [...document.querySelectorAll<HTMLElement>('[data-trajectory-overlay] [data-keyframe-id]')];
    const retained = (window as unknown as { __atomicSwitchNodes: Map<string, HTMLElement> }).__atomicSwitchNodes;
    return inspected.geometryPump.lastCommittedRequestId > requestId
      && inspected.geometryPump.latestRequestId === inspected.geometryPump.lastCommittedRequestId
      && !inspected.geometryPump.running && inspected.geometryPump.activeSamplers === 0 && inspected.geometryPump.pendingRequestId === null
      && document.querySelector('[data-trajectory-overlay]')?.getAttribute('aria-busy') === 'false'
      && inspected.geometry.length === 4 && inspected.geometry.every((sample) => Object.values(sample.deltasDevicePixels).every((delta) => delta <= 1))
      && JSON.stringify(handles.map((handle) => Number(handle.dataset.timeMs))) === JSON.stringify([0, 840, 1820, 2100])
      && new Set(handles.map((handle) => handle.dataset.keyframeId)).size === keys.length
      && handles.every((handle) => (!retained.has(handle.dataset.keyframeId!) || retained.get(handle.dataset.keyframeId!) === handle) && handle.isConnected);
  }, atomicSwitchBaseline)).toBe(true);
  const atomicSwitchFrames = await page.evaluate(() => new Promise<{ frameCount: number; busyFrames: number; identityGaps: number }>((resolve) => {
    const frames = (window as unknown as { __atomicSwitchFrames: { stopAfter: number | null; resolve: ((value: unknown) => void) | null } }).__atomicSwitchFrames;
    frames.stopAfter = 2; frames.resolve = (value) => resolve(value as { frameCount: number; busyFrames: number; identityGaps: number });
  }));
  expect(atomicSwitchFrames.frameCount).toBeGreaterThan(0); expect(atomicSwitchFrames).toMatchObject({ busyFrames: 0, identityGaps: 0 });
  await page.locator('[data-scrub]').fill('837');
  await page.locator('[data-scrub]').fill('838');
  const readRaceState = () => page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    const inspected = window.__motionEditor.inspectShotWorkspace(); const state = window.__motionEditor.readState(); const animations = frame.contentDocument!.getAnimations();
    return { sliderValueMs: Number((document.querySelector('[data-scrub]') as HTMLInputElement).value), playheadMs: state.playheadMs,
      controllerCurrentTimesMs: state.currentTimes, nativeCurrentTimesMs: animations.map((animation) => animation.currentTime),
      playStates: animations.map((animation) => animation.playState), geometryCount: inspected.geometry.length,
      geometryDeltas: inspected.geometry.map((sample) => sample.deltasDevicePixels), status: (document.querySelector('[data-shot-status]') as HTMLOutputElement).value,
      geometryPump: (inspected as unknown as { geometryPump: { running: boolean; activeSamplers: number; maximumActiveSamplers: number;
        latestRequestId: number | null; pendingRequestId: number | null; lastCommittedRequestId: number | null } }).geometryPump,
      nativeTypes: animations.map((animation) => ({ animation: animation.constructor.name, effect: animation.effect?.constructor.name,
        timeline: animation.timeline?.constructor.name })) }; });
  const immediateRaceState = await page.locator('[data-scrub]').evaluate((input: HTMLInputElement) => {
    const capture = () => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      const captured = window.__motionEditor.inspectShotWorkspace(); const state = window.__motionEditor.readState();
      const animations = frame.contentDocument!.getAnimations(); return { sliderValueMs: Number(input.value), playheadMs: state.playheadMs,
        controllerCurrentTimesMs: state.currentTimes, nativeCurrentTimesMs: animations.map((animation) => animation.currentTime),
        playStates: animations.map((animation) => animation.playState), geometryCount: captured.geometry.length,
        geometryDeltas: captured.geometry.map((sample) => sample.deltasDevicePixels),
        status: (document.querySelector('[data-shot-status]') as HTMLOutputElement).value,
        geometryPump: (captured as unknown as { geometryPump: { running: boolean; activeSamplers: number; maximumActiveSamplers: number;
          latestRequestId: number | null; pendingRequestId: number | null; lastCommittedRequestId: number | null } }).geometryPump,
        nativeTypes: animations.map((animation) => ({ animation: animation.constructor.name,
          effect: animation.effect?.constructor.name, timeline: animation.timeline?.constructor.name })) }; };
    let immediate: ReturnType<typeof capture> | null = null;
    input.addEventListener('input', () => { immediate = capture(); }, { once: true });
    input.value = '839'; input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: '839' }));
    if (!immediate) throw new Error('IMMEDIATE_SAME_DISPATCH_CAPTURE_MISSING');
    return immediate as unknown as ReturnType<typeof capture>;
  });
  expect(immediateRaceState).toMatchObject({ sliderValueMs: 839, playheadMs: 839 });
  expect(immediateRaceState.controllerCurrentTimesMs.every((time) => time === 839)).toBe(true);
  expect(immediateRaceState.nativeCurrentTimesMs.every((time) => time === 839)).toBe(true);
  expect(immediateRaceState.playStates.every((state) => state === 'paused')).toBe(true);
  await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  const settledRaceState = await readRaceState();
  expect(settledRaceState).toMatchObject({ sliderValueMs: 839, playheadMs: 839, geometryCount: 4 });
  expect(settledRaceState.controllerCurrentTimesMs.every((time) => time === 839)).toBe(true);
  expect(settledRaceState.nativeCurrentTimesMs.every((time) => time === 839)).toBe(true);
  expect(settledRaceState.playStates.every((state) => state === 'paused')).toBe(true);
  expect(settledRaceState.geometryDeltas.every((deltas) => Object.values(deltas).every((delta) => delta <= 1))).toBe(true);
  expect(settledRaceState.nativeTypes.every((native) => native.animation === 'CSSAnimation' && native.effect === 'KeyframeEffect'
    && native.timeline === 'DocumentTimeline')).toBe(true);
  expect(settledRaceState.geometryPump).toMatchObject({ running: false, activeSamplers: 0, maximumActiveSamplers: 1,
    pendingRequestId: null, lastCommittedRequestId: settledRaceState.geometryPump.latestRequestId });
  expect(settledRaceState.status).not.toContain('PREVIEW_');
  const committedIdentity = settledRaceState.geometryPump;
  const intermediateAlignmentBaseline = { revision: (await page.evaluate(() => window.__motionEditor.inspectAuthoring())).revision,
    commandCount: commandBytes.length };
  await page.locator('input[name="shot-moment"][value="1820"]').check();
  expect(await readMomentAlignment()).toMatchObject({ authoring: { revision: intermediateAlignmentBaseline.revision },
    native: { playheadMs: 1820, currentTimes: [1820, 1820], playStates: ['paused', 'paused'] },
    slider: 1820, visibleTime: '1820 ms', selectedMoment: 1820 });
  expect(commandBytes).toHaveLength(intermediateAlignmentBaseline.commandCount);
  const momentOnlyState = await readRaceState();
  expect(momentOnlyState.geometryPump).toEqual(committedIdentity);
  expect(momentOnlyState.geometryCount).toBe(4);
  const durableSnapshots = await Promise.all(Array.from({ length: 6 }, async (_, revision) => {
    const immutable = await new MotionServiceClient(serviceUrl, (...args) => fetch(...args),
      { actor: 'human', capability: humanCapability }).revision(seed.documentId, revision);
    const native = compileMotionDocument(immutable.document);
    return { contentDigest: sha256Hex(canonicalContentBytes(immutable.document)), exportDigest: native.exportDigest, compiledHtml: native.html };
  }));
  for (const sample of [839, 840, 841, 1819, 1820, 1821, 2099, 2100, 2101]) {
    await page.locator('[data-scrub]').fill(String(sample));
    const native = await page.evaluate((requestedTime) => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      const animations = frame.contentDocument!.getAnimations(); const state = window.__motionEditor.readState();
      return frame.srcdoc === window.__motionEditor.compiledHtml && state.playheadMs === requestedTime
        && animations.length > 0 && animations.every((animation) => animation.constructor.name === 'CSSAnimation'
          && animation.currentTime === requestedTime && animation.playState === 'paused')
        && state.currentTimes.every((time) => time === requestedTime); }, sample);
    expect(native).toBe(true);
    expect((await readRaceState()).geometryPump).toEqual(committedIdentity);
  }
  await page.locator('input[name="shot-moment"][value="840"]').check();
  expect(await readMomentAlignment()).toMatchObject({ authoring: { revision: 5 }, native: { playheadMs: 840, currentTimes: [840, 840],
    playStates: ['paused', 'paused'] }, slider: 840, visibleTime: '840 ms', selectedMoment: 840 });
  expect((await readRaceState()).geometryPump).toEqual(committedIdentity);
  const assertDurableHistoryAction = async (kind: 'motion.history.undo' | 'motion.history.redo', revision: number, restoredRevision: number) => {
    const requestCount = commandBytes.length;
    const previousGeometryRequestId = await page.evaluate(() => (window.__motionEditor.inspectShotWorkspace() as unknown as {
      geometryPump: { lastCommittedRequestId: number } }).geometryPump.lastCommittedRequestId);
    await page.locator(kind === 'motion.history.undo' ? '[data-undo]' : '[data-redo]').click();
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(revision);
    expect(commandBytes).toHaveLength(requestCount + 1);
    const wire = JSON.parse(commandBytes.at(-1)!) as { expectedRevision: number; command: { kind: string; expectedRevision: number } };
    expect(wire.expectedRevision).toBe(revision - 1); expect(wire.command.expectedRevision).toBe(revision - 1); expect(wire.command.kind).toBe(kind);
    await expect.poll(() => page.evaluate(({ kind, revision }) => {
      const authoring = window.__motionEditor.inspectAuthoring();
      const inspected = window.__motionEditor.inspectShotWorkspace() as unknown as {
        revision: number; previewMatchesCompiler: boolean; activeDraft: unknown;
        compilerDraft: { active: boolean }; waypointReleasePhase: string;
        geometryPump: { running: boolean; activeSamplers: number; latestRequestId: number | null;
          pendingRequestId: number | null; lastCommittedRequestId: number | null };
      };
      const operationStatus = document.querySelector<HTMLOutputElement>('[data-operation-status]')!;
      return {
        operation: { kind: operationStatus.dataset.kind, value: operationStatus.value },
        authoringRevision: authoring.revision,
        workspaceRevision: inspected.revision,
        previewMatchesCompiler: inspected.previewMatchesCompiler,
        activeDraft: inspected.activeDraft,
        compilerDraftActive: inspected.compilerDraft.active,
        releasePhase: inspected.waypointReleasePhase,
        overlayBusy: document.querySelector('[data-trajectory-overlay]')?.getAttribute('aria-busy'),
        geometryPump: { running: inspected.geometryPump.running, activeSamplers: inspected.geometryPump.activeSamplers,
          pendingRequestId: inspected.geometryPump.pendingRequestId,
          current: inspected.geometryPump.latestRequestId !== null
            && inspected.geometryPump.latestRequestId === inspected.geometryPump.lastCommittedRequestId },
      };
    }, { kind, revision })).toEqual({
      operation: { kind: 'success', value: kind === 'motion.history.undo'
        ? `Undid the last change. Revision ${revision}.` : `Redid the change. Revision ${revision}.` },
      authoringRevision: revision,
      workspaceRevision: revision,
      previewMatchesCompiler: true,
      activeDraft: null,
      compilerDraftActive: false,
      releasePhase: 'idle',
      overlayBusy: 'false',
      geometryPump: { running: false, activeSamplers: 0, pendingRequestId: null, current: true },
    });
    const restored = await page.evaluate(() => window.__motionEditor.inspectAuthoring()); const expected = durableSnapshots[restoredRevision]!;
    expect(restored).toMatchObject({ revision, contentDigest: expected.contentDigest, exportDigest: expected.exportDigest, compiledHtml: expected.compiledHtml });
    const preview = await page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      const animations = frame.contentDocument!.getAnimations(); return { srcdoc: frame.srcdoc, compilerHtml: window.__motionEditor.compiledHtml,
        native: animations.length > 0 && animations.every((animation) => animation.constructor.name === 'CSSAnimation') }; });
    expect(preview).toEqual({ srcdoc: expected.compiledHtml, compilerHtml: expected.compiledHtml, native: true });
    const controls = await page.evaluate(() => ({ landing: Number((document.querySelector('input[name="shot-moment"]:checked') as HTMLInputElement).value),
      settled: Number((document.querySelector('[data-shot-settled]') as HTMLInputElement).value),
      easing: (document.querySelector('[data-shot-easing]') as HTMLSelectElement).value,
      moments: [...document.querySelectorAll<HTMLInputElement>('input[name="shot-moment"]')].map((input) => Number(input.value)) }));
    if (restoredRevision <= 2) expect(controls).toMatchObject({ landing: 700, settled: 1820, easing: 'custom', moments: [0, 700, 2100] });
    if (restoredRevision === 3) expect(controls).toMatchObject({ landing: 840, settled: 1820, easing: 'custom', moments: [0, 840, 2100] });
    if (restoredRevision === 4) expect(controls).toMatchObject({ landing: 840, settled: 1820, easing: 'ease-in-out', moments: [0, 840, 2100] });
    if (restoredRevision === 5) expect(controls).toMatchObject({ landing: 840, settled: 1820, easing: 'ease-in-out', moments: [0, 840, 1820, 2100] });
    const expectedMoment = restoredRevision <= 2 ? 700 : 840;
    await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
    expect(await readMomentAlignment()).toMatchObject({ authoring: { revision }, native: { playheadMs: expectedMoment,
      currentTimes: [expectedMoment, expectedMoment], playStates: ['paused', 'paused'] }, slider: expectedMoment,
      visibleTime: `${expectedMoment} ms`, selectedMoment: expectedMoment });
    expect(await page.evaluate(() => (window.__motionEditor.inspectShotWorkspace() as unknown as {
      geometryPump: { lastCommittedRequestId: number } }).geometryPump.lastCommittedRequestId)).toBeGreaterThan(previousGeometryRequestId);
  };
  for (let revision = 6; revision <= 10; revision += 1) await assertDurableHistoryAction('motion.history.undo', revision, 10 - revision);
  const undone = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(undone.contentDigest).toBe(original.contentDigest);
  await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  expect(await readInteractiveInventory()).toMatchObject({ controls: [0, 700, 2100],
    handles: [{ timeMs: 0 }, { timeMs: 700 }, { timeMs: 2100 }] });
  for (let revision = 11; revision <= 15; revision += 1) await assertDurableHistoryAction('motion.history.redo', revision, revision - 10);
  expect(commandBytes).toHaveLength(15);
  const redone = await page.evaluate(() => window.__motionEditor.inspectAuthoring()); expect(redone.contentDigest).toBe(edited.contentDigest); expect(redone.exportDigest).toBe(edited.exportDigest);
  await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  expect(await readInteractiveInventory()).toMatchObject({ controls: [0, 840, 1820, 2100],
    handles: [{ timeMs: 0 }, { timeMs: 840 }, { timeMs: 1820 }, { timeMs: 2100 }] });
  expect(await page.evaluate(() => window.__motionEditor.inspectShotWorkspace())).toMatchObject({ open: true, mode: 'path', previewMatchesCompiler: true });
  const sanitizeRaceState = ({ geometryPump, ...state }: typeof settledRaceState) => ({ ...state,
    geometryPump: { running: geometryPump.running, activeSamplers: geometryPump.activeSamplers,
      maximumActiveSamplers: geometryPump.maximumActiveSamplers, pending: geometryPump.pendingRequestId !== null,
      latestCommitted: geometryPump.lastCommittedRequestId === geometryPump.latestRequestId } });
  const controlledReceipt = { schemaVersion: 'motion.shot1-spatial-parity.v1', environment: 'controlled-chromium', passed: true,
    viewport: { width: 1183, height: 900, devicePixelRatio: await page.evaluate(() => devicePixelRatio) },
    reviewOracle: { timesMs: [0, 700, 2100], combinations: 6, targets: spatialTargets },
    editedWaypointInventory: { timesMs: [0, 840, 1820, 2100], combinations: 8, targets: editedSpatialTargets },
    focusedUx: { controlsNativeTransportTogether: true, genericWorkflowAbsent: true, branchControlsAbsent: true, offFrameRunway: runway },
    smoothDrag: { stableDocumentDuringDraft: cancelledDraft.stableDocument, iframeLoadsDuringDraft: cancelledDraft.loadCount,
      pointerMoveCount: cancelledDraft.workspace.activeDraft.moveCount, compilerDraftApplicationCount: cancelledDraft.workspace.activeDraft.appliedCount,
      exactLatestFlushed: true, terminalHandleRetainedUntilCommit: terminalRelease.handleTranslate !== '',
      noOldLocationReleaseFrame: JSON.stringify(terminalRelease.bounds) !== JSON.stringify(draftBaseline.bounds), committedIframeLoads: postRelease.loadCount,
      cssCommitPromoted: postRelease.promotion.promoted, navigationSourceSeparated: !postRelease.navigationSourceEqual,
      committedCompilerEqual: postRelease.compilerEqual },
    paintContinuity: { everyFrameObserved: paintedFrames.frameCount > 2 && paintedFrames.releaseFrameCount > 0,
      everyFrameNativeExact: paintedFrames.nativeStateViolations === 0, stableDocumentAndStyle: paintedFrames.documentChanges === 0 && paintedFrames.styleChanges === 0,
      noOldLocationReleaseFrame: paintedFrames.oldLocationReleaseFrames === 0,
      retainedHandleIdentity: paintedFrames.handleIdentityGaps === 0 && paintedFrames.handleOrderGaps === 0,
      activeAndTerminalContinuous: paintedFrames.activeHandleGaps === 0 && paintedFrames.terminalFeedbackGaps === 0,
      atomicSwitchRequestSettled: true, atomicSwitchNoPaintedBusy: atomicSwitchFrames.busyFrames === 0,
      atomicSwitchRetainedNodes: atomicSwitchFrames.identityGaps === 0 },
    pointer: { deltaClientCssPixels: offFrameDelta, emitted: { deltaXPpm: releasedDraft.operation.payload.deltaXPpm,
      deltaYPpm: releasedDraft.operation.payload.deltaYPpm }, stage: releasedDraft.operation.payload.stage },
    history: { operationCount: 5, undoCount: 5, redoCount: 5, exactUndo: undone.contentDigest === original.contentDigest,
      exactRedo: redone.contentDigest === edited.contentDigest }, race: { requestedTimeMs: 839,
      immediate: sanitizeRaceState(immediateRaceState), settled: sanitizeRaceState(settledRaceState) },
    compiler: { previewMatchesCompiler: true, exportDigest: edited.exportDigest } };
  await writeFile(join(directory, 'controlled-spatial-parity.json'), `${JSON.stringify(controlledReceipt, null, 2)}\n`);
  return { ...context, edited, preparedKinds, editedInventory, editedTarget1, editedTarget0, atomicSwitchBaseline, editedSpatialTargets, atomicSwitchFrames, readRaceState, immediateRaceState, settledRaceState, committedIdentity, intermediateAlignmentBaseline, momentOnlyState, durableSnapshots, assertDurableHistoryAction, undone, redone, sanitizeRaceState, controlledReceipt };
}
