import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { chromium, type Browser, type Page } from '@playwright/test';
import { PNG } from 'pngjs';

import {
  applicationInstanceId, deriveMotionEvidenceBoundaries, normalizeAnimationInstance,
  type MotionDocument,
} from '../../domain/src/index.js';

export type SamplePlan = {
  durationMs: number;
  stableTimesMs: number[];
  boundaries: Array<{ timeMs: number; reasons: string[] }>;
  sampleTimesMs: number[];
  endpointHandling: Array<{
    boundaryTimeMs: number;
    before: { status: 'sampled'; timeMs: number } | { status: 'out-of-range' };
    after: { status: 'sampled'; timeMs: number } | { status: 'out-of-range' };
  }>;
};

export function deriveSamplePlan(document: MotionDocument, stableTimesMs: number[]): SamplePlan {
  if (stableTimesMs.some((time) => !Number.isFinite(time) || time < 0 || time > document.durationMs)) {
    throw new Error('VISUAL_STABLE_TIME_INVALID');
  }
  const boundaryReasons = new Map<number, Set<string>>();
  const ruleById = new Map(document.rules.map((rule) => [rule.id, rule]));
  for (const application of document.applications) {
    for (const binding of application.bindings) {
      for (const [slotIndex, slot] of application.slots.entries()) {
        const delayMs = binding.delayOverridesMs[slotIndex];
        const rule = ruleById.get(slot.ruleId);
        if (delayMs === undefined || !rule) throw new Error('VISUAL_SAMPLE_RELATIONSHIP_INVALID');
        const offsets = [...new Set(rule.tracks.flatMap((track) => track.keyframes.map((keyframe) => keyframe.offset)))].sort((a, b) => a - b);
        const instance = normalizeAnimationInstance({
          applicationId: applicationInstanceId(binding.elementId, slot.ruleId, slot.id),
          targetId: binding.elementId, ruleId: slot.ruleId, timeline: 'document', composition: 'replace',
          durationMs: slot.durationMs, delayMs, iterations: slot.iterationCount, direction: slot.direction,
          fill: slot.fillMode, playState: slot.playState, easing: slot.timingFunction,
          properties: rule.tracks.map((track) => track.property),
          keyframes: offsets.map((offset) => ({
            offset,
            easing: rule.tracks.flatMap((track) => track.keyframes).find((frame) => frame.offset === offset)?.easing ?? slot.timingFunction,
            properties: rule.tracks.filter((track) => track.keyframes.some((frame) => frame.offset === offset)).map((track) => track.property),
            values: Object.fromEntries(rule.tracks.flatMap((track) => {
              const keyframe = track.keyframes.find((frame) => frame.offset === offset);
              return keyframe ? [[track.property, keyframe.value]] : [];
            })),
          })),
        });
        for (const boundary of deriveMotionEvidenceBoundaries([instance], document.durationMs)) {
          boundary.reasons.forEach((reason) => addBoundary(boundaryReasons, boundary.timeMs, reason, document.durationMs));
        }
      }
    }
  }
  const boundaries = [...boundaryReasons.entries()]
    .sort(([first], [second]) => first - second)
    .map(([timeMs, reasons]) => ({ timeMs, reasons: [...reasons].sort() }));
  const endpointHandling = boundaries.map(({ timeMs }) => ({
    boundaryTimeMs: timeMs,
    before: timeMs - 1 < 0
      ? { status: 'out-of-range' as const }
      : { status: 'sampled' as const, timeMs: normalizeTime(timeMs - 1) },
    after: timeMs + 1 > document.durationMs
      ? { status: 'out-of-range' as const }
      : { status: 'sampled' as const, timeMs: normalizeTime(timeMs + 1) },
  }));
  const sampleTimes = new Set(stableTimesMs.map(normalizeTime));
  for (const endpoint of endpointHandling) {
    if (endpoint.before.status === 'sampled') sampleTimes.add(endpoint.before.timeMs);
    if (endpoint.after.status === 'sampled') sampleTimes.add(endpoint.after.timeMs);
  }
  return {
    durationMs: document.durationMs,
    stableTimesMs: [...new Set(stableTimesMs.map(normalizeTime))].sort((a, b) => a - b),
    boundaries,
    sampleTimesMs: [...sampleTimes].sort((a, b) => a - b),
    endpointHandling,
  };
}

