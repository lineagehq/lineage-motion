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
