import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import { expect, test } from 'vitest';
import { ADMISSION_SCHEMA_VERSION, CLOSED_PROFILE_CATEGORIES, OWNER_INPUT_SCHEMA_VERSION, PREPROCESSOR_VERSION, acquireAndPreprocessLockedOwnerInput, authenticateExpectedAdmissionRoot, createExpectedAdmissionRoot, inspectAdmissionPackage, inspectCandidatePackage, lockOwnerInput, precommitLockedOwnerInputCandidate, sha256, stableJson, type CandidatePackage, type OwnerInput } from './index.js';

const CSS = `.stage{display:flex;gap:8px}.marker{width:24px;height:24px;background:rgb(20,40,80)}.marker-a{animation:shift 1000ms linear both,blink 1000ms steps(2,end) both}.marker-b{animation:shift 1000ms linear 100ms both}.gate:not(:checked)~.stage .marker{animation-play-state:paused}@keyframes shift{from{transform:translateX(0)}to{transform:translateX(16px)}}@keyframes blink{from{opacity:.25}to{opacity:1}}@media (prefers-reduced-motion:reduce){.marker{animation:none}}`;

test('v3 candidate is non-admitting and only a separately supplied fixed root admits a fresh deterministic execution', async () => {
  const browser = await chromium.launch({ headless: true }); const version = browser.version(); await browser.close();
  const html = await readFile(new URL('../../../fixtures/public-synthetic/browser-resolved-preprocessor.html', import.meta.url), 'utf8');
  const locked = lockOwnerInput(makeInput(version, html));
  const candidate = await precommitLockedOwnerInputCandidate(locked);
  expect(candidate.candidatePackage).not.toBeNull();
  const freshRuntimeSnapshot = stableJson(candidate.candidatePackage);
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  expect(stableJson(candidate.candidatePackage)).toBe(freshRuntimeSnapshot);
  expect(candidate.receipt.admitted).toBe(false);
  expect((candidate as Record<string, unknown>).expectedRoot).toBeUndefined();
  expect(candidate.candidatePackage?.detailedEvidence.closedProfile.counts).toEqual({ structural: 10, css: 9, application: 3, resource: 2, 'binding-action': 4, event: 3, reset: 1 });
  expect(inspectCandidatePackage(candidate.candidatePackage)).toEqual({ integrity: 'valid', authenticatedRootMatch: null, behavioralVerdict: null, admitted: false, diagnosticCodes: [] });
  expect((await acquireAndPreprocessLockedOwnerInput(locked)).receipt).toMatchObject({ admitted: false, diagnosticCodes: ['PREPROCESSOR_ARTIFACT_INVALID'] });

  const root = createExpectedAdmissionRoot(locked.sha256, candidate.candidatePackage!.sha256);
  const authenticatedRoot = authenticateExpectedAdmissionRoot(root, sha256(stableJson(root)))!;
  const admitted = await acquireAndPreprocessLockedOwnerInput(locked, authenticatedRoot);
  expect(admitted.receipt).toMatchObject({ admitted: true, closedProfileCovered: true, profilesComplete: true, replayEquivalent: true, resetEquivalent: true, zeroReplayRequests: true, deterministicExecution: true });
  expect(inspectAdmissionPackage(admitted.admissionPackage, authenticatedRoot)).toEqual({ integrity: 'valid', authenticatedRootMatch: true, behavioralVerdict: null, admitted: false, diagnosticCodes: [] });
  expect(admitted.detailedEvidence!.closedProfile.categories).toEqual(CLOSED_PROFILE_CATEGORIES);
  expect(new Set(admitted.detailedEvidence!.closedProfile.records.map((item) => item.category))).toEqual(new Set(CLOSED_PROFILE_CATEGORIES));

  const stale = createExpectedAdmissionRoot(locked.sha256, '0'.repeat(64));
  expect((await acquireAndPreprocessLockedOwnerInput(locked, authenticateExpectedAdmissionRoot(stale, sha256(stableJson(stale)))!)).receipt.admitted).toBe(false);
  const substituted = createExpectedAdmissionRoot('1'.repeat(64), candidate.candidatePackage!.sha256);
  expect((await acquireAndPreprocessLockedOwnerInput(locked, authenticateExpectedAdmissionRoot(substituted, sha256(stableJson(substituted)))!)).receipt.admitted).toBe(false);

  for (const category of CLOSED_PROFILE_CATEGORIES) {
    const hostile = rewrap(candidate.candidatePackage!, (artifact) => { const index = artifact.detailedEvidence.closedProfile.records.findIndex((item: any) => item.category === category); artifact.detailedEvidence.closedProfile.records.splice(index, 1); });
    expect(inspectCandidatePackage(hostile).integrity, `omission:${category}`).toBe('invalid');
    const correlated = rewrap(candidate.candidatePackage!, (artifact) => {
      const record = artifact.detailedEvidence.closedProfile.records.find((item: any) => item.category === category);
      artifact.detailedEvidence.closedProfile.records = artifact.detailedEvidence.closedProfile.records.filter((item: any) => item.id !== record.id);
      artifact.detailedEvidence.closedProfile.counts[category] -= 1;
      for (const preparation of artifact.detailedEvidence.preparationRuns) preparation.ledger = preparation.ledger.filter((item: any) => item.id !== record.id);
    });
    expect(inspectCandidatePackage(correlated).integrity, `correlated-omission:${category}`).toBe('invalid');
  }
  const addition = rewrap(candidate.candidatePackage!, (artifact) => { artifact.detailedEvidence.closedProfile.records.push(structuredClone(artifact.detailedEvidence.closedProfile.records[0])); });
  expect(inspectCandidatePackage(addition).integrity).toBe('invalid');
  const replayNetwork = rewrap(candidate.candidatePackage!, (artifact) => { artifact.detailedEvidence.replayRuns[0].observation.requests.push('https://outside.test/escape'); });
  expect(inspectCandidatePackage(replayNetwork).integrity).toBe('invalid');
  const runtimeError = rewrap(candidate.candidatePackage!, (artifact) => { artifact.detailedEvidence.sourceRuns[0].observation.errors.push('pageerror'); });
  expect(inspectCandidatePackage(runtimeError).integrity).toBe('invalid');
  const nondeterministicPreparation = rewrap(candidate.candidatePackage!, (artifact) => { artifact.detailedEvidence.preparationRuns[1].requestLedger.reverse(); });
  expect(inspectCandidatePackage(nondeterministicPreparation).integrity).toBe('invalid');
  const nondeterministicObservation = rewrap(candidate.candidatePackage!, (artifact) => { artifact.detailedEvidence.sourceRuns[1].observation.events.push('unexpected-event'); });
  expect(inspectCandidatePackage(nondeterministicObservation).integrity).toBe('invalid');
  const resetDrift = rewrap(candidate.candidatePackage!, (artifact) => { artifact.detailedEvidence.replayRuns[0].observation.resetCheckpoints.afterReset = '0'.repeat(64); });
  expect(inspectCandidatePackage(resetDrift).integrity).toBe('invalid');

  for (const field of ['html', 'css'] as const) {
    const replaySubstitution = rewrap(candidate.candidatePackage!, (artifact) => {
      artifact.replayPackage[field] += field === 'html' ? '<!-- hostile replay substitution -->' : '\n/* hostile replay substitution */';
      const replayCore = { protocolVersion: artifact.replayPackage.protocolVersion, html: artifact.replayPackage.html, css: artifact.replayPackage.css };
      artifact.replayPackage.bytes = stableJson(replayCore);
      artifact.replayPackage.sha256 = sha256(artifact.replayPackage.bytes);
    });
    expect(inspectCandidatePackage(replaySubstitution).integrity, `rehashed-replay-${field}:candidate`).toBe('invalid');

    const hostileRoot = createExpectedAdmissionRoot(replaySubstitution.ownerInputLockSha256, replaySubstitution.sha256);
    const hostileReceipt = { ...replaySubstitution.receipt, admitted: true, candidatePackageSha256: replaySubstitution.sha256 };
    const hostileCore = { schemaVersion: ADMISSION_SCHEMA_VERSION, expectedRoot: hostileRoot, candidatePackage: replaySubstitution, receipt: hostileReceipt };
    const hostileBytes = stableJson(hostileCore);
    const hostileAdmission = { ...hostileCore, bytes: hostileBytes, sha256: sha256(hostileBytes) };
    const hostileAuthenticatedRoot = authenticateExpectedAdmissionRoot(hostileRoot, sha256(stableJson(hostileRoot)))!;
    expect(inspectAdmissionPackage(hostileAdmission, hostileAuthenticatedRoot).integrity, `rehashed-replay-${field}:admission`).toBe('invalid');
  }

  const commonModeCandidate = rewrap(candidate.candidatePackage!, (artifact) => {
    artifact.replayPackage.css += '\n/* fully rehashed common-mode substitution */';
    const replayCore = { protocolVersion: artifact.replayPackage.protocolVersion, html: artifact.replayPackage.html, css: artifact.replayPackage.css };
    artifact.replayPackage.bytes = stableJson(replayCore);
    artifact.replayPackage.sha256 = sha256(artifact.replayPackage.bytes);
    for (const preparation of artifact.detailedEvidence.preparationRuns) preparation.replayCss = artifact.replayPackage.css;
    for (const run of [...artifact.detailedEvidence.sourceRuns, ...artifact.detailedEvidence.replayRuns]) run.observation.events.push('common-mode-substitution');
  });
  const hostileRoot = createExpectedAdmissionRoot(locked.sha256, commonModeCandidate.sha256);
  const hostileReceipt = { ...commonModeCandidate.receipt, admitted: true, candidatePackageSha256: commonModeCandidate.sha256 };
  const hostileCore = { schemaVersion: ADMISSION_SCHEMA_VERSION, expectedRoot: hostileRoot, candidatePackage: commonModeCandidate, receipt: hostileReceipt };
  const hostileBytes = stableJson(hostileCore);
  const hostileAdmission = { ...hostileCore, bytes: hostileBytes, sha256: sha256(hostileBytes) };
  const hostileAuthenticatedRoot = authenticateExpectedAdmissionRoot(hostileRoot, sha256(stableJson(hostileRoot)))!;
  expect(inspectCandidatePackage(commonModeCandidate)).toMatchObject({ integrity: 'valid', behavioralVerdict: null, admitted: false });
  expect(inspectAdmissionPackage(hostileAdmission, hostileAuthenticatedRoot)).toEqual({ integrity: 'valid', authenticatedRootMatch: true, behavioralVerdict: null, admitted: false, diagnosticCodes: [] });

  const hostileRootWithTrustedOriginalAuthentication = {
    expectedRoot: hostileRoot,
    externallyAuthenticatedRootSha256: authenticatedRoot.externallyAuthenticatedRootSha256,
    authentication: 'external-preexisting' as const,
  };
  const activelyRejected = await acquireAndPreprocessLockedOwnerInput(locked, hostileRootWithTrustedOriginalAuthentication);
  expect(activelyRejected.receipt).toMatchObject({ admitted: false, diagnosticCodes: ['PREPROCESSOR_ARTIFACT_INVALID'] });
  expect(activelyRejected.admissionPackage).toBeNull();
  expect(admitted.admissionPackage?.candidatePackage.bytes).toBe(candidate.candidatePackage!.bytes);
}, 180_000);

