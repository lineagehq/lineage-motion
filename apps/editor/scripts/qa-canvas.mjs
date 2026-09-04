import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { monitorPage, observeGeometryCommit, observeServerAddress } from './qa-helpers.mjs';

export async function runCanvasFirstUxQa(repositoryRoot) {
  const receipt = {
    schemaVersion: 'motion.canvas-first-qa.v1', passed: false,
    viewport: { width: 1440, height: 900, dpr: 1 }, operationCount: 0, momentCount: 0,
    geometryMaxDeltaCssPx: 0, nativeCssAnimationCount: 0, keyboardFlowPassed: false,
    failurePreservedCompiler: false, consoleErrorCount: 0, networkErrorCount: 0,
  };
  const directory = await mkdtemp(join(tmpdir(), 'lineage-motion-canvas-first-'));
  const processHandle = spawn('npm', ['exec', 'vite-node', '--', resolve(repositoryRoot, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: repositoryRoot, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
      PHASE3_DATABASE_PATH: join(directory, 'project.sqlite'), PHASE3_EDITOR_PORT: '0', LANDING_SHOT1_WORKSPACE: '1',
      PHASE3_HUMAN_CAPABILITY: randomBytes(32).toString('base64url'),
      PHASE3_AGENT_CAPABILITY: randomBytes(32).toString('base64url') },
  });
  let browser;
  try {
    const addresses = await observeServerAddress(processHandle, 'CANVAS_FIRST_CHROME_QA');
    if (new URL(addresses.editorUrl).hostname !== 'lineage-motion.localhost') throw new Error('CANVAS_FIRST_NAMED_ORIGIN_REQUIRED');
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    let allowExpectedEventAbort = false;
    const diagnostics = { consoleErrors: [], pageErrors: [], failedRequests: [], unexpectedNetwork: [], httpErrors: [],
      expectedFailedRequests: [], allowFailedRequest: (request) => allowExpectedEventAbort && request.method() === 'GET'
        && request.url().includes('/events') };
    monitorPage(page, [addresses.editorUrl, addresses.serviceUrl], diagnostics);
    page.on('request', (request) => { if (request.url().endsWith('/api/v1/commands')) receipt.operationCount += 1; });
    await page.goto(addresses.editorUrl); await page.locator('[data-editor-ready="true"]').waitFor();
    const initial = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
    if (initial.revision !== 0) throw new Error('CANVAS_FIRST_REVISION_ZERO_REQUIRED');
    await observeGeometryCommit(page, { sampleCount: 3, moments: [0, 700, 2100] });
    await page.getByRole('radio', { name: 'Primary Object 1' }).check();
    await page.locator('input[name="shot-moment"][value="700"]').check();

    const waitForNextRevision = async (beforeRevision) => page.waitForFunction((revision) =>
      window.__motionEditor.inspectAuthoring().revision === revision + 1, beforeRevision);
    const dragControl = async (selector, delta) => {
      const beforeRevision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
      const box = await page.locator(selector).boundingBox(); if (!box) throw new Error('CANVAS_FIRST_CONTROL_BOUNDS_MISSING');
      const x = box.x + box.width / 2; const y = box.y + box.height / 2;
      await page.mouse.move(x, y); await page.mouse.down();
      await page.mouse.move(x + delta.x, y + delta.y, { steps: 4 }); await page.mouse.up();
      await waitForNextRevision(beforeRevision);
      await page.locator('[data-trajectory-overlay][aria-busy="false"]').waitFor();
    };
    const path = page.getByRole('button', { name: 'Path', exact: true });
    if (await path.getAttribute('aria-pressed') === 'true') await path.click();
    await dragControl('[data-preview-object-id][aria-pressed="true"]', { x: 12, y: 8 });
    await dragControl('[data-transform-corner="bottom-right"]:visible', { x: 12, y: 8 });
    await dragControl('[data-transform-handle="rotate"]:visible', { x: 15, y: 7 });
    if (await path.getAttribute('aria-pressed') !== 'true') await path.click();

    let beforeRevision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
    await page.locator('.moment-add').first().click(); await waitForNextRevision(beforeRevision);
    beforeRevision += 1; await page.locator('[data-shot-context-time]').fill('420'); await waitForNextRevision(beforeRevision);
    beforeRevision += 1; await page.locator('[data-shot-context-easing]').selectOption('ease-in-out');
    await page.locator('[data-shot-apply-easing]').click(); await waitForNextRevision(beforeRevision);

    await page.getByRole('radio', { name: 'Primary Object 2' }).check();
    await page.locator('input[name="shot-moment"][value="700"]').check();
    const together = page.locator('[data-move-together]'); await together.check(); await together.uncheck();
    await page.locator('[data-play]').click(); await page.waitForTimeout(80); await page.locator('[data-pause]').click();
    const visibleMoments = await page.locator('input[name="shot-moment"]').evaluateAll((inputs) => inputs.map((input) => Number(input.value)));
    let nativeScrubSynchronized = true;
    const nativeAligned = (requestedTimeMs, distinctFromTimeMs = null) => page.evaluate(({ requestedTimeMs, distinctFromTimeMs }) => {
      const frame = document.querySelector('[data-preview]'); const animations = frame.contentDocument.getAnimations();
      return animations.length > 0 && animations.every((animation) => animation.constructor.name === 'CSSAnimation'
        && animation.effect?.constructor.name === 'KeyframeEffect' && animation.timeline?.constructor.name === 'DocumentTimeline'
        && animation.playState === 'paused' && typeof animation.currentTime === 'number'
        && Math.abs(animation.currentTime - requestedTimeMs) <= .001
        && (distinctFromTimeMs === null || Math.abs(animation.currentTime - distinctFromTimeMs) > .001));
    }, { requestedTimeMs, distinctFromTimeMs });
    let priorNativeTimeMs = visibleMoments[0] === 0 ? 1 : 0;
    await page.locator('[data-scrub]').fill(String(priorNativeTimeMs));
    nativeScrubSynchronized &&= await nativeAligned(priorNativeTimeMs, visibleMoments[0]);
    for (const moment of visibleMoments) {
      nativeScrubSynchronized &&= await nativeAligned(priorNativeTimeMs, moment);
      await page.locator('[data-scrub]').fill(String(moment));
      nativeScrubSynchronized &&= await nativeAligned(moment);
      priorNativeTimeMs = moment;
    }

    const geometry = () => page.evaluate(() => ['.preview-stage', '[data-preview]', '[data-preview-canvas]', '[data-preview-object-overlay]',
      '[data-trajectory-overlay]'].map((selector) => { const rect = document.querySelector(selector).getBoundingClientRect();
      return [rect.left + scrollX, rect.top + scrollY, rect.width, rect.height]; }));
    const geometryDelta = (left, right) => Math.max(0, ...left.flatMap((values, index) =>
      values.map((value, offset) => Math.abs(value - right[index][offset]))));
    let responsiveDrawerPassed = true;
    for (const viewport of [{ width: 1440, height: 900 }, { width: 680, height: 900 }, { width: 430, height: 900 }]) {
      await page.setViewportSize(viewport); await page.evaluate(() => new Promise((resolveFrame) =>
        requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
      await page.locator('[data-trajectory-overlay][aria-busy="false"]').waitFor();
      const beforeAdvanced = await geometry();
      await page.locator('[data-shot-advanced-toggle]').click(); await page.locator('[data-shot-advanced-drawer]').waitFor();
      const openAdvanced = await geometry();
      responsiveDrawerPassed &&= await page.locator('[data-shot-advanced-drawer]').evaluate((drawer, narrow) => {
        const rect = drawer.getBoundingClientRect();
        const container = drawer.closest('.preview-panel').getBoundingClientRect();
        return !narrow || (Math.abs(rect.left - container.left - 8) <= 1
          && Math.abs(container.right - rect.right - 8) <= 1 && Math.abs(container.bottom - rect.bottom - 8) <= 1);
      }, viewport.width <= 700);
      await page.locator('[data-shot-advanced-close]').click();
      const closedAdvanced = await geometry();
      receipt.geometryMaxDeltaCssPx = Math.max(receipt.geometryMaxDeltaCssPx,
        geometryDelta(beforeAdvanced, openAdvanced), geometryDelta(openAdvanced, closedAdvanced));
    }
    await page.setViewportSize({ width: 1440, height: 900 });

    await page.getByRole('radio', { name: 'Primary Object 1' }).check();
    await page.locator('input[name="shot-moment"][value="420"]').check();
    beforeRevision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
    await page.locator('[data-shot-context-remove]').click(); await waitForNextRevision(beforeRevision);
    beforeRevision += 1; await page.locator('[data-undo]').click(); await waitForNextRevision(beforeRevision);
    let responsiveHitOwnershipPassed = true;
    for (const viewport of [{ width: 680, height: 900 }, { width: 430, height: 900 }]) {
      await page.setViewportSize(viewport);
      await page.evaluate(() => new Promise((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(resolveFrame))));
      const moments = await page.locator('input[name="shot-moment"]').evaluateAll((inputs) => inputs.map((input) => Number(input.value)));
      responsiveHitOwnershipPassed &&= await page.locator('[data-undo]').isEnabled() && await page.locator('[data-redo]').isEnabled();
      for (const moment of moments) {
        const radio = page.locator(`input[name="shot-moment"][value="${moment}"]`);
        await radio.evaluate((input) => input.parentElement.scrollIntoView({ block: 'nearest', inline: 'center' }));
        await page.waitForFunction((timeMs) => { const input = document.querySelector(`input[name="shot-moment"][value="${timeMs}"]`);
          if (!input?.parentElement) return false; const rect = input.parentElement.getBoundingClientRect(); return rect.width > 0 && rect.height > 0; }, moment);
        const bounds = await radio.evaluate((input) => { const rect = input.parentElement.getBoundingClientRect();
          return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; });
        const revision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
        await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.locator('[data-trajectory-overlay][aria-busy="false"]').waitFor();
        await page.locator('.preview-stage').scrollIntoViewIfNeeded();
        responsiveHitOwnershipPassed &&= await radio.isChecked()
          && revision === await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)
          && await page.evaluate(() => {
            const rect = (selector) => document.querySelector(selector).getBoundingClientRect();
            const objectBar = rect('[data-shot-object-bar]'); const stage = rect('.preview-stage');
            const dock = rect('[data-shot-context-dock]'); const rail = rect('[data-preview-control-rail]');
            const history = rect('[data-shot-history-slot]');
            const handles = [...document.querySelectorAll('.preview-transform-handle:not([hidden])')];
            const ownsCenter = (node) => { const bounds = node.getBoundingClientRect();
              const owner = document.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2);
              return owner === node || node.contains(owner) || owner?.closest('[data-preview-control-key]') === node; };
            return objectBar.bottom <= stage.top + .5 && stage.bottom <= dock.top + .5 && dock.bottom <= rail.top + .5
              && rail.bottom <= history.top + .5 && handles.length === 5 && handles.every(ownsCenter);
          });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    beforeRevision += 1; await page.locator('[data-redo]').click(); await waitForNextRevision(beforeRevision);

    await page.locator('input[name="shot-moment"][value="700"]').check();
    const objectOne = page.getByRole('radio', { name: 'Primary Object 1' }); await objectOne.focus();
    const visitedSurfaces = ['object'];
    for (let index = 0; index < 80 && visitedSurfaces.at(-1) !== 'history'; index += 1) {
      await page.keyboard.press('Tab');
      const surface = await page.evaluate(() => { const active = document.activeElement;
        if (active?.closest('[data-shot-object-bar]')) return 'object';
        if (active?.closest('.preview-stage')) return 'canvas';
        if (active?.closest('[data-preview-control-rail]')) return 'rail';
        if (active?.closest('[data-shot-advanced]')) return 'advanced';
        if (active?.closest('[data-shot-context-dock]')) return 'dock';
        if (active?.closest('[data-shot-history-slot]')) return 'history';
        return null; });
      if (surface && surface !== visitedSurfaces.at(-1)) visitedSurfaces.push(surface);
    }
    const domOrderPassed = await page.evaluate(() => { const selectors = ['[data-shot-object-bar]', '.preview-stage',
      '[data-preview-control-rail]', '[data-shot-context-dock]', '[data-shot-advanced]', '[data-shot-history-slot]'];
      const nodes = selectors.map((selector) => document.querySelector(selector));
      return nodes.slice(0, -1).every((node, index) => node.compareDocumentPosition(nodes[index + 1]) & Node.DOCUMENT_POSITION_FOLLOWING); });

    const objectTwo = page.getByRole('radio', { name: 'Primary Object 2' }); await objectTwo.focus(); await objectTwo.press('Space');
    const keyboardBody = page.getByRole('button', { name: 'Object 2; drag to move' }); await keyboardBody.focus();
    beforeRevision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
    await keyboardBody.press('ArrowRight'); await waitForNextRevision(beforeRevision);
    const keyboardScale = page.getByRole('slider', { name: 'bottom right uniform scale handle for Object 2' }); await keyboardScale.focus();
    beforeRevision += 1; await keyboardScale.press('ArrowUp'); await waitForNextRevision(beforeRevision);
    const keyboardRotate = page.getByRole('slider', { name: 'Rotation handle for Object 2' }); await keyboardRotate.focus();
    beforeRevision += 1; await keyboardRotate.press('ArrowRight'); await waitForNextRevision(beforeRevision);
    const keyboardPoint = page.locator('input[name="shot-moment"][value="700"]'); await keyboardPoint.focus(); await keyboardPoint.press('Space');
    const keyboardAdd = page.locator('.moment-add').first(); await keyboardAdd.focus();
    beforeRevision += 1; await keyboardAdd.press('Enter'); await waitForNextRevision(beforeRevision);
    const insertionFocused = await page.locator('input[name="shot-moment"]:checked').evaluate((input) => input === document.activeElement);
    const keyboardTime = page.locator('[data-shot-context-time]'); const insertedTime = await keyboardTime.inputValue();
    await keyboardTime.focus(); beforeRevision += 1; await keyboardTime.press('PageUp'); await waitForNextRevision(beforeRevision);
    const retimedByKeyboard = await keyboardTime.inputValue() !== insertedTime;
    const keyboardEasing = page.locator('[data-shot-context-easing]'); await keyboardEasing.focus(); await keyboardEasing.press('g');
    const keyboardMovement = page.locator('[data-shot-apply-easing]'); await keyboardMovement.focus();
    beforeRevision += 1; await keyboardMovement.press('Enter'); await waitForNextRevision(beforeRevision);
    const keyboardPlay = page.locator('[data-play]'); await keyboardPlay.focus(); await keyboardPlay.press('Enter');
    const keyboardPause = page.locator('[data-pause]'); await keyboardPause.focus(); await keyboardPause.press('Enter');
    const keyboardScrub = page.locator('[data-scrub]'); await keyboardScrub.focus(); await keyboardScrub.press('Home');
    const keyboardRemove = page.locator('[data-shot-context-remove]'); await keyboardRemove.focus();
    beforeRevision += 1; await keyboardRemove.press('Enter'); await waitForNextRevision(beforeRevision);
    const removalFocused = await page.locator('input[name="shot-moment"]:checked').evaluate((input) => input === document.activeElement);
    const keyboardUndo = page.locator('[data-undo]'); await keyboardUndo.focus(); beforeRevision += 1; await keyboardUndo.press('Enter'); await waitForNextRevision(beforeRevision);
    const keyboardRedo = page.locator('[data-redo]'); await keyboardRedo.focus(); beforeRevision += 1; await keyboardRedo.press('Enter'); await waitForNextRevision(beforeRevision);
    const keyboardAdvanced = page.locator('[data-shot-advanced-toggle]'); await keyboardAdvanced.focus(); await keyboardAdvanced.press('Enter');
    await page.locator('[data-shot-advanced-drawer]').waitFor(); await page.keyboard.press('Escape');
    const advancedReturnedFocus = await keyboardAdvanced.evaluate((button) => button === document.activeElement);
    const keyboardNative = await page.evaluate(() => window.__motionEditor.readState());
    receipt.keyboardFlowPassed = JSON.stringify(visitedSurfaces) === JSON.stringify(['object', 'canvas', 'rail', 'dock', 'advanced', 'history'])
      && Boolean(domOrderPassed) && insertionFocused && removalFocused && retimedByKeyboard
      && keyboardNative.playheadMs === 0 && keyboardNative.playStates.every((state) => state === 'paused') && advancedReturnedFocus;

    await objectTwo.focus(); await objectTwo.press('Space');
    await page.locator('input[name="shot-moment"][value="700"]').check();
    allowExpectedEventAbort = true;
    await page.evaluate(() => window.__motionEditor.disconnectEvents());
    const readPublicationTuple = () => page.evaluate(() => { const frame = document.querySelector('[data-preview]');
      const feedback = document.querySelector('[data-shot-control-feedback]'); return {
        authoring: window.__motionEditor.inspectAuthoring(), workspace: window.__motionEditor.inspectShotWorkspace(),
        native: window.__motionEditor.readState(), selected: Number(document.querySelector('input[name="shot-moment"]:checked')?.value),
        dock: Number(document.querySelector('[data-shot-context-time]')?.value), scrubber: Number(document.querySelector('[data-scrub]').value),
        playhead: document.querySelector('[data-playhead]').value, srcdoc: frame.srcdoc,
        renderedCss: [...frame.contentDocument.querySelectorAll('style')].map((style) => style.textContent).join(''),
        feedback: feedback ? { value: feedback.value, hidden: feedback.hidden, visible: feedback.getClientRects().length > 0 } : null,
        diagnosticVisible: Boolean(document.querySelector('[data-service-diagnostic]')?.getClientRects().length),
        drawerHidden: document.querySelector('[data-shot-advanced-drawer]').hidden,
      }; });
    const failureBaseline = await readPublicationTuple(); const commandCountBeforeFailure = receipt.operationCount;
    await page.evaluate(() => window.__motionEditor.failNextPublication());
    await page.locator('[data-shot-context-time]').fill('840');
    await page.waitForFunction(() => window.__motionEditor.inspectAuthoring().publicationState === 'failed');
    const failureAfter = await readPublicationTuple();
    const retryAccepted = await page.evaluate(() => window.__motionEditor.retryPublication());
    await page.waitForFunction((revision) => window.__motionEditor.inspectAuthoring().publicationState === 'settled'
      && window.__motionEditor.inspectAuthoring().revision === revision + 1, failureBaseline.authoring.revision);
    const retryAfter = await readPublicationTuple();
    const coherentAt = (state, timeMs) => state.workspace.momentMs === timeMs && state.selected === timeMs && state.dock === timeMs
      && state.scrubber === timeMs && state.playhead === `${timeMs} ms` && state.native.playheadMs === timeMs
      && state.native.currentTimes.length > 0 && state.native.currentTimes.every((time) => time === timeMs)
      && state.native.playStates.every((playState) => playState === 'paused');
    receipt.failurePreservedCompiler = receipt.operationCount === commandCountBeforeFailure + 1 && coherentAt(failureBaseline, 700)
      && coherentAt(failureAfter, 700) && coherentAt(retryAfter, 840)
      && failureAfter.authoring.revision === failureBaseline.authoring.revision
      && failureAfter.authoring.contentDigest === failureBaseline.authoring.contentDigest
      && failureAfter.authoring.exportDigest === failureBaseline.authoring.exportDigest
      && failureAfter.authoring.compiledHtml === failureBaseline.authoring.compiledHtml
      && failureAfter.srcdoc === failureBaseline.srcdoc && failureAfter.renderedCss === failureBaseline.renderedCss
      && failureAfter.feedback?.visible && !failureAfter.feedback.hidden && failureAfter.feedback.value.includes('Timing could not be published')
      && !failureAfter.feedback.value.includes('Pose') && !failureAfter.diagnosticVisible && failureAfter.drawerHidden
      && retryAccepted && retryAfter.authoring.revision === failureBaseline.authoring.revision + 1
      && retryAfter.authoring.compiledHtml === retryAfter.srcdoc && retryAfter.feedback?.hidden && retryAfter.drawerHidden;

    const finalEvidence = await page.evaluate(() => { const frame = document.querySelector('[data-preview]');
      return { dpr: devicePixelRatio, moments: document.querySelectorAll('input[name="shot-moment"]').length,
        nativeAnimations: frame.contentDocument.getAnimations().filter((animation) => animation.constructor.name === 'CSSAnimation').length,
        previewMatchesCompiler: frame.srcdoc === window.__motionEditor.compiledHtml }; });
    receipt.viewport.dpr = finalEvidence.dpr; receipt.momentCount = finalEvidence.moments;
    receipt.nativeCssAnimationCount = finalEvidence.nativeAnimations;
    receipt.consoleErrorCount = diagnostics.consoleErrors.length + diagnostics.pageErrors.length;
    receipt.networkErrorCount = diagnostics.failedRequests.length + diagnostics.unexpectedNetwork.length + diagnostics.httpErrors.length;
    receipt.passed = receipt.operationCount > 0 && receipt.momentCount >= 3 && receipt.geometryMaxDeltaCssPx <= 1
      && responsiveDrawerPassed && responsiveHitOwnershipPassed
      && receipt.nativeCssAnimationCount > 0 && nativeScrubSynchronized && receipt.keyboardFlowPassed && receipt.failurePreservedCompiler
      && finalEvidence.previewMatchesCompiler && receipt.consoleErrorCount === 0 && receipt.networkErrorCount === 0;
  } catch {
    receipt.passed = false;
  } finally {
    await browser?.close(); processHandle.kill('SIGTERM');
    if (processHandle.exitCode === null) await new Promise((resolveExit) => processHandle.once('exit', resolveExit));
    await rm(directory, { recursive: true, force: true });
  }
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
  return receipt.passed ? 0 : 1;
}
