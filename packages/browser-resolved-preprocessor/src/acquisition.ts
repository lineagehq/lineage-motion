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

type Inventory = OwnerInput['expectedInventory'];
type AnimationRecord = SemanticAnimationInstance & Readonly<{
  keyframes: readonly (SemanticAnimationInstance['keyframes'][number] & { values: Readonly<Record<string, string>> })[];
}>;
type StateRecord = Readonly<{
  targetId: string; computed: Readonly<Record<string, string>>;
  bounds: readonly [number, number, number, number]; pixelsSha256: string;
}>;
type Observation = Readonly<{
  provenance: readonly Readonly<{ bindingId: string; stableId: string; nodeProvenanceSha256: string; captureNamespaceSha256: string }>[];
  animations: readonly AnimationRecord[];
  samples: readonly Readonly<{ timeMs: number; states: readonly StateRecord[] }>[];
  initialDigest: string; resetDigest: string; requests: readonly string[]; errors: readonly string[];
  resetCheckpoints: Readonly<{ beforeStart: string; afterStart: string; postLoop: string; afterReset: string }>;
  mutations: number; events: readonly string[];
}>;
type Prepared = Readonly<{
  replayHtml: string; replayCss: string; inventory: Inventory; ledger: readonly ConstructRecord[];
  schedule: readonly SamplePoint[]; provenance: readonly Readonly<{ bindingId: string; stableId: string; nodeProvenanceSha256: string; captureNamespaceSha256: string }>[];
  requestLedger: readonly string[]; errors: readonly string[]; mutations: number;
}>;
type LockedStylesheet = Readonly<{
  kind: 'inline' | 'external';
  css: string;
  href?: string;
}>;

export function snapshotRuntimeActivity<T>(values: readonly T[]): readonly T[] {
  return [...values];
}

export function summarizeRuntimeObservations(
  sourceRuns: readonly Readonly<{ profile: 'normal' | 'reduced'; observation: Readonly<{ errors: readonly unknown[]; mutations: number }> }>[],
  replayRuns: readonly Readonly<{ profile: 'normal' | 'reduced'; observation: Readonly<{ errors: readonly unknown[]; mutations: number }> }>[],
): RuntimeObservationSummary {
  const cell = (profile: 'normal' | 'reduced', side: 'source' | 'replay') => {
    const runs = (side === 'source' ? sourceRuns : replayRuns).filter((run) => run.profile === profile);
    return { profile, side, runCount: runs.length, browserErrorCount: runs.reduce((count, run) => count + run.observation.errors.length, 0), mutatedRunCount: runs.filter((run) => run.observation.mutations > 0).length, mutationCount: runs.reduce((count, run) => count + run.observation.mutations, 0) } as const;
  };
  return { schemaVersion: RUNTIME_OBSERVATION_DIAGNOSTIC_SCHEMA_VERSION, variant: 'complete-counts', completeness: 'complete', stage: 'observation-cleanliness', cells: [cell('normal', 'source'), cell('normal', 'replay'), cell('reduced', 'source'), cell('reduced', 'replay')] };
}

