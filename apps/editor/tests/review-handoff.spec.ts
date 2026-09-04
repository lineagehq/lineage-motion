import { expect, test } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { makeTrackCreateCommand, MotionServiceClient } from '../../../packages/motion-protocol/src/index.ts';
import { createPhase3Seed } from '../../../packages/local-service/src/seed.ts';

let processHandle: ChildProcess; let directory: string; let editorUrl: string; let serviceUrl: string; let humanCapability: string;
test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lineage-motion-review-')); humanCapability = randomBytes(32).toString('base64url');
  const root = resolve(import.meta.dirname, '../../..');
  processHandle = spawn(process.execPath, [resolve(root, 'node_modules/vite-node/vite-node.mjs'), resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: root, env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'project.sqlite'), PHASE3_EDITOR_PORT: '0',
      PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: randomBytes(32).toString('base64url') },
    stdio: ['ignore', 'pipe', 'pipe'] });
  ({ editorUrl, serviceUrl } = await new Promise<{ editorUrl: string; serviceUrl: string }>((resolveAddress, reject) => { let output = '';
    const timer = setTimeout(() => reject(new Error('REVIEW_SERVER_TIMEOUT')), 10_000);
    processHandle.stdout!.on('data', (chunk) => { output += chunk.toString(); const line = output.split('\n').find((item) => item.startsWith('{'));
      if (line) { clearTimeout(timer); resolveAddress(JSON.parse(line)); } });
    processHandle.once('exit', (code) => reject(new Error(`REVIEW_SERVER_EXIT_${code}`))); }));
});
test.afterEach(async () => { processHandle.kill('SIGTERM'); if (processHandle.exitCode === null)
  await new Promise((done) => processHandle.once('exit', done)); await rm(directory, { recursive: true, force: true }); });

test('installed Chrome completes the private five-action review and sanitized handoff workflow', async ({ page, browserName }) => {
  const motion = new MotionServiceClient(serviceUrl, fetch, { actor: 'human', capability: humanCapability });
  const initial = await motion.head(createPhase3Seed(resolve(import.meta.dirname, '../../..')).documentId);
  expect(await motion.dispatch(makeTrackCreateCommand({ operationId: 'browser-review-base', documentId: initial.document.documentId,
    expectedRevision: 0, elementId: 'el_2dbee68b1ea318c8' }))).toMatchObject({ ok: true });
  await page.goto(`${editorUrl}?review-handoff=1`); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  expect(new URL(page.url()).hostname).toBe('lineage-motion.localhost'); const before = await page.evaluate(() => ({
    revision: window.__motionEditor.inspectAuthoring().revision, compiledHtml: window.__motionEditor.compiledHtml,
    preview: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc }));
  const body = `ephemeral-${crypto.randomUUID()}`; const textarea = page.locator('[data-review-form] textarea'); await textarea.fill(body);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await expect(page.locator('[data-review-annotations]')).toContainText('v1 · open');
  await textarea.fill(`${body}-replacement`); await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await expect(page.locator('[data-review-annotations]')).toContainText('v2 · open');
  for (const [name, expected] of [['Resolve', 'v3 · resolved'], ['Reopen', 'v4 · open'], ['Delete', 'v5 · deleted']] as const) {
    await textarea.fill('required-input-cleared-after-submit'); await page.getByRole('button', { name, exact: true }).click();
    await expect(page.locator('[data-review-annotations]')).toContainText(expected);
  }
  await page.locator('[data-compare-form] input[name="left"]').fill('0'); await page.locator('[data-compare-form] input[name="right"]').fill('1');
  await page.getByRole('button', { name: 'Compare immutable revisions' }).click();
  await expect(page.locator('[data-comparison]')).toContainText('r0 ↔ r1'); await page.locator('[data-create-handoff]').click();
  await expect(page.locator('[data-handoff]')).toContainText('Handoff');
  const after = await page.evaluate(() => ({ revision: window.__motionEditor.inspectAuthoring().revision,
    compiledHtml: window.__motionEditor.compiledHtml, preview: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc,
    review: window.__motionEditor.inspectReviewHandoff(), bodyValue: document.querySelector<HTMLTextAreaElement>('[data-review-form] textarea')!.value,
    html: document.documentElement.innerHTML }));
  expect(after).toMatchObject({ revision: before.revision, compiledHtml: before.compiledHtml, preview: before.preview,
    bodyValue: '', review: { actionKinds: ['review.annotation.create', 'review.annotation.edit', 'review.annotation.resolve',
      'review.annotation.reopen', 'review.annotation.delete'], bodyRetainedInDom: false, handoff: { identity: { benchmarkRecords: [] } } } });
  expect(JSON.stringify(after.review)).not.toContain(body); expect(after.html).not.toContain(body);
  const receipt = { schemaVersion: 'review.browser-receipt.v1', passed: true, browserName,
    namedSubdomain: new URL(page.url()).hostname, revisionUnchanged: after.revision === before.revision,
    compilerPreviewUnchanged: after.compiledHtml === before.compiledHtml && after.preview === before.preview,
    actions: after.review!.actionKinds, comparison: after.review!.comparison, handoffDigest: after.review!.handoff!.handoffDigest,
    benchmarkRecords: after.review!.handoff!.identity.benchmarkRecords, bodyAbsentFromEvidence: true };
  const root = resolve(import.meta.dirname, '../../..'); await mkdir(resolve(root, '.motion/receipts'), { recursive: true });
  await writeFile(resolve(root, '.motion/receipts/phase4-review-handoff-browser.json'), `${JSON.stringify(receipt, null, 2)}\n`);
});
