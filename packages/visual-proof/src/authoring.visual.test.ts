import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, test } from 'vitest';
import { chromium, type Browser } from '@playwright/test';
import { PNG } from 'pngjs';

import { compileMotionDocument } from '../../css-compiler/src/index.js';
import { importMotionHtml } from '../../css-import/src/index.js';
import {
  canonicalContentBytes,
  createAuthoringState,
  dispatchAuthoringOperation,
  sha256Hex,
  type AuthoringOperation,
  type AuthoringState,
} from '../../domain/src/index.js';
import { deriveSamplePlan } from './index.js';

const fixtureUrl = new URL('../../../fixtures/public-synthetic/preview.html', import.meta.url);
const controlledChromiumArgs = ['--disable-threaded-animation'] as const;
const streakPath = resolve('artifacts/t002-target-selection-streak.json');
const proofVersion = 't002-target-selection-controlled.v1';
const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const playwrightPackagePath = require.resolve('@playwright/test/package.json');
const browsersManifestPath = resolve(dirname(require.resolve('playwright-core/package.json')), 'browsers.json');

describe('Phase 2 controlled authoring proof', () => {
  test('contains intentional pixels and restores every undo/redo visual state', async () => {
    const priorStreak = await beginFocusedRun();
    const source = await (await import('node:fs/promises')).readFile(fixtureUrl, 'utf8');
    const imported = importMotionHtml(source);
    expect(imported.document).not.toBeNull();
    let state = createAuthoringState(imported.document!);
    const elementId = 'el_2dbee68b1ea318c8';
    const cursorElementId = 'el_a2849ff826f3e167';
    expect(state.document.elements.some((element) => element.id === elementId)).toBe(true);
    const states = new Map<string, AuthoringState>([['S0', state]]);
    const dispatch = (operation: AuthoringOperation) => {
      const result = dispatchAuthoringOperation(state, operation);
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.diagnostic.code);
      state = result.state;
    };
    const envelope = (operationId: string) => ({
      schemaVersion: 'motion.operation.v1' as const, operationId,
      documentId: state.document.documentId, expectedRevision: state.document.revision,
    });
    dispatch({ ...envelope('visual:create'), kind: 'motion.track.create', elementId,
      payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear', startValue: 0, endValue: 1 } } as AuthoringOperation);
    states.set('S1', state);
    const track = state.document.tracks.find((candidate) => candidate.elementId === elementId && candidate.property === 'opacity')!;
    dispatch({ ...envelope('visual:add'), kind: 'motion.keyframe.add', elementId, trackId: track.id,
      payload: { timeMs: 1110, value: 0.5 } } as AuthoringOperation);
    states.set('S2', state);
    const midpointId = state.document.tracks.find((candidate) => candidate.id === track.id)!.keyframeIds[1]!;
    dispatch({ ...envelope('visual:duration'), kind: 'motion.slot-duration.set', elementId, trackId: track.id,
      payload: { durationMs: 1400 } } as AuthoringOperation); states.set('S3', state);
    dispatch({ ...envelope('visual:delay'), kind: 'motion.binding-delay.set', elementId, trackId: track.id,
      payload: { delayMs: 700 } } as AuthoringOperation); states.set('S4', state);
    dispatch({ ...envelope('visual:easing'), kind: 'motion.slot-easing.set', elementId, trackId: track.id,
      payload: { easing: 'ease-in-out' } } as AuthoringOperation); states.set('S5', state);
    dispatch({ ...envelope('visual:remove'), kind: 'motion.keyframe.remove', elementId, trackId: track.id,
      keyframeId: midpointId } as AuthoringOperation); states.set('S6', state);

    const rejectedBefore = state;
    const stale = dispatchAuthoringOperation(state, {
      schemaVersion: 'motion.operation.v1', operationId: 'visual:stale', documentId: state.document.documentId,
      expectedRevision: 5, kind: 'motion.slot-duration.set', elementId,
      trackId: track.id, payload: { durationMs: 1200 },
    });
    expect(stale).toMatchObject({ ok: false, diagnostic: { code: 'AUTHORING_STALE_REVISION' } });
    expect(state).toEqual(rejectedBefore);

    for (const [label, kind] of [
      ...Array.from({ length: 6 }, (_, index) => [`U${index + 1}`, 'motion.history.undo'] as const),
      ...Array.from({ length: 6 }, (_, index) => [`R${index + 1}`, 'motion.history.redo'] as const),
    ] as const) {
      dispatch({ ...envelope(`visual:${label}`), kind });
      states.set(label, state);
    }

    const compiles = new Map([...states].map(([label, snapshot]) =>
      [label, compileMotionDocument(snapshot.document)]));
    const deterministic = Object.fromEntries(Array.from({ length: 7 }, (_, index) => `S${index}`).map((label) => {
      const snapshot = states.get(label)!;
      const runs = [0, 1, 2].map(() => compileMotionDocument(snapshot.document));
      return [label, runs.every((run) => run.html === runs[0]!.html && run.css === runs[0]!.css
        && run.exportDigest === runs[0]!.exportDigest
        && JSON.stringify(run.receipt) === JSON.stringify(runs[0]!.receipt))];
    }));
    expect(Object.values(deterministic).every(Boolean)).toBe(true);
    const cursorCreated = dispatchAuthoringOperation(createAuthoringState(imported.document!), {
      schemaVersion: 'motion.operation.v1', operationId: 'visual:cursor',
      documentId: imported.document!.documentId, expectedRevision: 0,
      kind: 'motion.track.create', elementId: cursorElementId,
      payload: { property: 'opacity', durationMs: 1000, delayMs: 610,
        easing: 'linear', startValue: 0, endValue: 1 },
    });
    expect(cursorCreated.ok).toBe(true); if (!cursorCreated.ok) throw new Error(cursorCreated.diagnostic.code);
    const cursorRuns = [0, 1, 2].map(() => compileMotionDocument(cursorCreated.state.document));
    expect(cursorRuns.every((run) => run.html === cursorRuns[0]!.html
      && run.exportDigest === cursorRuns[0]!.exportDigest)).toBe(true);
    const orbTrackId = states.get('S1')!.document.tracks.find((track) => track.elementId === elementId
      && track.property === 'opacity')!.id;
    const cursorTrackId = cursorCreated.state.document.tracks.find((track) => track.elementId === cursorElementId
      && track.property === 'opacity')!.id;
    expect(cursorTrackId).not.toBe(orbTrackId);

    const identities = { U1: 'S5', U2: 'S4', U3: 'S3', U4: 'S2', U5: 'S1', U6: 'S0',
      R1: 'S1', R2: 'S2', R3: 'S3', R4: 'S4', R5: 'S5', R6: 'S6' } as const;
    for (const [actual, expected] of Object.entries(identities)) {
      expect(canonicalContentBytes(states.get(actual)!.document)).toEqual(
        canonicalContentBytes(states.get(expected)!.document),
      );
      expect(compiles.get(actual)!.html).toBe(compiles.get(expected)!.html);
      expect(compiles.get(actual)!.css).toBe(compiles.get(expected)!.css);
      expect(compiles.get(actual)!.exportDigest).toBe(compiles.get(expected)!.exportDigest);
    }

    const samplePlan = deriveSamplePlan(states.get('S6')!.document, [
      0, 609, 610, 611, 699, 700, 701, 1109, 1110, 1111, 1399, 1400, 1401,
      1309, 1310, 1311, 1609, 1610, 1611, 2009, 2010, 2011, 2099, 2100, 2101,
      states.get('S6')!.document.durationMs,
    ]);
    expect(samplePlan.boundaries).toHaveLength(8);
    expect(samplePlan.sampleTimesMs).toEqual(expect.arrayContaining([
      609, 610, 611, 699, 700, 701, 1109, 1110, 1111, 1309, 1310, 1311,
      1399, 1400, 1401, 1609, 1610, 1611, 2009, 2010, 2011, 2099, 2100, 2101,
    ]));
    const browser = await chromium.launch({ headless: true, args: [...controlledChromiumArgs] });
    const browserVersion = browser.version();
    const processAttestation = await attestBrowserProcess(browser, browserVersion);
    expect(processAttestation.passed).toBe(true);
    const captures = new Map<string, Awaited<ReturnType<typeof captureState>>>();
    try {
      for (const [label, compiled] of compiles) {
        captures.set(label, await captureState(browser, compiled.html, samplePlan.sampleTimesMs, elementId));
      }
      captures.set('C0', await captureState(browser, compiles.get('S0')!.html,
        samplePlan.sampleTimesMs, cursorElementId));
      captures.set('C1', await captureState(browser, cursorRuns[0]!.html,
        samplePlan.sampleTimesMs, cursorElementId));
    } finally {
      await browser.close();
    }
    const zeroNetwork = [...captures.values()].every((capture) => capture.liveNetworkCount === 0);
    expect(zeroNetwork).toBe(true);
    for (const [actual, expected] of Object.entries(identities)) {
      expect(captures.get(actual)!.frames.map((frame) => frame.semantic)).toEqual(
        captures.get(expected)!.frames.map((frame) => frame.semantic),
      );
      expect(captures.get(actual)!.frames.map((frame) => frame.hash)).toEqual(
        captures.get(expected)!.frames.map((frame) => frame.hash),
      );
    }

    let outsideChangedPixels = 0;
    let nonTargetPropertiesEqual = true;
    for (const label of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'C1']) {
      const baseline = captures.get(label === 'C1' ? 'C0' : 'S0')!;
      const candidate = captures.get(label)!;
      for (const [index, frame] of baseline.frames.entries()) {
        outsideChangedPixels += countOutsideChanges(frame.png, candidate.frames[index]!.png, frame.box, candidate.frames[index]!.box, 2);
        nonTargetPropertiesEqual &&= JSON.stringify(frame.nonTarget) === JSON.stringify(candidate.frames[index]!.nonTarget);
      }
    }
    expect(outsideChangedPixels).toBe(0);
    expect(nonTargetPropertiesEqual).toBe(true);

    const playwrightPackage = JSON.parse(await readFile(playwrightPackagePath, 'utf8')) as { version: string };
    const completedStreak = priorStreak + 1;

    const receipt = {
      schemaVersion: 'motion.phase2-target-selection-proof.v1', passed: true,
      environment: {
        browser: { name: 'Playwright Chromium', version: browserVersion },
        playwrightVersion: playwrightPackage.version,
        processAttestation,
        viewport: { width: 900, height: 700 }, deviceScaleFactor: 1,
        colorScheme: 'light', locale: 'en-US', timezone: 'UTC',
        reducedMotion: 'no-preference', serviceWorkers: 'block', network: 'blocked',
      },
      readiness: {
        requiredLayoutConsecutiveCount: 3, requiredSemanticConsecutiveCount: 3,
        maximumAnimationFrames: 120, requiredRasterConsecutiveCount: 2,
        maximumRasterAttempts: 5,
      },
      repeatability: { consecutiveFocusedPasses: completedStreak },
      independentContextCount: captures.size,
      stateSequence: [...states].map(([label, snapshot]) => ({ label, revision: snapshot.document.revision,
        contentDigest: sha256Hex(canonicalContentBytes(snapshot.document)),
        compiledDigest: sha256Hex(compiles.get(label)!.html),
        exportDigest: compiles.get(label)!.exportDigest,
        layoutConsecutiveCount: captures.get(label)!.layoutConsecutiveCount,
        sampleCount: captures.get(label)!.frames.length,
        rasterCaptureCount: captures.get(label)!.frames.reduce((sum, frame) =>
          sum + frame.rasterHashes.length, 0),
      })),
      staleReject: { code: 'AUTHORING_STALE_REVISION', stateUnchanged: true },
      deterministic: { ...deterministic, cursor: true },
      choices: { orbElementId: elementId, cursorElementId, orbTrackId, cursorTrackId,
        distinctTrackIds: cursorTrackId !== orbTrackId },
      sampleTimesMs: samplePlan.sampleTimesMs,
      unaffectedBoundaryCount: samplePlan.boundaries.length,
      endpointHandling: samplePlan.endpointHandling,
      containment: { marginPx: 2, outsideChangedPixels, nonTargetPropertiesEqual },
      equalityChecks: Object.fromEntries(Object.entries(identities).map(([actual, expected]) =>
        [`${actual}_${expected}`, true])),
      network: { liveRequestCount: 0 },
      nativeAnimation: {
        minimumCount: Math.min(...[...captures.values()].flatMap((capture) =>
          capture.frames.map((frame) => frame.semantic.animations.length))),
        allCssAnimation: true, allPaused: true, allCurrentTimesExact: true,
      },
      diagnosticMatrix: [...states].flatMap(([label, snapshot]) =>
        captures.get(label)!.frames.map((frame, sampleIndex) => ({
          state: label, sampleIndex, sampleTimeMs: samplePlan.sampleTimesMs[sampleIndex],
          contentDigest: sha256Hex(canonicalContentBytes(snapshot.document)),
          compiledDigest: sha256Hex(compiles.get(label)!.html),
          exportDigest: compiles.get(label)!.exportDigest,
          animationReady: true,
          layoutConsecutiveCount: captures.get(label)!.layoutConsecutiveCount,
          semanticConsecutiveCount: frame.semanticConsecutiveCount,
          rasterAttemptHashes: frame.rasterHashes,
          chosenConvergedHash: frame.hash,
          equivalentStateHashEqual: Object.entries(identities)
            .filter(([actual, expected]) => actual === label || expected === label)
            .every(([actual, expected]) => captures.get(actual)!.frames[sampleIndex]!.hash
              === captures.get(expected)!.frames[sampleIndex]!.hash),
        }))),
    };
    await finishFocusedRun(completedStreak);
    if (completedStreak >= 3 && process.env.PHASE3_AGGREGATE_PROOF !== '1') {
      await mkdir(resolve('docs/evidence'), { recursive: true });
      await writeFile(resolve('docs/evidence/t002-phase2-target-selection.json'), `${JSON.stringify(receipt, null, 2)}\n`);
    }
  }, 120_000);
});

