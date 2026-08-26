import { describe, expect, test } from 'vitest';
import { CLOSED_PROFILE_CATEGORIES, EXPECTED_ROOT_SCHEMA_VERSION, IDENTITY_DERIVATION_OPERATIONS, OWNER_INPUT_SCHEMA_VERSION, PREPROCESSOR_VERSION, inspectPreprocessorReceipt, rejectedResult, authenticateExpectedAdmissionRoot, createExpectedAdmissionRoot, decodeLockedOwnerInput, lockOwnerInput, sha256, stableJson, type OwnerInput } from './index.js';

describe('v3 locked owner input and external root', () => {
  test('accepts only the exact v3 owner envelope', () => {
    const locked = lockOwnerInput(makeOwnerInput());
    expect(decodeLockedOwnerInput(locked)).toEqual({ input: JSON.parse(locked.bytes), lockVerified: true, diagnostics: [] });
    expect(decodeLockedOwnerInput({ ...locked, sha256: '0'.repeat(64) }).diagnostics).toContain('PREPROCESSOR_LOCK_MISMATCH');
    const forged = { ...makeOwnerInput(), admitted: true }; const bytes = stableJson(forged);
    expect(decodeLockedOwnerInput({ bytes, sha256: sha256(bytes) }).input).toBeNull();
  });

  test('creates only an explicit v2 root over pre-existing candidate bytes', () => {
    const root = createExpectedAdmissionRoot('1'.repeat(64), '2'.repeat(64));
    expect(root).toEqual({ schemaVersion: EXPECTED_ROOT_SCHEMA_VERSION, ownerInputLockSha256: '1'.repeat(64), candidatePackageSha256: '2'.repeat(64) });
    expect(authenticateExpectedAdmissionRoot(root, sha256(stableJson(root)))).toEqual({ expectedRoot: root, externallyAuthenticatedRootSha256: sha256(stableJson(root)), authentication: 'external-preexisting' });
    expect(authenticateExpectedAdmissionRoot(root, '0'.repeat(64))).toBeNull();
  });
});

