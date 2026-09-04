import { chromium, type Browser, type BrowserContext, type Page, type Route } from '@playwright/test';
import { parse, serialize } from 'parse5';
import postcss from 'postcss';
import valueParser from 'postcss-value-parser';

import {
  applicationInstanceId, deriveMotionEvidenceBoundaries, expandBoundarySamples,
  normalizeAnimationInstance, type SemanticAnimationInstance,
} from '../../domain/src/css-motion-semantics.js';

import {
  ADMISSION_SCHEMA_VERSION, CANDIDATE_SCHEMA_VERSION, CLOSED_PROFILE_CATEGORIES, IDENTITY_BIND_FAILURE_STEPS, IDENTITY_DERIVATION_OPERATIONS, PREPROCESSOR_VERSION, RECEIPT_SCHEMA_VERSION, RUNTIME_OBSERVATION_DIAGNOSTIC_SCHEMA_VERSION, RUNTIME_OBSERVATION_SUBSTAGES, RUNTIME_PREPARATION_SUBSTAGES,
  buildClosedProfileReport, decodeLockedOwnerInput, inspectAdmissionPackage, inspectCandidatePackage, rejectedResult, sha256, stableJson,
  type AdmissionPackage, type CandidatePackage, type ClosedProfileReport, type ConstructRecord, type DiagnosticCode, type DetailedEvidence,
  type ExternallyAuthenticatedExpectedRoot, type IntegratedPreprocessorResult, type LockedOwnerInput, type OwnerAction, type OwnerBinding,
  type OwnerInput, type PreprocessorCandidateResult, type PreprocessorReceipt, type ReplayPackage, type SamplePoint,
  type IdentityBindFailureStep, type IdentityBindProgress, type IdentityDerivationOperation, type RuntimeObservationSubstage, type RuntimeObservationSummary, type RuntimePreparationSubstage,
} from './index.js';

export * from './acquisition-model.js';
import type { AnimationRecord, Inventory, LockedStylesheet, Observation, Prepared, StateRecord } from './acquisition-model.js';
export * from './runtime-trackers.js';
import {
  IdentityBindFailureTracker, RuntimeObservationTracker, RuntimePreparationTracker,
  snapshotRuntimeActivity, summarizeRuntimeObservations, trackRuntimeObservationOperation,
  trackRuntimePreparationOperation,
} from './runtime-trackers.js';

export const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
export const REGISTERED_HTML_ELEMENTS = new Set([
  'html', 'head', 'body', 'meta', 'title', 'style', 'link',
  'main', 'section', 'div', 'span', 'p', 'label', 'button', 'input',
]);
export const REGISTERED_GLOBAL_ATTRIBUTES = new Set(['id', 'class', 'lang', 'role', 'tabindex', 'hidden']);
export const REGISTERED_ELEMENT_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
  meta: new Set(['charset']), link: new Set(['rel', 'href']),
  input: new Set(['type', 'checked', 'disabled', 'value', 'name']),
  button: new Set(['type', 'disabled']), label: new Set(['for']),
};

export async function precommitLockedOwnerInputCandidate(locked: LockedOwnerInput | unknown): Promise<PreprocessorCandidateResult> {
  const generated = await generateCandidate(locked);
  return { candidatePackage: generated.candidatePackage, receipt: generated.receipt };
}

