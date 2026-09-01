import { createServer as createNetServer } from 'node:net';
import { createServer as createViteServer } from 'vite';

import { startLocalMotionService } from '../../../packages/local-service/src/index.ts';
import { createLandingShot1EditorSeed, createPhase3Seed, createPhase4SceneDSeed } from '../../../packages/local-service/src/seed.ts';

const databasePath = process.env.PHASE3_DATABASE_PATH;
if (!databasePath) throw new Error('PHASE3_DATABASE_PATH_REQUIRED');
const humanCapability = process.env.PHASE3_HUMAN_CAPABILITY;
const agentCapability = process.env.PHASE3_AGENT_CAPABILITY;
if (!humanCapability || !agentCapability) throw new Error('PHASE3_CAPABILITIES_REQUIRED');
const requestedEditorPort = Number(process.env.PHASE3_EDITOR_PORT ?? 41739);
const editorPort = requestedEditorPort === 0 ? await reserveEphemeralPort() : requestedEditorPort;
const repositoryRoot = new URL('../../..', import.meta.url).pathname;
const seed = process.env.PHASE4_CURSOR_CLICK_REVEAL === '1'
  ? createPhase4SceneDSeed(repositoryRoot, process.env.PHASE4_SCENE_D_DOCUMENT_PATH)
  : process.env.LANDING_SHOT1_WORKSPACE === '1'
  ? createLandingShot1EditorSeed(repositoryRoot, process.env.LANDING_SHOT1_DOCUMENT_PATH)
  : createPhase3Seed(repositoryRoot);
const service = await startLocalMotionService({ databasePath, seed,
  capabilities: { human: humanCapability, agent: agentCapability } });
process.env.PHASE3_SERVICE_URL = service.url; process.env.PHASE3_HUMAN_CAPABILITY = humanCapability;
const vite = await createViteServer({ configFile: new URL('../vite.config.ts', import.meta.url).pathname,
  server: { host: '127.0.0.1', port: editorPort, strictPort: true }, logLevel: 'error' });
await vite.listen();
const address = vite.httpServer?.address();
if (!address || typeof address === 'string') throw new Error('PHASE3_EDITOR_ADDRESS_UNAVAILABLE');
console.log(JSON.stringify({ editorUrl: `http://lineage-motion.localhost:${address.port}`, serviceUrl: service.url }));
let closing = false;
async function close() { if (closing) return; closing = true; await vite.close(); await service.close(); process.exit(0); }
process.on('SIGTERM', () => { void close(); }); process.on('SIGINT', () => { void close(); });

async function reserveEphemeralPort() {
  const server = createNetServer();
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('PHASE3_EDITOR_EPHEMERAL_PORT_UNAVAILABLE');
  await new Promise((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  return address.port;
}
