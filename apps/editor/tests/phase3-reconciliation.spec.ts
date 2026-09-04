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


test.afterEach(async () => {
  if (processHandle?.exitCode === null) { processHandle.kill('SIGTERM'); await new Promise((resolveExit) => processHandle!.once('exit', resolveExit)); }
  await rm(directory, { recursive: true, force: true });
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

test('canvas-first installed Chrome emits only the aggregate adversarial receipt', async () => {
  test.setTimeout(120_000);
  if (processHandle?.exitCode === null) { processHandle.kill('SIGTERM'); await new Promise((resolveExit) => processHandle!.once('exit', resolveExit)); }
  const root = resolve(import.meta.dirname, '../../..');
  const child = spawn('node', [resolve(root, 'apps/editor/scripts/qa-chrome.mjs'), '--canvas-first-ux'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = ''; let stderr = '';
  child.stdout!.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr!.on('data', (chunk) => { stderr += chunk.toString(); });
  const exitCode = await new Promise<number | null>((resolveExit, reject) => {
    const timer = setTimeout(() => { child.kill('SIGTERM'); reject(new Error('CANVAS_FIRST_QA_TIMEOUT')); }, 90_000);
    child.once('exit', (code) => { clearTimeout(timer); resolveExit(code); });
  });
  expect(exitCode, stderr).toBe(0);
  const lines = stdout.trim().split('\n'); expect(lines).toHaveLength(1);
  const receipt = JSON.parse(lines[0]!) as Record<string, unknown>;
  expect(Object.keys(receipt)).toEqual([
    'schemaVersion', 'passed', 'viewport', 'operationCount', 'momentCount', 'geometryMaxDeltaCssPx',
    'nativeCssAnimationCount', 'keyboardFlowPassed', 'failurePreservedCompiler', 'consoleErrorCount', 'networkErrorCount',
  ]);
  expect(receipt).toMatchObject({ schemaVersion: 'motion.canvas-first-qa.v1', passed: true,
    viewport: { width: 1440, height: 900, dpr: 1 }, keyboardFlowPassed: true,
    failurePreservedCompiler: true, consoleErrorCount: 0, networkErrorCount: 0 });
  expect(receipt.operationCount).toEqual(expect.any(Number)); expect(receipt.operationCount).toBeGreaterThan(0);
  expect(receipt.momentCount).toEqual(expect.any(Number)); expect(receipt.momentCount).toBeGreaterThanOrEqual(3);
  expect(receipt.geometryMaxDeltaCssPx).toEqual(expect.any(Number)); expect(receipt.geometryMaxDeltaCssPx).toBeLessThanOrEqual(1);
  expect(receipt.nativeCssAnimationCount).toEqual(expect.any(Number)); expect(receipt.nativeCssAnimationCount).toBeGreaterThan(0);
});