describe('runtime observation receipt summary', () => {
  const summary = { schemaVersion: 'motion.browser-resolved-runtime-observation-diagnostic.v1' as const, variant: 'complete-counts' as const, completeness: 'complete' as const, stage: 'observation-cleanliness' as const, cells: [
    { profile: 'normal' as const, side: 'source' as const, runCount: 3, browserErrorCount: 1, mutatedRunCount: 0, mutationCount: 0 },
    { profile: 'normal' as const, side: 'replay' as const, runCount: 3, browserErrorCount: 0, mutatedRunCount: 0, mutationCount: 0 },
    { profile: 'reduced' as const, side: 'source' as const, runCount: 3, browserErrorCount: 0, mutatedRunCount: 0, mutationCount: 0 },
    { profile: 'reduced' as const, side: 'replay' as const, runCount: 3, browserErrorCount: 0, mutatedRunCount: 0, mutationCount: 0 },
  ] } as const;

  test('accepts only runtime-rejected receipts with the exact fixed shape', () => {
    const runtime = rejectedResult(['PREPROCESSOR_RUNTIME_ERROR'], { zeroErrors: false, runtimeObservationSummary: summary }).receipt;
    expect(inspectPreprocessorReceipt(runtime)).toBe(true);
    expect(Object.keys(runtime.runtimeObservationSummary!).sort()).toEqual(['cells', 'completeness', 'schemaVersion', 'stage', 'variant']);
    expect(runtime.runtimeObservationSummary?.variant).toBe('complete-counts');
    if (runtime.runtimeObservationSummary?.variant !== 'complete-counts') throw new Error('expected complete counts');
    expect(runtime.runtimeObservationSummary.cells.every((cell) => Object.keys(cell).sort().join(',') === 'browserErrorCount,mutatedRunCount,mutationCount,profile,runCount,side')).toBe(true);
    expect(inspectPreprocessorReceipt({ ...runtime, runtimeObservationSummary: { ...summary, freeForm: 'PRIVATE_EXCEPTION_COPY_CREDENTIAL_PATH_SELECTOR_URL_DOM_RESOURCE_PIXEL' } })).toBe(false);
    expect(inspectPreprocessorReceipt({ ...runtime, runtimeObservationSummary: { ...summary, cells: [...summary.cells].reverse() } })).toBe(false);
    expect(inspectPreprocessorReceipt({ ...runtime, runtimeObservationSummary: { ...summary, cells: summary.cells.map((cell, index) => index === 0 ? { ...cell, browserErrorCount: Number.MAX_SAFE_INTEGER + 1 } : cell) } })).toBe(false);
  });

  test('omits summaries from non-runtime failures and rejects success-with-summary', () => {
    const nonRuntime = rejectedResult(['PREPROCESSOR_LOCK_MISMATCH']).receipt;
    expect(inspectPreprocessorReceipt(nonRuntime)).toBe(true);
    expect('runtimeObservationSummary' in nonRuntime).toBe(false);
    const clean = { ...rejectedResult([]).receipt, zeroErrors: true };
    expect(inspectPreprocessorReceipt(clean)).toBe(true);
    expect(inspectPreprocessorReceipt({ ...clean, runtimeObservationSummary: summary })).toBe(false);
    const legacyRuntime = rejectedResult(['PREPROCESSOR_RUNTIME_ERROR'], { zeroErrors: false }).receipt;
    expect(inspectPreprocessorReceipt(legacyRuntime)).toBe(true);
    expect('runtimeObservationSummary' in legacyRuntime).toBe(false);
  });

  test('accepts only the fixed preparation-failure coordinate without mixed fields', () => {
    const preparation = { schemaVersion: 'motion.browser-resolved-runtime-observation-diagnostic.v1' as const, variant: 'preparation-failure' as const, completeness: 'incomplete' as const, stage: 'preparation-execution' as const, failure: { runOrdinal: 2 as const, substage: 'animation-records' as const } };
    const receipt = rejectedResult(['PREPROCESSOR_RUNTIME_ERROR'], { zeroErrors: false, runtimeObservationSummary: preparation }).receipt;
    expect(inspectPreprocessorReceipt(receipt)).toBe(true);
    expect(inspectPreprocessorReceipt({ ...receipt, runtimeObservationSummary: { ...preparation, cells: [] } })).toBe(false);
    expect(inspectPreprocessorReceipt({ ...receipt, runtimeObservationSummary: { ...preparation, failure: { ...preparation.failure, profile: 'normal' } } })).toBe(false);
    expect(inspectPreprocessorReceipt({ ...receipt, runtimeObservationSummary: { ...preparation, failure: { runOrdinal: 0, substage: 'animation-records' } } })).toBe(false);
  });

  test('accepts only monotonic aggregate identity-bind failure progress', () => {
    const progress = { bindingCount: 2, identityDerivationComplete: true, locatorChecksCompleted: 1, identityReadsCompleted: 0, markerWritesCompleted: 0, finalizationComplete: false };
    const diagnostic = { schemaVersion: 'motion.browser-resolved-runtime-observation-diagnostic.v1' as const, variant: 'identity-bind-failure' as const, completeness: 'incomplete' as const, stage: 'preparation-execution' as const, failure: { runOrdinal: 1 as const, substage: 'identity-bind' as const, step: 'identity-read' as const, progress } };
    const receipt = rejectedResult(['PREPROCESSOR_RUNTIME_ERROR'], { zeroErrors: false, runtimeObservationSummary: diagnostic }).receipt;
    expect(inspectPreprocessorReceipt(receipt)).toBe(true);
    expect(inspectPreprocessorReceipt({ ...receipt, runtimeObservationSummary: { ...diagnostic, failure: { ...diagnostic.failure, progress: { ...progress, markerWritesCompleted: 1 } } } })).toBe(false);
    expect(inspectPreprocessorReceipt({ ...receipt, runtimeObservationSummary: { ...diagnostic, failure: { ...diagnostic.failure, progress: { ...progress, finalizationComplete: true } } } })).toBe(false);
    expect(inspectPreprocessorReceipt({ ...receipt, runtimeObservationSummary: { ...diagnostic, failure: { ...diagnostic.failure, bindingId: 'PRIVATE_SENTINEL' } } })).toBe(false);
  });

  test('accepts only the fixed rejected identity-derivation coordinate and booleans', () => {
    for (const operation of IDENTITY_DERIVATION_OPERATIONS) {
      const evaluationEntered = operation !== 'evaluation-dispatch';
      const enumerationComplete = !['evaluation-dispatch', 'encoder-initialize', 'element-enumeration'].includes(operation);
      const diagnostic = { schemaVersion: 'motion.browser-resolved-runtime-observation-diagnostic.v1' as const, variant: 'identity-derivation-failure' as const, completeness: 'incomplete' as const, stage: 'preparation-execution' as const, failure: { runOrdinal: 3 as const, substage: 'identity-bind' as const, step: 'derive-node-identities' as const, operation, evaluationEntered, enumerationComplete } };
      const receipt = rejectedResult(['PREPROCESSOR_RUNTIME_ERROR'], { zeroErrors: false, runtimeObservationSummary: diagnostic }).receipt;
      expect(inspectPreprocessorReceipt(receipt)).toBe(true);
      expect(inspectPreprocessorReceipt({ ...receipt, runtimeObservationSummary: { ...diagnostic, failure: { ...diagnostic.failure, privateSentinel: 'PRIVATE_SENTINEL' } } })).toBe(false);
      expect(inspectPreprocessorReceipt({ ...receipt, runtimeObservationSummary: { ...diagnostic, failure: { ...diagnostic.failure, evaluationEntered: !evaluationEntered } } })).toBe(false);
      expect(inspectPreprocessorReceipt({ ...receipt, runtimeObservationSummary: { ...diagnostic, failure: { ...diagnostic.failure, enumerationComplete: !enumerationComplete } } })).toBe(false);
    }
  });
});

