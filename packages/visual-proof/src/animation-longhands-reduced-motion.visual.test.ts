import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { chromium, type Browser } from '@playwright/test';
import { describe, expect, test } from 'vitest';

import { compileMotionDocument } from '../../css-compiler/src/index.js';
import { importMotionHtml } from '../../css-import/src/index.js';
import { deriveSamplePlan, runControlledVisualProof } from './index.js';

const fixtureUrl = new URL(
  '../../../fixtures/public-synthetic/animation-longhands-reduced-motion.html',
  import.meta.url,
);

describe('controlled Chromium longhand and reduced-motion proof', () => {
  test('matches native source pixels normally and in three reduced-motion replays', async () => {
    const source = await readFile(fixtureUrl, 'utf8');
    const imported = importMotionHtml(source);
    expect(imported.document).not.toBeNull();
    const compiled = compileMotionDocument(imported.document!);
    const samplePlan = deriveSamplePlan(imported.document!, [0, 100, 700, 1300]);

    const normal = await runControlledVisualProof({
      baselineHtml: source,
      compiledHtml: compiled.html,
      samplePlan,
      outputDirectory: 'test-results/animation-longhands-reduced-motion',
      viewport: { width: 320, height: 180 },
    });
    expect(normal.passed).toBe(true);
    expect(normal.baselineStability).toEqual({
      replayCount: 3,
      sampleCount: samplePlan.sampleTimesMs.length,
      correspondingHashesEqual: true,
    });
    expect(normal.network).toEqual({ liveRequestCount: 0, abortedUnexpectedRequestCount: 0 });
    expect(normal.pixelComparison.changedPixels).toBe(0);

    const browser = await chromium.launch({ headless: true });
    try {
      const reducedRuns = [];
      for (let replay = 0; replay < 3; replay += 1) {
        reducedRuns.push({
          baseline: await captureReduced(browser, source),
          compiled: await captureReduced(browser, compiled.html),
        });
      }
      expect(reducedRuns.every((run) => run.baseline.hash === run.compiled.hash)).toBe(true);
      expect(new Set(reducedRuns.map((run) => run.baseline.hash)).size).toBe(1);
      expect(new Set(reducedRuns.map((run) => run.compiled.hash)).size).toBe(1);
      expect(reducedRuns.every((run) => run.baseline.animationCount === 0
        && run.compiled.animationCount === 0)).toBe(true);
      expect(reducedRuns.every((run) => JSON.stringify(run.baseline.presentation)
        === JSON.stringify(run.compiled.presentation))).toBe(true);
      expect(reducedRuns.every((run) => run.baseline.liveNetworkCount === 0
        && run.compiled.liveNetworkCount === 0)).toBe(true);
    } finally {
      await browser.close();
    }
  }, 60_000);
});

async function captureReduced(browser: Browser, html: string) {
  const context = await browser.newContext({
    viewport: { width: 320, height: 180 },
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'reduce',
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
  });
  let liveNetworkCount = 0;
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (/^(?:about:|data:|blob:)/.test(url)) { await route.continue(); return; }
    if (/^https?:/i.test(url)) liveNetworkCount += 1;
    await route.abort('blockedbyclient');
  });
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() =>
        requestAnimationFrame(() => resolve())));
    });
    const presentation = await page.evaluate(() => {
      const target = getComputedStyle(document.querySelector('.proof-target')!);
      const peer = getComputedStyle(document.querySelector('.proof-peer')!);
      return {
        targetBackground: target.backgroundColor,
        targetTransform: target.transform,
        peerOpacity: peer.opacity,
      };
    });
    const animationCount = await page.evaluate(() => document.getAnimations().length);
    const screenshot = await page.screenshot({
      animations: 'allow', caret: 'hide', fullPage: false, scale: 'css', type: 'png',
    });
    return {
      hash: createHash('sha256').update(screenshot).digest('hex'),
      animationCount,
      presentation,
      liveNetworkCount,
    };
  } finally {
    await context.close();
  }
}
