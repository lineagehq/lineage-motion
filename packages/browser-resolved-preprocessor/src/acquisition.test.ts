import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { CLOSED_PROFILE_CATEGORIES, IDENTITY_BIND_FAILURE_STEPS, IDENTITY_DERIVATION_OPERATIONS, RUNTIME_OBSERVATION_SUBSTAGES, RUNTIME_PREPARATION_SUBSTAGES, buildClosedProfileReport, inspectPreprocessorReceipt, lockOwnerInput, rejectedResult, sha256, type ConstructRecord, type IdentityBindFailureStep, type OwnerInput } from './index.js';
import { makeOwnerInput } from './index.test.js';
import { IdentityBindFailureTracker, RuntimeObservationTracker, RuntimePreparationTracker, snapshotRuntimeActivity, summarizeRuntimeObservations, trackIdentityBindOperation, trackRuntimeObservationOperation, trackRuntimePreparationOperation } from './acquisition.js';

test('snapshots generic runtime ledgers before teardown callbacks can mutate their sources', () => {
  const live = ['before-return'];
  const evidence = snapshotRuntimeActivity(live);
  live.push('late-teardown-callback');
  expect(evidence).toEqual(['before-return']);
});

test('projects observation failures into exactly four ordered count-only cells', () => {
  const hostile = { message: 'PRIVATE_EXCEPTION_COPY_CREDENTIAL_PATH_SELECTOR_URL_DOM_RESOURCE_PIXEL' };
  const run = (profile: 'normal' | 'reduced', errors: unknown[], mutations: number) => ({ profile, observation: { errors, mutations } });
  const summary = summarizeRuntimeObservations(
    [run('normal', [hostile], 0), run('normal', [], 2), run('normal', [], 0), run('reduced', [], 0), run('reduced', [], 0), run('reduced', [], 0)],
    [run('normal', [], 0), run('normal', [], 0), run('normal', [], 0), run('reduced', [hostile, hostile], 1), run('reduced', [], 0), run('reduced', [], 0)],
  );
  expect(summary).toEqual({ schemaVersion: 'motion.browser-resolved-runtime-observation-diagnostic.v1', variant: 'complete-counts', completeness: 'complete', stage: 'observation-cleanliness', cells: [
    { profile: 'normal', side: 'source', runCount: 3, browserErrorCount: 1, mutatedRunCount: 1, mutationCount: 2 },
    { profile: 'normal', side: 'replay', runCount: 3, browserErrorCount: 0, mutatedRunCount: 0, mutationCount: 0 },
    { profile: 'reduced', side: 'source', runCount: 3, browserErrorCount: 0, mutatedRunCount: 0, mutationCount: 0 },
    { profile: 'reduced', side: 'replay', runCount: 3, browserErrorCount: 2, mutatedRunCount: 1, mutationCount: 1 },
  ] });
  expect(JSON.stringify(summary)).not.toContain(hostile.message);
});

test('tracks every applicable early throw coordinate without retaining the caught value', async () => {
  const hostile = { privateSentinel: 'PRIVATE_EXCEPTION_COPY_CREDENTIAL_PATH_SELECTOR_URL_DOM_RESOURCE_PIXEL' };
  let cases = 0;
  for (const profile of ['normal', 'reduced'] as const) for (const side of ['source', 'replay'] as const) for (const runOrdinal of [1, 2, 3] as const) for (const substage of RUNTIME_OBSERVATION_SUBSTAGES) {
    if (substage.startsWith('replay-') && side !== 'replay') continue;
    const tracker = new RuntimeObservationTracker(profile, side, runOrdinal);
    await expect(trackRuntimeObservationOperation(tracker, substage, async () => { throw hostile; })).rejects.toBe(hostile);
    const diagnostic = tracker.earlyFailure();
    expect(diagnostic).toEqual({ schemaVersion: 'motion.browser-resolved-runtime-observation-diagnostic.v1', variant: 'early-failure', completeness: 'incomplete', stage: 'observation-execution', failure: { profile, side, runOrdinal, substage } });
    expect(JSON.stringify(diagnostic)).not.toContain(hostile.privateSentinel);
    expect(inspectPreprocessorReceipt(rejectedResult(['PREPROCESSOR_RUNTIME_ERROR'], { zeroErrors: false, runtimeObservationSummary: diagnostic }).receipt)).toBe(true);
    cases += 1;
  }
  expect(cases).toBe(216);
  expect(() => new RuntimeObservationTracker('normal', 'source', 0 as never)).toThrow();
  const source = new RuntimeObservationTracker('normal', 'source', 1);
  expect(() => source.enter('replay-style')).toThrow();
});

