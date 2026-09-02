import { expect, test } from '@playwright/test';
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

test.describe.configure({ mode: 'serial' });
let processHandle: ChildProcess | undefined; let directory = ''; let editorUrl = ''; let serviceUrl = '';
let humanCapability = ''; let agentCapability = '';

test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lineage-motion-browser-'));
  humanCapability = randomBytes(32).toString('base64url'); agentCapability = randomBytes(32).toString('base64url');
  const root = resolve(import.meta.dirname, '../../..'); const port = 42000 + Math.floor(Math.random() * 1000);
  processHandle = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: root, env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'project.sqlite'), PHASE3_EDITOR_PORT: String(port),
      PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: agentCapability },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const addresses = await new Promise<{ editorUrl: string; serviceUrl: string }>((resolveAddress, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('PHASE3_SERVER_TIMEOUT')), 10000);
    processHandle!.stdout!.on('data', (chunk) => { output += chunk.toString();
      const line = output.split('\n').find((candidate) => candidate.startsWith('{'));
      if (line) { clearTimeout(timer); resolveAddress(JSON.parse(line)); }
    });
    processHandle!.once('exit', (code) => { clearTimeout(timer); reject(new Error(`PHASE3_SERVER_EXIT_${code}`)); });
  });
  ({ editorUrl, serviceUrl } = addresses);
  await expect.poll(async () => { try { return (await fetch(editorUrl)).ok; } catch { return false; } }).toBe(true);
});

test('durable chrome, canonical state, and compiler preview publish atomically across delay and failure', async ({ page }) => {
  const commandBodies: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/commands')) commandBodies.push(request.postData() ?? '');
  });
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.evaluate(() => window.__motionEditor.disconnectEvents());
  const baseline = await page.evaluate(() => ({
    authoring: window.__motionEditor.inspectAuthoring(),
    collaboration: window.__motionEditor.inspectCollaboration(),
    headerRevision: document.querySelector('[data-collaboration-revision]')?.textContent,
    preview: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc,
  }));

  await page.evaluate(() => window.__motionEditor.delayNextPublication());
  await page.getByRole('radio', { name: /Orb/ }).click();
  await page.getByRole('button', { name: 'Create Orb opacity track' }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().publicationState)).toBe('pending');
  await expect(page.locator('main')).toHaveAttribute('data-publication-state', 'pending');
  expect(await page.evaluate(() => ({
    authoring: window.__motionEditor.inspectAuthoring(),
    collaboration: window.__motionEditor.inspectCollaboration(),
    headerRevision: document.querySelector('[data-collaboration-revision]')?.textContent,
    preview: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc,
  }))).toMatchObject({
    authoring: { revision: baseline.authoring.revision, compiledHtml: baseline.authoring.compiledHtml },
    collaboration: { workspace: { revision: baseline.collaboration.workspace!.revision } },
    headerRevision: baseline.headerRevision,
    preview: baseline.preview,
  });
  const commandsWhilePending = commandBodies.length;
  await page.getByRole('button', { name: 'Create Orb opacity track' }).click();
  expect(commandBodies).toHaveLength(commandsWhilePending);
  await page.evaluate(() => document.querySelector<HTMLFormElement>('[data-branch-form]')!.requestSubmit());
  expect(await page.evaluate(() => window.__motionEditor.inspectCollaboration().diagnostic?.code)).toBe('PUBLICATION_PENDING');
  await page.evaluate(() => { document.querySelector<HTMLInputElement>('[data-claim-id]')!.value = 'claim_pending_must_not_queue';
    document.querySelector<HTMLFormElement>('[data-revoke-form]')!.requestSubmit(); });
  expect(await page.evaluate(() => window.__motionEditor.inspectCollaboration().diagnostic?.code)).toBe('PUBLICATION_PENDING');
  expect(commandBodies).toHaveLength(commandsWhilePending);

  await page.evaluate(() => window.__motionEditor.releasePublication());
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().publicationState)).toBe('settled');
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
  expect(await page.evaluate(() => ({
    revision: window.__motionEditor.inspectAuthoring().revision,
    durableRevision: window.__motionEditor.inspectCollaboration().workspace?.revision,
    headerRevision: document.querySelector('[data-collaboration-revision]')?.textContent,
    previewMatchesCompiler: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc === window.__motionEditor.compiledHtml,
  }))).toEqual({ revision: 1, durableRevision: 1, headerRevision: '1', previewMatchesCompiler: true });
  expect(commandBodies).toHaveLength(commandsWhilePending);

  const coherentRevisionOne = await page.evaluate(() => ({
    authoring: window.__motionEditor.inspectAuthoring(),
    collaboration: window.__motionEditor.inspectCollaboration(),
    headerRevision: document.querySelector('[data-collaboration-revision]')?.textContent,
    preview: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc,
  }));
  let releaseRevisionDiscovery: () => void = () => undefined; let revisionDiscoveryRequests = 0;
  const revisionDiscoveryGate = new Promise<void>((resolve) => { releaseRevisionDiscovery = resolve; });
  await page.route('**/api/v1/documents/*/revision', async (route) => {
    revisionDiscoveryRequests += 1; await revisionDiscoveryGate; await route.continue();
  });
  await page.evaluate(() => { document.querySelector<HTMLInputElement>('[data-claim-id]')!.value = 'claim_started_while_settled';
    document.querySelector<HTMLFormElement>('[data-revoke-form]')!.requestSubmit(); });
  await expect.poll(() => revisionDiscoveryRequests).toBe(1);
  await page.evaluate(() => window.__motionEditor.failNextPublication());
  await page.locator('[data-duration]').fill('1200');
  await page.getByRole('button', { name: 'Apply duration' }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().publicationState)).toBe('failed');
  await expect(page.locator('main')).toHaveAttribute('data-publication-state', 'failed');
  expect(await page.evaluate(() => ({
    authoring: window.__motionEditor.inspectAuthoring(),
    collaboration: window.__motionEditor.inspectCollaboration(),
    headerRevision: document.querySelector('[data-collaboration-revision]')?.textContent,
    preview: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc,
  }))).toMatchObject({
    authoring: { revision: coherentRevisionOne.authoring.revision, compiledHtml: coherentRevisionOne.authoring.compiledHtml,
      publicationFailureCode: 'PREVIEW_PUBLICATION_TEST_FAILURE' },
    collaboration: { workspace: { revision: coherentRevisionOne.collaboration.workspace!.revision } },
    headerRevision: coherentRevisionOne.headerRevision,
    preview: coherentRevisionOne.preview,
  });
  const commandsBeforeQueuedClaimRelease = commandBodies.length;
  releaseRevisionDiscovery();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectCollaboration().diagnostic?.code)).toBe('PUBLICATION_FAILED');
  expect(commandBodies).toHaveLength(commandsBeforeQueuedClaimRelease);
  const commandsWhileFailed = commandBodies.length;
  await page.getByRole('button', { name: 'Apply duration' }).click();
  expect(commandBodies).toHaveLength(commandsWhileFailed);
  await page.evaluate(() => document.querySelector<HTMLFormElement>('[data-branch-form]')!.requestSubmit());
  expect(await page.evaluate(() => window.__motionEditor.inspectCollaboration().diagnostic?.code)).toBe('PUBLICATION_FAILED');
  await page.evaluate(() => { document.querySelector<HTMLInputElement>('[data-claim-id]')!.value = 'claim_failed_must_not_queue';
    document.querySelector<HTMLFormElement>('[data-revoke-form]')!.requestSubmit(); });
  expect(await page.evaluate(() => window.__motionEditor.inspectCollaboration().diagnostic?.code)).toBe('PUBLICATION_FAILED');
  expect(commandBodies).toHaveLength(commandsWhileFailed);
  expect(await page.evaluate(() => window.__motionEditor.retryPublication())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().publicationState)).toBe('settled');
  expect(await page.evaluate(() => ({
    revision: window.__motionEditor.inspectAuthoring().revision,
    durableRevision: window.__motionEditor.inspectCollaboration().workspace?.revision,
    headerRevision: document.querySelector('[data-collaboration-revision]')?.textContent,
    previewMatchesCompiler: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc === window.__motionEditor.compiledHtml,
  }))).toEqual({ revision: 2, durableRevision: 2, headerRevision: '2', previewMatchesCompiler: true });
  expect(commandBodies).toHaveLength(commandsWhileFailed);
});