export function compareRgba(
  baseline: Uint8Array,
  candidate: Uint8Array,
  width: number,
  height: number,
) {
  const expectedLength = width * height * 4;
  if (baseline.length !== expectedLength || candidate.length !== expectedLength) {
    throw new Error('VISUAL_DIMENSION_MISMATCH');
  }
  let changedPixels = 0;
  let maximumChannelDelta = 0;
  for (let offset = 0; offset < expectedLength; offset += 4) {
    let pixelChanged = false;
    for (let channel = 0; channel < 4; channel += 1) {
      const delta = Math.abs(baseline[offset + channel]! - candidate[offset + channel]!);
      if (delta > 0) pixelChanged = true;
      maximumChannelDelta = Math.max(maximumChannelDelta, delta);
    }
    if (pixelChanged) changedPixels += 1;
  }
  return {
    width,
    height,
    changedPixels,
    changedPixelRatio: changedPixels / (width * height),
    maximumChannelDelta,
  };
}

export function assessBaselineStability(replays: string[][]) {
  const sampleCount = replays[0]?.length ?? 0;
  const correspondingHashesEqual = replays.length === 3
    && replays.every((replay) => replay.length === sampleCount)
    && Array.from({ length: sampleCount }, (_, sampleIndex) =>
      replays.every((replay) => replay[sampleIndex] === replays[0]![sampleIndex])).every(Boolean);
  return { replayCount: replays.length, sampleCount, correspondingHashesEqual };
}

function addBoundary(
  boundaries: Map<number, Set<string>>,
  timeMs: number,
  reason: string,
  durationMs: number,
): void {
  const normalized = normalizeTime(timeMs);
  if (normalized < 0 || normalized > durationMs) return;
  const reasons = boundaries.get(normalized) ?? new Set<string>();
  reasons.add(reason);
  boundaries.set(normalized, reasons);
}

function normalizeTime(timeMs: number): number {
  return Math.round(timeMs * 1_000_000) / 1_000_000;
}

export type ControlledVisualProof = {
  passed: boolean;
  browserVersion: string;
  baselineStability: ReturnType<typeof assessBaselineStability>;
  network: { liveRequestCount: number; abortedUnexpectedRequestCount: number };
  readiness: Array<{
    domReady: boolean;
    fontsReady: boolean;
    stableLayoutConsecutiveCount: number;
    animationCount: number;
  }>;
  pixelComparison: {
    comparisonCount: number;
    changedPixels: number;
    changedPixelRatio: number;
    maximumChannelDelta: number;
  };
  baselineFrameHashes: string[][];
  compiledFrameHashes: string[];
};

export async function runControlledVisualProof(input: {
  baselineHtml: string;
  compiledHtml: string;
  samplePlan: SamplePlan;
  outputDirectory: string;
  viewport: { width: number; height: number };
}): Promise<ControlledVisualProof> {
  const outputDirectory = resolve(input.outputDirectory);
  await mkdir(outputDirectory, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const baselineRuns = [];
    for (let replay = 0; replay < 3; replay += 1) {
      baselineRuns.push(await captureReplay({
        browser,
        html: input.baselineHtml,
        sampleTimesMs: input.samplePlan.sampleTimesMs,
        outputDirectory,
        label: `baseline-${replay}`,
        viewport: input.viewport,
      }));
    }
    const compiledRun = await captureReplay({
      browser,
      html: input.compiledHtml,
      sampleTimesMs: input.samplePlan.sampleTimesMs,
      outputDirectory,
      label: 'compiled',
      viewport: input.viewport,
    });
    const baselineFrameHashes = baselineRuns.map((run) => run.frames.map((frame) => frame.hash));
    const baselineStability = assessBaselineStability(baselineFrameHashes);
    let changedPixels = 0;
    let maximumChannelDelta = 0;
    let pixelCount = 0;
    for (const [index, baselineFrame] of baselineRuns[0]!.frames.entries()) {
      const candidateFrame = compiledRun.frames[index]!;
      const baseline = PNG.sync.read(baselineFrame.bytes);
      const candidate = PNG.sync.read(candidateFrame.bytes);
      if (baseline.width !== candidate.width || baseline.height !== candidate.height) {
        throw new Error('VISUAL_DIMENSION_MISMATCH');
      }
      const comparison = compareRgba(
        baseline.data,
        candidate.data,
        baseline.width,
        baseline.height,
      );
      changedPixels += comparison.changedPixels;
      maximumChannelDelta = Math.max(maximumChannelDelta, comparison.maximumChannelDelta);
      pixelCount += baseline.width * baseline.height;
    }
    const runs = [...baselineRuns, compiledRun];
    const readiness = runs.map((run) => run.readiness);
    const network = runs.reduce((aggregate, run) => ({
      liveRequestCount: aggregate.liveRequestCount + run.network.liveRequestCount,
      abortedUnexpectedRequestCount:
        aggregate.abortedUnexpectedRequestCount + run.network.abortedUnexpectedRequestCount,
    }), { liveRequestCount: 0, abortedUnexpectedRequestCount: 0 });
    const pixelComparison = {
      comparisonCount: input.samplePlan.sampleTimesMs.length,
      changedPixels,
      changedPixelRatio: pixelCount === 0 ? 0 : changedPixels / pixelCount,
      maximumChannelDelta,
    };
    const passed = baselineStability.correspondingHashesEqual
      && network.liveRequestCount === 0
      && network.abortedUnexpectedRequestCount === 0
      && readiness.every((receipt) => receipt.domReady
        && receipt.fontsReady && receipt.stableLayoutConsecutiveCount >= 3)
      && changedPixels === 0
      && pixelComparison.changedPixelRatio === 0
      && maximumChannelDelta === 0;
    return {
      passed,
      browserVersion: browser.version(),
      baselineStability,
      network,
      readiness,
      pixelComparison,
      baselineFrameHashes,
      compiledFrameHashes: compiledRun.frames.map((frame) => frame.hash),
    };
  } finally {
    await browser.close();
  }
}