test('tracks all 72 preparation throw coordinates without counts or caught values', async () => {
  const hostile = { privateSentinel: 'PRIVATE_EXCEPTION_COPY_CREDENTIAL_PATH_SELECTOR_URL_DOM_RESOURCE_PIXEL' };
  let cases = 0;
  for (const runOrdinal of [1, 2, 3] as const) for (const substage of RUNTIME_PREPARATION_SUBSTAGES) {
    const tracker = new RuntimePreparationTracker(runOrdinal);
    await expect(Promise.resolve().then(() => trackRuntimePreparationOperation(tracker, substage, () => { throw hostile; }))).rejects.toBe(hostile);
    const diagnostic = tracker.failure();
    expect(diagnostic).toEqual({ schemaVersion: 'motion.browser-resolved-runtime-observation-diagnostic.v1', variant: 'preparation-failure', completeness: 'incomplete', stage: 'preparation-execution', failure: { runOrdinal, substage } });
    expect(JSON.stringify(diagnostic)).not.toContain(hostile.privateSentinel);
    expect('cells' in diagnostic).toBe(false);
    expect(inspectPreprocessorReceipt(rejectedResult(['PREPROCESSOR_RUNTIME_ERROR'], { zeroErrors: false, runtimeObservationSummary: diagnostic }).receipt)).toBe(true);
    cases += 1;
  }
  expect(cases).toBe(72);
  expect(() => new RuntimePreparationTracker(0 as never)).toThrow();
  const tracker = new RuntimePreparationTracker(1);
  expect(() => tracker.enter('not-a-substage' as never)).toThrow();
});

test('classifies the hostile five-step by three-run identity-bind matrix with aggregate-only monotonic progress', async () => {
  const hostile = { privateSentinel: 'PRIVATE_EXCEPTION_COPY_CREDENTIAL_PATH_SELECTOR_URL_DOM_RESOURCE_PIXEL' };
  let cases = 0;
  for (const runOrdinal of [1, 2, 3] as const) for (const step of IDENTITY_BIND_FAILURE_STEPS) {
    const tracker = identityTrackerAt(runOrdinal, step);
    await expect(Promise.resolve().then(() => trackIdentityBindOperation(tracker, step, () => { throw hostile; }))).rejects.toBe(hostile);
    const diagnostic = tracker.failure();
    expect(diagnostic.variant).toBe('identity-bind-failure');
    expect(JSON.stringify(diagnostic)).not.toContain(hostile.privateSentinel);
    expect(inspectPreprocessorReceipt(rejectedResult(['PREPROCESSOR_RUNTIME_ERROR'], { zeroErrors: false, runtimeObservationSummary: diagnostic }).receipt)).toBe(true);
    cases += 1;
  }
  expect(cases).toBe(15);
  expect(() => new IdentityBindFailureTracker(1, 0)).toThrow();
  expect(() => new IdentityBindFailureTracker(1, 2).enter('identity-read')).toThrow();
});

