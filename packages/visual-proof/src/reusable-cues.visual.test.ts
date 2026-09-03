import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { compileMotionDocument } from '../../css-compiler/src/index.js';
import { importMotionHtml } from '../../css-import/src/index.js';
import { createAuthoringState, cueTargetSnapshots, deriveCueId, dispatchAuthoringOperation, projectCueReplacement,
  type AuthoringState, type CueAuthoringOperation, type CueSemantic } from '../../domain/src/index.js';

function create(state: AuthoringState, key: string, semantic: CueSemantic): AuthoringState {
  const cueId = deriveCueId(state.document.documentId, key);
  const replacement = projectCueReplacement(state.document, cueId, semantic);
  if (!replacement.ok) throw new Error(replacement.code);
  const operation: CueAuthoringOperation = { schemaVersion: 'motion.operation.v1', operationId: `visual:${key}`,
    documentId: state.document.documentId, expectedRevision: state.document.revision, kind: 'motion.cue.create',
    payload: { cueId, semantic, targetSnapshots: cueTargetSnapshots(state.document, semantic),
      replacementTrackIds: replacement.trackIds, replacementInputDigest: replacement.inputDigest } };
  const result = dispatchAuthoringOperation(state, operation); expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.diagnostic.code); return result.state;
}

describe('reusable cues native visual boundaries', () => {
  test('samples Type steps, Select choice, Drag moments, and Hold enter/exit with stable native CSS', async () => {
    const imported = importMotionHtml(`<!doctype html><html><head><style>
      .source{position:absolute;width:40px;height:40px;background:#047857;animation:source 2s linear both}
      .target{position:absolute;width:80px;height:40px;overflow:hidden;background:#d97706}
      @keyframes source{0%{opacity:0}50%{opacity:.5}100%{opacity:1}}
    </style></head><body><div class="source"></div></body></html>`);
    if (!imported.document) throw new Error('VISUAL_FIXTURE_IMPORT');
    imported.document.durationMs = 3000;
    for (const [index, id] of ['el_type_visual', 'el_cursor_visual', 'el_select_visual', 'el_drag_visual'].entries()) {
      imported.document.elements.push({ id, selectorHint: '', structuralFingerprint: `synthetic/reusable/${index}`,
        ...(index === 0 ? { editableText: 'Synthetic text' } : {}) });
      imported.document.presentation.html = imported.document.presentation.html.replace('</body>',
        `<div class="target" data-motion-id="${id}" style="top:${60 + index * 50}px"></div></body>`);
    }
    let state = createAuthoringState(imported.document);
    const sourceId = state.document.tracks[0]!.elementId;
    state = create(state, 'hold', { kind: 'hold', targetIds: [sourceId], enterMs: 1000, durationMs: 300, exitMs: 1300 });
    state = create(state, 'type', { kind: 'type', targetId: 'el_type_visual', startMs: 100, completeMs: 600, stepCount: 5 });
    state = create(state, 'select', { kind: 'select', cursorTargetId: 'el_cursor_visual', selectedTargetId: 'el_select_visual',
      approachMs: 100, chooseMs: 300, settleMs: 500 });
    state = create(state, 'drag', { kind: 'drag', cursorTargetId: 'el_cursor_visual', draggedTargetId: 'el_drag_visual',
      approachMs: 0, pressMs: 100, moveStartMs: 200, arriveMs: 600, releaseMs: 700,
      grabOffsetXPpm: 10_000, grabOffsetYPpm: -20_000,
      waypoints: [{ timeMs: 200, xPpm: 100_000, yPpm: 200_000 }, { timeMs: 600, xPpm: 600_000, yPpm: 500_000 }] });
    const runs = [compileMotionDocument(state.document), compileMotionDocument(state.document), compileMotionDocument(state.document)];
    expect(new Set(runs.map((run) => run.exportDigest))).toHaveLength(1);

    const browser = await chromium.launch({ channel: 'chrome', headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 640, height: 360 } }); const requests: string[] = [];
      page.on('request', (request) => requests.push(request.url())); await page.setContent(runs[0]!.html);
      const times = [...new Set([100, 200, 300, 400, 500, 600].flatMap((time) => [time - 1, time, time + 1])
        .concat([0, 100, 200, 600, 700, 1000, 1300].flatMap((time) => [Math.max(0, time - 1), time, time + 1])))].sort((a, b) => a - b);
      const frames = await page.evaluate(async (sampleTimes) => {
        const result = [];
        for (const timeMs of sampleTimes) {
          const animations = document.getAnimations(); animations.forEach((animation) => { animation.pause(); animation.currentTime = timeMs; });
          await new Promise(requestAnimationFrame);
          result.push({ timeMs, native: animations.every((animation) => animation.constructor.name === 'CSSAnimation'),
            typeClip: getComputedStyle(document.querySelector('[data-motion-id="el_type_visual"]')!).clipPath,
            typeWidth: getComputedStyle(document.querySelector('[data-motion-id="el_type_visual"]')!).width,
            shadow: getComputedStyle(document.querySelector('[data-motion-id="el_select_visual"]')!).boxShadow,
            drag: getComputedStyle(document.querySelector('[data-motion-id="el_drag_visual"]')!).transform,
            holdOpacity: getComputedStyle(document.querySelector(`[data-motion-id="${document.querySelector('.source')!.getAttribute('data-motion-id')}"]`)!).opacity });
        }
        return result;
      }, times);
      const rasterRuns: string[][] = [];
      for (let run = 0; run < 2; run += 1) { const hashes: string[] = [];
        for (const timeMs of times) { await page.evaluate((sampleTime) => document.getAnimations().forEach((animation) => {
          animation.pause(); animation.currentTime = sampleTime;
        }), timeMs); await page.evaluate(() => new Promise(requestAnimationFrame));
        hashes.push(createHash('sha256').update(await page.screenshot()).digest('hex')); }
        rasterRuns.push(hashes);
      }
      expect(frames.every((frame) => frame.native)).toBe(true);
      expect(rasterRuns[1]).toEqual(rasterRuns[0]);
      expect(new Set(rasterRuns[0]).size).toBeGreaterThan(6);
      expect(new Set(frames.map((frame) => frame.typeClip)).size).toBeGreaterThan(2);
      expect(frames.find((frame) => frame.timeMs === 600)!.typeWidth).toBe('80px');
      expect(new Set(frames.map((frame) => frame.shadow)).size).toBeGreaterThan(2);
      expect(new Set(frames.map((frame) => frame.drag)).size).toBeGreaterThan(2);
      expect(frames.find((frame) => frame.timeMs === 1000)!.holdOpacity)
        .toBe(frames.find((frame) => frame.timeMs === 1299)!.holdOpacity);
      const at = (timeMs: number) => frames.find((frame) => frame.timeMs === timeMs)!;
      const clipPercent = (timeMs: number) => Number(at(timeMs).typeClip.match(/([\d.]+)%/)?.[1]);
      for (const [index, boundary] of [200, 300, 400, 500, 600].entries()) {
        const before = 100 - index * 20; const after = before - 20;
        expect(clipPercent(boundary - 1)).toBe(before);
        expect([before, after]).toContain(clipPercent(boundary));
        expect(clipPercent(boundary + 1)).toBe(after);
      }
      expect(at(299).shadow).not.toBe(at(301).shadow);
      expect(at(499).shadow).not.toBe(at(500).shadow); expect(at(500).shadow).toBe(at(501).shadow);
      expect(at(99).drag).toBe(at(100).drag); expect(at(100).drag).toBe(at(101).drag);
      expect(at(199).drag).toBe(at(200).drag); expect(at(200).drag).not.toBe(at(201).drag);
      expect(at(599).drag).not.toBe(at(600).drag); expect(at(600).drag).toBe(at(601).drag);
      expect(at(699).drag).toBe(at(700).drag); expect(at(700).drag).toBe(at(701).drag);
      expect(at(999).holdOpacity).not.toBe(at(1000).holdOpacity);
      expect(at(1000).holdOpacity).toBe(at(1001).holdOpacity); expect(at(1299).holdOpacity).toBe(at(1300).holdOpacity);
      expect(at(1300).holdOpacity).not.toBe(at(1301).holdOpacity);
      const geometry = await page.evaluate(() => { const animations = document.getAnimations();
        animations.forEach((animation) => { animation.pause(); animation.currentTime = 600; });
        const cursor = document.querySelector<HTMLElement>('[data-motion-id="el_cursor_visual"]')!.getBoundingClientRect();
        const dragged = document.querySelector<HTMLElement>('[data-motion-id="el_drag_visual"]')!.getBoundingClientRect();
        return { dx: cursor.left - dragged.left, dy: cursor.top - dragged.top };
      });
      expect(geometry.dx).toBeCloseTo(6.4, 1); expect(geometry.dy).toBeCloseTo(-7.2, 1);
      expect(requests).toEqual([]);
      const receipt = { schemaVersion: 'motion.phase4-reusable-visual-proof.v1', exportDigest: runs[0]!.exportDigest,
        boundarySampleCount: times.length, repeatedRunCount: rasterRuns.length,
        expectedBoundaryAssertionCount: 30,
        rasterAggregateDigest: createHash('sha256').update(JSON.stringify(rasterRuns[0])).digest('hex'),
        distinctRasterCount: new Set(rasterRuns[0]).size, maximumRepeatedPixelDiff: 0,
        dragGripDeltaCssPixels: geometry, unexpectedRequestCount: requests.length };
      const receiptDirectory = resolve(import.meta.dirname, '../../../.motion/receipts'); await mkdir(receiptDirectory, { recursive: true });
      await writeFile(resolve(receiptDirectory, 'phase4-reusable-visual-proof.json'), `${JSON.stringify(receipt)}\n`);
    } finally { await browser.close(); }
  }, 60_000);
});
