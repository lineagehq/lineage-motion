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
  processHandle = spawn(process.execPath, [resolve(root, 'node_modules/vite-node/vite-node.mjs'), resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
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


test.afterEach(async () => {
  if (processHandle?.exitCode === null) { processHandle.kill('SIGTERM'); await new Promise((resolveExit) => processHandle!.once('exit', resolveExit)); }
  await rm(directory, { recursive: true, force: true });
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
  processHandle = spawn(process.execPath, [resolve(root, 'node_modules/vite-node/vite-node.mjs'), resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
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
  processHandle = spawn(process.execPath, [resolve(root, 'node_modules/vite-node/vite-node.mjs'), resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
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
  processHandle = spawn(process.execPath, [resolve(root, 'node_modules/vite-node/vite-node.mjs'), resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
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
  const inventory = () => page.locator('input[name="shot-moment"]').evaluateAll((inputs) => inputs.map((input) => Number((input as HTMLInputElement).value)));
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
  await page.locator('input[name="shot-moment"][value="1400"]').check();
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
  await workspace.getByRole('button', { name: 'Advanced motion controls' }).click();
  if (await page.locator('[data-shot-advanced-drawer] > details').first().getAttribute('open') === null) {
    await page.locator('[data-shot-advanced-drawer] > details').first().locator('summary').click();
  }
  const x = workspace.locator('[data-pose-form] input[name="x"]');
  await x.fill(String(Number(await x.inputValue()) + 1)); await workspace.getByRole('button', { name: 'Apply pose' }).click();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(2);
  await page.keyboard.press('Escape');
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
  await workspace.getByRole('button', { name: 'Advanced motion controls' }).click();
  if (await page.locator('[data-shot-advanced-drawer] > details').first().getAttribute('open') === null) {
    await page.locator('[data-shot-advanced-drawer] > details').first().locator('summary').click();
  }
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
  await page.getByRole('button', { name: 'Advanced motion controls' }).click();
  if (await page.locator('[data-shot-advanced-drawer] > details').first().getAttribute('open') === null) {
    await page.locator('[data-shot-advanced-drawer] > details').first().locator('summary').click();
  }
  const x = page.locator('[data-pose-form] input[name="x"]'); await x.fill(String(Number(await x.inputValue()) + 5));
  await page.getByRole('button', { name: 'Apply pose' }).click();
  await expect(page.locator('[data-operation-status]')).toContainText('SERVICE_REQUIRED');
  const rejected = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(rejected).toMatchObject({ revision: baseline.revision, contentDigest: baseline.contentDigest, exportDigest: baseline.exportDigest });
  expect(persistentRequests).toEqual([]);
  await page.locator('input[name="shot-moment"][value="0"]').check();
  expect((await page.evaluate(() => window.__motionEditor.inspectShotWorkspace())).momentMs).toBe(0);
});