test('Shot 1 workspace commits five durable operations and exact undo/redo through compiler-native preview', async ({ page }) => {
  await page.setViewportSize({ width: 1183, height: 900 });
  processHandle?.kill('SIGTERM');
  if (processHandle?.exitCode === null) await new Promise((resolveExit) => processHandle!.once('exit', resolveExit));
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
  processHandle = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
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
  editorUrl = addresses.editorUrl; serviceUrl = addresses.serviceUrl;
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
  const workspace = page.locator('[data-shot-workspace]');
  await expect(workspace).toBeVisible();
  const objectInputs = workspace.locator('[data-shot-targets] input[type="checkbox"]');
  const primaryInputs = workspace.locator('[data-shot-targets] input[name="shot-primary"]');
  await expect(objectInputs).toHaveCount(0);
  await expect(primaryInputs).toHaveCount(2); await expect(primaryInputs.nth(0)).toBeChecked();
  expect(await primaryInputs.evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value))).toEqual(targetElementIds);
  await expect(workspace.locator('[data-move-together]')).not.toBeChecked();
  const focusedLayout = await page.evaluate(() => { const workspace = document.querySelector<HTMLElement>('[data-shot-workspace]')!;
    const preview = document.querySelector<HTMLElement>('.preview-panel')!; const workflow = document.querySelector<HTMLElement>('.workflow')!;
    const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!; const workspaceRect = workspace.getBoundingClientRect();
    const previewRect = preview.getBoundingClientRect(); const frameRect = frame.getBoundingClientRect(); return {
      shotActive: document.querySelector('.editor-shell')!.classList.contains('shot-active'), workflowDisplay: getComputedStyle(workflow).display,
      aligned: Math.abs(workspaceRect.bottom - previewRect.top) < 2, controlsVisible: workspaceRect.top >= 0 && workspaceRect.top < innerHeight,
      nativeStageVisible: frameRect.top >= 0 && frameRect.bottom <= innerHeight, runway: document.querySelector<HTMLElement>('.preview-stage')!.dataset.runwayCssPixels,
    }; });
  expect(focusedLayout).toEqual({ shotActive: true, workflowDisplay: 'none', aligned: true, controlsVisible: true, nativeStageVisible: true, runway: '72' });
  await expect(workspace.locator('input[name="shot-moment"]')).toHaveCount(3);
  expect(await workspace.locator('input[name="shot-moment"]').evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value)))).toEqual([0, 700, 2100]);
  await expect(workspace.locator('input[name="shot-moment"][value="700"]')).toBeChecked();
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
      && width >= targetRect.width && height >= targetRect.height
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
  await expect(page.getByRole('checkbox', { name: /Move together/ })).not.toBeChecked();
  expect(await readMomentAlignment()).toMatchObject({ authoring: { revision: 0 }, native: { playheadMs: 700, currentTimes: [700, 700],
    playStates: ['paused', 'paused'] }, slider: 700, visibleTime: '700 ms', selectedMoment: 700 });
  expect(commandBytes).toHaveLength(0);
  await workspace.locator('input[name="shot-moment"][value="0"]').check();
  await expect(workspace.locator('[data-shot-moment-time]')).toBeDisabled();
  await expect(workspace.locator('[data-shot-remove-moment]')).toBeDisabled();
  const rejectedTimingBaseline = await page.evaluate(() => ({ authoring: window.__motionEditor.inspectAuthoring(), native: window.__motionEditor.readState(),
    srcdoc: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc,
    undoDisabled: (document.querySelector<HTMLButtonElement>('[data-undo]')!).disabled }));
  expect(await page.evaluate(() => ({ authoring: window.__motionEditor.inspectAuthoring(), native: window.__motionEditor.readState(),
    srcdoc: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc,
    undoDisabled: (document.querySelector<HTMLButtonElement>('[data-undo]')!).disabled }))).toEqual(rejectedTimingBaseline);
  expect(commandBytes).toHaveLength(0);
  await workspace.locator('input[name="shot-moment"][value="700"]').check();
  await page.evaluate(() => { const handles = [...document.querySelectorAll<HTMLElement>('[data-trajectory-overlay] [data-keyframe-id]')];
    (window as unknown as { __alignmentNodes: Map<string, HTMLElement> }).__alignmentNodes = new Map(handles.map((handle) => [handle.dataset.keyframeId!, handle])); });
  for (const timeMs of [0, 700, 2100, 700]) {
    await workspace.locator(`input[name="shot-moment"][value="${timeMs}"]`).check();
    expect(await readMomentAlignment()).toMatchObject({ authoring: { revision: 0 }, native: { playheadMs: timeMs, currentTimes: [timeMs, timeMs],
      playStates: ['paused', 'paused'] }, slider: timeMs, visibleTime: `${timeMs} ms`, selectedMoment: timeMs });
  }
  await page.locator('[data-trajectory-overlay] [data-keyframe-id][data-time-ms="0"]').click();
  expect(await readMomentAlignment()).toMatchObject({ authoring: { revision: 0 }, native: { playheadMs: 0, currentTimes: [0, 0],
    playStates: ['paused', 'paused'] }, slider: 0, visibleTime: '0 ms', selectedMoment: 0 });
  await workspace.locator('input[name="shot-moment"][value="700"]').check();
  expect(await readMomentAlignment()).toMatchObject({ authoring: { revision: 0 }, native: { playheadMs: 700, currentTimes: [700, 700],
    playStates: ['paused', 'paused'] }, slider: 700, visibleTime: '700 ms', selectedMoment: 700 });
  expect(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-trajectory-overlay] [data-keyframe-id]')]
    .every((handle) => (window as unknown as { __alignmentNodes: Map<string, HTMLElement> }).__alignmentNodes.get(handle.dataset.keyframeId!) === handle
      && handle.isConnected))).toBe(true);
  expect(commandBytes).toHaveLength(0);
  await expect(page.locator('[data-shot-workspace]')).toBeInViewport();
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
  await expect(page.getByRole('checkbox', { name: /Move together/ })).toBeChecked();
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
  await workspace.locator('[data-shot-advanced] summary').click();
  const x = page.locator('[data-pose-form] input[name="x"]'); await x.fill(String(Number(await x.inputValue()) + 8));
  await page.getByRole('button', { name: 'Apply pose' }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(2);
  await awaitShotMutationSettlement(2, 700);
  await workspace.locator('[data-shot-advanced] summary').click();
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
  await workspace.locator('[data-shot-advanced] summary').click();
  await page.locator('[data-shot-settled]').fill('1820'); await page.locator('[data-shot-hold]').click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(5);
  expect(commandBytes.slice(2, 5).map((bytes) => { const wire = JSON.parse(bytes) as { expectedRevision: number;
    command: { kind: string; expectedRevision: number } }; return [wire.command.kind, wire.expectedRevision, wire.command.expectedRevision]; }))
    .toEqual([
      ['motion.keyframe-group-time.set', 2, 2],
      ['motion.keyframe-group-easing.set', 3, 3],
      ['motion.settled-hold.set', 4, 4],
    ]);
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
  const advanced = workspace.locator('[data-shot-advanced]');
  if (await advanced.getAttribute('open') !== null) await advanced.locator('summary').click();
  const canvasBeforeAdvanced = await page.locator('[data-preview]').boundingBox();
  await advanced.locator('summary').click();
  expect(await page.locator('[data-preview]').boundingBox()).toEqual(canvasBeforeAdvanced);
  await advanced.locator('summary').click();
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
  await workspace.locator('input[name="shot-moment"][value="840"]').check();
  await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  const nonCurrent = page.locator('[data-trajectory-overlay] [data-keyframe-id][data-time-ms="0"]');
  const nonCurrentBox = await nonCurrent.boundingBox(); expect(nonCurrentBox).not.toBeNull();
  const waypointHit = await page.evaluate(({ x, y }) => (document.elementFromPoint(x, y) as HTMLElement | null)
    ?.closest<HTMLElement>('[data-keyframe-id]')?.dataset.timeMs ?? null,
  { x: nonCurrentBox!.x + nonCurrentBox!.width / 2, y: nonCurrentBox!.y + nonCurrentBox!.height / 2 });
  expect(waypointHit).toBe('0');
  const selectionRevision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
  await nonCurrent.click(); expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(selectionRevision);
  await workspace.locator('input[name="shot-moment"][value="840"]').check(); await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  const dragBox = await page.locator('[data-trajectory-overlay] [data-keyframe-id][data-time-ms="0"]').boundingBox();
  await page.mouse.move(dragBox!.x + dragBox!.width / 2, dragBox!.y + dragBox!.height / 2); await page.mouse.down();
  await page.mouse.move(dragBox!.x + dragBox!.width / 2 + 12, dragBox!.y + dragBox!.height / 2 + 6, { steps: 3 }); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(selectionRevision + 1);
  expect((JSON.parse(commandBytes.at(-1)!) as { command: { kind: string } }).command.kind).toBe('motion.transform-waypoints.translate');
  await page.locator('[data-undo]').click(); await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(selectionRevision + 2);
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().contentDigest)).toBe(directBaseline);
  expect(consoleErrors).toEqual([]);
});