export type HoldRippleVisualProof = {
  passed: boolean;
  browserVersion: string;
  samples: Array<{
    label: string; sourceTimeMs: number; storyTimeMs: number;
    baselineHash: string; heldHash: string; changedPixels: number; maximumChannelDelta: number;
  }>;
  repeatedRunStable: boolean;
  network: ControlledVisualProof['network'];
};

/** Controlled raster proof for corresponding source/story instants around the approved hold and step edge. */
export async function runHoldRippleVisualProof(input: {
  baselineHtml: string;
  heldHtml: string;
  samples: Array<{ label: string; sourceTimeMs: number; storyTimeMs: number }>;
  viewport: { width: number; height: number };
}): Promise<HoldRippleVisualProof> {
  const browser = await chromium.launch({ headless: true });
  try {
    const baseline = await captureMemory(browser, input.baselineHtml,
      input.samples.map((sample) => sample.sourceTimeMs), input.viewport);
    const heldRuns: MemoryCapture[] = [];
    for (let replay = 0; replay < 3; replay += 1) {
      heldRuns.push(await captureMemory(browser, input.heldHtml,
        input.samples.map((sample) => sample.storyTimeMs), input.viewport));
    }
    const repeatedRunStable = heldRuns.every((run) => run.frames.every((frame, index) =>
      frame.hash === heldRuns[0]!.frames[index]!.hash));
    const samples = input.samples.map((sample, index) => {
      const baselinePng = PNG.sync.read(baseline.frames[index]!.bytes);
      const heldPng = PNG.sync.read(heldRuns[0]!.frames[index]!.bytes);
      const comparison = compareRgba(
        baselinePng.data, heldPng.data, baselinePng.width, baselinePng.height,
      );
      return { ...sample, baselineHash: baseline.frames[index]!.hash,
        heldHash: heldRuns[0]!.frames[index]!.hash,
        changedPixels: comparison.changedPixels,
        maximumChannelDelta: comparison.maximumChannelDelta };
    });
    const allRuns = [baseline, ...heldRuns];
    const network = allRuns.reduce((sum, run) => ({
      liveRequestCount: sum.liveRequestCount + run.network.liveRequestCount,
      abortedUnexpectedRequestCount:
        sum.abortedUnexpectedRequestCount + run.network.abortedUnexpectedRequestCount,
    }), { liveRequestCount: 0, abortedUnexpectedRequestCount: 0 });
    return {
      passed: repeatedRunStable && samples.every((sample) => sample.changedPixels === 0)
        && network.liveRequestCount === 0 && network.abortedUnexpectedRequestCount === 0,
      browserVersion: browser.version(), samples, repeatedRunStable, network,
    };
  } finally {
    await browser.close();
  }
}

type MemoryCapture = {
  frames: Array<{ bytes: Buffer; hash: string }>;
  network: ControlledVisualProof['network'];
};

async function captureMemory(
  browser: Browser,
  html: string,
  times: number[],
  viewport: { width: number; height: number },
): Promise<MemoryCapture> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: 'light',
    reducedMotion: 'no-preference', locale: 'en-US', timezoneId: 'UTC', serviceWorkers: 'block' });
  const network = { liveRequestCount: 0, abortedUnexpectedRequestCount: 0 };
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (/^(?:about:|data:|blob:)/.test(url)) { await route.continue(); return; }
    if (/^https?:/i.test(url)) network.liveRequestCount += 1;
    network.abortedUnexpectedRequestCount += 1; await route.abort('blockedbyclient');
  });
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: 'load' });
    await preparePage(page);
    const frames = [];
    for (const time of times) {
      await setNativeAnimationTime(page, time);
      const bytes = await page.screenshot({ animations: 'allow', caret: 'hide', fullPage: false,
        scale: 'css', type: 'png' });
      frames.push({ bytes, hash: digest(bytes) });
    }
    return { frames, network };
  } finally {
    await context.close();
  }
}

