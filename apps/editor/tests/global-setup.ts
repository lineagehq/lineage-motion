import { resolve } from 'node:path';
import { spawnTestServer, stopTestServer, waitForTestServer } from './test-server.ts';

export default async function setup() {
  const root = resolve(import.meta.dirname, '../../..');
  const child = spawnTestServer(process.execPath, [resolve(root, 'node_modules/vite-node/vite-node.mjs'),
    resolve(root, 'apps/editor/tests/serve-static.mjs')], { cwd: root,
    env: { ...process.env, PHASE3_SERVICE_URL: '', PHASE3_HUMAN_CAPABILITY: '', LANDING_SHOT1_WORKSPACE: '1' },
    stdio: ['ignore', 'pipe', 'pipe'] });
  process.env.MOTION_STATIC_URL = (await waitForTestServer(child)).editorUrl;
  return async () => { await stopTestServer(child); };
}