test('exact-duration Shot workspace retains a post-endpoint native inspection position without mutation', async ({ page }) => {
  processHandle?.kill('SIGTERM');
  if (processHandle?.exitCode === null) await new Promise((resolveExit) => processHandle!.once('exit', resolveExit));
  const root = resolve(import.meta.dirname, '../../..'); const port = 43500 + Math.floor(Math.random() * 250);
  const seed = createTrajectorySeed(root); seed.durationMs = 2100; seed.cues = seed.cues.filter((cue) => cue.timeMs <= seed.durationMs);
  for (const rule of seed.rules) {
    for (const track of rule.tracks.filter((candidate) => candidate.property === 'transform')) {
      track.keyframes = track.keyframes.filter((keyframe) => keyframe.offset <= 0.3);
      for (const expanded of seed.tracks.filter((candidate) => candidate.ruleId === rule.id && candidate.property === 'transform')) {
        expanded.keyframeIds = track.keyframes.map((keyframe) => keyframe.id);
      }
    }
  }
  const runtimeSeedPath = join(directory, 'trajectory-exact-duration.json');
  await writeFile(runtimeSeedPath, `${JSON.stringify(seed)}\n`);
  processHandle = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: root, env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'trajectory-exact-duration.sqlite'),
      PHASE3_EDITOR_PORT: String(port), PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: agentCapability,
      LANDING_SHOT1_WORKSPACE: '1', LANDING_SHOT1_DOCUMENT_PATH: runtimeSeedPath },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const address = await new Promise<string>((resolveAddress, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('EXACT_DURATION_SERVER_TIMEOUT')), 10000);
    processHandle!.stdout!.on('data', (chunk) => { output += chunk.toString(); const line = output.split('\n').find((candidate) => candidate.startsWith('{'));
      if (line) { clearTimeout(timer); resolveAddress((JSON.parse(line) as { editorUrl: string }).editorUrl); } });
    processHandle!.once('exit', (code) => { clearTimeout(timer); reject(new Error(`EXACT_DURATION_SERVER_EXIT_${code}`)); });
  });
  await expect.poll(async () => { try { return (await fetch(address)).ok; } catch { return false; } }).toBe(true);
  const commands: string[] = []; page.on('request', (request) => {
    if (request.url().endsWith('/api/v1/commands')) commands.push(request.postData() ?? '');
  });
  await page.goto(address); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const baseline = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await expect(page.locator('[data-scrub]')).toHaveAttribute('max', '2101');
  for (const timeMs of [0, 2100, 2101]) {
    const immediate = await page.locator('[data-scrub]').evaluate((input: HTMLInputElement, requestedTimeMs) => { let captured;
      const capture = () => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
        const animations = frame.contentDocument!.getAnimations(); const state = window.__motionEditor.readState();
        return { maximum: Number(input.max), slider: Number(input.value), playheadMs: state.playheadMs,
          controllerTimes: state.currentTimes, nativeTimes: animations.map((animation) => animation.currentTime),
          nativeStates: animations.map((animation) => animation.playState), nativeIdentity: animations.map((animation) => ({
            animation: animation.constructor.name, effect: animation.effect?.constructor.name, timeline: animation.timeline?.constructor.name })),
          compilerEqual: frame.srcdoc === window.__motionEditor.compiledHtml };
      };
      input.addEventListener('input', () => { captured = capture(); }, { once: true }); input.value = String(requestedTimeMs);
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: String(requestedTimeMs) }));
      return captured;
    }, timeMs);
    const stable = await page.evaluate(async () => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      await new Promise((resolveFrame) => frame.contentWindow!.requestAnimationFrame(() => frame.contentWindow!.requestAnimationFrame(resolveFrame)));
      const input = document.querySelector<HTMLInputElement>('[data-scrub]')!; const animations = frame.contentDocument!.getAnimations();
      const state = window.__motionEditor.readState(); return { maximum: Number(input.max), slider: Number(input.value), playheadMs: state.playheadMs,
        controllerTimes: state.currentTimes, nativeTimes: animations.map((animation) => animation.currentTime),
        nativeStates: animations.map((animation) => animation.playState), nativeIdentity: animations.map((animation) => ({
          animation: animation.constructor.name, effect: animation.effect?.constructor.name, timeline: animation.timeline?.constructor.name })),
        compilerEqual: frame.srcdoc === window.__motionEditor.compiledHtml };
    });
    const expected = { maximum: 2101, slider: timeMs, playheadMs: timeMs, controllerTimes: [timeMs, timeMs], nativeTimes: [timeMs, timeMs],
      nativeStates: ['paused', 'paused'], nativeIdentity: Array.from({ length: 2 }, () => ({ animation: 'CSSAnimation', effect: 'KeyframeEffect',
        timeline: 'DocumentTimeline' })), compilerEqual: true };
    expect(immediate).toEqual(expected); expect(stable).toEqual(expected);
  }
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({ revision: baseline.revision,
    contentDigest: baseline.contentDigest, exportDigest: baseline.exportDigest, undoCount: baseline.undoCount, redoCount: baseline.redoCount });
  expect(commands).toEqual([]);
});

test('an incompatible Shot revision stays fail-closed and offers non-destructive recovery', async ({ page }) => {
  processHandle?.kill('SIGTERM');
  if (processHandle?.exitCode === null) await new Promise((resolveExit) => processHandle!.once('exit', resolveExit));
  const root = resolve(import.meta.dirname, '../../..'); const port = 43200 + Math.floor(Math.random() * 250);
  const seed = createTrajectorySeed(root);
  for (const rule of seed.rules) {
    for (const track of rule.tracks.filter((candidate) => candidate.property === 'transform')) {
      track.keyframes = track.keyframes.filter((keyframe) => keyframe.offset !== 0.3);
      for (const expanded of seed.tracks.filter((candidate) => candidate.ruleId === rule.id && candidate.property === 'transform')) {
        expanded.keyframeIds = track.keyframes.map((keyframe) => keyframe.id);
      }
    }
  }
  const seedPath = join(directory, 'trajectory-incompatible.json'); await writeFile(seedPath, `${JSON.stringify(seed)}\n`);
  processHandle = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: root, env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'incompatible.sqlite'), PHASE3_EDITOR_PORT: String(port),
      PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: agentCapability, LANDING_SHOT1_WORKSPACE: '1',
      LANDING_SHOT1_DOCUMENT_PATH: seedPath }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const addresses = await new Promise<{ editorUrl: string }>((resolveAddress, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('INCOMPATIBLE_SERVER_TIMEOUT')), 10000);
    processHandle!.stdout!.on('data', (chunk) => { output += chunk.toString(); const line = output.split('\n').find((candidate) => candidate.startsWith('{'));
      if (line) { clearTimeout(timer); resolveAddress(JSON.parse(line)); } });
    processHandle!.once('exit', (code) => { clearTimeout(timer); reject(new Error(`INCOMPATIBLE_SERVER_EXIT_${code}`)); });
  });
  const commands: string[] = []; page.on('request', (request) => { if (request.url().endsWith('/api/v1/commands')) commands.push(request.postData() ?? ''); });
  await page.goto(addresses.editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const workspace = page.locator('[data-shot-workspace]'); const recovery = workspace.locator('[data-shot-recovery]');
  await expect(workspace).toHaveAttribute('data-editable', 'false'); await expect(recovery).toBeVisible();
  await expect(page.getByRole('button', { name: 'Path' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Retry Shot workspace' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Open track inspector' })).toBeEnabled();
  await expect(recovery).toContainText('The committed document was not changed.');
  await expect(recovery).toContainText('Restore a compatible Shot 1 revision or source, then retry');
  const before = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await page.getByRole('button', { name: 'Retry Shot workspace' }).click();
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toEqual(before); expect(commands).toHaveLength(0);
  await expect(workspace).toHaveAttribute('data-editable', 'false'); await expect(recovery).toBeVisible();
  await page.getByRole('button', { name: 'Open track inspector' }).click();
  await expect(page.locator('.inspect-panel')).toHaveAttribute('open', ''); await expect(page.locator('.inspection-content')).toBeVisible();
  expect(commands).toHaveLength(0);
});

