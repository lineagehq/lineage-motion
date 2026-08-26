import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';

import { CLOSED_PROFILE_CATEGORIES, OWNER_INPUT_SCHEMA_VERSION, PREPROCESSOR_VERSION, acquireAndPreprocessLockedOwnerInput, lockOwnerInput, sha256, type OwnerInput } from './index.js';
import { deriveMotionEvidenceBoundaries, evaluateCssTimingProgress, normalizeAnimationInstance } from '../../domain/src/css-motion-semantics.js';

test('commits rounded combined transforms before deterministic computed-state and pixel capture', async () => {
  const browser = await chromium.launch({ headless: true }); const version = browser.version(); await browser.close();
  const css = [
    'html,body{margin:0;width:100%;height:100%;overflow:hidden}',
    '.probe{position:absolute;left:47px;top:31px;width:97px;height:97px;border-radius:50%;background:rgb(24,91,173);transform-origin:50% 50%;animation:rounded-motion 2100ms cubic-bezier(.2,.7,.3,1) both}',
    '@keyframes rounded-motion{0%{transform:translate(0px,0px) rotate(0deg) scale(1)}33.333333333333333%{transform:translate(237.375px,109.625px) rotate(23.75deg) scale(.8375)}100%{transform:translate(411.625px,251.375px) rotate(71.25deg) scale(1.1375)}}',
    '@media (prefers-reduced-motion:reduce){.probe{animation:none}}',
  ].join('');
  const html = `<!doctype html><html><head><style>${css}</style></head><body><div class="probe"></div></body></html>`;
  const input: OwnerInput = {
    schemaVersion: OWNER_INPUT_SCHEMA_VERSION, protocolVersion: PREPROCESSOR_VERSION,
    sourceLock: { entryRequest: 'https://locked.test/index.html', originalSha256: sha256(html), redirects: [], responses: [
      { requestUrl: 'https://locked.test/index.html', status: 200, headers: {}, mimeType: 'text/html', body: html, bodySha256: sha256(html) },
    ] },
    environment: { browserName: 'chromium', browserVersion: version, viewport: { width: 640, height: 480 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', contrast: 'no-preference', profiles: ['normal', 'reduced'] },
    bindings: [{ bindingId: 'binding_focal', role: 'focal', locator: '.probe', expectedMatches: 1 }],
    procedure: { readiness: 'dom-fonts-two-animation-frames', start: [{ kind: 'click', bindingId: 'binding_focal' }], actions: [], loopDurationMs: 2100, settledTimeMs: 2100, epsilonMs: 1, reset: 'reload-reapply-and-compare-initial' },
    expectedInventory: { dom: 5, cssRules: 5, keyframes: 1, applications: 1, scripts: 0, resources: 0, pseudos: 0, conditionals: 1, transitions: 0, animatedBindingIds: ['binding_focal'] },
    closedProfile: { categories: [...CLOSED_PROFILE_CATEGORIES], counts: { structural: 5, css: 5, application: 1, resource: 1, 'binding-action': 2, event: 2, reset: 1 } },
  };
  const candidate = await import('./index.js').then(({ precommitLockedOwnerInputCandidate }) => precommitLockedOwnerInputCandidate(lockOwnerInput(input)));
  expect(candidate.receipt.diagnosticCodes).toEqual([]);
  expect(candidate.receipt).toMatchObject({ threeCleanRuns: true, replayEquivalent: true, resetEquivalent: true, deterministicExecution: true });

  const evidence = candidate.candidatePackage!.detailedEvidence;
  for (const profile of ['normal', 'reduced'] as const) {
    const source = evidence.sourceRuns.filter((run) => run.profile === profile).map((run) => run.observation.samples);
    const replay = evidence.replayRuns.filter((run) => run.profile === profile).map((run) => run.observation.samples);
    expect(new Set(source.map((samples) => JSON.stringify(samples))).size, `${profile}:source computed state and pixels`).toBe(1);
    expect(new Set(replay.map((samples) => JSON.stringify(samples))).size, `${profile}:replay computed state and pixels`).toBe(1);
    expect(source[0], `${profile}:source/replay computed state and pixels`).toEqual(replay[0]);
  }
}, 120_000);

test('losslessly replays high-precision keyframes and preserves inline/external cascade order', async () => {
  const browser = await chromium.launch({ headless: true }); const version = browser.version(); await browser.close();
  const externalCss = '.probe{width:16px;height:16px;background:rgb(10,20,30);animation:precise 2100ms linear both}@keyframes precise{0%{transform:translateX(0)}33.333333333333333%{transform:translateX(7px)}100%{transform:translateX(14px)}}';
  const inlineCss = '.probe{background:rgb(40,50,60)}@media (prefers-reduced-motion:reduce){.probe{animation:none}}';
  const html = `<!doctype html><html><head><link rel="stylesheet" href="/motion.css"><style>${inlineCss}</style></head><body><div class="probe"></div></body></html>`;
  const input: OwnerInput = {
    schemaVersion: OWNER_INPUT_SCHEMA_VERSION, protocolVersion: PREPROCESSOR_VERSION,
    sourceLock: { entryRequest: 'https://locked.test/index.html', originalSha256: sha256(html), redirects: [], responses: [
      { requestUrl: 'https://locked.test/motion.css', status: 200, headers: {}, mimeType: 'text/css', body: externalCss, bodySha256: sha256(externalCss) },
      { requestUrl: 'https://locked.test/index.html', status: 200, headers: {}, mimeType: 'text/html', body: html, bodySha256: sha256(html) },
    ] },
    environment: { browserName: 'chromium', browserVersion: version, viewport: { width: 320, height: 200 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', contrast: 'no-preference', profiles: ['normal', 'reduced'] },
    bindings: [{ bindingId: 'binding_focal', role: 'focal', locator: '.probe', expectedMatches: 1 }],
    procedure: { readiness: 'dom-fonts-two-animation-frames', start: [{ kind: 'click', bindingId: 'binding_focal' }], actions: [], loopDurationMs: 2100, settledTimeMs: 2100, epsilonMs: 1, reset: 'reload-reapply-and-compare-initial' },
    expectedInventory: { dom: 6, cssRules: 5, keyframes: 1, applications: 1, scripts: 0, resources: 1, pseudos: 0, conditionals: 1, transitions: 0, animatedBindingIds: ['binding_focal'] },
    closedProfile: { categories: [...CLOSED_PROFILE_CATEGORIES], counts: { structural: 6, css: 5, application: 1, resource: 2, 'binding-action': 2, event: 2, reset: 1 } },
  };
  const candidate = await import('./index.js').then(({ precommitLockedOwnerInputCandidate }) => precommitLockedOwnerInputCandidate(lockOwnerInput(input)));
  expect(candidate.receipt.diagnosticCodes).toEqual([]);
  expect(candidate.candidatePackage?.replayPackage.css).toBe(`${externalCss}\n${inlineCss}`);
  expect(candidate.candidatePackage?.detailedEvidence.sourceRuns.every((run) => run.observation.samples.some((sample) => typeof sample === 'object' && sample !== null && 'timeMs' in sample && sample.timeMs === 700))).toBe(true);
  expect(candidate.receipt).toMatchObject({ replayEquivalent: true, resetEquivalent: true, threeCleanRuns: true });

  const coverageDrift: OwnerInput = {
    ...input,
    closedProfile: {
      ...input.closedProfile,
      counts: { ...input.closedProfile.counts, event: input.closedProfile.counts.event + 1 },
    },
  };
  const rejected = await import('./index.js').then(({ precommitLockedOwnerInputCandidate }) => precommitLockedOwnerInputCandidate(lockOwnerInput(coverageDrift)));
  expect(rejected.candidatePackage).toBeNull();
  expect(rejected.receipt.closedProfileCovered).toBe(false);
  expect(rejected.receipt.diagnosticCodes).toContain('PREPROCESSOR_INVENTORY_MISMATCH');
}, 120_000);

test('uses the same exact 0 ms lifecycle before animated start actions and captures ancestor scroll state', async () => {
  const browser = await chromium.launch({ headless: true }); const version = browser.version(); await browser.close();
  const css = '.scroller{height:80px;overflow:auto}.target{display:block;margin-top:500px;animation:arrive 2100ms linear both}@keyframes arrive{from{transform:translateY(-500px)}to{transform:translateY(0)}}@media (prefers-reduced-motion:reduce){.target{animation:none}}';
  const html = `<!doctype html><html><head><style>${css}</style></head><body><div class="scroller"><button class="target" type="button">Target</button></div></body></html>`;
  const input: OwnerInput = {
    schemaVersion: OWNER_INPUT_SCHEMA_VERSION, protocolVersion: PREPROCESSOR_VERSION,
    sourceLock: { entryRequest: 'https://locked.test/index.html', originalSha256: sha256(html), redirects: [], responses: [
      { requestUrl: 'https://locked.test/index.html', status: 200, headers: {}, mimeType: 'text/html', body: html, bodySha256: sha256(html) },
    ] },
    environment: { browserName: 'chromium', browserVersion: version, viewport: { width: 320, height: 200 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', contrast: 'no-preference', profiles: ['normal', 'reduced'] },
    bindings: [{ bindingId: 'binding_target', role: 'focal', locator: '.target', expectedMatches: 1 }],
    procedure: { readiness: 'dom-fonts-two-animation-frames', start: [{ kind: 'click', bindingId: 'binding_target' }], actions: [], loopDurationMs: 2100, settledTimeMs: 2100, epsilonMs: 1, reset: 'reload-reapply-and-compare-initial' },
    expectedInventory: { dom: 6, cssRules: 5, keyframes: 1, applications: 1, scripts: 0, resources: 0, pseudos: 0, conditionals: 1, transitions: 0, animatedBindingIds: ['binding_target'] },
    closedProfile: { categories: [...CLOSED_PROFILE_CATEGORIES], counts: { structural: 6, css: 5, application: 1, resource: 1, 'binding-action': 2, event: 3, reset: 1 } },
  };
  const candidate = await import('./index.js').then(({ precommitLockedOwnerInputCandidate }) => precommitLockedOwnerInputCandidate(lockOwnerInput(input)));
  expect(candidate.receipt.diagnosticCodes).toEqual([]);
  expect(candidate.receipt).toMatchObject({ replayEquivalent: true, resetEquivalent: true, threeCleanRuns: true });
  const observations = [
    ...(candidate.candidatePackage?.detailedEvidence.sourceRuns ?? []),
    ...(candidate.candidatePackage?.detailedEvidence.replayRuns ?? []),
  ];
  expect(observations).toHaveLength(12);
  expect(observations.every((run) => run.observation.resetCheckpoints.afterStart === run.observation.resetCheckpoints.afterReset)).toBe(true);
}, 120_000);

test('shared step authority agrees with controlled Chromium for every supported position and profile', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const profile of ['normal', 'reduced'] as const) {
      const context = await browser.newContext({ reducedMotion: profile === 'reduced' ? 'reduce' : 'no-preference' });
      const page = await context.newPage();
      for (const position of ['start', 'end', 'jump-start', 'jump-end', 'jump-none', 'jump-both'] as const) {
        await page.setContent(`<style>@keyframes probe{from{opacity:0}to{opacity:1}}#probe{animation:probe 1000ms steps(3,${position}) both}</style><div id="probe"></div>`);
        for (const progress of [0, 0.2, 1 / 3, 0.7, 1]) {
          const actual = await page.evaluate((time) => {
            const animation = document.getAnimations()[0]!; animation.pause(); animation.currentTime = time;
            return Number(getComputedStyle(document.querySelector('#probe')!).opacity);
          }, progress * 1000);
          expect(actual).toBeCloseTo(evaluateCssTimingProgress(`steps(3, ${position})`, progress), 6);
        }
      }
      await context.close();
    }
  } finally { await browser.close(); }
}, 30_000);

test('shared visibility endpoint policy agrees with controlled Chromium at both value-dependent switches', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const [from, to, expectedBoundary] of [['hidden', 'visible', 0], ['visible', 'hidden', 1000]] as const) {
      const instance = normalizeAnimationInstance({
        applicationId: 'application_visibility', targetId: 'node_probe', ruleId: 'rule_probe', timeline: 'document', composition: 'replace',
        durationMs: 1000, delayMs: 0, iterations: 1, direction: 'normal', fill: 'both', playState: 'running', easing: 'linear',
        properties: ['visibility'], keyframes: [
          { offset: 0, easing: 'linear', properties: ['visibility'], values: { visibility: from } },
          { offset: 1, easing: 'linear', properties: ['visibility'], values: { visibility: to } },
        ],
      });
      const schedule = deriveMotionEvidenceBoundaries([instance], 1000);
      expect(schedule.some((sample) => sample.timeMs === expectedBoundary && sample.reasons.includes('application_visibility:discrete:visibility'))).toBe(true);
      await page.setContent(`<style>@keyframes visibility-probe{from{visibility:${from}}to{visibility:${to}}}#probe{animation:visibility-probe 1000ms linear both}</style><div id="probe"></div>`);
      const times = expectedBoundary === 0 ? [0, 1] : [999, 1000];
      const actual = await page.evaluate((sampleTimes) => sampleTimes.map((time) => {
        const animation = document.getAnimations()[0]!; animation.pause(); animation.currentTime = time;
        return getComputedStyle(document.querySelector('#probe')!).visibility;
      }), times);
      expect(actual).toEqual([from, to]);
    }
  } finally { await browser.close(); }
}, 30_000);

