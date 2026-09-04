import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runCli } from '../../../packages/motion-cli/src/cli.ts';

test.describe.configure({ mode: 'serial' });
let processHandle: ChildProcess | undefined; let directory = ''; let editorUrl = ''; let serviceUrl = '';
let humanCapability = ''; let agentCapability = '';

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lineage-motion-reusable-cues-'));
  humanCapability = randomBytes(32).toString('base64url');
  agentCapability = randomBytes(32).toString('base64url');
  const root = resolve(import.meta.dirname, '../../..');
  processHandle = spawn(process.execPath, [resolve(root, 'node_modules/vite-node/vite-node.mjs'), resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: root, env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'project.sqlite'), PHASE3_EDITOR_PORT: '0',
      PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: agentCapability, PHASE4_REUSABLE_CUES: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const addresses = await new Promise<{ editorUrl: string; serviceUrl: string }>((resolveAddress, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('PHASE4_REUSABLE_SERVER_TIMEOUT')), 10000);
    processHandle!.stdout!.on('data', (chunk) => { output += chunk.toString();
      const line = output.split('\n').find((candidate) => candidate.startsWith('{'));
      if (line) { clearTimeout(timer); resolveAddress(JSON.parse(line)); }
    });
    processHandle!.once('exit', (code) => { clearTimeout(timer); reject(new Error(`PHASE4_REUSABLE_SERVER_EXIT_${code}`)); });
  });
  ({ editorUrl, serviceUrl } = addresses);
});

test.afterAll(async () => { processHandle?.kill('SIGTERM'); if (directory) await rm(directory, { recursive: true, force: true }); });

