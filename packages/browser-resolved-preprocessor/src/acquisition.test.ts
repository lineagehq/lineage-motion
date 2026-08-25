import { expect, test } from 'vitest';
import { CLOSED_PROFILE_CATEGORIES, buildClosedProfileReport, lockOwnerInput, sha256, type ConstructRecord, type OwnerInput } from './index.js';
import { makeOwnerInput } from './index.test.js';
import { snapshotRuntimeActivity } from './acquisition.js';

test('snapshots generic runtime ledgers before teardown callbacks can mutate their sources', () => {
  const live = ['before-return'];
  const evidence = snapshotRuntimeActivity(live);
  live.push('late-teardown-callback');
  expect(evidence).toEqual(['before-return']);
});

test('rejects browser mismatch, lock drift, unknown actions, and credentials before candidate output', async () => {
  expect((await import('./index.js').then(({ acquireAndPreprocessLockedOwnerInput }) => acquireAndPreprocessLockedOwnerInput(lockOwnerInput(makeOwnerInput('forged-browser'))))).receipt.diagnosticCodes).toContain('PREPROCESSOR_BROWSER_MISMATCH');
  const drifted = makeOwnerInput();
  const locked = lockOwnerInput(drifted);
  const { acquireAndPreprocessLockedOwnerInput } = await import('./index.js');
  expect((await acquireAndPreprocessLockedOwnerInput({ ...locked, sha256: '0'.repeat(64) })).receipt.diagnosticCodes).toContain('PREPROCESSOR_LOCK_MISMATCH');
  const action = { ...drifted, procedure: { ...drifted.procedure, actions: [{ kind: 'click' as const, bindingId: 'binding_missing' }] } };
  expect((await acquireAndPreprocessLockedOwnerInput(lockOwnerInput(action))).receipt.diagnosticCodes).toContain('PREPROCESSOR_ACTION_INVALID');
  const credentialed = { ...drifted, sourceLock: { ...drifted.sourceLock, responses: drifted.sourceLock.responses.map((response) => ({ ...response, headers: { authorization: 'secret' } })) } };
  expect((await acquireAndPreprocessLockedOwnerInput(lockOwnerInput(credentialed))).receipt.diagnosticCodes).toContain('PREPROCESSOR_RESOURCE_INVALID');
});