test('shared direction and iteration schedules match hostile controlled-Chromium discontinuities', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const cases = [
      { direction: 'normal', iterations: 1, delayMs: 100, loop: 1100, boundary: 350 },
      { direction: 'reverse', iterations: 1, delayMs: 100, loop: 1100, boundary: 850 },
      { direction: 'alternate', iterations: 2, delayMs: 100, loop: 2100, boundary: 1850 },
      { direction: 'alternate-reverse', iterations: 2, delayMs: 100, loop: 2100, boundary: 1350 },
      { direction: 'normal', iterations: 1.5, delayMs: 100, loop: 1600, boundary: 1350 },
      { direction: 'alternate', iterations: 'infinite', delayMs: -1250, loop: 1250, boundary: 1000 },
    ] as const;
    for (const profile of ['normal', 'reduced'] as const) {
      const context = await browser.newContext({ reducedMotion: profile === 'reduced' ? 'reduce' : 'no-preference' });
      const page = await context.newPage();
      for (const item of cases) {
        const instance = normalizeAnimationInstance({
          applicationId: 'application_probe', targetId: 'node_probe', ruleId: 'rule_probe', timeline: 'document', composition: 'replace',
          durationMs: 1000, delayMs: item.delayMs, iterations: item.iterations, direction: item.direction,
          fill: 'both', playState: 'running', easing: 'linear', properties: ['opacity'],
          keyframes: [{ offset: 0, easing: 'steps(4, end)', properties: ['opacity'] }, { offset: 1, easing: 'linear', properties: ['opacity'] }],
        });
        const schedule = deriveMotionEvidenceBoundaries([instance], item.loop);
        expect(schedule.some((sample) => sample.timeMs === item.boundary && sample.reasons.includes('application_probe:segment-step'))).toBe(true);
        await page.setContent(`<style>@keyframes probe{from{opacity:0}to{opacity:1}}#probe{animation:probe 1000ms steps(4,end) ${item.delayMs}ms ${item.iterations} ${item.direction} both}</style><div id="probe"></div>`);
        const values = await page.evaluate((boundary) => [boundary - 1, boundary, boundary + 1].map((time) => {
          const animation = document.getAnimations()[0]!; animation.pause(); animation.currentTime = time;
          return Number(getComputedStyle(document.querySelector('#probe')!).opacity);
        }), item.boundary);
        expect(values[0], `${profile}:${item.direction}:${item.iterations}:before`).not.toBe(values[2]);
        expect([values[0], values[2]]).toContain(values[1]);
      }
      await context.close();
    }
  } finally { await browser.close(); }
}, 30_000);

