import { spawn } from 'node:child_process';

import { startLocalMotionService } from '../../../packages/local-service/src/index.ts';
import { createPhase3Seed } from '../../../packages/local-service/src/seed.ts';

const databasePath = process.env.PHASE3_DATABASE_PATH;
if (!databasePath) throw new Error('PHASE3_DATABASE_PATH_REQUIRED');
const humanCapability = process.env.PHASE3_HUMAN_CAPABILITY;
const agentCapability = process.env.PHASE3_AGENT_CAPABILITY;
if (!humanCapability || !agentCapability) throw new Error('PHASE3_CAPABILITIES_REQUIRED');
const editorPort = Number(process.env.PHASE3_EDITOR_PORT ?? 41739);
const repositoryRoot = new URL('../../..', import.meta.url).pathname;
const service = await startLocalMotionService({ databasePath, seed: createPhase3Seed(repositoryRoot),
  capabilities: { human: humanCapability, agent: agentCapability } });
const vite = spawn('npm', ['exec', '--', 'vite', '--config', new URL('../vite.config.ts', import.meta.url).pathname,
  '--host', '127.0.0.1', '--port', String(editorPort)], {
  cwd: repositoryRoot, env: { ...process.env, PHASE3_SERVICE_URL: service.url,
    PHASE3_HUMAN_CAPABILITY: humanCapability }, stdio: ['ignore', 'ignore', 'inherit'],
});
console.log(JSON.stringify({ editorUrl: `http://127.0.0.1:${editorPort}`, serviceUrl: service.url }));
let closing = false;
async function close() { if (closing) return; closing = true; vite.kill('SIGTERM'); await service.close(); process.exit(0); }
process.on('SIGTERM', () => { void close(); }); process.on('SIGINT', () => { void close(); });
vite.once('exit', (code) => { if (!closing) { void service.close().finally(() => process.exit(code ?? 1)); } });