type ObservationCoordinate = Readonly<{ profile: 'normal' | 'reduced'; side: 'source' | 'replay'; runOrdinal: 1 | 2 | 3; substage: RuntimeObservationSubstage }>;
export class RuntimeObservationTracker {
  readonly #base: Omit<ObservationCoordinate, 'substage'>;
  #coordinate: ObservationCoordinate;
  constructor(profile: ObservationCoordinate['profile'], side: ObservationCoordinate['side'], runOrdinal: ObservationCoordinate['runOrdinal']) {
    if (!['normal', 'reduced'].includes(profile) || !['source', 'replay'].includes(side) || ![1, 2, 3].includes(runOrdinal)) throw new Error('PREPROCESSOR_ARTIFACT_INVALID');
    this.#base = { profile, side, runOrdinal };
    this.#coordinate = { ...this.#base, substage: side === 'source' ? 'source-open' : 'replay-context' };
  }
  async close<T>(operation: () => Promise<T>): Promise<T> { const previous = this.#coordinate; this.enter('close'); const value = await operation(); this.#coordinate = previous; return value; }
  enter(substage: RuntimeObservationSubstage): void {
    if (!RUNTIME_OBSERVATION_SUBSTAGES.includes(substage) || (substage.startsWith('replay-') && this.#base.side !== 'replay')) throw new Error('PREPROCESSOR_ARTIFACT_INVALID');
    this.#coordinate = { ...this.#base, substage };
  }
  earlyFailure(): RuntimeObservationSummary {
    return { schemaVersion: RUNTIME_OBSERVATION_DIAGNOSTIC_SCHEMA_VERSION, variant: 'early-failure', completeness: 'incomplete', stage: 'observation-execution', failure: { ...this.#coordinate } };
  }
}
export async function trackRuntimeObservationOperation<T>(tracker: RuntimeObservationTracker, substage: RuntimeObservationSubstage, operation: () => Promise<T>): Promise<T> { tracker.enter(substage); return operation(); }

export class RuntimePreparationTracker {
  readonly #runOrdinal: 1 | 2 | 3;
  #substage: RuntimePreparationSubstage = 'source-open';
  #identityBindTracker: IdentityBindFailureTracker | null = null;
  constructor(runOrdinal: 1 | 2 | 3) { if (![1, 2, 3].includes(runOrdinal)) throw new Error('PREPROCESSOR_ARTIFACT_INVALID'); this.#runOrdinal = runOrdinal; }
  enter(substage: RuntimePreparationSubstage): void { if (!RUNTIME_PREPARATION_SUBSTAGES.includes(substage)) throw new Error('PREPROCESSOR_ARTIFACT_INVALID'); this.#substage = substage; }
  beginIdentityBind(bindingCount: number): IdentityBindFailureTracker { this.enter('identity-bind'); this.#identityBindTracker = new IdentityBindFailureTracker(this.#runOrdinal, bindingCount); return this.#identityBindTracker; }
  async close<T>(operation: () => Promise<T>): Promise<T> { const previous = this.#substage; this.enter('close'); const value = await operation(); this.#substage = previous; return value; }
  failure(): RuntimeObservationSummary { return { schemaVersion: RUNTIME_OBSERVATION_DIAGNOSTIC_SCHEMA_VERSION, variant: 'preparation-failure', completeness: 'incomplete', stage: 'preparation-execution', failure: { runOrdinal: this.#runOrdinal, substage: this.#substage } }; }
  rejectedFailure(): RuntimeObservationSummary { return this.#substage === 'identity-bind' && this.#identityBindTracker ? this.#identityBindTracker.failure() : this.failure(); }
}
export function trackRuntimePreparationOperation<T>(tracker: RuntimePreparationTracker, substage: RuntimePreparationSubstage, operation: () => T): T { tracker.enter(substage); return operation(); }

export class IdentityBindFailureTracker {
  readonly #runOrdinal: 1 | 2 | 3;
  readonly #bindingCount: number;
  #step: IdentityBindFailureStep = 'derive-node-identities';
  #identityDerivationComplete = false;
  #locatorChecksCompleted = 0;
  #identityReadsCompleted = 0;
  #markerWritesCompleted = 0;
  #derivationFailure: { operation: IdentityDerivationOperation; evaluationEntered: boolean; enumerationComplete: boolean } | null = null;
  constructor(runOrdinal: 1 | 2 | 3, bindingCount: number) { if (![1, 2, 3].includes(runOrdinal) || !Number.isSafeInteger(bindingCount) || bindingCount <= 0) throw new Error('PREPROCESSOR_ARTIFACT_INVALID'); this.#runOrdinal = runOrdinal; this.#bindingCount = bindingCount; }
  enter(step: IdentityBindFailureStep): void {
    if (!IDENTITY_BIND_FAILURE_STEPS.includes(step)) throw new Error('PREPROCESSOR_ARTIFACT_INVALID');
    const valid = step === 'derive-node-identities' ? !this.#identityDerivationComplete && this.#locatorChecksCompleted === 0
      : step === 'locator-count' ? this.#identityDerivationComplete && this.#locatorChecksCompleted < this.#bindingCount
      : step === 'identity-read' ? this.#identityDerivationComplete && this.#locatorChecksCompleted > this.#identityReadsCompleted
      : step === 'binding-marker-write' ? this.#identityDerivationComplete && this.#identityReadsCompleted > this.#markerWritesCompleted
      : this.#identityDerivationComplete && this.#locatorChecksCompleted === this.#bindingCount && this.#identityReadsCompleted === this.#bindingCount && this.#markerWritesCompleted === this.#bindingCount;
    if (!valid) throw new Error('PREPROCESSOR_ARTIFACT_INVALID'); this.#step = step;
  }
  completeDerivation(): void { if (this.#step !== 'derive-node-identities') throw new Error('PREPROCESSOR_ARTIFACT_INVALID'); this.#identityDerivationComplete = true; }
  completeLocatorCheck(): void { if (this.#step !== 'locator-count') throw new Error('PREPROCESSOR_ARTIFACT_INVALID'); this.#locatorChecksCompleted += 1; }
  completeIdentityRead(): void { if (this.#step !== 'identity-read') throw new Error('PREPROCESSOR_ARTIFACT_INVALID'); this.#identityReadsCompleted += 1; }
  completeMarkerWrite(): void { if (this.#step !== 'binding-marker-write') throw new Error('PREPROCESSOR_ARTIFACT_INVALID'); this.#markerWritesCompleted += 1; }
  completeFinalization(): void { if (this.#step !== 'finalize-records') throw new Error('PREPROCESSOR_ARTIFACT_INVALID'); }
  recordDerivationFailure(operation: IdentityDerivationOperation, evaluationEntered: boolean, enumerationComplete: boolean): void { if (!IDENTITY_DERIVATION_OPERATIONS.includes(operation) || (operation === 'evaluation-dispatch' ? evaluationEntered || enumerationComplete : !evaluationEntered) || (['evaluation-dispatch', 'encoder-initialize', 'element-enumeration'].includes(operation) ? enumerationComplete : !enumerationComplete)) throw new Error('PREPROCESSOR_ARTIFACT_INVALID'); this.#derivationFailure = { operation, evaluationEntered, enumerationComplete }; }
  progress(): IdentityBindProgress { return { bindingCount: this.#bindingCount, identityDerivationComplete: this.#identityDerivationComplete, locatorChecksCompleted: this.#locatorChecksCompleted, identityReadsCompleted: this.#identityReadsCompleted, markerWritesCompleted: this.#markerWritesCompleted, finalizationComplete: false }; }
  failure(): RuntimeObservationSummary { return this.#derivationFailure ? { schemaVersion: RUNTIME_OBSERVATION_DIAGNOSTIC_SCHEMA_VERSION, variant: 'identity-derivation-failure', completeness: 'incomplete', stage: 'preparation-execution', failure: { runOrdinal: this.#runOrdinal, substage: 'identity-bind', step: 'derive-node-identities', ...this.#derivationFailure } } : { schemaVersion: RUNTIME_OBSERVATION_DIAGNOSTIC_SCHEMA_VERSION, variant: 'identity-bind-failure', completeness: 'incomplete', stage: 'preparation-execution', failure: { runOrdinal: this.#runOrdinal, substage: 'identity-bind', step: this.#step, progress: this.progress() } }; }
}
export function trackIdentityBindOperation<T>(tracker: IdentityBindFailureTracker, step: IdentityBindFailureStep, operation: () => T): T { tracker.enter(step); return operation(); }

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';
const REGISTERED_HTML_ELEMENTS = new Set([
  'html', 'head', 'body', 'meta', 'title', 'style', 'link',
  'main', 'section', 'div', 'span', 'p', 'label', 'button', 'input',
]);
const REGISTERED_GLOBAL_ATTRIBUTES = new Set(['id', 'class', 'lang', 'role', 'tabindex', 'hidden']);
const REGISTERED_ELEMENT_ATTRIBUTES: Readonly<Record<string, ReadonlySet<string>>> = {
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

function canonicalApplication(animation: AnimationRecord): string {
  const { playState: _runtimePlayState, ...declarative } = animation;
  return stableJson(declarative);
}

function constructId(kind: ConstructRecord['kind'], canonicalInput: string): string { return `construct_${sha256(`${kind}:${canonicalInput}`).slice(0, 24)}`; }

function canonicalCssAst(node: postcss.Rule | postcss.AtRule, headerOnly: boolean): unknown {
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
function canonicalCssValue(value: string, prop: string): unknown {
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
function expandAnimationShorthand(value: string): string {
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
function normalizeSelector(value: string): string { return value.trim().replace(/\s*([>+~])\s*/g, '$1').replace(/\s+/g, ' '); }
function normalizeCssTokenText(value: string): string { return value.trim().replace(/\s*([():,>+~])\s*/g, '$1').replace(/\s+/g, ' ').toLowerCase(); }

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

type Runtime = { context: BrowserContext; page: Page; requests: string[]; errors: string[] };
async function openLockedPage(browser: Browser, input: OwnerInput, profile: 'normal' | 'reduced'): Promise<Runtime> {
  const context = await newContext(browser, input, profile);
  const page = await context.newPage();
  const requests: string[] = [];
  const errors: string[] = [];
  const responseMap = new Map(input.sourceLock.responses.map((response) => [response.requestUrl, response]));
  const redirectMap = new Map(input.sourceLock.redirects.map((redirect) => [redirect.from, redirect]));
  let routeViolation = false;
  page.on('request', (request) => requests.push(request.url()));
  page.on('pageerror', () => errors.push('pageerror'));
  page.on('console', (message) => { if (message.type() === 'error') errors.push('console-error'); });
  await page.route('**/*', async (route: Route) => {
    const url = route.request().url();
    const redirect = redirectMap.get(url);
    if (redirect) { await route.fulfill({ status: redirect.status, headers: { location: redirect.to }, body: '' }); return; }
    const response = responseMap.get(url);
    if (!response) { routeViolation = true; errors.push('route-violation'); await route.abort('blockedbyclient'); return; }
    await route.fulfill({ status: response.status, headers: { ...response.headers, 'content-type': response.mimeType }, body: response.body });
  });
  try {
    await page.goto(input.sourceLock.entryRequest, { waitUntil: 'load' });
    if (routeViolation) throw coded('PREPROCESSOR_ROUTE_VIOLATION');
    return { context, page, requests, errors };
  } catch (error) { await context.close(); throw error; }
}
async function newContext(browser: Browser, input: OwnerInput, profile: 'normal' | 'reduced'): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: input.environment.viewport, deviceScaleFactor: 1, locale: 'en-US', timezoneId: 'UTC',
    colorScheme: 'light', contrast: 'no-preference', reducedMotion: profile === 'reduced' ? 'reduce' : 'no-preference',
    serviceWorkers: 'block', javaScriptEnabled: true,
  });
  await context.addInitScript(() => {
    const counts = { timeouts: 0, intervals: 0, observers: 0, workers: 0, storage: 0, fetches: 0, xhrs: 0, animations: 0, listeners: 0 };
    (window as unknown as { __motionBootstrap: typeof counts }).__motionBootstrap = counts;
    const originalTimeout = window.setTimeout.bind(window); window.setTimeout = ((...args: Parameters<typeof window.setTimeout>) => { if (document.currentScript !== null) counts.timeouts += 1; return originalTimeout(...args); }) as typeof window.setTimeout;
    const originalInterval = window.setInterval.bind(window); window.setInterval = ((...args: Parameters<typeof window.setInterval>) => { if (document.currentScript !== null) counts.intervals += 1; return originalInterval(...args); }) as typeof window.setInterval;
    const OriginalObserver = window.MutationObserver; window.MutationObserver = class extends OriginalObserver { constructor(callback: MutationCallback) { if (document.currentScript !== null) counts.observers += 1; super(callback); } };
    const originalFetch = window.fetch.bind(window); window.fetch = ((...args: Parameters<typeof window.fetch>) => { if (document.currentScript !== null) counts.fetches += 1; return originalFetch(...args); }) as typeof window.fetch;
    const originalOpen = XMLHttpRequest.prototype.open; XMLHttpRequest.prototype.open = function(method: string, url: string | URL, asyncFlag: boolean = true, username?: string | null, password?: string | null) { if (document.currentScript !== null) counts.xhrs += 1; return originalOpen.call(this, method, url, asyncFlag, username, password); };
    const originalAnimate = Element.prototype.animate; Element.prototype.animate = function(...args: Parameters<Element['animate']>) { if (document.currentScript !== null) counts.animations += 1; return originalAnimate.apply(this, args); };
    const originalAdd = EventTarget.prototype.addEventListener; EventTarget.prototype.addEventListener = function(...args: Parameters<EventTarget['addEventListener']>) { if (document.currentScript !== null) counts.listeners += 1; return originalAdd.apply(this, args); };
    const OriginalWorker = window.Worker; window.Worker = class extends OriginalWorker { constructor(...args: ConstructorParameters<typeof Worker>) { if (document.currentScript !== null) counts.workers += 1; super(...args); } };
    for (const storage of [window.localStorage, window.sessionStorage]) {
      const getItem = storage.getItem.bind(storage); storage.getItem = (key: string) => { if (document.currentScript !== null) counts.storage += 1; return getItem(key); };
      const setItem = storage.setItem.bind(storage); storage.setItem = (key: string, value: string) => { if (document.currentScript !== null) counts.storage += 1; setItem(key, value); };
      const removeItem = storage.removeItem.bind(storage); storage.removeItem = (key: string) => { if (document.currentScript !== null) counts.storage += 1; removeItem(key); };
      const clear = storage.clear.bind(storage); storage.clear = () => { if (document.currentScript !== null) counts.storage += 1; clear(); };
    }
  });
  return context;
}

async function readBootstrapInstrumentation(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => ({ ...(window as unknown as { __motionBootstrap: Record<string, number> }).__motionBootstrap }));
}

function validateOwnerInputSemantics(input: OwnerInput): DiagnosticCode[] {
  const codes: DiagnosticCode[] = [];
  const responses = input.sourceLock.responses;
  const urls = responses.map((item) => item.requestUrl);
  if (new Set(urls).size !== urls.length || responses.some((item) => sha256(item.body) !== item.bodySha256)) codes.push('PREPROCESSOR_LOCK_MISMATCH');
  const entry = responses.find((item) => item.requestUrl === input.sourceLock.entryRequest);
  if (!entry || entry.bodySha256 !== input.sourceLock.originalSha256 || entry.mimeType !== 'text/html') codes.push('PREPROCESSOR_RESOURCE_INVALID');
  const allowedHeaders = new Set(['content-language', 'content-type', 'cache-control']);
  if (responses.some((item) => {
    const url = new URL(item.requestUrl);
    return url.username !== '' || url.password !== '' || Object.keys(item.headers).some((name) => !allowedHeaders.has(name.toLowerCase()))
      || Object.keys(item.headers).some((name) => /authorization|cookie|credential/i.test(name));
  })) codes.push('PREPROCESSOR_RESOURCE_INVALID');
  const bindingIds = input.bindings.map((item) => item.bindingId);
  if (new Set(bindingIds).size !== bindingIds.length || [...input.procedure.start, ...input.procedure.actions].some((action) => !bindingIds.includes(action.bindingId))) codes.push('PREPROCESSOR_ACTION_INVALID');
  if (stableJson([...input.expectedInventory.animatedBindingIds].sort()) !== stableJson(input.expectedInventory.animatedBindingIds)
    || input.expectedInventory.animatedBindingIds.some((id) => !bindingIds.includes(id))) codes.push('PREPROCESSOR_INVENTORY_MISMATCH');
  // Admission is closed and registered. Unknown HTML/native behavior never gets
  // a chance to execute in Chromium, including declarative shadow roots,
  // templates, marquee, SVG/SMIL, and future autonomous elements.
  if (responses.some((response) => !['text/html', 'text/css'].includes(response.mimeType))) codes.push('PREPROCESSOR_RESOURCE_INVALID');
  if (responses.some((response) => response.mimeType === 'text/html' && !isRegisteredHtml(response.body))) codes.push('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
  if (responses.some((response) => response.mimeType === 'text/css' && !isRegisteredCss(response.body))) codes.push('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
  return [...new Set(codes)];
}

function isRegisteredHtml(html: string): boolean {
  let admitted = true;
  let doctypeCount = 0;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object' || !admitted) return;
    const record = node as { nodeName?: string; name?: string; publicId?: string; systemId?: string; tagName?: string; namespaceURI?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: Array<{ nodeName?: string; value?: string }>; content?: unknown };
    if (record.nodeName === '#documentType') {
      doctypeCount += 1;
      if (record.name?.toLowerCase() !== 'html' || record.publicId !== '' || record.systemId !== '') admitted = false;
      return;
    }
    const tagName = record.tagName?.toLowerCase();
    if (tagName) {
      if (record.namespaceURI !== HTML_NAMESPACE || !REGISTERED_HTML_ELEMENTS.has(tagName) || record.content) { admitted = false; return; }
      for (const attribute of record.attrs ?? []) {
        const name = attribute.name.toLowerCase();
        const registered = REGISTERED_GLOBAL_ATTRIBUTES.has(name) || name.startsWith('aria-') || name.startsWith('data-')
          || REGISTERED_ELEMENT_ATTRIBUTES[tagName]?.has(name) === true;
        if (!registered || name === 'shadowrootmode' || name.startsWith('on')) { admitted = false; return; }
        if (name === 'style' && !isRegisteredCss(`x{${attribute.value}}`)) { admitted = false; return; }
      }
      if (tagName === 'meta' && !record.attrs?.some((attribute) => attribute.name.toLowerCase() === 'charset')) { admitted = false; return; }
      if (tagName === 'link') {
        const attrs = new Map((record.attrs ?? []).map((attribute) => [attribute.name.toLowerCase(), attribute.value.toLowerCase()]));
        if (attrs.get('rel') !== 'stylesheet' || !attrs.has('href')) { admitted = false; return; }
      }
      if (tagName === 'input') {
        const type = record.attrs?.find((attribute) => attribute.name.toLowerCase() === 'type')?.value.toLowerCase() ?? 'text';
        if (!['text', 'checkbox'].includes(type)) { admitted = false; return; }
      }
      if (tagName === 'style') {
        const css = (record.childNodes ?? []).filter((child) => child.nodeName === '#text').map((child) => child.value ?? '').join('');
        if (!isRegisteredCss(css)) { admitted = false; return; }
      }
    }
    for (const child of record.childNodes ?? []) visit(child);
  };
  const parseErrors: string[] = [];
  try {
    const document = parse(html, { onParseError: (error) => parseErrors.push(error.code) });
    // parse5 intentionally repairs malformed HTML. Admission must reject the
    // original response before inspecting that repaired tree.
    if (parseErrors.length > 0) return false;
    visit(document);
  } catch { return false; }
  return admitted && doctypeCount === 1;
}

function isRegisteredCss(css: string): boolean {
  let root: postcss.Root;
  try { root = postcss.parse(css); } catch { return false; }
  let admitted = true;
  root.walkAtRules((rule) => {
    const name = rule.name.toLowerCase();
    if (name === 'keyframes' || name === '-webkit-keyframes') return;
    if (name === 'media' && /^\(prefers-reduced-motion:\s*reduce\)$/i.test(rule.params.trim())) return;
    admitted = false;
  });
  root.walkDecls((declaration) => {
    if (declaration.prop.startsWith('--')) admitted = false;
    valueParser(declaration.value).walk((node) => {
      if (node.type === 'function' && ['url', 'image-set', '-webkit-image-set', 'local', 'paint'].includes(node.value.toLowerCase())) admitted = false;
    });
  });
  return admitted;
}

async function ready(page: Page): Promise<void> {
  await page.evaluate(async () => { await document.fonts.ready; await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); });
}
async function bindSource(page: Page, bindings: readonly OwnerBinding[], captureNamespaceSha256: string, tracker?: IdentityBindFailureTracker): Promise<Prepared['provenance']> {
  const identityTracker = tracker ?? new IdentityBindFailureTracker(1, bindings.length);
  try { await trackIdentityBindOperation(identityTracker, 'derive-node-identities', () => page.evaluate(async (captureNamespace) => {
    const scope = globalThis as typeof globalThis & { __motionIdentityDerivation?: { operation: IdentityDerivationOperation; evaluationEntered: boolean; enumerationComplete: boolean } };
    const progress = { operation: 'encoder-initialize' as IdentityDerivationOperation, evaluationEntered: true, enumerationComplete: false };
    scope.__motionIdentityDerivation = progress;
    const encode = new TextEncoder();
    progress.operation = 'element-enumeration';
    const elements = [...document.querySelectorAll('*')];
    progress.enumerationComplete = true;
    for (const element of elements) {
      const path: Array<{ namespace: string | null; tag: string; sameTagOrdinal: number; childSignature: string[] }> = [];
      let current: Element | null = element;
      while (current) {
        progress.operation = 'sibling-selection';
        const siblings = current.parentElement ? [...current.parentElement.children].filter((candidate) => candidate.namespaceURI === current!.namespaceURI && candidate.tagName === current!.tagName) : [current];
        progress.operation = 'child-signature';
        const childSignature = [...current.children].map((child) => `${child.namespaceURI}:${child.tagName.toLowerCase()}`).sort();
        progress.operation = 'ancestor-record';
        path.unshift({ namespace: current.namespaceURI, tag: current.tagName.toLowerCase(), sameTagOrdinal: siblings.indexOf(current), childSignature });
        current = current.parentElement;
      }
      progress.operation = 'path-serialization';
      const serializedPath = JSON.stringify(path);
      progress.operation = 'provenance-digest';
      const nodeProvenanceSha256 = [...new Uint8Array(await crypto.subtle.digest('SHA-256', encode.encode(serializedPath)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      progress.operation = 'provenance-attribute-write';
      element.setAttribute('data-motion-provenance', nodeProvenanceSha256);
      progress.operation = 'stable-input-serialization';
      const stableInput = JSON.stringify({ captureNamespace, nodeProvenanceSha256 });
      progress.operation = 'stable-digest';
      const stableDigest = [...new Uint8Array(await crypto.subtle.digest('SHA-256', encode.encode(stableInput)))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
      progress.operation = 'stable-attribute-write';
      element.setAttribute('data-motion-stable', `node_${stableDigest.slice(0, 24)}`);
    }
    delete scope.__motionIdentityDerivation;
  }, captureNamespaceSha256)); } catch {
    let failure: { operation: IdentityDerivationOperation; evaluationEntered: boolean; enumerationComplete: boolean } = { operation: 'evaluation-dispatch', evaluationEntered: false, enumerationComplete: false };
    try {
      const observed = await page.evaluate(() => {
        const scope = globalThis as typeof globalThis & { __motionIdentityDerivation?: { operation?: unknown; evaluationEntered?: unknown; enumerationComplete?: unknown } };
        const value = scope.__motionIdentityDerivation;
        return value && typeof value.operation === 'string' && typeof value.evaluationEntered === 'boolean' && typeof value.enumerationComplete === 'boolean'
          ? { operation: value.operation, evaluationEntered: value.evaluationEntered, enumerationComplete: value.enumerationComplete }
          : null;
      });
      if (observed && IDENTITY_DERIVATION_OPERATIONS.includes(observed.operation as IdentityDerivationOperation)) failure = { operation: observed.operation as IdentityDerivationOperation, evaluationEntered: observed.evaluationEntered, enumerationComplete: observed.enumerationComplete };
    } catch {}
    identityTracker.recordDerivationFailure(failure.operation, failure.evaluationEntered, failure.enumerationComplete);
    throw coded('PREPROCESSOR_RUNTIME_ERROR');
  }
  identityTracker.completeDerivation();
  const records: Array<{ bindingId: string; stableId: string; nodeProvenanceSha256: string; captureNamespaceSha256: string }> = [];
  for (const binding of bindings) {
    let count: number;
    try { count = await trackIdentityBindOperation(identityTracker, 'locator-count', () => page.locator(binding.locator).count()); } catch { throw coded('PREPROCESSOR_BINDING_INVALID'); }
    if (count !== 1) throw coded('PREPROCESSOR_BINDING_INVALID');
    identityTracker.completeLocatorCheck();
    const [stableId, nodeProvenanceSha256] = await trackIdentityBindOperation(identityTracker, 'identity-read', () => Promise.all([page.locator(binding.locator).getAttribute('data-motion-stable'), page.locator(binding.locator).getAttribute('data-motion-provenance')]));
    if (!stableId || !nodeProvenanceSha256) throw coded('PREPROCESSOR_BINDING_INVALID');
    identityTracker.completeIdentityRead();
    await trackIdentityBindOperation(identityTracker, 'binding-marker-write', () => page.locator(binding.locator).evaluate((element, value) => {
      element.setAttribute('data-owner-binding', value.bindingId);
    }, { bindingId: binding.bindingId }));
    identityTracker.completeMarkerWrite();
    records.push({ bindingId: binding.bindingId, stableId, nodeProvenanceSha256, captureNamespaceSha256 });
  }
  const finalized = trackIdentityBindOperation(identityTracker, 'finalize-records', () => { if (new Set(records.map((item) => item.stableId)).size !== records.length) throw coded('PREPROCESSOR_BINDING_INVALID'); return records.sort((a, b) => a.bindingId.localeCompare(b.bindingId)); });
  identityTracker.completeFinalization();
  return finalized;
}
async function verifyReplayBindings(page: Page, provenance: Prepared['provenance']): Promise<void> {
  for (const item of provenance) {
    const locator = page.locator(`[data-motion-stable="${item.stableId}"]`);
    if (await locator.count() !== 1 || await locator.getAttribute('data-motion-provenance') !== item.nodeProvenanceSha256) throw coded('PREPROCESSOR_BINDING_INVALID');
  }
}

async function executeActions(page: Page, actions: readonly OwnerAction[], bindings: readonly OwnerBinding[], replay: boolean): Promise<void> {
  const byId = new Map(bindings.map((item) => [item.bindingId, item]));
  for (const action of actions) {
    const binding = byId.get(action.bindingId);
    if (!binding) throw coded('PREPROCESSOR_ACTION_INVALID');
    const locator = replay ? page.locator(`[data-motion-binding="${action.bindingId}"]`) : page.locator(binding.locator);
    if (await locator.count() !== 1) throw coded('PREPROCESSOR_ACTION_INVALID');
    if (action.kind === 'click') await locator.click();
    else if (action.kind === 'focus') await locator.focus();
    else if (action.kind === 'hover') await locator.hover();
    else if (action.kind === 'key' && action.key) await locator.press(action.key === 'Space' ? ' ' : action.key);
  }
}

function lockedStylesheets(input: OwnerInput): readonly LockedStylesheet[] {
  const entry = input.sourceLock.responses.find((response) => response.requestUrl === input.sourceLock.entryRequest);
  if (!entry) throw coded('PREPROCESSOR_RESOURCE_INVALID');
  const redirects = new Map(input.sourceLock.redirects.map((redirect) => [redirect.from, redirect.to]));
  const responses = new Map(input.sourceLock.responses.map((response) => [response.requestUrl, response]));
  const externalHrefs = new Set<string>();
  const stylesheets: LockedStylesheet[] = [];
  const document = parse(entry.body, { sourceCodeLocationInfo: true });
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as {
      tagName?: string;
      attrs?: Array<{ name: string; value: string }>;
      childNodes?: unknown[];
      sourceCodeLocation?: { startTag?: { endOffset: number }; endTag?: { startOffset: number } };
    };
    const tagName = record.tagName?.toLowerCase();
    if (tagName === 'style') {
      const start = record.sourceCodeLocation?.startTag?.endOffset;
      const end = record.sourceCodeLocation?.endTag?.startOffset;
      if (start === undefined || end === undefined || start > end) throw coded('PREPROCESSOR_RESOURCE_INVALID');
      stylesheets.push({ kind: 'inline', css: entry.body.slice(start, end) });
    } else if (tagName === 'link') {
      const attributes = new Map((record.attrs ?? []).map((attribute) => [attribute.name.toLowerCase(), attribute.value]));
      if (attributes.get('rel')?.toLowerCase() === 'stylesheet') {
        const rawHref = attributes.get('href');
        if (!rawHref) throw coded('PREPROCESSOR_RESOURCE_INVALID');
        const href = new URL(rawHref, input.sourceLock.entryRequest).href;
        if (externalHrefs.has(href)) throw coded('PREPROCESSOR_RESOURCE_INVALID');
        externalHrefs.add(href);
        let responseUrl = href;
        const visited = new Set<string>();
        while (redirects.has(responseUrl)) {
          if (visited.has(responseUrl)) throw coded('PREPROCESSOR_RESOURCE_INVALID');
          visited.add(responseUrl);
          responseUrl = redirects.get(responseUrl)!;
        }
        const response = responses.get(responseUrl);
        if (!response || response.mimeType !== 'text/css') throw coded('PREPROCESSOR_RESOURCE_INVALID');
        stylesheets.push({ kind: 'external', href, css: response.body });
      }
    }
    for (const child of record.childNodes ?? []) visit(child);
  };
  visit(document);
  return stylesheets;
}

async function buildReplay(page: Page, locked: readonly LockedStylesheet[]): Promise<{ html: string; css: string }> {
  return page.evaluate((expected) => {
    const nodes = [...document.querySelectorAll('style,link[rel~="stylesheet"]')];
    const sheets = [...document.styleSheets];
    if (nodes.length !== expected.length || sheets.length !== expected.length) throw new Error('PREPROCESSOR_RESOURCE_INVALID');
    for (const [index, descriptor] of expected.entries()) {
      const node = nodes[index];
      const sheet = sheets[index];
      if (!node || !sheet || sheet.ownerNode !== node) throw new Error('PREPROCESSOR_RESOURCE_INVALID');
      if (descriptor.kind === 'inline') {
        if (!(node instanceof HTMLStyleElement) || sheet.href !== null) throw new Error('PREPROCESSOR_RESOURCE_INVALID');
      } else if (!(node instanceof HTMLLinkElement) || node.href !== descriptor.href || sheet.href !== descriptor.href) {
        throw new Error('PREPROCESSOR_RESOURCE_INVALID');
      }
      try { void sheet.cssRules.length; } catch { throw new Error('PREPROCESSOR_RESOURCE_INVALID'); }
    }
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    clone.querySelectorAll('script,style,link[rel="stylesheet"]').forEach((node) => node.remove());
    for (const element of [...clone.querySelectorAll<HTMLElement>('[data-motion-stable]')]) {
      const source = document.querySelector<HTMLElement>(`[data-motion-stable="${element.dataset.motionStable}"]`);
      if (!source) throw new Error('PREPROCESSOR_BINDING_INVALID');
      const binding = source.getAttribute('data-owner-binding');
      if (binding) element.setAttribute('data-motion-binding', binding);
      element.removeAttribute('data-owner-binding');
    }
    return { html: `<!doctype html>${clone.outerHTML}`, css: expected.map((descriptor) => descriptor.css).join('\n') };
  }, locked);
}

async function inventoryPage(page: Page, bindings: readonly OwnerBinding[]): Promise<Inventory> {
  const animatedIds = new Set(bindings.filter((item) => item.role !== 'trigger').map((item) => item.bindingId));
  return page.evaluate((expectedAnimated) => {
    let cssRules = 0; let keyframes = 0; let applications = 0; let pseudos = 0; let conditionals = 0; let transitions = 0;
    for (const sheet of [...document.styleSheets]) {
      const pending = [...sheet.cssRules].reverse();
      while (pending.length > 0) {
        const rule = pending.pop()!;
        cssRules += 1;
        if (rule instanceof CSSKeyframesRule) keyframes += 1;
        if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) conditionals += 1;
        if (rule instanceof CSSStyleRule) {
          if (rule.selectorText.includes('::')) pseudos += 1;
          const animationNames = rule.style.animationName.split(',').map((item) => item.trim()).filter((item) => item && item !== 'none');
          let matches = 0; try { matches = document.querySelectorAll(rule.selectorText).length; } catch { matches = 0; }
          applications += animationNames.length * matches;
          if (rule.style.transition && rule.style.transition !== 'none' && rule.style.transitionDuration !== '0s') transitions += matches;
        }
        if ('cssRules' in rule && !(rule instanceof CSSKeyframesRule)) pending.push(...[...(rule as CSSGroupingRule).cssRules].reverse());
      }
    }
    return {
      dom: document.querySelectorAll('*').length, cssRules, keyframes, applications,
      scripts: document.scripts.length, resources: [...document.styleSheets].filter((sheet) => Boolean(sheet.href)).length,
      pseudos, conditionals, transitions, animatedBindingIds: [...expectedAnimated].sort(),
    };
  }, [...animatedIds]);
}

async function deriveLedger(page: Page, input: OwnerInput, inventory: Inventory, requests: readonly string[], effects: { mutations: number; events: string[] }, animations: readonly AnimationRecord[]): Promise<ConstructRecord[]> {
  const raw = await page.evaluate(() => {
    const rows: Array<{ kind: ConstructRecord['kind']; basis: string; outputBasis: string; disposition: ConstructRecord['disposition']; cssPath?: number[] }> = [];
    document.querySelectorAll('*').forEach((element) => {
      const attrs = [...element.attributes]
        .filter((attribute) => !['data-motion-stable', 'data-motion-provenance', 'data-owner-binding'].includes(attribute.name.toLowerCase()))
        .map((attribute) => ({ name: attribute.name, value: attribute.value })).sort((a, b) => a.name.localeCompare(b.name));
      const directText = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? '').join('');
      const basis = JSON.stringify({ namespace: element.namespaceURI ?? '', tag: element.tagName.toLowerCase(), stableId: element.getAttribute('data-motion-stable') ?? '', attrs, directText });
      const inlined = ['link', 'style'].includes(element.tagName.toLowerCase());
      rows.push({ kind: 'dom', basis, outputBasis: `${inlined ? 'removed-after-inline' : 'preserved'}:${basis}`, disposition: inlined ? 'inlined-locked' : 'preserved-declarative' });
    });
    let rootRuleIndex = 0;
    for (const sheet of [...document.styleSheets]) {
      const pending = [...sheet.cssRules].map((rule, localIndex) => ({ rule, parentPath: [] as number[], localIndex })).reverse();
      while (pending.length > 0) {
        const { rule, parentPath, localIndex } = pending.pop()!;
        const cssPath = parentPath.length === 0 ? [rootRuleIndex++] : [...parentPath, localIndex];
        const cssDigestBasis = rule.cssText;
        if (rule instanceof CSSKeyframesRule) rows.push({ kind: 'keyframe', basis: cssDigestBasis, outputBasis: `preserved:${cssDigestBasis}`, disposition: 'preserved-declarative', cssPath });
        else if (rule instanceof CSSMediaRule || rule instanceof CSSSupportsRule) rows.push({ kind: 'conditional', basis: cssDigestBasis, outputBasis: `condition-preserved:${cssDigestBasis}`, disposition: rule instanceof CSSMediaRule && /^\(prefers-reduced-motion:\s*reduce\)$/i.test(rule.conditionText) ? 'condition-preserved' : 'unsupported', cssPath });
        else rows.push({ kind: 'css-rule', basis: cssDigestBasis, outputBasis: `preserved:${cssDigestBasis}`, disposition: 'preserved-declarative', cssPath });
        if (rule instanceof CSSStyleRule) {
          let matched: Element[] = []; try { matched = [...document.querySelectorAll(rule.selectorText)]; } catch { matched = []; }
          const names = rule.style.animationName.split(',').map((item) => item.trim()).filter((item) => item && item !== 'none');
          if (rule.selectorText.includes('::')) rows.push({ kind: 'pseudo', basis: cssDigestBasis, outputBasis: `preserved:${cssDigestBasis}`, disposition: /animation/i.test(rule.style.cssText) ? 'unsupported' : 'preserved-declarative' });
          if (rule.style.transition && rule.style.transition !== 'none' && rule.style.transitionDuration !== '0s') rows.push({ kind: 'transition', basis: cssDigestBasis, outputBasis: `unsupported:${cssDigestBasis}`, disposition: 'unsupported' });
        }
        if ('cssRules' in rule && !(rule instanceof CSSKeyframesRule)) pending.push(...[...(rule as CSSGroupingRule).cssRules].map((child, childIndex) => ({ rule: child, parentPath: cssPath, localIndex: childIndex })).reverse());
      }
    }
    // Defensive only: preflight rejects scripts before this browser path is reachable.
    document.querySelectorAll('script').forEach((script) => { const basis = script.textContent ?? ''; rows.push({ kind: 'script', basis, outputBasis: `unsupported:${basis}`, disposition: 'unsupported' }); });
    return rows;
  });
  const rows = raw.map((item) => {
    if (!item.cssPath) return item;
    let node: postcss.ChildNode;
    try { node = postcss.parse(item.basis).nodes[0]!; } catch { throw coded('PREPROCESSOR_ARTIFACT_INVALID'); }
    if (!node || (node.type !== 'rule' && node.type !== 'atrule')) throw coded('PREPROCESSOR_ARTIFACT_INVALID');
    return { ...item, basis: stableJson({ path: item.cssPath, ast: canonicalCssAst(node, item.kind === 'conditional') }) };
  });
  animations.forEach((animation) => { const basis = canonicalApplication(animation); rows.push({ kind: 'application', basis, outputBasis: `preserved:${basis}`, disposition: 'preserved-declarative' }); });
  input.sourceLock.responses.forEach((response) => { const basis = stableJson({ digest: response.bodySha256, mime: response.mimeType, status: response.status }); rows.push({ kind: 'resource', basis, outputBasis: stableJson({ disposition: response.mimeType === 'text/html' ? 'replay-document' : 'inlined-body', bodySha256: response.bodySha256 }), disposition: response.mimeType === 'text/html' ? 'preserved-declarative' : 'inlined-locked' }); });
  input.sourceLock.redirects.forEach((redirect) => { const basis = stableJson({ from: sha256(redirect.from), to: sha256(redirect.to), status: redirect.status }); rows.push({ kind: 'resource', basis, outputBasis: `resolved:${basis}`, disposition: 'inlined-locked' }); });
  input.bindings.forEach((binding) => rows.push({ kind: 'event', basis: binding.bindingId, outputBasis: `stable-identity:${binding.bindingId}`, disposition: 'identity-bound' }));
  [...input.procedure.start, ...input.procedure.actions].forEach((action, index) => { const basis = `${action.bindingId}:${action.kind}:${index}`; rows.push({ kind: 'action', basis, outputBasis: `executed:${basis}`, disposition: 'owner-action-executed' }); });
  rows.push({ kind: 'reset', basis: input.procedure.reset, outputBasis: `proved:${input.procedure.reset}`, disposition: 'reset-proved' });
  if (effects.mutations > 0) rows.push({ kind: 'mutation', basis: String(effects.mutations), outputBasis: `unsupported:${effects.mutations}`, disposition: 'unsupported' });
  effects.events.forEach((event, index) => { const basis = `${event}:${index}`; rows.push({ kind: 'event', basis, outputBasis: `executed:${basis}`, disposition: 'owner-action-executed' }); });
  if (inventory.pseudos > 0 && !rows.some((item) => item.kind === 'pseudo')) rows.push({ kind: 'pseudo', basis: 'pseudo-unaccounted', outputBasis: 'unsupported:pseudo-unaccounted', disposition: 'unsupported' });
  const records = rows.map((item) => ({ id: constructId(item.kind, item.basis), kind: item.kind, disposition: item.disposition, canonicalInput: item.basis, canonicalOutput: item.outputBasis }));
  if (new Set(records.map((record) => record.id)).size !== records.length) throw coded('PREPROCESSOR_INVENTORY_MISMATCH');
  return records.sort((a, b) => a.id.localeCompare(b.id));
}

function assertLedgerBijection(ledger: readonly ConstructRecord[], input: OwnerInput, inventory: Inventory, replayHtml: string): void {
  const count = (kind: ConstructRecord['kind']): number => ledger.filter((record) => record.kind === kind).length;
  const cssConstructs = count('css-rule') + count('keyframe') + count('conditional');
  if (count('dom') !== inventory.dom || cssConstructs !== inventory.cssRules
    || count('application') !== inventory.applications
    || count('resource') !== input.sourceLock.responses.length + input.sourceLock.redirects.length
    || count('action') !== input.procedure.start.length + input.procedure.actions.length
    || count('reset') !== 1 || ledger.some((record) => record.disposition === 'unsupported')) {
    throw coded('PREPROCESSOR_INVENTORY_MISMATCH');
  }

  const entry = input.sourceLock.responses.find((response) => response.requestUrl === input.sourceLock.entryRequest)!;
  const expectedReplayNodes = countHtmlElements(entry.body, (tagName) => !['link', 'style'].includes(tagName));
  const replayBoundNodes = countHtmlElements(replayHtml, (_tagName, attrs) => attrs.some((attribute) => attribute.name.toLowerCase() === 'data-motion-stable'));
  if (expectedReplayNodes !== replayBoundNodes) throw coded('PREPROCESSOR_INVENTORY_MISMATCH');
}

function countHtmlElements(html: string, include: (tagName: string, attrs: readonly { name: string; value: string }[]) => boolean): number {
  let count = 0;
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as { tagName?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: unknown[] };
    if (record.tagName && include(record.tagName.toLowerCase(), record.attrs ?? [])) count += 1;
    for (const child of record.childNodes ?? []) visit(child);
  };
  visit(parse(html));
  return count;
}

function assertLockedRequestClosure(input: OwnerInput, requests: readonly string[], errors: readonly string[]): void {
  if (errors.includes('route-violation')) throw coded('PREPROCESSOR_ROUTE_VIOLATION');
  const expected = [...input.sourceLock.responses.map((response) => response.requestUrl), ...input.sourceLock.redirects.map((redirect) => redirect.from)].sort();
  const actual = [...requests].sort();
  if (stableJson(actual) !== stableJson(expected)) throw coded('PREPROCESSOR_RESOURCE_INVALID');
}

async function animationRecords(page: Page): Promise<AnimationRecord[]> {
  const raw = await page.evaluate(() => document.getAnimations().map((animation) => {
    if (!(animation instanceof CSSAnimation) || !(animation.effect instanceof KeyframeEffect) || !(animation.effect.target instanceof HTMLElement)) throw new Error('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
    if (!(animation.timeline instanceof DocumentTimeline)) throw new Error('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
    const timing = animation.effect.getTiming();
    const computed = animation.effect.getComputedTiming();
    const frames = animation.effect.getKeyframes();
    if (animation.effect.composite !== 'replace' || Number(timing.endDelay ?? 0) !== 0
      || Number(timing.iterationStart ?? 0) !== 0 || animation.playbackRate !== 1
      || frames.some((frame) => frame.composite !== 'auto' && frame.composite !== 'replace')) throw new Error('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
    return {
      animationName: animation.animationName,
      targetId: animation.effect.target.dataset.motionStable ?? '',
      properties: [...new Set(frames.flatMap((frame) => Object.keys(frame).filter((key) => !['offset', 'computedOffset', 'easing', 'composite'].includes(key))))].sort(),
      durationMs: Number(computed.duration), delayMs: Number(timing.delay ?? 0),
      iterations: computed.iterations === Infinity ? 'infinite' as const : Number(computed.iterations),
      direction: String(timing.direction), fill: String(timing.fill), playState: String(animation.playState), easing: String(timing.easing),
      keyframes: frames.map((frame) => ({
        offset: Number(frame.computedOffset), easing: String(frame.easing ?? 'linear'),
        properties: Object.fromEntries(Object.entries(frame).filter((entry): entry is [string, string] => !['offset', 'computedOffset', 'easing', 'composite'].includes(entry[0]) && typeof entry[1] === 'string').sort(([a], [b]) => a.localeCompare(b))),
      })),
    };
  }));
  const records = raw.map((record): AnimationRecord => {
    const ruleId = `rule_${sha256(record.animationName).slice(0, 24)}`;
    const provenanceId = `source_${sha256(stableJson({ ruleId, targetId: record.targetId, durationMs: record.durationMs, delayMs: record.delayMs, keyframes: record.keyframes })).slice(0, 24)}`;
    const applicationId = applicationInstanceId(record.targetId, ruleId, provenanceId);
    const normalized = normalizeAnimationInstance({
      applicationId, targetId: record.targetId, ruleId, timeline: 'document', composition: 'replace',
      durationMs: record.durationMs, delayMs: record.delayMs, iterations: record.iterations,
      direction: record.direction as SemanticAnimationInstance['direction'], fill: record.fill as SemanticAnimationInstance['fill'],
      playState: record.playState === 'paused' ? 'paused' : 'running', easing: record.easing,
      properties: record.properties,
      keyframes: record.keyframes.map((frame) => ({ offset: frame.offset, easing: frame.easing, properties: Object.keys(frame.properties), values: frame.properties })),
    });
    return { ...normalized, keyframes: normalized.keyframes.map((frame, index) => ({ ...frame, values: record.keyframes[index]!.properties })) };
  });
  if (new Set(records.map((record) => record.applicationId)).size !== records.length) throw coded('PREPROCESSOR_CONSTRUCT_UNSUPPORTED');
  return records.sort((a, b) => a.targetId.localeCompare(b.targetId) || stableJson(a).localeCompare(stableJson(b)));
}

function deriveSchedule(animations: readonly AnimationRecord[], input: OwnerInput): SamplePoint[] {
  const reasons = new Map<number, Set<string>>();
  const add = (time: number, reason: string): void => {
    const clamped = Math.max(0, Math.min(input.procedure.loopDurationMs, Number(time.toFixed(6))));
    const values = reasons.get(clamped) ?? new Set<string>(); values.add(reason); reasons.set(clamped, values);
  };
  const boundary = (time: number, reason: string): void => { add(time - 1, `${reason}:before`); add(time, `${reason}:at`); add(time + 1, `${reason}:after`); };
  boundary(0, 'initial-action'); boundary(input.procedure.loopDurationMs, 'loop'); boundary(input.procedure.settledTimeMs, 'settled');
  for (const sample of expandBoundarySamples(deriveMotionEvidenceBoundaries(animations, input.procedure.loopDurationMs), input.procedure.loopDurationMs, input.procedure.epsilonMs)) {
    for (const reason of sample.reasons) add(sample.timeMs, reason);
  }
  return [...reasons].sort(([a], [b]) => a - b).map(([timeMs, values]) => ({ timeMs, reason: [...values].sort() }));
}

async function installInstrumentation(page: Page): Promise<void> {
  await page.evaluate(() => {
    const state = { mutations: 0, events: [] as string[] };
    (window as unknown as { __motionProof: typeof state }).__motionProof = state;
    new MutationObserver((records) => { state.mutations += records.length; }).observe(document.documentElement, { attributes: true, childList: true, characterData: true, subtree: true });
    for (const event of ['click', 'focusin', 'mouseover', 'keydown']) document.addEventListener(event, () => state.events.push(event), { capture: true });
  });
}
async function readInstrumentation(page: Page): Promise<{ mutations: number; events: string[] }> {
  return page.evaluate(() => (window as unknown as { __motionProof: { mutations: number; events: string[] } }).__motionProof);
}

async function captureState(page: Page, stableIds: readonly string[], timeMs = 0): Promise<unknown> {
  await pauseAt(page, timeMs);
  return page.evaluate((expectedStableIds) => {
    const elements = [...document.querySelectorAll<HTMLElement>('[data-motion-stable]')];
    const presentStableIds = new Set(elements.map((element) => element.dataset.motionStable));
    if (expectedStableIds.some((stableId) => !presentStableIds.has(stableId))) throw new Error('PREPROCESSOR_BINDING_INVALID');
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement.dataset.motionStable ?? null : null;
    const elementStates = elements
      .filter((element) => !['SCRIPT', 'STYLE', 'LINK', 'META', 'TITLE'].includes(element.tagName))
      .map((element) => {
      const style = getComputedStyle(element); const bounds = element.getBoundingClientRect();
      const computed = Object.fromEntries([...style].sort().map((property) => [property, style.getPropertyValue(property)]));
      const directText = [...element.childNodes].filter((node) => node.nodeType === Node.TEXT_NODE).map((node) => node.textContent ?? '').join('');
      const formState = element instanceof HTMLInputElement ? { checked: element.checked, value: element.value }
        : element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement ? { value: element.value } : null;
      return {
        targetId: element.dataset.motionStable, tag: element.tagName.toLowerCase(), computed, directText, formState,
        bounds: [bounds.x, bounds.y, bounds.width, bounds.height],
        scroll: [element.scrollLeft, element.scrollTop, element.scrollWidth, element.scrollHeight],
      };
    }).sort((a, b) => String(a.targetId).localeCompare(String(b.targetId)));
    return {
      document: {
        activeElement,
        scroll: [window.scrollX, window.scrollY],
        scrollingElement: document.scrollingElement
          ? [document.scrollingElement.scrollLeft, document.scrollingElement.scrollTop, document.scrollingElement.scrollWidth, document.scrollingElement.scrollHeight]
          : null,
        viewport: [window.innerWidth, window.innerHeight, window.devicePixelRatio],
      },
      elements: elementStates,
    };
  }, stableIds);
}
async function captureSamples(page: Page, schedule: readonly SamplePoint[], stableIds: readonly string[]): Promise<Array<{ timeMs: number; states: StateRecord[] }>> {
  const output: Array<{ timeMs: number; states: StateRecord[] }> = [];
  for (const sample of schedule) {
    await pauseAt(page, sample.timeMs);
    const states = await page.evaluate((ids) => ids.map((id) => {
      const element = document.querySelector<HTMLElement>(`[data-motion-stable="${id}"]`); if (!element) throw new Error('PREPROCESSOR_BINDING_INVALID');
      const style = getComputedStyle(element); const bounds = element.getBoundingClientRect();
      const computed = Object.fromEntries([...style].sort().map((property) => [property, style.getPropertyValue(property)]));
      return { targetId: id, computed, bounds: [bounds.x, bounds.y, bounds.width, bounds.height] as const };
    }), stableIds);
    const pixelsSha256 = sha256(await page.screenshot({ animations: 'allow' }));
    const withPixels: StateRecord[] = states.map((state) => ({ ...state, pixelsSha256 }));
    output.push({ timeMs: sample.timeMs, states: withPixels });
  }
  return output;
}
async function pauseAt(page: Page, timeMs: number): Promise<void> {
  await page.evaluate(async (time) => {
    for (const animation of document.getAnimations()) { animation.pause(); animation.currentTime = time; }
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, timeMs);
}

function runsStable(runs: Array<{ profile: 'normal' | 'reduced'; observation: Observation }>): boolean {
  return (['normal', 'reduced'] as const).every((profile) => new Set(runs.filter((run) => run.profile === profile).map((run) => stableJson(run.observation))).size === 1);
}
function semanticObservation(observation: Observation): string {
  return stableJson({ provenance: observation.provenance, animations: observation.animations, samples: observation.samples, resetCheckpoints: observation.resetCheckpoints, events: observation.events });
}
function assertReplayStructurallySafe(html: string, css: string): void {
  let reparsed: string;
  try { reparsed = serialize(parse(html)); } catch { throw coded('PREPROCESSOR_REPLAY_UNSAFE'); }
  if (serialize(parse(reparsed)) !== reparsed) throw coded('PREPROCESSOR_REPLAY_UNSAFE');
  const forbiddenElements = new Set(['script', 'canvas', 'link', 'iframe', 'frame', 'object', 'embed', 'base', 'video', 'audio', 'source', 'form', 'svg', 'animate', 'animatemotion', 'animatetransform', 'discard', 'set']);
  const resourceAttributes = new Set(['src', 'srcset', 'href', 'xlink:href', 'poster', 'data', 'action', 'formaction', 'ping', 'background', 'manifest']);
  const visit = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as { tagName?: string; attrs?: Array<{ name: string; value: string }>; childNodes?: unknown[] };
    const tagName = record.tagName?.toLowerCase();
    if (tagName && forbiddenElements.has(tagName)) throw coded('PREPROCESSOR_REPLAY_UNSAFE');
    if (tagName === 'meta') {
      const attributes = new Map((record.attrs ?? []).map((attribute) => [attribute.name.toLowerCase(), attribute.value]));
      if (attributes.get('http-equiv')?.trim().toLowerCase() === 'refresh') throw coded('PREPROCESSOR_REPLAY_UNSAFE');
    }
    for (const attribute of record.attrs ?? []) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || resourceAttributes.has(name)) throw coded('PREPROCESSOR_REPLAY_UNSAFE');
      if (name === 'style') assertCssStructurallySafe(`x{${attribute.value}}`);
    }
    for (const child of record.childNodes ?? []) visit(child);
  };
  visit(parse(reparsed));
  assertCssStructurallySafe(css);
}

function assertCssStructurallySafe(css: string): void {
  let root: postcss.Root;
  try { root = postcss.parse(css); } catch { throw coded('PREPROCESSOR_REPLAY_UNSAFE'); }
  root.walkAtRules((rule) => { if (['import', 'font-face', 'namespace', 'document'].includes(rule.name.toLowerCase())) throw coded('PREPROCESSOR_REPLAY_UNSAFE'); });
  root.walkDecls((declaration) => {
    valueParser(declaration.value).walk((node) => {
      if (node.type === 'function' && ['url', 'image-set', '-webkit-image-set', 'local'].includes(node.value.toLowerCase())) throw coded('PREPROCESSOR_REPLAY_UNSAFE');
    });
  });
}
function coded(code: DiagnosticCode): Error { const error = new Error(code); error.name = code; return error; }
function diagnosticFromError(error: unknown): DiagnosticCode {
  const text = error instanceof Error ? `${error.name}:${error.message}` : String(error);
  if (text.includes('CSS_MOTION_')) return 'PREPROCESSOR_CONSTRUCT_UNSUPPORTED';
  const known: DiagnosticCode[] = ['PREPROCESSOR_ROUTE_VIOLATION', 'PREPROCESSOR_RESOURCE_INVALID', 'PREPROCESSOR_BINDING_INVALID', 'PREPROCESSOR_ACTION_INVALID', 'PREPROCESSOR_INVENTORY_MISMATCH', 'PREPROCESSOR_CONSTRUCT_UNSUPPORTED', 'PREPROCESSOR_REPLAY_UNSAFE', 'PREPROCESSOR_CAPTURE_UNSTABLE'];
  return known.find((code) => text.includes(code)) ?? 'PREPROCESSOR_RUNTIME_ERROR';
}
