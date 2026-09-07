import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { expect, test } from 'vitest';
import { startLocalMotionService } from '../../local-service/src/index.ts';
import { sequenceTestStore } from '../../local-service/src/sequence-test-support.ts';
import type { SequenceServiceClient } from './sequence-client.ts';

test('default browser client reads and edits the real sequence service with native fetch', async () => {
  const t = await sequenceTestStore(); t.store.close();
  const service = await startLocalMotionService({ databasePath: t.path, seed: t.seed });
  const browser = await chromium.launch();
  try {
    const bundle = await build({ configFile: false, logLevel: 'silent', build: { write: false,
      lib: { entry: fileURLToPath(new URL('./sequence-client.ts', import.meta.url)), name: 'MotionSequenceClient', formats: ['iife'] },
    } });
    const output = Array.isArray(bundle) ? bundle[0] : bundle;
    if (!output || !('output' in output)) throw new Error('CLIENT_BUNDLE_UNAVAILABLE');
    const script = output.output.find(output => output.type === 'chunk');
    if (!script || script.type !== 'chunk') throw new Error('CLIENT_BUNDLE_UNAVAILABLE');
    const page = await browser.newPage();
    await page.goto(`${service.url}/health`);
    await page.addScriptTag({ content: script.code });
    const result = await page.evaluate(async ({ url, command }) => {
      const api = (window as unknown as { MotionSequenceClient: { SequenceServiceClient: typeof SequenceServiceClient } }).MotionSequenceClient;
      const client = new api.SequenceServiceClient(url, { actor: 'human', capability: 'human-editor' });
      const before = await client.catalog(); const sources = await client.sources();
      const receipt = await client.execute(command);
      const snapshot = await client.snapshot(command.sequenceId);
      return { before, sources, receipt, snapshot, after: await client.catalog() };
    }, { url: service.url, command: t.create });
    expect(result.before.sequences).toEqual([]);
    expect(result.sources.shots).toContainEqual(expect.objectContaining({ source: t.source }));
    expect(result.receipt).toMatchObject({ ok: true, revision: 0 });
    expect(result.snapshot.sequence.clips[0]?.source).toEqual(t.source);
    expect(result.after.sequences).toHaveLength(1);
  } finally { await browser.close(); await service.close(); await t.cleanup(); }
}, 15000);