test('Shot 1 keeps asymmetric primary inventories and gates grouping to shared canonical moments', async ({ page }) => {
  processHandle?.kill('SIGTERM');
  if (processHandle?.exitCode === null) await new Promise((resolveExit) => processHandle!.once('exit', resolveExit));
  const root = resolve(import.meta.dirname, '../../..'); const port = 43500 + Math.floor(Math.random() * 300);
  const seed = createTrajectorySeed(root); const targetElementIds = seed.elements.map((element) => element.id).sort();
  const track = seed.tracks.find((candidate) => candidate.elementId === targetElementIds[0] && candidate.property === 'transform');
  const ruleTrack = track && seed.rules.find((rule) => rule.id === track.ruleId)?.tracks.find((candidate) => candidate.property === 'transform');
  const landed = ruleTrack?.keyframes.find((keyframe) => keyframe.offset === 0.1);
  if (!ruleTrack || !landed) throw new Error('ASYMMETRIC_TRAJECTORY_SEED_INVALID');
  landed.value = landed.value.replace(/translate\([^)]*\)/, 'translate(-40px, 170px)');
  ruleTrack.keyframes.push({ ...landed, id: 'kf_asymmetric_1400', offset: 0.2 });
  ruleTrack.keyframes.sort((left, right) => left.offset - right.offset);
  for (const expanded of seed.tracks.filter((candidate) => candidate.ruleId === track.ruleId && candidate.property === 'transform')) {
    expanded.keyframeIds = ruleTrack.keyframes.map((keyframe) => keyframe.id);
  }
  const seedPath = join(directory, 'trajectory-asymmetric.json'); await writeFile(seedPath, `${JSON.stringify(seed)}\n`);
  processHandle = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: root, env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'asymmetric.sqlite'), PHASE3_EDITOR_PORT: String(port),
      PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: agentCapability, LANDING_SHOT1_WORKSPACE: '1',
      LANDING_SHOT1_DOCUMENT_PATH: seedPath }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const addresses = await new Promise<{ editorUrl: string }>((resolveAddress, reject) => { let output = ''; let errorOutput = '';
    const timer = setTimeout(() => reject(new Error('ASYMMETRIC_SERVER_TIMEOUT')), 10000);
    processHandle!.stdout!.on('data', (chunk) => { output += chunk.toString(); const line = output.split('\n').find((candidate) => candidate.startsWith('{'));
      if (line) { clearTimeout(timer); resolveAddress(JSON.parse(line)); } });
    processHandle!.stderr!.on('data', (chunk) => { errorOutput += chunk.toString(); });
    processHandle!.once('exit', (code) => { clearTimeout(timer); reject(new Error(`ASYMMETRIC_SERVER_EXIT_${code}_${errorOutput}`)); });
  });
  await expect.poll(async () => { try { return (await fetch(addresses.editorUrl)).ok; } catch { return false; } }, { timeout: 10000 }).toBe(true);
  const asymmetricCommands: Array<{ schemaVersion: string; kind: string;
    intent?: { elementId?: string; elementIds?: string[] }; payload?: { targets?: Array<{ elementId: string }> } }> = [];
  page.on('request', (request) => { if (!request.url().endsWith('/api/v1/commands')) return;
    const wire = request.postDataJSON() as { command: typeof asymmetricCommands[number] };
    asymmetricCommands.push(wire.command);
  });
  await page.goto(addresses.editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const workspace = page.locator('[data-shot-workspace]');
  const targets = workspace.locator('[data-shot-targets] input[type="checkbox"]');
  const primaries = workspace.locator('[data-shot-targets] input[name="shot-primary"]');
  await expect(targets).toHaveCount(0); await expect(primaries).toHaveCount(2);
  const inventory = () => workspace.locator('input[name="shot-moment"]').evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value)));
  expect(await inventory()).toEqual([0, 700, 1400, 2100]);
  await expect(page.getByRole('button', { name: 'Path' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  const primaryHandles = await page.locator('[data-trajectory-overlay] [data-keyframe-id]').evaluateAll((handles) => handles.map((handle) => ({
    id: (handle as HTMLElement).dataset.keyframeId, timeMs: Number((handle as HTMLElement).dataset.timeMs),
  })));
  expect(primaryHandles.map((handle) => handle.timeMs)).toEqual([0, 700, 1400, 2100]);
  expect(primaryHandles.every((handle) => Boolean(handle.id))).toBe(true);
  const readAsymmetricAlignment = () => page.evaluate(() => { const state = window.__motionEditor.readState(); const inspected = window.__motionEditor.inspectShotWorkspace();
    return { revision: window.__motionEditor.inspectAuthoring().revision, selectedMoment: inspected.momentMs, playheadMs: state.playheadMs,
      currentTimes: state.currentTimes, playStates: state.playStates, slider: Number((document.querySelector('[data-scrub]') as HTMLInputElement).value),
      visibleTime: document.querySelector<HTMLOutputElement>('[data-playhead]')!.value,
      requestId: (inspected as unknown as { geometryPump: { lastCommittedRequestId: number } }).geometryPump.lastCommittedRequestId }; });
  await workspace.locator('input[name="shot-moment"][value="1400"]').check();
  const primaryReconciliationBaseline = await readAsymmetricAlignment();
  expect(primaryReconciliationBaseline).toMatchObject({ revision: 0, selectedMoment: 1400, playheadMs: 1400,
    currentTimes: [1400, 1400], playStates: ['paused', 'paused'], slider: 1400, visibleTime: '1400 ms' });
  await primaries.nth(1).check(); await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  expect(await readAsymmetricAlignment()).toMatchObject({ revision: 0, selectedMoment: 700, playheadMs: 700,
    currentTimes: [700, 700], playStates: ['paused', 'paused'], slider: 700, visibleTime: '700 ms',
    requestId: primaryReconciliationBaseline.requestId + 1 });
  expect(asymmetricCommands).toHaveLength(0);
  await primaries.nth(0).check(); await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  const offFrameHandle = page.locator('[data-trajectory-overlay] [data-keyframe-id][data-time-ms="700"]');
  const runwayProof = await offFrameHandle.evaluate((handle) => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    const stage = document.querySelector<HTMLElement>('.preview-stage')!; const handleRect = handle.getBoundingClientRect();
    const frameRect = frame.getBoundingClientRect(); const stageRect = stage.getBoundingClientRect();
    const center = { x: (handleRect.left + handleRect.right) / 2, y: (handleRect.top + handleRect.bottom) / 2 };
    return { partial: handleRect.left < frameRect.left && handleRect.right > frameRect.left,
      whollyInRunway: handleRect.left >= stageRect.left && handleRect.right <= stageRect.right
        && handleRect.top >= stageRect.top && handleRect.bottom <= stageRect.bottom,
      centerHit: document.elementFromPoint(center.x, center.y) === handle, center };
  });
  expect(runwayProof).toMatchObject({ partial: true, whollyInRunway: true, centerHit: true });
  const offFrameBefore = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await page.mouse.move(runwayProof.center.x, runwayProof.center.y); await page.mouse.down();
  await page.mouse.move(runwayProof.center.x + 8, runwayProof.center.y - 4); await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
  const offFrameAfter = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(offFrameAfter.contentDigest).not.toBe(offFrameBefore.contentDigest);
  expect((await page.evaluate(() => window.__motionEditor.inspectShotWorkspace())).geometry
    .every((sample) => Object.values(sample.deltasDevicePixels).every((delta) => delta <= 1))).toBe(true);
  await primaries.nth(1).check(); await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
  expect(await inventory()).toEqual([0, 700, 2100]);
  expect(await page.locator('[data-trajectory-overlay] [data-keyframe-id]').evaluateAll((handles) => handles.map((handle) => Number((handle as HTMLElement).dataset.timeMs))))
    .toEqual([0, 700, 2100]);
  const moveTogether = workspace.locator('[data-move-together]'); await expect(moveTogether).toBeEnabled(); await moveTogether.check();
  const assertGroupedState = async (moments: number[]) => {
    await expect.poll(() => page.evaluate(() => (window.__motionEditor.inspectAuthoring() as unknown as {
      publicationPending: boolean }).publicationPending)).toBe(false);
    await expect(page.locator('main')).toHaveAttribute('data-publication-pending', 'false');
    await expect(primaries.nth(1)).toBeChecked(); await expect(moveTogether).toBeChecked();
    await expect(page.locator('[data-trajectory-overlay]')).toHaveAttribute('aria-busy', 'false');
    expect(await inventory()).toEqual(moments);
    expect(await page.locator('[data-trajectory-overlay] [data-keyframe-id]').evaluateAll((handles) => handles
      .map((handle) => Number((handle as HTMLElement).dataset.timeMs)))).toEqual(moments);
    const proof = await page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
      const inspected = window.__motionEditor.inspectShotWorkspace(); return { geometry: inspected.geometry,
        previewMatchesCompiler: inspected.previewMatchesCompiler, native: frame.contentDocument!.getAnimations().map((animation) => ({
          animation: animation.constructor.name, effect: animation.effect?.constructor.name, timeline: animation.timeline?.constructor.name,
          currentTime: animation.currentTime, playState: animation.playState })), status: document.querySelector<HTMLOutputElement>('[data-shot-status]')!.value }; });
    expect(proof.geometry).toHaveLength(moments.length);
    expect(proof.geometry.every((sample) => Object.values(sample.deltasDevicePixels).every((delta) => delta <= 1))).toBe(true);
    expect(proof.previewMatchesCompiler).toBe(true);
    expect(proof.native.length).toBeGreaterThan(0);
    expect(proof.native.every((animation) => animation.animation === 'CSSAnimation' && animation.effect === 'KeyframeEffect'
      && animation.timeline === 'DocumentTimeline' && animation.playState === 'paused')).toBe(true);
    expect(proof.status).not.toMatch(/INVALID|MISSING|DIVERGED/);
  };
  await assertGroupedState([0, 700, 2100]);
  await workspace.locator('[data-shot-advanced] summary').click();
  const x = workspace.locator('[data-pose-form] input[name="x"]');
  await x.fill(String(Number(await x.inputValue()) + 1)); await workspace.getByRole('button', { name: 'Apply pose' }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(2);
  await workspace.locator('[data-shot-advanced] summary').click();
  await assertGroupedState([0, 700, 2100]);
  expect(asymmetricCommands).toHaveLength(2); expect(asymmetricCommands[1]?.kind).toBe('motion.transform-waypoints.translate');
  expect(asymmetricCommands[1]).toMatchObject({ schemaVersion: 'motion.operation-intent.v1', intent: { elementIds: targetElementIds } });
  await workspace.locator('[data-shot-moment-time]').fill('840');
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(3);
  await assertGroupedState([0, 840, 2100]);
  await workspace.locator('[data-shot-easing]').selectOption('ease-in-out'); await workspace.locator('[data-shot-apply-easing]').click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(4);
  await assertGroupedState([0, 840, 2100]);
  expect(asymmetricCommands.slice(1, 4).map((command) => command.kind)).toEqual([
    'motion.transform-waypoints.translate', 'motion.keyframe-group-time.set', 'motion.keyframe-group-easing.set',
  ]);
  for (const [revision, moments] of [[5, [0, 840, 2100]], [6, [0, 700, 2100]], [7, [0, 700, 2100]]] as const) {
    await page.locator('[data-undo]').click(); await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(revision);
    await assertGroupedState([...moments]);
  }
  for (const [revision, moments] of [[8, [0, 700, 2100]], [9, [0, 840, 2100]], [10, [0, 840, 2100]]] as const) {
    await page.locator('[data-redo]').click(); await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(revision);
    await assertGroupedState([...moments]);
  }
  await moveTogether.uncheck(); await expect(moveTogether).not.toBeChecked(); await expect(primaries.nth(1)).toBeChecked();
  await workspace.locator('[data-shot-advanced] summary').click();
  await x.fill(String(Number(await x.inputValue()) + 1)); await workspace.getByRole('button', { name: 'Apply pose' }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(11);
  expect(asymmetricCommands.at(-1)?.kind).toBe('motion.transform-pose.set');
  expect(asymmetricCommands.at(-1)?.intent?.elementId).toBe(targetElementIds[1]);
  expect((await page.evaluate(() => window.__motionEditor.inspectShotWorkspace())).selectedElementIds).toEqual([targetElementIds[1]]);
});

