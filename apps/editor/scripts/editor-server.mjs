import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import { startLocalMotionService } from '../../../packages/local-service/src/index.ts';
import { createLandingShot1EditorSeed, createPhase3Seed, createPhase4ReusableCueSeed, createPhase4SceneDSeed } from '../../../packages/local-service/src/seed.ts';

export async function launchEditor({ onReady } = {}) {
  const databasePath = process.env.PHASE3_DATABASE_PATH;
  if (!databasePath) throw new Error('PHASE3_DATABASE_PATH_REQUIRED');
  const humanCapability = process.env.PHASE3_HUMAN_CAPABILITY;
  const agentCapability = process.env.PHASE3_AGENT_CAPABILITY;
  if (!humanCapability || !agentCapability) throw new Error('PHASE3_CAPABILITIES_REQUIRED');
  const editorPort = Number(process.env.PHASE3_EDITOR_PORT ?? 41739);
  const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const seed = process.env.PHASE4_REUSABLE_CUES === '1' ? createPhase4ReusableCueSeed(repositoryRoot)
    : process.env.PHASE4_CURSOR_CLICK_REVEAL === '1' ? createPhase4SceneDSeed(repositoryRoot, process.env.PHASE4_SCENE_D_DOCUMENT_PATH)
    : process.env.LANDING_SHOT1_WORKSPACE === '1' ? createLandingShot1EditorSeed(repositoryRoot, process.env.LANDING_SHOT1_DOCUMENT_PATH)
    : createPhase3Seed(repositoryRoot);
  let service; let vite; let cleanup; let closing;
  const close = () => closing ??= (async () => {
    try { await vite?.close(); }
    finally {
      try { await service?.close(); }
      finally { cleanup?.(); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop); }
    }
  })();
  const stop = () => { void close().then(() => process.exit(0)); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
  try {
    service = await startLocalMotionService({ databasePath, seed,
      capabilities: { human: humanCapability, agent: agentCapability } });
    process.env.PHASE3_SERVICE_URL = service.url;
    vite = await createViteServer({ configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)),
      server: { host: '127.0.0.1', port: editorPort, strictPort: true }, logLevel: 'silent' });
    // Vite 7 treats config port=0 as its default; bind the existing server directly.
    if (editorPort === 0) await new Promise((resolveListen, reject) => {
      vite.httpServer.once('error', reject);
      vite.httpServer.listen(0, '127.0.0.1', () => {
        vite.httpServer.removeListener('error', reject); resolveListen();
      });
    });
    else await vite.listen();
    const address = vite.httpServer?.address();
    if (!address || typeof address === 'string') throw new Error('PHASE3_EDITOR_ADDRESS_UNAVAILABLE');
    const addresses = { editorUrl: `http://lineage-motion.localhost:${address.port}`, serviceUrl: service.url };
    cleanup = onReady?.(addresses);
    console.log(JSON.stringify(addresses));
    return { ...addresses, close };
  } catch (error) { await close(); throw error; }
}