test('classifies the hostile 12-operation by three-run identity-derivation matrix without caught or per-node data', () => {
  const hostile = 'PRIVATE_EXCEPTION_COPY_CREDENTIAL_PATH_SELECTOR_URL_DOM_RESOURCE_PIXEL';
  let cases = 0;
  for (const runOrdinal of [1, 2, 3] as const) for (const operation of IDENTITY_DERIVATION_OPERATIONS) {
    const tracker = new IdentityBindFailureTracker(runOrdinal, 3);
    const evaluationEntered = operation !== 'evaluation-dispatch';
    const enumerationComplete = !['evaluation-dispatch', 'encoder-initialize', 'element-enumeration'].includes(operation);
    tracker.recordDerivationFailure(operation, evaluationEntered, enumerationComplete);
    const diagnostic = tracker.failure();
    expect(diagnostic).toEqual({ schemaVersion: 'motion.browser-resolved-runtime-observation-diagnostic.v1', variant: 'identity-derivation-failure', completeness: 'incomplete', stage: 'preparation-execution', failure: { runOrdinal, substage: 'identity-bind', step: 'derive-node-identities', operation, evaluationEntered, enumerationComplete } });
    expect(JSON.stringify(diagnostic)).not.toContain(hostile);
    expect(inspectPreprocessorReceipt(rejectedResult(['PREPROCESSOR_RUNTIME_ERROR'], { zeroErrors: false, runtimeObservationSummary: diagnostic }).receipt)).toBe(true);
    cases += 1;
  }
  expect(cases).toBe(36);
  const tracker = new IdentityBindFailureTracker(1, 1);
  expect(() => tracker.recordDerivationFailure('evaluation-dispatch', true, false)).toThrow();
  expect(() => tracker.recordDerivationFailure('element-enumeration', true, true)).toThrow();
  expect(() => tracker.recordDerivationFailure('sibling-selection', true, false)).toThrow();
});