async function captureState(
  browser: Awaited<ReturnType<typeof chromium.launch>>,
  html: string,
  times: number[],
  targetElementId: string,
) {
  const context = await browser.newContext({
    viewport: { width: 900, height: 700 }, deviceScaleFactor: 1, colorScheme: 'light',
    locale: 'en-US', timezoneId: 'UTC', reducedMotion: 'no-preference', serviceWorkers: 'block',
  });
  let liveNetworkCount = 0;
  await context.route('**/*', async (route) => {
    if (/^https?:/i.test(route.request().url())) liveNetworkCount += 1;
    await route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  await page.setContent(html, { waitUntil: 'load' });
  const layoutConsecutiveCount = await page.evaluate(async () => {
    await document.fonts.ready;
    if (document.readyState !== 'complete') throw new Error('AUTHORING_DOM_NOT_READY');
    const animations = document.getAnimations();
    if (animations.length === 0
      || animations.some((animation) => animation.constructor.name !== 'CSSAnimation')) {
      throw new Error('AUTHORING_NATIVE_ANIMATIONS_REQUIRED');
    }
    for (const animation of animations) { animation.pause(); animation.currentTime = 0; }
    await Promise.all(animations.map((animation) => animation.ready.catch(() => animation)));
    const round = (value: number) => Math.round(value * 1000) / 1000;
    const snapshot = () => JSON.stringify({
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      rects: [...document.querySelectorAll('*')].map((element) => {
        const rect = element.getBoundingClientRect();
        return [rect.x, rect.y, rect.width, rect.height].map(round);
      }),
    });
    let previous = '';
    let consecutive = 0;
    for (let attempt = 0; attempt < 120 && consecutive < 3; attempt += 1) {
      await new Promise<void>((done) => requestAnimationFrame(() => done()));
      const current = snapshot();
      consecutive = current === previous ? consecutive + 1 : 1;
      previous = current;
    }
    if (consecutive < 3) throw new Error('AUTHORING_LAYOUT_NOT_STABLE');
    return consecutive;
  });
  const frames = [];
  for (const time of times) {
    const details = await page.evaluate(async ({ sampleTime, elementId }) => {
      const animations = document.getAnimations();
      for (const animation of animations) { animation.pause(); animation.currentTime = sampleTime; }
      await Promise.all(animations.map((animation) => animation.ready.catch(() => animation)));
      const round = (value: number) => Math.round(value * 1000) / 1000;
      const snapshot = () => {
        const target = document.querySelector<HTMLElement>(`[data-motion-id="${CSS.escape(elementId)}"]`)!;
        const rect = target.getBoundingClientRect();
        const box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
        const computed = (element: HTMLElement) => {
          const style = getComputedStyle(element);
          return [style.opacity, style.transform, style.visibility];
        };
        const nonTarget = [...document.querySelectorAll<HTMLElement>('[data-motion-id]')]
          .filter((element) => element !== target)
          .map((element) => [element.dataset.motionId, ...computed(element)]);
        return {
          semantic: {
            document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
            animations: animations.map((animation) => ({
              type: animation.constructor.name,
              currentTime: typeof animation.currentTime === 'number'
                ? round(animation.currentTime) : null,
              playState: animation.playState,
            })),
            target: { box: Object.fromEntries(Object.entries(box).map(([key, value]) =>
              [key, round(value)])), computed: computed(target) },
            nonTarget,
          },
          box,
          nonTarget,
        };
      };
      let previous = '';
      let consecutive = 0;
      let current = snapshot();
      for (let attempt = 0; attempt < 120 && consecutive < 3; attempt += 1) {
        await new Promise<void>((done) => requestAnimationFrame(() => done()));
        current = snapshot();
        const serialized = JSON.stringify(current.semantic);
        consecutive = serialized === previous ? consecutive + 1 : 1;
        previous = serialized;
      }
      if (consecutive < 3) throw new Error('AUTHORING_SEMANTIC_NOT_STABLE');
      return { ...current, semanticConsecutiveCount: consecutive };
    }, { sampleTime: time, elementId: targetElementId });
    if (details.semantic.animations.length === 0
      || details.semantic.animations.some((animation) => animation.type !== 'CSSAnimation'
        || animation.playState !== 'paused' || animation.currentTime !== time)) {
      throw new Error('AUTHORING_NATIVE_TIME_CONTROL_INVALID');
    }
    const rasterHashes: string[] = [];
    let convergedBytes: Buffer | undefined;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const bytes = await page.screenshot({ animations: 'allow', caret: 'hide', scale: 'css', type: 'png' });
      const hash = createHash('sha256').update(bytes).digest('hex');
      rasterHashes.push(hash);
      if (rasterHashes.length >= 2 && hash === rasterHashes.at(-2)) {
        convergedBytes = bytes;
        break;
      }
    }
    if (!convergedBytes) throw new Error('AUTHORING_RASTER_NOT_STABLE');
    frames.push({
      png: PNG.sync.read(convergedBytes), hash: rasterHashes.at(-1)!, rasterHashes, ...details,
    });
  }
  await context.close();
  return { frames, liveNetworkCount, layoutConsecutiveCount };
}

async function attestBrowserProcess(browser: Browser, browserVersion: string) {
  const session = await browser.newBrowserCDPSession();
  const browserPid = async (): Promise<{ pid: number; recordCount: number }> => {
    const result = await session.send('SystemInfo.getProcessInfo') as {
      processInfo: Array<{ type: string; id: number }>;
    };
    const records = result.processInfo.filter((record) => record.type === 'browser');
    if (records.length !== 1 || !Number.isSafeInteger(records[0]!.id) || records[0]!.id <= 0) {
      throw new Error('AUTHORING_BROWSER_PROCESS_ID_INVALID');
    }
    return { pid: records[0]!.id, recordCount: records.length };
  };
  const before = await browserPid();
  let executablePath: string;
  let argumentTokens: string[];
  if (process.platform === 'darwin') {
    const [executable, argumentsResult] = await Promise.all([
      execFileAsync('/bin/ps', ['-ww', '-p', String(before.pid), '-o', 'comm=']),
      execFileAsync('/bin/ps', ['-ww', '-p', String(before.pid), '-o', 'args=']),
    ]);
    executablePath = executable.stdout.trim();
    argumentTokens = argumentsResult.stdout.trim().split(/\s+/);
  } else if (process.platform === 'linux') {
    const [executable, commandLine] = await Promise.all([
      (await import('node:fs/promises')).readlink(`/proc/${before.pid}/exe`),
      readFile(`/proc/${before.pid}/cmdline`),
    ]);
    executablePath = executable;
    argumentTokens = commandLine.toString('utf8').split('\0').filter(Boolean);
  } else {
    throw new Error('AUTHORING_PROCESS_ATTESTATION_UNSUPPORTED');
  }
  if (!executablePath || argumentTokens.length === 0) {
    throw new Error('AUTHORING_PROCESS_ATTESTATION_EMPTY');
  }
  const flagOccurrenceCount = argumentTokens.filter((argument) =>
    argument === controlledChromiumArgs[0]).length;
  if (flagOccurrenceCount !== 1) throw new Error('AUTHORING_CONTROLLED_FLAG_COUNT_INVALID');

  const browsersManifest = JSON.parse(await readFile(browsersManifestPath, 'utf8')) as { browsers: Array<{
    name: string; revision: string; installByDefault: boolean; browserVersion: string;
  }> };
  const pinned = browsersManifest.browsers.find((candidate) =>
    candidate.name === 'chromium-headless-shell' && candidate.installByDefault);
  if (!pinned) throw new Error('AUTHORING_PINNED_BROWSER_MISSING');
  const browserVersionMatch = browserVersion === pinned.browserVersion;
  const expectedExecutableName = 'chrome-headless-shell';
  const executableRevisionMatch = executablePath.includes(`chromium_headless_shell-${pinned.revision}`)
    && executablePath.endsWith(`/${expectedExecutableName}`);
  if (!browserVersionMatch || !executableRevisionMatch) {
    throw new Error('AUTHORING_PINNED_BROWSER_MISMATCH');
  }
  const after = await browserPid();
  await session.detach();
  const pidStable = before.pid === after.pid;
  if (!pidStable) throw new Error('AUTHORING_BROWSER_PROCESS_CHANGED');
  return {
    method: 'cdp-system-process-info+os-process-table',
    osFamily: process.platform,
    browserProcessRecordCount: before.recordCount,
    flagOccurrenceCount,
    pidStable,
    pinnedRevision: pinned.revision,
    browserVersionMatch,
    executableRevisionMatch,
    passed: true,
  };
}

async function beginFocusedRun(): Promise<number> {
  await mkdir(resolve('artifacts'), { recursive: true });
  let prior = 0;
  try {
    const saved = JSON.parse(await readFile(streakPath, 'utf8')) as {
      proofVersion?: string; status?: string; consecutivePasses?: number;
    };
    if (saved.proofVersion === proofVersion && saved.status === 'passed'
      && Number.isSafeInteger(saved.consecutivePasses)) prior = saved.consecutivePasses!;
  } catch {
    // No current T006 streak exists.
  }
  await writeFile(streakPath, `${JSON.stringify({ proofVersion, status: 'running', consecutivePasses: 0 })}\n`);
  return prior;
}

async function finishFocusedRun(consecutivePasses: number): Promise<void> {
  await writeFile(streakPath, `${JSON.stringify({
    proofVersion, status: 'passed', consecutivePasses,
  })}\n`);
}

function countOutsideChanges(
  baseline: PNG,
  candidate: PNG,
  first: { x: number; y: number; width: number; height: number },
  second: { x: number; y: number; width: number; height: number },
  margin: number,
): number {
  const left = Math.floor(Math.min(first.x, second.x) - margin);
  const top = Math.floor(Math.min(first.y, second.y) - margin);
  const right = Math.ceil(Math.max(first.x + first.width, second.x + second.width) + margin);
  const bottom = Math.ceil(Math.max(first.y + first.height, second.y + second.height) + margin);
  let changed = 0;
  for (let y = 0; y < baseline.height; y += 1) for (let x = 0; x < baseline.width; x += 1) {
    if (x >= left && x < right && y >= top && y < bottom) continue;
    const offset = (y * baseline.width + x) * 4;
    if (baseline.data.subarray(offset, offset + 4).some((value, channel) =>
      value !== candidate.data[offset + channel])) changed += 1;
  }
  return changed;
}
