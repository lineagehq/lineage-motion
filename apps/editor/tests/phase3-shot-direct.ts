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
import { runShotHistory } from './phase3-shot-history.js';

export async function runShotDirectControls(context: Awaited<ReturnType<typeof runShotHistory>>) {
  const { page, directory, humanCapability, agentCapability, root, port, seed, targetElementIds, inheritedTargets, runtimeSeedPath, processHandle, addresses, editorUrl, serviceUrl, commandBytes, preparationBytes, commandStatuses, consoleErrors, workspace, layoutContract, readGeometry, closedGeometry, advancedMotion, objectInputs, primaryInputs, focusedLayout, beforePathAlignment, readMomentAlignment, awaitShotMutationSettlement, previewToolbar, referenceSegments, referenceWaypoints, referenceGeometryBeforeSwitch, canvasObjectTargets, selectedReferenceSegments, settledObjectBounds, finishedEndpointBaseline, finishedEndpointArrival, rejectedTimingBaseline, priorNativeTimeMs, readSpatialProof, spatialTargets, initialPrimaryCommitId, changedPrimaryCommitId, readInteractiveInventory, beforeResizeCommitId, original, committedSrcdoc, landed, box, activeHit, armGestureProjectionProbe, takeGestureProjection, draftBaseline, cancelledPointerStart, cancelledGestureProjection, cancelledPointerEnd, cancelledDraft, cancelledExpectedDelta, cancelledRestoration, pointerCancelDraft, pointerCancelRestoration, iframeBox, offFrameDelta, releasedPointerStart, releasedGestureProjection, releasedPointerEnd, releasedDraft, releasedExpectedDelta, terminalRelease, remountedCommitId, releasedWire, postRelease, paintedFrames, runway, revisionOne, currentGroup, x, failedPublicationBaseline, failedPublicationGeometry, groupedCommand, retimeGeometryRequestId, timingCommands, edited, preparedKinds, editedInventory, editedTarget1, editedTarget0, atomicSwitchBaseline, editedSpatialTargets, atomicSwitchFrames, readRaceState, immediateRaceState, settledRaceState, committedIdentity, intermediateAlignmentBaseline, momentOnlyState, durableSnapshots, assertDurableHistoryAction, undone, redone, sanitizeRaceState, controlledReceipt } = context;
  const advanced = workspace.getByRole('button', { name: 'Advanced motion controls' });
  if (await advanced.getAttribute('aria-expanded') === 'true') await page.keyboard.press('Escape');
  const canvasBeforeAdvanced = await page.locator('[data-preview]').boundingBox();
  await advanced.click();
  expect(await page.locator('[data-preview]').boundingBox()).toEqual(canvasBeforeAdvanced);
  await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 768, height: 900 });
  await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  const directTargets = await page.locator('[data-preview-object-id]:visible, [data-transform-handle]:visible').evaluateAll((items) => items.map((item) => {
    const rect = item.getBoundingClientRect(); return { width: rect.width, height: rect.height, kind: (item as HTMLElement).dataset.transformHandle ?? 'body' };
  }));
  expect(directTargets).toHaveLength(7);
  expect(directTargets.every(({ width, height }) => width >= 43.5 && height >= 43.5)).toBe(true);
  const selectionFrame = async () => page.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    const selectedBody = document.querySelector<HTMLElement>('[data-preview-object-id][aria-pressed="true"]')!;
    const target = frame.contentDocument!.querySelector<HTMLElement>(`[data-motion-id="${selectedBody.dataset.previewObjectId}"]`)!;
    const targetRect = target.getBoundingClientRect(); const selection = document.querySelector<HTMLElement>('[data-preview-selection]')!;
    const corners = [...document.querySelectorAll<HTMLElement>('[data-transform-handle="scale"]:not([hidden])')].map((handle) => ({
      corner: handle.dataset.transformCorner, key: handle.dataset.previewControlKey, label: handle.getAttribute('aria-label'),
      title: handle.title, role: handle.getAttribute('role'), value: handle.getAttribute('aria-valuenow'),
      min: handle.getAttribute('aria-valuemin'), max: handle.getAttribute('aria-valuemax'),
      anchor: { x: handle.dataset.transformCorner?.endsWith('left')
        ? Number.parseFloat(handle.style.left) + Number.parseFloat(handle.style.width) : Number.parseFloat(handle.style.left),
      y: handle.dataset.transformCorner?.startsWith('top')
        ? Number.parseFloat(handle.style.top) + Number.parseFloat(handle.style.height) : Number.parseFloat(handle.style.top) },
    }));
    const rotation = document.querySelector<HTMLElement>('[data-transform-handle="rotate"]:not([hidden])')!;
    const aligned = (left: number, right: number) => Math.abs(left - right) < .001;
    return { selectedLabel: selection.querySelector('span')!.textContent!, exactBounds: { left: aligned(Number.parseFloat(selection.style.left), targetRect.left),
      top: aligned(Number.parseFloat(selection.style.top), targetRect.top), width: aligned(Number.parseFloat(selection.style.width), targetRect.width),
      height: aligned(Number.parseFloat(selection.style.height), targetRect.height) }, selectionValues: { left: Number.parseFloat(selection.style.left),
      top: Number.parseFloat(selection.style.top), width: Number.parseFloat(selection.style.width), height: Number.parseFloat(selection.style.height) },
      corners, target: { left: targetRect.left, top: targetRect.top,
      right: targetRect.right, bottom: targetRect.bottom }, rotation: { key: rotation.dataset.previewControlKey,
      role: rotation.dataset.transformRole, label: rotation.getAttribute('aria-label'), title: rotation.title,
      value: rotation.getAttribute('aria-valuenow'), text: rotation.getAttribute('aria-valuetext'),
      centerX: Number.parseFloat(rotation.style.left) + Number.parseFloat(rotation.style.width) / 2,
      centerY: Number.parseFloat(rotation.style.top) + Number.parseFloat(rotation.style.height) / 2,
      symbol: getComputedStyle(rotation, '::before').content, connectorHeight: Number.parseFloat(getComputedStyle(rotation, '::after').height) } };
  });
  const frameAt768 = await selectionFrame();
  expect(frameAt768.exactBounds).toEqual({ left: true, top: true, width: true, height: true });
  expect(frameAt768.corners.map(({ corner }) => corner).sort()).toEqual(['bottom-left', 'bottom-right', 'top-left', 'top-right']);
  const expectedCorners = [{ x: frameAt768.target.left, y: frameAt768.target.top }, { x: frameAt768.target.right, y: frameAt768.target.top },
    { x: frameAt768.target.right, y: frameAt768.target.bottom }, { x: frameAt768.target.left, y: frameAt768.target.bottom }];
  expect(frameAt768.corners.every(({ anchor }) => expectedCorners.some((expected) =>
    Math.abs(anchor.x - expected.x) < .001 && Math.abs(anchor.y - expected.y) < .001))).toBe(true);
  expect(frameAt768.corners.every(({ key, label, title, role, value, min, max }) => Boolean(key)
    && label?.endsWith(`uniform scale handle for ${frameAt768.selectedLabel}`) && title.endsWith(`scale ${frameAt768.selectedLabel}`) && role === 'slider'
    && value !== null && min === '0.25' && max === '3')).toBe(true);
  expect(frameAt768.rotation).toMatchObject({ role: 'rotation', label: `Rotation handle for ${frameAt768.selectedLabel}`,
    title: `Drag to rotate ${frameAt768.selectedLabel}` });
  expect(frameAt768.rotation.key).toBeTruthy(); expect(frameAt768.rotation.value).not.toBeNull();
  expect(frameAt768.rotation.text).toContain('degrees');
  expect(Math.abs(frameAt768.rotation.centerX - (frameAt768.target.left + frameAt768.target.right) / 2)).toBeLessThan(.001);
  expect(frameAt768.rotation.centerY).toBeLessThan(frameAt768.target.top); expect(frameAt768.rotation.symbol).not.toBe('none');
  expect(frameAt768.rotation.connectorHeight).toBeGreaterThan(0);
  const controlNodesBeforeResize = await page.locator('[data-preview-control-key]').evaluateAll((nodes) => {
    (window as unknown as { __directControlNodes: Map<string, Element> }).__directControlNodes = new Map(
      nodes.map((node) => [(node as HTMLElement).dataset.previewControlKey!, node]));
    return nodes.map((node) => (node as HTMLElement).dataset.previewControlKey);
  });
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect.poll(async () => (await selectionFrame()).exactBounds).toEqual({ left: true, top: true, width: true, height: true });
  const frameAt1440 = await selectionFrame();
  expect(frameAt1440.exactBounds).toEqual({ left: true, top: true, width: true, height: true });
  expect(await page.locator('[data-preview-control-key]').evaluateAll((nodes) => nodes.every((node) =>
    (window as unknown as { __directControlNodes: Map<string, Element> }).__directControlNodes.get((node as HTMLElement).dataset.previewControlKey!) === node
      && node.isConnected))).toBe(true);
  expect(await page.locator('[data-preview-control-key]').evaluateAll((nodes) => nodes.map((node) =>
    (node as HTMLElement).dataset.previewControlKey))).toEqual(controlNodesBeforeResize);
  await page.setViewportSize({ width: 768, height: 900 });
  const directBaseline = await page.evaluate(() => window.__motionEditor.inspectAuthoring().contentDigest);
  const directSelectionBaseline = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  for (const [index, elementId] of targetElementIds.entries()) {
    await workspace.getByRole('radio', { name: `Primary Object ${index + 1}` }).check();
    await expect(page.locator('[data-preview-selection] span')).toHaveText(`Object ${index + 1}`);
    expect(await page.locator('[data-transform-handle]:visible').evaluateAll((handles, selectedId) => ({ count: handles.length,
      selectedOnly: handles.every((handle) => (handle as HTMLElement).dataset.transformElementId === selectedId) }), elementId))
      .toEqual({ count: 5, selectedOnly: true });
  }
  await workspace.getByRole('radio', { name: 'Primary Object 1' }).check();
  const transformModeToggle = workspace.getByRole('button', { name: 'Path', exact: true });
  await transformModeToggle.click(); await expect(transformModeToggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-transform-handle]:visible')).toHaveCount(5);
  await transformModeToggle.click(); await expect(transformModeToggle).toHaveAttribute('aria-pressed', 'true');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({
    revision: directSelectionBaseline.revision, contentDigest: directSelectionBaseline.contentDigest,
    exportDigest: directSelectionBaseline.exportDigest, undoCount: directSelectionBaseline.undoCount, redoCount: directSelectionBaseline.redoCount });
  for (const [selector, key] of [['[data-transform-corner="top-left"]:visible', 'ArrowUp'], ['[data-transform-handle="rotate"]:visible', 'ArrowRight'], ['[data-preview-object-id][aria-pressed="true"]', 'Shift+ArrowRight']] as const) {
    const beforeRevision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
    await page.locator(selector).focus(); await page.keyboard.press(key);
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(beforeRevision + 1);
    await page.locator('[data-undo]').click();
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(beforeRevision + 2);
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().contentDigest)).toBe(directBaseline);
  }
  const cancelTransform = async (method: 'escape' | 'pointercancel') => {
    const control = page.locator('[data-transform-corner="bottom-left"]:visible'); const box = await control.boundingBox(); expect(box).not.toBeNull();
    const baseline = await page.evaluate(() => { const authoring = window.__motionEditor.inspectAuthoring();
      const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      const selected = document.querySelector<HTMLElement>('[data-preview-object-id][aria-pressed="true"]')!;
      const rect = frame.contentDocument!.querySelector<HTMLElement>(`[data-motion-id="${selected.dataset.previewObjectId}"]`)!.getBoundingClientRect();
      (window as unknown as { __cancelBaselineDocument: Document }).__cancelBaselineDocument = frame.contentDocument!;
      return { authoring, bounds: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } }; });
    const commandCount = commandBytes.length;
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 - 12, box!.y + box!.height / 2 + 10, { steps: 4 });
    await expect.poll(() => page.evaluate((bounds) => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      const selected = document.querySelector<HTMLElement>('[data-preview-object-id][aria-pressed="true"]')!;
      const rect = frame.contentDocument!.querySelector<HTMLElement>(`[data-motion-id="${selected.dataset.previewObjectId}"]`)!.getBoundingClientRect();
      return rect.left !== bounds.left || rect.top !== bounds.top || rect.width !== bounds.width || rect.height !== bounds.height;
    }, baseline.bounds)).toBe(true);
    if (method === 'escape') { await page.keyboard.press('Escape'); await page.mouse.up(); }
    else { await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerId: 1 }))); await page.mouse.up(); }
    await expect.poll(() => page.evaluate((bounds) => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      const selected = document.querySelector<HTMLElement>('[data-preview-object-id][aria-pressed="true"]')!;
      const rect = frame.contentDocument!.querySelector<HTMLElement>(`[data-motion-id="${selected.dataset.previewObjectId}"]`)!.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
    }, baseline.bounds)).toEqual(baseline.bounds);
    expect(commandBytes).toHaveLength(commandCount);
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({ revision: baseline.authoring.revision,
      contentDigest: baseline.authoring.contentDigest, exportDigest: baseline.authoring.exportDigest,
      undoCount: baseline.authoring.undoCount, redoCount: baseline.authoring.redoCount });
    expect(await page.evaluate(() => document.querySelector<HTMLIFrameElement>('[data-preview]')!.contentDocument
      === (window as unknown as { __cancelBaselineDocument: Document }).__cancelBaselineDocument)).toBe(true);
  };
  await cancelTransform('escape'); await cancelTransform('pointercancel');
  const dragTransform = async (selector: string, delta: { x: number; y: number }) => {
    const control = page.locator(selector); const box = await control.boundingBox(); expect(box).not.toBeNull();
    const baseline = await page.evaluate(() => { const authoring = window.__motionEditor.inspectAuthoring();
      const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      const selected = document.querySelector<HTMLElement>('[data-preview-object-id][aria-pressed="true"]')!;
      const target = frame.contentDocument!.querySelector<HTMLElement>(`[data-motion-id="${selected.dataset.previewObjectId}"]`)!;
      const rect = target.getBoundingClientRect(); frame.dataset.directTransformLoads = '0';
      frame.addEventListener('load', () => { frame.dataset.directTransformLoads = String(Number(frame.dataset.directTransformLoads) + 1); }, { once: true });
      const controls = [...document.querySelectorAll<HTMLElement>('[data-preview-control-key]')];
      const nodes = new Map(controls.map((node) => [node.dataset.previewControlKey!, node]));
      const paint = { frames: 0, releaseFrames: 0, hiddenGaps: 0, identityGaps: 0, oldPoseReleaseFrames: 0, release: false, stop: false };
      (window as unknown as { __directTransformDocument: Document }).__directTransformDocument = frame.contentDocument!;
      (window as unknown as { __directTransformNodes: Map<string, Element> }).__directTransformNodes = nodes;
      (window as unknown as { __directTransformPaint: typeof paint }).__directTransformPaint = paint;
      window.addEventListener('pointerup', () => { paint.release = true; }, { once: true });
      const tick = () => { if (paint.stop) return; paint.frames += 1;
        const current = [...document.querySelectorAll<HTMLElement>('[data-preview-control-key]')];
        if (document.querySelector<HTMLElement>('[data-preview-selection]')!.hidden
          || current.filter((node) => !node.hidden && node.dataset.transformElementId === selected.dataset.previewObjectId).length !== 5) paint.hiddenGaps += 1;
        if (current.some((node) => nodes.get(node.dataset.previewControlKey!) !== node || !node.isConnected)) paint.identityGaps += 1;
        if (paint.release) { paint.releaseFrames += 1; const currentRect = target.getBoundingClientRect();
          if (currentRect.left === rect.left && currentRect.top === rect.top && currentRect.width === rect.width && currentRect.height === rect.height)
            paint.oldPoseReleaseFrames += 1; }
        requestAnimationFrame(tick); };
      requestAnimationFrame(tick);
      return { revision: authoring.revision, contentDigest: authoring.contentDigest, exportDigest: authoring.exportDigest,
        bounds: { left: rect.left, top: rect.top, width: rect.width, height: rect.height } };
    });
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2); await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + delta.x, box!.y + box!.height / 2 + delta.y, { steps: 6 });
    await expect.poll(() => page.evaluate((bounds) => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      const selected = document.querySelector<HTMLElement>('[data-preview-object-id][aria-pressed="true"]')!;
      const rect = frame.contentDocument!.querySelector<HTMLElement>(`[data-motion-id="${selected.dataset.previewObjectId}"]`)!.getBoundingClientRect();
      return rect.left !== bounds.left || rect.top !== bounds.top || rect.width !== bounds.width || rect.height !== bounds.height;
    }, baseline.bounds)).toBe(true);
    const draftLanding = await page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      const selected = document.querySelector<HTMLElement>('[data-preview-object-id][aria-pressed="true"]')!;
      const rect = frame.contentDocument!.querySelector<HTMLElement>(`[data-motion-id="${selected.dataset.previewObjectId}"]`)!.getBoundingClientRect();
      return { left: rect.left, top: rect.top, width: rect.width, height: rect.height }; });
    const commandCount = commandBytes.length; await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(baseline.revision + 1);
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    const committed = await page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      const selected = document.querySelector<HTMLElement>('[data-preview-object-id][aria-pressed="true"]')!;
      const rect = frame.contentDocument!.querySelector<HTMLElement>(`[data-motion-id="${selected.dataset.previewObjectId}"]`)!.getBoundingClientRect();
      const paint = (window as unknown as { __directTransformPaint: { stop: boolean; frames: number; releaseFrames: number;
        hiddenGaps: number; identityGaps: number; oldPoseReleaseFrames: number } }).__directTransformPaint; paint.stop = true;
      const controls = [...document.querySelectorAll<HTMLElement>('[data-preview-control-key]')];
      const nodes = (window as unknown as { __directTransformNodes: Map<string, Element> }).__directTransformNodes;
      return { bounds: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
        stableDocument: frame.contentDocument === (window as unknown as { __directTransformDocument: Document }).__directTransformDocument,
        loads: Number(frame.dataset.directTransformLoads), controlsStable: controls.every((node) => nodes.get(node.dataset.previewControlKey!) === node && node.isConnected),
        previewMatchesCompiler: window.__motionEditor.inspectShotWorkspace().previewMatchesCompiler,
        paint: { frames: paint.frames, releaseFrames: paint.releaseFrames, hiddenGaps: paint.hiddenGaps,
          identityGaps: paint.identityGaps, oldPoseReleaseFrames: paint.oldPoseReleaseFrames } };
    });
    expect(commandBytes).toHaveLength(commandCount + 1);
    expect((JSON.parse(commandBytes.at(-1)!) as { command: { kind: string } }).command.kind).toBe('motion.transform-pose.set');
    expect(committed).toMatchObject({ bounds: draftLanding, stableDocument: true, loads: 0, controlsStable: true,
      previewMatchesCompiler: true, paint: { hiddenGaps: 0, identityGaps: 0, oldPoseReleaseFrames: 0 } });
    expect(committed.paint.frames).toBeGreaterThan(1); expect(committed.paint.releaseFrames).toBeGreaterThan(0);
    await page.locator('[data-undo]').click();
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(baseline.revision + 2);
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().contentDigest)).toBe(baseline.contentDigest);
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().exportDigest)).toBe(baseline.exportDigest);
  };
  await dragTransform('[data-transform-corner="top-left"]:visible', { x: -14, y: -10 });
  await dragTransform('[data-transform-corner="bottom-right"]:visible', { x: 14, y: 10 });
  await dragTransform('[data-transform-handle="rotate"]:visible', { x: 16, y: 7 });
  await page.locator('[data-move-together]').uncheck();
  const pathToggle = workspace.getByRole('button', { name: 'Path', exact: true });
  if (await pathToggle.getAttribute('aria-pressed') === 'true') await pathToggle.click();
  const naturalCenter = (elementId: string) => page.evaluate((id) => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!; const target = frame.contentDocument!.querySelector<HTMLElement>(`[data-motion-id="${id}"]`)!;
    const frameRect = frame.getBoundingClientRect(); const targetRect = target.getBoundingClientRect();
    const x = frameRect.left + (targetRect.left + targetRect.width / 2) * frameRect.width / frame.clientWidth;
    const y = frameRect.top + (targetRect.top + targetRect.height / 2) * frameRect.height / frame.clientHeight;
    const hit = document.elementFromPoint(x, y) as HTMLElement | null;
    return { x, y, objectId: hit?.closest<HTMLElement>('[data-preview-object-id]')?.dataset.previewObjectId ?? null,
      waypointId: hit?.closest<HTMLElement>('[data-keyframe-id]')?.dataset.keyframeId ?? null };
  }, elementId);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }]) {
    await page.setViewportSize(viewport); await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
    await workspace.getByRole('radio', { name: 'Primary Object 2' }).check();
    const center = await naturalCenter(targetElementIds[1]!);
    expect(center).toMatchObject({ objectId: targetElementIds[1], waypointId: null });
    const beforeRevision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
    await page.mouse.move(center.x, center.y); await page.mouse.down(); await page.mouse.move(center.x + 12, center.y + 6, { steps: 3 }); await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(beforeRevision + 1);
    expect((JSON.parse(commandBytes.at(-1)!) as { command: { kind: string } }).command.kind).toBe('motion.transform-pose.set');
    await page.locator('[data-undo]').click(); await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(beforeRevision + 2);
    expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().contentDigest)).toBe(directBaseline);
  }
  await pathToggle.click(); await expect(pathToggle).toHaveAttribute('aria-pressed', 'true');
  await page.locator('input[name="shot-moment"][value="840"]').check();
  await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  const nonCurrent = page.locator('[data-trajectory-overlay] [data-keyframe-id][data-time-ms="0"]');
  const nonCurrentBox = await nonCurrent.boundingBox(); expect(nonCurrentBox).not.toBeNull();
  const waypointHit = await page.evaluate(({ x, y }) => (document.elementFromPoint(x, y) as HTMLElement | null)
    ?.closest<HTMLElement>('[data-keyframe-id]')?.dataset.timeMs ?? null,
  { x: nonCurrentBox!.x + nonCurrentBox!.width / 2, y: nonCurrentBox!.y + nonCurrentBox!.height / 2 });
  expect(waypointHit).toBe('0');
  const selectionRevision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
  await nonCurrent.click(); expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(selectionRevision);
  await page.locator('input[name="shot-moment"][value="840"]').check(); await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  const dragBox = await page.locator('[data-trajectory-overlay] [data-keyframe-id][data-time-ms="0"]').boundingBox();
  await page.mouse.move(dragBox!.x + dragBox!.width / 2, dragBox!.y + dragBox!.height / 2); await page.mouse.down();
  await page.mouse.move(dragBox!.x + dragBox!.width / 2 + 12, dragBox!.y + dragBox!.height / 2 + 6, { steps: 3 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(selectionRevision + 1);
  expect((JSON.parse(commandBytes.at(-1)!) as { command: { kind: string } }).command.kind).toBe('motion.transform-waypoints.translate');
  await page.locator('[data-undo]').click(); await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(selectionRevision + 2);
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().contentDigest)).toBe(directBaseline);
  expect(consoleErrors).toEqual([]);
}