function rewrap(source: CandidatePackage, mutate: (artifact: any) => void): CandidatePackage {
  const artifact = structuredClone(source) as any; mutate(artifact);
  artifact.receipt.detailedEvidenceSha256 = sha256(stableJson(artifact.detailedEvidence));
  const core = { schemaVersion: artifact.schemaVersion, ownerInputLockSha256: artifact.ownerInputLockSha256, replayPackage: artifact.replayPackage, detailedEvidence: artifact.detailedEvidence, receipt: artifact.receipt };
  artifact.bytes = stableJson(core); artifact.sha256 = sha256(artifact.bytes); return artifact;
}

function makeInput(browserVersion: string, html: string): OwnerInput {
  return { schemaVersion: OWNER_INPUT_SCHEMA_VERSION, protocolVersion: PREPROCESSOR_VERSION,
    sourceLock: { entryRequest: 'https://locked.test/index.html', originalSha256: sha256(html), redirects: [], responses: [
      { requestUrl: 'https://locked.test/index.html', status: 200, headers: {}, mimeType: 'text/html', body: html, bodySha256: sha256(html) },
      { requestUrl: 'https://locked.test/motion.css', status: 200, headers: {}, mimeType: 'text/css', body: CSS, bodySha256: sha256(CSS) },
    ] },
    environment: { browserName: 'chromium', browserVersion, viewport: { width: 640, height: 360 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', contrast: 'no-preference', profiles: ['normal', 'reduced'] },
    bindings: [{ bindingId: 'binding_focal', role: 'focal', locator: '.marker-a', expectedMatches: 1 }, { bindingId: 'binding_secondary', role: 'secondary', locator: '.marker-b', expectedMatches: 1 }, { bindingId: 'binding_trigger', role: 'trigger', locator: '.gate', expectedMatches: 1 }],
    procedure: { readiness: 'dom-fonts-two-animation-frames', start: [{ kind: 'click', bindingId: 'binding_trigger' }], actions: [], loopDurationMs: 1100, settledTimeMs: 1000, epsilonMs: 1, reset: 'reload-reapply-and-compare-initial' },
    expectedInventory: { dom: 10, cssRules: 9, keyframes: 2, applications: 3, scripts: 0, resources: 1, pseudos: 0, conditionals: 1, transitions: 0, animatedBindingIds: ['binding_focal', 'binding_secondary'] },
    closedProfile: { categories: [...CLOSED_PROFILE_CATEGORIES], counts: { structural: 10, css: 9, application: 3, resource: 2, 'binding-action': 4, event: 3, reset: 1 } },
  };
}