test('non-service editor keeps local interaction state but rejects every persistent commit', async ({ page }) => {
  processHandle?.kill('SIGTERM');
  if (processHandle?.exitCode === null) await new Promise((resolveExit) => processHandle!.once('exit', resolveExit));
  const root = resolve(import.meta.dirname, '../../..'); const port = 43800 + Math.floor(Math.random() * 150);
  processHandle = spawn('npm', ['exec', 'vite', '--', '--config', resolve(root, 'apps/editor/vite.config.ts'),
    '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, env: { ...process.env,
      PHASE3_SERVICE_URL: '', PHASE3_HUMAN_CAPABILITY: '', LANDING_SHOT1_WORKSPACE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  const url = `http://lineage-motion.localhost:${port}`;
  await expect.poll(async () => { try { return (await fetch(url)).ok; } catch { return false; } }, { timeout: 10000 }).toBe(true);
  const persistentRequests: string[] = []; page.on('request', (request) => {
    if (request.url().includes('/api/v1/')) persistentRequests.push(request.url());
  });
  await page.goto(url); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const baseline = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  await page.locator('[data-shot-advanced] summary').click();
  const x = page.locator('[data-pose-form] input[name="x"]'); await x.fill(String(Number(await x.inputValue()) + 5));
  await page.getByRole('button', { name: 'Apply pose' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('SERVICE_REQUIRED');
  const rejected = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(rejected).toMatchObject({ revision: baseline.revision, contentDigest: baseline.contentDigest, exportDigest: baseline.exportDigest });
  expect(persistentRequests).toEqual([]);
  await page.locator('input[name="shot-moment"][value="0"]').check();
  expect((await page.evaluate(() => window.__motionEditor.inspectShotWorkspace())).momentMs).toBe(0);
});
test.afterEach(async () => {
  if (processHandle?.exitCode === null) { processHandle.kill('SIGTERM'); await new Promise((resolveExit) => processHandle!.once('exit', resolveExit)); }
  await rm(directory, { recursive: true, force: true });
});

test('editor dispatches the shared durable operation and renders fetched compiler-native output', async ({ page }) => {
  const pageErrors: string[] = [], consoleErrors: string[] = [], failedRequests: string[] = [];
  const serviceResponses: Array<{ url: string; status: number; contentType: string }> = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`));
  page.on('response', (response) => { if (response.url().includes('/api/v1/')) serviceResponses.push({ url: response.url(),
    status: response.status(), contentType: response.headers()['content-type'] ?? '' }); });
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.getByRole('radio', { name: /Orb/ }).click(); await page.getByRole('button', { name: 'Create Orb opacity track' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('Revision 1');
  const proof = await page.evaluate(() => { const iframe = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    return { state: window.__motionEditor.inspectAuthoring(), exact: iframe.srcdoc === window.__motionEditor.compiledHtml,
      animationCount: iframe.contentDocument!.getAnimations().length,
      native: iframe.contentDocument!.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation') }; });
  expect(proof.state).toMatchObject({ revision: 1, serviceBacked: true, immutableRefetchCount: 1 });
  expect(proof.exact).toBe(true); expect(proof.animationCount).toBeGreaterThan(0); expect(proof.native).toBe(true);
  const beforeHold = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(await page.evaluate(() => window.__motionEditor.dispatch({ schemaVersion: 'motion.operation.v1', operationId: 'unsupported-hold',
    documentId: window.__motionEditor.inspectAuthoring().documentId, expectedRevision: 1, kind: 'motion.hold.insert',
    payload: { cueId: 'cue_pair', durationMs: 600 } }))).toEqual({ ok: true });
  const afterHold = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(afterHold).toMatchObject({ revision: 2, serviceBacked: true, undoCount: 1 });
  expect(afterHold.contentDigest).not.toBe(beforeHold.contentDigest);
  const collaboration = await page.evaluate(() => window.__motionEditor.inspectCollaboration());
  expect(collaboration.workspace).toMatchObject({ schemaVersion: 'motion.workspace-projection.v1', branchId: 'main',
    revision: 2, history: { undoAvailable: true, redoAvailable: false } });
  expect(collaboration.workspace?.eligibility).toHaveLength(27);
  expect(collaboration.branches).toMatchObject({ schemaVersion: 'motion.branch-list.v1' });
  expect(collaboration.claims).toMatchObject({ schemaVersion: 'motion.active-claim-list.v1' });
  expect(collaboration.activity).toMatchObject({ schemaVersion: 'motion.activity-page.v1' });
  expect(collaboration.diagnostic).toBeNull();
  expect(serviceResponses.some((response) => response.url.endsWith('/commands') && response.status === 200
    && response.contentType.startsWith('application/json'))).toBe(true);
  expect(pageErrors).toEqual([]); expect(consoleErrors).toEqual([]); expect(failedRequests).toEqual([]);
});

test('editor creates, switches, and revokes on a branch through shared controls', async ({ page }) => {
  const editorOperationIds: string[] = [];
  const captureOperationId = (request: import('@playwright/test').Request) => {
    if (!request.url().endsWith('/api/v1/commands')) return;
    const command = request.postDataJSON() as { operationId?: unknown };
    if (typeof command.operationId === 'string') editorOperationIds.push(command.operationId);
  };
  page.on('request', captureOperationId);
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const revokingPage = await page.context().newPage(); revokingPage.on('request', captureOperationId);
  await revokingPage.goto(editorUrl); await expect(revokingPage.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.locator('.collaboration-details summary').click();
  await revokingPage.locator('.collaboration-details summary').click();
  await page.locator('[data-branch-form] [data-new-branch]').fill('feature');
  await page.locator('[data-branch-form]').getByRole('button', { name: 'Create branch' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('Branch feature head revision 0 loaded');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({ activeBranchId: 'feature', revision: 0 });
  await revokingPage.evaluate(() => window.__motionEditor.switchBranch('feature'));
  await expect(revokingPage.locator('[data-operation-status]')).toContainText('Branch feature head revision 0 loaded');
  const seed = createPhase3Seed(resolve(import.meta.dirname, '../../..'));
  const secret = ['browser', 'claim', 'proof', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-'); let output = '';
  expect(await runCli(['claim-acquire', '--service', serviceUrl, '--operation-id', 'browser-claim', '--document-id', seed.documentId,
    '--branch-id', 'feature', '--expected-revision', '0', '--scope', 'branch', '--claim-secret', secret,
    '--capability', agentCapability],
  { stdout: (value) => { output += value; }, stderr: () => undefined })).toBe(0);
  const acquired = JSON.parse(output) as { claimId: string; leaseVersion: number };
  await revokingPage.locator('[data-claim-id]').fill(acquired.claimId);
  await revokingPage.locator('[data-lease-version]').fill(String(acquired.leaseVersion));
  await revokingPage.locator('[data-revoke-form]').getByRole('button', { name: 'Revoke claim' }).click();
  await expect(revokingPage.locator('[data-operation-status]')).toContainText('revoked at lease version 2');
  expect(editorOperationIds).toHaveLength(2);
  expect(editorOperationIds[0]).toMatch(/^editor:[0-9a-f-]{36}:1$/);
  expect(editorOperationIds[1]).toMatch(/^editor:[0-9a-f-]{36}:1$/);
  expect(new Set(editorOperationIds).size).toBe(2);
  await page.locator('[data-active-branch]').selectOption('main');
  await expect(page.locator('[data-operation-status]')).toContainText('Branch main head revision 0 loaded');
  expect(await page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    return frame.srcdoc === window.__motionEditor.compiledHtml; })).toBe(true);
  await revokingPage.close();
});

test('advanced branch and claim failures publish the exact current service diagnostic', async ({ page }) => {
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.locator('.collaboration-details summary').click();
  await page.locator('[data-branch-form] [data-new-branch]').fill('feature');
  await page.locator('[data-branch-form]').getByRole('button', { name: 'Create branch' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('Branch feature head revision 0 loaded');
  await page.locator('[data-branch-form] [data-new-branch]').fill('feature');
  await page.locator('[data-branch-form]').getByRole('button', { name: 'Create branch' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('BRANCH_ALREADY_EXISTS: revision 0 unchanged.');
  await expect(page.locator('[data-service-diagnostic]')).toContainText('BRANCH_ALREADY_EXISTS · target · not retryable');
  expect(await page.evaluate(() => window.__motionEditor.inspectCollaboration().diagnostic)).toEqual({
    schemaVersion: 'motion.diagnostic.v1', code: 'BRANCH_ALREADY_EXISTS', category: 'target', retryable: false,
    affectedIds: ['feature'],
  });
  await page.locator('[data-claim-id]').fill(`claim_${'a'.repeat(24)}`);
  await page.locator('[data-lease-version]').fill('1');
  await page.locator('[data-revoke-form]').getByRole('button', { name: 'Revoke claim' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('CLAIM_REQUIRED: revision 0 unchanged.');
  await expect(page.locator('[data-service-diagnostic]')).toContainText('CLAIM_REQUIRED · authorization · not retryable');
  expect(await page.evaluate(() => window.__motionEditor.inspectCollaboration().diagnostic)).toEqual({
    schemaVersion: 'motion.diagnostic.v1', code: 'CLAIM_REQUIRED', category: 'authorization', retryable: false,
  });
});

test('an open editor refreshes from CLI commit via metadata-only SSE and immutable refetch', async ({ page }) => {
  const pageErrors: string[] = [], consoleErrors: string[] = [], failedRequests: string[] = [];
  const eventResponses: Array<{ status: number; contentType: string }> = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} ${request.failure()?.errorText}`));
  page.on('response', (response) => { if (response.url().endsWith('/events')) eventResponses.push({ status: response.status(),
    contentType: response.headers()['content-type'] ?? '' }); });
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const seed = createPhase3Seed(resolve(import.meta.dirname, '../../..')); let output = '';
  expect(await runCli(['track-create', '--service', serviceUrl, '--operation-id', 'chrome-cli-commit', '--document-id', seed.documentId,
    '--expected-revision', '0', '--element-id', 'el_2dbee68b1ea318c8', '--capability', humanCapability],
  { stdout: (value) => { output += value; }, stderr: () => undefined })).toBe(0);
  expect(JSON.parse(output)).toMatchObject({ ok: true, resultingRevision: 1 });
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().lastCommitSeq)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().lastCommit?.commitSeq)).toBe(1);
  const proof = await page.evaluate(() => { const iframe = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    return { state: window.__motionEditor.inspectAuthoring(), exact: iframe.srcdoc === window.__motionEditor.compiledHtml,
      animationCount: iframe.contentDocument!.getAnimations().length,
      native: iframe.contentDocument!.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation') }; });
  expect(proof.state).toMatchObject({ immutableRefetchCount: 1,
    lastCommit: { revision: 1, kind: 'motion.track.create', branchId: 'main' } });
  expect(Object.keys(proof.state.lastCommit!).sort()).toEqual([
    'actor', 'affectedIds', 'branchId', 'commitSeq', 'digest', 'documentId', 'kind', 'operationDigest', 'revision',
  ]);
  expect(proof.exact).toBe(true); expect(proof.animationCount).toBeGreaterThan(0); expect(proof.native).toBe(true);
  expect(eventResponses).toEqual([expect.objectContaining({ status: 200, contentType: expect.stringContaining('text/event-stream') })]);
  expect(pageErrors).toEqual([]); expect(consoleErrors).toEqual([]); expect(failedRequests).toEqual([]);
});

test('document-claim traffic cannot redirect main to a diverged feature revision', async ({ page }) => {
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const seed = createPhase3Seed(resolve(import.meta.dirname, '../../..')); const invoke = async (args: string[]) => {
    const agentCommand = args[0]?.startsWith('claim-') && args[0] !== 'claim-revoke';
    let output = ''; const code = await runCli([...args, '--capability', agentCommand ? agentCapability : humanCapability],
      { stdout: (value) => { output += value; }, stderr: () => undefined });
    return { code, response: JSON.parse(output) as { ok: boolean; resultingRevision?: number } };
  };
  expect((await invoke(['branch-create', '--service', serviceUrl, '--operation-id', 'browser-diverge-branch',
    '--document-id', seed.documentId, '--expected-revision', '0', '--new-branch-id', 'feature'])).code).toBe(0);
  expect((await invoke(['track-create', '--service', serviceUrl, '--operation-id', 'browser-diverge-main',
    '--document-id', seed.documentId, '--expected-revision', '0', '--element-id', 'el_a2849ff826f3e167'])).code).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
  expect((await invoke(['track-create', '--service', serviceUrl, '--operation-id', 'browser-diverge-feature',
    '--document-id', seed.documentId, '--branch-id', 'feature', '--expected-revision', '0',
    '--element-id', 'el_2dbee68b1ea318c8'])).response.resultingRevision).toBe(2);
  const secret = ['browser', 'diverged', 'document', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-');
  expect((await invoke(['claim-acquire', '--service', serviceUrl, '--operation-id', 'browser-diverged-document-claim',
    '--document-id', seed.documentId, '--branch-id', 'main', '--expected-revision', '2', '--scope', 'document',
    '--claim-secret', secret])).response.resultingRevision).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().lastCommit?.kind)).toBe('motion.claim.acquire');
  const proof = await page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    return { state: window.__motionEditor.inspectAuthoring(), exact: frame.srcdoc === window.__motionEditor.compiledHtml,
      native: frame.contentDocument!.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation') }; });
  expect(proof.state).toMatchObject({ activeBranchId: 'main', revision: 1,
    lastCommit: { branchId: 'main', revision: 1, kind: 'motion.claim.acquire' } });
  expect(proof.exact).toBe(true); expect(proof.native).toBe(true);
});

test('two open editors stay isolated through a full diverged document-claim lifecycle and human revoke', async ({ page }) => {
  const seed = createPhase3Seed(resolve(import.meta.dirname, '../../..'));
  const invoke = async (args: string[], actor: 'human' | 'agent') => { let output = '';
    const code = await runCli([...args, '--capability', actor === 'human' ? humanCapability : agentCapability],
      { stdout: (value) => { output += value; }, stderr: () => undefined });
    return { code, response: JSON.parse(output) as Record<string, unknown> }; };
  const base = ['--service', serviceUrl, '--document-id', seed.documentId];
  expect((await invoke(['branch-create', ...base, '--operation-id', 'two-editor-branch', '--expected-revision', '0',
    '--new-branch-id', 'feature'], 'human')).code).toBe(0);
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.locator('.collaboration-details summary').click();
  const featurePage = await page.context().newPage(); await featurePage.goto(editorUrl);
  await expect(featurePage.locator('[data-editor-ready="true"]')).toBeVisible();
  await featurePage.evaluate(() => window.__motionEditor.switchBranch('feature'));
  await expect(featurePage.locator('[data-operation-status]')).toContainText('Branch feature head revision 0 loaded');
  expect((await invoke(['track-create', ...base, '--operation-id', 'two-editor-main-write', '--expected-revision', '0',
    '--element-id', 'el_a2849ff826f3e167'], 'human')).code).toBe(0);
  expect((await invoke(['track-create', ...base, '--operation-id', 'two-editor-feature-write', '--branch-id', 'feature',
    '--expected-revision', '0', '--element-id', 'el_2dbee68b1ea318c8'], 'human')).code).toBe(0);
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
  await expect.poll(() => featurePage.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(2);
  const secret = ['two-editor', 'lifecycle', 'proof', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-');
  const acquire = await invoke(['claim-acquire', ...base, '--operation-id', 'two-editor-acquire', '--branch-id', 'feature',
    '--expected-revision', '2', '--scope', 'document', '--claim-secret', secret], 'agent');
  const claimId = String(acquire.response.claimId); expect(acquire.response).toMatchObject({ ok: true, leaseVersion: 1 });
  expect((await invoke(['claim-renew', ...base, '--operation-id', 'two-editor-renew', '--branch-id', 'feature',
    '--expected-revision', '2', '--claim-id', claimId, '--lease-version', '1', '--claim-secret', secret], 'agent')).response)
    .toMatchObject({ ok: true, leaseVersion: 2 });
  expect((await invoke(['claim-release', ...base, '--operation-id', 'two-editor-release', '--branch-id', 'feature',
    '--expected-revision', '2', '--claim-id', claimId, '--lease-version', '2', '--claim-secret', secret], 'agent')).response)
    .toMatchObject({ ok: true, leaseVersion: 3 });
  const reacquired = await invoke(['claim-acquire', ...base, '--operation-id', 'two-editor-reacquire', '--branch-id', 'feature',
    '--expected-revision', '2', '--scope', 'document', '--claim-secret', secret], 'agent');
  await page.locator('[data-claim-id]').fill(String(reacquired.response.claimId));
  await page.locator('[data-lease-version]').fill('1');
  await page.locator('[data-revoke-form]').getByRole('button', { name: 'Revoke claim' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('revoked at lease version 2');
  const states = await Promise.all([page, featurePage].map((editor) => editor.evaluate(() => {
    const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    return { state: window.__motionEditor.inspectAuthoring(), exact: frame.srcdoc === window.__motionEditor.compiledHtml,
      native: frame.contentDocument!.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation') };
  })));
  expect(states[0]).toMatchObject({ state: { activeBranchId: 'main', revision: 1 }, exact: true, native: true });
  expect(states[1]).toMatchObject({ state: { activeBranchId: 'feature', revision: 2 }, exact: true, native: true });
  await featurePage.close();
});

test('a same-revision CLI race cannot leave a stale editor after its local command is rejected', async ({ page }) => {
  let releaseCommand!: () => void; let markIntercepted!: () => void;
  const commandIntercepted = new Promise<void>((resolveIntercepted) => { markIntercepted = resolveIntercepted; });
  const commandRelease = new Promise<void>((resolveRelease) => { releaseCommand = resolveRelease; });
  await page.route('**/api/v1/commands', async (route) => {
    markIntercepted(); await commandRelease; await route.continue();
  });
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.getByRole('radio', { name: /Orb/ }).click();
  await page.getByRole('button', { name: 'Create Orb opacity track' }).click();
  await commandIntercepted;
  const seed = createPhase3Seed(resolve(import.meta.dirname, '../../..'));
  expect(await runCli(['track-create', '--service', serviceUrl, '--operation-id', 'cli-wins-race', '--document-id', seed.documentId,
    '--expected-revision', '0', '--element-id', 'el_a2849ff826f3e167', '--capability', humanCapability],
  { stdout: () => undefined, stderr: () => undefined })).toBe(0);
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({ revision: 0, lastCommit: null });
  releaseCommand();
  await expect(page.locator('[data-operation-status]')).toContainText('refreshed to revision 1');
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().lastCommit?.revision)).toBe(1);
  const proof = await page.evaluate(() => { const iframe = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    return { state: window.__motionEditor.inspectAuthoring(), exact: iframe.srcdoc === window.__motionEditor.compiledHtml };
  });
  expect(proof.state).toMatchObject({ revision: 1, immutableRefetchCount: 1,
    lastCommit: { revision: 1, kind: 'motion.track.create' } });
  expect(proof.exact).toBe(true);
  expect(await page.evaluate(() => window.__motionEditor.inspectCollaboration().diagnostic)).toMatchObject({
    schemaVersion: 'motion.diagnostic.v1', code: 'STALE_REVISION', category: 'revision', retryable: true,
  });
});

test('a disconnected editor resumes from its durable cursor and refetches the immutable CLI revision', async ({ page }) => {
  let blocked = 0; await page.route('**/api/v1/documents/*/events', async (route) => { blocked += 1; await route.abort('connectionfailed'); });
  const pageErrors: string[] = []; page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await expect.poll(() => blocked).toBeGreaterThan(0);
  const seed = createPhase3Seed(resolve(import.meta.dirname, '../../..'));
  expect(await runCli(['track-create', '--service', serviceUrl, '--operation-id', 'offline-cli-commit', '--document-id', seed.documentId,
    '--expected-revision', '0', '--element-id', 'el_2dbee68b1ea318c8', '--capability', humanCapability],
  { stdout: () => undefined, stderr: () => undefined })).toBe(0);
  await page.unroute('**/api/v1/documents/*/events');
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().lastCommitSeq)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().lastCommit?.commitSeq)).toBe(1);
  const proof = await page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    return { state: window.__motionEditor.inspectAuthoring(), exact: frame.srcdoc === window.__motionEditor.compiledHtml,
      native: frame.contentDocument!.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation') }; });
  expect(proof.state).toMatchObject({ lastCommitSeq: 1, lastCommit: { commitSeq: 1 }, revision: 1 });
  expect(proof.exact).toBe(true); expect(proof.native).toBe(true); expect(pageErrors).toEqual([]);
});

test('remote CLI conflict preserves a visible creation draft until explicit keep or discard', async ({ page }) => {
  const editorCommands: unknown[] = []; page.on('request', (request) => {
    if (request.url().endsWith('/commands')) editorCommands.push(request.postDataJSON());
  });
  const seed = createPhase3Seed(resolve(import.meta.dirname, '../../..'));
  expect(await runCli(['branch-create', '--service', serviceUrl, '--operation-id', 'draft-feature', '--document-id', seed.documentId,
    '--expected-revision', '0', '--new-branch-id', 'feature', '--capability', humanCapability],
  { stdout: () => undefined, stderr: () => undefined })).toBe(0);
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.locator('.collaboration-details summary').click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().lastCommitSeq)).toBe(1);
  await page.getByRole('radio', { name: /Orb/ }).click();
  await page.locator('[data-new-branch]').fill('');
  expect(await runCli(['track-create', '--service', serviceUrl, '--operation-id', 'draft-cli-conflict', '--document-id', seed.documentId,
    '--expected-revision', '0', '--element-id', 'el_a2849ff826f3e167', '--capability', humanCapability],
  { stdout: () => undefined, stderr: () => undefined })).toBe(0);
  await expect(page.locator('[data-draft-conflict]')).toBeVisible();
  await expect(page.getByRole('radio', { name: /Orb/ })).toBeChecked();
  await expect(page.locator('[data-new-branch]')).toHaveValue('');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({ revision: 1,
    selectedCreationElementId: 'el_2dbee68b1ea318c8', draftConflictRevision: 1, draftStaleBaseRevision: 0,
    draftDirty: true, draftValues: { '[data-new-branch]': '' } });
  expect(editorCommands).toEqual([]);
  await page.getByRole('button', { name: 'Keep draft' }).click();
  await expect(page.locator('[data-draft-conflict]')).toBeHidden(); await expect(page.getByRole('radio', { name: /Orb/ })).toBeChecked();
  await expect(page.locator('[data-new-branch]')).toHaveValue('');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({ draftDirty: true,
    draftStaleBaseRevision: 0, selectedCreationElementId: 'el_2dbee68b1ea318c8' });
  await page.evaluate(() => window.__motionEditor.switchBranch('feature'));
  await expect(page.locator('[data-draft-conflict]')).toBeVisible(); await expect(page.locator('[data-new-branch]')).toHaveValue('');
  await page.getByRole('button', { name: 'Keep draft' }).click();
  await page.evaluate(() => window.__motionEditor.switchBranch('main'));
  await expect(page.locator('[data-draft-conflict]')).toBeVisible();
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({ draftDirty: true,
    draftStaleBaseRevision: 0, unavailableCreation: true, selectedCreationElementId: 'el_2dbee68b1ea318c8' });
  await expect(page.getByRole('radio', { name: /Orb/ })).toBeDisabled(); await expect(page.locator('[data-create-track]')).toBeDisabled();
  await page.getByRole('button', { name: 'Discard draft' }).click();
  await expect(page.locator('[data-draft-conflict]')).toBeHidden(); await expect(page.locator('[data-new-branch]')).toHaveValue('feature');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({ draftDirty: false,
    draftStaleBaseRevision: null, selectedCreationElementId: null });
  expect(editorCommands).toEqual([]);
});

test('canonical keyframe anchors become visibly unavailable across branches and restore only by same IDs', async ({ page }) => {
  const seed = createPhase3Seed(resolve(import.meta.dirname, '../../..')); const invoke = async (args: string[]) => runCli(
    [...args, '--capability', humanCapability], { stdout: () => undefined, stderr: () => undefined });
  expect(await invoke(['branch-create', '--service', serviceUrl, '--operation-id', 'identity-branch', '--document-id', seed.documentId,
    '--expected-revision', '0', '--new-branch-id', 'feature'])).toBe(0);
  expect(await invoke(['track-create', '--service', serviceUrl, '--operation-id', 'identity-track', '--document-id', seed.documentId,
    '--expected-revision', '0', '--element-id', 'el_2dbee68b1ea318c8'])).toBe(0);
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.locator('.inspect-panel').evaluate((element) => { (element as HTMLDetailsElement).open = true; });
  const created = page.locator('[data-element-id="el_2dbee68b1ea318c8"][data-property="opacity"]');
  await created.locator('.keyframe').first().click();
  const selected = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(selected.selectedTrackId).toBeTruthy(); expect(selected.selectedKeyframeId).toBeTruthy();
  await page.evaluate(() => window.__motionEditor.switchBranch('feature'));
  const unavailable = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(unavailable).toMatchObject({ unavailableSelection: true, selectedTrackId: selected.selectedTrackId,
    selectedKeyframeId: selected.selectedKeyframeId });
  await expect(page.locator('[data-selection]')).toContainText('canonical target unavailable');
  for (const selector of ['[data-add-midpoint]', '[data-remove-midpoint]', '[data-set-duration]', '[data-set-delay]',
    '[data-set-easing]', '[data-value-form] button', '[data-time-form] button', '[data-insert-hold]'])
    await expect(page.locator(selector)).toBeDisabled();
  await page.evaluate(() => window.__motionEditor.switchBranch('main'));
  const restored = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(restored).toMatchObject({ unavailableSelection: false, selectedTrackId: selected.selectedTrackId,
    selectedKeyframeId: selected.selectedKeyframeId });
});

test('an ordered metadata gap triggers immutable head refetch with digest validation', async ({ page }) => {
  let releaseFrame!: (body: string) => void; const frame = new Promise<string>((resolveFrame) => { releaseFrame = resolveFrame; });
  let intercepted = false; await page.route('**/api/v1/documents/*/events', async (route) => {
    if (intercepted) return route.continue(); intercepted = true;
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: await frame });
  });
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const seed = createPhase3Seed(resolve(import.meta.dirname, '../../..')); let output = '';
  expect(await runCli(['track-create', '--service', serviceUrl, '--operation-id', 'gap-cli-commit', '--document-id', seed.documentId,
    '--expected-revision', '0', '--element-id', 'el_2dbee68b1ea318c8', '--capability', humanCapability],
  { stdout: (value) => { output += value; }, stderr: () => undefined })).toBe(0);
  const committed = JSON.parse(output) as { resultingRevision: number; canonicalDigest: string };
  releaseFrame(`id: 2\nevent: commit\ndata: ${JSON.stringify({ documentId: seed.documentId, branchId: 'main',
    revision: committed.resultingRevision, digest: committed.canonicalDigest, kind: 'motion.track.create', commitSeq: 2 })}\n\n`);
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
  await expect(page.locator('[data-operation-status]')).toContainText('Event gap detected');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({ lastCommitSeq: 2,
    lastCommit: { commitSeq: 2 }, immutableRefetchCount: 1 });
});

