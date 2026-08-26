import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium } from '@playwright/test';
import { PNG } from 'pngjs';
import { expect, test } from 'vitest';

import { compileMotionDocument } from '../../css-compiler/src/index.js';
import {
  canonicalContentBytes,
  createAuthoringState,
  dispatchAuthoringOperation,
  projectTrajectorySelection,
  projectTransformTrajectory,
  sha256Hex,
  type AuthoringOperation,
  type AuthoringState,
  type MotionDocument,
  type TimingFunction,
} from '../../domain/src/index.js';
import { compareRgba, deriveSamplePlan } from './index.js';

const runtimeDirectory = resolve('.motion/private/landing-shot1-canonical-editing');
const canonicalPath = resolve(runtimeDirectory, 'canonical-document.json');
const admittedPackagePath = resolve('.motion/private/shot1-purpose-built-v1/admission-package.json');
const importReceiptPath = resolve('.motion/receipts/t002-private.json');
const visualReceiptPath = resolve('.motion/receipts/landing-shot1-private-visual.json');
const viewport = { width: 1440, height: 900 };
const stage = {
  stageDigest: 'b'.repeat(64),
  widthMicrounits: 1_000_000_000,
  heightMicrounits: 1_000_000_000,
};

test('authenticated real seed completes aggregate-only five-operation visual proof', async () => {
  const admission = JSON.parse(await readFile(importReceiptPath, 'utf8')) as {
    passed: boolean;
    admission: { authenticated: boolean; integrityValid: boolean; diagnosticCodes: string[] };
    import: { diagnosticCodes: string[] };
    privacy: { aggregateOnly: boolean; liveValueCount: number };
  };
  expect(admission).toMatchObject({
    passed: true,
    admission: { authenticated: true, integrityValid: true, diagnosticCodes: [] },
    import: { diagnosticCodes: [] },
    privacy: { aggregateOnly: true, liveValueCount: 0 },
  });

  const base = JSON.parse(await readFile(canonicalPath, 'utf8')) as MotionDocument;
  const admittedPackage = JSON.parse(await readFile(admittedPackagePath, 'utf8')) as {
    candidatePackage: { replayPackage: { html: string; css: string } };
  };
  const replay = admittedPackage.candidatePackage.replayPackage;
  const admittedBaselineHtml = replay.html.includes('</head>')
    ? replay.html.replace('</head>', `<style>${replay.css}</style></head>`)
    : `<style>${replay.css}</style>${replay.html}`;
  const ids = base.elements.map((element) => element.id).sort();
  expect(ids).toHaveLength(2);
  let state = createAuthoringState(base);
  const states = new Map<string, AuthoringState>([['baseline', state]]);
  const operationKinds: AuthoringOperation['kind'][] = [];
  const envelope = <K extends AuthoringOperation['kind']>(kind: K, operationId: string) => ({
    schemaVersion: 'motion.operation.v1' as const,
    kind,
    operationId,
    documentId: base.documentId,
    expectedRevision: state.document.revision,
  });
  const apply = (operation: AuthoringOperation): void => {
    const result = dispatchAuthoringOperation(state, operation);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostic.code);
    operationKinds.push(operation.kind);
    state = result.state;
  };

  let selected = projectTrajectorySelection(state.document, [ids[0]!], 700);
  expect(selected.eligible).toBe(true);
  if (!selected.eligible) throw new Error(selected.code ?? 'TRAJECTORY_SELECTION_INVALID');
  const trajectory = projectTransformTrajectory(state.document, ids[0]!);
  expect(trajectory.eligible).toBe(true);
  if (!trajectory.eligible) throw new Error(trajectory.code);
  const landed = trajectory.waypoints.find((point) => point.timeMs === 700);
  expect(landed).toBeTruthy();
  const editedScalePpm = landed!.pose.scalePpm <= 2_999_000 ? landed!.pose.scalePpm + 1_000 : landed!.pose.scalePpm - 1_000;
  const editedRotateMicrodegrees = landed!.pose.rotateMicrodegrees <= 179_000_000
    ? landed!.pose.rotateMicrodegrees + 1_000_000 : landed!.pose.rotateMicrodegrees - 1_000_000;
  const poseCoverage = { scale: editedScalePpm !== landed!.pose.scalePpm,
    rotation: editedRotateMicrodegrees !== landed!.pose.rotateMicrodegrees };
  expect(Object.values(poseCoverage).every(Boolean)).toBe(true);
  apply({
    ...envelope('motion.transform-pose.set', 'aggregate:pose'),
    ...selected.targets[0]!,
    payload: { pose: { ...landed!.pose, scalePpm: editedScalePpm, rotateMicrodegrees: editedRotateMicrodegrees }, stage },
  });

  selected = projectTrajectorySelection(state.document, ids, 700);
  expect(selected.eligible).toBe(true);
  if (!selected.eligible) throw new Error(selected.code ?? 'TRAJECTORY_SELECTION_INVALID');
  apply({
    ...envelope('motion.transform-waypoints.translate', 'aggregate:trajectory'),
    payload: { targets: selected.targets, deltaXPpm: 100, deltaYPpm: -100, stage },
  });

  selected = projectTrajectorySelection(state.document, ids, 700);
  expect(selected.eligible).toBe(true);
  if (!selected.eligible) throw new Error(selected.code ?? 'TRAJECTORY_SELECTION_INVALID');
  apply({
    ...envelope('motion.keyframe-group-time.set', 'aggregate:timing'),
    payload: { targets: selected.targets, sourceTimeMs: 700, targetTimeMs: 840, landingTimeMs: 840, settledTimeMs: 2100 },
  });

  selected = projectTrajectorySelection(state.document, ids, 840);
  expect(selected.eligible).toBe(true);
  if (!selected.eligible) throw new Error(selected.code ?? 'TRAJECTORY_SELECTION_INVALID');
  const effectiveTimings = selected.targets.map((target): TimingFunction | null => {
    const track = state.document.tracks.find((item) => item.id === target.trackId
      && item.elementId === target.elementId && item.property === 'transform');
    const rule = track && state.document.rules.find((item) => item.id === track.ruleId);
    const ruleTrack = rule?.tracks.find((item) => item.property === 'transform');
    const keyframe = ruleTrack?.keyframes.find((item) => item.id === target.keyframeId
      && item.value === target.expectedTransform);
    const application = track && state.document.applications.find((item) =>
      item.slots.some((slot) => slot.id === track.slotId));
    const slot = application?.slots.find((item) => item.id === track?.slotId);
    return track && ruleTrack && keyframe && application && slot
      ? keyframe.easing ?? slot.timingFunction : null;
  });
  expect(effectiveTimings.every((timing) => timing !== null)).toBe(true);
  const expectedEasing = effectiveTimings[0]!;
  expect(effectiveTimings.every((timing) =>
    JSON.stringify(timing) === JSON.stringify(expectedEasing))).toBe(true);
  apply({
    ...envelope('motion.keyframe-group-easing.set', 'aggregate:easing'),
    payload: { targets: selected.targets, expectedEasing, easing: { kind: 'keyword', value: 'ease-in-out' } },
  });

  selected = projectTrajectorySelection(state.document, ids, 2100);
  expect(selected.eligible).toBe(true);
  if (!selected.eligible) throw new Error(selected.code ?? 'TRAJECTORY_SELECTION_INVALID');
  apply({
    ...envelope('motion.settled-hold.set', 'aggregate:hold'),
    payload: { targets: selected.targets, sourceTimeMs: 2100, settledTimeMs: 1820, landingTimeMs: 840, boundaryTimeMs: 2100 },
  });
  expect(operationKinds).toEqual([
    'motion.transform-pose.set',
    'motion.transform-waypoints.translate',
    'motion.keyframe-group-time.set',
    'motion.keyframe-group-easing.set',
    'motion.settled-hold.set',
  ]);
  const edited = state;
  states.set('edited', edited);

  for (let index = 0; index < 5; index += 1) {
    const result = dispatchAuthoringOperation(state, {
      ...envelope('motion.history.undo', `aggregate:undo:${index}`),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostic.code);
    state = result.state;
  }
  states.set('undone', state);
  for (let index = 0; index < 5; index += 1) {
    const result = dispatchAuthoringOperation(state, {
      ...envelope('motion.history.redo', `aggregate:redo:${index}`),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.diagnostic.code);
    state = result.state;
  }
  states.set('redone', state);
  expect(canonicalContentBytes(states.get('undone')!.document)).toEqual(canonicalContentBytes(base));
  expect(canonicalContentBytes(states.get('redone')!.document))
    .toEqual(canonicalContentBytes(edited.document));

  const compiled = Object.fromEntries([...states].map(([label, snapshot]) =>
    [label, compileMotionDocument(snapshot.document)]));
  expectCompiledPair(compiled.baseline!, compiled.undone!);
  expectCompiledPair(compiled.edited!, compiled.redone!);
  const repeatedExports = [0, 1, 2].map(() => compileMotionDocument(edited.document));
  expect(repeatedExports.every((run) => run.html === repeatedExports[0]!.html
    && run.css === repeatedExports[0]!.css
    && run.exportDigest === repeatedExports[0]!.exportDigest)).toBe(true);

  const baselinePlan = deriveSamplePlan(base, [0, 700, 2100]);
  const editedPlan = deriveSamplePlan(edited.document, [0, 700, 840, 1820, 2100]);
  const samples = [...new Set([
    ...baselinePlan.sampleTimesMs,
    ...editedPlan.sampleTimesMs,
    0, 700, 2100, 2101,
  ])].sort((left, right) => left - right);
  const browser = await chromium.launch({ headless: true, args: ['--disable-threaded-animation'] });
  try {
    const sourceBaseline = await capture(browser, admittedBaselineHtml, samples, 'no-preference');
    const baseline = await capture(browser, compiled.baseline!.html, samples, 'no-preference');
    const reducedSourceBaseline = await capture(browser, admittedBaselineHtml, samples, 'reduce');
    const reducedBaseline = await capture(browser, compiled.baseline!.html, samples, 'reduce');
    const editedCapture = await capture(browser, compiled.edited!.html, samples);
    const undone = await capture(browser, compiled.undone!.html, samples);
    const redone = await capture(browser, compiled.redone!.html, samples);
    const captures = [sourceBaseline, baseline, reducedSourceBaseline, reducedBaseline,
      editedCapture, undone, redone];
    expect(captures.every((item) => item.liveRequestCount === 0
      && item.allNative && item.allTimesExact)).toBe(true);
    const normalComparison = compareCaptures(sourceBaseline, baseline);
    const reducedComparison = compareCaptures(reducedSourceBaseline, reducedBaseline);
    expect(normalComparison).toMatchObject({ changedPixels: 0, maximumChannelDelta: 0 });
    expect(reducedComparison).toMatchObject({ changedPixels: 0, maximumChannelDelta: 0 });
    expect(undone.hashes).toEqual(baseline.hashes);
    expect(redone.hashes).toEqual(editedCapture.hashes);
    const endpointIndex = samples.indexOf(2100);
    const postRangeIndex = samples.indexOf(2101);
    expect(endpointIndex).toBeGreaterThanOrEqual(0);
    expect(postRangeIndex).toBeGreaterThanOrEqual(0);
    expect(editedCapture.hashes[endpointIndex]).toBe(editedCapture.hashes[postRangeIndex]);
    const containment = compareMaskedCaptures(baseline, editedCapture);
    expect(containment.outsideChangedPixels).toBe(0);
    const receipt = {
      schemaVersion: 'motion.landing-shot1-private-visual.v1',
      passed: true,
      authority: { authenticated: true, aggregateOnly: true },
      counts: {
        operationCount: operationKinds.length,
        targetCount: ids.length,
        sampleCount: samples.length,
        baselineBoundaryCount: baselinePlan.boundaries.length,
        editedBoundaryCount: editedPlan.boundaries.length,
        comparisonCount: normalComparison.comparisonCount + reducedComparison.comparisonCount,
        liveRequestCount: captures.reduce((sum, item) => sum + item.liveRequestCount, 0),
      },
      timings: {
        requiredMs: [0, 700, 2100],
        sampledMs: samples,
        postRangeEndpointMs: 2101,
      },
      flags: {
        importedBaselineMatchesCompiled: normalComparison.changedPixels === 0
          && reducedComparison.changedPixels === 0,
        allBoundarySidesSampled: true,
        endpointHold: editedCapture.hashes[endpointIndex] === editedCapture.hashes[postRangeIndex],
        exactUndoRedo: true,
        compilerNative: true,
        tripleExportEqual: true,
        poseScaleChanged: poseCoverage.scale,
        poseRotationChanged: poseCoverage.rotation,
        screenshotsPersisted: false,
      },
      aggregateDiff: {
        changedPixels: normalComparison.changedPixels + reducedComparison.changedPixels,
        changedPixelRatio: Math.max(normalComparison.changedPixelRatio,
          reducedComparison.changedPixelRatio),
        maximumChannelDelta: Math.max(normalComparison.maximumChannelDelta,
          reducedComparison.maximumChannelDelta),
        outsideChangedPixels: containment.outsideChangedPixels,
      },
      digests: {
        original: sha256Hex(canonicalContentBytes(base)),
        edited: sha256Hex(canonicalContentBytes(edited.document)),
        export: repeatedExports[0]!.exportDigest,
        visualSequence: digest(Buffer.from(editedCapture.hashes.join('\0'))),
      },
      diagnostics: [],
    };
    await mkdir(resolve('.motion/receipts'), { recursive: true });
    await writeFile(visualReceiptPath, `${JSON.stringify(receipt)}\n`, { mode: 0o600 });
  } finally {
    await browser.close();
  }
}, 120_000);

type Capture = {
  frames: Array<{ bytes: Buffer; maskedBytes: Buffer }>;
  hashes: string[];
  liveRequestCount: number;
  allNative: boolean;
  allTimesExact: boolean;
};

function expectCompiledPair(
  first: ReturnType<typeof compileMotionDocument>,
  second: ReturnType<typeof compileMotionDocument>,
): void {
  expect(first.html).toBe(second.html);
  expect(first.css).toBe(second.css);
  expect(first.exportDigest).toBe(second.exportDigest);
}

async function capture(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  html: string,
  samples: number[],
  reducedMotion: 'no-preference' | 'reduce' = 'no-preference',
): Promise<Capture> {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 1,
    reducedMotion,
    serviceWorkers: 'block',
  });
  let liveRequestCount = 0;
  await context.route('**/*', async (route) => {
    if (/^https?:/i.test(route.request().url())) liveRequestCount += 1;
    await route.abort('blockedbyclient');
  });
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
    });
    const frames: Capture['frames'] = [];
    const hashes: string[] = [];
    let allNative = true;
    let allTimesExact = true;
    for (const time of samples) {
      const state = await page.evaluate(async (sample) => {
        const animations = document.getAnimations();
        for (const animation of animations) {
          animation.pause();
          animation.currentTime = sample;
        }
        await Promise.all(animations.map((animation) => animation.ready.catch(() => animation)));
        await new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
        return {
          native: animations.length > 0 && animations.every((animation) =>
            animation.constructor.name === 'CSSAnimation'
            && animation.effect?.constructor.name === 'KeyframeEffect'
            && animation.timeline?.constructor.name === 'DocumentTimeline'),
          exact: animations.every((animation) => animation.currentTime === sample),
        };
      }, time);
      const bytes = await page.screenshot({ animations: 'allow', caret: 'hide', type: 'png', scale: 'css' });
      const mask = await page.addStyleTag({ content: '[data-motion-id] { visibility: hidden !important; }' });
      const maskedBytes = await page.screenshot({ animations: 'allow', caret: 'hide', type: 'png', scale: 'css' });
      await mask.evaluate((element) => { void element.parentNode?.removeChild(element); });
      frames.push({ bytes, maskedBytes });
      hashes.push(digest(bytes));
      allNative &&= state.native;
      allTimesExact &&= state.exact;
    }
    return { frames, hashes, liveRequestCount, allNative, allTimesExact };
  } finally {
    await context.close();
  }
}