test('exact npx-tsx serialization route rejects a nested digest callback and accepts identical inline digest operations', () => {
  const directory = mkdtempSync(join(process.cwd(), '.tmp-motion-digest-route-'));
  const execute = (mode: 'nested' | 'inline') => {
    const script = join(directory, `${mode}.mts`);
    const digestBody = mode === 'nested'
      ? `const digest=async(value:string):Promise<string>=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',encode.encode(value)))].map(byte=>byte.toString(16).padStart(2,'0')).join('');return digest('neutral');`
      : `return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encode.encode('neutral')))].map(byte=>byte.toString(16).padStart(2,'0')).join('');`;
    writeFileSync(script, `import {chromium} from '@playwright/test';const callback=async()=>{const encode=new TextEncoder();${digestBody}};const source=callback.toString();const browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();await page.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));await page.goto('https://neutral.invalid/index.html');let runtimeRejected=false;try{await page.evaluate(callback)}catch{runtimeRejected=true}await browser.close();process.stdout.write(JSON.stringify({callbackSeen:source.length>0,freeHelperUse:source.includes('__name'),localDefinition:source.includes('var __name')||source.includes('const __name')||source.includes('function __name'),runtimeRejected}));`);
    return JSON.parse(execFileSync('npx', ['tsx', script], { encoding: 'utf8' })) as { callbackSeen: boolean; freeHelperUse: boolean; localDefinition: boolean; runtimeRejected: boolean };
  };
  try {
    expect(execute('nested')).toEqual({ callbackSeen: true, freeHelperUse: true, localDefinition: false, runtimeRejected: true });
    expect(execute('inline')).toEqual({ callbackSeen: true, freeHelperUse: false, localDefinition: false, runtimeRejected: false });
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('exact npx-tsx Chromium routes eliminate the three remaining free-helper callback leaks', () => {
  const directory = mkdtempSync(join(process.cwd(), '.tmp-motion-callback-routes-'));
  const callbacks = {
    bootstrap: {
      nested: `()=>{const counts={calls:0};const sourceCall=()=>document.currentScript!==null;window.__motionProbe=()=>{if(sourceCall())counts.calls+=1;return counts.calls}}`,
      iterative: `()=>{const counts={calls:0};window.__motionProbe=()=>{if(document.currentScript!==null)counts.calls+=1;return counts.calls}}`,
      invoke: `await context.addInitScript(callback);page.on('pageerror',()=>{runtimeRejected=true});await page.goto('https://neutral.invalid/index.html');try{result=await page.evaluate(()=>window.__motionProbe())}catch{runtimeRejected=true}`,
    },
    inventory: {
      nested: `()=>{let cssRules=0,keyframes=0,applications=0,conditionals=0;const visit=(rules)=>{for(const rule of [...rules]){cssRules+=1;if(rule instanceof CSSKeyframesRule)keyframes+=1;if(rule instanceof CSSMediaRule||rule instanceof CSSSupportsRule)conditionals+=1;if(rule instanceof CSSStyleRule){const names=rule.style.animationName.split(',').map(item=>item.trim()).filter(item=>item&&item!=='none');applications+=names.length*document.querySelectorAll(rule.selectorText).length}if('cssRules'in rule&&!(rule instanceof CSSKeyframesRule))visit(rule.cssRules)}};for(const sheet of [...document.styleSheets])visit(sheet.cssRules);return{cssRules,keyframes,applications,conditionals}}`,
      iterative: `()=>{let cssRules=0,keyframes=0,applications=0,conditionals=0;for(const sheet of [...document.styleSheets]){const pending=[...sheet.cssRules].reverse();while(pending.length>0){const rule=pending.pop();cssRules+=1;if(rule instanceof CSSKeyframesRule)keyframes+=1;if(rule instanceof CSSMediaRule||rule instanceof CSSSupportsRule)conditionals+=1;if(rule instanceof CSSStyleRule){const names=rule.style.animationName.split(',').map(item=>item.trim()).filter(item=>item&&item!=='none');applications+=names.length*document.querySelectorAll(rule.selectorText).length}if('cssRules'in rule&&!(rule instanceof CSSKeyframesRule))pending.push(...[...rule.cssRules].reverse())}}return{cssRules,keyframes,applications,conditionals}}`,
      invoke: `await page.goto('https://neutral.invalid/index.html');try{result=await page.evaluate(callback)}catch{runtimeRejected=true}`,
    },
    ledger: {
      nested: `()=>{const paths=[];let rootRuleIndex=0;const visit=(rules,parentPath=[])=>{for(const [localIndex,rule]of[...rules].entries()){const cssPath=parentPath.length===0?[rootRuleIndex++]:[...parentPath,localIndex];paths.push(cssPath);if('cssRules'in rule&&!(rule instanceof CSSKeyframesRule))visit(rule.cssRules,cssPath)}};for(const sheet of [...document.styleSheets])visit(sheet.cssRules);return paths}`,
      iterative: `()=>{const paths=[];let rootRuleIndex=0;for(const sheet of [...document.styleSheets]){const pending=[...sheet.cssRules].map((rule,localIndex)=>({rule,parentPath:[],localIndex})).reverse();while(pending.length>0){const{rule,parentPath,localIndex}=pending.pop();const cssPath=parentPath.length===0?[rootRuleIndex++]:[...parentPath,localIndex];paths.push(cssPath);if('cssRules'in rule&&!(rule instanceof CSSKeyframesRule))pending.push(...[...rule.cssRules].map((child,childIndex)=>({rule:child,parentPath:cssPath,localIndex:childIndex})).reverse())}}return paths}`,
      invoke: `await page.goto('https://neutral.invalid/index.html');try{result=await page.evaluate(callback)}catch{runtimeRejected=true}`,
    },
  } as const;
  const execute = (kind: keyof typeof callbacks, mode: 'nested' | 'iterative') => {
    const script = join(directory, `${kind}-${mode}.mts`);
    const shape = callbacks[kind];
    writeFileSync(script, `import{chromium}from'@playwright/test';const callback=${shape[mode]};const source=callback.toString();const browser=await chromium.launch({headless:true});const context=await browser.newContext();const page=await context.newPage();await page.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><head><style>.a{animation:k 1s}@keyframes k{from{opacity:0}to{opacity:1}}@media (prefers-reduced-motion:reduce){.a{animation-duration:1ms}}</style></head><body><div class="a"></div></body></html>'}));let runtimeRejected=false,result=null;${shape.invoke};await browser.close();process.stdout.write(JSON.stringify({callbackSeen:source.length>0,freeHelperUse:source.includes('__name'),localDefinition:source.includes('var __name')||source.includes('const __name')||source.includes('function __name'),runtimeRejected,result}));`);
    return JSON.parse(execFileSync('npx', ['tsx', script], { encoding: 'utf8' })) as { callbackSeen: boolean; freeHelperUse: boolean; localDefinition: boolean; runtimeRejected: boolean; result: unknown };
  };
  try {
    for (const kind of Object.keys(callbacks) as Array<keyof typeof callbacks>) {
      expect(execute(kind, 'nested')).toMatchObject({ callbackSeen: true, freeHelperUse: true, localDefinition: false, runtimeRejected: true });
      const corrected = execute(kind, 'iterative');
      expect(corrected).toMatchObject({ callbackSeen: true, freeHelperUse: false, localDefinition: false, runtimeRejected: false });
      if (kind === 'bootstrap') expect(corrected.result).toBe(0);
      if (kind === 'inventory') expect(corrected.result).toEqual({ cssRules: 4, keyframes: 1, applications: 1, conditionals: 1 });
      if (kind === 'ledger') expect(corrected.result).toEqual([[0], [1], [2], [2, 0]]);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 60_000);

test('neutral 14-element two-keyframe four-application fixture completes and keeps invalid identity binds coded', async () => {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true }); const version = browser.version(); await browser.close();
  const valid = neutralBindingInput(version);
  const { precommitLockedOwnerInputCandidate } = await import('./index.js');
  const completed = await precommitLockedOwnerInputCandidate(lockOwnerInput(valid));
  expect(completed.receipt.diagnosticCodes).toEqual([]);
  expect(completed.candidatePackage).not.toBeNull();
  expect(completed.candidatePackage?.detailedEvidence.expectedInventory).toEqual(valid.expectedInventory);
  expect(completed.candidatePackage?.detailedEvidence.preparationRuns.every((run) => JSON.stringify(run.inventory) === JSON.stringify(valid.expectedInventory))).toBe(true);
  const cssLedgerPaths = completed.candidatePackage?.detailedEvidence.preparationRuns[0]?.ledger
    .filter((record) => ['css-rule', 'keyframe', 'conditional'].includes(record.kind))
    .map((record) => JSON.parse(record.canonicalInput) as { path: number[] })
    .map((record) => record.path)
    .sort((a, b) => { for (let index = 0; index < Math.max(a.length, b.length); index += 1) { if (a[index] === undefined) return -1; if (b[index] === undefined) return 1; if (a[index] !== b[index]) return a[index]! - b[index]!; } return 0; });
  expect(cssLedgerPaths).toEqual([[0], [1], [2], [3], [4], [5], [6], [6, 0]]);
  expect(completed.candidatePackage?.detailedEvidence.preparationRuns.every((run) => JSON.stringify(run.ledger) === JSON.stringify(completed.candidatePackage?.detailedEvidence.preparationRuns[0]?.ledger))).toBe(true);
  const repeated = await precommitLockedOwnerInputCandidate(lockOwnerInput(valid));
  expect(JSON.stringify(repeated.candidatePackage)).toBe(JSON.stringify(completed.candidatePackage));
  expect(JSON.stringify(repeated.receipt)).toBe(JSON.stringify(completed.receipt));
  expect(JSON.stringify(repeated.candidatePackage?.detailedEvidence.sourceRuns)).toBe(JSON.stringify(completed.candidatePackage?.detailedEvidence.sourceRuns));
  expect(JSON.stringify(repeated.candidatePackage?.detailedEvidence.replayRuns)).toBe(JSON.stringify(completed.candidatePackage?.detailedEvidence.replayRuns));
  if (process.env.T069_BYTE_ORACLE) writeFileSync(process.env.T069_BYTE_ORACLE, JSON.stringify({ candidatePackageSha256: sha256(JSON.stringify(completed.candidatePackage)), receiptSha256: sha256(JSON.stringify(completed.receipt)), replayPackageSha256: completed.candidatePackage?.replayPackage.sha256, provenanceSha256: sha256(JSON.stringify(completed.candidatePackage?.detailedEvidence.provenance)) }));

  const renamed = { ...valid, bindings: valid.bindings.map((binding) => ({ ...binding, locator: binding.locator.replace('.', '.alias-') })) };
  const renamedResult = await precommitLockedOwnerInputCandidate(lockOwnerInput(renamed));
  expect(renamedResult.receipt.diagnosticCodes).toEqual([]);
  expect(renamedResult.candidatePackage?.detailedEvidence.provenance).toEqual(completed.candidatePackage?.detailedEvidence.provenance);
  expect(renamedResult.candidatePackage?.replayPackage.html).toBe(completed.candidatePackage?.replayPackage.html);

  const missing = { ...valid, bindings: valid.bindings.map((binding, index) => index === 0 ? { ...binding, locator: '.object-missing' } : binding) };
  const missingResult = await precommitLockedOwnerInputCandidate(lockOwnerInput(missing));
  expect(missingResult.receipt.diagnosticCodes).toEqual(['PREPROCESSOR_BINDING_INVALID']);
  expect(missingResult.receipt.runtimeObservationSummary).toBeUndefined();
  const duplicateHtml = valid.sourceLock.responses[0]!.body.replace('class="accent"', 'class="accent object-a"');
  const duplicate = withEntryHtml(valid, duplicateHtml);
  const duplicateResult = await precommitLockedOwnerInputCandidate(lockOwnerInput(duplicate));
  expect(duplicateResult.receipt.diagnosticCodes).toEqual(['PREPROCESSOR_BINDING_INVALID']);
  expect(duplicateResult.receipt.runtimeObservationSummary).toBeUndefined();
}, 60_000);

test('neutral origin reproduction isolates non-trustworthy WebCrypto availability with five booleans only', async () => {
  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({ headless: true });
  const html = '<!doctype html><html><head><meta charset="utf-8"><title>Neutral</title></head><body><main><div></div></main></body></html>';
  const probe = async (entry: string) => {
    const context = await browser.newContext(); const page = await context.newPage();
    await page.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: html }));
    await page.goto(entry, { waitUntil: 'load' });
    const result = await page.evaluate(async () => { let digestProbePassed = false; try { await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode('neutral')); digestProbePassed = true; } catch {} return { secureContext: globalThis.isSecureContext, textEncoderAvailable: typeof TextEncoder === 'function', cryptoAvailable: typeof globalThis.crypto === 'object', subtleAvailable: typeof globalThis.crypto?.subtle === 'object', digestProbePassed }; });
    await context.close(); return result;
  };
  const secure = await probe('https://opaque-secure.invalid/index.html');
  const nonTrustworthy = await probe('http://opaque-nontrustworthy.invalid/index.html');
  const loopback = await probe('http://127.0.0.1/index.html');
  await browser.close();
  expect(secure).toEqual({ secureContext: true, textEncoderAvailable: true, cryptoAvailable: true, subtleAvailable: true, digestProbePassed: true });
  expect(loopback).toEqual(secure);
  expect(nonTrustworthy).toEqual({ secureContext: false, textEncoderAvailable: true, cryptoAvailable: true, subtleAvailable: false, digestProbePassed: false });

  const versionBrowser = await chromium.launch({ headless: true }); const version = versionBrowser.version(); await versionBrowser.close();
  const { precommitLockedOwnerInputCandidate } = await import('./index.js');
  const loopbackResult = await precommitLockedOwnerInputCandidate(lockOwnerInput(neutralBindingInput(version, 'http://127.0.0.1/index.html')));
  expect(loopbackResult.candidatePackage).not.toBeNull();
  const rejected = await precommitLockedOwnerInputCandidate(lockOwnerInput(neutralBindingInput(version, 'http://opaque-nontrustworthy.invalid/index.html')));
  expect(rejected.receipt.diagnosticCodes).toEqual(['PREPROCESSOR_RUNTIME_ERROR']);
  expect(rejected.receipt.runtimeObservationSummary).toEqual({ schemaVersion: 'motion.browser-resolved-runtime-observation-diagnostic.v1', variant: 'identity-derivation-failure', completeness: 'incomplete', stage: 'preparation-execution', failure: { runOrdinal: 1, substage: 'identity-bind', step: 'derive-node-identities', operation: 'provenance-digest', evaluationEntered: true, enumerationComplete: true } });
}, 60_000);

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

