import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runCli } from '../../../packages/motion-cli/src/cli.ts';
import { createPhase3Seed } from '../../../packages/local-service/src/seed.ts';

test.describe.configure({ mode: 'serial' });
let processHandle: ChildProcess | undefined; let directory = ''; let editorUrl = ''; let serviceUrl = '';

test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lineage-motion-browser-'));
  const root = resolve(import.meta.dirname, '../../..'); const port = 42000 + Math.floor(Math.random() * 1000);
  processHandle = spawn('npm', ['exec', 'vite-node', '--', resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: root, env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'project.sqlite'), PHASE3_EDITOR_PORT: String(port) },
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
  const beforeUnsupported = await page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(await page.evaluate(() => window.__motionEditor.dispatch({ schemaVersion: 'motion.operation.v1', operationId: 'unsupported-hold',
    documentId: window.__motionEditor.inspectAuthoring().documentId, expectedRevision: 1, kind: 'motion.hold.insert',
    payload: { cueId: 'cue_pair', durationMs: 600 } }))).toEqual({ ok: false, code: 'SERVICE_OPERATION_UNSUPPORTED' });
  expect(await page.evaluate(() => window.__motionEditor.inspectAuthoring())).toEqual(beforeUnsupported);
  expect(serviceResponses.some((response) => response.url.endsWith('/commands') && response.status === 200
    && response.contentType.startsWith('application/json'))).toBe(true);
  expect(pageErrors).toEqual([]); expect(consoleErrors).toEqual([]); expect(failedRequests).toEqual([]);
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
    '--expected-revision', '0', '--element-id', 'el_2dbee68b1ea318c8'], { stdout: (value) => { output += value; }, stderr: () => undefined })).toBe(0);
  expect(JSON.parse(output)).toMatchObject({ ok: true, resultingRevision: 1 });
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectAuthoring().revision)).toBe(1);
  const proof = await page.evaluate(() => { const iframe = document.querySelector<HTMLIFrameElement>('[data-preview]')!;
    return { state: window.__motionEditor.inspectAuthoring(), exact: iframe.srcdoc === window.__motionEditor.compiledHtml,
      animationCount: iframe.contentDocument!.getAnimations().length,
      native: iframe.contentDocument!.getAnimations().every((animation) => animation.constructor.name === 'CSSAnimation') }; });
  expect(proof.state).toMatchObject({ immutableRefetchCount: 1,
    lastCommit: { revision: 1, kind: 'motion.track.create', branchId: 'main' } });
  expect(Object.keys(proof.state.lastCommit!).sort()).toEqual(['branchId', 'commitSeq', 'digest', 'documentId', 'kind', 'revision']);
  expect(proof.exact).toBe(true); expect(proof.animationCount).toBeGreaterThan(0); expect(proof.native).toBe(true);
  expect(eventResponses).toEqual([expect.objectContaining({ status: 200, contentType: expect.stringContaining('text/event-stream') })]);
  expect(pageErrors).toEqual([]); expect(consoleErrors).toEqual([]); expect(failedRequests).toEqual([]);
});
