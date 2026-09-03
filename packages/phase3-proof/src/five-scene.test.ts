import { createHash } from 'node:crypto';
import { describe, expect, test } from 'vitest';
import { chromium } from '@playwright/test';

import { compileMotionDocument } from '../../css-compiler/src/index.js';
import { runFiveSceneClosure } from '../../css-import/src/five-scene.js';
import { canonicalBytes } from '../../domain/src/index.js';
import { startLocalMotionService } from '../../local-service/src/index.js';
import { temporaryStore } from '../../local-service/src/test-support.js';
import { MotionServiceClient } from '../../motion-protocol/src/index.js';

const source = `<!doctype html><html><head><style>
  .target { animation: appear 1s linear both; }
  @keyframes appear { from { opacity: 0; } to { opacity: 1; } }
</style></head><body><div class="target"></div></body></html>`;

describe('five-scene cross-boundary proof', () => {
  test('ephemeral candidate sidecars cannot enter service, revision, compiler, export, or proof identity', async () => {
    const observation = { category: 'reveal' as const, targetIds: ['el_opaque'], startMs: 0,
      endMs: 1000, evidenceKinds: ['progressive-reveal', 'coincident-boundary'] };
    const results = [[], [observation], [observation, { ...observation, category: 'select' as const }]]
      .map((candidateObservations) => runFiveSceneClosure({ scenes: {
        'scene-a': {}, 'scene-b': {}, 'scene-c': {}, 'scene-e': {},
        'scene-d': { source, candidateObservations },
      } }).scenes[3]!);
    const compiledResults = results.map(({ document }) => compileMotionDocument(document!));
    const identity = results.map(({ document }, index) => {
      const compiled = compiledResults[index]!;
      return { canonical: hash(canonicalBytes(document!)), html: hash(compiled.html),
        css: hash(compiled.css), export: compiled.exportDigest, receipt: hash(JSON.stringify(compiled.receipt)) };
    });
    expect(new Set(identity.map((value) => JSON.stringify(value)))).toHaveLength(1);

    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const inventories = [];
      for (const compiled of compiledResults) {
        const page = await browser.newPage();
        let networkRequests = 0;
        page.on('request', (request) => { if (/^https?:/i.test(request.url())) networkRequests += 1; });
        await page.setContent(compiled.html, { waitUntil: 'load' });
        const inventory = await page.evaluate(async () => {
          await document.fonts.ready;
          return document.getAnimations().map((animation) => {
            const timing = animation.effect?.getComputedTiming();
            return { constructor: animation.constructor.name, duration: timing?.duration,
              delay: timing?.delay, iterations: timing?.iterations };
          });
        });
        inventories.push({ inventory, networkRequests });
        await page.close();
      }
      expect(new Set(inventories.map((value) => JSON.stringify(value)))).toHaveLength(1);
      expect(inventories[0]).toMatchObject({ networkRequests: 0,
        inventory: [expect.objectContaining({ constructor: 'CSSAnimation' })] });
    } finally {
      await browser.close();
    }

    const stores = await Promise.all(results.map(() => temporaryStore()));
    const services = await Promise.all(results.map(({ document }, index) =>
      startLocalMotionService({ databasePath: stores[index]!.databasePath, seed: document! })));
    try {
      const heads = await Promise.all(services.map((service, index) =>
        new MotionServiceClient(service.url).head(results[index]!.document!.documentId)));
      expect(new Set(heads.map(({ document }) => hash(canonicalBytes(document))))).toHaveLength(1);
      expect(new Set(heads.map(({ document }) => document.revision))).toEqual(new Set([0]));
      expect(JSON.stringify(heads)).not.toMatch(/candidate_/);
    } finally {
      await Promise.all(services.map((service) => service.close()));
      await Promise.all(stores.map((store) => store.cleanup()));
    }
  }, 30_000);
});

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