export async function acquireAndPreprocessLockedOwnerInput(
  locked: LockedOwnerInput | unknown,
  authenticatedRoot?: ExternallyAuthenticatedExpectedRoot,
): Promise<IntegratedPreprocessorResult> {
  const generated = await generateCandidate(locked);
  if (!generated.candidatePackage) return generated.result;
  const decoded = decodeLockedOwnerInput(locked);
  const expectedRoot = authenticatedRoot?.expectedRoot;
  if (!decoded.input || !authenticatedRoot || !expectedRoot || authenticatedRoot.authentication !== 'external-preexisting'
    || sha256(stableJson(expectedRoot)) !== authenticatedRoot.externallyAuthenticatedRootSha256
    || expectedRoot.ownerInputLockSha256 !== (locked as LockedOwnerInput).sha256
    || expectedRoot.candidatePackageSha256 !== generated.candidatePackage.sha256
    || inspectCandidatePackage(generated.candidatePackage).integrity !== 'valid') return rejectedResult(['PREPROCESSOR_ARTIFACT_INVALID'], candidateEvidence(generated.receipt));
  const receipt = { ...generated.candidatePackage.receipt, admitted: true, candidatePackageSha256: generated.candidatePackage.sha256 } as const;
  const core = { schemaVersion: ADMISSION_SCHEMA_VERSION, expectedRoot, candidatePackage: generated.candidatePackage, receipt } as const;
  const bytes = stableJson(core);
  const admissionPackage: AdmissionPackage = { ...core, bytes, sha256: sha256(bytes) };
  if (inspectAdmissionPackage(admissionPackage, authenticatedRoot).integrity !== 'valid') return rejectedResult(['PREPROCESSOR_ARTIFACT_INVALID'], candidateEvidence(generated.receipt));
  return {
    admissionPackage, replayPackage: generated.candidatePackage.replayPackage,
    detailedEvidence: generated.candidatePackage.detailedEvidence, receipt,
  };
}