test('failed immutable validation leaves the cursor unacknowledged and retries the event exactly once', async ({ page }) => {
  let revisionAttempts = 0; let releaseRetry!: () => void;
  const retryGate = new Promise<void>((resolveRetry) => { releaseRetry = resolveRetry; });
  const cursors: string[] = []; page.on('request', (request) => {
    if (request.url().endsWith('/events')) cursors.push(request.headers()['last-event-id'] ?? 'missing');
  });
  await page.route('**/api/v1/documents/*/revisions/1', async (route) => {
    revisionAttempts += 1; if (revisionAttempts === 1) return route.abort('connectionfailed');
    await retryGate; await route.continue();
  });
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const seed = createPhase3Seed(resolve(import.meta.dirname, '../../..'));
  expect(await runCli(['track-create', '--service', serviceUrl, '--operation-id', 'retry-unacknowledged', '--document-id', seed.documentId,
    '--expected-revision', '0', '--element-id', 'el_2dbee68b1ea318c8', '--capability', humanCapability],
  { stdout: () => undefined, stderr: () => undefined })).toBe(0);
  await expect.poll(() => revisionAttempts).toBe(2);
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({ revision: 0, lastCommitSeq: 0 });
  expect(cursors.slice(0, 2)).toEqual(['0', '0']); releaseRetry();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().lastCommitSeq)).toBe(1);
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({ revision: 1,
    lastCommitSeq: 1, immutableRefetchCount: 1 }); expect(revisionAttempts).toBe(2);
});

