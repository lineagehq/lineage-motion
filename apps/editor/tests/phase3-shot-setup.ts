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

export async function runShotSetup({
  page,
  directory,
  humanCapability,
  agentCapability,
  initialProcessHandle,
}: {
  page: Page;
  directory: string;
  humanCapability: string;
  agentCapability: string;
  initialProcessHandle: ChildProcess | undefined;
}) {
  await page.setViewportSize({ width: 1183, height: 900 });
  initialProcessHandle?.kill('SIGTERM');
  if (initialProcessHandle?.exitCode === null) await new Promise((resolveExit) => initialProcessHandle.once('exit', resolveExit));
  const root = resolve(import.meta.dirname, '../../..'); const port = 43000 + Math.floor(Math.random() * 500);
  const seed = createTrajectorySeed(root); const targetElementIds = seed.elements.map((element) => element.id).sort();
  const inheritedTargets = projectTrajectorySelection(seed, targetElementIds, 700);
  expect(inheritedTargets.eligible).toBe(true); if (!inheritedTargets.eligible) throw new Error(inheritedTargets.code ?? 'TRAJECTORY_SELECTION_INVALID');
  for (const target of inheritedTargets.targets) {
    const track = seed.tracks.find((item) => item.id === target.trackId && item.elementId === target.elementId);
    const ruleTrack = track && seed.rules.find((item) => item.id === track.ruleId)?.tracks.find((item) => item.property === 'transform');
    const keyframe = ruleTrack?.keyframes.find((item) => item.id === target.keyframeId);
    const application = track && seed.applications.find((item) => item.slots.some((slot) => slot.id === track.slotId));
    const slot = application?.slots.find((item) => item.id === track?.slotId);
    if (!keyframe || !slot) throw new Error('TRAJECTORY_INHERITED_TIMING_SEED_INVALID');
    delete keyframe.easing; slot.timingFunction = { kind: 'cubic-bezier', x1: 0.2, y1: 0.8, x2: 0.3, y2: 1 };
  }
  const runtimeSeedPath = join(directory, 'trajectory-inherited-timing.json');
  await writeFile(runtimeSeedPath, `${JSON.stringify(seed)}\n`);
  const processHandle = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: root, env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'trajectory.sqlite'), PHASE3_EDITOR_PORT: String(port),
      PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: agentCapability, LANDING_SHOT1_WORKSPACE: '1',
      LANDING_SHOT1_DOCUMENT_PATH: runtimeSeedPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const addresses = await new Promise<{ editorUrl: string; serviceUrl: string }>((resolveAddress, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('TRAJECTORY_SERVER_TIMEOUT')), 10000);
    processHandle!.stdout!.on('data', (chunk) => { output += chunk.toString(); const line = output.split('\n').find((candidate) => candidate.startsWith('{'));
      if (line) { clearTimeout(timer); resolveAddress(JSON.parse(line)); } });
    processHandle!.once('exit', (code) => { clearTimeout(timer); reject(new Error(`TRAJECTORY_SERVER_EXIT_${code}`)); });
  });
  const { editorUrl, serviceUrl } = addresses;
  await expect.poll(async () => { try { return (await fetch(editorUrl)).ok; } catch { return false; } }).toBe(true);
  const commandBytes: string[] = []; page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/commands')) commandBytes.push(request.postData() ?? '');
  });
  const preparationBytes: string[] = []; page.on('request', (request) => {
    if (request.url().endsWith('/operations/prepare')) preparationBytes.push(request.postData() ?? '');
  });
  const commandStatuses: number[] = []; page.on('response', (response) => {
    if (response.url().endsWith('/api/v1/commands')) commandStatuses.push(response.status());
  });
  const consoleErrors: string[] = []; page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.evaluate(() => window.__motionEditor.disconnectEvents());
  const workspace = page.locator('[data-shot-workspace]');
  await expect(workspace).toBeVisible();
  const layoutContract = await page.evaluate(() => {
    const preview = document.querySelector<HTMLElement>('.preview-panel')!;
    const stage = document.querySelector<HTMLElement>('.preview-stage')!;
    const objectBar = document.querySelector<HTMLElement>('[data-shot-object-bar]')!;
    const dock = document.querySelector<HTMLElement>('[data-shot-context-dock]')!;
    const rail = document.querySelector<HTMLElement>('[data-preview-control-rail]')!;
    const stageBounds = stage.getBoundingClientRect();
    const dockBounds = dock.getBoundingClientRect();
    return {
      objectBarInsidePreview: preview.contains(objectBar),
      dockInsidePreview: preview.contains(dock),
      railInsidePreview: preview.contains(rail),
      stageHeight: Math.round(stage.getBoundingClientRect().height),
      sharedStageDockColumn: Math.round(stageBounds.left) === Math.round(dockBounds.left)
        && Math.round(stageBounds.right) === Math.round(dockBounds.right),
      order: [objectBar, stage, dock, rail].map((node) =>
        Math.round(node.getBoundingClientRect().top)),
    };
  });
  expect(layoutContract.objectBarInsidePreview).toBe(true);
  expect(layoutContract.dockInsidePreview).toBe(true);
  expect(layoutContract.railInsidePreview).toBe(true);
  expect(layoutContract.stageHeight).toBeGreaterThanOrEqual(430);
  expect(layoutContract.sharedStageDockColumn).toBe(true);
  expect(layoutContract.order[0]!).toBeLessThan(layoutContract.order[3]!);
  const readGeometry = () => page.evaluate(() => {
    const selectors = ['.preview-stage', '[data-preview-canvas]', '[data-preview-object-overlay]', '[data-trajectory-overlay]'];
    return Object.fromEntries(selectors.map((selector) => {
      const rect = document.querySelector<HTMLElement>(selector)!.getBoundingClientRect();
      return [selector, [rect.x, rect.y, rect.width, rect.height].map((value) => Math.round(value * 10) / 10)];
    }));
  });
  const closedGeometry = await readGeometry();
  const advancedMotion = page.getByRole('button', { name: 'Advanced motion controls' });
  await advancedMotion.click();
  await expect(page.locator('[data-shot-advanced-drawer]')).toBeVisible();
  expect(await readGeometry()).toEqual(closedGeometry);
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-shot-advanced-drawer]')).toBeHidden();
  await expect(advancedMotion).toBeFocused();
  expect(await readGeometry()).toEqual(closedGeometry);
  const objectInputs = workspace.locator('[data-shot-targets] input[type="checkbox"]');
  const primaryInputs = workspace.locator('[data-shot-targets] input[name="shot-primary"]');
  await expect(objectInputs).toHaveCount(0);
  await expect(primaryInputs).toHaveCount(2); await expect(primaryInputs.nth(0)).toBeChecked();
  expect(await primaryInputs.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual(targetElementIds);
  await expect(workspace.locator('[data-move-together]')).not.toBeChecked();
  const focusedLayout = await page.evaluate(() => { const workspace = document.querySelector<HTMLElement>('[data-shot-workspace]')!;
    const preview = document.querySelector<HTMLElement>('.preview-panel')!; const workflow = document.querySelector<HTMLElement>('.workflow')!;
    const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!; const frameRect = frame.getBoundingClientRect(); return {
      shotActive: document.querySelector('.editor-shell')!.classList.contains('shot-active'), workflowDisplay: getComputedStyle(workflow).display,
      workspaceInsidePreview: preview.contains(workspace), controlsVisible: frameRect.top >= 0 && frameRect.top < innerHeight,
      nativeStageVisible: frameRect.top >= 0 && frameRect.bottom <= innerHeight, runway: document.querySelector<HTMLElement>('.preview-stage')!.dataset.runwayCssPixels,
    }; });
  expect(focusedLayout).toEqual({ shotActive: true, workflowDisplay: 'none', workspaceInsidePreview: true, controlsVisible: true, nativeStageVisible: true, runway: '72' });
  await expect(page.locator('input[name="shot-moment"]')).toHaveCount(3);
  expect(await page.locator('input[name="shot-moment"]').evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value)))).toEqual([0, 700, 2100]);
  await expect(page.locator('input[name="shot-moment"][value="700"]')).toBeChecked();
  await expect(workspace.locator('[data-pose-form] input[name="x"]')).toBeEnabled();
  expect(await page.evaluate(() => window.__motionEditor.inspectShotWorkspace())).toMatchObject({ open: true, momentMs: 700, previewMatchesCompiler: true });
  const beforePathAlignment = await page.evaluate(() => ({ authoring: window.__motionEditor.inspectAuthoring(), native: window.__motionEditor.readState(),
    slider: Number((document.querySelector('[data-scrub]') as HTMLInputElement).value), visibleTime: document.querySelector<HTMLOutputElement>('[data-playhead]')!.value }));
  expect(beforePathAlignment).toMatchObject({ authoring: { revision: 0 }, native: { playheadMs: 700, currentTimes: [700, 700], playStates: ['paused', 'paused'] },
    slider: 700, visibleTime: '700 ms' });
  await expect(page.getByRole('button', { name: 'Path' })).toHaveAttribute('aria-pressed', 'true');
  await expect(workspace.locator('[data-shot-guidance]')).toContainText('Editing Object 1 at Point 1.');
  await expect(workspace.locator('[data-shot-guidance]')).toContainText('any corner to scale uniformly');
  await expect(page.locator('[data-trajectory-segment]')).toHaveCount(2);
  expect(await page.locator('[data-trajectory-segment]').evaluateAll((segments) => segments.every((segment) => {
    const style = getComputedStyle(segment); return style.display !== 'none' && Number.parseFloat(style.width) > 20;
  }))).toBe(true);
  expect((await page.locator('[data-trajectory-segment]').evaluateAll((segments) => segments.map((segment) => ({
    index: (segment as HTMLElement).dataset.segmentIndex, label: (segment as HTMLElement).dataset.segmentLabel,
    arrow: getComputedStyle(segment, '::after').borderLeftWidth,
  })))).sort((left, right) => Number(left.index) - Number(right.index))).toEqual([
    { index: '1', label: 'Start to Point 1', arrow: '8px' }, { index: '2', label: 'Point 1 to Settle', arrow: '8px' },
  ]);
  const readMomentAlignment = () => page.evaluate(() => ({ authoring: window.__motionEditor.inspectAuthoring(), native: window.__motionEditor.readState(),
    slider: Number((document.querySelector('[data-scrub]') as HTMLInputElement).value), visibleTime: document.querySelector<HTMLOutputElement>('[data-playhead]')!.value,
    selectedMoment: Number((document.querySelector('input[name="shot-moment"]:checked') as HTMLInputElement).value) }));
  const awaitShotMutationSettlement = async (revision: number, momentMs: number, easing?: string) => {
    await expect.poll(() => page.evaluate(({ revision, momentMs, easing }) => {
      const inspected = window.__motionEditor.inspectShotWorkspace() as unknown as {
        revision: number; momentMs: number; previewMatchesCompiler: boolean; activeDraft: unknown;
        compilerDraft: { active: boolean }; waypointReleasePhase: string;
        geometryPump: { running: boolean; activeSamplers: number; latestRequestId: number | null;
          pendingRequestId: number | null; lastCommittedRequestId: number | null };
      };
      const operationStatus = document.querySelector<HTMLOutputElement>('[data-operation-status]')!;
      const shotStatus = document.querySelector<HTMLOutputElement>('[data-shot-status]')!;
      const selectedMoment = document.querySelector<HTMLInputElement>('input[name="shot-moment"]:checked')!;
      const easingControl = document.querySelector<HTMLSelectElement>('[data-shot-easing]')!;
      return {
        operation: { kind: operationStatus.dataset.kind, value: operationStatus.value },
        shot: { value: shotStatus.value, revision: inspected.revision, momentMs: inspected.momentMs,
          selectedMomentMs: Number(selectedMoment.value), scrubMs: Number(document.querySelector<HTMLInputElement>('[data-scrub]')!.value),
          playhead: document.querySelector<HTMLOutputElement>('[data-playhead]')!.value,
          easing: easing === undefined ? undefined : easingControl.value },
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
    }, { revision, momentMs, easing })).toEqual({
      operation: { kind: 'success', value: `Change applied. Revision ${revision}.` },
      shot: { value: `Object 1 · ${momentMs === 0 ? 'Start' : momentMs === 2100 ? 'Settle' : `Point ${momentMs === 840 ? 1 : 1}`} ready.`, revision, momentMs,
        selectedMomentMs: momentMs, scrubMs: momentMs, playhead: `${momentMs} ms`, easing },
      previewMatchesCompiler: true,
      activeDraft: null,
      compilerDraftActive: false,
      releasePhase: 'idle',
      overlayBusy: 'false',
      geometryPump: { running: false, activeSamplers: 0, pendingRequestId: null, current: true },
    });
  };
  await page.setViewportSize({ width: 960, height: 908 });
  await expect.poll(() => page.locator('[data-preview-canvas]').evaluate((canvas) => canvas.getBoundingClientRect().width)).toBeGreaterThan(440);
  await expect(page.locator('[data-trajectory-segment]').first()).toBeVisible();
  const previewToolbar = page.locator('[data-preview-shot-toolbar]'); await expect(previewToolbar).toBeVisible();
  await expect(previewToolbar.getByRole('button', { name: 'Show path overlay' })).toHaveAttribute('aria-pressed', 'true');
  await previewToolbar.getByRole('button', { name: 'Show path overlay' }).click();
  await expect(previewToolbar).toBeVisible();
  await expect(previewToolbar.getByRole('button', { name: 'Show path overlay' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-trajectory-segment]').first()).not.toBeVisible();
  await previewToolbar.getByRole('button', { name: 'Show path overlay' }).click();
  await expect(page.locator('[data-trajectory-segment]').first()).toBeVisible();
  await expect(previewToolbar.getByRole('button', { name: 'Edit Object 1 from preview' })).toHaveAttribute('aria-pressed', 'true');
  await expect(previewToolbar.getByRole('button', { name: 'Edit Point 1 waypoint from preview' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-preview-selection]')).toBeVisible();
  await expect(page.locator('[data-preview-selection] span')).toHaveText('Object 1');
  const referenceSegments = page.locator('[data-reference-segment]');
  const referenceWaypoints = page.locator('[data-reference-waypoint]');
  await expect(referenceSegments).toHaveCount(4); await expect(referenceWaypoints).toHaveCount(6);
  await page.evaluate(() => { (window as unknown as { __referencePathNodes: Map<string, Element> }).__referencePathNodes = new Map(
    [...document.querySelectorAll<HTMLElement>('[data-reference-segment], [data-reference-waypoint]')]
      .map((node) => [node.dataset.referenceSegment ?? node.dataset.referenceWaypoint!, node])); });
  const referenceGeometryBeforeSwitch = await referenceWaypoints.evaluateAll((points) => points.map((point) => ({
    key: (point as HTMLElement).dataset.referenceWaypoint, left: (point as HTMLElement).style.left,
    top: (point as HTMLElement).style.top, width: (point as HTMLElement).style.width, height: (point as HTMLElement).style.height,
  })));
  const canvasObjectTargets = page.locator('[data-preview-object-id]');
  await expect(canvasObjectTargets).toHaveCount(2);
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-preview-object-id]')].every((button) => {
    const target = document.querySelector<HTMLIFrameElement>('[data-preview]')!.contentDocument!
      .querySelector<HTMLElement>(`[data-motion-id="${button.dataset.previewObjectId}"]`)!;
    const targetRect = target.getBoundingClientRect();
    const left = Number.parseFloat(button.style.left); const top = Number.parseFloat(button.style.top);
    const width = Number.parseFloat(button.style.width); const height = Number.parseFloat(button.style.height);
    return Math.abs(left + width / 2 - (targetRect.left + targetRect.width / 2)) < 0.01
      && Math.abs(top + height / 2 - (targetRect.top + targetRect.height / 2)) < 0.01
      && width + .001 >= targetRect.width && height + .001 >= targetRect.height
      && button.getBoundingClientRect().width >= 43.5 && button.getBoundingClientRect().height >= 43.5;
  }))).toBe(true);
  expect(await canvasObjectTargets.first().evaluate((button) => {
    const label = getComputedStyle(button, '::after');
    return Number.parseFloat(label.top) < 0 && label.bottom !== 'auto';
  })).toBe(true);
  await canvasObjectTargets.nth(1).click();
  await expect(workspace.getByRole('radio', { name: 'Primary Object 2' })).toBeChecked();
  await expect(page.locator('[data-preview-selection] span')).toHaveText('Object 2');
  await expect(canvasObjectTargets.nth(1)).toHaveAttribute('aria-pressed', 'true');
  await expect(referenceSegments).toHaveCount(4); await expect(referenceWaypoints).toHaveCount(6);
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-reference-segment], [data-reference-waypoint]')]
    .every((node) => (window as unknown as { __referencePathNodes: Map<string, Element> }).__referencePathNodes
      .get(node.dataset.referenceSegment ?? node.dataset.referenceWaypoint!) === node))).toBe(true);
  expect(await referenceWaypoints.evaluateAll((points) => points.map((point) => ({
    key: (point as HTMLElement).dataset.referenceWaypoint, left: (point as HTMLElement).style.left,
    top: (point as HTMLElement).style.top, width: (point as HTMLElement).style.width, height: (point as HTMLElement).style.height,
  })))).toEqual(referenceGeometryBeforeSwitch);
  const selectedReferenceSegments = page.locator('[data-reference-segment][data-selected="true"]');
  await expect(selectedReferenceSegments).toHaveCount(2);
  expect(await selectedReferenceSegments.evaluateAll((segments, elementId) =>
    segments.every((segment) => (segment as HTMLElement).dataset.elementId === elementId), targetElementIds[1])).toBe(true);
  expect((await page.evaluate(() => window.__motionEditor.inspectAuthoring())).revision).toBe(0);
  await canvasObjectTargets.nth(0).click();
  await expect(workspace.getByRole('radio', { name: 'Primary Object 1' })).toBeChecked();
  await previewToolbar.getByRole('button', { name: 'Edit Object 2 from preview' }).click();
  await expect(workspace.getByRole('radio', { name: 'Primary Object 2' })).toBeChecked();
  await expect(page.locator('[data-preview-selection] span')).toHaveText('Object 2');
  await previewToolbar.getByRole('button', { name: 'Edit Object 1 from preview' }).click();
  await previewToolbar.getByRole('button', { name: 'Edit Start waypoint from preview' }).click();
  expect(await readMomentAlignment()).toMatchObject({ native: { playheadMs: 0, currentTimes: [0, 0], playStates: ['paused', 'paused'] },
    slider: 0, visibleTime: '0 ms', selectedMoment: 0 });
  await previewToolbar.getByRole('button', { name: 'Edit Point 1 waypoint from preview' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => Number(await page.locator('[data-scrub]').inputValue())).toBeGreaterThan(700);
  await expect(previewToolbar.locator('[data-preview-shot-state]')).toContainText('Previewing');
  await page.getByRole('button', { name: 'Pause' }).click();
  await expect(previewToolbar.locator('[data-preview-shot-state]')).toContainText('Paused');
  await previewToolbar.getByRole('button', { name: 'Edit Settle waypoint from preview' }).click();
  const settledObjectBounds = await page.evaluate((elementIds) => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    return elementIds.map((elementId) => { const target = frame.contentDocument!.querySelector<HTMLElement>(`[data-motion-id="${elementId}"]`)!;
      const rect = target.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; });
  }, targetElementIds);
  await page.locator('[data-scrub]').fill('2088');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(() => page.evaluate(() => { const state = window.__motionEditor.readState(); return {
    playheadMs: state.playheadMs, currentTimes: state.currentTimes, playStates: state.playStates,
    slider: Number((document.querySelector('[data-scrub]') as HTMLInputElement).value),
    visibleTime: document.querySelector<HTMLOutputElement>('[data-playhead]')!.value,
  }; })).toEqual({ playheadMs: 2100, currentTimes: [2100, 2100], playStates: ['paused', 'paused'], slider: 2100, visibleTime: '2100 ms' });
  expect(await page.evaluate((elementIds) => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    return elementIds.map((elementId) => { const target = frame.contentDocument!.querySelector<HTMLElement>(`[data-motion-id="${elementId}"]`)!;
      const rect = target.getBoundingClientRect(); return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }; });
  }, targetElementIds)).toEqual(settledObjectBounds);
  await expect(previewToolbar.locator('[data-preview-shot-state]')).toHaveText('Paused 2100 ms · Settle');
  expect((await page.evaluate(() => window.__motionEditor.inspectAuthoring())).revision).toBe(0);
  expect(commandBytes).toHaveLength(0);
  const finishedEndpointBaseline = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await page.locator('[data-scrub]').fill('2088');
  const finishedEndpointArrival = await page.evaluate(() => {
    document.querySelector<HTMLButtonElement>('[data-play]')!.click();
    const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    const animations = frame.contentDocument!.getAnimations();
    const originalTimings = animations.map((animation) => {
      const { delay, duration, endDelay, iterations } = animation.effect!.getTiming();
      if ((typeof duration !== 'string' && typeof duration !== 'number')
        || typeof delay !== 'number' || typeof endDelay !== 'number' || typeof iterations !== 'number') {
        throw new Error('FINISHED_ENDPOINT_TIMING_UNSUPPORTED');
      }
      return { delay, duration, endDelay, iterations };
    });
    for (const animation of animations) {
      animation.effect?.updateTiming({ delay: 0, duration: 2100, endDelay: 0, iterations: 1 });
      animation.currentTime = 2100; animation.finish();
    }
    return { count: animations.length, native: animations.every((animation) => animation.constructor.name === 'CSSAnimation'),
      times: animations.map((animation) => animation.currentTime), states: animations.map((animation) => animation.playState), originalTimings };
  });
  expect({ ...finishedEndpointArrival, originalTimings: undefined }).toEqual({ count: 2, native: true,
    times: [2100, 2100], states: ['finished', 'finished'], originalTimings: undefined });
  await expect.poll(() => page.evaluate(() => { const state = window.__motionEditor.readState(); const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    const animations = frame.contentDocument!.getAnimations(); return { playheadMs: state.playheadMs, currentTimes: state.currentTimes,
      controllerStates: state.playStates, nativeTimes: animations.map((animation) => animation.currentTime),
      nativeStates: animations.map((animation) => animation.playState), slider: Number(document.querySelector<HTMLInputElement>('[data-scrub]')!.value),
      visibleTime: document.querySelector<HTMLOutputElement>('[data-playhead]')!.value };
  })).toEqual({ playheadMs: 2100, currentTimes: [2100, 2100], controllerStates: ['paused', 'paused'],
    nativeTimes: [2100, 2100], nativeStates: ['paused', 'paused'], slider: 2100, visibleTime: '2100 ms' });
  await page.evaluate((timings) => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    frame.contentDocument!.getAnimations().forEach((animation, index) => animation.effect?.updateTiming(timings[index]));
  }, finishedEndpointArrival.originalTimings);
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({ revision: finishedEndpointBaseline.revision,
    contentDigest: finishedEndpointBaseline.contentDigest, exportDigest: finishedEndpointBaseline.exportDigest,
    undoCount: finishedEndpointBaseline.undoCount, redoCount: finishedEndpointBaseline.redoCount });
  expect(commandBytes).toHaveLength(0);
  await previewToolbar.getByRole('button', { name: 'Edit Point 1 waypoint from preview' }).click();
  expect(commandBytes).toHaveLength(0);
  await page.setViewportSize({ width: 1183, height: 900 });
  await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  await expect(page.getByRole('checkbox', { name: /Edit together/ })).not.toBeChecked();
  expect(await readMomentAlignment()).toMatchObject({ authoring: { revision: 0 }, native: { playheadMs: 700, currentTimes: [700, 700],
    playStates: ['paused', 'paused'] }, slider: 700, visibleTime: '700 ms', selectedMoment: 700 });
  expect(commandBytes).toHaveLength(0);
  await page.locator('input[name="shot-moment"][value="0"]').check();
  await expect(workspace.locator('[data-shot-moment-time]')).toBeDisabled();
  await expect(workspace.locator('[data-shot-remove-moment]')).toBeDisabled();
  const rejectedTimingBaseline = await page.evaluate(() => ({ authoring: window.__motionEditor.inspectAuthoring(), native: window.__motionEditor.readState(),
    srcdoc: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc,
    undoDisabled: (document.querySelector<HTMLButtonElement>('[data-undo]')!).disabled }));
  expect(await page.evaluate(() => ({ authoring: window.__motionEditor.inspectAuthoring(), native: window.__motionEditor.readState(),
    srcdoc: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc,
    undoDisabled: (document.querySelector<HTMLButtonElement>('[data-undo]')!).disabled }))).toEqual(rejectedTimingBaseline);
  expect(commandBytes).toHaveLength(0);
  await page.locator('input[name="shot-moment"][value="700"]').check();
  await page.evaluate(() => { const handles = [...document.querySelectorAll<HTMLElement>('[data-trajectory-overlay] [data-keyframe-id]')];
    (window as unknown as { __alignmentNodes: Map<string, HTMLElement> }).__alignmentNodes = new Map(handles.map((handle) => [handle.dataset.keyframeId!, handle])); });
  let priorNativeTimeMs = 700;
  for (const timeMs of [0, 700, 2100, 700]) {
    expect(await page.evaluate(({ priorNativeTimeMs, targetTimeMs }) => { const animations = document.querySelector<HTMLIFrameElement>('[data-preview]')!.contentDocument!.getAnimations();
      return animations.length > 0 && animations.every((animation) => animation.constructor.name === 'CSSAnimation' && animation.effect?.constructor.name === 'KeyframeEffect'
        && animation.timeline?.constructor.name === 'DocumentTimeline' && animation.playState === 'paused' && typeof animation.currentTime === 'number'
        && Math.abs(animation.currentTime - priorNativeTimeMs) <= .001 && Math.abs(animation.currentTime - targetTimeMs) > .001);
    }, { priorNativeTimeMs, targetTimeMs: timeMs })).toBe(true);
    await page.locator('[data-scrub]').fill(String(timeMs));
    expect(await readMomentAlignment()).toMatchObject({ authoring: { revision: 0 }, native: { playheadMs: timeMs, currentTimes: [timeMs, timeMs],
      playStates: ['paused', 'paused'] }, slider: timeMs, visibleTime: `${timeMs} ms`, selectedMoment: 700 });
    expect(await page.evaluate((requestedTimeMs) => { const animations = document.querySelector<HTMLIFrameElement>('[data-preview]')!.contentDocument!.getAnimations();
      return animations.length > 0 && animations.every((animation) => animation.constructor.name === 'CSSAnimation' && animation.effect?.constructor.name === 'KeyframeEffect'
        && animation.timeline?.constructor.name === 'DocumentTimeline' && animation.playState === 'paused'
        && typeof animation.currentTime === 'number' && Math.abs(animation.currentTime - requestedTimeMs) <= .001); }, timeMs)).toBe(true);
    priorNativeTimeMs = timeMs;
  }
  await page.locator('[data-trajectory-overlay] [data-keyframe-id][data-time-ms="0"]').click();
  expect(await readMomentAlignment()).toMatchObject({ authoring: { revision: 0 }, native: { playheadMs: 0, currentTimes: [0, 0],
    playStates: ['paused', 'paused'] }, slider: 0, visibleTime: '0 ms', selectedMoment: 0 });
  await page.locator('input[name="shot-moment"][value="700"]').check();
  expect(await readMomentAlignment()).toMatchObject({ authoring: { revision: 0 }, native: { playheadMs: 700, currentTimes: [700, 700],
    playStates: ['paused', 'paused'] }, slider: 700, visibleTime: '700 ms', selectedMoment: 700 });
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-trajectory-overlay] [data-keyframe-id]')]
    .every((handle) => (window as unknown as { __alignmentNodes: Map<string, HTMLElement> }).__alignmentNodes.get(handle.dataset.keyframeId!) === handle
      && handle.isConnected))).toBe(true);
  expect(commandBytes).toHaveLength(0);
  await expect(page.locator('[data-shot-object-bar]')).toBeInViewport();
  await expect(page.locator('[data-preview]')).toBeInViewport();
  await expect(page.locator('.transport')).toBeInViewport();
  await expect(page.locator('[data-undo]')).toBeInViewport();
  await expect(page.locator('[data-trajectory-overlay] [aria-pressed="true"]')).toBeInViewport();
  await expect(page.locator('.workflow')).not.toBeVisible();
  await expect(page.locator('.branch-controls')).not.toBeVisible();
  const readSpatialProof = async (targetIndex: number, expectedSampleCount: number) => {
    await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
    await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectShotWorkspace().geometry.length)).toBe(expectedSampleCount);
    return page.evaluate((index) => { const inspected = window.__motionEditor.inspectShotWorkspace(); const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      const overlay = document.querySelector<HTMLElement>('[data-trajectory-overlay]')!; const frameRect = frame.getBoundingClientRect(); const overlayRect = overlay.getBoundingClientRect();
      const animations = frame.contentDocument!.getAnimations(); return { targetIndex: index, projection: inspected.projection,
        rootEdgeDeltasDevicePixels: { left: Math.abs(frameRect.left - overlayRect.left) * devicePixelRatio,
          top: Math.abs(frameRect.top - overlayRect.top) * devicePixelRatio, right: Math.abs(frameRect.right - overlayRect.right) * devicePixelRatio,
          bottom: Math.abs(frameRect.bottom - overlayRect.bottom) * devicePixelRatio },
        samples: inspected.geometry.map(({ elementId: _elementId, ...sample }) => sample), fontsReady: frame.contentDocument!.fonts.status === 'loaded',
        nativeTypes: animations.map((animation) => ({ animation: animation.constructor.name, effect: animation.effect?.constructor.name,
          timeline: animation.timeline?.constructor.name, currentTime: animation.currentTime, playState: animation.playState })) }; }, targetIndex);
  };
  const spatialTargets = [await readSpatialProof(0, 3)];
  const initialPrimaryCommitId = await page.evaluate(() => (window.__motionEditor.inspectShotWorkspace() as unknown as {
    geometryPump: { lastCommittedRequestId: number | null } }).geometryPump.lastCommittedRequestId);
  await primaryInputs.nth(1).check();
  await expect(primaryInputs.nth(1)).toBeChecked();
  expect((await page.evaluate(() => window.__motionEditor.inspectShotWorkspace())).selectedElementIds).toEqual([targetElementIds[1]]);
  await expect(page.locator('[data-move-together]')).toBeEnabled();
  spatialTargets.push(await readSpatialProof(1, 3));
  const changedPrimaryCommitId = await page.evaluate(() => (window.__motionEditor.inspectShotWorkspace() as unknown as {
    geometryPump: { lastCommittedRequestId: number | null } }).geometryPump.lastCommittedRequestId);
  expect(changedPrimaryCommitId).toBeGreaterThan(initialPrimaryCommitId!);
  await primaryInputs.nth(0).check();
  await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectShotWorkspace().geometry.length)).toBe(3);
  const readInteractiveInventory = () => page.evaluate(() => ({
    controls: [...document.querySelectorAll<HTMLInputElement>('input[name="shot-moment"]')].map((input) => Number(input.value)),
    handles: [...document.querySelectorAll<HTMLElement>('[data-trajectory-overlay] [data-keyframe-id]')].map((handle) => ({
      keyframeId: handle.dataset.keyframeId, timeMs: Number(handle.dataset.timeMs),
    })),
  }));
  expect(await readInteractiveInventory()).toMatchObject({ controls: [0, 700, 2100],
    handles: [{ timeMs: 0 }, { timeMs: 700 }, { timeMs: 2100 }] });
  const beforeResizeCommitId = await page.evaluate(() => (window.__motionEditor.inspectShotWorkspace() as unknown as {
    geometryPump: { lastCommittedRequestId: number | null } }).geometryPump.lastCommittedRequestId);
  await page.setViewportSize({ width: 1182, height: 900 });
  await expect.poll(() => page.evaluate(() => (window.__motionEditor.inspectShotWorkspace() as unknown as {
    geometryPump: { lastCommittedRequestId: number | null } }).geometryPump.lastCommittedRequestId)).not.toBe(beforeResizeCommitId);
  await page.setViewportSize({ width: 1183, height: 900 });
  await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  for (const target of spatialTargets) {
    expect(target.projection).toMatchObject({ schemaVersion: 'motion.preview-overlay-projection.v1', sourceWidthCssPixels: 800, sourceHeightCssPixels: 450 });
    expect(Math.abs(target.projection!.scaleX - target.projection!.scaleY) * 800 * target.projection!.devicePixelRatio).toBeLessThanOrEqual(1);
    expect(Object.values(target.rootEdgeDeltasDevicePixels).every((delta) => delta <= 1)).toBe(true);
    expect(target.samples.map((sample) => sample.timeMs)).toEqual([0, 700, 2100]);
    expect(target.samples.every((sample) => Object.values(sample.deltasDevicePixels).every((delta) => delta <= 1))).toBe(true);
    expect(target.fontsReady).toBe(true);
    expect(target.nativeTypes.length).toBeGreaterThan(0); expect(target.nativeTypes.every((native) => native.animation === 'CSSAnimation'
      && native.effect === 'KeyframeEffect' && native.timeline === 'DocumentTimeline' && native.currentTime === 700 && native.playState === 'paused')).toBe(true);
  }
  return { page, directory, humanCapability, agentCapability, root, port, seed, targetElementIds, inheritedTargets, runtimeSeedPath, processHandle, addresses, editorUrl, serviceUrl, commandBytes, preparationBytes, commandStatuses, consoleErrors, workspace, layoutContract, readGeometry, closedGeometry, advancedMotion, objectInputs, primaryInputs, focusedLayout, beforePathAlignment, readMomentAlignment, awaitShotMutationSettlement, previewToolbar, referenceSegments, referenceWaypoints, referenceGeometryBeforeSwitch, canvasObjectTargets, selectedReferenceSegments, settledObjectBounds, finishedEndpointBaseline, finishedEndpointArrival, rejectedTimingBaseline, priorNativeTimeMs, readSpatialProof, spatialTargets, initialPrimaryCommitId, changedPrimaryCommitId, readInteractiveInventory, beforeResizeCommitId };
}