type CaptureReplay = {
  frames: Array<{ bytes: Buffer; hash: string }>;
  readiness: ControlledVisualProof['readiness'][number];
  network: ControlledVisualProof['network'];
};

async function captureReplay(input: {
  browser: Browser;
  html: string;
  sampleTimesMs: number[];
  outputDirectory: string;
  label: string;
  viewport: { width: number; height: number };
}): Promise<CaptureReplay> {
  const context = await input.browser.newContext({
    viewport: input.viewport,
    deviceScaleFactor: 1,
    colorScheme: 'light',
    reducedMotion: 'no-preference',
    locale: 'en-US',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
  });
  const network = { liveRequestCount: 0, abortedUnexpectedRequestCount: 0 };
  await context.route('**/*', async (route) => {
    const url = route.request().url();
    if (/^(?:about:|data:|blob:)/.test(url)) {
      await route.continue();
      return;
    }
    if (/^https?:/i.test(url)) network.liveRequestCount += 1;
    network.abortedUnexpectedRequestCount += 1;
    await route.abort('blockedbyclient');
  });
  try {
    const page = await context.newPage();
    await page.setContent(input.html, { waitUntil: 'load' });
    const readiness = await preparePage(page);
    await primeExactZeroCssAnimationCapture(page, input.sampleTimesMs);
    const frames: CaptureReplay['frames'] = [];
    for (const [sampleIndex, timeMs] of input.sampleTimesMs.entries()) {
      await setNativeAnimationTime(page, timeMs);
      const bytes = await page.screenshot({
        animations: 'allow',
        caret: 'hide',
        fullPage: false,
        scale: 'css',
        type: 'png',
      });
      await writeFile(
        resolve(input.outputDirectory, `${input.label}-${String(sampleIndex).padStart(4, '0')}.png`),
        bytes,
      );
      frames.push({ bytes, hash: digest(bytes) });
    }
    return { frames, readiness, network };
  } finally {
    await context.close();
  }
}

async function primeExactZeroCssAnimationCapture(
  page: Page,
  sampleTimesMs: number[],
): Promise<void> {
  const firstPositiveTimeMs = sampleTimesMs.find((timeMs) => timeMs > 0);
  if (sampleTimesMs[0] !== 0 || firstPositiveTimeMs === undefined) return;
  await page.evaluate(async (positiveTimeMs) => {
    const animations = document.getAnimations().filter((animation): animation is CSSAnimation =>
      animation instanceof CSSAnimation);
    const seek = async (timeMs: number): Promise<void> => {
      for (const animation of animations) {
        animation.pause();
        animation.currentTime = timeMs;
      }
      await Promise.all(animations.map((animation) => animation.ready.catch(() => animation)));
      await new Promise<void>((resolveFrame) => requestAnimationFrame(() =>
        requestAnimationFrame(() => resolveFrame())));
    };
    await seek(positiveTimeMs);
    await seek(0);
  }, firstPositiveTimeMs);
}

async function preparePage(page: Page): Promise<ControlledVisualProof['readiness'][number]> {
  return page.evaluate(async () => {
    const fontsReady = await document.fonts.ready.then(() => true, () => false);
    const animations = document.getAnimations();
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = 0;
    }
    await Promise.all(animations.map((animation) => animation.ready.catch(() => animation)));
    const measure = (): string => JSON.stringify({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      rects: [...document.querySelectorAll('*')].map((element) => {
        const rect = element.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height].map((value) =>
          Math.round(value * 1000) / 1000);
      }),
    });
    let previous = '';
    let stableLayoutConsecutiveCount = 0;
    for (let attempt = 0; attempt < 120 && stableLayoutConsecutiveCount < 3; attempt += 1) {
      await new Promise<void>((resolveFrame) => requestAnimationFrame(() => resolveFrame()));
      const current = measure();
      stableLayoutConsecutiveCount = current === previous
        ? stableLayoutConsecutiveCount + 1 : 1;
      previous = current;
    }
    return {
      domReady: document.readyState === 'complete',
      fontsReady,
      stableLayoutConsecutiveCount,
      animationCount: animations.length,
    };
  });
}

async function setNativeAnimationTime(page: Page, timeMs: number): Promise<void> {
  await page.evaluate(async (time) => {
    const animations = document.getAnimations();
    for (const animation of animations) {
      animation.pause();
      animation.currentTime = time;
    }
    await Promise.all(animations.map((animation) => animation.ready.catch(() => animation)));
    await new Promise<void>((resolveFrame) => requestAnimationFrame(() =>
      requestAnimationFrame(() => resolveFrame())));
  }, timeMs);
}

function digest(input: Uint8Array): string {
  return createHash('sha256').update(input).digest('hex');
}