type GeneratedCandidate = Readonly<{ candidatePackage: CandidatePackage | null; receipt: PreprocessorReceipt; result: IntegratedPreprocessorResult }>;
async function generateCandidate(locked: LockedOwnerInput | unknown): Promise<GeneratedCandidate> {
  const decoded = decodeLockedOwnerInput(locked);
  const reject = (codes: readonly DiagnosticCode[], evidence: Partial<PreprocessorReceipt> = {}): GeneratedCandidate => { const result = rejectedResult(codes, evidence); return { candidatePackage: null, receipt: result.receipt, result }; };
  if (!decoded.input || decoded.diagnostics.length > 0) return reject(decoded.diagnostics, { ownerInputLockVerified: decoded.lockVerified });
  const input = decoded.input;
  const ownerInputLockSha256 = sha256((locked as LockedOwnerInput).bytes);
  const captureNamespaceSha256 = sha256(stableJson(input.sourceLock));
  const preflight = validateOwnerInputSemantics(input);
  if (preflight.length > 0) return reject(preflight, { ownerInputLockVerified: true });

  const browser = await chromium.launch({ headless: true });
  try {
    if (browser.version() !== input.environment.browserVersion) {
      return reject(['PREPROCESSOR_BROWSER_MISMATCH'], { ownerInputLockVerified: true });
    }
    let prepared: Prepared;
    let preparedRuns: readonly Prepared[];
    let preparationTracker: RuntimePreparationTracker | null = null;
    try {
      const runs: Prepared[] = [];
      for (const runOrdinal of [1, 2, 3] as const) { preparationTracker = new RuntimePreparationTracker(runOrdinal); runs.push(await prepare(browser, input, captureNamespaceSha256, preparationTracker)); }
      trackRuntimePreparationOperation(preparationTracker!, 'cross-run-stability', () => { if (new Set(runs.map((run) => stableJson(run))).size !== 1) throw coded('PREPROCESSOR_CAPTURE_UNSTABLE'); });
      preparedRuns = runs;
      prepared = runs[0]!;
    } catch (error) {
      const diagnostic = diagnosticFromError(error);
      return reject([diagnostic], { ownerInputLockVerified: true, browserPinned: true, ...(diagnostic === 'PREPROCESSOR_RUNTIME_ERROR' && preparationTracker ? { runtimeObservationSummary: preparationTracker.rejectedFailure() } : {}) });
    }
    if (stableJson(prepared.inventory) !== stableJson(input.expectedInventory)) {
      return reject(['PREPROCESSOR_INVENTORY_MISMATCH'], {
        ownerInputLockVerified: true, browserPinned: true, lockedRoutingComplete: prepared.errors.length === 0,
      });
    }
    const closedProfile = buildClosedProfileReport(prepared.ledger);
    if (!closedProfileMatchesOwnerInput(closedProfile, input)) {
      const unsupported = closedProfile.records.some((item) => item.disposition === 'unsupported');
      return reject([unsupported ? 'PREPROCESSOR_CONSTRUCT_UNSUPPORTED' : 'PREPROCESSOR_INVENTORY_MISMATCH'], {
        ownerInputLockVerified: true, browserPinned: true, lockedRoutingComplete: prepared.errors.length === 0,
      });
    }
    if (prepared.schedule.length < 3) return reject(['PREPROCESSOR_BOUNDARY_INCOMPLETE'], { ownerInputLockVerified: true, browserPinned: true, lockedRoutingComplete: true, closedProfileCovered: true });
    if (prepared.mutations > 0 || prepared.errors.length > 0) return reject(['PREPROCESSOR_CONSTRUCT_UNSUPPORTED'], { ownerInputLockVerified: true, browserPinned: true, lockedRoutingComplete: true, closedProfileCovered: true, boundariesComplete: true });

    const sourceRuns: Array<{ profile: 'normal' | 'reduced'; observation: Observation }> = [];
    const replayRuns: Array<{ profile: 'normal' | 'reduced'; observation: Observation }> = [];
    let activeTracker: RuntimeObservationTracker | null = null;
    try {
      for (const profile of input.environment.profiles) {
        for (let run = 0; run < 3; run += 1) {
          const runOrdinal = (run + 1) as 1 | 2 | 3;
          activeTracker = new RuntimeObservationTracker(profile, 'source', runOrdinal);
          sourceRuns.push({ profile, observation: await observeSource(browser, input, profile, prepared.schedule, prepared.provenance, captureNamespaceSha256, activeTracker) });
          activeTracker = new RuntimeObservationTracker(profile, 'replay', runOrdinal);
          replayRuns.push({ profile, observation: await observeReplay(browser, input, prepared.replayHtml, prepared.replayCss, profile, prepared.schedule, prepared.provenance, activeTracker) });
        }
      }
    } catch (error) {
      const diagnostic = diagnosticFromError(error);
      return reject([diagnostic], { ownerInputLockVerified: true, browserPinned: true, lockedRoutingComplete: true, closedProfileCovered: true, boundariesComplete: true, ...(diagnostic === 'PREPROCESSOR_RUNTIME_ERROR' && activeTracker ? { runtimeObservationSummary: activeTracker.earlyFailure() } : {}) });
    }

    const profilesComplete = sourceRuns.length === 6 && replayRuns.length === 6;
    const sourceStable = runsStable(sourceRuns);
    const replayStable = runsStable(replayRuns);
    const threeCleanRuns = profilesComplete && sourceStable && replayStable;
    const provenanceExpected = stableJson(prepared.provenance);
    const stableIdentityProven = [...sourceRuns, ...replayRuns].every((run) => stableJson(run.observation.provenance) === provenanceExpected);
    const replayEquivalent = sourceRuns.every((run, index) => semanticObservation(run.observation) === semanticObservation(replayRuns[index]!.observation));
    const resetEquivalent = [...sourceRuns, ...replayRuns].every((run) => run.observation.resetCheckpoints.afterStart === run.observation.resetCheckpoints.afterReset)
      && sourceRuns.every((run, index) => stableJson(run.observation.resetCheckpoints) === stableJson(replayRuns[index]!.observation.resetCheckpoints));
    const zeroReplayRequests = replayRuns.every((run) => run.observation.requests.length === 0);
    const zeroErrors = [...sourceRuns, ...replayRuns].every((run) => run.observation.errors.length === 0 && run.observation.mutations === 0);
    const diagnostics: DiagnosticCode[] = [];
    if (!threeCleanRuns) diagnostics.push('PREPROCESSOR_CAPTURE_UNSTABLE');
    if (!stableIdentityProven || !replayEquivalent) diagnostics.push('PREPROCESSOR_EQUIVALENCE_FAILED');
    if (!resetEquivalent) diagnostics.push('PREPROCESSOR_RESET_UNEQUAL');
    if (!zeroReplayRequests) diagnostics.push('PREPROCESSOR_NETWORK_ACTIVITY');
    if (!zeroErrors) diagnostics.push('PREPROCESSOR_RUNTIME_ERROR');
    if (diagnostics.length > 0) return reject(diagnostics, {
      ownerInputLockVerified: true, browserPinned: true, lockedRoutingComplete: true, closedProfileCovered: true,
      boundariesComplete: true, profilesComplete, threeCleanRuns, stableIdentityProven, replayEquivalent,
      resetEquivalent, zeroReplayRequests, zeroErrors,
      ...(diagnostics.includes('PREPROCESSOR_RUNTIME_ERROR') ? { runtimeObservationSummary: summarizeRuntimeObservations(sourceRuns, replayRuns) } : {}),
    });

    const receiptCore: PreprocessorReceipt = {
      schemaVersion: RECEIPT_SCHEMA_VERSION, protocolVersion: PREPROCESSOR_VERSION,
      ownerInputLockVerified: true, browserPinned: true, lockedRoutingComplete: true, closedProfileCovered: true,
      boundariesComplete: true, profilesComplete: true, threeCleanRuns: true, stableIdentityProven: true,
      replayEquivalent: true, resetEquivalent: true, zeroReplayRequests: true, zeroErrors: true,
      deterministicExecution: true, admitted: false, diagnosticCodes: [],
    };
    const candidates = preparedRuns.map((candidate) => makeCandidatePackage({
      input, ownerInputLockSha256, captureNamespaceSha256, candidate, preparedRuns, sourceRuns, replayRuns,
      actualBrowserVersion: browser.version(), receiptCore,
    }));
    const deterministicExecution = new Set(candidates.map((candidate) => stableJson(candidate))).size === 1;
    if (!deterministicExecution) return reject(['PREPROCESSOR_CAPTURE_UNSTABLE'], {
      ownerInputLockVerified: true, browserPinned: true, lockedRoutingComplete: true, closedProfileCovered: true,
      boundariesComplete: true, profilesComplete: true, threeCleanRuns: true, stableIdentityProven: true,
      replayEquivalent: true, resetEquivalent: true, zeroReplayRequests: true, zeroErrors: true,
    });
    const candidatePackage = candidates[0]!; const result: IntegratedPreprocessorResult = { admissionPackage: null, replayPackage: null, detailedEvidence: null, receipt: candidatePackage.receipt };
    return { candidatePackage, receipt: candidatePackage.receipt, result };
  } finally {
    await browser.close();
  }
}