test('rejects every parse5 diagnostic before browser repair across all locked HTML responses', async () => {
  const { precommitLockedOwnerInputCandidate } = await import('./index.js');
  const malformed = [
    '<!doctype html><html><head></head><body><div id="first" id="second"></div></body></html>',
    '<!doctype html><html><head></head><body><div/></body></html>',
    '<!doctype html SYSTEM "about:legacy-compat"><html><head></head><body><div></div></body></html>',
  ];
  for (const html of malformed) {
    const result = await precommitLockedOwnerInputCandidate(lockOwnerInput(withEntryHtml(makeOwnerInput(), html)));
    expect(result.candidatePackage).toBeNull();
    expect(result.receipt.diagnosticCodes).toContain('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
    expect(result.receipt.browserPinned).toBe(false);
  }

  const input = makeOwnerInput();
  const repairedSecondary = '<!doctype html><html><head></head><body><div/></body></html>';
  const withSecondary = {
    ...input,
    sourceLock: {
      ...input.sourceLock,
      responses: [...input.sourceLock.responses, {
        requestUrl: 'https://locked.test/secondary.html', status: 200, headers: {}, mimeType: 'text/html',
        body: repairedSecondary, bodySha256: sha256(repairedSecondary),
      }],
    },
  };
  const secondaryResult = await precommitLockedOwnerInputCandidate(lockOwnerInput(withSecondary));
  expect(secondaryResult.candidatePackage).toBeNull();
  expect(secondaryResult.receipt.diagnosticCodes).toContain('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
});

test('fails closed for hostile routing, resource, and runtime surfaces', async () => {
  const { precommitLockedOwnerInputCandidate } = await import('./index.js');
  const input = makeOwnerInput();
  const duplicateRoute = { ...input, sourceLock: { ...input.sourceLock, responses: [...input.sourceLock.responses, input.sourceLock.responses[0]!] } };
  expect((await precommitLockedOwnerInputCandidate(lockOwnerInput(duplicateRoute))).receipt.diagnosticCodes).toContain('PREPROCESSOR_LOCK_MISMATCH');

  const invalidResource = { ...input, sourceLock: { ...input.sourceLock, responses: input.sourceLock.responses.map((response) => ({ ...response, mimeType: 'image/png' })) } };
  expect((await precommitLockedOwnerInputCandidate(lockOwnerInput(invalidResource))).receipt.diagnosticCodes).toContain('PREPROCESSOR_RESOURCE_INVALID');

  const activeRuntime = withEntryHtml(input, '<!doctype html><html><head></head><body><script>document.body.dataset.changed="yes"</script><div class="marker-a"></div></body></html>');
  expect((await precommitLockedOwnerInputCandidate(lockOwnerInput(activeRuntime))).receipt.diagnosticCodes).toContain('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
});

test('fails closed when a locked external stylesheet is duplicated or has no locked response', async () => {
  const { precommitLockedOwnerInputCandidate } = await import('./index.js');
  const browser = await import('@playwright/test').then(async ({ chromium }) => {
    const instance = await chromium.launch({ headless: true });
    const version = instance.version();
    await instance.close();
    return version;
  });
  const css = '.marker-a{color:rgb(1,2,3)}';
  const base = makeOwnerInput(browser);
  const withStyles = (links: string, includeCss: boolean): OwnerInput => {
    const html = `<!doctype html><html><head>${links}</head><body><input class="gate"><div class="marker-a"></div></body></html>`;
    return {
      ...base,
      sourceLock: {
        entryRequest: base.sourceLock.entryRequest,
        originalSha256: sha256(html),
        redirects: [],
        responses: [
          { requestUrl: base.sourceLock.entryRequest, status: 200, headers: {}, mimeType: 'text/html', body: html, bodySha256: sha256(html) },
          ...(includeCss ? [{ requestUrl: 'https://locked.test/motion.css', status: 200, headers: {}, mimeType: 'text/css' as const, body: css, bodySha256: sha256(css) }] : []),
        ],
      },
    };
  };
  const duplicate = await precommitLockedOwnerInputCandidate(lockOwnerInput(withStyles(
    '<link rel="stylesheet" href="/motion.css"><link rel="stylesheet" href="/motion.css">', true,
  )));
  expect(duplicate.candidatePackage).toBeNull();
  expect(duplicate.receipt.diagnosticCodes).toContain('PREPROCESSOR_RESOURCE_INVALID');

  const unknown = await precommitLockedOwnerInputCandidate(lockOwnerInput(withStyles(
    '<link rel="stylesheet" href="/unknown.css">', false,
  )));
  expect(unknown.candidatePackage).toBeNull();
  expect(unknown.receipt.diagnosticCodes).toContain('PREPROCESSOR_ROUTE_VIOLATION');
}, 30_000);

test('fixture-owned oracle enumerates every closed category and notices every omission or addition', () => {
  const records = CLOSED_PROFILE_CATEGORIES.map((category, index): ConstructRecord => {
    const kind = ({ structural: 'dom', css: 'css-rule', application: 'application', resource: 'resource', 'binding-action': 'action', event: 'event', reset: 'reset' } as const)[category];
    const canonicalInput = `${category}:${index}`;
    return { id: `construct_${sha256(`${kind}:${canonicalInput}`).slice(0, 24)}`, kind, disposition: category === 'reset' ? 'reset-proved' : category === 'binding-action' || category === 'event' ? 'owner-action-executed' : 'preserved-declarative', canonicalInput, canonicalOutput: `observed:${category}` };
  });
  const expected = buildClosedProfileReport(records);
  expect(expected.categories).toEqual(CLOSED_PROFILE_CATEGORIES);
  for (let index = 0; index < records.length; index += 1) expect(buildClosedProfileReport(records.filter((_, item) => item !== index))).not.toEqual(expected);
  const extraInput = 'structural:extra'; const extra: ConstructRecord = { id: `construct_${sha256(`dom:${extraInput}`).slice(0, 24)}`, kind: 'dom', disposition: 'preserved-declarative', canonicalInput: extraInput, canonicalOutput: 'observed:extra' };
  expect(buildClosedProfileReport([...records, extra])).not.toEqual(expected);
});

function withEntryHtml(input: OwnerInput, html: string): OwnerInput {
  return {
    ...input,
    sourceLock: {
      ...input.sourceLock,
      originalSha256: sha256(html),
      responses: input.sourceLock.responses.map((response) => response.requestUrl === input.sourceLock.entryRequest
        ? { ...response, body: html, bodySha256: sha256(html) }
        : response),
    },
  };
}
