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
import { runShotSetup } from './phase3-shot-setup.js';

export async function runShotGesture(context: Awaited<ReturnType<typeof runShotSetup>>) {
  const { page, directory, humanCapability, agentCapability, root, port, seed, targetElementIds, inheritedTargets, runtimeSeedPath, processHandle, addresses, editorUrl, serviceUrl, commandBytes, preparationBytes, commandStatuses, consoleErrors, workspace, layoutContract, readGeometry, closedGeometry, advancedMotion, objectInputs, primaryInputs, focusedLayout, beforePathAlignment, readMomentAlignment, awaitShotMutationSettlement, previewToolbar, referenceSegments, referenceWaypoints, referenceGeometryBeforeSwitch, canvasObjectTargets, selectedReferenceSegments, settledObjectBounds, finishedEndpointBaseline, finishedEndpointArrival, rejectedTimingBaseline, priorNativeTimeMs, readSpatialProof, spatialTargets, initialPrimaryCommitId, changedPrimaryCommitId, readInteractiveInventory, beforeResizeCommitId } = context;
  const original = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  const committedSrcdoc = await page.locator('[data-preview]').getAttribute('srcdoc');
  const landed = page.locator('[data-trajectory-overlay] [aria-pressed="true"]'); let box = await landed.boundingBox();
  if (!box || !committedSrcdoc) throw new Error('TRAJECTORY_HANDLE_MISSING');
  const activeHit = await page.evaluate(({ x, y }) => { const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    return { keyframeId: hit?.dataset.keyframeId, active: hit?.getAttribute('aria-pressed'), tagName: hit?.tagName,
      className: hit?.className, previewObjectId: hit?.dataset.previewObjectId, transformHandle: hit?.dataset.transformHandle }; },
  { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  if (activeHit.active !== 'true' || !activeHit.keyframeId) throw new Error(`ACTIVE_HIT_INVALID_${JSON.stringify(activeHit)}`);
  const armGestureProjectionProbe = async (point: { x: number; y: number }) => page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y); if (!target) throw new Error('GESTURE_POINTER_TARGET_MISSING');
    const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    const overlay = document.querySelector<HTMLElement>('[data-trajectory-overlay]')!;
    const frameOwnMethod = Object.getOwnPropertyDescriptor(frame, 'getBoundingClientRect');
    const overlayOwnMethod = Object.getOwnPropertyDescriptor(overlay, 'getBoundingClientRect');
    const frameMethod = frame.getBoundingClientRect; const overlayMethod = overlay.getBoundingClientRect;
    const rectValue = (rect: DOMRect) => ({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom,
      width: rect.width, height: rect.height });
    const capture = { input: { sourceWidthCssPixels: 0, sourceHeightCssPixels: 0,
      iframeRect: null as ReturnType<typeof rectValue> | null, overlayRect: null as ReturnType<typeof rectValue> | null,
      devicePixelRatio: 0 }, start: { clientX: 0, clientY: 0 }, restored: false };
    Object.defineProperty(frame, 'getBoundingClientRect', { configurable: true, value: () => {
      const rect = frameMethod.call(frame); capture.input.iframeRect = rectValue(rect); return rect;
    } });
    Object.defineProperty(overlay, 'getBoundingClientRect', { configurable: true, value: () => {
      const rect = overlayMethod.call(overlay); capture.input.overlayRect = rectValue(rect); return rect;
    } });
    target.addEventListener('pointerdown', (event) => {
      const pointer = event as PointerEvent;
      const projection = window.__motionEditor.inspectShotWorkspace().projection!;
      capture.input.sourceWidthCssPixels = projection.sourceWidthCssPixels;
      capture.input.sourceHeightCssPixels = projection.sourceHeightCssPixels;
      capture.input.devicePixelRatio = window.devicePixelRatio;
      capture.start = { clientX: pointer.clientX, clientY: pointer.clientY };
      if (frameOwnMethod) Object.defineProperty(frame, 'getBoundingClientRect', frameOwnMethod);
      else delete (frame as unknown as { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect;
      if (overlayOwnMethod) Object.defineProperty(overlay, 'getBoundingClientRect', overlayOwnMethod);
      else delete (overlay as unknown as { getBoundingClientRect?: () => DOMRect }).getBoundingClientRect;
      capture.restored = frame.getBoundingClientRect === frameMethod && overlay.getBoundingClientRect === overlayMethod;
      (window as unknown as { __gestureProjectionCapture: typeof capture }).__gestureProjectionCapture = capture;
    }, { once: true });
  }, point);
  const takeGestureProjection = async () => {
    const capture = await page.evaluate(() => {
      const holder = window as unknown as { __gestureProjectionCapture?: {
        input: { sourceWidthCssPixels: number; sourceHeightCssPixels: number;
          iframeRect: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
          overlayRect: { left: number; top: number; right: number; bottom: number; width: number; height: number } | null;
          devicePixelRatio: number };
        start: { clientX: number; clientY: number }; restored: boolean } };
      const value = holder.__gestureProjectionCapture; delete holder.__gestureProjectionCapture; return value;
    });
    if (!capture?.input.iframeRect || !capture.input.overlayRect || !capture.restored) throw new Error('GESTURE_PROJECTION_CAPTURE_INVALID');
    const projection = createPreviewOverlayProjection({ ...capture.input,
      iframeRect: capture.input.iframeRect, overlayRect: capture.input.overlayRect });
    expect(projection.ok).toBe(true); if (!projection.ok) throw new Error(projection.code);
    return { projection: projection.projection, start: capture.start };
  };
  await page.locator('[data-scrub]').fill('700');
  await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  const draftBaseline = await page.evaluate((elementId) => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    const target = [...frame.contentDocument!.querySelectorAll<HTMLElement>('[data-motion-id]')].find((item) => item.dataset.motionId === elementId)!;
    const rect = target.getBoundingClientRect(); frame.dataset.draftLoadCount = '0'; frame.addEventListener('load', () => {
      frame.dataset.draftLoadCount = String(Number(frame.dataset.draftLoadCount) + 1); });
    (window as unknown as { __draftDocument: Document }).__draftDocument = frame.contentDocument!;
    return { bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }, native: window.__motionEditor.readState(),
      geometryRequestId: (window.__motionEditor.inspectShotWorkspace() as unknown as { geometryPump: { lastCommittedRequestId: number } }).geometryPump.lastCommittedRequestId };
  }, targetElementIds[0]);
  await page.evaluate(({ elementId, baselineBounds }) => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!; const frameDocument = frame.contentDocument!;
    const workspace = window.__motionEditor.inspectShotWorkspace() as unknown as { compilerCommit: { activeCompilerCss: string } };
    const compilerStyle = [...frameDocument.querySelectorAll('style')].find((style) => style.textContent === `\n${workspace.compilerCommit.activeCompilerCss}`)!;
    const handles = [...document.querySelectorAll<HTMLElement>('[data-trajectory-overlay] [data-keyframe-id]')];
    const keys = handles.map((handle) => handle.dataset.keyframeId!); const nodes = new Map(keys.map((key, index) => [key, handles[index]!]));
    const oracle = { frameCount: 0, releaseFrameCount: 0, documentChanges: 0, styleChanges: 0, nativeStateViolations: 0,
      oldLocationReleaseFrames: 0, handleIdentityGaps: 0, handleOrderGaps: 0, activeHandleGaps: 0, terminalFeedbackGaps: 0,
      stopAfter: null as number | null, resolve: null as null | ((value: unknown) => void) };
    (window as unknown as { __paintOracle: typeof oracle }).__paintOracle = oracle;
    const tick = () => {
      const inspected = window.__motionEditor.inspectShotWorkspace() as unknown as { waypointReleasePhase: string };
      const currentDocument = frame.contentDocument; const animations = currentDocument?.getAnimations() ?? [];
      const state = window.__motionEditor.readState(); const currentHandles = [...document.querySelectorAll<HTMLElement>('[data-trajectory-overlay] [data-keyframe-id]')];
      const currentKeys = currentHandles.map((handle) => handle.dataset.keyframeId!);
      const target = currentDocument && [...currentDocument.querySelectorAll<HTMLElement>('[data-motion-id]')]
        .find((item) => item.dataset.motionId === elementId); const rect = target?.getBoundingClientRect();
      const atOldLocation = rect ? JSON.stringify({ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }) === JSON.stringify(baselineBounds) : true;
      oracle.frameCount += 1;
      if (currentDocument !== frameDocument) oracle.documentChanges += 1;
      if (!compilerStyle.isConnected || compilerStyle.ownerDocument !== currentDocument) oracle.styleChanges += 1;
      if (animations.length === 0 || animations.some((animation, index) => animation.constructor.name !== 'CSSAnimation'
        || animation.effect?.constructor.name !== 'KeyframeEffect' || animation.timeline?.constructor.name !== 'DocumentTimeline'
        || animation.currentTime !== state.currentTimes[index] || animation.playState !== state.playStates[index])) oracle.nativeStateViolations += 1;
      if (JSON.stringify(currentKeys) !== JSON.stringify(keys)) oracle.handleOrderGaps += 1;
      if (currentHandles.some((handle) => nodes.get(handle.dataset.keyframeId!) !== handle || !handle.isConnected)) oracle.handleIdentityGaps += 1;
      if (currentHandles.filter((handle) => handle.getAttribute('aria-pressed') === 'true').length !== 1) oracle.activeHandleGaps += 1;
      if (inspected.waypointReleasePhase !== 'idle') {
        oracle.releaseFrameCount += 1; if (atOldLocation) oracle.oldLocationReleaseFrames += 1;
        const active = currentHandles.find((handle) => handle.getAttribute('aria-pressed') === 'true');
        if (!active || (atOldLocation && active.style.translate === '')) oracle.terminalFeedbackGaps += 1;
      }
      if (oracle.stopAfter !== null) {
        oracle.stopAfter -= 1;
        if (oracle.stopAfter === 0) { oracle.resolve?.({ ...oracle, stopAfter: undefined, resolve: undefined }); return; }
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }, { elementId: targetElementIds[0], baselineBounds: draftBaseline.bounds });

  await page.locator('[data-play]').click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.readState().playStates.every((playState) => playState === 'running'))).toBe(true);
  const cancelledPointerStart = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(cancelledPointerStart.x, cancelledPointerStart.y); await armGestureProjectionProbe(cancelledPointerStart); await page.mouse.down();
  const cancelledGestureProjection = await takeGestureProjection();
  expect(await readMomentAlignment()).toMatchObject({ authoring: { revision: 0 }, native: { playheadMs: 700, currentTimes: [700, 700],
    playStates: ['paused', 'paused'] }, slider: 700, visibleTime: '700 ms', selectedMoment: 700 });
  expect(commandBytes).toHaveLength(0);
  const cancelledPointerEnd = await page.evaluate(({ x, y }) => { let consumed = { clientX: x, clientY: y };
    for (let index = 1; index <= 24; index += 1) { const event = new PointerEvent('pointermove', {
      pointerId: 1, buttons: 1, clientX: x + index / 2, clientY: y - index / 3, bubbles: true });
      window.dispatchEvent(event); consumed = { clientX: event.clientX, clientY: event.clientY }; }
    return consumed; }, cancelledPointerStart);
  await expect.poll(() => page.evaluate(() => (window.__motionEditor.inspectShotWorkspace() as unknown as {
    activeDraft: { appliedCount: number } | null }).activeDraft?.appliedCount ?? 0)).toBeGreaterThan(0);
  const cancelledDraft = await page.evaluate((elementId) => { const workspace = window.__motionEditor.inspectShotWorkspace() as unknown as {
      activeDraft: { compiledHtml: string; moveCount: number; appliedCount: number; controllerDraft: { active: boolean; applicationCount: number };
        operation: { expectedRevision: number; payload: { deltaXPpm: number; deltaYPpm: number; stage: { widthMicrounits: number; heightMicrounits: number } } } };
      geometryPump: { lastCommittedRequestId: number } };
    const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!; return { workspace, srcdoc: frame.srcdoc,
      stableDocument: frame.contentDocument === (window as unknown as { __draftDocument: Document }).__draftDocument,
      loadCount: Number(frame.dataset.draftLoadCount), handleTranslate: (document.querySelector('[data-trajectory-overlay] [aria-pressed="true"]') as HTMLElement).style.translate,
      targetBounds: (() => { const target = [...frame.contentDocument!.querySelectorAll<HTMLElement>('[data-motion-id]')]
        .find((item) => item.dataset.motionId === elementId)!; const rect = target.getBoundingClientRect();
        return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; })(), nativeState: window.__motionEditor.readState(),
      native: frame.contentDocument!.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation'
        && animation.effect?.constructor.name === 'KeyframeEffect' && animation.timeline?.constructor.name === 'DocumentTimeline') }; }, targetElementIds[0]);
  expect(cancelledDraft.workspace.activeDraft.operation.expectedRevision).toBe(0);
  expect(cancelledDraft.workspace.activeDraft.operation.payload.stage).toMatchObject({ widthMicrounits: 800_000_000, heightMicrounits: 450_000_000 });
  expect(cancelledDraft.workspace.activeDraft.moveCount).toBeGreaterThan(10);
  expect(cancelledDraft.workspace.activeDraft.appliedCount).toBeLessThan(cancelledDraft.workspace.activeDraft.moveCount);
  const cancelledExpectedDelta = previewPointerDeltaToPpm(cancelledGestureProjection.projection,
    cancelledGestureProjection.start, cancelledPointerEnd);
  expect(cancelledDraft.workspace.activeDraft.operation.payload.deltaXPpm).toBe(cancelledExpectedDelta.deltaXPpm);
  expect(cancelledDraft.workspace.activeDraft.operation.payload.deltaYPpm).toBe(cancelledExpectedDelta.deltaYPpm);
  expect(cancelledDraft.workspace.activeDraft.controllerDraft.active).toBe(true);
  expect(cancelledDraft.workspace.geometryPump.lastCommittedRequestId).toBe(draftBaseline.geometryRequestId);
  expect(cancelledDraft.srcdoc).toBe(committedSrcdoc); expect(cancelledDraft.stableDocument).toBe(true); expect(cancelledDraft.loadCount).toBe(0);
  expect(cancelledDraft.handleTranslate).not.toBe(''); expect(cancelledDraft.targetBounds).not.toEqual(draftBaseline.bounds);
  expect(cancelledDraft.nativeState).toEqual(draftBaseline.native); expect(cancelledDraft.native).toBe(true); expect(commandBytes).toHaveLength(0);
  expect((await page.evaluate(() => window.__motionEditor.inspectAuthoring())).revision).toBe(0);
  await page.keyboard.press('Escape');
  await expect.poll(() => page.locator('[data-preview]').getAttribute('srcdoc')).toBe(committedSrcdoc);
  await expect.poll(() => page.evaluate(() => (window.__motionEditor.inspectShotWorkspace() as unknown as { activeDraft: unknown }).activeDraft)).toBeNull();
  await expect.poll(() => page.evaluate(() => (window.__motionEditor.inspectShotWorkspace() as unknown as {
    compilerDraft: { active: boolean } }).compilerDraft.active)).toBe(false);
  const cancelledRestoration = await page.evaluate((elementId) => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    const target = [...frame.contentDocument!.querySelectorAll<HTMLElement>('[data-motion-id]')].find((item) => item.dataset.motionId === elementId)!;
    const rect = target.getBoundingClientRect(); return {
      stableDocument: frame.contentDocument === (window as unknown as { __draftDocument: Document }).__draftDocument,
      loadCount: Number(frame.dataset.draftLoadCount), bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      nativeState: window.__motionEditor.readState() }; }, targetElementIds[0]);
  expect(cancelledRestoration).toEqual({ stableDocument: true, loadCount: 0, bounds: draftBaseline.bounds, nativeState: draftBaseline.native });
  expect(commandBytes).toHaveLength(0); expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject(original);

  box = await landed.boundingBox(); if (!box) throw new Error('TRAJECTORY_HANDLE_MISSING_AFTER_ESCAPE');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 7, box.y + box.height / 2 - 5);
  await expect.poll(() => page.evaluate(() => { const inspected = window.__motionEditor.inspectShotWorkspace() as unknown as {
    activeDraft: unknown; compilerDraft: { active: boolean } }; return Boolean(inspected.activeDraft) && inspected.compilerDraft.active; })).toBe(true);
  const pointerCancelDraft = await page.evaluate(() => { const inspected = window.__motionEditor.inspectShotWorkspace() as unknown as {
    activeDraft: unknown; compilerDraft: { active: boolean }; waypointReleasePhase: string }; return {
    activeDraft: Boolean(inspected.activeDraft), compilerDraft: inspected.compilerDraft.active, releasePhase: inspected.waypointReleasePhase,
    handleTranslate: (document.querySelector('[data-trajectory-overlay] [aria-pressed="true"]') as HTMLElement).style.translate,
  }; });
  expect(pointerCancelDraft).toMatchObject({ activeDraft: true, compilerDraft: true, releasePhase: 'idle' });
  expect(pointerCancelDraft.handleTranslate).not.toBe('');
  await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 })));
  await page.mouse.up();
  await expect.poll(() => page.locator('[data-preview]').getAttribute('srcdoc')).toBe(committedSrcdoc);
  await expect.poll(() => page.evaluate(() => { const inspected = window.__motionEditor.inspectShotWorkspace() as unknown as {
    activeDraft: unknown; compilerDraft: { active: boolean }; waypointReleasePhase: string }; return {
    activeDraft: inspected.activeDraft, compilerDraft: inspected.compilerDraft.active, releasePhase: inspected.waypointReleasePhase,
  }; })).toEqual({ activeDraft: null, compilerDraft: false, releasePhase: 'idle' });
  const pointerCancelRestoration = await page.evaluate((elementId) => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    const target = [...frame.contentDocument!.querySelectorAll<HTMLElement>('[data-motion-id]')].find((item) => item.dataset.motionId === elementId)!;
    const rect = target.getBoundingClientRect(); return {
      stableDocument: frame.contentDocument === (window as unknown as { __draftDocument: Document }).__draftDocument,
      loadCount: Number(frame.dataset.draftLoadCount), bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      nativeState: window.__motionEditor.readState(),
    }; }, targetElementIds[0]);
  expect(pointerCancelRestoration).toEqual({ stableDocument: true, loadCount: 0, bounds: draftBaseline.bounds, nativeState: draftBaseline.native });
  expect(commandBytes).toHaveLength(0); expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject(original);

  box = await canvasObjectTargets.nth(0).boundingBox(); if (!box) throw new Error('PREVIEW_OBJECT_TARGET_MISSING_AFTER_CANCEL');
  const iframeBox = await page.locator('[data-preview]').boundingBox(); if (!iframeBox) throw new Error('TRAJECTORY_FRAME_MISSING');
  const offFrameDelta = { x: iframeBox.x - 1 - (box.x + box.width / 2), y: -4 };
  const releasedPointerStart = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(releasedPointerStart.x, releasedPointerStart.y);
  await armGestureProjectionProbe(releasedPointerStart); await page.mouse.down();
  const releasedGestureProjection = await takeGestureProjection();
  await page.mouse.move(box.x + box.width / 2 + offFrameDelta.x / 2, box.y + box.height / 2 - 2);
  await page.evaluate(() => window.addEventListener('pointermove', (event) => {
    const pointer = event as PointerEvent;
    (window as unknown as { __releasedPointerEnd: { clientX: number; clientY: number } }).__releasedPointerEnd = {
      clientX: pointer.clientX, clientY: pointer.clientY };
  }, { once: true }));
  await page.mouse.move(box.x + box.width / 2 + offFrameDelta.x, box.y + box.height / 2 + offFrameDelta.y);
  const releasedPointerEnd = await page.evaluate(() => { const holder = window as unknown as {
    __releasedPointerEnd?: { clientX: number; clientY: number } }; const value = holder.__releasedPointerEnd;
    delete holder.__releasedPointerEnd; return value; });
  if (!releasedPointerEnd) throw new Error('RELEASED_POINTER_END_MISSING');
  const releasedDraft = await page.evaluate(() => (window.__motionEditor.inspectShotWorkspace() as unknown as { activeDraft: {
    commandBytes: string; operation: { expectedRevision: number; payload: { targets: Array<{ keyframeId: string }>; deltaXPpm: number; deltaYPpm: number;
      stage: { widthMicrounits: number; heightMicrounits: number } } } } }).activeDraft);
  expect(releasedDraft.operation.expectedRevision).toBe(0); expect(releasedDraft.operation.payload.targets[0]?.keyframeId).toBe(activeHit.keyframeId);
  const releasedExpectedDelta = previewPointerDeltaToPpm(releasedGestureProjection.projection,
    releasedGestureProjection.start, releasedPointerEnd);
  expect(releasedDraft.operation.payload.deltaXPpm).toBe(releasedExpectedDelta.deltaXPpm);
  expect(releasedDraft.operation.payload.deltaYPpm).toBe(releasedExpectedDelta.deltaYPpm);
  expect(Number.isSafeInteger(releasedDraft.operation.payload.deltaXPpm)).toBe(true); expect(Number.isSafeInteger(releasedDraft.operation.payload.deltaYPpm)).toBe(true);
  expect(Number.isSafeInteger(releasedDraft.operation.payload.stage.widthMicrounits * releasedDraft.operation.payload.deltaXPpm / 1_000_000)).toBe(true);
  expect(Number.isSafeInteger(releasedDraft.operation.payload.stage.heightMicrounits * releasedDraft.operation.payload.deltaYPpm / 1_000_000)).toBe(true);
  await page.evaluate((elementId) => { window.addEventListener('pointerup', () => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    const target = [...frame.contentDocument!.querySelectorAll<HTMLElement>('[data-motion-id]')].find((item) => item.dataset.motionId === elementId)!;
    const rect = target.getBoundingClientRect(); const handle = document.querySelector<HTMLElement>('[data-trajectory-overlay] [aria-pressed="true"]');
    (window as unknown as { __terminalRelease: unknown }).__terminalRelease = {
      stableDocument: frame.contentDocument === (window as unknown as { __draftDocument: Document }).__draftDocument,
      loadCount: Number(frame.dataset.draftLoadCount), handleTranslate: handle?.style.translate ?? '',
      bounds: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
      phase: (window.__motionEditor.inspectShotWorkspace() as unknown as { waypointReleasePhase: string }).waypointReleasePhase,
    };
  }, { once: true }); }, targetElementIds[0]);
  await page.mouse.up();
  const terminalRelease = await page.evaluate(() => (window as unknown as { __terminalRelease: unknown }).__terminalRelease) as {
    stableDocument: boolean; loadCount: number; handleTranslate: string; bounds: typeof draftBaseline.bounds; phase: string };
  expect(terminalRelease).toMatchObject({ stableDocument: true, loadCount: 0 }); expect(terminalRelease.phase).not.toBe('idle');
  expect(terminalRelease.handleTranslate).not.toBe(''); expect(terminalRelease.bounds).not.toEqual(draftBaseline.bounds);
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
  await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  const remountedCommitId = await page.evaluate(() => (window.__motionEditor.inspectShotWorkspace() as unknown as {
    geometryPump: { lastCommittedRequestId: number | null } }).geometryPump.lastCommittedRequestId);
  expect(remountedCommitId).toBeGreaterThan(changedPrimaryCommitId!);
  expect(commandBytes).toHaveLength(1); expect(commandBytes[0]).not.toBe(releasedDraft.commandBytes);
  const releasedWire = JSON.parse(commandBytes[0]!) as { command: { schemaVersion: string; kind: string;
    intent: { kind: string; elementIds: string[]; momentMs: number; deltaXPpm: number; deltaYPpm: number;
      viewport: { widthCssPixels: number; heightCssPixels: number } } } };
  expect(releasedWire.command).toMatchObject({ schemaVersion: 'motion.operation-intent.v1', kind: 'motion.transform-waypoints.translate',
    intent: { kind: 'motion.transform-waypoints.translate', elementIds: [targetElementIds[0]], momentMs: 700,
      deltaXPpm: releasedDraft.operation.payload.deltaXPpm, deltaYPpm: releasedDraft.operation.payload.deltaYPpm,
      viewport: { widthCssPixels: 800, heightCssPixels: 450 } } });
  expect(commandBytes[0]).not.toMatch(/expectedTransform|targetSnapshots|replacementTrackIds|targets/);
  expect(await page.evaluate(() => (window.__motionEditor.inspectShotWorkspace() as unknown as { activeDraft: unknown }).activeDraft)).toBeNull();
  const postRelease = await page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    const authoring = window.__motionEditor.inspectAuthoring(); const workspace = window.__motionEditor.inspectShotWorkspace(); return { loadCount: Number(frame.dataset.draftLoadCount),
      remountedDocument: frame.contentDocument !== (window as unknown as { __draftDocument: Document }).__draftDocument,
      compilerEqual: workspace.previewMatchesCompiler, navigationSourceEqual: workspace.previewNavigationSourceMatchesCompiler,
      promotion: workspace.lastPreviewCommitPromotion, releasePhase: workspace.waypointReleasePhase,
      undoCount: authoring.undoCount, redoCount: authoring.redoCount,
      selectedPrimary: (document.querySelector('[data-shot-targets] input[name="shot-primary"]:checked') as HTMLInputElement).value,
      status: document.querySelector<HTMLOutputElement>('[data-shot-status]')!.value };
  });
  expect(postRelease).toMatchObject({ loadCount: 0, remountedDocument: false, compilerEqual: true, navigationSourceEqual: false,
    promotion: { schemaVersion: 'motion.preview-css-commit-promotion.v1', attempted: true, promoted: true, fallbackCode: null },
    releasePhase: 'idle', undoCount: 1, redoCount: 0, selectedPrimary: targetElementIds[0] });
  expect(postRelease.status).toBe('Object 1 · Point 1 ready.');
  const paintedFrames = await page.evaluate(() => new Promise<{ frameCount: number; releaseFrameCount: number; documentChanges: number;
    styleChanges: number; nativeStateViolations: number; oldLocationReleaseFrames: number; handleIdentityGaps: number;
    handleOrderGaps: number; activeHandleGaps: number; terminalFeedbackGaps: number }>((resolve) => {
    const oracle = (window as unknown as { __paintOracle: { stopAfter: number | null; resolve: ((value: unknown) => void) | null } }).__paintOracle;
    oracle.stopAfter = 2; oracle.resolve = (value) => resolve(value as { frameCount: number; releaseFrameCount: number; documentChanges: number;
      styleChanges: number; nativeStateViolations: number; oldLocationReleaseFrames: number; handleIdentityGaps: number;
      handleOrderGaps: number; activeHandleGaps: number; terminalFeedbackGaps: number });
  }));
  expect(paintedFrames.frameCount).toBeGreaterThan(2); expect(paintedFrames.releaseFrameCount).toBeGreaterThan(0);
  expect(paintedFrames).toMatchObject({ documentChanges: 0, styleChanges: 0, nativeStateViolations: 0,
    oldLocationReleaseFrames: 0, handleIdentityGaps: 0, handleOrderGaps: 0, activeHandleGaps: 0, terminalFeedbackGaps: 0 });
  const runway = await landed.evaluate((handle) => { const frameRect = document.querySelector<HTMLIFrameElement>('[data-preview]')!.getBoundingClientRect();
    const stageRect = document.querySelector<HTMLElement>('.preview-stage')!.getBoundingClientRect(); const handleRect = handle.getBoundingClientRect();
    const center = { x: (handleRect.left + handleRect.right) / 2, y: (handleRect.top + handleRect.bottom) / 2 };
    return { partial: handleRect.left < frameRect.left && handleRect.right > frameRect.left,
      whollyVisible: handleRect.left >= stageRect.left && handleRect.right <= stageRect.right && handleRect.top >= stageRect.top && handleRect.bottom <= stageRect.bottom,
      hitTestable: document.elementFromPoint(center.x, center.y) === handle };
  });
  expect(runway).toEqual({ partial: true, whollyVisible: true, hitTestable: true });
  await page.locator('[data-move-together]').check();
  await expect(page.getByRole('checkbox', { name: /Edit together/ })).toBeChecked();
  await expect(workspace.locator('.move-together small')).toHaveText('Position changes apply to both selected objects.');
  await expect(workspace.locator('[data-shot-guidance]')).toContainText('Object movement translates both objects together.');
  await expect(page.locator('[data-reference-segment][data-selected="true"]')).toHaveCount(4);
  await expect(page.locator('[data-reference-waypoint][data-selected="true"]')).toHaveCount(6);
  await expect(page.locator('[data-shot-targets] input[type="checkbox"]')).toHaveCount(0);
  expect((await page.evaluate(() => window.__motionEditor.inspectShotWorkspace())).selectedElementIds).toEqual(targetElementIds);
  const revisionOne = await new MotionServiceClient(serviceUrl, (...args) => fetch(...args),
    { actor: 'human', capability: humanCapability }).revision(seed.documentId, 1);
  const currentGroup = projectTrajectorySelection(revisionOne.document, targetElementIds, 700);
  expect(currentGroup.eligible).toBe(true); if (!currentGroup.eligible) throw new Error(currentGroup.code ?? 'TRAJECTORY_SELECTION_INVALID');
  await workspace.getByRole('button', { name: 'Advanced motion controls' }).click();
  if (await page.locator('[data-shot-advanced-drawer] > details').first().getAttribute('open') === null) {
    await page.locator('[data-shot-advanced-drawer] > details').first().locator('summary').click();
  }
  const x = page.locator('[data-pose-form] input[name="x"]'); await x.fill(String(Number(await x.inputValue()) + 8));
  const failedPublicationBaseline = await page.evaluate(() => ({
    revision: window.__motionEditor.inspectAuthoring().revision,
    compiler: window.__motionEditor.compiledHtml,
    selectedMoment: Number((document.querySelector('input[name="shot-moment"]:checked') as HTMLInputElement).value),
    native: document.querySelector<HTMLIFrameElement>('[data-preview]')!.contentDocument!.getAnimations().map((animation) => ({
      currentTime: animation.currentTime, playState: animation.playState,
      animation: animation.constructor.name, effect: animation.effect?.constructor.name,
    })),
  }));
  const failedPublicationGeometry = await readGeometry();
  await expect(page.locator('[data-shot-advanced-drawer]')).toBeVisible();
  await page.evaluate(() => window.__motionEditor.failNextPublication());
  await page.getByRole('button', { name: 'Apply pose' }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().publicationState)).toBe('failed');
  await expect.poll(() => page.locator('[data-shot-status]').evaluate((output) => (output as HTMLOutputElement).value))
    .toBe('Pose could not be published. Your previous motion is still active.');
  await expect.poll(() => page.locator('[data-service-diagnostic]').evaluate((output) => (output as HTMLOutputElement).value))
    .toBe('PUBLICATION_FAILED · storage · retryable');
  expect(await page.evaluate(() => ({
    revision: window.__motionEditor.inspectAuthoring().revision,
    previewMatchesCompiler: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc === window.__motionEditor.compiledHtml,
    compiler: window.__motionEditor.compiledHtml,
    selectedMoment: Number((document.querySelector('input[name="shot-moment"]:checked') as HTMLInputElement).value),
    native: document.querySelector<HTMLIFrameElement>('[data-preview]')!.contentDocument!.getAnimations().map((animation) => ({
      currentTime: animation.currentTime, playState: animation.playState,
      animation: animation.constructor.name, effect: animation.effect?.constructor.name,
    })),
  }))).toEqual({ ...failedPublicationBaseline, previewMatchesCompiler: true });
  expect(await readGeometry()).toEqual(failedPublicationGeometry);
  expect(await page.evaluate(() => window.__motionEditor.retryPublication())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().publicationState)).toBe('settled');
  expect(await page.evaluate(() => ({
    revision: window.__motionEditor.inspectAuthoring().revision,
    previewMatchesCompiler: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc === window.__motionEditor.compiledHtml,
    selectedMoment: Number((document.querySelector('input[name="shot-moment"]:checked') as HTMLInputElement).value),
  }))).toEqual({ revision: 2, previewMatchesCompiler: true, selectedMoment: failedPublicationBaseline.selectedMoment });
  expect(await readGeometry()).toEqual(failedPublicationGeometry);
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(2);
  await awaitShotMutationSettlement(2, 700);
  await page.keyboard.press('Escape');
  expect(commandBytes).toHaveLength(2);
  const groupedCommand = JSON.parse(commandBytes[1]!) as { expectedRevision: number; command: { schemaVersion: string; kind: string;
    expectedRevision: number; intent: { elementIds: string[] } } };
  expect(groupedCommand.expectedRevision).toBe(1); expect(groupedCommand.command.expectedRevision).toBe(1);
  expect(groupedCommand.command).toMatchObject({ schemaVersion: 'motion.operation-intent.v1', kind: 'motion.transform-waypoints.translate',
    intent: { elementIds: targetElementIds } });
  expect(commandBytes[1]).not.toMatch(/expectedTransform|targetSnapshots|replacementTrackIds|targets/);
  const retimeGeometryRequestId = await page.evaluate(() => (window.__motionEditor.inspectShotWorkspace() as unknown as {
    geometryPump: { lastCommittedRequestId: number } }).geometryPump.lastCommittedRequestId);
  await page.locator('[data-shot-moment-time]').fill('840');
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(3);
  await awaitShotMutationSettlement(3, 840);
  expect(await readMomentAlignment()).toMatchObject({ authoring: { revision: 3 }, native: { playheadMs: 840, currentTimes: [840, 840],
    playStates: ['paused', 'paused'] }, slider: 840, visibleTime: '840 ms', selectedMoment: 840 });
  expect(commandBytes).toHaveLength(3);
  expect(await page.evaluate(() => (window.__motionEditor.inspectShotWorkspace() as unknown as {
    geometryPump: { lastCommittedRequestId: number } }).geometryPump.lastCommittedRequestId)).toBeGreaterThan(retimeGeometryRequestId);
  await page.locator('[data-shot-easing]').selectOption('ease-in-out'); await page.locator('[data-shot-apply-easing]').click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(4);
  await awaitShotMutationSettlement(4, 840, 'ease-in-out');
  expect(commandBytes).toHaveLength(4); expect(commandStatuses).toEqual([200, 200, 200, 200]);
  const timingCommands = commandBytes.slice(2, 4).map((bytes) => JSON.parse(bytes) as { expectedRevision: number; command: {
    schemaVersion: string; kind: string; expectedRevision: number; intent: { expectedEasing?: unknown } } });
  expect(timingCommands.map((wire) => [wire.command.kind, wire.expectedRevision, wire.command.expectedRevision])).toEqual([
    ['motion.keyframe-group-time.set', 2, 2],
    ['motion.keyframe-group-easing.set', 3, 3],
  ]);
  expect(timingCommands.every((wire) => wire.command.schemaVersion === 'motion.operation-intent.v1')).toBe(true);
  expect(timingCommands[1]?.command.intent.expectedEasing).toEqual({
    kind: 'cubic-bezier', x1: 0.2, y1: 0.8, x2: 0.3, y2: 1,
  });
  await workspace.getByRole('button', { name: 'Advanced motion controls' }).click();
  await page.locator('[data-shot-advanced-drawer] > details').nth(1).locator('summary').click();
  await page.locator('[data-shot-settled]').fill('1820'); await page.locator('[data-shot-hold]').click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(5);
  expect(commandBytes.slice(2, 5).map((bytes) => { const wire = JSON.parse(bytes) as { expectedRevision: number;
    command: { kind: string; expectedRevision: number } }; return [wire.command.kind, wire.expectedRevision, wire.command.expectedRevision]; }))
    .toEqual([
      ['motion.keyframe-group-time.set', 2, 2],
      ['motion.keyframe-group-easing.set', 3, 3],
      ['motion.settled-hold.set', 4, 4],
    ]);
  return { ...context, original, committedSrcdoc, landed, box, activeHit, armGestureProjectionProbe, takeGestureProjection, draftBaseline, cancelledPointerStart, cancelledGestureProjection, cancelledPointerEnd, cancelledDraft, cancelledExpectedDelta, cancelledRestoration, pointerCancelDraft, pointerCancelRestoration, iframeBox, offFrameDelta, releasedPointerStart, releasedGestureProjection, releasedPointerEnd, releasedDraft, releasedExpectedDelta, terminalRelease, remountedCommitId, releasedWire, postRelease, paintedFrames, runway, revisionOne, currentGroup, x, failedPublicationBaseline, failedPublicationGeometry, groupedCommand, retimeGeometryRequestId, timingCommands };
}

