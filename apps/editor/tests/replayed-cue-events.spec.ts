import { expect, test } from './test-fixture.ts';
import { spawnTestServer, waitForTestServer, stopTestServer } from './test-server.ts';
import { type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCli } from '../../../packages/motion-cli/src/cli.ts';
import { createPhase4ReusableCueSeed } from '../../../packages/local-service/src/seed.ts';

const root = resolve(import.meta.dirname, '../../..');
let child: ChildProcess; let directory = ''; let editorUrl = ''; let serviceUrl = '';
const humanCapability = randomBytes(32).toString('base64url');
const agentCapability = randomBytes(32).toString('base64url');

test.beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'motion-replay-'));
  child = spawnTestServer(process.execPath, ['--import', 'tsx', 'apps/editor/scripts/serve-editor.mjs'], {
    cwd: root, env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'project.sqlite'),
      PHASE3_EDITOR_PORT: '0', PHASE4_REUSABLE_CUES: '1', PHASE3_HUMAN_CAPABILITY: humanCapability,
      PHASE3_AGENT_CAPABILITY: agentCapability }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  ({ editorUrl, serviceUrl } = await waitForTestServer(child));
});
test.afterAll(async () => {
  await stopTestServer(child);
  if (directory) await rm(directory, { recursive: true, force: true });
});

test('historical cue events preserve the visible edit form while fresh mutations and claims still reconcile', async ({ page }) => {
  const seed = createPhase4ReusableCueSeed(root);
  const id = (selector: string) => seed.elements.find((element) => element.selectorHint === selector)!.id;
  const common = ['--service', serviceUrl, '--document-id', seed.documentId];
  const invoke = async (args: string[]) => {
    let stdout = ''; let stderr = '';
    const code = await runCli([...args, ...common, '--capability', args.includes('agent') ? agentCapability : humanCapability], {
      stdout: (value) => { stdout += value; }, stderr: (value) => { stderr += value; },
    });
    expect(code, stdout || stderr).toBe(0); expect(stderr).toBe(''); return JSON.parse(stdout);
  };
  await invoke(['cue-create', '--operation-id', 'replay-type', '--expected-revision', '0', '--creation-key', 'replay-type',
    '--semantic', 'type', '--target-id', id('.type'), '--start-ms', '100', '--complete-ms', '600', '--step-count', '5']);
  await invoke(['cue-create', '--operation-id', 'replay-select', '--expected-revision', '1', '--creation-key', 'replay-select',
    '--semantic', 'select', '--cursor-target-id', id('.cursor'), '--selected-target-id', id('.selected'),
    '--highlight-target-id', id('.highlight'), '--approach-ms', '100', '--choose-ms', '300', '--settle-ms', '500']);

  let releaseEvents!: () => void; const eventsGate = new Promise<void>((resolveGate) => { releaseEvents = resolveGate; });
  let releaseSecond!: () => void; const secondGate = new Promise<void>((resolveGate) => { releaseSecond = resolveGate; });
  await page.route('**/api/v1/documents/*/events', async (route) => { await eventsGate; await route.continue(); });
  let secondRequested = false;
  await page.route('**/api/v1/documents/*/revisions/2', async (route) => {
    secondRequested = true; await secondGate; await route.continue();
  });
  await page.goto(editorUrl); await expect(page.locator('[data-editor-ready="true"]')).toBeVisible();
  const inspect = () => page.evaluate(() => window.__motionEditor.inspectAuthoring());
  expect(await inspect()).toMatchObject({ revision: 2, lastCommitSeq: 0 });
  await page.locator('.cue-advanced > summary').click();
  await page.locator('[data-authored-cue="select"] [data-cue-edit]').click();
  const form = page.locator('[data-cue-form="select"]');
  await expect(form).toBeVisible();
  const initialHtml = await page.evaluate(() => window.__motionEditor.compiledHtml);
  releaseEvents();
  await expect.poll(() => secondRequested).toBe(true);
  // Revision 1 has finished reconciliation, while revision 2 is deliberately held at the network boundary.
  expect(await inspect()).toMatchObject({ revision: 2, lastCommitSeq: 1, immutableRefetchCount: 0 });
  await expect(form).toBeVisible();
  await expect(page.locator('[data-cue-workspace]')).toHaveAttribute('data-step', 'edit-select');
  expect(await page.evaluate(() => window.__motionEditor.compiledHtml)).toBe(initialHtml);
  releaseSecond();
  await expect.poll(async () => (await inspect()).lastCommitSeq).toBe(2);
  await expect(form).toBeVisible();

  const claim = await invoke(['claim-acquire', '--actor', 'agent', '--operation-id', 'replay-claim', '--expected-revision', '2',
    '--scope', 'document', '--claim-secret', randomBytes(32).toString('base64url')]);
  await expect.poll(async () => (await inspect()).lastCommitSeq).toBe(3);
  await expect.poll(() => page.evaluate(() => window.__motionEditor.inspectCollaboration().claims)).toMatchObject({
    claims: [expect.objectContaining({ claimId: claim.claimId })],
  });
  const typeCueId = await page.locator('[data-authored-cue="type"]').getAttribute('data-cue-id');
  await invoke(['cue-update', '--operation-id', 'replay-fresh-type', '--expected-revision', '2', '--cue-id', typeCueId!,
    '--semantic', 'type', '--target-id', id('.type'), '--start-ms', '100', '--complete-ms', '700', '--step-count', '6']);
  await expect.poll(async () => (await inspect()).revision).toBe(3);
  await expect.poll(async () => (await inspect()).lastCommitSeq).toBe(4);
  expect(await page.evaluate(() => window.__motionEditor.inspectCueWorkspace().authoredCues
    .find((cue) => cue.kind === 'type')!.semantic)).toMatchObject({ completeMs: 700, stepCount: 6 });
  expect(await page.evaluate(() => ({ html: window.__motionEditor.compiledHtml,
    preview: document.querySelector<HTMLIFrameElement>('[data-preview]')!.srcdoc })))
    .toEqual(expect.objectContaining({ preview: await page.evaluate(() => window.__motionEditor.compiledHtml) }));
  expect(await inspect()).toMatchObject({ revision: 3, immutableRefetchCount: 1, publicationState: 'settled' });
});
