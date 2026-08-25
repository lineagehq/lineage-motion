import { createHash } from 'node:crypto';

export const PREPROCESSOR_VERSION = 'browser-resolved-preprocessor.v3' as const;
export const OWNER_INPUT_SCHEMA_VERSION = 'motion.browser-resolved-owner-input.v3' as const;
export const CANDIDATE_SCHEMA_VERSION = 'motion.browser-resolved-candidate-package.v3' as const;
export const RECEIPT_SCHEMA_VERSION = 'motion.browser-resolved-preprocessor-receipt.v3' as const;
export const ADMISSION_SCHEMA_VERSION = 'motion.browser-resolved-admission-package.v3' as const;
export const EXPECTED_ROOT_SCHEMA_VERSION = 'motion.browser-resolved-expected-root.v2' as const;
export const COVERAGE_SCHEMA_VERSION = 'motion.browser-resolved-closed-profile.v1' as const;

export type DiagnosticCode = 'PREPROCESSOR_OWNER_INPUT_INVALID' | 'PREPROCESSOR_PROTOCOL_MISMATCH' | 'PREPROCESSOR_LOCK_MISMATCH' | 'PREPROCESSOR_BROWSER_MISMATCH' | 'PREPROCESSOR_ROUTE_VIOLATION' | 'PREPROCESSOR_RESOURCE_INVALID' | 'PREPROCESSOR_BINDING_INVALID' | 'PREPROCESSOR_ACTION_INVALID' | 'PREPROCESSOR_INVENTORY_MISMATCH' | 'PREPROCESSOR_CONSTRUCT_UNSUPPORTED' | 'PREPROCESSOR_BOUNDARY_INCOMPLETE' | 'PREPROCESSOR_CAPTURE_UNSTABLE' | 'PREPROCESSOR_EQUIVALENCE_FAILED' | 'PREPROCESSOR_RESET_UNEQUAL' | 'PREPROCESSOR_NETWORK_ACTIVITY' | 'PREPROCESSOR_RUNTIME_ERROR' | 'PREPROCESSOR_REPLAY_UNSAFE' | 'PREPROCESSOR_ARTIFACT_INVALID';
export type OwnerAction = Readonly<{ kind: 'click' | 'focus' | 'hover' | 'key'; bindingId: string; key?: 'Enter' | 'Space' | 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Escape' }>;
export type OwnerBinding = Readonly<{ bindingId: string; role: 'focal' | 'secondary' | 'trigger'; locator: string; expectedMatches: 1 }>;
export type LockedResponse = Readonly<{ requestUrl: string; status: number; headers: Readonly<Record<string, string>>; mimeType: string; body: string; bodySha256: string }>;
export const CLOSED_PROFILE_CATEGORIES = ['structural', 'css', 'application', 'resource', 'binding-action', 'event', 'reset'] as const;
export type CoverageCategory = typeof CLOSED_PROFILE_CATEGORIES[number];
export type OwnerInput = Readonly<{
  schemaVersion: typeof OWNER_INPUT_SCHEMA_VERSION; protocolVersion: typeof PREPROCESSOR_VERSION;
  sourceLock: Readonly<{ entryRequest: string; originalSha256: string; redirects: readonly Readonly<{ from: string; to: string; status: 301 | 302 | 303 | 307 | 308 }>[]; responses: readonly LockedResponse[] }>;
  environment: Readonly<{ browserName: 'chromium'; browserVersion: string; viewport: Readonly<{ width: number; height: number }>; deviceScaleFactor: 1; locale: 'en-US'; timezoneId: 'UTC'; colorScheme: 'light'; contrast: 'no-preference'; profiles: readonly ['normal', 'reduced'] }>;
  bindings: readonly OwnerBinding[];
  procedure: Readonly<{ readiness: 'dom-fonts-two-animation-frames'; start: readonly OwnerAction[]; actions: readonly OwnerAction[]; loopDurationMs: number; settledTimeMs: number; epsilonMs: 1; reset: 'reload-reapply-and-compare-initial' }>;
  expectedInventory: Readonly<{ dom: number; cssRules: number; keyframes: number; applications: number; scripts: number; resources: number; pseudos: number; conditionals: number; transitions: number; animatedBindingIds: readonly string[] }>;
  closedProfile: Readonly<{ categories: readonly CoverageCategory[]; counts: Readonly<Record<CoverageCategory, number>> }>;
}>;
export type LockedOwnerInput = Readonly<{ bytes: string; sha256: string }>;
export type ConstructDisposition = 'preserved-declarative' | 'inlined-locked' | 'condition-preserved' | 'owner-action-executed' | 'reset-proved' | 'identity-bound' | 'unsupported';
export type ConstructRecord = Readonly<{ id: string; kind: 'dom' | 'css-rule' | 'keyframe' | 'application' | 'script' | 'resource' | 'pseudo' | 'conditional' | 'transition' | 'action' | 'reset' | 'mutation' | 'animation' | 'event'; disposition: ConstructDisposition; canonicalInput: string; canonicalOutput: string }>;
export type SamplePoint = Readonly<{ timeMs: number; reason: readonly string[] }>;
export type NodeProvenance = Readonly<{ bindingId: string; stableId: string; nodeProvenanceSha256: string; captureNamespaceSha256: string }>;
export type CoverageRecord = Readonly<{ id: string; category: CoverageCategory; syntaxKind: ConstructRecord['kind']; canonicalSha256: string; disposition: ConstructDisposition }>;
export type ClosedProfileReport = Readonly<{ schemaVersion: typeof COVERAGE_SCHEMA_VERSION; categories: readonly CoverageCategory[]; counts: Readonly<Record<CoverageCategory, number>>; records: readonly CoverageRecord[]; parseErrors: readonly string[]; unregistered: readonly string[] }>;
export type CanonicalObservation = Readonly<{ provenance: readonly NodeProvenance[]; animations: readonly unknown[]; samples: readonly unknown[]; initialDigest: string; resetDigest: string; requests: readonly string[]; errors: readonly string[]; resetCheckpoints: Readonly<{ beforeStart: string; afterStart: string; postLoop: string; afterReset: string }>; mutations: number; events: readonly string[] }>;
export type CanonicalRunEvidence = Readonly<{ profile: 'normal' | 'reduced'; observation: CanonicalObservation }>;
export type PreparationEvidence = Readonly<{ replayHtml: string; replayCss: string; inventory: OwnerInput['expectedInventory']; ledger: readonly ConstructRecord[]; schedule: readonly SamplePoint[]; provenance: readonly NodeProvenance[]; requestLedger: readonly string[]; errors: readonly string[]; mutations: number }>;
export type DetailedEvidence = Readonly<{ ownerInputLockSha256: string; originalCaptureSha256: string; captureNamespaceSha256: string; browserEnvironment: OwnerInput['environment']; actualBrowserVersion: string; expectedInventory: OwnerInput['expectedInventory']; expectedCoverageCounts: OwnerInput['closedProfile']['counts']; expectedLockedRequestUrls: readonly string[]; closedProfile: ClosedProfileReport; boundarySchedule: readonly SamplePoint[]; provenance: readonly NodeProvenance[]; preparationRuns: readonly PreparationEvidence[]; sourceRuns: readonly CanonicalRunEvidence[]; replayRuns: readonly CanonicalRunEvidence[] }>;
export type ReplayPackage = Readonly<{ protocolVersion: typeof PREPROCESSOR_VERSION; html: string; css: string; bytes: string; sha256: string }>;
export type PreprocessorReceipt = Readonly<{ schemaVersion: typeof RECEIPT_SCHEMA_VERSION; protocolVersion: typeof PREPROCESSOR_VERSION; ownerInputLockVerified: boolean; browserPinned: boolean; lockedRoutingComplete: boolean; closedProfileCovered: boolean; boundariesComplete: boolean; profilesComplete: boolean; threeCleanRuns: boolean; stableIdentityProven: boolean; replayEquivalent: boolean; resetEquivalent: boolean; zeroReplayRequests: boolean; zeroErrors: boolean; deterministicExecution: boolean; admitted: boolean; diagnosticCodes: readonly DiagnosticCode[]; candidatePackageSha256?: string; detailedEvidenceSha256?: string }>;
export type CandidatePackage = Readonly<{ schemaVersion: typeof CANDIDATE_SCHEMA_VERSION; ownerInputLockSha256: string; replayPackage: ReplayPackage; detailedEvidence: DetailedEvidence; receipt: PreprocessorReceipt; bytes: string; sha256: string }>;
export type ExpectedAdmissionRoot = Readonly<{ schemaVersion: typeof EXPECTED_ROOT_SCHEMA_VERSION; ownerInputLockSha256: string; candidatePackageSha256: string }>;
export type ExternallyAuthenticatedExpectedRoot = Readonly<{
  expectedRoot: ExpectedAdmissionRoot;
  externallyAuthenticatedRootSha256: string;
  authentication: 'external-preexisting';
}>;
export type AdmissionPackage = Readonly<{ schemaVersion: typeof ADMISSION_SCHEMA_VERSION; expectedRoot: ExpectedAdmissionRoot; candidatePackage: CandidatePackage; receipt: PreprocessorReceipt; bytes: string; sha256: string }>;
export type IntegratedPreprocessorResult = Readonly<{ admissionPackage: AdmissionPackage | null; replayPackage: ReplayPackage | null; detailedEvidence: DetailedEvidence | null; receipt: PreprocessorReceipt }>;
export type PreprocessorCandidateResult = Readonly<{ candidatePackage: CandidatePackage | null; receipt: PreprocessorReceipt }>;
export type PassiveIntegrityInspection = Readonly<{
  integrity: 'valid' | 'invalid';
  authenticatedRootMatch: boolean | null;
  behavioralVerdict: null;
  admitted: false;
  diagnosticCodes: readonly DiagnosticCode[];
}>;

export function sha256(bytes: string | Uint8Array): string { return createHash('sha256').update(bytes).digest('hex'); }
export function stableJson(value: unknown): string { return JSON.stringify(sortValue(value)); }
export function lockOwnerInput(input: OwnerInput): LockedOwnerInput { const bytes = stableJson(input); return { bytes, sha256: sha256(bytes) }; }
export function createExpectedAdmissionRoot(ownerInputLockSha256: string, candidatePackageSha256: string): ExpectedAdmissionRoot { return { schemaVersion: EXPECTED_ROOT_SCHEMA_VERSION, ownerInputLockSha256, candidatePackageSha256 }; }
export function authenticateExpectedAdmissionRoot(
  expectedRoot: ExpectedAdmissionRoot,
  externallyAuthenticatedRootSha256: string,
): ExternallyAuthenticatedExpectedRoot | null {
  if (!root(expectedRoot) || !digest(externallyAuthenticatedRootSha256) || sha256(stableJson(expectedRoot)) !== externallyAuthenticatedRootSha256) return null;
  return { expectedRoot, externallyAuthenticatedRootSha256, authentication: 'external-preexisting' };
}
export function rejectedResult(diagnosticCodes: readonly DiagnosticCode[], evidence: Partial<Omit<PreprocessorReceipt, 'schemaVersion' | 'protocolVersion' | 'admitted' | 'diagnosticCodes'>> = {}): IntegratedPreprocessorResult {
  return { admissionPackage: null, replayPackage: null, detailedEvidence: null, receipt: { schemaVersion: RECEIPT_SCHEMA_VERSION, protocolVersion: PREPROCESSOR_VERSION, ownerInputLockVerified: false, browserPinned: false, lockedRoutingComplete: false, closedProfileCovered: false, boundariesComplete: false, profilesComplete: false, threeCleanRuns: false, stableIdentityProven: false, replayEquivalent: false, resetEquivalent: false, zeroReplayRequests: false, zeroErrors: false, deterministicExecution: false, ...evidence, admitted: false, diagnosticCodes: [...new Set(diagnosticCodes)] } };
}

export function buildClosedProfileReport(ledger: readonly ConstructRecord[]): ClosedProfileReport {
  const records = ledger.map((record): CoverageRecord => ({ id: record.id, category: coverageCategory(record), syntaxKind: record.kind, canonicalSha256: sha256(stableJson({ input: record.canonicalInput, output: record.canonicalOutput })), disposition: record.disposition })).sort((a, b) => a.id.localeCompare(b.id));
  const counts = Object.fromEntries(CLOSED_PROFILE_CATEGORIES.map((category) => [category, records.filter((record) => record.category === category).length])) as Record<CoverageCategory, number>;
  return { schemaVersion: COVERAGE_SCHEMA_VERSION, categories: [...CLOSED_PROFILE_CATEGORIES], counts, records, parseErrors: [], unregistered: [] };
}
export function inspectCandidatePackage(value: unknown): PassiveIntegrityInspection {
  if (!exact(value, ['schemaVersion', 'ownerInputLockSha256', 'replayPackage', 'detailedEvidence', 'receipt', 'bytes', 'sha256']) || value.schemaVersion !== CANDIDATE_SCHEMA_VERSION || !digest(value.ownerInputLockSha256) || typeof value.bytes !== 'string' || !digest(value.sha256)) return passiveInvalid(null);
  const core = { schemaVersion: value.schemaVersion, ownerInputLockSha256: value.ownerInputLockSha256, replayPackage: value.replayPackage, detailedEvidence: value.detailedEvidence, receipt: value.receipt };
  if (stableJson(core) !== value.bytes || sha256(value.bytes) !== value.sha256 || !replay(value.replayPackage) || !evidence(value.detailedEvidence) || !receipt(value.receipt)) return passiveInvalid(null);
  const e = value.detailedEvidence; const r = value.receipt; const ledger = e.preparationRuns[0]?.ledger;
  if (e.ownerInputLockSha256 !== value.ownerInputLockSha256 || r.admitted !== false || r.diagnosticCodes.length !== 0 || r.candidatePackageSha256 !== undefined || !ledger || !e.preparationRuns.every((run) => stableJson(run.ledger) === stableJson(ledger)) || stableJson(e.closedProfile) !== stableJson(buildClosedProfileReport(ledger))) return passiveInvalid(null);
  if (!e.preparationRuns.every((run) => run.replayHtml === value.replayPackage.html && run.replayCss === value.replayPackage.css)) return passiveInvalid(null);
  const claims = recompute(e); if (!claims || !Object.entries(claims).every(([key, claim]) => (r as Record<string, unknown>)[key] === claim) || r.detailedEvidenceSha256 !== sha256(stableJson(e))) return passiveInvalid(null);
  return passiveValid(null);
}
export function inspectAdmissionPackage(value: unknown, authenticatedRoot?: ExternallyAuthenticatedExpectedRoot): PassiveIntegrityInspection {
  if (!authenticatedRootValid(authenticatedRoot)) return passiveInvalid(null);
  const expectedRoot = authenticatedRoot.expectedRoot;
  if (!exact(value, ['schemaVersion', 'expectedRoot', 'candidatePackage', 'receipt', 'bytes', 'sha256']) || value.schemaVersion !== ADMISSION_SCHEMA_VERSION || typeof value.bytes !== 'string' || !digest(value.sha256) || stableJson(value.expectedRoot) !== stableJson(expectedRoot) || !plain(value.candidatePackage) || !plain(value.receipt)) return passiveInvalid(false);
  if (inspectCandidatePackage(value.candidatePackage).integrity !== 'valid' || value.candidatePackage.sha256 !== expectedRoot.candidatePackageSha256 || value.candidatePackage.ownerInputLockSha256 !== expectedRoot.ownerInputLockSha256) return passiveInvalid(false);
  const admitted = { ...value.candidatePackage.receipt, admitted: true, candidatePackageSha256: value.candidatePackage.sha256 };
  const core = { schemaVersion: value.schemaVersion, expectedRoot: value.expectedRoot, candidatePackage: value.candidatePackage, receipt: value.receipt };
  return stableJson(value.receipt) === stableJson(admitted) && stableJson(core) === value.bytes && sha256(value.bytes) === value.sha256 ? passiveValid(true) : passiveInvalid(false);
}

function recompute(e: DetailedEvidence): Record<string, boolean> | null {
  const p = e.preparationRuns, s = e.sourceRuns, r = e.replayRuns; if (p.length !== 3 || !s.every(run) || !r.every(run)) return null;
  const profiles = count(s, 'normal') === 3 && count(s, 'reduced') === 3 && count(r, 'normal') === 3 && count(r, 'reduced') === 3;
  const semantic = (o: CanonicalObservation): string => stableJson({ provenance: o.provenance, animations: o.animations, samples: o.samples, resetCheckpoints: o.resetCheckpoints, events: o.events });
  const equivalent = s.length === r.length && s.every((item, i) => item.profile === r[i]?.profile && semantic(item.observation) === semantic(r[i]!.observation));
  const reset = [...s, ...r].every((item) => item.observation.resetCheckpoints.afterStart === item.observation.resetCheckpoints.afterReset) && s.every((item, i) => stableJson(item.observation.resetCheckpoints) === stableJson(r[i]?.observation.resetCheckpoints));
  const covered = e.closedProfile.parseErrors.length === 0 && e.closedProfile.unregistered.length === 0 && stableJson(e.closedProfile.categories) === stableJson(CLOSED_PROFILE_CATEGORIES) && stableJson(e.closedProfile.counts) === stableJson(e.expectedCoverageCounts) && CLOSED_PROFILE_CATEGORIES.every((category) => e.closedProfile.records.some((item) => item.category === category)) && e.closedProfile.records.every((item) => item.disposition !== 'unsupported');
  return { ownerInputLockVerified: true, browserPinned: e.actualBrowserVersion === e.browserEnvironment.browserVersion, lockedRoutingComplete: p.every((item) => item.errors.length === 0 && stableJson([...item.requestLedger].sort()) === stableJson([...e.expectedLockedRequestUrls].sort())), closedProfileCovered: covered, boundariesComplete: e.boundarySchedule.length >= 3 && p.every((item) => stableJson(item.schedule) === stableJson(e.boundarySchedule)), profilesComplete: profiles, threeCleanRuns: profiles && stable(s) && stable(r), stableIdentityProven: [...s, ...r].every((item) => stableJson(item.observation.provenance) === stableJson(e.provenance)), replayEquivalent: equivalent, resetEquivalent: reset, zeroReplayRequests: r.every((item) => item.observation.requests.length === 0), zeroErrors: p.every((item) => item.errors.length === 0 && item.mutations === 0) && [...s, ...r].every((item) => item.observation.errors.length === 0 && item.observation.mutations === 0), deterministicExecution: new Set(p.map(stableJson)).size === 1 && stable(s) && stable(r) };
}
function coverageCategory(record: ConstructRecord): CoverageCategory { if (record.kind === 'dom') return 'structural'; if (['css-rule', 'keyframe', 'pseudo', 'conditional', 'transition'].includes(record.kind)) return 'css'; if (record.kind === 'application' || record.kind === 'animation') return 'application'; if (record.kind === 'resource') return 'resource'; if (record.kind === 'action' || (record.kind === 'event' && record.disposition === 'identity-bound')) return 'binding-action'; if (record.kind === 'reset') return 'reset'; return 'event'; }
function replay(v: unknown): v is ReplayPackage { return exact(v, ['protocolVersion', 'html', 'css', 'bytes', 'sha256']) && v.protocolVersion === PREPROCESSOR_VERSION && typeof v.html === 'string' && typeof v.css === 'string' && typeof v.bytes === 'string' && digest(v.sha256) && v.bytes === stableJson({ protocolVersion: v.protocolVersion, html: v.html, css: v.css }) && sha256(v.bytes) === v.sha256; }
function evidence(v: unknown): v is DetailedEvidence { return exact(v, ['ownerInputLockSha256', 'originalCaptureSha256', 'captureNamespaceSha256', 'browserEnvironment', 'actualBrowserVersion', 'expectedInventory', 'expectedCoverageCounts', 'expectedLockedRequestUrls', 'closedProfile', 'boundarySchedule', 'provenance', 'preparationRuns', 'sourceRuns', 'replayRuns']) && digest(v.ownerInputLockSha256) && digest(v.originalCaptureSha256) && digest(v.captureNamespaceSha256) && plain(v.browserEnvironment) && typeof v.actualBrowserVersion === 'string' && plain(v.expectedInventory) && plain(v.expectedCoverageCounts) && Array.isArray(v.expectedLockedRequestUrls) && Array.isArray(v.boundarySchedule) && Array.isArray(v.provenance) && Array.isArray(v.preparationRuns) && v.preparationRuns.every(preparation) && Array.isArray(v.sourceRuns) && Array.isArray(v.replayRuns) && plain(v.closedProfile); }
function receipt(v: unknown): v is PreprocessorReceipt { const required = ['schemaVersion', 'protocolVersion', 'ownerInputLockVerified', 'browserPinned', 'lockedRoutingComplete', 'closedProfileCovered', 'boundariesComplete', 'profilesComplete', 'threeCleanRuns', 'stableIdentityProven', 'replayEquivalent', 'resetEquivalent', 'zeroReplayRequests', 'zeroErrors', 'deterministicExecution', 'admitted', 'diagnosticCodes', 'detailedEvidenceSha256']; return plain(v) && Object.keys(v).every((key) => [...required, 'candidatePackageSha256'].includes(key)) && required.every((key) => key in v) && v.schemaVersion === RECEIPT_SCHEMA_VERSION && v.protocolVersion === PREPROCESSOR_VERSION && Array.isArray(v.diagnosticCodes) && digest(v.detailedEvidenceSha256); }
function preparation(v: unknown): v is PreparationEvidence { return exact(v, ['replayHtml', 'replayCss', 'inventory', 'ledger', 'schedule', 'provenance', 'requestLedger', 'errors', 'mutations']) && typeof v.replayHtml === 'string' && typeof v.replayCss === 'string' && plain(v.inventory) && Array.isArray(v.ledger) && v.ledger.every(construct) && Array.isArray(v.schedule) && Array.isArray(v.provenance) && Array.isArray(v.requestLedger) && Array.isArray(v.errors) && Number.isInteger(v.mutations); }
function construct(v: unknown): v is ConstructRecord { return exact(v, ['id', 'kind', 'disposition', 'canonicalInput', 'canonicalOutput']) && typeof v.id === 'string' && typeof v.kind === 'string' && typeof v.disposition === 'string' && typeof v.canonicalInput === 'string' && typeof v.canonicalOutput === 'string' && v.id === `construct_${sha256(`${v.kind}:${v.canonicalInput}`).slice(0, 24)}`; }
function run(v: unknown): v is CanonicalRunEvidence { return exact(v, ['profile', 'observation']) && ['normal', 'reduced'].includes(String(v.profile)) && plain(v.observation) && exact(v.observation, ['provenance', 'animations', 'samples', 'initialDigest', 'resetDigest', 'requests', 'errors', 'resetCheckpoints', 'mutations', 'events']) && digest(v.observation.initialDigest) && digest(v.observation.resetDigest) && Array.isArray(v.observation.provenance) && Array.isArray(v.observation.animations) && Array.isArray(v.observation.samples) && Array.isArray(v.observation.requests) && Array.isArray(v.observation.errors) && plain(v.observation.resetCheckpoints) && Number.isInteger(v.observation.mutations) && Array.isArray(v.observation.events); }
function count(runs: readonly CanonicalRunEvidence[], profile: CanonicalRunEvidence['profile']): number { return runs.filter((item) => item.profile === profile).length; }
function stable(runs: readonly CanonicalRunEvidence[]): boolean { return (['normal', 'reduced'] as const).every((profile) => new Set(runs.filter((item) => item.profile === profile).map((item) => stableJson(item.observation))).size === 1); }

export function decodeLockedOwnerInput(value: unknown): { input: OwnerInput | null; lockVerified: boolean; diagnostics: DiagnosticCode[] } {
  const diagnostics: DiagnosticCode[] = []; if (!exact(value, ['bytes', 'sha256']) || typeof value.bytes !== 'string' || !digest(value.sha256)) return { input: null, lockVerified: false, diagnostics: ['PREPROCESSOR_OWNER_INPUT_INVALID'] };
  const lockVerified = sha256(value.bytes) === value.sha256; if (!lockVerified) diagnostics.push('PREPROCESSOR_LOCK_MISMATCH'); let parsed: unknown;
  try { parsed = JSON.parse(value.bytes); } catch { return { input: null, lockVerified, diagnostics: [...diagnostics, 'PREPROCESSOR_OWNER_INPUT_INVALID'] }; }
  if (!owner(parsed)) return { input: null, lockVerified, diagnostics: [...diagnostics, 'PREPROCESSOR_OWNER_INPUT_INVALID'] };
  if (parsed.schemaVersion !== OWNER_INPUT_SCHEMA_VERSION || parsed.protocolVersion !== PREPROCESSOR_VERSION) diagnostics.push('PREPROCESSOR_PROTOCOL_MISMATCH'); return { input: parsed, lockVerified, diagnostics };
}
function owner(v: unknown): v is OwnerInput {
  if (!exact(v, ['schemaVersion', 'protocolVersion', 'sourceLock', 'environment', 'bindings', 'procedure', 'expectedInventory', 'closedProfile']) || typeof v.schemaVersion !== 'string' || typeof v.protocolVersion !== 'string') return false;
  if (!exact(v.sourceLock, ['entryRequest', 'originalSha256', 'redirects', 'responses']) || !http(v.sourceLock.entryRequest) || !digest(v.sourceLock.originalSha256) || !Array.isArray(v.sourceLock.redirects) || !v.sourceLock.redirects.every(redirect) || !Array.isArray(v.sourceLock.responses) || v.sourceLock.responses.length === 0 || !v.sourceLock.responses.every(response)) return false;
  if (!exact(v.environment, ['browserName', 'browserVersion', 'viewport', 'deviceScaleFactor', 'locale', 'timezoneId', 'colorScheme', 'contrast', 'profiles']) || v.environment.browserName !== 'chromium' || typeof v.environment.browserVersion !== 'string' || !v.environment.browserVersion || v.environment.deviceScaleFactor !== 1 || v.environment.locale !== 'en-US' || v.environment.timezoneId !== 'UTC' || v.environment.colorScheme !== 'light' || v.environment.contrast !== 'no-preference' || stableJson(v.environment.profiles) !== stableJson(['normal', 'reduced']) || !exact(v.environment.viewport, ['width', 'height']) || !positive(v.environment.viewport.width) || !positive(v.environment.viewport.height)) return false;
  if (!Array.isArray(v.bindings) || v.bindings.length === 0 || !v.bindings.every(binding) || !exact(v.procedure, ['readiness', 'start', 'actions', 'loopDurationMs', 'settledTimeMs', 'epsilonMs', 'reset']) || v.procedure.readiness !== 'dom-fonts-two-animation-frames' || v.procedure.epsilonMs !== 1 || v.procedure.reset !== 'reload-reapply-and-compare-initial' || !Array.isArray(v.procedure.start) || !v.procedure.start.every(action) || !Array.isArray(v.procedure.actions) || !v.procedure.actions.every(action) || !finitePositive(v.procedure.loopDurationMs) || !finiteNonnegative(v.procedure.settledTimeMs) || Number(v.procedure.settledTimeMs) > Number(v.procedure.loopDurationMs)) return false;
  if (!exact(v.expectedInventory, ['dom', 'cssRules', 'keyframes', 'applications', 'scripts', 'resources', 'pseudos', 'conditionals', 'transitions', 'animatedBindingIds']) || !['dom', 'cssRules', 'keyframes', 'applications', 'scripts', 'resources', 'pseudos', 'conditionals', 'transitions'].every((key) => nonnegative(v.expectedInventory[key])) || !Array.isArray(v.expectedInventory.animatedBindingIds) || !v.expectedInventory.animatedBindingIds.every(bindingId)) return false;
  return exact(v.closedProfile, ['categories', 'counts']) && stableJson(v.closedProfile.categories) === stableJson(CLOSED_PROFILE_CATEGORIES) && plain(v.closedProfile.counts) && exact(v.closedProfile.counts, CLOSED_PROFILE_CATEGORIES) && Object.values(v.closedProfile.counts).every(nonnegative);
}
function root(v: unknown): v is ExpectedAdmissionRoot { return exact(v, ['schemaVersion', 'ownerInputLockSha256', 'candidatePackageSha256']) && v.schemaVersion === EXPECTED_ROOT_SCHEMA_VERSION && digest(v.ownerInputLockSha256) && digest(v.candidatePackageSha256); }
function response(v: unknown): boolean { return exact(v, ['requestUrl', 'status', 'headers', 'mimeType', 'body', 'bodySha256']) && http(v.requestUrl) && Number.isInteger(v.status) && Number(v.status) >= 200 && Number(v.status) <= 299 && plain(v.headers) && Object.values(v.headers).every((x) => typeof x === 'string') && typeof v.mimeType === 'string' && typeof v.body === 'string' && digest(v.bodySha256); }
function redirect(v: unknown): boolean { return exact(v, ['from', 'to', 'status']) && http(v.from) && http(v.to) && [301, 302, 303, 307, 308].includes(Number(v.status)); }
function binding(v: unknown): boolean { return exact(v, ['bindingId', 'role', 'locator', 'expectedMatches']) && bindingId(v.bindingId) && ['focal', 'secondary', 'trigger'].includes(String(v.role)) && typeof v.locator === 'string' && v.expectedMatches === 1; }
function action(v: unknown): boolean { const keyed = plain(v) && v.kind === 'key'; return exact(v, keyed ? ['kind', 'bindingId', 'key'] : ['kind', 'bindingId']) && bindingId(v.bindingId) && ['click', 'focus', 'hover', 'key'].includes(String(v.kind)) && (v.kind !== 'key' || ['Enter', 'Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Escape'].includes(String(v.key))); }
function authenticatedRootValid(value: unknown): value is ExternallyAuthenticatedExpectedRoot {
  return exact(value, ['expectedRoot', 'externallyAuthenticatedRootSha256', 'authentication'])
    && value.authentication === 'external-preexisting'
    && root(value.expectedRoot)
    && digest(value.externallyAuthenticatedRootSha256)
    && sha256(stableJson(value.expectedRoot)) === value.externallyAuthenticatedRootSha256;
}
function passiveValid(authenticatedRootMatch: boolean | null): PassiveIntegrityInspection { return { integrity: 'valid', authenticatedRootMatch, behavioralVerdict: null, admitted: false, diagnosticCodes: [] }; }
function passiveInvalid(authenticatedRootMatch: boolean | null): PassiveIntegrityInspection { return { integrity: 'invalid', authenticatedRootMatch, behavioralVerdict: null, admitted: false, diagnosticCodes: ['PREPROCESSOR_ARTIFACT_INVALID'] }; }
function bindingId(v: unknown): v is string { return typeof v === 'string' && /^binding_[a-z0-9_-]{1,64}$/.test(v); }
function http(v: unknown): v is string { if (typeof v !== 'string') return false; try { return ['http:', 'https:'].includes(new URL(v).protocol); } catch { return false; } }
function digest(v: unknown): v is string { return typeof v === 'string' && /^[a-f0-9]{64}$/.test(v); }
function positive(v: unknown): boolean { return typeof v === 'number' && Number.isInteger(v) && v > 0 && v <= 10_000; }
function nonnegative(v: unknown): boolean { return typeof v === 'number' && Number.isInteger(v) && v >= 0; }
function finitePositive(v: unknown): boolean { return typeof v === 'number' && Number.isFinite(v) && v > 0; }
function finiteNonnegative(v: unknown): boolean { return typeof v === 'number' && Number.isFinite(v) && v >= 0; }
function exact(v: unknown, keys: readonly string[]): v is Record<string, any> { return plain(v) && stableJson(Object.keys(v).sort()) === stableJson([...keys].sort()); }
function plain(v: unknown): v is Record<string, any> { return typeof v === 'object' && v !== null && !Array.isArray(v) && (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null); }
function sortValue(v: unknown): unknown { if (Array.isArray(v)) return v.map(sortValue); if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)])); return v; }

export { acquireAndPreprocessLockedOwnerInput, precommitLockedOwnerInputCandidate } from './acquisition.js';
