import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { chromium, type Browser } from '@playwright/test';
import { PNG } from 'pngjs';
import { describe, expect, test } from 'vitest';

import { compileMotionDocument } from '../../css-compiler/src/index.js';
import { importMotionHtml } from '../../css-import/src/index.js';
import { canonicalContentBytes, createAuthoringState, dispatchAuthoringOperation, projectTrajectorySelection,
  projectTransformTrajectory, sha256Hex, type AuthoringOperation, type AuthoringState, type MotionDocument } from '../../domain/src/index.js';

const receiptPath = resolve('.motion/receipts/trajectory-authoring.json');
const samples = [0, 699, 700, 701, 839, 840, 841, 1819, 1820, 1821, 2099, 2100, 2101, 2800];
const stage = { stageDigest: 'a'.repeat(64), widthMicrounits: 800_000_000, heightMicrounits: 450_000_000 };

describe('deterministic Shot 1 trajectory authoring proof', () => {
  test('proves direct/numeric convergence, grouped containment, timing boundaries, and exact history', async () => {
    const source = await readFile(new URL('../../../fixtures/public-synthetic/landing-shot1.html', import.meta.url), 'utf8');
    const imported = importMotionHtml(source); expect(imported.diagnostics).toEqual([]); if (!imported.document) throw new Error('TRAJECTORY_IMPORT_FAILED');
    const base = imported.document; const ids = base.elements.map((element) => element.id).sort();
    const initialLaterTimes = laterTimes(base); let state = createAuthoringState(base); const states = new Map<string, AuthoringState>([['S0', state]]);
    const dispatch = (operation: AuthoringOperation) => { const result = dispatchAuthoringOperation(state, operation); expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.diagnostic.code); state = result.state; return state; };
    const envelope = <K extends AuthoringOperation['kind']>(kind: K, operationId: string) => ({ schemaVersion: 'motion.operation.v1' as const,
      kind, operationId, documentId: base.documentId, expectedRevision: state.document.revision });
    const primary = projectTrajectorySelection(base, [ids[0]!], 700); if (!primary.eligible) throw new Error(primary.code ?? 'TRAJECTORY_SELECTION_INVALID');
    const trajectory = projectTransformTrajectory(base, ids[0]!); if (!trajectory.eligible) throw new Error(trajectory.code);
    const landed = trajectory.waypoints.find((point) => point.timeMs === 700)!;
    dispatch({ ...envelope('motion.transform-pose.set', 'visual:pose'), ...primary.targets[0]!, payload: { pose: {
      ...landed.pose, translateXMicrounits: landed.pose.translateXMicrounits + 8_000_000 }, stage } }); states.set('S1', state);
    const numeric = dispatchAuthoringOperation(createAuthoringState(base), { schemaVersion: 'motion.operation.v1',
      kind: 'motion.transform-waypoints.translate', operationId: 'visual:numeric', documentId: base.documentId, expectedRevision: 0,
      payload: { targets: primary.targets, deltaXPpm: 10_000, deltaYPpm: 0, stage } });
    expect(numeric.ok).toBe(true); if (!numeric.ok) throw new Error(numeric.diagnostic.code); states.set('S2', numeric.state);
    expect(canonicalContentBytes(numeric.state.document)).toEqual(canonicalContentBytes(state.document));
    let group = projectTrajectorySelection(state.document, ids, 700); if (!group.eligible) throw new Error(group.code ?? 'TRAJECTORY_SELECTION_INVALID');
    dispatch({ ...envelope('motion.transform-waypoints.translate', 'visual:group'), payload: { targets: group.targets,
      deltaXPpm: 10_000, deltaYPpm: -10_000, stage } }); states.set('S3', state);
    group = projectTrajectorySelection(state.document, ids, 700); if (!group.eligible) throw new Error(group.code ?? 'TRAJECTORY_SELECTION_INVALID');
    dispatch({ ...envelope('motion.keyframe-group-time.set', 'visual:time'), payload: { targets: group.targets,
      sourceTimeMs: 700, targetTimeMs: 840, landingTimeMs: 840, settledTimeMs: 2100 } });
    group = projectTrajectorySelection(state.document, ids, 840); if (!group.eligible) throw new Error(group.code ?? 'TRAJECTORY_SELECTION_INVALID');
    dispatch({ ...envelope('motion.keyframe-group-easing.set', 'visual:easing'), payload: { targets: group.targets,
      expectedEasing: { kind: 'keyword', value: 'ease-out' }, easing: { kind: 'keyword', value: 'ease-in-out' } } }); states.set('S4', state);
    group = projectTrajectorySelection(state.document, ids, 2100); if (!group.eligible) throw new Error(group.code ?? 'TRAJECTORY_SELECTION_INVALID');
    dispatch({ ...envelope('motion.settled-hold.set', 'visual:hold'), payload: { targets: group.targets,
      sourceTimeMs: 2100, settledTimeMs: 1820, landingTimeMs: 840, boundaryTimeMs: 2100 } }); states.set('S5', state);
    expect(laterTimes(state.document)).toEqual(initialLaterTimes);
    for (let index = 0; index < 5; index += 1) dispatch({ ...envelope('motion.history.undo', `visual:undo:${index}`) }); states.set('U', state);
    for (let index = 0; index < 5; index += 1) dispatch({ ...envelope('motion.history.redo', `visual:redo:${index}`) }); states.set('R', state);
    expect(canonicalContentBytes(states.get('U')!.document)).toEqual(canonicalContentBytes(states.get('S0')!.document));
    expect(canonicalContentBytes(states.get('R')!.document)).toEqual(canonicalContentBytes(states.get('S5')!.document));

    const compiles = new Map([...states].map(([label, snapshot]) => [label, compileMotionDocument(snapshot.document)]));
    for (const [label, snapshot] of states) { const compiled = compiles.get(label)!;
      expect([0, 1, 2].map(() => compileMotionDocument(snapshot.document))
        .every((run) => run.html === compiled.html && run.css === compiled.css && run.exportDigest === compiled.exportDigest)).toBe(true); }
    const browser = await chromium.launch({ headless: true, args: ['--disable-threaded-animation'] });
    try {
      const captures = new Map<string, Capture>();
      for (const [label, compiled] of compiles) captures.set(label, await capture(browser, compiled.html));
      captures.set('EXPORT', await capture(browser, compiles.get('S5')!.html));
      expect(frameHashes(captures.get('S1')!)).toEqual(frameHashes(captures.get('S2')!));
      expect(frameHashes(captures.get('U')!)).toEqual(frameHashes(captures.get('S0')!));
      expect(frameHashes(captures.get('R')!)).toEqual(frameHashes(captures.get('S5')!));
      expect(frameHashes(captures.get('EXPORT')!)).toEqual(frameHashes(captures.get('S5')!));
      const containment = containedChanges(captures.get('S0')!, captures.get('S5')!); expect(containment.outsideChangedPixels).toBe(0);
      expect([...captures.values()].every((value) => value.liveRequests === 0 && value.allNative && value.allTimesExact)).toBe(true);
      const receipt = { schemaVersion: 'motion.landing-shot1-editing-receipt.v1', passed: true,
        operationKinds: ['motion.transform-pose.set', 'motion.transform-waypoints.translate', 'motion.keyframe-group-time.set', 'motion.keyframe-group-easing.set', 'motion.settled-hold.set'],
        stateDigests: Object.fromEntries([...states].map(([label, snapshot]) => [label, sha256Hex(canonicalContentBytes(snapshot.document))])),
        exportDigests: Object.fromEntries([...compiles].map(([label, compiled]) => [label, compiled.exportDigest])),
        sampleTimesMs: samples, directNumericEqual: true, groupedAtomic: true, exactUndoRedo: true,
        laterKeyframeTimesUnchanged: true, previewExportEqual: true, tripleExportEqual: true,
        containment, network: { liveRequestCount: 0 }, nativeAnimation: { allCssAnimation: true, allCurrentTimesExact: true } };
      await mkdir(dirname(receiptPath), { recursive: true });
      await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    } finally { await browser.close(); }
  }, 120_000);
});

