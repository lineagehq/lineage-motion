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

test('rejected retimes stay coherent and failed waypoint publication is visibly recoverable', async ({ page }) => {
  processHandle?.kill('SIGTERM');
  if (processHandle?.exitCode === null) await new Promise((resolveExit) => processHandle!.once('exit', resolveExit));
  const root = resolve(import.meta.dirname, '../../..'); const seed = createTrajectorySeed(root);
  const runtimeSeedPath = join(directory, 'retime-failure-seed.json'); await writeFile(runtimeSeedPath, `${JSON.stringify(seed)}\n`);
  processHandle = spawn(process.execPath, [resolve(root, 'node_modules/vite-node/vite-node.mjs'), resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: root, env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'retime-failure.sqlite'), PHASE3_EDITOR_PORT: '0',
      PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: agentCapability, LANDING_SHOT1_WORKSPACE: '1',
      LANDING_SHOT1_DOCUMENT_PATH: runtimeSeedPath }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const addresses = await new Promise<{ editorUrl: string }>((resolveAddress, reject) => {
    let output = ''; const timer = setTimeout(() => reject(new Error('RETIME_FAILURE_SERVER_TIMEOUT')), 10_000);
    processHandle!.stdout!.on('data', (chunk) => { output += chunk.toString(); const line = output.split('\n').find((candidate) => candidate.startsWith('{'));
      if (line) { clearTimeout(timer); resolveAddress(JSON.parse(line)); } });
    processHandle!.once('exit', (code) => { clearTimeout(timer); reject(new Error(`RETIME_FAILURE_SERVER_EXIT_${code}`)); });
  });
  let commandCount = 0; page.on('request', (request) => { if (request.url().endsWith('/api/v1/commands')) commandCount += 1; });
  await page.goto(addresses.editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  await page.evaluate(() => window.__motionEditor.disconnectEvents());
  const readState = () => page.evaluate(() => { const frame = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    const feedback = document.querySelector<HTMLOutputElement>('[data-shot-control-feedback]');
    return { revision: window.__motionEditor.inspectAuthoring().revision, compiler: window.__motionEditor.compiledHtml,
      iframe: frame.srcdoc, selectedMoment: window.__motionEditor.inspectShotWorkspace().momentMs,
      selectedChip: Number(document.querySelector<HTMLInputElement>('input[name="shot-moment"]:checked')?.value),
      dockTime: Number(document.querySelector<HTMLInputElement>('[data-shot-context-time]')?.value),
      scrubber: Number(document.querySelector<HTMLInputElement>('[data-scrub]')?.value),
      playhead: document.querySelector<HTMLOutputElement>('[data-playhead]')?.value,
      native: window.__motionEditor.readState(), publicationState: window.__motionEditor.inspectAuthoring().publicationState,
      feedback: feedback ? { value: feedback.value, hidden: feedback.hidden, visible: feedback.getClientRects().length > 0
        && getComputedStyle(feedback).visibility !== 'hidden' } : null,
      diagnostic: document.querySelector<HTMLOutputElement>('[data-service-diagnostic]')?.value ?? null,
      diagnosticVisible: Boolean(document.querySelector<HTMLOutputElement>('[data-service-diagnostic]')?.getClientRects().length),
      drawerHidden: document.querySelector<HTMLElement>('[data-shot-advanced-drawer]')!.hidden,
    }; });
  const baseline = await readState();

  await page.route('**/operations/prepare', async (route) => route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({
    ok: false, code: 'VALIDATION', diagnostic: { schemaVersion: 'motion.diagnostic.v1', code: 'REJECTED_RETIME', category: 'domain', retryable: false },
  }) }));
  await page.locator('[data-shot-context-time]').fill('840');
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectCollaboration().diagnostic?.code)).toBe('REJECTED_RETIME');
  const rejected = await readState(); await page.unroute('**/operations/prepare');
  await page.locator('[data-scrub]').fill('700');

  await page.evaluate(() => window.__motionEditor.failNextPublication());
  await page.locator('[data-shot-context-time]').fill('840');
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().publicationState)).toBe('failed');
  await expect.poll(() => page.locator('[data-shot-control-feedback]').evaluate((output) => (output as HTMLOutputElement).value)).toContain('Timing');
  const failed = await readState();
  expect(await page.evaluate(() => window.__motionEditor.retryPublication())).toBe(true);
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().publicationState)).toBe('settled');
  const retried = await readState();

  const oldTuple = { selectedMoment: 700, selectedChip: 700, dockTime: 700, scrubber: 700, playhead: '700 ms',
    native: { playheadMs: 700, currentTimes: [700, 700], playStates: ['paused', 'paused'] } };
  expect({ rejected, failed, retried, commandCount }).toMatchObject({
    rejected: { revision: 0, compiler: baseline.compiler, iframe: baseline.iframe, ...oldTuple,
      publicationState: 'settled', feedback: { hidden: false, visible: true,
        value: 'Timing could not be changed. Your previous moment is still active.' },
      diagnostic: 'REJECTED_RETIME · domain · not retryable', diagnosticVisible: false, drawerHidden: true },
    failed: { revision: 0, compiler: baseline.compiler, iframe: baseline.iframe, ...oldTuple,
      publicationState: 'failed', feedback: { hidden: false, visible: true,
        value: 'Timing could not be published. Your previous moment is still active.' },
      diagnostic: 'PUBLICATION_FAILED · storage · retryable', diagnosticVisible: false, drawerHidden: true },
    retried: { revision: 1, selectedMoment: 840, selectedChip: 840, dockTime: 840, scrubber: 840, playhead: '840 ms',
      native: { playheadMs: 840, currentTimes: [840, 840], playStates: ['paused', 'paused'] },
      publicationState: 'settled', feedback: { hidden: true, visible: false }, drawerHidden: true },
    commandCount: 1,
  });
  expect(`${failed.feedback?.value} ${rejected.feedback?.value}`).not.toContain('Pose');

  const waypoint = page.locator('.trajectory-waypoint[data-time-ms="840"]');
  const waypointBox = await waypoint.boundingBox();
  expect(waypointBox).not.toBeNull();
  await page.evaluate(() => window.__motionEditor.failNextPublication());
  await page.mouse.move(waypointBox!.x + waypointBox!.width / 2, waypointBox!.y + waypointBox!.height / 2);
  await page.mouse.down();
  await page.mouse.move(waypointBox!.x + waypointBox!.width / 2 + 12, waypointBox!.y + waypointBox!.height / 2 + 6, { steps: 3 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().publicationState)).toBe('failed');
  await expect(page.locator('[data-shot-advanced-drawer]')).toBeHidden();
  await expect(page.locator('[data-shot-control-feedback]')).toBeVisible();
  await expect.poll(() => page.locator('[data-shot-control-feedback]')
    .evaluate((output) => (output as HTMLOutputElement).value))
    .toBe('Position could not be published. Your previous motion is still active.');
  await expect(page.locator('[data-service-diagnostic]')).toBeHidden();
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
  expect(commandCount).toBe(2);
});
