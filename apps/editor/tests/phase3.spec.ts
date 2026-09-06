import { spawnTestServer, waitForTestServer, stopTestServer } from './test-server.ts';
import { expect, test } from './test-fixture.ts';
import { type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { runShotDirectControls } from './phase3-shot-direct.js';
import { runShotGesture } from './phase3-shot-gesture.js';
import { runShotHistory } from './phase3-shot-history.js';
import { runShotSetup } from './phase3-shot-setup.js';

test.describe.configure({ mode: 'serial' });
let processHandle: ChildProcess | undefined; let directory = ''; let editorUrl = ''; let serviceUrl = '';
let humanCapability = ''; let agentCapability = '';

test.beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'lineage-motion-browser-'));
  humanCapability = randomBytes(32).toString('base64url'); agentCapability = randomBytes(32).toString('base64url');
  const root = resolve(import.meta.dirname, '../../..'); const port = 0;
  processHandle = spawnTestServer(process.execPath, [resolve(root, 'node_modules/vite-node/vite-node.mjs'), resolve(root, 'apps/editor/scripts/serve-editor.mjs')], {
    cwd: root, env: { ...process.env, PHASE3_DATABASE_PATH: join(directory, 'project.sqlite'), PHASE3_EDITOR_PORT: String(port),
      PHASE3_HUMAN_CAPABILITY: humanCapability, PHASE3_AGENT_CAPABILITY: agentCapability },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const addresses = await waitForTestServer(processHandle!);
  ({ editorUrl, serviceUrl } = addresses);
  await expect.poll(async () => { try { return (await fetch(editorUrl)).ok; } catch { return false; } }).toBe(true);
});

test('Shot 1 workspace commits five durable operations and exact undo/redo through compiler-native preview', async ({ page }) => {
  const setup = await runShotSetup({
    page, directory, humanCapability, agentCapability, initialProcessHandle: processHandle,
  });
  processHandle = setup.processHandle;
  editorUrl = setup.editorUrl;
  serviceUrl = setup.serviceUrl;
  const gesture = await runShotGesture(setup);
  const history = await runShotHistory(gesture);
  await runShotDirectControls(history);
});

test.afterEach(async () => {
  await stopTestServer(processHandle);
  await rm(directory, { recursive: true, force: true });
});