test('authors, persists, reloads, detaches, and CLI-updates all reusable cues over compiler-native CSS', async ({ page }) => {
  test.setTimeout(60_000);
  const errors: string[] = []; const consoleErrors: string[] = []; const failed: string[] = []; const httpErrors: string[] = [];
  const expectedOrigins = new Set([new URL(editorUrl).origin, new URL(serviceUrl).origin]); const unexpectedNetwork: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('requestfailed', (request) => failed.push(request.url()));
  page.on('response', (response) => { if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`); });
  page.on('request', (request) => { if (!expectedOrigins.has(new URL(request.url()).origin)) unexpectedNetwork.push(request.url()); });
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-cue-family', 'reusable');
  const ids = await page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!.contentDocument!;
    const id = (selector: string) => frame.querySelector<HTMLElement>(selector)!.dataset.motionId!;
    return { hold: id('.hold'), holdSecondary: id('.hold-secondary'),
      type: document.querySelector<HTMLSelectElement>('[data-cue-form="type"] select')!.options[1]!.value,
      cursor: id('.cursor'), selected: id('.selected'),
      highlight: id('.highlight'), dragged: id('.dragged') }; });
  const chooseOnCanvas = async (kind: string, field: string, elementId: string) => {
    await page.locator(`[data-cue-form="${kind}"] [data-reusable-pick="${field}"]`).click();
    const marker = page.locator(`[data-cue-target-candidate][data-element-id="${elementId}"]`); const box = await marker.boundingBox();
    expect(box).not.toBeNull(); await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);
    const choice = page.locator(`[data-cue-target-choice][data-element-id="${elementId}"]`);
    if (await choice.isVisible()) await choice.click();
    const select = page.locator(`[data-cue-form="${kind}"] select[name="${field}"]`);
    if (await select.getAttribute('multiple') !== null) expect(await select.evaluate((control: HTMLSelectElement) =>
      [...control.selectedOptions].map((option) => option.value))).toContain(elementId);
    else await expect(select).toHaveValue(elementId);
  };
  const settledRevision = async (revision: number) => expect.poll(() => page.evaluate(() => ({
    local: window.__motionEditor.inspectAuthoring().revision,
    durable: window.__motionEditor.inspectCollaboration().workspace?.revision,
    publication: window.__motionEditor.inspectAuthoring().publicationState,
  })), { timeout: 15_000 }).toEqual({ local: revision, durable: revision, publication: 'settled' });
  const durableHoldCoverage = () => page.evaluate(() => {
    const workspace = window.__motionEditor.inspectCollaboration().workspace!;
    const hold = workspace.cues.find((cue) => cue.semantic?.kind === 'hold')!;
    const semantic = hold.semantic;
    return { targetIds: semantic?.kind === 'hold' ? [...semantic.targetIds].sort() : [],
      enterMs: semantic?.kind === 'hold' ? semantic.enterMs : null,
      generatedElementIds: [...new Set(workspace.tracks.filter((track) => track.cueId === hold.cueId)
        .map((track) => track.elementId))].sort() };
  });

  expect(await page.locator('[data-cue-form="hold"] select[name="target"] option').evaluateAll((options) =>
    options.map((option) => (option as HTMLOptionElement).value).filter(Boolean))).toEqual([ids.hold, ids.holdSecondary]);
  await chooseOnCanvas('hold', 'target', ids.hold);
  await chooseOnCanvas('hold', 'target', ids.holdSecondary);
  expect(await page.locator('[data-cue-form="hold"] select[name="target"]').evaluate((select: HTMLSelectElement) =>
    [...select.selectedOptions].map((option) => option.value))).toEqual([ids.hold, ids.holdSecondary]);
  await page.locator('[data-cue-form="hold"] button[type="submit"]').click();
  await settledRevision(1);
  await expect(page.locator('[data-authored-cue="hold"]')).toHaveCount(1);
  await expect(page.locator('[data-cue-status]')).toContainText('Hold created at revision 1');
  const advanced = page.locator('.cue-advanced');
  if (!await advanced.evaluate((details: HTMLDetailsElement) => details.open)) await advanced.locator('> summary').click();
  await page.locator('[data-authored-cue="hold"] [data-cue-edit]').click();
  const holdForm = page.locator('[data-cue-form="hold"]');
  await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'edit-hold');
  await expect(holdForm).toBeVisible();
  await holdForm.locator('.cue-timing > summary').click();
  const holdEnter = holdForm.locator('input[name="enter"]');
  await holdEnter.fill('900'); await holdEnter.press('Tab');
  await expect(holdForm.locator('button[type="submit"]')).toBeDisabled();
  await expect(page.locator('[data-cue-status]')).toHaveAttribute('data-kind', 'error');
  await expect(page.locator('[data-cue-status]')).toContainText('900 ms');
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
  await holdEnter.fill('0'); await holdEnter.press('Tab');
  expect(await holdForm.locator('select[name="target"]').evaluate((select: HTMLSelectElement) =>
    [...select.selectedOptions].map((option) => option.value))).toEqual([ids.hold, ids.holdSecondary]);
  await expect(holdForm.locator('button[type="submit"]')).toBeEnabled();
  await holdForm.locator('button[type="submit"]').click(); await settledRevision(2);
  await page.reload(); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible(); await settledRevision(2);
  expect(await durableHoldCoverage()).toEqual({ targetIds: [ids.hold, ids.holdSecondary].sort(), enterMs: 0,
    generatedElementIds: [ids.hold, ids.holdSecondary].sort() });
  await chooseOnCanvas('type', 'target', ids.type);
  await page.locator('[data-cue-form="type"] button[type="submit"]').click();
  await settledRevision(3);
  await expect(page.locator('[data-authored-cue="type"]')).toHaveCount(1);
  await chooseOnCanvas('select', 'cursor', ids.cursor);
  await chooseOnCanvas('select', 'selected', ids.selected);
  await page.locator('[data-cue-form="select"] button[type="submit"]').click();
  await settledRevision(4);
  await page.setViewportSize({ width: 760, height: 800 });
  const cursorFallback = page.locator('[data-cue-form="drag"] select[name="cursor"]'); await cursorFallback.focus();
  const cursorIndex = await cursorFallback.locator('option').evaluateAll((options, id) =>
    options.findIndex((option) => (option as HTMLOptionElement).value === id), ids.cursor);
  expect(cursorIndex).toBeGreaterThan(0); await page.keyboard.press('Home');
  for (let index = 0; index < cursorIndex; index += 1) await page.keyboard.press('ArrowDown');
  await expect(cursorFallback).toHaveValue(ids.cursor);
  const assertContained = async () => expect(await page.locator('[data-cue-workspace]').evaluate((workspace) => {
    const rect = workspace.getBoundingClientRect(); return rect.left >= 0 && rect.right <= innerWidth + 1
      && rect.top < innerHeight && workspace.scrollWidth <= workspace.clientWidth + 1;
  })).toBe(true);
  await assertContained();
  await chooseOnCanvas('drag', 'dragged', ids.dragged);
  await page.locator('[data-cue-form="drag"] button[type="submit"]').click();
  await settledRevision(5);
  await expect(page.locator('[data-authored-cue]')).toHaveCount(4);
  await expect(page.locator('[data-cue-path-overlay] [data-waypoint-index]')).toHaveCount(3);
  const dragBeforeCanvasEdit = await page.evaluate(() => window.__motionEditor.inspectCueWorkspace().authoredCues
    .find((cue) => cue.kind === 'drag')!.semantic);
  const dragHandle = page.locator('[data-cue-path-overlay] [data-waypoint-index="1"]'); await dragHandle.waitFor();
  const handleBox = await dragHandle.boundingBox(); expect(handleBox).not.toBeNull();
  await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
  await page.mouse.down(); await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 12, handleBox!.y + handleBox!.height / 2 + 8);
  await page.mouse.up(); await settledRevision(6);
  const dragAfterCanvasEdit = await page.evaluate(() => window.__motionEditor.inspectCueWorkspace().authoredCues
    .find((cue) => cue.kind === 'drag')!.semantic);
  expect((dragAfterCanvasEdit as { waypoints: unknown[] }).waypoints).toHaveLength(3);
  expect((dragAfterCanvasEdit as { waypoints: Array<{ xPpm: number }> }).waypoints[1]!.xPpm)
    .not.toBe((dragBeforeCanvasEdit as { waypoints: Array<{ xPpm: number }> }).waypoints[1]!.xPpm);
  await page.getByRole('button', { name: 'Undo' }).click(); await settledRevision(7);
  await page.setViewportSize({ width: 1280, height: 800 }); await assertContained();
  const beforeReload = await page.evaluate(() => ({ state: window.__motionEditor.inspectAuthoring(),
    cues: window.__motionEditor.inspectCueWorkspace().authoredCues, html: window.__motionEditor.compiledHtml,
    exact: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc === window.__motionEditor.compiledHtml,
    animationCount: document.querySelector<HTMLIFrameElement>('[data-preview]')!.contentDocument!.getAnimations().length,
    native: document.querySelector<HTMLIFrameElement>('[data-preview]')!.contentDocument!.getAnimations()
      .every((animation) => animation.constructor.name === 'CSSAnimation') }));
  expect(beforeReload).toMatchObject({ state: { revision: 7 }, exact: true, native: true });
  expect(beforeReload.animationCount).toBeGreaterThan(0);
  expect(beforeReload.cues.map((cue) => cue.kind).sort()).toEqual(['drag', 'hold', 'select', 'type']);

  await page.reload(); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await settledRevision(7);
  expect(await page.evaluate(() => ({ revision: window.__motionEditor.inspectAuthoring().revision,
    kinds: window.__motionEditor.inspectCueWorkspace().authoredCues.map((cue) => cue.kind).sort(),
    html: window.__motionEditor.compiledHtml }))).toEqual({ revision: 7, kinds: ['drag', 'hold', 'select', 'type'], html: beforeReload.html });
  expect(await durableHoldCoverage()).toEqual({ targetIds: [ids.hold, ids.holdSecondary].sort(), enterMs: 0,
    generatedElementIds: [ids.hold, ids.holdSecondary].sort() });

  let stdout = ''; let stderr = '';
  const typeCue = beforeReload.cues.find((cue) => cue.kind === 'type')!;
  expect(await runCli(['cue-update', '--service', serviceUrl, '--capability', humanCapability,
    '--document-id', String(beforeReload.state.documentId), '--operation-id', 'cli-type-update', '--expected-revision', '7',
    '--cue-id', String((typeCue as { cueId?: string }).cueId ?? await page.locator('[data-authored-cue="type"]').getAttribute('data-cue-id')),
    '--semantic', 'type', '--target-id', ids.type, '--start-ms', '100', '--complete-ms', '700', '--step-count', '6'],
  { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } })).toBe(0);
  expect(stderr).toBe(''); expect(JSON.parse(stdout)).toMatchObject({ ok: true, resultingRevision: 8 });
  const dragCue = beforeReload.cues.find((cue) => cue.kind === 'drag')!; stdout = ''; stderr = '';
  expect(await runCli(['cue-update', '--service', serviceUrl, '--capability', humanCapability,
    '--document-id', String(beforeReload.state.documentId), '--operation-id', 'cli-drag-intermediate', '--expected-revision', '8',
    '--cue-id', String((dragCue as { cueId?: string }).cueId ?? await page.locator('[data-authored-cue="drag"]').getAttribute('data-cue-id')),
    '--semantic', 'drag', '--cursor-target-id', ids.cursor, '--dragged-target-id', ids.dragged, '--approach-ms', '0',
    '--press-ms', '100', '--move-start-ms', '200', '--arrive-ms', '600', '--release-ms', '700',
    '--grab-offset-x-ppm', '10000', '--grab-offset-y-ppm', '-20000', '--waypoint', '200:100000:200000',
    '--waypoint', '400:360000:340000', '--waypoint', '600:600000:500000'],
  { stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; } })).toBe(0);
  expect(stderr).toBe(''); expect(JSON.parse(stdout)).toMatchObject({ ok: true, resultingRevision: 9 });
  await page.reload(); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await settledRevision(9);
  const cliWaypoints = await page.evaluate(() => (window.__motionEditor.inspectCueWorkspace().authoredCues
    .find((cue) => cue.kind === 'drag')!.semantic as { waypoints: unknown[] }).waypoints);
  expect(cliWaypoints).toHaveLength(3);
  if (!await advanced.evaluate((details: HTMLDetailsElement) => details.open)) await advanced.locator('> summary').click();
  await page.locator('[data-authored-cue="drag"] [data-cue-edit]').click();
  await expect(page.locator('[data-cue-form="drag"]')).toBeVisible();
  await page.locator('[data-cue-form="drag"] .cue-timing > summary').click();
  await page.locator('[data-cue-form="drag"] input[name="release"]').fill('750');
  await page.locator('[data-cue-form="drag"] button[type="submit"]').click(); await settledRevision(10);
  expect(await page.evaluate(() => (window.__motionEditor.inspectCueWorkspace().authoredCues
    .find((cue) => cue.kind === 'drag')!.semantic as { waypoints: unknown[] }).waypoints)).toEqual(cliWaypoints);
  await page.getByRole('button', { name: 'Undo' }).click(); await settledRevision(11);
  await page.getByRole('button', { name: 'Redo' }).click(); await settledRevision(12);
  expect(await page.evaluate(() => (window.__motionEditor.inspectCueWorkspace().authoredCues
    .find((cue) => cue.kind === 'drag')!.semantic as { waypoints: unknown[] }).waypoints)).toEqual(cliWaypoints);

  const beforeDetach = await page.evaluate(() => window.__motionEditor.compiledHtml);
  if (!await advanced.evaluate((details: HTMLDetailsElement) => details.open)) await advanced.locator('> summary').click();
  await page.locator('[data-authored-cue="drag"] [data-cue-detach]').click();
  await expect(page.locator('[data-authored-cue="drag"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__motionEditor.compiledHtml)).toBe(beforeDetach);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('[data-authored-cue="drag"]')).toBeVisible();
  await page.getByRole('button', { name: 'Redo' }).click(); await expect(page.locator('[data-authored-cue="drag"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__motionEditor.compiledHtml)).toBe(beforeDetach);
  await page.getByRole('button', { name: 'Undo' }).click(); await expect(page.locator('[data-authored-cue="drag"]')).toBeVisible();
  for (const kind of ['hold', 'type', 'select'] as const) {
    const exact = await page.evaluate(() => window.__motionEditor.compiledHtml);
    await page.locator(`[data-authored-cue="${kind}"] [data-cue-detach]`).click();
    await expect(page.locator(`[data-authored-cue="${kind}"]`)).toHaveCount(0);
    expect(await page.evaluate(() => window.__motionEditor.compiledHtml)).toBe(exact);
    await page.getByRole('button', { name: 'Undo' }).click(); await expect(page.locator(`[data-authored-cue="${kind}"]`)).toBeVisible();
    await page.getByRole('button', { name: 'Redo' }).click(); await expect(page.locator(`[data-authored-cue="${kind}"]`)).toHaveCount(0);
    expect(await page.evaluate(() => window.__motionEditor.compiledHtml)).toBe(exact);
    await page.getByRole('button', { name: 'Undo' }).click(); await expect(page.locator(`[data-authored-cue="${kind}"]`)).toBeVisible();
    await page.locator(`[data-authored-cue="${kind}"] [data-cue-delete]`).click();
    await expect(page.locator(`[data-authored-cue="${kind}"]`)).toHaveCount(0);
    await page.getByRole('button', { name: 'Undo' }).click(); await expect(page.locator(`[data-authored-cue="${kind}"]`)).toBeVisible();
    expect(await page.evaluate(() => window.__motionEditor.compiledHtml)).toBe(exact);
  }
  await settledRevision(34);
  await page.emulateMedia({ reducedMotion: 'reduce' }); await page.reload();
  await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await settledRevision(34);
  const claimBase = await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision);
  const claimSecret = randomBytes(32).toString('base64url');
  const agentCommon = ['--service', serviceUrl, '--document-id', String(beforeReload.state.documentId), '--actor', 'agent',
    '--capability', agentCapability];
  let agentOut = ''; let agentErr = '';
  expect(await runCli(['claim-acquire', ...agentCommon, '--operation-id', 'reusable-agent-claim',
    '--expected-revision', String(claimBase), '--scope', 'document', '--claim-secret', claimSecret],
  { stdout: (value) => { agentOut += value; }, stderr: (value) => { agentErr += value; } })).toBe(0);
  expect(agentErr).toBe(''); expect(JSON.parse(agentOut)).toMatchObject({ ok: true, leaseVersion: 1 });
  const agentUpdate = ['cue-update', ...agentCommon, '--operation-id', 'reusable-agent-type', '--expected-revision', String(claimBase),
    '--cue-id', String(await page.locator('[data-authored-cue="type"]').getAttribute('data-cue-id')), '--semantic', 'type',
    '--target-id', ids.type, '--start-ms', '100', '--complete-ms', '750', '--step-count', '6'];
  agentOut = ''; agentErr = '';
  expect(await runCli([...agentUpdate, '--claim-secret', claimSecret],
    { stdout: (value) => { agentOut += value; }, stderr: (value) => { agentErr += value; } })).toBe(0);
  expect(JSON.parse(agentOut)).toMatchObject({ ok: true, resultingRevision: claimBase + 1 });
  agentOut = ''; agentErr = '';
  expect(await runCli(agentUpdate.map((value) => value === 'reusable-agent-type' ? 'reusable-agent-unauthorized'
    : value === String(claimBase) ? String(claimBase + 1) : value),
    { stdout: (value) => { agentOut += value; }, stderr: (value) => { agentErr += value; } })).not.toBe(0);
  expect(JSON.parse(agentOut)).toMatchObject({ ok: false, diagnostic: { code: 'CLAIM_REQUIRED' } });
  agentOut = ''; agentErr = '';
  expect(await runCli([...agentUpdate.map((value) => value === 'reusable-agent-type' ? 'reusable-agent-stale' : value),
    '--claim-secret', claimSecret], { stdout: (value) => { agentOut += value; }, stderr: (value) => { agentErr += value; } })).not.toBe(0);
  expect(JSON.parse(agentOut)).toMatchObject({ eligibility: false, reasonCode: 'DERIVATION_STALE' });
  await page.reload(); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible(); await settledRevision(claimBase + 1);
  const final = await page.evaluate(() => ({ state: window.__motionEditor.inspectAuthoring(),
    html: window.__motionEditor.compiledHtml,
    animationCount: document.querySelector<HTMLIFrameElement>('[data-preview]')!.contentDocument!.getAnimations().length,
    cueCount: window.__motionEditor.inspectCueWorkspace().authoredCues.length }));
  expect(final.animationCount).toBe(0);
  expect(errors).toEqual([]); expect(consoleErrors).toEqual([]); expect(failed).toEqual([]);
  expect(httpErrors).toEqual([]); expect(unexpectedNetwork).toEqual([]);
  const receipt = { schemaVersion: 'motion.phase4-reusable-browser-proof.v1', revision: final.state.revision,
    contentDigest: final.state.contentDigest, exportDigest: final.state.exportDigest,
    compilerDigest: createHash('sha256').update(final.html).digest('hex'), cueCount: final.cueCount,
    reducedAnimationCount: final.animationCount, runtimeErrorCount: errors.length + consoleErrors.length,
    failedRequestCount: failed.length, httpErrorCount: httpErrors.length, unexpectedNetworkCount: unexpectedNetwork.length };
  const root = resolve(import.meta.dirname, '../../..'); await mkdir(resolve(root, '.motion/receipts'), { recursive: true });
  await writeFile(resolve(root, '.motion/receipts/phase4-reusable-browser-proof.json'), `${JSON.stringify(receipt)}\n`);
});
