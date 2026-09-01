import { chromium } from '@playwright/test';
import { describe, expect, test } from 'vitest';

import { compileMotionDocument } from '../../css-compiler/src/index.js';
import { importMotionHtml } from '../../css-import/src/index.js';
import {
  createAuthoringState, cueTargetSnapshots, deriveCueId, dispatchAuthoringOperation,
  type AuthoringState, type CueAuthoringOperation, type CueSemantic,
} from '../../domain/src/index.js';

function fixtureState(): AuthoringState {
  const imported = importMotionHtml(`<!doctype html><html><head><style>
    .seed { animation: seed 1600ms linear both; } @keyframes seed { from { opacity: .99; } to { opacity: 1; } }
    .cue-target { position: absolute; width: 24px; height: 24px; background: rgb(37 99 235); }
  </style></head><body><div class="seed"></div></body></html>`);
  if (!imported.document) throw new Error('VISUAL_FIXTURE_IMPORT');
  const document = imported.document; document.durationMs = 1600;
  document.reducedMotion = { mode: 'source-snapshot', css: '@media (prefers-reduced-motion: reduce) { [data-motion-id] { animation: none; } }' };
  for (const [index, id] of ['el_visual_cursor', 'el_visual_pulse', 'el_visual_reveal'].entries()) {
    document.elements.push({ id, selectorHint: '', structuralFingerprint: `synthetic/visual/${index}` });
    document.presentation.html = document.presentation.html.replace('</body>', `<div class="cue-target" data-motion-id="${id}"></div></body>`);
  }
  return createAuthoringState(document);
}

function create(state: AuthoringState, key: string, semantic: CueSemantic): AuthoringState {
  const cueId = deriveCueId(state.document.documentId, key);
  const operation: CueAuthoringOperation = { schemaVersion: 'motion.operation.v1', operationId: `visual:${key}`,
    documentId: state.document.documentId, expectedRevision: state.document.revision, kind: 'motion.cue.create',
    payload: { cueId, semantic, targetSnapshots: cueTargetSnapshots(state.document, semantic),
      replacementTrackIds: [], replacementInputDigest: null } };
  const result = dispatchAuthoringOperation(state, operation); expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostic.code); return result.state;
}

describe('cursor/click/reveal native visual proof', () => {
  test('samples stable frames and both sides of reveal while keeping native CSS and zero network', async () => {
    let state = fixtureState();
    const revealId = deriveCueId(state.document.documentId, 'reveal');
    state = create(state, 'reveal', { kind: 'reveal', targetIds: ['el_visual_reveal'], startMs: 800, completeMs: 1200 });
    state = create(state, 'path', { kind: 'cursor-path', cursorTargetId: 'el_visual_cursor', startMs: 0, arriveMs: 700,
      easing: { kind: 'keyword', value: 'ease-out' }, waypoints: [
        { timeMs: 0, xPpm: 50_000, yPpm: 100_000 }, { timeMs: 350, xPpm: 300_000, yPpm: 350_000 },
        { timeMs: 700, xPpm: 600_000, yPpm: 500_000 },
      ] });
    state = create(state, 'click', { kind: 'click', cursorTargetId: 'el_visual_cursor', pulseTargetId: 'el_visual_pulse',
      arriveMs: 700, pressMs: 800, releaseMs: 920, pulseEndMs: 1300, pressScalePpm: 820_000,
      pulseRadiusPpm: 18_000_000, pulseOpacityPpm: 700_000, revealCueId: revealId });
    const runs = [0, 1, 2].map(() => compileMotionDocument(state.document));
    expect(runs.every((run) => run.html === runs[0]!.html && run.css === runs[0]!.css
      && run.exportDigest === runs[0]!.exportDigest)).toBe(true);

    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 320, height: 180 } });
      const requests: string[] = []; const errors: string[] = [];
      page.on('request', (request) => requests.push(request.url()));
      page.on('pageerror', (error) => errors.push(error.message));
      await page.setContent(runs[0]!.html, { waitUntil: 'load' });
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
      const frames = await page.evaluate(async (times) => { const frames = [];
        for (const timeMs of times) {
        const animations = document.getAnimations(); animations.forEach((animation) => { animation.pause(); animation.currentTime = timeMs; });
        await new Promise(requestAnimationFrame);
        const reveal = getComputedStyle(document.querySelector('[data-motion-id="el_visual_reveal"]')!);
        const cursor = getComputedStyle(document.querySelector('[data-motion-id="el_visual_cursor"]')!);
        const pulse = getComputedStyle(document.querySelector('[data-motion-id="el_visual_pulse"]')!);
        frames.push({ timeMs, native: animations.every((animation) => animation.constructor.name === 'CSSAnimation'),
          opacity: reveal.opacity, visibility: reveal.visibility, transform: cursor.transform,
          scale: cursor.scale, boxShadow: pulse.boxShadow }); }
        return frames;
      }, [0, 699, 700, 799, 800, 801, 919, 920, 921, 1199, 1200, 1201, 1300]);
      expect(frames.every((frame) => frame.native)).toBe(true);
      expect(frames.find((frame) => frame.timeMs === 799)?.visibility).toBe('hidden');
      expect(frames.find((frame) => frame.timeMs === 801)?.visibility).toBe('visible');
      expect(frames.find((frame) => frame.timeMs === 1201)?.opacity).toBe('1');
      expect(new Set(frames.map((frame) => frame.transform)).size, JSON.stringify(frames)).toBeGreaterThan(2);
      expect(new Set(frames.map((frame) => frame.boxShadow)).size).toBeGreaterThan(2);
      expect(requests).toEqual([]); expect(errors).toEqual([]);

      await page.emulateMedia({ reducedMotion: 'reduce' }); await page.setContent(runs[0]!.html);
      const reduced = await page.evaluate(() => document.getAnimations().map((animation) => ({
        native: animation.constructor.name === 'CSSAnimation', duration: Number(animation.effect?.getTiming().duration),
      })));
      expect(reduced).toEqual([]);
    } finally { await browser.close(); }
  }, 60_000);
});