export function makeOwnerInput(browserVersion = 'test-browser'): OwnerInput {
  const html = '<!doctype html><html><head></head><body><input class="gate"><div class="marker-a"></div></body></html>';
  return { schemaVersion: OWNER_INPUT_SCHEMA_VERSION, protocolVersion: PREPROCESSOR_VERSION,
    sourceLock: { entryRequest: 'https://locked.test/index.html', originalSha256: sha256(html), redirects: [], responses: [{ requestUrl: 'https://locked.test/index.html', status: 200, headers: {}, mimeType: 'text/html', body: html, bodySha256: sha256(html) }] },
    environment: { browserName: 'chromium', browserVersion, viewport: { width: 640, height: 360 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', contrast: 'no-preference', profiles: ['normal', 'reduced'] },
    bindings: [{ bindingId: 'binding_focal', role: 'focal', locator: '.marker-a', expectedMatches: 1 }],
    procedure: { readiness: 'dom-fonts-two-animation-frames', start: [], actions: [], loopDurationMs: 1000, settledTimeMs: 1000, epsilonMs: 1, reset: 'reload-reapply-and-compare-initial' },
    expectedInventory: { dom: 7, cssRules: 0, keyframes: 0, applications: 0, scripts: 0, resources: 0, pseudos: 0, conditionals: 0, transitions: 0, animatedBindingIds: [] },
    closedProfile: { categories: [...CLOSED_PROFILE_CATEGORIES], counts: { structural: 7, css: 0, application: 0, resource: 1, 'binding-action': 1, event: 0, reset: 1 } },
  };
}