type Frame = { bytes: Buffer; hash: string; boxes: Array<{ x: number; y: number; width: number; height: number }> };
type Capture = { frames: Frame[]; liveRequests: number; allNative: boolean; allTimesExact: boolean };
async function capture(browser: Browser, html: string): Promise<Capture> {
  const context = await browser.newContext({ viewport: { width: 800, height: 450 }, deviceScaleFactor: 1, reducedMotion: 'no-preference', serviceWorkers: 'block' });
  let liveRequests = 0; await context.route('**/*', async (route) => { if (/^https?:/i.test(route.request().url())) liveRequests += 1; await route.abort('blockedbyclient'); });
  try { const page = await context.newPage(); await page.setContent(html, { waitUntil: 'load' }); const frames: Frame[] = []; let allNative = true; let allTimesExact = true;
    for (const time of samples) { const state = await page.evaluate(async (sample) => { const animations = document.getAnimations();
      for (const animation of animations) { animation.pause(); animation.currentTime = sample; } await Promise.all(animations.map((animation) => animation.ready.catch(() => animation)));
      await new Promise<void>((resolveFrame) => requestAnimationFrame(() => requestAnimationFrame(() => resolveFrame())));
      return { native: animations.length > 0 && animations.every((animation) => animation.constructor.name === 'CSSAnimation'),
        exact: animations.every((animation) => animation.currentTime === sample), boxes: [...document.querySelectorAll<HTMLElement>('[data-motion-id]')].map((element) => { const rect = element.getBoundingClientRect(); return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }; }) }; }, time);
      const bytes = await page.screenshot({ animations: 'allow', caret: 'hide', scale: 'css', type: 'png' });
      frames.push({ bytes, hash: createHash('sha256').update(bytes).digest('hex'), boxes: state.boxes }); allNative &&= state.native; allTimesExact &&= state.exact; }
    return { frames, liveRequests, allNative, allTimesExact };
  } finally { await context.close(); }
}
function frameHashes(value: Capture): string[] { return value.frames.map((frame) => frame.hash); }
function laterTimes(document: MotionDocument): number[] {
  return document.rules.flatMap((rule) => rule.tracks).flatMap((track) => track.keyframes).map((frame) => Math.round(frame.offset * 7000)).filter((time) => time > 2100).sort((a, b) => a - b);
}
function containedChanges(baseline: Capture, candidate: Capture) {
  let outsideChangedPixels = 0; let changedPixels = 0;
  for (const [index, before] of baseline.frames.entries()) { const after = candidate.frames[index]!; const a = PNG.sync.read(before.bytes); const b = PNG.sync.read(after.bytes);
    const boxes = [...before.boxes, ...after.boxes]; for (let y = 0; y < a.height; y += 1) for (let x = 0; x < a.width; x += 1) { const offset = (y * a.width + x) * 4;
      if (a.data[offset] === b.data[offset] && a.data[offset + 1] === b.data[offset + 1] && a.data[offset + 2] === b.data[offset + 2] && a.data[offset + 3] === b.data[offset + 3]) continue;
      changedPixels += 1; if (!boxes.some((box) => x >= Math.floor(box.x) - 2 && x <= Math.ceil(box.x + box.width) + 2 && y >= Math.floor(box.y) - 2 && y <= Math.ceil(box.y + box.height) + 2)) outsideChangedPixels += 1; } }
  return { changedPixels, outsideChangedPixels, marginPx: 2 };
}