test('a behind-branch local commit uses the service global result without false conflict', async ({ page }) => {
  const seed = createPhase3Seed(resolve(import.meta.dirname, '../../..')); const invoke = async (args: string[]) => runCli(
    [...args, '--capability', humanCapability], { stdout: () => undefined, stderr: () => undefined });
  expect(await invoke(['branch-create', '--service', serviceUrl, '--operation-id', 'global-result-branch', '--document-id', seed.documentId,
    '--expected-revision', '0', '--new-branch-id', 'feature'])).toBe(0);
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.evaluate(() => window.__motionEditor.switchBranch('feature'));
  expect(await invoke(['track-create', '--service', serviceUrl, '--operation-id', 'global-result-main', '--document-id', seed.documentId,
    '--expected-revision', '0', '--element-id', 'el_a2849ff826f3e167'])).toBe(0);
  await page.getByRole('radio', { name: /Orb/ }).click(); await page.getByRole('button', { name: 'Create Orb opacity track' }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(2);
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({ activeBranchId: 'feature',
    revision: 2, pendingRevision: null, draftConflictRevision: null, draftDirty: false });
  await expect(page.locator('[data-draft-conflict]')).toBeHidden();
});

test('a committed local command with a lost response converges once and clears pending state', async ({ page }) => {
  let committedResponse: unknown; await page.route('**/api/v1/commands', async (route) => {
    const upstream = await route.fetch(); committedResponse = await upstream.json(); await route.abort('connectionfailed');
  });
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.getByRole('radio', { name: /Orb/ }).click(); await page.getByRole('button', { name: 'Create Orb opacity track' }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().lastCommitSeq)).toBe(1);
  expect(committedResponse).toMatchObject({ ok: true, resultingRevision: 1 });
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toMatchObject({ revision: 1,
    pendingRevision: null, immutableRefetchCount: 1, draftConflictRevision: null, draftDirty: false });
  await expect(page.locator('[data-draft-conflict]')).toBeHidden();
});