function neutralBindingInput(browserVersion: string, entryRequest = 'https://locked.test/index.html'): OwnerInput {
  const css = `.stage{display:block}.object-a{animation:neutral-move 2100ms linear both,neutral-fade 2100ms linear both}.object-b{animation:neutral-move 2100ms linear both,neutral-fade 2100ms linear both}.accent{opacity:.5}@keyframes neutral-move{from{transform:translateX(0)}to{transform:translateX(20px)}}@keyframes neutral-fade{from{opacity:.25}to{opacity:1}}@media (prefers-reduced-motion:reduce){.object-a,.object-b{animation-duration:1ms}}`;
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Neutral</title><style>${css}</style></head><body><main class="stage"><section><div class="object-a alias-object-a"><span></span></div><div class="object-b alias-object-b"></div><div class="accent"></div><button class="control alias-control" type="button">Run</button><p>Neutral</p></section></main></body></html>`;
  return { schemaVersion: 'motion.browser-resolved-owner-input.v3', protocolVersion: 'browser-resolved-preprocessor.v3', sourceLock: { entryRequest, originalSha256: sha256(html), redirects: [], responses: [{ requestUrl: entryRequest, status: 200, headers: {}, mimeType: 'text/html', body: html, bodySha256: sha256(html) }] }, environment: { browserName: 'chromium', browserVersion, viewport: { width: 640, height: 360 }, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC', colorScheme: 'light', contrast: 'no-preference', profiles: ['normal', 'reduced'] }, bindings: [{ bindingId: 'binding_object_a', role: 'focal', locator: '.object-a', expectedMatches: 1 }, { bindingId: 'binding_object_b', role: 'secondary', locator: '.object-b', expectedMatches: 1 }, { bindingId: 'binding_control', role: 'trigger', locator: '.control', expectedMatches: 1 }], procedure: { readiness: 'dom-fonts-two-animation-frames', start: [{ kind: 'click', bindingId: 'binding_control' }], actions: [], loopDurationMs: 2100, settledTimeMs: 2100, epsilonMs: 1, reset: 'reload-reapply-and-compare-initial' }, expectedInventory: { dom: 14, cssRules: 8, keyframes: 2, applications: 4, scripts: 0, resources: 0, pseudos: 0, conditionals: 1, transitions: 0, animatedBindingIds: ['binding_object_a', 'binding_object_b'] }, closedProfile: { categories: [...CLOSED_PROFILE_CATEGORIES], counts: { structural: 14, css: 8, application: 4, resource: 1, 'binding-action': 4, event: 3, reset: 1 } } };
}

function identityTrackerAt(runOrdinal: 1 | 2 | 3, step: IdentityBindFailureStep): IdentityBindFailureTracker {
  const tracker = new IdentityBindFailureTracker(runOrdinal, 2);
  if (step === 'derive-node-identities') return tracker;
  tracker.enter('derive-node-identities'); tracker.completeDerivation();
  if (step === 'locator-count') return tracker;
  tracker.enter('locator-count'); tracker.completeLocatorCheck();
  if (step === 'identity-read') return tracker;
  tracker.enter('identity-read'); tracker.completeIdentityRead();
  if (step === 'binding-marker-write') return tracker;
  tracker.enter('binding-marker-write'); tracker.completeMarkerWrite();
  tracker.enter('locator-count'); tracker.completeLocatorCheck(); tracker.enter('identity-read'); tracker.completeIdentityRead(); tracker.enter('binding-marker-write'); tracker.completeMarkerWrite();
  return tracker;
}
