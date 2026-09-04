import { spawn } from 'node:child_process';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { chromium } from '@playwright/test';
import { runCanvasFirstUxQa } from './qa-canvas.mjs';
import { assertShot1ProofRouting, materializePublicAsymmetricSeed, monitorPage, observeServerAddress, reserveEphemeralPort } from './qa-helpers.mjs';
import { runLandingShot1Qa } from './qa-chrome.mjs';

export async function handleQaCommand(argv) {
if (process.argv[2] === '--real-cli') {
  const argv = JSON.parse(Buffer.from(process.argv[3], 'base64url').toString('utf8'));
  const { runCli } = await import('../../../packages/motion-cli/src/cli.ts');
  process.exit(await runCli(argv));
}
if (process.argv[2] === '--materialize-public-asymmetric-seed') {
  await materializePublicAsymmetricSeed(resolve(import.meta.dirname, '../../..'), process.argv[3]);
  process.exit();
}
if (process.argv[2] === '--resolve-shot1-canonical-easing') {
  const repositoryRoot = resolve(import.meta.dirname, '../../..');
  const authority = process.argv[3];
  const { projectTrajectorySelection } = await import('../../../packages/domain/src/index.ts');
  const { buildTimeline } = await import('../../../packages/preview-runtime/src/index.ts');
  const seed = authority === 'private'
    ? JSON.parse(await readFile(process.argv[4], 'utf8'))
    : (await import('../../../packages/local-service/src/seed.ts')).createLandingShot1EditorSeed(repositoryRoot);
  const targetElementIds = seed.elements.map((element) => element.id).sort();
  const selected = projectTrajectorySelection(seed, targetElementIds, 700);
  if (!selected.eligible) throw new Error('SHOT1_CANONICAL_EASING_SELECTION_INELIGIBLE');
  if (selected.targets.length !== 2) throw new Error('SHOT1_CANONICAL_EASING_TARGET_COUNT');
  const timeline = buildTimeline(seed);
  const effectiveEasings = selected.targets.map((target) => {
    const rows = timeline.rows.filter((row) => row.elementId === target.elementId
      && row.trackId === target.trackId && row.property === 'transform');
    if (rows.length !== 1) throw new Error('SHOT1_CANONICAL_EASING_ROW_IDENTITY');
    const frames = rows[0].keyframes.filter((keyframe) => keyframe.id === target.keyframeId
      && keyframe.value === target.expectedTransform);
    if (frames.length !== 1) throw new Error('SHOT1_CANONICAL_EASING_KEYFRAME_IDENTITY');
    return frames[0].easing ?? rows[0].timing;
  });
  process.stdout.write(`${JSON.stringify({ eligible: true, targetCount: selected.targets.length,
    resolvedCount: effectiveEasings.length, effectiveEasings })}\n`);
  process.exit();
}
if (process.argv[2] === '--vite-listen-ready') {
  const { createServer } = await import('vite');
  const requestedPort = Number(process.argv[3]);
  const readyPort = requestedPort === 0 ? await reserveEphemeralPort() : requestedPort;
  const readyRoot = resolve(import.meta.dirname, '../../..');
  const vite = await createServer({ configFile: resolve(readyRoot, 'apps/editor/vite.config.ts'),
    server: { host: '127.0.0.1', port: readyPort, strictPort: true }, logLevel: 'error' });
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === 'string') throw new Error('CHROME_QA_EDITOR_ADDRESS_UNAVAILABLE');
  process.stdout.write(`${JSON.stringify({ editorUrl: `http://lineage-motion.localhost:${address.port}` })}\n`);
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await vite.close(); process.exit(0); };
  process.on('SIGTERM', () => { void close(); }); process.on('SIGINT', () => { void close(); });
  await new Promise(() => {});
}
if (process.argv[2] === '--assert-shot1-proof-routing') {
  assertShot1ProofRouting();
  process.stdout.write('{"schemaVersion":"motion.shot1-proof-routing.v1","passed":true}\n');
  process.exit();
}
if (process.argv[2] === '--shot1-spatial-parity-public') {
  await runLandingShot1Qa({ authority: 'public', workspaceSmokeOnly: process.argv.includes('--workspace-smoke-only') });
  process.exit();
}
if (process.argv[2] === '--landing-shot1') {
  await runLandingShot1Qa({ authority: 'private', workspaceSmokeOnly: process.argv.includes('--workspace-smoke-only') });
  process.exit();
}
if (process.argv[2] === '--canvas-first-ux') {
  process.exit(await runCanvasFirstUxQa(resolve(import.meta.dirname, '../../..')));
}
if (process.argv[2] === '--phase4-review-handoff') {
  const qaRoot = resolve(import.meta.dirname, '../../..');
  const proof = spawn('npm', ['exec', 'playwright', 'test', '--', 'apps/editor/tests/review-handoff.spec.ts',
    '--config', 'apps/editor/playwright.config.ts', '--workers=1'], { cwd: qaRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  proof.stdout.on('data', (chunk) => process.stderr.write(chunk)); proof.stderr.on('data', (chunk) => process.stderr.write(chunk));
  const exitCode = await new Promise((resolveExit, reject) => { proof.once('error', reject);
    proof.once('exit', (code) => resolveExit(code ?? 1)); });
  const browserProof = exitCode === 0 ? JSON.parse(await readFile(resolve(qaRoot,
    '.motion/receipts/phase4-review-handoff-browser.json'), 'utf8')) : null;
  const receipt = { schemaVersion: 'review.installed-chrome-receipt.v1', passed: exitCode === 0,
    browser: 'Google Chrome', namedSubdomain: 'lineage-motion.localhost', proof: browserProof, commandExitCode: exitCode };
  await mkdir(resolve(qaRoot, '.motion/receipts'), { recursive: true });
  await writeFile(resolve(qaRoot, '.motion/receipts/phase4-review-handoff-installed-chrome.json'),
    `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(receipt)}\n`); process.exit(exitCode);
}
if (process.argv[2] === '--phase4-reusable-cues') {
  const qaRoot = resolve(import.meta.dirname, '../../..');
  const proof = spawn('npm', ['exec', 'playwright', 'test', '--',
    'apps/editor/tests/phase4-reusable-cues.spec.ts', '--config', 'apps/editor/playwright.config.ts', '--workers=1'], {
    cwd: qaRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  proof.stdout.on('data', (chunk) => { stdout += chunk.toString(); process.stderr.write(chunk); });
  proof.stderr.on('data', (chunk) => { stderr += chunk.toString(); process.stderr.write(chunk); });
  const browserExitCode = await new Promise((resolveExit, reject) => {
    proof.once('error', reject);
    proof.once('exit', (code) => resolveExit(code ?? 1));
  });
  const visualProof = spawn('npm', ['exec', 'vitest', 'run', '--',
    'packages/visual-proof/src/reusable-cues.visual.test.ts', '--sequence.concurrent', 'false'], {
    cwd: qaRoot, stdio: ['ignore', 'pipe', 'pipe'],
  });
  visualProof.stdout.on('data', (chunk) => process.stderr.write(chunk));
  visualProof.stderr.on('data', (chunk) => process.stderr.write(chunk));
  const visualExitCode = browserExitCode === 0 ? await new Promise((resolveExit, reject) => {
    visualProof.once('error', reject); visualProof.once('exit', (code) => resolveExit(code ?? 1));
  }) : (visualProof.kill(), 1);
  const exitCode = browserExitCode || visualExitCode;
  const passed = exitCode === 0;
  const browserProof = passed ? JSON.parse(await readFile(resolve(qaRoot,
    '.motion/receipts/phase4-reusable-browser-proof.json'), 'utf8')) : null;
  const visualReceipt = passed ? JSON.parse(await readFile(resolve(qaRoot,
    '.motion/receipts/phase4-reusable-visual-proof.json'), 'utf8')) : null;
  const receipt = {
    schemaVersion: 'motion.phase4-reusable-installed-chrome-receipt.v1',
    passed,
    browserChannel: 'chrome',
    namedSubdomain: 'lineage-motion.localhost',
    cueKinds: ['hold', 'type', 'select', 'drag'],
    proof: { browser: browserProof, visual: visualReceipt },
    commandExitCode: exitCode,
  };
  await mkdir(resolve(qaRoot, '.motion/receipts'), { recursive: true });
  await writeFile(resolve(qaRoot, '.motion/receipts/phase4-reusable-installed-chrome.json'),
    `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  process.exit(exitCode);
}
if (process.argv[2] === '--phase4-cursor-click-reveal') {
  const qaRoot = resolve(import.meta.dirname, '../../..');
  const qaServer = spawn('npm', ['exec', 'vite-node', '--', resolve(qaRoot, 'apps/editor/scripts/qa-chrome.mjs'),
    '--vite-listen-ready', '0'], { cwd: qaRoot, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PHASE4_CURSOR_CLICK_REVEAL: '1' } });
  let qaBrowser;
  try {
    const { editorUrl } = await observeServerAddress(qaServer, 'PHASE4_CHROME_QA');
    qaBrowser = await chromium.launch({ channel: 'chrome', headless: true });
    const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], unexpectedNetwork: [], httpErrors: [] };
    const originAttribution = [];
    let page;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      const cyclePage = await qaBrowser.newPage({ viewport: { width: 1440, height: 900 } });
      monitorPage(cyclePage, [editorUrl], diagnostics);
      cyclePage.on('console', (message) => { if (message.type() !== 'error') return;
        const location = message.location(); originAttribution.push({ kind: 'console',
          origin: location.url?.startsWith(new URL(editorUrl).origin) ? 'app' : location.url ? 'outside-app' : 'unknown' }); });
      cyclePage.on('pageerror', (error) => originAttribution.push({ kind: 'pageerror',
        origin: error.stack?.includes(new URL(editorUrl).origin) ? 'app' : error.stack ? 'outside-app' : 'unknown' }));
      await cyclePage.goto(editorUrl); await cyclePage.locator('[data-editor-ready="true"]').waitFor();
      await cyclePage.setViewportSize({ width: 1000, height: 800 }); await cyclePage.waitForTimeout(40);
      await cyclePage.setViewportSize({ width: 1440, height: 900 }); await cyclePage.waitForTimeout(40);
      if (cycle < 2) await cyclePage.close(); else page = cyclePage;
    }
    const targets = await page.evaluate(() => { const rows = window.__motionEditor.canonicalProjection.rows;
      const pulse = rows.find((row) => row.property === 'box-shadow')?.elementId;
      const properties = new Map(); for (const row of rows) properties.set(row.elementId, new Set([...(properties.get(row.elementId) ?? []), row.property]));
      const cursor = [...properties].find(([, names]) => names.has('left') && names.has('top'))?.[0]
        ?? rows.find((row) => row.property === 'transform' && row.elementId !== pulse)?.elementId;
      const reveal = rows.find((row) => row.property === 'visibility')?.elementId
        ?? rows.find((row) => row.property === 'opacity' && properties.get(row.elementId)?.size === 1
          && Number(row.keyframes[0]?.value) === 0 && row.elementId !== cursor)?.elementId;
      return { cursor, pulse, reveal }; });
    if (!targets.cursor || !targets.pulse || !targets.reveal) throw new Error('PHASE4_TARGET_AUTHORITY_MISSING');
    let overlapDisambiguationCount = 0;
    const pick = async (role, elementId) => {
      const candidate = page.locator(`[data-cue-target-candidate][data-element-id="${elementId}"]`); const box = await candidate.boundingBox();
      if (!box) throw new Error('PHASE4_TARGET_BOUNDS_MISSING');
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      const choice = page.locator(`[data-cue-target-choice][data-element-id="${elementId}"]`);
      if (await choice.isVisible()) {
        overlapDisambiguationCount += 1;
        if (await page.locator(`[data-cue-role-card="${role}"]`).getAttribute('data-selected') !== 'false') throw new Error('PHASE4_OVERLAP_SILENT_MUTATION');
        await choice.click();
      }
      if (await page.locator(role === 'cursor' ? '[data-cue-cursor]' : role === 'pulse' ? '[data-cue-pulse]' : '[data-cue-reveal]').inputValue() !== elementId)
        throw new Error('PHASE4_STABLE_TARGET_ID_MISMATCH');
    };
    await pick('cursor', targets.cursor); await pick('pulse', targets.pulse); await pick('reveal', targets.reveal);
    const keyboardSelect = page.locator('[data-cue-reveal]');
    const keyboardTargetIndex = await keyboardSelect.locator('option').evaluateAll((options, targetId) =>
      options.findIndex((option) => option.value === targetId), targets.reveal);
    if (keyboardTargetIndex <= 0) throw new Error('PHASE4_KEYBOARD_TARGET_OPTION_MISSING');
    const targetListSummary = page.locator('.cue-target-advanced > summary');
    await targetListSummary.focus();
    if (!await targetListSummary.evaluate((summary) => summary === document.activeElement)) throw new Error('PHASE4_KEYBOARD_TARGET_DISCLOSURE_FOCUS_MISSING');
    await page.keyboard.press('Enter');
    await keyboardSelect.focus();
    if (!await keyboardSelect.evaluate((select) => select === document.activeElement)) throw new Error('PHASE4_KEYBOARD_TARGET_FOCUS_MISSING');
    await page.keyboard.press('Home');
    for (let index = 0; index < keyboardTargetIndex; index += 1) await page.keyboard.press('ArrowDown');
    const keyboardTargetSelection = await keyboardSelect.inputValue() === targets.reveal
      && await page.locator('[data-cue-role-card="reveal"]').getAttribute('data-selected') === 'true';
    if (!keyboardTargetSelection) throw new Error('PHASE4_KEYBOARD_TARGET_SELECTION_FAILED');
    await page.locator('[data-cue-form="cursor-path"] button[type="submit"]').click();
    await page.locator('[data-authored-cue="cursor-path"]').waitFor({ state: 'attached' });
    const cursorVisibilitySamples = await page.evaluate(async (elementId) => {
      const cue = window.__motionEditor.inspectCueWorkspace().authoredCues.find((candidate) => candidate.kind === 'cursor-path');
      if (!cue || cue.semantic.kind !== 'cursor-path') throw new Error('PHASE4_CURSOR_PATH_MISSING');
      const times = [cue.semantic.startMs, Math.round((cue.semantic.startMs + cue.semantic.arriveMs) / 2), cue.semantic.arriveMs];
      const scrubber = document.querySelector('[data-scrub]');
      const target = document.querySelector('[data-preview]').contentDocument.querySelector(`[data-motion-id="${elementId}"]`);
      const samples = [];
      for (const timeMs of times) {
        scrubber.value = String(timeMs); scrubber.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        samples.push({ timeMs, opacity: Number.parseFloat(getComputedStyle(target).opacity) });
      }
      return samples;
    }, targets.cursor);
    const compilerCursorVisibleAtAuthoredMoments = cursorVisibilitySamples.length === 3
      && cursorVisibilitySamples.every((sample) => sample.opacity >= .999);
    if (!compilerCursorVisibleAtAuthoredMoments) throw new Error('PHASE4_COMPILER_CURSOR_INVISIBLE');
    const coordinateParity = async () => {
      const result = await page.evaluate(() => { const iframe = document.querySelector('[data-preview]');
        const overlay = document.querySelector('[data-cue-target-overlay]'); const iframeRect = iframe.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect(); const handles = [...document.querySelectorAll('[data-waypoint-index]')];
        return { edgeDelta: Math.max(Math.abs(iframeRect.left - overlayRect.left), Math.abs(iframeRect.top - overlayRect.top),
          Math.abs(iframeRect.right - overlayRect.right), Math.abs(iframeRect.bottom - overlayRect.bottom)),
        contained: handles.every((handle) => { const rect = handle.getBoundingClientRect(); const x = (rect.left + rect.right) / 2; const y = (rect.top + rect.bottom) / 2;
          return x >= overlayRect.left && x <= overlayRect.right && y >= overlayRect.top && y <= overlayRect.bottom; }) }; });
      if (result.edgeDelta > 1 || !result.contained) throw new Error('PHASE4_COORDINATE_PARITY_INVALID'); return result;
    };
    const paritySamples = []; const endpointDragProofs = [];
    const dragEndpoint = async (waypointIndex, delta) => {
      const selector = `[data-cue-path-overlay] [data-waypoint-index="${waypointIndex}"]`;
      await page.waitForFunction(async (candidateSelector) => {
        const candidate = document.querySelector(candidateSelector);
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return Boolean(candidate?.isConnected && candidate === document.querySelector(candidateSelector));
      }, selector);
      const handle = page.locator(selector);
      await handle.scrollIntoViewIfNeeded(); const before = await handle.boundingBox();
      if (!before) throw new Error('PHASE4_CURSOR_PATH_HANDLE_MISSING');
      const grab = { x: before.x + before.width * .27, y: before.y + before.height * .68 };
      const grabOffset = { x: grab.x - before.x, y: grab.y - before.y };
      const dpr = await page.evaluate(() => devicePixelRatio);
      const errorAt = async (pointer) => { const actual = await handle.boundingBox();
        if (!actual) throw new Error('PHASE4_CURSOR_PATH_HANDLE_MISSING');
        return Math.hypot(actual.x - (pointer.x - grabOffset.x), actual.y - (pointer.y - grabOffset.y)) * dpr; };
      const revision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
      await page.mouse.move(grab.x, grab.y); await page.mouse.down();
      const midpoint = { x: grab.x + delta.x / 2, y: grab.y + delta.y / 2 };
      await page.mouse.move(midpoint.x, midpoint.y); const midpointErrorDevicePixels = await errorAt(midpoint);
      const destination = { x: grab.x + delta.x, y: grab.y + delta.y };
      await page.mouse.move(destination.x, destination.y); const destinationErrorDevicePixels = await errorAt(destination);
      await page.mouse.up(); const immediateReleaseErrorDevicePixels = await errorAt(destination);
      await page.waitForFunction((expected) => window.__motionEditor.inspectAuthoring().revision === expected, revision + 1);
      const settledReleaseErrorDevicePixels = await errorAt(destination);
      const proof = { waypointIndex, dpr, midpointErrorDevicePixels, destinationErrorDevicePixels,
        immediateReleaseErrorDevicePixels, settledReleaseErrorDevicePixels };
      if (Math.max(midpointErrorDevicePixels, destinationErrorDevicePixels,
        immediateReleaseErrorDevicePixels, settledReleaseErrorDevicePixels) > 1) {
        throw new Error(`PHASE4_CURSOR_PATH_RELEASE_ERROR_${JSON.stringify(proof)}`);
      }
      endpointDragProofs.push(proof);
      await page.getByRole('button', { name: 'Undo' }).click();
      await page.locator('[data-cue-status]').filter({ hasText: 'Undid the last change' }).waitFor();
    };
    for (const viewport of [{ width: 1440, height: 900 }, { width: 1000, height: 800 }]) {
      await page.setViewportSize(viewport); await page.waitForTimeout(40); paritySamples.push(await coordinateParity());
      await dragEndpoint(0, { x: 13, y: 9 }); await dragEndpoint(1, { x: -11, y: 8 });
    }
    await page.setViewportSize({ width: 1000, height: 800 }); await page.waitForTimeout(40); paritySamples.push(await coordinateParity());
    const pathCenters = await page.locator('[data-cue-path-overlay] [data-waypoint-index]').evaluateAll((handles) => handles.map((handle) => {
      const bounds = handle.getBoundingClientRect(); return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
    }));
    const visiblePathDistanceCssPixels = Math.hypot(pathCenters[1].x - pathCenters[0].x, pathCenters[1].y - pathCenters[0].y);
    const arriveHandle = page.locator('[data-cue-path-overlay] [data-waypoint-index="1"]');
    await arriveHandle.waitFor(); await arriveHandle.scrollIntoViewIfNeeded(); const arriveBox = await arriveHandle.boundingBox();
    if (!arriveBox) throw new Error('PHASE4_CURSOR_PATH_HANDLE_MISSING');
    await page.mouse.move(arriveBox.x + arriveBox.width / 2, arriveBox.y + arriveBox.height / 2);
    await page.mouse.down(); await page.mouse.move(arriveBox.x + arriveBox.width / 2 + 18, arriveBox.y + arriveBox.height / 2 + 10, { steps: 4 });
    await page.mouse.up(); await page.locator('[data-cue-status]').filter({ hasText: 'Cursor path updated' }).waitFor();
    paritySamples.push(await coordinateParity()); await page.getByRole('button', { name: 'Undo' }).click();
    paritySamples.push(await coordinateParity()); await page.getByRole('button', { name: 'Redo' }).click(); paritySamples.push(await coordinateParity());
    for (const kind of ['reveal', 'click']) {
      await page.locator(`[data-cue-form="${kind}"] button[type="submit"]`).click();
      await page.locator(`[data-authored-cue="${kind}"]`).waitFor({ state: 'attached' });
    }
    const authored = await page.evaluate(() => { const iframe = document.querySelector('[data-preview]');
      const animations = iframe.contentDocument.getAnimations(); return {
        revision: window.__motionEditor.inspectAuthoring().revision,
        exactCompilerOutput: iframe.srcdoc === window.__motionEditor.compiledHtml,
        nativeAnimationCount: animations.filter((animation) => animation.constructor.name === 'CSSAnimation').length,
        animationCount: animations.length, cueCount: document.querySelectorAll('[data-authored-cue]').length,
        ownedTrackCount: document.querySelectorAll('[data-cue-owned="true"]').length,
      }; });
    const scrubber = page.locator('[data-scrub]'); const endMs = Number(await scrubber.getAttribute('max'));
    await scrubber.fill(String(endMs)); await scrubber.dispatchEvent('input'); await page.locator('[data-play]').click();
    await page.waitForTimeout(150); const restartedTimeMs = Number(await scrubber.inputValue());
    const playRestartsAtEnd = restartedTimeMs > 0 && restartedTimeMs < endMs;
    await page.locator('.cue-advanced > summary').click();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const reducedAnimationCount = await page.evaluate(() => { const ownedElements = new Set([...document.querySelectorAll('[data-cue-owned="true"]')]
      .map((row) => row.getAttribute('data-element-id'))); return document.querySelector('[data-preview]').contentDocument.getAnimations()
      .filter((animation) => ownedElements.has(animation.effect?.target?.getAttribute('data-motion-id'))).length; });
    const advanced = page.locator('.cue-advanced');
    if (!await advanced.evaluate((details) => details.open)) throw new Error('PHASE4_CUE_DISCLOSURE_DID_NOT_REMAIN_OPEN');
    const detach = page.locator('[data-authored-cue="click"] [data-cue-detach]');
    if (!await detach.isVisible()) throw new Error('PHASE4_CUE_DETACH_NOT_VISIBLE');
    await page.locator('[data-authored-cue="click"] [data-cue-edit]').click();
    await page.locator('[data-cue-form="click"] .cue-timing > summary').click();
    await page.locator('[data-cue-form="click"] input[name="press"]').fill('1000');
    await page.locator('[data-cue-form="click"] input[name="release"]').fill('980');
    const beforeDetach = await page.evaluate(() => ({ revision: window.__motionEditor.inspectAuthoring().revision,
      html: window.__motionEditor.compiledHtml, exportDigest: window.__motionEditor.inspectAuthoring().exportDigest,
      trackIds: window.__motionEditor.trackIds, rows: window.__motionEditor.canonicalProjection.rows }));
    await page.locator('[data-cue-form="click"] button[type="submit"]').click();
    const rejectedDraft = await page.evaluate(() => ({ revision: window.__motionEditor.inspectAuthoring().revision,
      diagnostic: document.querySelector('[data-cue-status]').dataset.diagnosticCode,
      step: document.querySelector('[data-cue-workspace]').dataset.step }));
    if (rejectedDraft.revision !== beforeDetach.revision || rejectedDraft.diagnostic !== 'CUE_UPDATE_INVALID'
      || rejectedDraft.step !== 'edit-click') throw new Error('PHASE4_REJECTED_CLICK_DRAFT_NOT_REPRODUCED');
    await detach.click();
    await page.waitForFunction((expectedRevision) => window.__motionEditor.inspectAuthoring().revision === expectedRevision,
      beforeDetach.revision + 1);
    await page.locator('[data-authored-cue="click"]').waitFor({ state: 'detached' });
    await page.locator('[data-cue-workspace][data-step="detached-click"]').waitFor({ state: 'attached' });
    await page.locator('[data-cue-status][data-kind="success"]').filter({ hasText: 'detached to ordinary tracks' })
      .waitFor({ state: 'attached' });
    const detached = await page.evaluate(() => ({ cueCount: document.querySelectorAll('[data-authored-cue]').length,
      revision: window.__motionEditor.inspectAuthoring().revision,
      exactCompilerOutput: document.querySelector('[data-preview]').srcdoc === window.__motionEditor.compiledHtml,
      html: window.__motionEditor.compiledHtml, exportDigest: window.__motionEditor.inspectAuthoring().exportDigest,
      trackIds: window.__motionEditor.trackIds, rows: window.__motionEditor.canonicalProjection.rows,
      step: document.querySelector('[data-cue-workspace]').dataset.step,
      clickFormHidden: document.querySelector('[data-cue-form="click"]').hidden,
      clickCreateDisabled: document.querySelector('[data-cue-form="click"] button[type="submit"]').disabled,
      diagnostic: document.querySelector('[data-cue-status]').dataset.diagnosticCode ?? null }));
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.locator('[data-authored-cue="click"]').waitFor({ state: 'attached' });
    const undoRestored = await page.evaluate((expectedRevision) => document.querySelector('[data-cue-workspace]').dataset.step === 'complete'
      && document.querySelector('[data-cue-status]').textContent.includes('Undid the last change')
      && window.__motionEditor.inspectAuthoring().revision === expectedRevision, beforeDetach.revision + 2);
    await page.locator('[data-authored-cue="click"] [data-cue-edit]').click();
    const restoredCanonicalDraft = await page.locator('[data-cue-form="click"]').evaluate((form) => {
      const data = new FormData(form); return { press: data.get('press'), release: data.get('release'),
        diagnostic: document.querySelector('[data-cue-status]').dataset.diagnosticCode ?? null };
    });
    await page.getByRole('button', { name: 'Redo' }).click();
    await page.locator('[data-cue-workspace][data-step="detached-click"]').waitFor({ state: 'attached' });
    const redoDetached = await page.evaluate((expectedRevision) => document.querySelector('[data-cue-status]').textContent.includes('Redid the last change')
      && window.__motionEditor.inspectAuthoring().revision === expectedRevision, beforeDetach.revision + 3);
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.locator('[data-cue-workspace][data-step="complete"]').waitFor({ state: 'attached' });
    const repeatUndoRevision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
    await page.getByRole('button', { name: 'Redo' }).click();
    await page.locator('[data-cue-workspace][data-step="detached-click"]').waitFor({ state: 'attached' });
    const repeatRedoRevision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
    const appOwnedErrorCount = originAttribution.filter((item) => item.origin === 'app').length;
    const unknownErrorCount = originAttribution.filter((item) => item.origin === 'unknown').length;
    const maximumEndpointErrorDevicePixels = Math.max(...endpointDragProofs.flatMap((proof) => [proof.midpointErrorDevicePixels,
      proof.destinationErrorDevicePixels, proof.immediateReleaseErrorDevicePixels, proof.settledReleaseErrorDevicePixels]));
    const passed = authored.revision === 14 && authored.exactCompilerOutput && authored.animationCount > 0
      && authored.nativeAnimationCount === authored.animationCount && authored.cueCount === 3 && authored.ownedTrackCount >= 5
      && reducedAnimationCount === 0 && detached.cueCount === 2 && detached.exactCompilerOutput
      && visiblePathDistanceCssPixels > 10 && playRestartsAtEnd && paritySamples.every((sample) => sample.edgeDelta <= 1 && sample.contained)
      && overlapDisambiguationCount > 0
      && keyboardTargetSelection
      && compilerCursorVisibleAtAuthoredMoments && endpointDragProofs.length === 4 && maximumEndpointErrorDevicePixels <= 1
      && detached.revision === beforeDetach.revision + 1 && detached.html === beforeDetach.html
      && detached.exportDigest === beforeDetach.exportDigest && isDeepStrictEqual(detached.trackIds, beforeDetach.trackIds)
      && isDeepStrictEqual(detached.rows, beforeDetach.rows)
      && detached.step === 'detached-click' && detached.clickFormHidden && detached.clickCreateDisabled && detached.diagnostic === null
      && undoRestored && restoredCanonicalDraft.press === '800' && restoredCanonicalDraft.release === '920'
      && restoredCanonicalDraft.diagnostic === null && redoDetached
      && repeatUndoRevision === beforeDetach.revision + 4 && repeatRedoRevision === beforeDetach.revision + 5
      && new URL(editorUrl).hostname === 'lineage-motion.localhost'
      && Object.values(diagnostics).every((items) => items.length === 0) && appOwnedErrorCount === 0 && unknownErrorCount === 0;
    const receipt = { schemaVersion: 'motion.phase4-installed-chrome-receipt.v1', passed,
      cueCount: authored.cueCount, ownedTrackCount: authored.ownedTrackCount,
      nativeAnimationCount: authored.nativeAnimationCount, exactCompilerOutput: authored.exactCompilerOutput,
      namedSubdomain: new URL(editorUrl).hostname === 'lineage-motion.localhost', canvasTargetPicking: true,
      ordinaryPointerSelection: true, stableTargetIdsAsserted: true, overlapDisambiguation: 'explicit-neutral',
      overlapDisambiguationCount, keyboardFallbackTargetSelection: keyboardTargetSelection,
      cleanLoadResizeCycles: 3, coordinateParitySampleCount: paritySamples.length, maximumAllowedCssPixelDelta: 1,
      directPathManipulation: true, compilerCursorVisibleAtAuthoredMoments, cursorVisibilitySamples,
      endpointDragProofCount: endpointDragProofs.length, maximumEndpointErrorDevicePixels,
      visiblePathDistanceCssPixels: Math.round(visiblePathDistanceCssPixels), playRestartsAtEnd,
      reducedAnimationCount, detachPreservedCompilerOutput: detached.exactCompilerOutput && detached.html === beforeDetach.html,
      rejectedDraftDetachUndoRedoExact: undoRestored && redoDetached && repeatUndoRevision === beforeDetach.revision + 4
        && repeatRedoRevision === beforeDetach.revision + 5,
      detachedCreateImpossible: detached.clickFormHidden && detached.clickCreateDisabled,
      runtimeErrorCount: diagnostics.consoleErrors.length + diagnostics.pageErrors.length,
      errorOriginCounts: { app: appOwnedErrorCount, outsideApp: originAttribution.filter((item) => item.origin === 'outside-app').length,
        unknown: unknownErrorCount },
      sourceLessMutationObserverAnomaly: unknownErrorCount === 0 ? 'not-reproduced-in-three-installed-chrome-clean-cycles' : 'source-less-unknown-origin',
      failedRequestCount: diagnostics.failedRequests.length, unexpectedNetworkCount: diagnostics.unexpectedNetwork.length };
    await mkdir(resolve(qaRoot, '.motion/receipts'), { recursive: true });
    await writeFile(resolve(qaRoot, '.motion/receipts/phase4-installed-chrome.json'), `${JSON.stringify(receipt, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(receipt)}\n`); if (!passed) throw new Error('PHASE4_CHROME_QA_FAILED');
  } finally { await qaBrowser?.close(); qaServer.kill('SIGTERM'); }
  process.exit();
}
}
