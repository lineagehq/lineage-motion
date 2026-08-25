import { describe, expect, test } from 'vitest';
import { CLOSED_PROFILE_CATEGORIES, EXPECTED_ROOT_SCHEMA_VERSION, OWNER_INPUT_SCHEMA_VERSION, PREPROCESSOR_VERSION, authenticateExpectedAdmissionRoot, createExpectedAdmissionRoot, decodeLockedOwnerInput, lockOwnerInput, sha256, stableJson, type OwnerInput } from './index.js';

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