function closedProfileMatchesOwnerInput(report: ClosedProfileReport, input: OwnerInput): boolean {
  return report.parseErrors.length === 0
    && report.unregistered.length === 0
    && stableJson(report.categories) === stableJson(CLOSED_PROFILE_CATEGORIES)
    && stableJson(report.counts) === stableJson(input.closedProfile.counts)
    && CLOSED_PROFILE_CATEGORIES.every((category) => report.records.some((item) => item.category === category))
    && report.records.every((item) => item.disposition !== 'unsupported');
}

function makeCandidatePackage(args: Readonly<{
  input: OwnerInput; ownerInputLockSha256: string; captureNamespaceSha256: string; candidate: Prepared;
  preparedRuns: readonly Prepared[]; sourceRuns: readonly { profile: 'normal' | 'reduced'; observation: Observation }[];
  replayRuns: readonly { profile: 'normal' | 'reduced'; observation: Observation }[]; actualBrowserVersion: string;
  receiptCore: PreprocessorReceipt;
}>): CandidatePackage {
  const { input, ownerInputLockSha256, captureNamespaceSha256, candidate, preparedRuns, sourceRuns, replayRuns, actualBrowserVersion, receiptCore } = args;
  const replayCore = { protocolVersion: PREPROCESSOR_VERSION, html: candidate.replayHtml, css: candidate.replayCss } as const;
  const replayBytes = stableJson(replayCore); const replayPackage: ReplayPackage = { ...replayCore, bytes: replayBytes, sha256: sha256(replayBytes) };
  const detailedEvidence: DetailedEvidence = {
    ownerInputLockSha256, originalCaptureSha256: input.sourceLock.originalSha256, captureNamespaceSha256,
    browserEnvironment: input.environment, actualBrowserVersion, expectedInventory: input.expectedInventory, expectedCoverageCounts: input.closedProfile.counts,
    expectedLockedRequestUrls: [...input.sourceLock.responses.map((response) => response.requestUrl), ...input.sourceLock.redirects.map((redirect) => redirect.from)].sort(),
    closedProfile: buildClosedProfileReport(candidate.ledger), boundarySchedule: candidate.schedule, provenance: candidate.provenance,
    preparationRuns: preparedRuns, sourceRuns, replayRuns,
  };
  const receipt: PreprocessorReceipt = {
    ...receiptCore, detailedEvidenceSha256: sha256(stableJson(detailedEvidence)),
  };
  const packageCore = { schemaVersion: CANDIDATE_SCHEMA_VERSION, ownerInputLockSha256, replayPackage, detailedEvidence, receipt } as const;
  const bytes = stableJson(packageCore);
  return { ...packageCore, bytes, sha256: sha256(bytes) };
}