test('browser acquisition rejects ambiguous owner identity instead of substituting selector order', async () => {
  const browser = await chromium.launch({ headless: true }); const version = browser.version(); await browser.close();
  const html = '<!doctype html><html><head><style>.marker{animation:move 1s linear}@keyframes move{to{transform:translateX(1px)}}</style></head><body><div class="marker"></div><div class="marker"></div></body></html>';
  const input: OwnerInput = {
    schemaVersion: OWNER_INPUT_SCHEMA_VERSION, protocolVersion: PREPROCESSOR_VERSION,
    sourceLock: { entryRequest: 'https://locked.test/index.html', originalSha256: sha256(html), redirects: [], responses: [
      { requestUrl: 'https://locked.test/index.html', status: 200, headers: {}, mimeType: 'text/html', body: html, bodySha256: sha256(html) },
    ] },
    environment: { browserName: 'chromium', browserVersion: version, viewport: { width: 320, height: 200 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', contrast: 'no-preference', profiles: ['normal', 'reduced'] },
    bindings: [{ bindingId: 'binding_focal', role: 'focal', locator: '.marker', expectedMatches: 1 }],
    procedure: { readiness: 'dom-fonts-two-animation-frames', start: [], actions: [], loopDurationMs: 1000, settledTimeMs: 1000, epsilonMs: 1, reset: 'reload-reapply-and-compare-initial' },
    expectedInventory: { dom: 7, cssRules: 2, keyframes: 1, applications: 2, scripts: 0, resources: 0, pseudos: 0, conditionals: 0, transitions: 0, animatedBindingIds: ['binding_focal'] },
    closedProfile: { categories: [...CLOSED_PROFILE_CATEGORIES], counts: { structural: 7, css: 2, application: 2, resource: 1, 'binding-action': 1, event: 0, reset: 1 } },
  };
  const result = await acquireAndPreprocessLockedOwnerInput(lockOwnerInput(input));
  expect(result.replayPackage).toBeNull();
  expect(result.receipt.diagnosticCodes).toContain('PREPROCESSOR_BINDING_INVALID');
}, 30_000);

test('browser acquisition rejects an unregistered conditional branch', async () => {
  const browser = await chromium.launch({ headless: true }); const version = browser.version(); await browser.close();
  const html = '<!doctype html><html><head><style>.marker{animation:move 1s linear}@keyframes move{to{transform:translateX(1px)}}@media (min-width:1px){.marker{opacity:.5}}</style></head><body><div class="marker"></div></body></html>';
  const input: OwnerInput = {
    schemaVersion: OWNER_INPUT_SCHEMA_VERSION, protocolVersion: PREPROCESSOR_VERSION,
    sourceLock: { entryRequest: 'https://locked.test/index.html', originalSha256: sha256(html), redirects: [], responses: [
      { requestUrl: 'https://locked.test/index.html', status: 200, headers: {}, mimeType: 'text/html', body: html, bodySha256: sha256(html) },
    ] },
    environment: { browserName: 'chromium', browserVersion: version, viewport: { width: 320, height: 200 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', contrast: 'no-preference', profiles: ['normal', 'reduced'] },
    bindings: [{ bindingId: 'binding_focal', role: 'focal', locator: '.marker', expectedMatches: 1 }],
    procedure: { readiness: 'dom-fonts-two-animation-frames', start: [], actions: [], loopDurationMs: 1000, settledTimeMs: 1000, epsilonMs: 1, reset: 'reload-reapply-and-compare-initial' },
    expectedInventory: { dom: 6, cssRules: 4, keyframes: 1, applications: 1, scripts: 0, resources: 0, pseudos: 0, conditionals: 1, transitions: 0, animatedBindingIds: ['binding_focal'] },
    closedProfile: { categories: [...CLOSED_PROFILE_CATEGORIES], counts: { structural: 6, css: 4, application: 1, resource: 1, 'binding-action': 1, event: 0, reset: 1 } },
  };
  const result = await acquireAndPreprocessLockedOwnerInput(lockOwnerInput(input));
  expect(result.replayPackage).toBeNull();
  expect(result.receipt.diagnosticCodes).toContain('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
}, 30_000);
