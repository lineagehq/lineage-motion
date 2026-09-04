import {
  IDENTITY_BIND_FAILURE_STEPS, IDENTITY_DERIVATION_OPERATIONS,
  RUNTIME_OBSERVATION_DIAGNOSTIC_SCHEMA_VERSION, RUNTIME_OBSERVATION_SUBSTAGES,
  RUNTIME_PREPARATION_SUBSTAGES,
  type IdentityBindFailureStep, type IdentityBindProgress, type IdentityDerivationOperation,
  type RuntimeObservationSubstage, type RuntimeObservationSummary, type RuntimePreparationSubstage,
} from './index.js';

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