function compareCaptures(first: Capture, second: Capture) {
  let changedPixels = 0;
  let pixelCount = 0;
  let maximumChannelDelta = 0;
  for (const [index, firstFrame] of first.frames.entries()) {
    const firstPng = PNG.sync.read(firstFrame.bytes);
    const secondPng = PNG.sync.read(second.frames[index]!.bytes);
    const comparison = compareRgba(firstPng.data, secondPng.data, firstPng.width, firstPng.height);
    changedPixels += comparison.changedPixels;
    maximumChannelDelta = Math.max(maximumChannelDelta, comparison.maximumChannelDelta);
    pixelCount += firstPng.width * firstPng.height;
  }
  return {
    comparisonCount: first.frames.length,
    changedPixels,
    changedPixelRatio: pixelCount === 0 ? 0 : changedPixels / pixelCount,
    maximumChannelDelta,
  };
}

function compareMaskedCaptures(first: Capture, second: Capture) {
  let outsideChangedPixels = 0;
  for (const [index, firstFrame] of first.frames.entries()) {
    const firstPng = PNG.sync.read(firstFrame.maskedBytes);
    const secondPng = PNG.sync.read(second.frames[index]!.maskedBytes);
    outsideChangedPixels += compareRgba(
      firstPng.data,
      secondPng.data,
      firstPng.width,
      firstPng.height,
    ).changedPixels;
  }
  return { outsideChangedPixels };
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
