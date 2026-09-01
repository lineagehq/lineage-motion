import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

const url = 'http://127.0.0.1:41744'; let server: ChildProcess;

test.beforeAll(async () => {
  const root = resolve(import.meta.dirname, '../../..');
  server = spawn('npm', ['exec', 'vite', '--', '--config', resolve(root, 'apps/editor/vite.config.ts'),
    '--host', '127.0.0.1', '--port', '41744'], {
    cwd: root, stdio: 'ignore', env: { ...process.env, PHASE4_CURSOR_CLICK_REVEAL: '1' },
  });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try { if ((await fetch(url)).ok) return; } catch { /* wait */ }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  }
  throw new Error('PHASE4_EDITOR_TIMEOUT');
});

test.afterAll(() => server?.kill('SIGTERM'));

test('authors cursor path, reveal, and click through the native editor lifecycle', async ({ page }) => {
  const errors: string[] = []; const failed: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('requestfailed', (request) => failed.push(request.url()));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(url); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await expect(page.locator('[data-cue-workspace]')).toBeVisible();
  await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'pick-cursor');
  await expect(page.locator('[data-cue-form]:visible')).toHaveCount(0);
  const targets = await page.evaluate(() => {
    const rows = window.__motionEditor.canonicalProjection.rows;
    const pulse = rows.find((row) => row.property === 'box-shadow')?.elementId;
    const properties = new Map<string, Set<string>>();
    for (const row of rows) properties.set(row.elementId, new Set([...(properties.get(row.elementId) ?? []), row.property]));
    const cursor = [...properties].find(([, names]) => names.has('left') && names.has('top'))?.[0]
      ?? rows.find((row) => row.property === 'transform' && row.elementId !== pulse)?.elementId;
    const reveal = rows.find((row) => row.property === 'visibility')?.elementId
      ?? rows.find((row) => row.property === 'opacity' && properties.get(row.elementId)?.size === 1
        && Number(row.keyframes[0]?.value) === 0 && row.elementId !== cursor)?.elementId;
    return { cursor, pulse, reveal };
  });
  expect(targets.cursor && targets.pulse && targets.reveal).toBeTruthy();
  let disambiguationCount = 0;
  const pick = async (role: 'cursor' | 'pulse' | 'reveal', elementId: string) => {
    const candidate = page.locator(`[data-cue-target-candidate][data-element-id="${elementId}"]`);
    await expect(candidate).toBeVisible(); const box = await candidate.boundingBox(); expect(box).toBeTruthy();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const choice = page.locator(`[data-cue-target-choice][data-element-id="${elementId}"]`);
    if (await choice.isVisible()) {
      disambiguationCount += 1;
      await expect(page.locator(`[data-cue-role-card="${role}"]`)).toHaveAttribute('data-selected', 'false');
      await expect(page.locator('[data-cue-status]')).toContainText('Several objects overlap');
      await choice.click();
    }
    await expect(page.locator(`[data-cue-role-card="${role}"]`)).toHaveAttribute('data-selected', 'true');
  };
  await pick('cursor', targets.cursor!); await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'pick-pulse');
  await pick('pulse', targets.pulse!); await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'pick-reveal');
  await pick('reveal', targets.reveal!); await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'cursor-path');
  expect(disambiguationCount).toBeGreaterThan(0);
  const selectedIds = await page.locator('[data-cue-cursor], [data-cue-pulse], [data-cue-reveal]').evaluateAll((selects) =>
    selects.map((select) => (select as HTMLSelectElement).value));
  expect(selectedIds).toEqual([targets.cursor, targets.pulse, targets.reveal]);
  const keyboardSelect = page.locator('[data-cue-reveal]');
  const keyboardTargetIndex = await keyboardSelect.locator('option').evaluateAll((options, targetId) =>
    options.findIndex((option) => (option as HTMLOptionElement).value === targetId), targets.reveal!);
  expect(keyboardTargetIndex).toBeGreaterThan(0);
  const targetListSummary = page.locator('.cue-target-advanced > summary');
  await targetListSummary.focus();
  await expect(targetListSummary).toBeFocused();
  await page.keyboard.press('Enter');
  await keyboardSelect.focus();
  await expect(keyboardSelect).toBeFocused();
  await page.keyboard.press('Home');
  for (let index = 0; index < keyboardTargetIndex; index += 1) await page.keyboard.press('ArrowDown');
  await expect(keyboardSelect).toHaveValue(targets.reveal!);
  await expect(page.locator('[data-cue-role-card="reveal"]')).toHaveAttribute('data-selected', 'true');
  await expect(page.locator('.cue-coordinate-advanced input:visible')).toHaveCount(0);
  await page.locator('[data-cue-form="cursor-path"] button[type="submit"]').click();
  await expect(page.locator('[data-cue-status]')).toContainText('created');
  await expect(page.locator('[data-authored-cue="cursor-path"]')).toHaveCount(1);
  await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'reveal');
  await expect(page.locator('[data-cue-path-overlay] [data-waypoint-index]')).toHaveCount(2);
  const cursorVisibility = await page.evaluate(async (elementId) => {
    const cue = window.__motionEditor.inspectCueWorkspace().authoredCues.find((candidate) => candidate.kind === 'cursor-path');
    const semantic = cue?.semantic as { kind?: string; startMs?: number; arriveMs?: number } | undefined;
    if (semantic?.kind !== 'cursor-path' || typeof semantic.startMs !== 'number' || typeof semantic.arriveMs !== 'number') {
      throw new Error('cursor path missing');
    }
    const times = [semantic.startMs, Math.round((semantic.startMs + semantic.arriveMs) / 2), semantic.arriveMs];
    const scrubber = document.querySelector<HTMLInputElement>('[data-scrub]')!;
    const target = document.querySelector<HTMLIFrameElement>('[data-preview]')!.contentDocument!
      .querySelector<HTMLElement>(`[data-motion-id="${elementId}"]`)!;
    const samples = [];
    for (const timeMs of times) {
      scrubber.value = String(timeMs); scrubber.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      samples.push({ timeMs, opacity: Number.parseFloat(getComputedStyle(target).opacity) });
    }
    return samples;
  }, targets.cursor!);
  expect(cursorVisibility.map((sample) => sample.timeMs)).toEqual([0, 350, 700]);
  for (const sample of cursorVisibility) expect(sample.opacity, JSON.stringify(cursorVisibility)).toBeGreaterThanOrEqual(.999);
  const assertCoordinateParity = async () => {
    const times = await page.locator('[data-cue-path-overlay] [data-waypoint-index]').evaluateAll((handles) =>
      handles.map((handle) => Number((handle as HTMLElement).dataset.timeMs)));
    const samples = [];
    for (const [index, timeMs] of times.entries()) {
      await page.locator('[data-scrub]').fill(String(timeMs));
      await page.locator('[data-scrub]').dispatchEvent('input');
      await page.waitForTimeout(30);
      samples.push(await page.evaluate(({ elementId, index }) => {
        const rect = (node: Element) => { const value = node.getBoundingClientRect();
          return { left: value.left, top: value.top, right: value.right, bottom: value.bottom, width: value.width, height: value.height }; };
        const iframe = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
        const overlay = document.querySelector<HTMLElement>('[data-cue-target-overlay]')!;
        const handle = document.querySelector<HTMLElement>(`[data-waypoint-index="${index}"]`)!;
        const target = iframe.contentDocument!.querySelector<HTMLElement>(`[data-motion-id="${elementId}"]`)!;
        const candidates = [target, ...target.querySelectorAll<HTMLElement>('*')];
        const bounds = candidates.map(rect).filter((value) => value.width > 0 && value.height > 0);
        const source = { left: Math.min(...bounds.map((value) => value.left)), top: Math.min(...bounds.map((value) => value.top)),
          right: Math.max(...bounds.map((value) => value.right)), bottom: Math.max(...bounds.map((value) => value.bottom)) };
        const iframeRect = rect(iframe); const overlayRect = rect(overlay); const handleRect = rect(handle);
        const scaleX = iframeRect.width / iframe.contentWindow!.innerWidth;
        const scaleY = iframeRect.height / iframe.contentWindow!.innerHeight;
        const targetCenter = { x: iframeRect.left + (source.left + source.right) / 2 * scaleX,
          y: iframeRect.top + (source.top + source.bottom) / 2 * scaleY };
        const handleCenter = { x: (handleRect.left + handleRect.right) / 2, y: (handleRect.top + handleRect.bottom) / 2 };
        return { edgeDeltas: [iframeRect.left - overlayRect.left, iframeRect.top - overlayRect.top,
          iframeRect.right - overlayRect.right, iframeRect.bottom - overlayRect.bottom],
        contained: handleCenter.x >= overlayRect.left && handleCenter.x <= overlayRect.right
          && handleCenter.y >= overlayRect.top && handleCenter.y <= overlayRect.bottom,
        centerDelta: Math.hypot(handleCenter.x - targetCenter.x, handleCenter.y - targetCenter.y), handleCenter, targetCenter, overlayRect };
      }, { elementId: targets.cursor!, index }));
    }
    for (const sample of samples) {
      expect(Math.max(...sample.edgeDeltas.map(Math.abs))).toBeLessThanOrEqual(1);
      expect(sample.contained, JSON.stringify(sample)).toBe(true);
      expect(sample.centerDelta, JSON.stringify(sample)).toBeLessThanOrEqual(1);
    }
  };
  await assertCoordinateParity();
  const dragEndpointWithTrackingProof = async (waypointIndex: 0 | 1, delta: { x: number; y: number }) => {
    const selector = `[data-cue-path-overlay] [data-waypoint-index="${waypointIndex}"]`;
    await page.waitForFunction(async (candidateSelector: string) => {
      const candidate = document.querySelector(candidateSelector);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return Boolean(candidate?.isConnected && candidate === document.querySelector(candidateSelector));
    }, selector);
    const handle = page.locator(selector);
    await handle.scrollIntoViewIfNeeded(); const before = await handle.boundingBox(); expect(before).toBeTruthy();
    const grab = { x: before!.x + before!.width * .27, y: before!.y + before!.height * .68 };
    const grabOffset = { x: grab.x - before!.x, y: grab.y - before!.y };
    const dpr = await page.evaluate(() => window.devicePixelRatio);
    const assertPointerTracking = async (pointer: { x: number; y: number }, phase: string) => {
      const actual = await handle.boundingBox(); expect(actual).toBeTruthy();
      const error = Math.hypot(actual!.x - (pointer.x - grabOffset.x), actual!.y - (pointer.y - grabOffset.y)) * dpr;
      const geometry = await page.evaluate(() => {
        const rect = (selector: string) => { const value = document.querySelector(selector)!.getBoundingClientRect();
          return { x: value.x, y: value.y, width: value.width, height: value.height }; };
        return { canvas: rect('[data-preview-canvas]'), iframe: rect('[data-preview]'), overlay: rect('[data-cue-path-overlay]'),
          scrollX, scrollY, promotion: window.__motionEditor.inspectShotWorkspace().lastPreviewCommitPromotion };
      });
      expect(error, JSON.stringify({ phase, waypointIndex, before, pointer, actual, grabOffset, dpr, geometry })).toBeLessThanOrEqual(1);
      return error;
    };
    const revision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
    await page.mouse.move(grab.x, grab.y); await page.mouse.down();
    const midpoint = { x: grab.x + delta.x / 2, y: grab.y + delta.y / 2 };
    await page.mouse.move(midpoint.x, midpoint.y); await assertPointerTracking(midpoint, 'midpoint');
    const destination = { x: grab.x + delta.x, y: grab.y + delta.y };
    await page.mouse.move(destination.x, destination.y); await assertPointerTracking(destination, 'destination');
    await page.mouse.up(); const immediateError = await assertPointerTracking(destination, 'immediate');
    await page.waitForFunction((expected) => window.__motionEditor.inspectAuthoring().revision === expected, revision + 1);
    await expect(page.locator('[data-cue-status]')).toContainText('Cursor path updated');
    const settledError = await assertPointerTracking(destination, 'settled');
    expect(immediateError).toBeLessThanOrEqual(1); expect(settledError).toBeLessThanOrEqual(1);
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('[data-cue-status]')).toContainText('Undid the last change');
  };
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1000, height: 800 }]) {
    await page.setViewportSize(viewport); await page.waitForTimeout(50); await assertCoordinateParity();
    await dragEndpointWithTrackingProof(0, { x: 13, y: 9 });
    await dragEndpointWithTrackingProof(1, { x: -11, y: 8 });
  }
  await page.setViewportSize({ width: 1000, height: 800 }); await page.waitForTimeout(50); await assertCoordinateParity();
  const pathHandles = await page.locator('[data-cue-path-overlay] [data-waypoint-index]').evaluateAll((handles) => handles.map((handle) => {
    const bounds = handle.getBoundingClientRect(); return { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  }));
  expect(Math.hypot(pathHandles[1]!.x - pathHandles[0]!.x, pathHandles[1]!.y - pathHandles[0]!.y)).toBeGreaterThan(10);
  const pathBefore = await page.evaluate(() => ({ cue: window.__motionEditor.inspectCueWorkspace().authoredCues
    .find((cue) => cue.kind === 'cursor-path'), trackIds: window.__motionEditor.trackIds,
    content: window.__motionEditor.inspectAuthoring().contentDigest, export: window.__motionEditor.inspectAuthoring().exportDigest }));
  const arrive = page.locator('[data-cue-path-overlay] [data-waypoint-index="1"]'); await arrive.scrollIntoViewIfNeeded();
  const beforeDrag = await arrive.boundingBox();
  expect(beforeDrag).toBeTruthy(); await page.mouse.move(beforeDrag!.x + beforeDrag!.width / 2, beforeDrag!.y + beforeDrag!.height / 2);
  await page.mouse.down(); await page.mouse.move(beforeDrag!.x + beforeDrag!.width / 2 + 18, beforeDrag!.y + beforeDrag!.height / 2 + 10, { steps: 4 });
  await page.mouse.up(); await expect(page.locator('[data-cue-status]')).toContainText('Cursor path updated');
  const pathAfter = await page.evaluate(() => ({ cue: window.__motionEditor.inspectCueWorkspace().authoredCues
    .find((cue) => cue.kind === 'cursor-path'), trackIds: window.__motionEditor.trackIds,
    content: window.__motionEditor.inspectAuthoring().contentDigest, export: window.__motionEditor.inspectAuthoring().exportDigest }));
  expect(pathAfter.trackIds).toEqual(pathBefore.trackIds); expect(pathAfter.cue).not.toEqual(pathBefore.cue);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('[data-cue-status]')).toContainText('Undid the last change'); await assertCoordinateParity();
  const pathUndone = await page.evaluate(() => ({ cue: window.__motionEditor.inspectCueWorkspace().authoredCues
    .find((cue) => cue.kind === 'cursor-path'), content: window.__motionEditor.inspectAuthoring().contentDigest,
    export: window.__motionEditor.inspectAuthoring().exportDigest }));
  expect(pathUndone).toEqual({ cue: pathBefore.cue, content: pathBefore.content, export: pathBefore.export });
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('[data-cue-status]')).toContainText('Redid the last change'); await assertCoordinateParity();
  const pathRedone = await page.evaluate(() => ({ cue: window.__motionEditor.inspectCueWorkspace().authoredCues
    .find((cue) => cue.kind === 'cursor-path'), content: window.__motionEditor.inspectAuthoring().contentDigest,
    export: window.__motionEditor.inspectAuthoring().exportDigest }));
  expect(pathRedone).toEqual({ cue: pathAfter.cue, content: pathAfter.content, export: pathAfter.export });
  await page.locator('[data-cue-form="reveal"] button[type="submit"]').click();
  await expect(page.locator('[data-authored-cue="reveal"]')).toHaveCount(1);
  await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'click');
  await page.locator('[data-cue-form="click"] button[type="submit"]').click();
  await expect(page.locator('[data-authored-cue="click"]')).toHaveCount(1);
  await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'complete');
  await expect(page.locator('[data-cue-complete]')).toBeVisible();
  const scrubber = page.locator('[data-scrub]'); const endMs = Number(await scrubber.getAttribute('max'));
  await scrubber.fill(String(endMs)); await scrubber.dispatchEvent('input');
  await page.locator('[data-play]').click(); await page.waitForTimeout(150);
  const restartedTimeMs = Number(await scrubber.inputValue());
  expect(restartedTimeMs).toBeGreaterThan(0); expect(restartedTimeMs).toBeLessThan(endMs);
  expect(await page.locator('[data-cue-owned="true"]').count()).toBeGreaterThanOrEqual(5);
  const proof = await page.evaluate(() => { const iframe = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    return { exact: iframe.srcdoc === window.__motionEditor.compiledHtml,
      native: iframe.contentDocument!.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation'),
      revision: window.__motionEditor.inspectAuthoring().revision } });
  expect(proof).toMatchObject({ exact: true, native: true, revision: 14 });

  const advanced = page.locator('.cue-advanced');
  await advanced.locator('> summary').click();
  await expect(advanced).toHaveJSProperty('open', true);
  await page.locator('[data-authored-cue="click"] [data-cue-edit]').click();
  await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'edit-click');
  await page.locator('[data-cue-form="click"] .cue-timing > summary').click();
  await page.locator('[data-cue-form="click"] input[name="press"]').fill('1000');
  await page.locator('[data-cue-form="click"] input[name="release"]').fill('980');
  const beforeInvalidRevision = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
  const canonicalClickValues = await page.locator('[data-cue-form="click"]').evaluate((form) => {
    const data = new FormData(form as HTMLFormElement);
    return { arrive: data.get('arrive'), press: '800', release: '920', pulseEnd: data.get('pulseEnd'),
      scale: data.get('scale'), radius: data.get('radius') };
  });
  await page.locator('[data-cue-form="click"] button[type="submit"]').click();
  await expect(page.locator('[data-cue-status]')).toContainText('Arrive < Press < Release < Pulse end');
  await expect(page.locator('[data-cue-status]')).toHaveAttribute('data-diagnostic-code', 'CUE_UPDATE_INVALID');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(beforeInvalidRevision);
  const detach = page.locator('[data-authored-cue="click"] [data-cue-detach]');
  await expect(detach).toBeVisible();
  const beforeDetach = await page.evaluate(() => ({ state: window.__motionEditor.inspectAuthoring(),
    html: window.__motionEditor.compiledHtml, trackIds: window.__motionEditor.trackIds,
    rows: window.__motionEditor.canonicalProjection.rows, cues: window.__motionEditor.inspectCueWorkspace().authoredCues }));
  await detach.click();
  await expect(page.locator('[data-authored-cue="click"]')).toHaveCount(0);
  await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'detached-click');
  await expect(page.locator('[data-cue-guidance]')).toContainText('Use Undo to restore guided editing');
  await expect(page.locator('[data-cue-form="click"]')).toBeHidden();
  await expect(page.locator('[data-cue-form="click"] button[type="submit"]')).toBeDisabled();
  await expect(page.locator('[data-cue-status]')).not.toHaveAttribute('data-diagnostic-code');
  await expect(page.locator('[data-cue-status]')).toHaveText('Click detached to ordinary tracks. The compiled result is unchanged; use Undo to restore guided editing.');
  const detached = await page.evaluate(() => ({ state: window.__motionEditor.inspectAuthoring(),
    html: window.__motionEditor.compiledHtml, trackIds: window.__motionEditor.trackIds, rows: window.__motionEditor.canonicalProjection.rows,
    exact: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc === window.__motionEditor.compiledHtml }));
  expect(detached.state.revision).toBe(beforeDetach.state.revision + 1);
  expect(detached.html).toBe(beforeDetach.html); expect(detached.trackIds).toEqual(beforeDetach.trackIds);
  expect(detached.rows).toEqual(beforeDetach.rows); expect(detached.exact).toBe(true);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('[data-cue-status]')).toContainText('Undid the last change');
  await expect(page.locator('[data-authored-cue="click"]')).toHaveCount(1);
  await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'complete');
  const restored = await page.evaluate(() => ({ state: window.__motionEditor.inspectAuthoring(), html: window.__motionEditor.compiledHtml,
    trackIds: window.__motionEditor.trackIds, rows: window.__motionEditor.canonicalProjection.rows,
    cues: window.__motionEditor.inspectCueWorkspace().authoredCues }));
  expect(restored.state.revision).toBe(beforeDetach.state.revision + 2);
  expect({ contentDigest: restored.state.contentDigest, exportDigest: restored.state.exportDigest, html: restored.html,
    trackIds: restored.trackIds, rows: restored.rows, cues: restored.cues }).toEqual({ contentDigest: beforeDetach.state.contentDigest,
    exportDigest: beforeDetach.state.exportDigest, html: beforeDetach.html, trackIds: beforeDetach.trackIds,
    rows: beforeDetach.rows, cues: beforeDetach.cues });
  await page.locator('[data-authored-cue="click"] [data-cue-edit]').click();
  await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'edit-click');
  const restoredClickValues = await page.locator('[data-cue-form="click"]').evaluate((form) => {
    const data = new FormData(form as HTMLFormElement);
    return { arrive: data.get('arrive'), press: data.get('press'), release: data.get('release'), pulseEnd: data.get('pulseEnd'),
      scale: data.get('scale'), radius: data.get('radius') };
  });
  expect(restoredClickValues).toEqual(canonicalClickValues);
  await expect(page.locator('[data-cue-status]')).not.toHaveAttribute('data-diagnostic-code');
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('[data-cue-status]')).toContainText('Redid the last change');
  await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'detached-click');
  const redetached = await page.evaluate(() => ({ state: window.__motionEditor.inspectAuthoring(), html: window.__motionEditor.compiledHtml,
    trackIds: window.__motionEditor.trackIds, rows: window.__motionEditor.canonicalProjection.rows }));
  expect(redetached.state.revision).toBe(beforeDetach.state.revision + 3);
  expect({ contentDigest: redetached.state.contentDigest, exportDigest: redetached.state.exportDigest,
    html: redetached.html, trackIds: redetached.trackIds, rows: redetached.rows }).toEqual({ contentDigest: detached.state.contentDigest,
    exportDigest: detached.state.exportDigest, html: detached.html, trackIds: detached.trackIds, rows: detached.rows });
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('[data-cue-status]')).toContainText('Undid the last change');
  await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'complete');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(beforeDetach.state.revision + 4);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('[data-cue-status]')).toContainText('Redid the last change');
  await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'detached-click');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(beforeDetach.state.revision + 5);
  const timelineFormatting = await page.locator('[data-keyframe-id]').evaluateAll((markers) => markers.map((marker) => ({
    time: marker.querySelector('strong')!.textContent!, detail: marker.querySelector('span')!.textContent!,
    exactTime: (marker as HTMLElement).dataset.timeMs!, exactOffset: (marker as HTMLElement).dataset.offset!,
  })));
  expect(timelineFormatting.every((item) => /^\d+(?:\.\d{1,3})? ms$/.test(item.time)
    && /^\d+(?:\.\d{1,4})?%/.test(item.detail) && !item.time.includes('000000000') && !item.detail.includes('000000000'))).toBe(true);
  expect(timelineFormatting.every((item) => Number.isFinite(Number(item.exactTime)) && Number.isFinite(Number(item.exactOffset)))).toBe(true);
  expect(errors).toEqual([]); expect(failed).toEqual([]);
});
