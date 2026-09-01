import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { isDeepStrictEqual } from 'node:util';

import { chromium } from '@playwright/test';

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
  await runLandingShot1Qa({ authority: 'public', workspaceSmokeOnly: false });
  process.exit();
}
if (process.argv[2] === '--landing-shot1') {
  await runLandingShot1Qa({ authority: 'private', workspaceSmokeOnly: process.argv.includes('--workspace-smoke-only') });
  process.exit();
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

const root = resolve(import.meta.dirname, '../../..');
const port = 0;
const server = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/qa-chrome.mjs'),
  '--vite-listen-ready', String(port)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });

let browser;
try {
  const { editorUrl: url } = await observeServerAddress(server, 'CHROME_QA');
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const unexpectedNetwork = [];
  const httpErrors = [];
  monitorPage(page, [url], { consoleErrors, pageErrors, failedRequests, unexpectedNetwork, httpErrors });
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
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 1);
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  const createContinuity = await page.evaluate((scrollBefore) => ({
    focus: document.activeElement?.hasAttribute('data-add-midpoint') === true,
    noScroll: scrollY === scrollBefore,
    duration: document.querySelector('[data-duration]').value,
    delay: document.querySelector('[data-delay]').value,
    easing: document.querySelector('[data-easing]').value,
  }), scrollBeforeCreate);
  await page.locator('[data-add-midpoint]').click();
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 2);
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
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 3);
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  const durationDraftCleared = await page.locator('.timing-control:has([data-duration]) em').isHidden();
  await page.locator('[data-delay]').fill('700');
  await page.locator('[data-set-delay]').click();
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 4);
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  await page.locator('select[data-easing]').selectOption('ease-in-out');
  await page.locator('[data-set-easing]').click();
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 5);
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  await page.getByRole('button', { name: 'Remove midpoint' }).click();
  await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 6);
  workflowStates.push(await page.evaluate(() => window.__motionEditor.inspectAuthoring()));
  const staleEvidence = await page.evaluate(async () => {
    const before = window.__motionEditor.inspectAuthoring();
    const result = await window.__motionEditor.dispatch({ schemaVersion: 'motion.operation.v1',
      operationId: 'chrome:stale-structural', documentId: before.documentId, expectedRevision: 5,
      kind: 'motion.slot-duration.set', elementId: 'el_2dbee68b1ea318c8',
      trackId: before.selectedTrackId, payload: { durationMs: 1200 } });
    return { result, before, after: window.__motionEditor.inspectAuthoring() };
  });
  const staleAtomic = staleEvidence.result.ok === false
    && staleEvidence.result.code === 'AUTHORING_STALE_REVISION'
    && isDeepStrictEqual(staleEvidence.before, staleEvidence.after);
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
    focus: document.activeElement?.getAttribute('data-set-duration') !== null,
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
  for (let index = 0; index < 6; index += 1) {
    if (index === 5) await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
    await page.getByRole('button', { name: 'Undo' }).click();
    await page.waitForFunction((revision) => window.__motionEditor.inspectAuthoring().revision === revision
      && document.activeElement?.hasAttribute('data-undo'), 7 + index);
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
      && document.querySelector('[data-duration]').getAttribute('aria-invalid') === 'false'
      && document.querySelector('[data-delay]').getAttribute('aria-invalid') === 'false');
    historyUiRehydrated &&= Math.abs(anchor.topAfter - anchor.topBefore) <= 0.1
      || (anchor.scrollAfter === anchor.maxScrollAfter && anchor.topAfter > anchor.topBefore);
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
  }
  for (let index = 0; index < 6; index += 1) {
    await page.getByRole('button', { name: 'Redo' }).click();
    await page.waitForFunction((revision) => window.__motionEditor.inspectAuthoring().revision === revision
      && document.activeElement?.hasAttribute('data-redo'), 13 + index);
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
      && document.querySelector('[data-duration]').getAttribute('aria-invalid') === 'false'
      && document.querySelector('[data-delay]').getAttribute('aria-invalid') === 'false');
    historyUiRehydrated &&= Math.abs(anchor.topAfter - anchor.topBefore) <= 0.1
      || (anchor.scrollAfter === anchor.maxScrollAfter && anchor.topAfter > anchor.topBefore);
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
      redoOneReverseContinuity = Math.abs(anchor.topAfter - anchor.topBefore) <= 0.1;
    }
  }
  const historyRehydrated = await page.evaluate(() => ({
    duration: document.querySelector('[data-duration]').value,
    delay: document.querySelector('[data-delay]').value,
    easing: document.querySelector('[data-easing]').value,
    appliedDuration: document.querySelector('[data-applied-duration]').textContent,
  }));
  const structuralNative = await page.evaluate(() => {
    const iframe = document.querySelector('[data-preview]');
    return iframe.srcdoc === window.__motionEditor.compiledHtml
      && iframe.contentDocument.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation');
  });
  const cursorPage = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  monitorPage(cursorPage, [url], { consoleErrors, pageErrors, failedRequests, unexpectedNetwork, httpErrors });
  await cursorPage.goto(url);
  await cursorPage.locator('[data-editor-ready="true"]').waitFor();
  await cursorPage.getByRole('radio', { name: /Cursor/ }).click();
  await cursorPage.getByRole('button', { name: 'Create Cursor opacity track' }).click();
  const cursorAlternate = await cursorPage.evaluate(() => {
    const iframe = document.querySelector('[data-preview]');
    return { state: window.__motionEditor.inspectAuthoring(),
      exact: iframe.srcdoc === window.__motionEditor.compiledHtml,
      native: iframe.contentDocument.getAnimations().every((animation) =>
        animation.constructor.name === 'CSSAnimation') };
  });
  await cursorPage.close();
  const orbTrackId = workflowStates[1].selectedTrackId;
  const cursorDistinct = cursorAlternate.state.revision === 1
    && cursorAlternate.state.selectedCreationElementId === 'el_a2849ff826f3e167'
    && cursorAlternate.state.selectedTrackId !== orbTrackId
    && cursorAlternate.exact && cursorAlternate.native;

  const responsive = {};
  for (const width of [1440, 1099, 768, 390]) {
    const responsivePage = await browser.newPage({ viewport: { width, height: 1000 } });
    monitorPage(responsivePage, [url], { consoleErrors, pageErrors, failedRequests, unexpectedNetwork, httpErrors });
    await responsivePage.goto(url);
    await responsivePage.locator('[data-editor-ready="true"]').waitFor();
    responsive[width] = await responsivePage.evaluate(() => {
      const workflow = document.querySelector('.workflow').getBoundingClientRect();
      const preview = document.querySelector('.preview-panel').getBoundingClientRect();
      return { contained: document.documentElement.scrollWidth <= innerWidth,
        twoColumn: Math.abs(workflow.top - preview.top) < 2 && preview.left > workflow.left,
        oneColumn: preview.top > workflow.top };
    });
    if (width <= 768) {
      await responsivePage.locator('.inspect-panel').getByText('Inspect all tracks', { exact: true }).click();
      responsive[width].localTrackOverflow = await responsivePage.locator('.timeline-panel')
        .evaluate((node) => node.scrollWidth > node.clientWidth && document.documentElement.scrollWidth <= innerWidth);
      await responsivePage.locator('.inspect-panel').getByText('Inspect all tracks', { exact: true }).click();
    }
    const responsiveInitial = await responsivePage.evaluate(() => window.__motionEditor.inspectAuthoring());
    await responsivePage.getByRole('radio', { name: /Orb/ }).click();
    await responsivePage.locator('[data-create-track]').click();
    await responsivePage.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 1);
    const responsiveCreated = await responsivePage.evaluate(() => window.__motionEditor.inspectAuthoring());
    await responsivePage.locator('[data-undo]').evaluate((button) => button.scrollIntoView({ block: 'center' }));
    await responsivePage.locator('[data-undo]').click();
    await responsivePage.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 2
      && document.activeElement?.hasAttribute('data-undo'));
    const responsiveUndo = await responsivePage.locator('[data-undo]').evaluate((button) => ({
      state: window.__motionEditor.inspectAuthoring(),
      topBefore: Number(button.dataset.historyViewportTopBefore),
      topAfter: Number(button.dataset.historyViewportTopAfter),
      scrollAfter: Number(button.dataset.historyScrollAfter),
      maxScrollAfter: Number(button.dataset.historyMaxScrollAfter),
    }));
    await responsivePage.locator('[data-redo]').click();
    await responsivePage.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 3
      && document.activeElement?.hasAttribute('data-redo'));
    const responsiveRedo = await responsivePage.locator('[data-redo]').evaluate((button) => ({
      state: window.__motionEditor.inspectAuthoring(),
      topBefore: Number(button.dataset.historyViewportTopBefore),
      topAfter: Number(button.dataset.historyViewportTopAfter),
      scrollAfter: Number(button.dataset.historyScrollAfter),
      maxScrollAfter: Number(button.dataset.historyMaxScrollAfter),
      contained: document.documentElement.scrollWidth <= innerWidth,
    }));
    const anchoredOrClamped = (evidence) => Math.abs(evidence.topAfter - evidence.topBefore) <= 0.1
      || (evidence.scrollAfter === evidence.maxScrollAfter && evidence.topAfter > evidence.topBefore);
    responsive[width].historyAnchor = anchoredOrClamped(responsiveUndo)
      && anchoredOrClamped(responsiveRedo) && responsiveRedo.contained
      && responsiveUndo.state.contentDigest === responsiveInitial.contentDigest
      && responsiveRedo.state.contentDigest === responsiveCreated.contentDigest;
    await responsivePage.close();
  }
  const responsiveContract = responsive[1440].twoColumn && responsive[1440].contained
    && [1099, 768, 390].every((width) => responsive[width].oneColumn && responsive[width].contained)
    && responsive[768].localTrackOverflow && responsive[390].localTrackOverflow;
  const responsiveHistoryAnchors = [1440, 1099, 768, 390]
    .every((width) => responsive[width].historyAnchor);

  const persistenceDirectory = await mkdtemp(join(tmpdir(), 'lineage-motion-chrome-'));
  const persistencePort = 0;
  const humanCapability = randomBytes(32).toString('base64url');
  const agentCapability = randomBytes(32).toString('base64url');
  const persistence = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: root, env: { ...process.env, PHASE3_DATABASE_PATH: join(persistenceDirectory, 'project.sqlite'),
      PHASE3_EDITOR_PORT: String(persistencePort), PHASE3_HUMAN_CAPABILITY: humanCapability,
      PHASE3_AGENT_CAPABILITY: agentCapability }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let persistenceChecks;
  try {
    const addresses = await observeServerAddress(persistence, 'PERSISTENCE_CHROME');
    const persistencePage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const persistenceErrors = []; const persistencePageErrors = []; const persistenceFailedRequests = [];
    const expectedFailedRequests = []; let allowExpectedEventAbort = false;
    const persistenceUnexpectedNetwork = []; const persistenceHttpErrors = [];
    const persistenceDiagnostics = { consoleErrors: persistenceErrors, pageErrors: persistencePageErrors,
      failedRequests: persistenceFailedRequests, unexpectedNetwork: persistenceUnexpectedNetwork,
      httpErrors: persistenceHttpErrors, expectedFailedRequests,
      allowFailedRequest: (request) => allowExpectedEventAbort
        && request.url().endsWith('/events') && request.failure()?.errorText === 'net::ERR_ABORTED' };
    monitorPage(persistencePage, [addresses.editorUrl, addresses.serviceUrl], persistenceDiagnostics);
    const editorOperationIds = []; const eventCursors = [];
    const captureEditorOperationId = (request) => {
      if (!request.url().endsWith('/api/v1/commands')) return;
      const command = request.postDataJSON();
      if (typeof command?.operationId === 'string' && command.operationId.startsWith('editor:'))
        editorOperationIds.push(command.operationId);
    };
    persistencePage.on('request', captureEditorOperationId);
    persistencePage.on('request', (request) => { if (request.url().endsWith('/events'))
      eventCursors.push(request.headers()['last-event-id'] ?? 'missing'); });
    await persistencePage.goto(addresses.editorUrl); await persistencePage.locator('[data-editor-ready="true"]').waitFor();
    await persistencePage.locator('[data-new-branch]').fill('chromefeature');
    await persistencePage.locator('[data-branch-form] button').click();
    await persistencePage.waitForFunction(() => document.querySelector('[data-operation-status]').textContent.includes('Branch chromefeature head revision 0 loaded'));
    const mainEditorPage = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    monitorPage(mainEditorPage, [addresses.editorUrl, addresses.serviceUrl], persistenceDiagnostics);
    mainEditorPage.on('request', captureEditorOperationId);
    await mainEditorPage.goto(addresses.editorUrl); await mainEditorPage.locator('[data-editor-ready="true"]').waitFor();
    const documentId = await persistencePage.evaluate(() => window.__motionEditor.inspectAuthoring().documentId);
    const secret = ['chrome', 'claim', 'proof', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const acquisition = { protocolVersion: 'motion.protocol.v1', operationId: 'chrome-claim', documentId,
      branchId: 'chromefeature', expectedRevision: 0, command: { schemaVersion: 'motion.control.v1',
        kind: 'motion.claim.acquire', operationId: 'chrome-claim', documentId, expectedRevision: 0,
        payload: { scope: 'branch', branchId: 'chromefeature' } } };
    const acquired = await fetch(`${addresses.serviceUrl}/api/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${agentCapability}`, 'x-motion-actor': 'agent',
      'x-motion-claim-secret': secret }, body: JSON.stringify(acquisition) }).then((response) => response.json());
    await persistencePage.locator('[data-claim-id]').fill(acquired.claimId);
    await persistencePage.locator('[data-lease-version]').fill(String(acquired.leaseVersion));
    await persistencePage.locator('[data-revoke-form] button').click();
    await persistencePage.waitForFunction(() => document.querySelector('[data-operation-status]').textContent.includes('revoked at lease version 2'));
    await persistencePage.waitForFunction(() => window.__motionEditor.inspectAuthoring().lastCommitSeq >= 3);
    await persistencePage.getByRole('radio', { name: /Orb/ }).click();
    await persistencePage.locator('[data-new-branch]').fill('');
    allowExpectedEventAbort = true;
    await persistencePage.evaluate(() => window.__motionEditor.disconnectEvents());
    await persistencePage.waitForTimeout(50);
    allowExpectedEventAbort = false;
    const cliFeature = await runRealCli(['track-create', '--service', addresses.serviceUrl, '--operation-id', 'chrome-cli-feature',
      '--document-id', documentId, '--branch-id', 'chromefeature', '--expected-revision', '0',
      '--element-id', 'el_2dbee68b1ea318c8', '--capability', humanCapability]);
    await persistencePage.evaluate(() => window.__motionEditor.reconnectEvents());
    await persistencePage.waitForFunction(() => window.__motionEditor.inspectAuthoring().revision === 1
      && !document.querySelector('[data-draft-conflict]').hidden);
    const combinedReconnectDraft = await persistencePage.evaluate(() => { const frame = document.querySelector('[data-preview]');
      const state = window.__motionEditor.inspectAuthoring(); return { revision: state.revision, cursor: state.lastCommitSeq,
        staleBase: state.draftStaleBaseRevision, dirty: state.draftDirty, emptyDraft: state.draftValues['[data-new-branch]'] === '',
        targetId: state.selectedCreationElementId, conflictVisible: !document.querySelector('[data-draft-conflict]').hidden,
        exactCompilerOutput: frame.srcdoc === window.__motionEditor.compiledHtml,
        nativeAnimations: frame.contentDocument.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation') }; });
    const mainWrite = { protocolVersion: 'motion.protocol.v1', operationId: 'chrome-diverged-main', documentId,
      branchId: 'main', expectedRevision: 0, command: { schemaVersion: 'motion.operation.v1', kind: 'motion.track.create',
        operationId: 'chrome-diverged-main', documentId, expectedRevision: 0, elementId: 'el_a2849ff826f3e167',
        payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 } } };
    const mainWritten = await fetch(`${addresses.serviceUrl}/api/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${humanCapability}`, 'x-motion-actor': 'human',
    }, body: JSON.stringify(mainWrite) }).then((response) => response.json());
    const documentSecret = ['chrome', 'document', 'proof', '0123456789', 'abcdefghijklmnopqrstuvwxyz'].join('-');
    const documentAcquisition = { protocolVersion: 'motion.protocol.v1', operationId: 'chrome-document-claim', documentId,
      branchId: 'chromefeature', expectedRevision: 2, command: { schemaVersion: 'motion.control.v1',
        kind: 'motion.claim.acquire', operationId: 'chrome-document-claim', documentId, expectedRevision: 2,
        payload: { scope: 'document' } } };
    const documentAcquired = await fetch(`${addresses.serviceUrl}/api/v1/commands`, { method: 'POST', headers: {
      'content-type': 'application/json', authorization: `Bearer ${agentCapability}`, 'x-motion-actor': 'agent',
      'x-motion-claim-secret': documentSecret }, body: JSON.stringify(documentAcquisition) }).then((response) => response.json());
    const agentHeaders = { 'content-type': 'application/json', authorization: `Bearer ${agentCapability}`,
      'x-motion-actor': 'agent', 'x-motion-claim-secret': documentSecret };
    const control = async (kind, operationId, claimId, leaseVersion) => fetch(`${addresses.serviceUrl}/api/v1/commands`, {
      method: 'POST', headers: agentHeaders, body: JSON.stringify({ protocolVersion: 'motion.protocol.v1', operationId,
        documentId, branchId: 'chromefeature', expectedRevision: 2, command: { schemaVersion: 'motion.control.v1', kind,
          operationId, documentId, expectedRevision: 2, payload: { claimId, leaseVersion } } }),
    }).then((response) => response.json());
    const documentRenewed = await control('motion.claim.renew', 'chrome-document-renew', documentAcquired.claimId, 1);
    const documentReleased = await control('motion.claim.release', 'chrome-document-release', documentAcquired.claimId, 2);
    const reacquisition = { ...documentAcquisition, operationId: 'chrome-document-reacquire', command: {
      ...documentAcquisition.command, operationId: 'chrome-document-reacquire' } };
    const documentReacquired = await fetch(`${addresses.serviceUrl}/api/v1/commands`, { method: 'POST', headers: agentHeaders,
      body: JSON.stringify(reacquisition) }).then((response) => response.json());
    await mainEditorPage.locator('[data-claim-id]').fill(documentReacquired.claimId);
    await mainEditorPage.locator('[data-lease-version]').fill(String(documentReacquired.leaseVersion));
    await mainEditorPage.locator('[data-revoke-form] button').click();
    await mainEditorPage.waitForFunction(() => document.querySelector('[data-operation-status]').value
      .includes('revoked at lease version 2'));
    const readHeaders = { authorization: `Bearer ${humanCapability}`, 'x-motion-actor': 'human' };
    const mainHead = await fetch(`${addresses.serviceUrl}/api/v1/documents/${encodeURIComponent(documentId)}/branches/main/head`, { headers: readHeaders })
      .then((response) => response.json());
    const featureHead = await fetch(`${addresses.serviceUrl}/api/v1/documents/${encodeURIComponent(documentId)}/branches/chromefeature/head`, { headers: readHeaders })
      .then((response) => response.json());
    persistenceChecks = await persistencePage.evaluate(() => { const frame = document.querySelector('[data-preview]');
      return { branch: window.__motionEditor.inspectAuthoring().activeBranchId,
        revision: window.__motionEditor.inspectAuthoring().revision,
        lastCommit: window.__motionEditor.inspectAuthoring().lastCommit,
        exactCompilerOutput: frame.srcdoc === window.__motionEditor.compiledHtml,
        nativeAnimations: frame.contentDocument.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation') }; });
    persistenceChecks.mainEditor = await mainEditorPage.evaluate(() => { const frame = document.querySelector('[data-preview]');
      return { branch: window.__motionEditor.inspectAuthoring().activeBranchId,
        revision: window.__motionEditor.inspectAuthoring().revision,
        exactCompilerOutput: frame.srcdoc === window.__motionEditor.compiledHtml,
        nativeAnimations: frame.contentDocument.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation') }; });
    persistenceChecks.divergedControlIsolated = mainWritten.resultingRevision === 2 && mainHead.document.revision === 2
      && featureHead.document.revision === 1 && documentAcquired.resultingRevision === 1
      && documentRenewed.leaseVersion === 2 && documentReleased.leaseVersion === 3
      && documentReacquired.leaseVersion === 1 && persistenceChecks.revision === 1
      && persistenceChecks.mainEditor.branch === 'main' && persistenceChecks.mainEditor.revision === 2
      && persistenceChecks.mainEditor.exactCompilerOutput && persistenceChecks.mainEditor.nativeAnimations;
    persistenceChecks.combinedReconnectDraft = cliFeature.ok && cliFeature.resultingRevision === 1
      && combinedReconnectDraft.revision === 1 && combinedReconnectDraft.cursor >= 4 && combinedReconnectDraft.staleBase === 0
      && combinedReconnectDraft.dirty && combinedReconnectDraft.emptyDraft
      && combinedReconnectDraft.targetId === 'el_2dbee68b1ea318c8' && combinedReconnectDraft.conflictVisible
      && combinedReconnectDraft.exactCompilerOutput && combinedReconnectDraft.nativeAnimations
      && eventCursors.some((cursor) => Number(cursor) > 0);
    persistenceChecks.eventCursors = eventCursors;
    persistenceChecks.editorOperationIds = editorOperationIds;
    persistenceChecks.collisionFreeEditorOperationIds = editorOperationIds.length === 3
      && editorOperationIds.every((operationId) => /^editor:[0-9a-f-]{36}:[1-3]$/.test(operationId))
      && new Set(editorOperationIds).size === editorOperationIds.length;
    persistenceChecks.consoleErrors = persistenceErrors; persistenceChecks.pageErrors = persistencePageErrors;
    persistenceChecks.failedRequests = persistenceFailedRequests;
    persistenceChecks.expectedDisconnectAbortCount = expectedFailedRequests.length;
    persistenceChecks.unexpectedNetwork = persistenceUnexpectedNetwork;
    persistenceChecks.httpErrors = persistenceHttpErrors;
    persistenceChecks.noConsoleErrors = persistenceErrors.length === 0;
    persistenceChecks.noPageErrors = persistencePageErrors.length === 0;
    persistenceChecks.noFailedRequests = persistenceFailedRequests.length === 0;
    persistenceChecks.noUnexpectedNetwork = persistenceUnexpectedNetwork.length === 0;
    persistenceChecks.noHttpErrors = persistenceHttpErrors.length === 0;
    await persistencePage.close(); await mainEditorPage.close();
  } finally {
    persistence.kill('SIGTERM'); if (persistence.exitCode === null) await new Promise((resolveExit) => persistence.once('exit', resolveExit));
    await rm(persistenceDirectory, { recursive: true, force: true });
  }

  const checks = {
    exactCompilerOutput: initial.exactCompilerOutput,
    minimalSandbox: initial.sandbox === 'allow-same-origin',
    nativeAnimationsOnly: initial.animationCount > 0
      && initial.nativeAnimationCount === initial.animationCount,
    completeTrackRows: renderedTrackIds.length === initial.trackIds.length
      && new Set(renderedTrackIds).size === renderedTrackIds.length
      && initial.trackIds.every((id) => renderedTrackIds.includes(id)),
    completeTrackDetails: timelineRows.every((row) => row.elementId && row.property
      && Number.isFinite(row.delayMs) && row.declaredKeyframes === row.renderedKeyframes),
    canonicalProjectionEqual: isDeepStrictEqual(renderedProjection, initial.canonicalProjection),
    simultaneousSlotsShown: timelineRows.some((row) => row.slotCount > 1),
    stepTimingShown: timelineRows.some((row) => row.timingKind === 'steps'),
    everyCueScrubbed,
    playPauseNative,
    reducedMotionInspectable,
    freshStateTruthful: freshWorkflow.noFalseKeyframeClaim && freshWorkflow.inspectionCollapsed,
    uniqueApplyNames: isDeepStrictEqual(freshWorkflow.uniqueApplyNames,
      ['Apply duration', 'Apply delay', 'Apply easing']),
    initialDocumentContained: freshWorkflow.documentContained,
    selectionEphemeral,
    structuralWorkflow: workflowStates.length === 7 && workflowStates.at(-1).revision === 6,
    createContinuity: createContinuity.focus && createContinuity.noScroll
      && createContinuity.duration === '1000' && createContinuity.delay === '610'
      && createContinuity.easing === 'linear',
    shapeFocusIntentional: Object.values(shapeFocusEvidence).every(Boolean),
    draftTruthConditional: durationDraftVisible && durationDraftCleared,
    staleAtomic,
    invalidAtomic,
    exactSixStepHistory: exactHistory,
    historyUiRehydrated,
    historySelectionTruth,
    disabledEditAtomic,
    undoSixClampProven,
    redoOneReverseContinuity,
    historyRehydrated: historyRehydrated.duration === '1400' && historyRehydrated.delay === '700'
      && historyRehydrated.easing === 'ease-in-out'
      && historyRehydrated.appliedDuration === 'Applied · 1400 ms',
    responsiveContract,
    responsiveHistoryAnchors,
    structuralNative,
    cursorDistinct,
    persistentBranchClaimPath: persistenceChecks.branch === 'chromefeature' && persistenceChecks.exactCompilerOutput
      && persistenceChecks.nativeAnimations && persistenceChecks.divergedControlIsolated
      && persistenceChecks.combinedReconnectDraft && persistenceChecks.collisionFreeEditorOperationIds
      && persistenceChecks.noConsoleErrors && persistenceChecks.noPageErrors
      && persistenceChecks.noFailedRequests && persistenceChecks.expectedDisconnectAbortCount === 1
      && persistenceChecks.noUnexpectedNetwork && persistenceChecks.noHttpErrors,
    noConsoleErrors: consoleErrors.length === 0,
    noPageErrors: pageErrors.length === 0,
    noFailedRequests: failedRequests.length === 0,
    noUnexpectedNetwork: unexpectedNetwork.length === 0,
    noHttpErrors: httpErrors.length === 0,
  };
  const receipt = {
    schemaVersion: 'motion.target-selection-chrome-qa.v1',
    passed: Object.values(checks).every(Boolean),
    browser: { name: 'Google Chrome', version: browser.version() },
    viewport: { width: 1280, height: 720 },
    counts: {
      animationCount: initial.animationCount,
      cueCount: initial.cueIds.length,
      trackCount: initial.trackIds.length,
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
      failedRequestCount: failedRequests.length,
      unexpectedNetworkCount: unexpectedNetwork.length,
      httpErrorCount: httpErrors.length,
    },
    nativeTiming: {
      tolerance,
      beforePlayCurrentTimes: roundTimes(beforePlay.currentTimes),
      duringPlayCurrentTimes: roundTimes(duringPlay.currentTimes),
      afterPauseCurrentTimes: roundTimes(afterPause.currentTimes),
      pausedIntervalCurrentTimes: roundTimes(pausedInterval.currentTimes),
      advanceMs: roundTimes(advanceMs),
      pauseDriftMs: roundTimes(pauseDriftMs),
    },
    responsive,
    persistence: persistenceChecks,
    checks,
  };
  await mkdir(resolve(root, 'artifacts'), { recursive: true });
  const receiptText = `${JSON.stringify(receipt, null, 2)}\n`;
  await Promise.all([
    writeFile(resolve(root, 'artifacts/t005-ux-simplification-chrome-qa.json'), receiptText, 'utf8'),
    writeFile(resolve(root, 'artifacts/t002-target-selection-chrome-qa.json'), receiptText, 'utf8'),
    writeFile(resolve(root, 'artifacts/t004-chrome-qa.json'), receiptText, 'utf8'),
  ]);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  if (!receipt.passed) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill('SIGTERM');
}

async function observeServerAddress(processHandle, label) {
  return new Promise((resolveAddress, reject) => {
    let output = '';
    const timer = setTimeout(() => reject(new Error(`${label}_TIMEOUT`)), 10000);
    processHandle.stdout.on('data', (chunk) => {
      output += chunk.toString();
      const line = output.split('\n').find((candidate) => candidate.startsWith('{'));
      if (line) { clearTimeout(timer); resolveAddress(JSON.parse(line)); }
    });
    processHandle.once('exit', (code) => { clearTimeout(timer); reject(new Error(`${label}_EXIT_${code}`)); });
  });
}

async function ensureAdvancedOpen(page) {
  const advanced = page.locator('[data-shot-advanced]');
  if (await advanced.getAttribute('open') === null) await advanced.locator('summary').click();
}

async function reserveEphemeralPort() {
  const server = createNetServer();
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('CHROME_QA_EPHEMERAL_PORT_UNAVAILABLE');
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}

function roundTimes(values) {
  return values.map((value) => value === null ? null : Math.round(value * 1000) / 1000);
}

function monitorPage(page, allowedBaseUrls, diagnostics) {
  const allowedOrigins = new Set(allowedBaseUrls.map((value) => new URL(value).origin));
  page.on('console', (message) => {
    if (message.type() === 'error') diagnostics.consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => diagnostics.pageErrors.push(error.message));
  page.on('requestfailed', (request) => {
    const evidence = { method: request.method(), resourceType: request.resourceType(),
      failure: request.failure()?.errorText ?? 'unknown' };
    if (diagnostics.allowFailedRequest?.(request)) diagnostics.expectedFailedRequests.push(evidence);
    else diagnostics.failedRequests.push(evidence);
  });
  page.on('request', (request) => {
    const target = request.url();
    if (!/^https?:/i.test(target)) return;
    if (!allowedOrigins.has(new URL(target).origin)) diagnostics.unexpectedNetwork.push({
      method: request.method(), resourceType: request.resourceType(),
    });
  });
  page.on('response', (response) => {
    if (!response.ok()) diagnostics.httpErrors.push({ status: response.status(), resourceType: response.request().resourceType() });
  });
}

async function runRealCli(args) {
  const encoded = Buffer.from(JSON.stringify(args)).toString('base64url');
  const child = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/qa-chrome.mjs'), '--real-cli', encoded],
    { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderr = ''; child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const code = await new Promise((resolveExit) => child.once('exit', resolveExit));
  if (code !== 0) throw new Error(`REAL_CLI_FAILED_${code}_${stderr.length}`); return JSON.parse(stdout);
}

async function resolveShot1CanonicalEasing(repositoryRoot, authority, privateDocumentPath) {
  const args = ['exec', 'vite-node', '--', resolve(repositoryRoot, 'apps/editor/scripts/qa-chrome.mjs'),
    '--resolve-shot1-canonical-easing', authority];
  if (authority === 'private') args.push(privateDocumentPath);
  const child = spawn('npm', args, { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; let stderrLength = 0;
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderrLength += chunk.length; });
  const code = await new Promise((resolveExit) => child.once('exit', resolveExit));
  if (code !== 0) throw new Error(`SHOT1_CANONICAL_EASING_RESOLVER_FAILED_${code}_${stderrLength}`);
  return JSON.parse(stdout);
}

function resolveShot1ProofAuthority(authority, availability) {
  if (authority === 'public') {
    if (!availability.publicFixture) throw new Error('SHOT1_PUBLIC_FIXTURE_REQUIRED');
    return { authority, source: 'fixtures/public-synthetic/landing-shot1.html' };
  }
  if (authority === 'private') {
    if (!availability.privateManifest || !availability.privateCanonical) throw new Error('SHOT1_PRIVATE_AUTHORITY_REQUIRED');
    return { authority, source: 'authenticated-ignored-manifest' };
  }
  throw new Error('SHOT1_PROOF_AUTHORITY_INVALID');
}

function assertShot1ProofRouting() {
  const publicRoute = resolveShot1ProofAuthority('public', { publicFixture: true, privateManifest: false, privateCanonical: false });
  const privateRoute = resolveShot1ProofAuthority('private', { publicFixture: false, privateManifest: true, privateCanonical: true });
  if (publicRoute.source !== 'fixtures/public-synthetic/landing-shot1.html' || privateRoute.source !== 'authenticated-ignored-manifest') {
    throw new Error('SHOT1_PROOF_ROUTE_MISMATCH');
  }
  for (const assertion of [
    () => resolveShot1ProofAuthority('public', { publicFixture: false, privateManifest: true, privateCanonical: true }),
    () => resolveShot1ProofAuthority('private', { publicFixture: true, privateManifest: false, privateCanonical: false }),
  ]) {
    let rejected = false; try { assertion(); } catch { rejected = true; }
    if (!rejected) throw new Error('SHOT1_PROOF_FALLBACK_DETECTED');
  }
}

async function observeActionCommit(page, expected) {
  try {
    await page.waitForFunction((contract) => { const inspected = window.__motionEditor.inspectAuthoring();
      const workspace = window.__motionEditor.inspectShotWorkspace();
      if (inspected.revision !== contract.revision || !workspace.previewMatchesCompiler) return false;
      const moments = [...document.querySelectorAll('input[name="shot-moment"]')].map((input) => Number(input.value));
      if (contract.moments && JSON.stringify(moments) !== JSON.stringify(contract.moments)) return false;
      if (contract.landing !== undefined && Number(document.querySelector('[data-shot-landing]').value) !== contract.landing) return false;
      if (contract.settled !== undefined && Number(document.querySelector('[data-shot-settled]').value) !== contract.settled) return false;
      if (contract.easing !== undefined && document.querySelector('[data-shot-easing]').value !== contract.easing) return false;
      return true;
    }, expected);
  } catch (error) {
    const observed = await page.evaluate(() => ({ authoring: window.__motionEditor.inspectAuthoring(), workspace: window.__motionEditor.inspectShotWorkspace(),
      moments: [...document.querySelectorAll('input[name="shot-moment"]')].map((input) => Number(input.value)),
      landing: Number(document.querySelector('[data-shot-landing]').value), settled: Number(document.querySelector('[data-shot-settled]').value),
      easing: document.querySelector('[data-shot-easing]').value, status: document.querySelector('[data-shot-status]').value }));
    throw new Error(`ACTION_COMMIT_MISMATCH_${JSON.stringify({ expected, observed })}`, { cause: error });
  }
  return page.evaluate(() => window.__motionEditor.inspectAuthoring());
}

async function observeGeometryCommit(page, { sampleCount, previousRequestId = null, moments = null }) {
  await page.waitForFunction((contract) => { const inspected = window.__motionEditor.inspectShotWorkspace();
    const frame = document.querySelector('[data-preview]'); const overlay = document.querySelector('[data-trajectory-overlay]');
    const handle = document.querySelector('[data-trajectory-overlay] [aria-pressed="true"]'); const pump = inspected.geometryPump;
    if (overlay.getAttribute('aria-busy') !== 'false' || pump.running || pump.activeSamplers !== 0 || pump.pendingRequestId !== null
      || pump.lastCommittedRequestId === null || pump.lastCommittedRequestId !== pump.latestRequestId
      || (contract.previousRequestId !== null && pump.lastCommittedRequestId <= contract.previousRequestId)
      || (contract.sampleCount !== null && inspected.geometry.length !== contract.sampleCount)
      || inspected.geometry.some((sample) => Object.values(sample.deltasDevicePixels).some((delta) => delta > 1))
      || !inspected.previewMatchesCompiler) return false;
    const animations = frame.contentDocument?.getAnimations() ?? []; const state = window.__motionEditor.readState();
    if (animations.length === 0 || animations.some((animation) => animation.constructor.name !== 'CSSAnimation'
      || animation.effect?.constructor.name !== 'KeyframeEffect' || animation.timeline?.constructor.name !== 'DocumentTimeline'
      || animation.currentTime !== state.playheadMs)) return false;
    if (contract.moments && JSON.stringify([...document.querySelectorAll('input[name="shot-moment"]')].map((input) => Number(input.value)))
      !== JSON.stringify(contract.moments)) return false;
    if (!(handle instanceof HTMLElement)) return false; const rect = handle.getBoundingClientRect(); const style = getComputedStyle(handle);
    return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
  }, { sampleCount, previousRequestId, moments });
  return page.evaluate(() => window.__motionEditor.inspectShotWorkspace().geometryPump);
}

async function currentGeometryRequestId(page) {
  return page.evaluate(() => window.__motionEditor.inspectShotWorkspace().geometryPump.lastCommittedRequestId);
}

async function materializePublicAsymmetricSeed(repositoryRoot, seedPath) {
  const { createLandingShot1EditorSeed } = await import('../../../packages/local-service/src/seed.ts');
  const seed = createLandingShot1EditorSeed(repositoryRoot); const targetElementIds = seed.elements.map((element) => element.id).sort();
  const track = seed.tracks.find((candidate) => candidate.elementId === targetElementIds[0] && candidate.property === 'transform');
  const ruleTrack = track && seed.rules.find((rule) => rule.id === track.ruleId)?.tracks.find((candidate) => candidate.property === 'transform');
  const landed = ruleTrack?.keyframes.find((keyframe) => keyframe.offset === 0.1);
  if (!ruleTrack || !landed || targetElementIds.length !== 2) throw new Error('ASYMMETRIC_CHROME_SEED_INVALID');
  landed.value = landed.value.replace(/translate\([^)]*\)/, 'translate(-40px, 170px)');
  ruleTrack.keyframes.push({ ...landed, id: 'kf_asymmetric_1400', offset: 0.2 });
  ruleTrack.keyframes.sort((left, right) => left.offset - right.offset);
  for (const expanded of seed.tracks.filter((candidate) => candidate.ruleId === track.ruleId && candidate.property === 'transform')) {
    expanded.keyframeIds = ruleTrack.keyframes.map((keyframe) => keyframe.id);
  }
  await writeFile(seedPath, `${JSON.stringify(seed)}\n`); process.stdout.write(`${JSON.stringify({ targetElementIds })}\n`);
}

async function runAsymmetricAlternatePrimaryQa({ repositoryRoot, directory, browser, port }) {
  const seedPath = resolve(directory, 'public-asymmetric.json');
  const seedProcess = spawn('npm', ['exec', 'vite-node', '--', resolve(repositoryRoot, 'apps/editor/scripts/qa-chrome.mjs'),
    '--materialize-public-asymmetric-seed', seedPath], { cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'] });
  const { targetElementIds } = await observeServerAddress(seedProcess, 'ASYMMETRIC_SEED');
  const seedExitCode = seedProcess.exitCode ?? await new Promise((resolveExit) => seedProcess.once('exit', resolveExit));
  if (seedExitCode !== 0) throw new Error('ASYMMETRIC_SEED_EXIT');
  const humanCapability = randomBytes(32).toString('base64url'); const agentCapability = randomBytes(32).toString('base64url');
  const processHandle = spawn('npm', ['exec', 'vite-node', '--', resolve(repositoryRoot, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: repositoryRoot, env: { ...process.env, PHASE3_DATABASE_PATH: resolve(directory, 'public-asymmetric.sqlite'),
      PHASE3_EDITOR_PORT: String(port), PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: agentCapability,
      LANDING_SHOT1_WORKSPACE: '1', LANDING_SHOT1_DOCUMENT_PATH: seedPath }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let page;
  try {
    const addresses = await observeServerAddress(processHandle, 'ASYMMETRIC_CHROME_SERVER');
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], unexpectedNetwork: [], httpErrors: [] };
    monitorPage(page, [addresses.editorUrl, addresses.serviceUrl], diagnostics);
    const commands = []; page.on('request', (request) => { if (request.url().endsWith('/api/v1/commands')) commands.push(request.postDataJSON().command); });
    await page.goto(addresses.editorUrl); await page.locator('[data-editor-ready="true"]').waitFor();
    await observeGeometryCommit(page, { sampleCount: 4, moments: [0, 700, 1400, 2100] });
    const primaries = page.locator('[data-shot-targets] input[name="shot-primary"]');
    if (await primaries.count() !== 2 || await page.locator('[data-shot-targets] input[type="checkbox"]').count() !== 0) throw new Error('ASYMMETRIC_SCOPE_CONTROLS');
    if (await page.getByRole('button', { name: 'Path' }).getAttribute('aria-pressed') !== 'true') await page.getByRole('button', { name: 'Path' }).click();
    await observeGeometryCommit(page, { sampleCount: 4, moments: [0, 700, 1400, 2100] });
    const polishBaseline = await page.evaluate(() => ({ revision: window.__motionEditor.inspectAuthoring().revision,
      contentDigest: window.__motionEditor.inspectAuthoring().contentDigest, exportDigest: window.__motionEditor.inspectAuthoring().exportDigest,
      native: window.__motionEditor.readState(), srcdoc: document.querySelector('[data-preview]').srcdoc,
      guidance: document.querySelector('[data-shot-guidance]').textContent, groupCopy: document.querySelector('.move-together').textContent }));
    await ensureAdvancedOpen(page);
    const landingDraft = page.locator('[data-shot-landing]'); await landingDraft.fill('2200'); await page.locator('[data-shot-apply-time]').click();
    const polishRejected = await page.evaluate(() => ({ revision: window.__motionEditor.inspectAuthoring().revision,
      contentDigest: window.__motionEditor.inspectAuthoring().contentDigest, exportDigest: window.__motionEditor.inspectAuthoring().exportDigest,
      native: window.__motionEditor.readState(), srcdoc: document.querySelector('[data-preview]').srcdoc,
      value: document.querySelector('[data-shot-landing]').value, invalid: document.querySelector('[data-shot-landing]').getAttribute('aria-invalid'),
      focused: document.activeElement === document.querySelector('[data-shot-landing]'), status: document.querySelector('[data-shot-status]').value }));
    if (!polishBaseline.guidance.includes('Editing Object 1 at 700 ms.')
      || !polishBaseline.guidance.includes('any corner to scale uniformly')
      || !polishBaseline.groupCopy.includes('Move together') || !polishBaseline.groupCopy.includes('Translation only')
      || polishRejected.value !== '2200' || polishRejected.invalid !== 'true' || !polishRejected.focused
      || polishRejected.status !== 'Landing must be a whole number from 1 to 2099 ms. Revision 0 unchanged.'
      || polishRejected.revision !== polishBaseline.revision || polishRejected.contentDigest !== polishBaseline.contentDigest
      || polishRejected.exportDigest !== polishBaseline.exportDigest || polishRejected.srcdoc !== polishBaseline.srcdoc
      || JSON.stringify(polishRejected.native) !== JSON.stringify(polishBaseline.native) || commands.length !== 0) {
      throw new Error('ASYMMETRIC_PATH_UX_POLISH_INVALID');
    }
    await landingDraft.fill('700');
    const readAlignment = () => page.evaluate(() => { const state = window.__motionEditor.readState(); const inspected = window.__motionEditor.inspectShotWorkspace();
      return { revision: window.__motionEditor.inspectAuthoring().revision, momentMs: inspected.momentMs, playheadMs: state.playheadMs,
        currentTimes: state.currentTimes, playStates: state.playStates, slider: Number(document.querySelector('[data-scrub]').value),
        visibleTime: document.querySelector('[data-playhead]').value, requestId: inspected.geometryPump.lastCommittedRequestId }; });
    const aligned = (state, timeMs, revision = 0) => state.revision === revision && state.momentMs === timeMs && state.playheadMs === timeMs
      && state.currentTimes.length > 0 && state.currentTimes.every((time) => time === timeMs)
      && state.playStates.every((playState) => playState === 'paused') && state.slider === timeMs && state.visibleTime === `${timeMs} ms`;
    await page.locator('input[name="shot-moment"][value="1400"]').check(); const primaryBaseline = await readAlignment();
    let priorRequestId = await currentGeometryRequestId(page); await primaries.nth(1).check();
    await observeGeometryCommit(page, { sampleCount: 3, previousRequestId: priorRequestId, moments: [0, 700, 2100] });
    if (!aligned(primaryBaseline, 1400) || !aligned(await readAlignment(), 700) || commands.length !== 0
      || (await currentGeometryRequestId(page)) !== priorRequestId + 1) throw new Error('ASYMMETRIC_PRIMARY_RECONCILIATION_INVALID');
    const editBoth = page.locator('[data-move-together]'); await editBoth.check();
    const assertGrouped = async (moments) => {
      await observeGeometryCommit(page, { sampleCount: moments.length, moments });
      const scope = await page.evaluate(() => ({ primary: document.querySelector('[data-shot-targets] input[name="shot-primary"]:checked')?.value,
        grouped: document.querySelector('[data-move-together]').checked, selected: window.__motionEditor.inspectShotWorkspace().selectedElementIds,
        status: document.querySelector('[data-shot-status]').value }));
      if (scope.primary !== targetElementIds[1] || !scope.grouped || JSON.stringify(scope.selected) !== JSON.stringify(targetElementIds)
        || /INVALID|MISSING|DIVERGED/.test(scope.status)) throw new Error('ASYMMETRIC_GROUPED_SCOPE_DIVERGED');
    };
    await assertGrouped([0, 700, 2100]);
    await ensureAdvancedOpen(page);
    const x = page.locator('[data-pose-form] input[name="x"]'); await x.fill(String(Number(await x.inputValue()) + 1));
    priorRequestId = await currentGeometryRequestId(page); await page.getByRole('button', { name: 'Apply pose' }).click();
    await observeActionCommit(page, { revision: 1, moments: [0, 700, 2100], landing: 700, settled: 2100, easing: 'ease-out' });
    await observeGeometryCommit(page, { sampleCount: 3, previousRequestId: priorRequestId, moments: [0, 700, 2100] }); await assertGrouped([0, 700, 2100]);
    priorRequestId = await currentGeometryRequestId(page); await page.locator('[data-shot-landing]').fill('840'); await page.locator('[data-shot-apply-time]').click();
    await observeActionCommit(page, { revision: 2, moments: [0, 840, 2100], landing: 840, settled: 2100, easing: 'ease-out' });
    await observeGeometryCommit(page, { sampleCount: 3, previousRequestId: priorRequestId, moments: [0, 840, 2100] }); await assertGrouped([0, 840, 2100]);
    priorRequestId = await currentGeometryRequestId(page); await page.locator('[data-shot-easing]').selectOption('ease-in-out'); await page.locator('[data-shot-apply-easing]').click();
    await observeActionCommit(page, { revision: 3, moments: [0, 840, 2100], landing: 840, settled: 2100, easing: 'ease-in-out' });
    await observeGeometryCommit(page, { sampleCount: 3, previousRequestId: priorRequestId, moments: [0, 840, 2100] }); await assertGrouped([0, 840, 2100]);
    const history = [
      ['undo', 4, [0, 840, 2100], 840, 'ease-out'], ['undo', 5, [0, 700, 2100], 700, 'ease-out'],
      ['undo', 6, [0, 700, 2100], 700, 'ease-out'], ['redo', 7, [0, 700, 2100], 700, 'ease-out'],
      ['redo', 8, [0, 840, 2100], 840, 'ease-out'], ['redo', 9, [0, 840, 2100], 840, 'ease-in-out'],
    ];
    for (const [direction, revision, moments, landing, easing] of history) {
      priorRequestId = await currentGeometryRequestId(page); await page.locator(`[data-${direction}]`).click();
      await observeActionCommit(page, { revision, moments, landing, settled: 2100, easing });
      await observeGeometryCommit(page, { sampleCount: moments.length, previousRequestId: priorRequestId, moments }); await assertGrouped(moments);
    }
    await editBoth.uncheck(); priorRequestId = await currentGeometryRequestId(page); await x.fill(String(Number(await x.inputValue()) + 1));
    await page.getByRole('button', { name: 'Apply pose' }).click();
    await observeActionCommit(page, { revision: 10, moments: [0, 840, 2100], landing: 840, settled: 2100, easing: 'ease-in-out' });
    await observeGeometryCommit(page, { sampleCount: 3, previousRequestId: priorRequestId, moments: [0, 840, 2100] });
    const operationProof = commands.length === 10 && commands[0]?.kind === 'motion.transform-waypoints.translate'
      && JSON.stringify(commands[0]?.payload.targets.map((target) => target.elementId)) === JSON.stringify(targetElementIds)
      && commands[1]?.kind === 'motion.keyframe-group-time.set' && commands[2]?.kind === 'motion.keyframe-group-easing.set'
      && commands.at(-1)?.kind === 'motion.transform-pose.set' && commands.at(-1)?.elementId === targetElementIds[1];
    if (!operationProof || diagnostics.consoleErrors.length || diagnostics.pageErrors.length || diagnostics.failedRequests.length
      || diagnostics.unexpectedNetwork.length || diagnostics.httpErrors.length) throw new Error('ASYMMETRIC_CHROME_PROOF_FAILED');
    return { passed: true, primaryIndex: 1, perObjectEditCheckboxesAbsent: true, groupedInventories: [[0, 700, 2100], [0, 840, 2100]],
      groupedOperationCount: 3, undoCount: 3, redoCount: 3, singlePrimaryOperation: true, nativeGeometryExact: true };
  } finally {
    await page?.close(); processHandle.kill('SIGTERM'); if (processHandle.exitCode === null) await new Promise((done) => processHandle.once('exit', done));
  }
}

async function runHitOwnershipQa({ repositoryRoot, directory, browser }) {
  const humanCapability = randomBytes(32).toString('base64url'); const agentCapability = randomBytes(32).toString('base64url');
  const processHandle = spawn('npm', ['exec', 'vite-node', '--', resolve(repositoryRoot, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: repositoryRoot, env: { ...process.env, PHASE3_DATABASE_PATH: resolve(directory, 'hit-ownership.sqlite'),
      PHASE3_EDITOR_PORT: '0', PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: agentCapability,
      LANDING_SHOT1_WORKSPACE: '1' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let page;
  try {
    const addresses = await observeServerAddress(processHandle, 'HIT_OWNERSHIP_CHROME_SERVER');
    page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], unexpectedNetwork: [], httpErrors: [] };
    monitorPage(page, [addresses.editorUrl, addresses.serviceUrl], diagnostics);
    const commands = []; page.on('request', (request) => {
      if (request.url().endsWith('/api/v1/commands')) commands.push(request.postDataJSON().command);
    });
    await page.goto(addresses.editorUrl); await page.locator('[data-editor-ready="true"]').waitFor();
    await observeGeometryCommit(page, { sampleCount: 3, moments: [0, 700, 2100] });
    const targets = page.locator('[data-shot-targets] input[name="shot-primary"]');
    const targetElementIds = await targets.evaluateAll((inputs) => inputs.map((input) => input.value));
    if (targetElementIds.length !== 2) throw new Error('HIT_OWNERSHIP_TARGET_COUNT');
    const moveTogether = page.locator('[data-move-together]'); if (await moveTogether.isChecked()) await moveTogether.uncheck();
    const pathToggle = page.locator('[data-shot-workspace] [data-shot-mode="path"]');
    if (await pathToggle.getAttribute('aria-pressed') === 'true') await pathToggle.click();
    const baselineDigest = await page.evaluate(() => window.__motionEditor.inspectAuthoring().contentDigest);
    const naturalCenter = (elementId) => page.evaluate((id) => {
      const frame = document.querySelector('[data-preview]'); const target = frame.contentDocument.querySelector(`[data-motion-id="${id}"]`);
      const frameRect = frame.getBoundingClientRect(); const targetRect = target.getBoundingClientRect();
      const x = frameRect.left + (targetRect.left + targetRect.width / 2) * frameRect.width / frame.clientWidth;
      const y = frameRect.top + (targetRect.top + targetRect.height / 2) * frameRect.height / frame.clientHeight;
      const hit = document.elementFromPoint(x, y);
      return { x, y, objectId: hit?.closest('[data-preview-object-id]')?.dataset.previewObjectId ?? null,
        waypointTimeMs: hit?.closest('[data-keyframe-id]')?.dataset.timeMs ?? null };
    }, elementId);
    const poseCenters = [];
    for (const viewport of [{ width: 1440, height: 900 }, { width: 768, height: 900 }]) {
      await page.setViewportSize(viewport); await page.locator('[data-trajectory-overlay][aria-busy="false"]').waitFor();
      await targets.nth(1).check(); await page.locator('[data-trajectory-overlay][aria-busy="false"]').waitFor();
      const center = await naturalCenter(targetElementIds[1]);
      if (center.objectId !== targetElementIds[1] || center.waypointTimeMs !== null) {
        throw new Error(`HIT_OWNERSHIP_POSE_CENTER_${viewport.width}_${JSON.stringify(center)}`);
      }
      const beforeRevision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
      await page.mouse.move(center.x, center.y); await page.mouse.down();
      await page.mouse.move(center.x + 12, center.y + 6, { steps: 3 }); await page.mouse.up();
      await page.waitForFunction((revision) => window.__motionEditor.inspectAuthoring().revision === revision, beforeRevision + 1);
      if (commands.at(-1)?.kind !== 'motion.transform-pose.set') throw new Error('HIT_OWNERSHIP_POSE_OPERATION');
      await page.locator('[data-undo]').click();
      await page.waitForFunction((revision) => window.__motionEditor.inspectAuthoring().revision === revision, beforeRevision + 2);
      if (await page.evaluate(() => window.__motionEditor.inspectAuthoring().contentDigest) !== baselineDigest) {
        throw new Error('HIT_OWNERSHIP_POSE_UNDO');
      }
      poseCenters.push({ viewport, objectId: center.objectId, operation: 'motion.transform-pose.set', exactUndo: true });
    }
    await pathToggle.click(); await page.locator('[data-trajectory-overlay][aria-busy="false"]').waitFor();
    await page.locator('input[name="shot-moment"][value="700"]').check();
    await page.locator('[data-trajectory-overlay][aria-busy="false"]').waitFor();
    const currentCenter = await naturalCenter(targetElementIds[1]);
    if (currentCenter.waypointTimeMs !== '700') throw new Error(`HIT_OWNERSHIP_CURRENT_PATH_${JSON.stringify(currentCenter)}`);
    const dragWaypoint = async (timeMs) => {
      const waypoint = page.locator(`[data-trajectory-overlay] [data-keyframe-id][data-time-ms="${timeMs}"]`);
      const box = await waypoint.boundingBox(); if (!box) throw new Error(`HIT_OWNERSHIP_WAYPOINT_MISSING_${timeMs}`);
      const hitTimeMs = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-keyframe-id]')?.dataset.timeMs ?? null,
        { x: box.x + box.width / 2, y: box.y + box.height / 2 });
      if (hitTimeMs !== String(timeMs)) throw new Error(`HIT_OWNERSHIP_WAYPOINT_HIT_${timeMs}_${hitTimeMs}`);
      const beforeRevision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 12, box.y + box.height / 2 + 6, { steps: 3 }); await page.mouse.up();
      await page.waitForFunction((revision) => window.__motionEditor.inspectAuthoring().revision === revision, beforeRevision + 1);
      if (commands.at(-1)?.kind !== 'motion.transform-waypoints.translate') throw new Error(`HIT_OWNERSHIP_PATH_OPERATION_${timeMs}`);
      await page.locator('[data-undo]').click();
      await page.waitForFunction((revision) => window.__motionEditor.inspectAuthoring().revision === revision, beforeRevision + 2);
      if (await page.evaluate(() => window.__motionEditor.inspectAuthoring().contentDigest) !== baselineDigest) {
        throw new Error(`HIT_OWNERSHIP_PATH_UNDO_${timeMs}`);
      }
    };
    await dragWaypoint(700);
    await page.locator('input[name="shot-moment"][value="700"]').check();
    await page.locator('[data-trajectory-overlay][aria-busy="false"]').waitFor();
    await dragWaypoint(0);
    if (diagnostics.consoleErrors.length || diagnostics.pageErrors.length || diagnostics.failedRequests.length
      || diagnostics.unexpectedNetwork.length || diagnostics.httpErrors.length) throw new Error('HIT_OWNERSHIP_DIAGNOSTICS');
    return { passed: true, poseCenters, currentPathWaypoint: true, nonCurrentPathWaypoint: true,
      operationKinds: ['motion.transform-pose.set', 'motion.transform-waypoints.translate'], exactUndo: true };
  } finally {
    await page?.close(); processHandle.kill('SIGTERM');
    if (processHandle.exitCode === null) await new Promise((done) => processHandle.once('exit', done));
  }
}

async function runLandingShot1Qa({ authority, workspaceSmokeOnly }) {
  const repositoryRoot = resolve(import.meta.dirname, '../../..');
  const publicFixturePath = resolve(repositoryRoot, 'fixtures/public-synthetic/landing-shot1.html');
  const privateManifestPath = resolve(repositoryRoot, '.private-corpus/landing-shot1-approved-reference-v3-r2-manifest.json');
  const privateDirectory = resolve(repositoryRoot, '.motion/private/landing-shot1-canonical-editing');
  const privateDocumentPath = resolve(privateDirectory, 'canonical-document.json');
  if (authority === 'public') {
    await access(publicFixturePath);
    resolveShot1ProofAuthority(authority, { publicFixture: true, privateManifest: false, privateCanonical: false });
  } else {
    await access(privateManifestPath); await access(privateDocumentPath);
    resolveShot1ProofAuthority(authority, { publicFixture: false, privateManifest: true, privateCanonical: true });
  }
  const seed = authority === 'private' ? JSON.parse(await readFile(privateDocumentPath, 'utf8')) : null;
  let targetElementIds = seed?.elements.map((element) => element.id).sort() ?? [];
  if (authority === 'private' && targetElementIds.length !== 2) throw new Error('LANDING_SHOT1_TARGET_COUNT');
  const canonicalEasing = await resolveShot1CanonicalEasing(repositoryRoot, authority, privateDocumentPath);
  if (!canonicalEasing.eligible || canonicalEasing.targetCount !== 2 || canonicalEasing.resolvedCount !== 2) {
    throw new Error('LANDING_SHOT1_CANONICAL_EASING_RESOLUTION_INVALID');
  }
  const directory = await mkdtemp(join(tmpdir(), 'lineage-motion-shot1-qa-'));
  const humanCapability = randomBytes(32).toString('base64url'); const agentCapability = randomBytes(32).toString('base64url');
  const port = 43500 + Math.floor(Math.random() * 300);
  const processHandle = spawn('npm', ['exec', 'vite-node', '--', resolve(repositoryRoot, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: repositoryRoot, env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'project.sqlite'), PHASE3_EDITOR_PORT: String(port),
      PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: agentCapability, LANDING_SHOT1_WORKSPACE: '1',
      ...(authority === 'private' ? { LANDING_SHOT1_DOCUMENT_PATH: privateDocumentPath } : {}) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let shotBrowser;
  try {
    const addresses = await observeServerAddress(processHandle, 'LANDING_SHOT1_SERVER');
    shotBrowser = await chromium.launch({ channel: 'chrome', headless: true }); const page = await shotBrowser.newPage({ viewport: { width: 1440, height: 900 } });
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
      const landing = Number(document.querySelector('[data-shot-landing]').value);
      const settled = Number(document.querySelector('[data-shot-settled]').value);
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
      await ensureAdvancedOpen(page);
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
      return;
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
    let pathAlignmentCommandCount = 0; page.on('request', (request) => { if (request.url().endsWith('/api/v1/commands')) pathAlignmentCommandCount += 1; });
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
    if (!exactlyAligned(momentAlignment, beforePathAlignment.momentMs) || pathAlignmentCommandCount !== 0) throw new Error('LANDING_SHOT1_PATH_ALIGNMENT_INVALID');
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
      if (!exactlyAligned(momentAlignment, 700) || !retained || pathAlignmentCommandCount !== 0) throw new Error('LANDING_SHOT1_WAYPOINT_IDENTITY_ALIGNMENT_INVALID');
    }
    const focusedSurface = await page.evaluate(() => { const visible = (selector) => { const node = document.querySelector(selector);
      if (!(node instanceof HTMLElement)) return false; const rect = node.getBoundingClientRect(); const style = getComputedStyle(node);
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.top >= 0 && rect.bottom <= innerHeight && rect.left >= 0 && rect.right <= innerWidth; };
      return { controls: visible('[data-shot-workspace]'), history: visible('[data-undo]'), frame: visible('[data-preview]'),
        transport: visible('.transport'), handle: visible('[data-trajectory-overlay] [aria-pressed="true"]'),
        genericWorkflowAbsent: getComputedStyle(document.querySelector('.workflow')).display === 'none',
        branchControlsAbsent: !document.querySelector('.branch-controls') || getComputedStyle(document.querySelector('.branch-controls')).display === 'none' }; });
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
    await ensureAdvancedOpen(page);
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
    transitionRequestId = await currentGeometryRequestId(page);
    const retimeCommandCount = pathAlignmentCommandCount;
    await page.locator('[data-shot-landing]').fill('840'); await page.locator('[data-shot-apply-time]').click();
    await observeActionCommit(page, { revision: 3, moments: groupedRetimedMoments, landing: 840,
      settled: baselineTiming.settled, easing: baselineTiming.easing });
    await observeGeometryCommit(page, { sampleCount: groupedRetimedMoments.length, previousRequestId: transitionRequestId, moments: groupedRetimedMoments });
    if (!exactlyAligned(await readMomentAlignment(), 840, 3) || pathAlignmentCommandCount !== retimeCommandCount + 1
      || (await currentGeometryRequestId(page)) !== transitionRequestId + 1) throw new Error('LANDING_SHOT1_RETIME_RECONCILIATION_INVALID');
    transitionRequestId = await currentGeometryRequestId(page);
    await page.locator('[data-shot-easing]').selectOption('ease-in-out'); await page.locator('[data-shot-apply-easing]').click();
    await observeActionCommit(page, { revision: 4, moments: groupedRetimedMoments, landing: 840,
      settled: baselineTiming.settled, easing: 'ease-in-out' });
    await observeGeometryCommit(page, { sampleCount: groupedRetimedMoments.length, previousRequestId: transitionRequestId, moments: groupedRetimedMoments });
    transitionRequestId = await currentGeometryRequestId(page);
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
        || pathAlignmentCommandCount !== priorCommandCount + 1 || (await currentGeometryRequestId(page)) !== priorRequestId + 1) {
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
        || pathAlignmentCommandCount !== priorCommandCount + 1 || (await currentGeometryRequestId(page)) !== priorRequestId + 1) {
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