function candidateEvidence(receipt: PreprocessorReceipt): Partial<PreprocessorReceipt> {
  return {
    ownerInputLockVerified: receipt.ownerInputLockVerified,
    browserPinned: receipt.browserPinned,
    lockedRoutingComplete: receipt.lockedRoutingComplete,
    closedProfileCovered: receipt.closedProfileCovered,
    boundariesComplete: receipt.boundariesComplete,
    profilesComplete: receipt.profilesComplete,
    threeCleanRuns: receipt.threeCleanRuns,
    stableIdentityProven: receipt.stableIdentityProven,
    replayEquivalent: receipt.replayEquivalent,
    resetEquivalent: receipt.resetEquivalent,
    zeroReplayRequests: receipt.zeroReplayRequests,
    zeroErrors: receipt.zeroErrors,
    deterministicExecution: receipt.deterministicExecution,
  };
}

export function canonicalApplication(animation: AnimationRecord): string {
  const { playState: _runtimePlayState, ...declarative } = animation;
  return stableJson(declarative);
}

export function constructId(kind: ConstructRecord['kind'], canonicalInput: string): string { return `construct_${sha256(`${kind}:${canonicalInput}`).slice(0, 24)}`; }

export function canonicalCssAst(node: postcss.Rule | postcss.AtRule, headerOnly: boolean): unknown {
  if (node.type === 'rule') return { type: 'rule', selector: normalizeSelector(node.selector).replace(/^from$/i, '0%').replace(/^to$/i, '100%'), declarations: canonicalDeclarations(node.nodes) };
  const head = { type: 'atrule', name: node.name.toLowerCase(), params: normalizeCssTokenText(node.params) };
  if (headerOnly) return head;
  return { ...head, children: (node.nodes ?? []).map((child) => child.type === 'decl'
    ? canonicalDeclaration(child)
    : child.type === 'rule' || child.type === 'atrule' ? canonicalCssAst(child, false) : { type: child.type, text: normalizeCssTokenText(child.toString()) }) };
}
function canonicalDeclarations(nodes: postcss.Container['nodes'] | undefined): unknown[] {
  return (nodes ?? []).map((child) => child.type === 'decl' ? canonicalDeclaration(child) : { type: child.type, text: normalizeCssTokenText(child.toString()) });
}
function canonicalDeclaration(declaration: postcss.Declaration): unknown {
  const prop = declaration.prop.toLowerCase();
  const value = prop === 'animation' ? expandAnimationShorthand(declaration.value) : declaration.value;
  return { prop, important: declaration.important, value: canonicalCssValue(value, prop) };
}
export function canonicalCssValue(value: string, prop: string): unknown {
  const normalizeNode = (node: valueParser.Node): unknown => {
    let numeric = node.type === 'word' && /^[-+]?(?:\d*\.\d+|\d+\.?\d*)$/.test(node.value) ? String(Number(node.value)) : node.value.toLowerCase();
    if (prop === 'transform' && node.type === 'word' && numeric === '0') numeric = '0px';
    if (node.type === 'function') {
      const nodes = node.nodes.filter((child, index, all) => !(node.value.toLowerCase() === 'steps' && child.type === 'div' && child.value === ',' && all.slice(index + 1).some((candidate) => candidate.type === 'word' && candidate.value.toLowerCase() === 'end'))
        && !(node.value.toLowerCase() === 'steps' && child.type === 'word' && child.value.toLowerCase() === 'end'));
      return { type: node.type, value: node.value.toLowerCase(), nodes: nodes.map(normalizeNode) };
    }
    return { type: node.type, value: numeric };
  };
  return valueParser(value).nodes.filter((node) => node.type !== 'space').map(normalizeNode);
}
export function expandAnimationShorthand(value: string): string {
  const groups: string[][] = [[]];
  valueParser(value).nodes.forEach((node) => {
    if (node.type === 'div' && node.value === ',') groups.push([]);
    else if (node.type !== 'space') groups.at(-1)!.push(valueParser.stringify(node));
  });
  return groups.map((tokens) => {
    if (tokens.length === 8 && /m?s$/.test(tokens[0]!) && /m?s$/.test(tokens[2]!)) return tokens.join(' ');
    if (tokens.length === 1 && tokens[0]!.toLowerCase() === 'none') return '0s ease 0s 1 normal none running auto';
    let duration = '0s'; let delay = '0s'; let timing = 'ease'; let iterations = '1'; let direction = 'normal'; let fill = 'none'; let play = 'running'; let name = 'none'; let timeCount = 0;
    for (const token of tokens) {
      const lower = token.toLowerCase();
      if (/^-?(?:\d*\.)?\d+m?s$/.test(lower)) { if (timeCount++ === 0) duration = lower; else delay = lower; }
      else if (/^(?:ease|linear|ease-in|ease-out|ease-in-out|step-start|step-end|cubic-bezier\(|steps\()/i.test(lower)) timing = lower;
      else if (lower === 'infinite' || /^\d+(?:\.\d+)?$/.test(lower)) iterations = lower;
      else if (['normal', 'reverse', 'alternate', 'alternate-reverse'].includes(lower)) direction = lower;
      else if (['none', 'forwards', 'backwards', 'both'].includes(lower)) fill = lower;
      else if (['running', 'paused'].includes(lower)) play = lower;
      else name = token;
    }
    return `${duration} ${timing} ${delay} ${iterations} ${direction} ${fill} ${play} ${name}`;
  }).join(',');
}
export function normalizeSelector(value: string): string { return value.trim().replace(/\s*([>+~])\s*/g, '$1').replace(/\s+/g, ' '); }
export function normalizeCssTokenText(value: string): string { return value.trim().replace(/\s*([():,>+~])\s*/g, '$1').replace(/\s+/g, ' ').toLowerCase(); }

async function prepare(browser: Browser, input: OwnerInput, captureNamespaceSha256: string, tracker: RuntimePreparationTracker): Promise<Prepared> {
  const runtime = await trackRuntimePreparationOperation(tracker, 'source-open', () => openLockedPage(browser, input, 'normal'));
  try {
    await trackRuntimePreparationOperation(tracker, 'readiness', () => ready(runtime.page));
    const provenance = await bindSource(runtime.page, input.bindings, captureNamespaceSha256, tracker.beginIdentityBind(input.bindings.length));
    const inventory = await trackRuntimePreparationOperation(tracker, 'inventory', () => inventoryPage(runtime.page, input.bindings));
    const replay = await trackRuntimePreparationOperation(tracker, 'replay-build', () => buildReplay(runtime.page, lockedStylesheets(input)));
    const bootstrap = await trackRuntimePreparationOperation(tracker, 'bootstrap-read', () => readBootstrapInstrumentation(runtime.page));
    trackRuntimePreparationOperation(tracker, 'bootstrap-validate', () => { if (Object.values(bootstrap).some((value) => value !== 0)) throw coded('PREPROCESSOR_CONSTRUCT_UNSUPPORTED'); });
    await trackRuntimePreparationOperation(tracker, 'instrumentation-install', () => installInstrumentation(runtime.page));
    await trackRuntimePreparationOperation(tracker, 'start-actions', () => executeActions(runtime.page, input.procedure.start, input.bindings, false));
    await trackRuntimePreparationOperation(tracker, 'actions', () => executeActions(runtime.page, input.procedure.actions, input.bindings, false));
    await trackRuntimePreparationOperation(tracker, 'settle-turn', () => runtime.page.waitForTimeout(0));
    trackRuntimePreparationOperation(tracker, 'static-runtime-validate', () => { if (inventory.pseudos > 0 || inventory.transitions > 0) throw coded('PREPROCESSOR_CONSTRUCT_UNSUPPORTED'); });
    const browserAnimationCount = await trackRuntimePreparationOperation(tracker, 'animation-count', () => runtime.page.evaluate(() => document.getAnimations().length));
    if (browserAnimationCount !== inventory.applications) throw coded('PREPROCESSOR_INVENTORY_MISMATCH');
    const animations = await trackRuntimePreparationOperation(tracker, 'animation-records', () => animationRecords(runtime.page));
    trackRuntimePreparationOperation(tracker, 'animated-identity-validate', () => { const expected = provenance.filter((item) => input.expectedInventory.animatedBindingIds.includes(item.bindingId)).map((item) => item.stableId).sort(); const actual = [...new Set(animations.map((item) => item.targetId))].sort(); if (stableJson(expected) !== stableJson(actual)) throw coded('PREPROCESSOR_INVENTORY_MISMATCH'); });
    const schedule = trackRuntimePreparationOperation(tracker, 'schedule-derive', () => deriveSchedule(animations, input));
    const runtimeEffects = await trackRuntimePreparationOperation(tracker, 'instrumentation-read', () => readInstrumentation(runtime.page));
    trackRuntimePreparationOperation(tracker, 'route-closure', () => assertLockedRequestClosure(input, runtime.requests, runtime.errors));
    const ledger = await trackRuntimePreparationOperation(tracker, 'ledger-derive', () => deriveLedger(runtime.page, input, inventory, runtime.requests, runtimeEffects, animations));
    trackRuntimePreparationOperation(tracker, 'ledger-bijection', () => assertLedgerBijection(ledger, input, inventory, replay.html));
    trackRuntimePreparationOperation(tracker, 'replay-safety', () => assertReplayStructurallySafe(replay.html, replay.css));
    return trackRuntimePreparationOperation(tracker, 'result-assemble', () => ({
      replayHtml: replay.html, replayCss: replay.css, inventory, ledger, schedule, provenance,
      requestLedger: snapshotRuntimeActivity(runtime.requests), errors: snapshotRuntimeActivity(runtime.errors), mutations: runtimeEffects.mutations,
    }));
  } finally { await tracker.close(() => runtime.context.close()); }
}

async function observeSource(browser: Browser, input: OwnerInput, profile: 'normal' | 'reduced', schedule: readonly SamplePoint[], provenance: Prepared['provenance'], captureNamespaceSha256: string, tracker: RuntimeObservationTracker): Promise<Observation> {
  const runtime = await trackRuntimeObservationOperation(tracker, 'source-open', () => openLockedPage(browser, input, profile));
  try { return await observe(runtime, input, schedule, provenance, false, captureNamespaceSha256, tracker); } finally { await tracker.close(() => runtime.context.close()); }
}
async function observeReplay(browser: Browser, input: OwnerInput, replayHtml: string, replayCss: string, profile: 'normal' | 'reduced', schedule: readonly SamplePoint[], provenance: Prepared['provenance'], tracker: RuntimeObservationTracker): Promise<Observation> {
  const context = await trackRuntimeObservationOperation(tracker, 'replay-context', () => newContext(browser, input, profile));
  const page = await trackRuntimeObservationOperation(tracker, 'replay-page', () => context.newPage());
  const requests: string[] = [];
  const errors: string[] = [];
  page.on('request', (request) => { if (request.url() !== 'https://replay.invalid/index.html') requests.push(request.url()); });
  page.on('pageerror', () => errors.push('pageerror'));
  page.on('console', (message) => { if (message.type() === 'error') errors.push('console-error'); });
  await page.route('**/*', async (route) => {
    if (route.request().url() === 'https://replay.invalid/index.html') await route.fulfill({ status: 200, contentType: 'text/html', body: replayHtml });
    else await route.abort('blockedbyclient');
  });
  try {
    await trackRuntimeObservationOperation(tracker, 'lifecycle', () => page.goto('https://replay.invalid/index.html', { waitUntil: 'load' }));
    await trackRuntimeObservationOperation(tracker, 'replay-style', () => page.addStyleTag({ content: replayCss }));
    return await observe({ context, page, requests, errors }, input, schedule, provenance, true, '', tracker, replayCss);
  } finally { await tracker.close(() => context.close()); }
}

async function observe(runtime: Runtime, input: OwnerInput, schedule: readonly SamplePoint[], provenance: Prepared['provenance'], replay: boolean, captureNamespaceSha256: string, tracker: RuntimeObservationTracker, replayCss = ''): Promise<Observation> {
  await trackRuntimeObservationOperation(tracker, 'lifecycle', () => establishObservationLifecycle(runtime.page, input, provenance, replay, captureNamespaceSha256));
  const initialDigest = sha256(stableJson(await trackRuntimeObservationOperation(tracker, 'initial-state', () => captureState(runtime.page, provenance.map((item) => item.stableId)))));
  await trackRuntimeObservationOperation(tracker, 'instrumentation-install', () => installInstrumentation(runtime.page));
  await trackRuntimeObservationOperation(tracker, 'start-actions', () => executeActions(runtime.page, input.procedure.start, input.bindings, replay));
  const afterStart = sha256(stableJson(await trackRuntimeObservationOperation(tracker, 'after-start-state', () => captureState(runtime.page, provenance.map((item) => item.stableId)))));
  await trackRuntimeObservationOperation(tracker, 'actions', () => executeActions(runtime.page, input.procedure.actions, input.bindings, replay));
  const animations = await trackRuntimeObservationOperation(tracker, 'animation-inventory', () => animationRecords(runtime.page));
  const effects = await trackRuntimeObservationOperation(tracker, 'instrumentation-read', () => readInstrumentation(runtime.page));
  const samples = await trackRuntimeObservationOperation(tracker, 'samples', () => captureSamples(runtime.page, schedule, provenance.map((item) => item.stableId)));
  const postLoop = sha256(stableJson(await trackRuntimeObservationOperation(tracker, 'post-loop-state', () => captureState(runtime.page, provenance.map((item) => item.stableId), input.procedure.loopDurationMs))));
  await trackRuntimeObservationOperation(tracker, 'reload', () => runtime.page.reload({ waitUntil: 'load' }));
  if (replay) await trackRuntimeObservationOperation(tracker, 'replay-style-reset', () => runtime.page.addStyleTag({ content: replayCss }));
  await trackRuntimeObservationOperation(tracker, 'reset-lifecycle', () => establishObservationLifecycle(runtime.page, input, provenance, replay, captureNamespaceSha256));
  await trackRuntimeObservationOperation(tracker, 'reset-start-actions', () => executeActions(runtime.page, input.procedure.start, input.bindings, replay));
  const resetDigest = sha256(stableJson(await trackRuntimeObservationOperation(tracker, 'reset-state', () => captureState(runtime.page, provenance.map((item) => item.stableId)))));
  const resetCheckpoints = { beforeStart: initialDigest, afterStart, postLoop, afterReset: resetDigest };
  return {
    provenance, animations, samples, initialDigest, resetDigest, resetCheckpoints,
    requests: snapshotRuntimeActivity(runtime.requests), errors: snapshotRuntimeActivity(runtime.errors),
    mutations: effects.mutations, events: snapshotRuntimeActivity(effects.events),
  };
}

async function establishObservationLifecycle(
  page: Page,
  input: OwnerInput,
  provenance: Prepared['provenance'],
  replay: boolean,
  captureNamespaceSha256: string,
): Promise<void> {
  await ready(page);
  if (replay) await verifyReplayBindings(page, provenance);
  else if (stableJson(await bindSource(page, input.bindings, captureNamespaceSha256)) !== stableJson(provenance)) throw coded('PREPROCESSOR_BINDING_INVALID');
  await pauseAt(page, 0);
}

export * from './browser-route.js';
import {
  assertLedgerBijection, assertLockedRequestClosure, bindSource, buildReplay, deriveLedger,
  executeActions, inventoryPage, lockedStylesheets, newContext, openLockedPage, ready,
  readBootstrapInstrumentation, validateOwnerInputSemantics, verifyReplayBindings, type Runtime,
} from './browser-route.js';
export * from './runtime-capture.js';
import { animationRecords, deriveSchedule, installInstrumentation, readInstrumentation, captureState, captureSamples, pauseAt, runsStable, semanticObservation, assertReplayStructurallySafe, assertCssStructurallySafe, coded, diagnosticFromError } from './runtime-capture.js';
