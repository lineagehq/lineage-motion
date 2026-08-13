import { z } from 'zod';

export type Diagnostic = {
  code: string;
  severity: 'error' | 'warning';
  summary: string;
  line?: number;
  column?: number;
};

export type TimingFunction =
  | { kind: 'keyword'; value: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' }
  | { kind: 'steps'; count: number; position: string }
  | { kind: 'cubic-bezier'; x1: number; y1: number; x2: number; y2: number };

export type RuleTrack = {
  id: string;
  property: string;
  interpolation: 'continuous' | 'discrete' | 'step';
  keyframes: Array<{
    id: string;
    offset: number;
    value: string;
    easing?: TimingFunction;
  }>;
};

export type SourceProvenance = {
  sourceKind: 'direct' | 'offline-font-materialized';
  originalSourceDigest: string;
  materializedSourceDigest: string;
  resourceLockDigest: string | null;
  stylesheetDigest: string | null;
  aggregateFontAssetDigest: string | null;
  fontAssetCount: number;
};

export type MotionCue = {
  schemaVersion: 'motion.cue.v1';
  id: string;
  label: string;
  timeMs: number;
};

export type MotionHold = {
  schemaVersion: 'motion.hold.v1';
  id: string;
  cueId: 'cue_pair';
  sourceTimeMs: 2870;
  durationMs: 600;
};

export type MotionDocument = {
  schemaVersion: 'motion.document.v1';
  documentId: string;
  revision: number;
  durationMs: number;
  presentation: { html: string; css: string };
  elements: Array<{
    id: string;
    selectorHint: string;
    structuralFingerprint: string;
    editableText?: string;
  }>;
  rules: Array<{ id: string; sourceName: string; tracks: RuleTrack[] }>;
  applications: Array<{
    id: string;
    bindings: Array<{
      elementId: string;
      delayOverridesMs: number[];
    }>;
    selectorHint: string;
    slots: Array<{
      id: string;
      ruleId: string;
      durationMs: number;
      delayMs: number;
      iterationCount: number | 'infinite';
      direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
      fillMode: 'none' | 'forwards' | 'backwards' | 'both';
      playState: 'running' | 'paused';
      timingFunction: TimingFunction;
    }>;
  }>;
  tracks: Array<{
    id: string;
    elementId: string;
    ruleId: string;
    slotId: string;
    property: string;
    interpolation: 'continuous' | 'discrete' | 'step';
    keyframeIds: string[];
  }>;
  cues: MotionCue[];
  /** Source-to-story warps. Absent on imported source; authored documents store the explicit record. */
  holds?: MotionHold[];
  inventory: {
    sourceDigest: string;
    ruleCount: number;
    applicationCount: number;
    slotCount: number;
    trackCount: number;
    supportedCount: number;
    unsupportedCount: number;
    missingCount: number;
    diagnosticCodes: string[];
  };
  provenance: SourceProvenance;
  reducedMotion: { mode: 'source-snapshot'; css: string };
};

export type ValidationResult =
  | { ok: true; document: MotionDocument }
  | { ok: false; diagnostics: Diagnostic[] };

const identifier = z.string().min(1);
const timingFunctionSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('keyword'),
    value: z.enum(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']),
  }),
  z.object({
    kind: z.literal('steps'),
    count: z.number().int().positive(),
    position: z.string().min(1),
  }),
  z.object({
    kind: z.literal('cubic-bezier'),
    x1: z.number(),
    y1: z.number(),
    x2: z.number(),
    y2: z.number(),
  }),
]);
const ruleTrackSchema = z.object({
  id: identifier,
  property: identifier,
  interpolation: z.enum(['continuous', 'discrete', 'step']),
  keyframes: z.array(
    z.object({
      id: identifier,
      offset: z.number().min(0).max(1),
      value: z.string(),
      easing: timingFunctionSchema.optional(),
    }),
  ).min(1),
});
const cueSchema = z.object({
  schemaVersion: z.literal('motion.cue.v1'),
  id: identifier,
  label: z.string().min(1),
  timeMs: z.number().int().nonnegative(),
});
const holdSchema = z.object({
  schemaVersion: z.literal('motion.hold.v1'),
  id: identifier,
  cueId: z.literal('cue_pair'),
  sourceTimeMs: z.literal(2870),
  durationMs: z.literal(600),
});
const motionDocumentSchema = z.object({
  schemaVersion: z.literal('motion.document.v1'),
  documentId: identifier,
  revision: z.number().int().nonnegative().safe(),
  durationMs: z.number().int().nonnegative(),
  presentation: z.object({ html: z.string(), css: z.string() }),
  elements: z.array(z.object({
    id: identifier,
    selectorHint: z.string(),
    structuralFingerprint: identifier,
    editableText: z.string().optional(),
  })),
  rules: z.array(z.object({
    id: identifier,
    sourceName: identifier,
    tracks: z.array(ruleTrackSchema).min(1),
  })),
  applications: z.array(z.object({
    id: identifier,
    bindings: z.array(z.object({
      elementId: identifier,
      delayOverridesMs: z.array(z.number().int()),
    })).min(1),
    selectorHint: z.string(),
    slots: z.array(z.object({
      id: identifier,
      ruleId: identifier,
      durationMs: z.number().int().nonnegative(),
      delayMs: z.number().int(),
      iterationCount: z.union([z.number().positive(), z.literal('infinite')]),
      direction: z.enum(['normal', 'reverse', 'alternate', 'alternate-reverse']),
      fillMode: z.enum(['none', 'forwards', 'backwards', 'both']),
      playState: z.enum(['running', 'paused']),
      timingFunction: timingFunctionSchema,
    })).min(1),
  })),
  tracks: z.array(z.object({
    id: identifier,
    elementId: identifier,
    ruleId: identifier,
    slotId: identifier,
    property: identifier,
    interpolation: z.enum(['continuous', 'discrete', 'step']),
    keyframeIds: z.array(identifier).min(1),
  })),
  cues: z.array(cueSchema),
  holds: z.array(holdSchema).max(1).optional(),
  inventory: z.object({
    sourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    ruleCount: z.number().int().nonnegative(),
    applicationCount: z.number().int().nonnegative(),
    slotCount: z.number().int().nonnegative(),
    trackCount: z.number().int().nonnegative(),
    supportedCount: z.number().int().nonnegative(),
    unsupportedCount: z.number().int().nonnegative(),
    missingCount: z.number().int().nonnegative(),
    diagnosticCodes: z.array(identifier),
  }),
  provenance: z.object({
    sourceKind: z.enum(['direct', 'offline-font-materialized']),
    originalSourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    materializedSourceDigest: z.string().regex(/^[a-f0-9]{64}$/),
    resourceLockDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    stylesheetDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    aggregateFontAssetDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
    fontAssetCount: z.number().int().nonnegative(),
  }),
  reducedMotion: z.object({ mode: z.literal('source-snapshot'), css: z.string() }),
});

export function validateMotionDocument(input: unknown): ValidationResult {
  const parsed = motionDocumentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      diagnostics: [{
        code: 'DOMAIN_SCHEMA_INVALID',
        severity: 'error',
        summary: 'The canonical motion document does not match its schema.',
      }],
    };
  }

  const document = parsed.data as MotionDocument;
  const slots = document.applications.flatMap((application) => application.slots);
  const ruleTracks = document.rules.flatMap((rule) => rule.tracks);
  const keyframes = ruleTracks.flatMap((track) => track.keyframes);
  const idGroups = [
    document.elements.map((element) => element.id),
    document.rules.map((rule) => rule.id),
    document.applications.map((application) => application.id),
    slots.map((slot) => slot.id),
    ruleTracks.map((track) => track.id),
    keyframes.map((keyframe) => keyframe.id),
    document.tracks.map((track) => track.id),
    document.cues.map((cue) => cue.id),
    (document.holds ?? []).map((hold) => hold.id),
  ];
  if (idGroups.some(hasDuplicates)
    || hasDuplicates(document.rules.map((rule) => rule.sourceName))
    || hasDuplicates(document.elements.map((element) => element.structuralFingerprint))) {
    return domainFailure('DOMAIN_DUPLICATE_ID', 'Canonical identities must be unique.');
  }
  if (document.cues.some((cue) => cue.timeMs > document.durationMs)) {
    return domainFailure('DOMAIN_CUE_TIME_INVALID', 'A cue falls outside the document duration.');
  }
  const holds = document.holds ?? [];
  if (holds.length > 0) {
    const hold = holds[0]!;
    const cue = document.cues.find((candidate) => candidate.id === hold.cueId);
    if (!cue || cue.timeMs !== hold.sourceTimeMs + hold.durationMs) {
      return domainFailure('DOMAIN_HOLD_CUE_INVALID', 'The hold must end at its approved cue.');
    }
  }

  const elementIds = new Set(document.elements.map((element) => element.id));
  const ruleIds = new Set(document.rules.map((rule) => rule.id));
  const slotIds = new Set(slots.map((slot) => slot.id));
  const ruleById = new Map(document.rules.map((rule) => [rule.id, rule]));
  const slotOwners = new Map(slots.flatMap((slot) => {
    const application = document.applications.find((candidate) => candidate.slots.includes(slot))!;
    return [[slot.id, { slot, application }] as const];
  }));

  const provenance = document.provenance;
  const directProvenanceValid = provenance.sourceKind === 'direct'
    && provenance.originalSourceDigest === document.inventory.sourceDigest
    && provenance.materializedSourceDigest === document.inventory.sourceDigest
    && provenance.resourceLockDigest === null
    && provenance.stylesheetDigest === null
    && provenance.aggregateFontAssetDigest === null
    && provenance.fontAssetCount === 0;
  const materializedProvenanceValid = provenance.sourceKind === 'offline-font-materialized'
    && provenance.materializedSourceDigest === document.inventory.sourceDigest
    && provenance.resourceLockDigest !== null
    && provenance.stylesheetDigest !== null
    && provenance.aggregateFontAssetDigest !== null
    && provenance.fontAssetCount > 0;
  if (!directProvenanceValid && !materializedProvenanceValid) {
    return domainFailure('DOMAIN_PROVENANCE_INVALID', 'Canonical source provenance is inconsistent.');
  }

  for (const rule of document.rules) {
    if (hasDuplicates(rule.tracks.map((track) => track.property))) {
      return domainFailure('DOMAIN_DUPLICATE_ID', 'Rule properties must be unique.');
    }
    for (const track of rule.tracks) {
      const offsets = track.keyframes.map((keyframe) => keyframe.offset);
      if (hasDuplicates(offsets) || offsets.some((offset, index) =>
        index > 0 && offset <= offsets[index - 1]!,
      )) {
        return domainFailure('DOMAIN_TRACK_RELATIONSHIP_INVALID', 'Rule keyframes must be uniquely ordered.');
      }
    }
  }

  for (const application of document.applications) {
    if (hasDuplicates(application.bindings.map((binding) => binding.elementId))) {
      return domainFailure('DOMAIN_DUPLICATE_ID', 'Application bindings must be unique.');
    }
    if (application.bindings.some((binding) => !elementIds.has(binding.elementId))) {
      return {
        ok: false,
        diagnostics: [{
          code: 'DOMAIN_UNKNOWN_ELEMENT',
          severity: 'error',
          summary: 'An application references an unknown canonical element.',
        }],
      };
    }
    if (application.bindings.some((binding) =>
      binding.delayOverridesMs.length !== application.slots.length,
    )) {
      return {
        ok: false,
        diagnostics: [{
          code: 'DOMAIN_BINDING_DELAY_MISMATCH',
          severity: 'error',
          summary: 'An application binding does not cover every ordered slot delay.',
        }],
      };
    }
    if (application.slots.some((slot) => !ruleIds.has(slot.ruleId))) {
      return domainFailure(
        'DOMAIN_UNKNOWN_MOTION_REFERENCE',
        'An application slot references an unknown animation rule.',
      );
    }
  }

  for (const track of document.tracks) {
    if (!elementIds.has(track.elementId)) {
      return {
        ok: false,
        diagnostics: [{
          code: 'DOMAIN_UNKNOWN_ELEMENT',
          severity: 'error',
          summary: 'A track references an unknown canonical element.',
        }],
      };
    }
    if (!ruleIds.has(track.ruleId) || !slotIds.has(track.slotId)) {
      return {
        ok: false,
        diagnostics: [{
          code: 'DOMAIN_UNKNOWN_MOTION_REFERENCE',
          severity: 'error',
          summary: 'A track references an unknown motion record.',
        }],
      };
    }
    const owner = slotOwners.get(track.slotId)!;
    const rule = ruleById.get(track.ruleId)!;
    const ruleTrack = rule.tracks.find((candidate) => candidate.property === track.property);
    if (owner.slot.ruleId !== track.ruleId
      || !owner.application.bindings.some((binding) => binding.elementId === track.elementId)
      || !ruleTrack
      || track.interpolation !== (owner.slot.timingFunction.kind === 'steps'
        ? 'step'
        : ruleTrack.interpolation)) {
      return domainFailure(
        'DOMAIN_TRACK_RELATIONSHIP_INVALID',
        'An expanded track is inconsistent with its application, slot, rule, or property.',
      );
    }
    const expectedKeyframeIds = ruleTrack.keyframes.map((keyframe) => keyframe.id);
    if (track.keyframeIds.length !== expectedKeyframeIds.length
      || track.keyframeIds.some((keyframeId, index) => keyframeId !== expectedKeyframeIds[index])) {
      return domainFailure(
        'DOMAIN_TRACK_KEYFRAMES_MISMATCH',
        'An expanded track does not reference the owning rule keyframes exactly.',
      );
    }
  }

  const expectedExpandedTracks = document.applications.flatMap((application) =>
    application.bindings.flatMap((binding) => application.slots.flatMap((slot) =>
      ruleById.get(slot.ruleId)!.tracks.map((ruleTrack) =>
        expandedTrackKey(binding.elementId, slot.id, slot.ruleId, ruleTrack.property),
      ),
    )),
  );
  const actualExpandedTracks = document.tracks.map((track) =>
    expandedTrackKey(track.elementId, track.slotId, track.ruleId, track.property),
  );
  if (expectedExpandedTracks.length !== actualExpandedTracks.length
    || hasDuplicates(actualExpandedTracks)
    || expectedExpandedTracks.some((key) => !actualExpandedTracks.includes(key))) {
    return domainFailure(
      'DOMAIN_EXPANDED_TRACK_SET_MISMATCH',
      'Expanded tracks do not exactly cover every binding, slot, rule, and property.',
    );
  }

  const counts = document.inventory;
  if (
    counts.ruleCount !== document.rules.length
    || counts.applicationCount !== document.applications.length
    || counts.slotCount !== slots.length
    || counts.trackCount !== document.tracks.length
    || counts.supportedCount !== document.rules.length + document.applications.length
      + slots.length + document.tracks.length
    || counts.unsupportedCount !== 0
    || counts.missingCount !== 0
    || counts.diagnosticCodes.length !== 0
  ) {
    return {
      ok: false,
      diagnostics: [{
        code: 'DOMAIN_INVENTORY_MISMATCH',
        severity: 'error',
        summary: 'Canonical inventory counts do not match document records.',
      }],
    };
  }

  return { ok: true, document };
}

function hasDuplicates<T>(values: T[]): boolean {
  return new Set(values).size !== values.length;
}

function expandedTrackKey(
  elementId: string,
  slotId: string,
  ruleId: string,
  property: string,
): string {
  return `${elementId}\0${slotId}\0${ruleId}\0${property}`;
}

function domainFailure(code: string, summary: string): ValidationResult {
  return { ok: false, diagnostics: [{ code, severity: 'error', summary }] };
}

export function canonicalBytes(document: MotionDocument): Uint8Array {
  return new TextEncoder().encode(`${stableStringify(document)}\n`);
}

/** Canonical JSON for durable protocol and store boundaries. */
export function canonicalJson(value: unknown): string {
  return `${stableStringify(value)}\n`;
}

/** Revision-neutral bytes for comparing canonical content across undo/redo revisions. */
export function canonicalContentBytes(document: MotionDocument): Uint8Array {
  const { revision: _revision, ...content } = document;
  return new TextEncoder().encode(`${stableStringify(content)}\n`);
}

type OperationEnvelope = {
  schemaVersion: 'motion.operation.v1';
  operationId: string;
  documentId: string;
  expectedRevision: number;
};

export const STRUCTURAL_AUTHORING_ELEMENT_IDS = [
  'el_a2849ff826f3e167',
  'el_2dbee68b1ea318c8',
] as const;
export const STRUCTURAL_AUTHORING_STATUS_ELEMENT_ID = 'el_1f3f2908e4fd2401';
export type StructuralAuthoringElementId = typeof STRUCTURAL_AUTHORING_ELEMENT_IDS[number];
/** Kept as the reviewed Cursor default for callers that have not adopted target selection. */
export const STRUCTURAL_AUTHORING_ELEMENT_ID: StructuralAuthoringElementId = STRUCTURAL_AUTHORING_ELEMENT_IDS[0];

export type TrackCreationEligibility = {
  elementId: string;
  property: string;
  available: boolean;
  reason: null | 'DOCUMENT_INVALID' | 'ELEMENT_NOT_FOUND' | 'TARGET_PROPERTY_UNSUPPORTED'
    | 'SHARED_PROPERTY_UNSUPPORTED' | 'PROPERTY_CONFLICT' | 'TRACK_ALREADY_EXISTS'
    | 'TRACK_LIMIT_REACHED' | 'ID_COLLISION';
};

/** Pure, selector-independent projection used by both UI and mutation validation. */
export function projectTrackCreationEligibility(
  document: MotionDocument,
  elementId: string,
  property: string,
): TrackCreationEligibility {
  const unavailable = (reason: NonNullable<TrackCreationEligibility['reason']>): TrackCreationEligibility =>
    ({ elementId, property, available: false, reason });
  if (!validateMotionDocument(document).ok) return unavailable('DOCUMENT_INVALID');
  if (!document.elements.some((element) => element.id === elementId)) return unavailable('ELEMENT_NOT_FOUND');
  if (property !== 'opacity' || ![...STRUCTURAL_AUTHORING_ELEMENT_IDS, STRUCTURAL_AUTHORING_STATUS_ELEMENT_ID]
    .includes(elementId as StructuralAuthoringElementId)) {
    return unavailable('TARGET_PROPERTY_UNSUPPORTED');
  }
  const propertyTracks = document.tracks.filter((track) => track.property === property);
  if (propertyTracks.some((track) => track.elementId === elementId
    && document.tracks.filter((candidate) => candidate.ruleId === track.ruleId
      && candidate.property === property).length > 1)) return unavailable('SHARED_PROPERTY_UNSUPPORTED');
  if (propertyTracks.some((track) => track.elementId === elementId)) return unavailable('TRACK_ALREADY_EXISTS');
  if (STRUCTURAL_AUTHORING_ELEMENT_IDS.some((candidate) =>
    document.tracks.some((track) => track.id === derivedBundleIds(document.documentId, candidate).trackId))) {
    return unavailable('TRACK_LIMIT_REACHED');
  }
  const ids = derivedBundleIds(document.documentId, elementId as StructuralAuthoringElementId);
  const allIds = canonicalIdentitySet(document);
  if ([ids.ruleId, ids.applicationId, ids.slotId, ids.ruleTrackId, ids.trackId, ids.startId, ids.endId]
    .some((id) => allIds.has(id))
    || document.rules.some((rule) => rule.sourceName === `created_${sha256Hex(ids.base).slice(0, 16)}`)) {
    return unavailable('ID_COLLISION');
  }
  return { elementId, property, available: true, reason: null };
}

type EditTarget = { elementId: string; trackId: string; keyframeId: string };
export type KeyframeValueOperation = OperationEnvelope & EditTarget & {
  kind: 'motion.keyframe-value.set'; payload: { value: number };
};
export type KeyframeTimeOperation = OperationEnvelope & EditTarget & {
  kind: 'motion.keyframe-time.set'; payload: { timeMs: number };
};
export type HistoryOperation = OperationEnvelope & {
  kind: 'motion.history.undo' | 'motion.history.redo';
};
export type TrackCreateOperation = OperationEnvelope & {
  kind: 'motion.track.create'; elementId: StructuralAuthoringElementId;
  payload: { property: 'opacity'; durationMs: 1000; delayMs: 610; easing: 'linear'; startValue: 0; endValue: 1 };
};
export type KeyframeAddOperation = OperationEnvelope & {
  kind: 'motion.keyframe.add'; elementId: StructuralAuthoringElementId;
  trackId: string; payload: { timeMs: number; value: number };
};
export type KeyframeRemoveOperation = OperationEnvelope & {
  kind: 'motion.keyframe.remove'; elementId: StructuralAuthoringElementId;
  trackId: string; keyframeId: string;
};
export type SlotDurationSetOperation = OperationEnvelope & {
  kind: 'motion.slot-duration.set'; elementId: StructuralAuthoringElementId;
  trackId: string; payload: { durationMs: number };
};
export type BindingDelaySetOperation = OperationEnvelope & {
  kind: 'motion.binding-delay.set'; elementId: StructuralAuthoringElementId;
  trackId: string; payload: { delayMs: number };
};
export type SlotEasingSetOperation = OperationEnvelope & {
  kind: 'motion.slot-easing.set'; elementId: StructuralAuthoringElementId;
  trackId: string; payload: { easing: 'linear' | 'ease-in-out' };
};
export type HoldInsertOperation = OperationEnvelope & {
  kind: 'motion.hold.insert'; payload: { cueId: 'cue_pair'; durationMs: 600 };
};
export type StructuralAuthoringOperation = TrackCreateOperation | KeyframeAddOperation
  | KeyframeRemoveOperation | SlotDurationSetOperation | BindingDelaySetOperation
  | SlotEasingSetOperation | HoldInsertOperation;
export type AuthoringOperation = KeyframeValueOperation | KeyframeTimeOperation
  | StructuralAuthoringOperation | HistoryOperation;
type EditOperation = Exclude<AuthoringOperation, HistoryOperation>;
type KeyframeEditOperation = KeyframeValueOperation | KeyframeTimeOperation;
type InternalTrackDeleteOperation = OperationEnvelope & {
  kind: 'motion.internal.track.delete'; elementId: StructuralAuthoringElementId;
  trackId: string; payload: { bundleDigest: string };
};
type InternalKeyframeRestoreOperation = OperationEnvelope & {
  kind: 'motion.internal.keyframe.restore'; elementId: StructuralAuthoringElementId;
  trackId: string; keyframe: RuleTrack['keyframes'][number];
};
type InternalHoldRemoveOperation = OperationEnvelope & {
  kind: 'motion.internal.hold.remove'; payload: { holdId: string; contentDigest: string };
};
type ReducerOperation = EditOperation | InternalTrackDeleteOperation | InternalKeyframeRestoreOperation
  | InternalHoldRemoveOperation;

type EditRecord = {
  forward: ReducerOperation;
  inverse: ReducerOperation;
};

export type AuthoringState = {
  document: MotionDocument;
  consumedOperationIds: string[];
  undo: EditRecord[];
  redo: EditRecord[];
};

export type AuthoringResult =
  | { ok: true; state: AuthoringState }
  | { ok: false; state: AuthoringState; diagnostic: Diagnostic };

export function createAuthoringState(document: MotionDocument): AuthoringState {
  return { document: structuredClone(document), consumedOperationIds: [], undo: [], redo: [] };
}

export function dispatchAuthoringOperation(
  state: AuthoringState,
  input: unknown,
): AuthoringResult {
  const operation = parseOperation(input);
  if (!operation) return authoringFailure(state, 'AUTHORING_ENVELOPE_INVALID');
  if (operation.documentId !== state.document.documentId) {
    return authoringFailure(state, 'AUTHORING_DOCUMENT_MISMATCH');
  }
  if (state.consumedOperationIds.includes(operation.operationId)) {
    return authoringFailure(state, 'AUTHORING_OPERATION_ID_REUSED');
  }
  if (operation.expectedRevision !== state.document.revision) {
    return authoringFailure(state, 'AUTHORING_STALE_REVISION');
  }
  if (state.document.revision === Number.MAX_SAFE_INTEGER) {
    return authoringFailure(state, 'AUTHORING_REVISION_EXHAUSTED');
  }

  if (operation.kind === 'motion.history.undo' || operation.kind === 'motion.history.redo') {
    const source = operation.kind === 'motion.history.undo' ? state.undo : state.redo;
    if (source.length === 0) return authoringFailure(state, 'AUTHORING_HISTORY_EMPTY');
    const record = source.at(-1)!;
    const replay = operation.kind === 'motion.history.undo' ? record.inverse : record.forward;
    const applied = applyOperation(state.document, replay);
    if (!applied.ok) return authoringFailure(state, 'AUTHORING_HISTORY_REPLAY_INVALID');
    const revision = state.document.revision + 1;
    if (!validateMotionDocument({ ...applied.document, revision }).ok) {
      return authoringFailure(state, 'AUTHORING_HISTORY_REPLAY_INVALID');
    }
    const nextRecord = cloneRecord(record);
    return {
      ok: true,
      state: {
        document: { ...applied.document, revision },
        consumedOperationIds: [...state.consumedOperationIds, operation.operationId],
        undo: operation.kind === 'motion.history.undo'
          ? state.undo.slice(0, -1).map(cloneRecord)
          : [...state.undo.map(cloneRecord), nextRecord],
        redo: operation.kind === 'motion.history.undo'
          ? [...state.redo.map(cloneRecord), nextRecord]
          : state.redo.slice(0, -1).map(cloneRecord),
      },
    };
  }

  if ((state.document.holds ?? []).length > 0 && operation.kind !== 'motion.hold.insert') {
    return authoringFailure(state, 'AUTHORING_HOLD_LOCKED');
  }

  const editOperation = operation as EditOperation;
  const applied = applyOperation(state.document, editOperation);
  if (!applied.ok) return authoringFailure(state, applied.code);
  const candidateValidation = validateMotionDocument({ ...applied.document,
    revision: state.document.revision + 1 });
  if (!candidateValidation.ok) return authoringFailure(state, 'AUTHORING_CANDIDATE_INVALID');
  return {
    ok: true,
    state: {
      document: { ...applied.document, revision: state.document.revision + 1 },
      consumedOperationIds: [...state.consumedOperationIds, operation.operationId],
      undo: [...state.undo.map(cloneRecord), { forward: structuredClone(editOperation), inverse: applied.inverse }],
      redo: [],
    },
  };
}

function applyOperation(
  document: MotionDocument,
  operation: ReducerOperation,
): { ok: true; document: MotionDocument; inverse: ReducerOperation } | { ok: false; code: string } {
  if (operation.kind === 'motion.keyframe-value.set' || operation.kind === 'motion.keyframe-time.set') {
    return applyEdit(document, operation);
  }
  if (operation.kind === 'motion.hold.insert' || operation.kind === 'motion.internal.hold.remove') {
    return applyHold(document, operation);
  }
  return applyStructural(document, operation);
}

function applyHold(
  document: MotionDocument,
  operation: HoldInsertOperation | InternalHoldRemoveOperation,
): { ok: true; document: MotionDocument; inverse: ReducerOperation } | { ok: false; code: string } {
  if (operation.kind === 'motion.hold.insert') {
    if (operation.payload.cueId !== 'cue_pair' || operation.payload.durationMs !== 600) {
      return { ok: false, code: 'AUTHORING_HOLD_INVALID' };
    }
    if ((document.holds ?? []).length > 0) return { ok: false, code: 'AUTHORING_HOLD_COLLISION' };
    const cue = document.cues.find((candidate) => candidate.id === 'cue_pair');
    if (!cue || cue.timeMs !== 2870 || document.durationMs !== 4660) {
      return { ok: false, code: 'AUTHORING_HOLD_BOUNDARY_MISMATCH' };
    }
    if (document.durationMs > Number.MAX_SAFE_INTEGER - 600) {
      return { ok: false, code: 'AUTHORING_HOLD_OVERFLOW' };
    }
    const hold: MotionHold = {
      schemaVersion: 'motion.hold.v1',
      id: structuralId('hold', `${document.documentId}\0cue_pair\0${2870}\0${600}`),
      cueId: 'cue_pair', sourceTimeMs: 2870, durationMs: 600,
    };
    if (canonicalIdentitySet(document).has(hold.id)) return { ok: false, code: 'AUTHORING_ID_COLLISION' };
    const next = structuredClone(document);
    next.holds = [hold];
    next.durationMs += 600;
    next.cues = next.cues.map((candidate) => candidate.timeMs >= 2870
      ? { ...candidate, timeMs: candidate.timeMs + 600 } : candidate);
    const contentDigest = sha256Hex(canonicalContentBytes(next));
    return { ok: true, document: next, inverse: {
      schemaVersion: operation.schemaVersion, operationId: operation.operationId,
      documentId: operation.documentId, expectedRevision: operation.expectedRevision,
      kind: 'motion.internal.hold.remove', payload: { holdId: hold.id, contentDigest },
    } };
  }
  const hold = document.holds?.[0];
  if (!hold || hold.id !== operation.payload.holdId
    || sha256Hex(canonicalContentBytes(document)) !== operation.payload.contentDigest) {
    return { ok: false, code: 'AUTHORING_HOLD_REPLAY_INVALID' };
  }
  const next = structuredClone(document);
  delete next.holds;
  next.durationMs -= hold.durationMs;
  next.cues = next.cues.map((candidate) => candidate.timeMs >= hold.sourceTimeMs + hold.durationMs
    ? { ...candidate, timeMs: candidate.timeMs - hold.durationMs } : candidate);
  return { ok: true, document: next, inverse: {
    schemaVersion: operation.schemaVersion, operationId: operation.operationId,
    documentId: operation.documentId, expectedRevision: operation.expectedRevision,
    kind: 'motion.hold.insert', payload: { cueId: 'cue_pair', durationMs: 600 },
  } };
}

function applyStructural(
  document: MotionDocument,
  operation: Exclude<StructuralAuthoringOperation, HoldInsertOperation>
    | InternalTrackDeleteOperation | InternalKeyframeRestoreOperation,
): { ok: true; document: MotionDocument; inverse: ReducerOperation } | { ok: false; code: string } {
  const element = document.elements.find((candidate) => candidate.id === operation.elementId);
  if (!element) return { ok: false, code: 'AUTHORING_ELEMENT_NOT_FOUND' };
  if (operation.kind === 'motion.keyframe.remove') {
    const candidateTrack = document.tracks.find((candidate) => candidate.id === operation.trackId);
    if (!candidateTrack) return { ok: false, code: 'AUTHORING_TRACK_NOT_FOUND' };
    if (candidateTrack.elementId !== element.id || candidateTrack.property !== 'opacity') {
      return { ok: false, code: 'AUTHORING_TRACK_ELEMENT_MISMATCH' };
    }
    const candidateBundle = resolveIsolatedOpacityBundle(document, candidateTrack.id);
    if (!candidateBundle.ok) return candidateBundle;
    if (candidateBundle.ruleTrack.keyframes.length <= 2) {
      return { ok: false, code: 'AUTHORING_KEYFRAME_MINIMUM' };
    }
    if (!candidateBundle.ruleTrack.keyframes.some((keyframe) => keyframe.id === operation.keyframeId)) {
      return { ok: false, code: 'AUTHORING_KEYFRAME_NOT_FOUND' };
    }
    const anchors = derivedBundleIds(document.documentId, operation.elementId);
    if (operation.keyframeId === anchors.startId || operation.keyframeId === anchors.endId) {
      return { ok: false, code: 'AUTHORING_KEYFRAME_ANCHOR_REQUIRED' };
    }
  }
  const next = structuredClone(document);
  const payload: Record<string, unknown> = 'payload' in operation ? operation.payload : {};
  if (operation.kind === 'motion.track.create') {
    if (payload.property !== 'opacity' || payload.durationMs !== 1000 || payload.delayMs !== 610
      || payload.easing !== 'linear' || payload.startValue !== 0 || payload.endValue !== 1) {
      return { ok: false, code: 'AUTHORING_TRACK_CREATE_INVALID' };
    }
    const eligibility = projectTrackCreationEligibility(document, element.id, String(payload.property));
    if (!eligibility.available) {
      const codes: Record<NonNullable<TrackCreationEligibility['reason']>, string> = {
        DOCUMENT_INVALID: 'AUTHORING_DOCUMENT_INVALID', ELEMENT_NOT_FOUND: 'AUTHORING_ELEMENT_NOT_FOUND',
        TARGET_PROPERTY_UNSUPPORTED: 'AUTHORING_TARGET_PROPERTY_UNSUPPORTED',
        SHARED_PROPERTY_UNSUPPORTED: 'AUTHORING_SHARED_PROPERTY_UNSUPPORTED',
        PROPERTY_CONFLICT: 'AUTHORING_PROPERTY_CONFLICT', TRACK_ALREADY_EXISTS: 'AUTHORING_TRACK_ALREADY_EXISTS',
        TRACK_LIMIT_REACHED: 'AUTHORING_TRACK_LIMIT_REACHED', ID_COLLISION: 'AUTHORING_ID_COLLISION',
      };
      return { ok: false, code: codes[eligibility.reason!] };
    }
    const { base, ruleId, applicationId, slotId, ruleTrackId, trackId, startId, endId } =
      derivedBundleIds(document.documentId, operation.elementId);
    const sourceName = `created_${sha256Hex(base).slice(0, 16)}`;
    const rule = { id: ruleId, sourceName, tracks: [{
      id: ruleTrackId, property: 'opacity', interpolation: 'continuous' as const,
      keyframes: [{ id: startId, offset: 0, value: '0' }, { id: endId, offset: 1, value: '1' }],
    }] };
    const application = { id: applicationId,
      bindings: [{ elementId: element.id, delayOverridesMs: [610] }], selectorHint: element.selectorHint,
      slots: [{ id: slotId, ruleId, durationMs: 1000, delayMs: 610, iterationCount: 1 as const,
        direction: 'normal' as const, fillMode: 'both' as const, playState: 'running' as const,
        timingFunction: { kind: 'keyword' as const, value: 'linear' as const } }] };
    const expanded = { id: trackId, elementId: element.id, ruleId, slotId, property: 'opacity',
      interpolation: 'continuous' as const, keyframeIds: [startId, endId] };
    next.rules.push(rule); next.applications.push(application); next.tracks.push(expanded);
    refreshInventory(next);
    return { ok: true, document: next, inverse: { schemaVersion: operation.schemaVersion,
      operationId: operation.operationId, documentId: operation.documentId,
      expectedRevision: operation.expectedRevision, kind: 'motion.internal.track.delete',
      elementId: operation.elementId, trackId,
      payload: { bundleDigest: sha256Hex(canonicalBundleBytes({ rule, application, expanded })) } } };
  }
  const track = document.tracks.find((candidate) => candidate.id === operation.trackId);
  if (!track) return { ok: false, code: 'AUTHORING_TRACK_NOT_FOUND' };
  if (track.elementId !== element.id || track.property !== 'opacity') {
    return { ok: false, code: 'AUTHORING_TRACK_ELEMENT_MISMATCH' };
  }
  const bundle = resolveIsolatedOpacityBundle(next, track.id);
  if (!bundle.ok) return bundle;
  const { rule, ruleTrack, application, slotIndex, slot, binding } = bundle;
  if (operation.kind === 'motion.internal.track.delete') {
    const currentBundle = { rule, application,
      expanded: next.tracks.find((candidate) => candidate.id === track.id)! };
    if (sha256Hex(canonicalBundleBytes(currentBundle)) !== operation.payload.bundleDigest) {
      return { ok: false, code: 'AUTHORING_BUNDLE_MISMATCH' };
    }
    next.rules = next.rules.filter((candidate) => candidate.id !== track.ruleId);
    next.applications = next.applications.filter((candidate) => candidate.id !== application.id);
    next.tracks = next.tracks.filter((candidate) => candidate.id !== track.id);
    refreshInventory(next);
    return { ok: true, document: next, inverse: { schemaVersion: operation.schemaVersion,
      operationId: operation.operationId, documentId: operation.documentId,
      expectedRevision: operation.expectedRevision, kind: 'motion.track.create',
      elementId: operation.elementId,
      payload: { property: 'opacity', durationMs: 1000, delayMs: 610, easing: 'linear',
        startValue: 0, endValue: 1 } } };
  }
  if (operation.kind === 'motion.internal.keyframe.restore') {
    const restored = operation.keyframe;
    if (ruleTrack.keyframes.some((keyframe) => keyframe.id === restored.id
      || keyframe.offset === restored.offset)) return { ok: false, code: 'AUTHORING_ID_COLLISION' };
    const insertion = ruleTrack.keyframes.findIndex((keyframe) => keyframe.offset > restored.offset);
    if (insertion < 0) return { ok: false, code: 'AUTHORING_TIME_ORDER_INVALID' };
    ruleTrack.keyframes.splice(insertion, 0, structuredClone(restored));
    next.tracks.find((candidate) => candidate.id === track.id)!.keyframeIds.splice(insertion, 0, restored.id);
    return { ok: true, document: next, inverse: { schemaVersion: operation.schemaVersion,
      operationId: operation.operationId, documentId: operation.documentId,
      expectedRevision: operation.expectedRevision, kind: 'motion.keyframe.remove',
      elementId: operation.elementId, trackId: track.id, keyframeId: restored.id } };
  }
  if (operation.kind === 'motion.keyframe.add') {
    const timeMs = payload.timeMs;
    const value = payload.value;
    if (!Number.isSafeInteger(timeMs) || typeof value !== 'number') {
      return { ok: false, code: 'AUTHORING_KEYFRAME_INVALID' };
    }
    const numerator = ((timeMs as number) - binding.delayOverridesMs[slotIndex]!) * 1_000_000;
    if (!Number.isSafeInteger(numerator) || numerator % slot.durationMs !== 0) {
      return { ok: false, code: 'AUTHORING_TIME_PRECISION_UNREPRESENTABLE' };
    }
    const offsetPpm = numerator / slot.durationMs;
    if (!Number.isSafeInteger(offsetPpm) || offsetPpm <= 0 || offsetPpm >= 1_000_000
      || typeof value !== 'number' || value < 0 || value > 1
      || !Number.isSafeInteger(value * 1_000_000)) {
      return { ok: false, code: 'AUTHORING_KEYFRAME_INVALID' };
    }
    if (ruleTrack.keyframes.some((keyframe) => keyframe.offset * 1_000_000 === offsetPpm)) {
      return { ok: false, code: 'AUTHORING_TIME_COLLISION' };
    }
    const keyframeId = structuralId('kf', `${document.documentId}\0${element.id}\0opacity\0${offsetPpm}`);
    if (document.rules.some((owner) => owner.tracks.some((candidate) =>
      candidate.keyframes.some((keyframe) => keyframe.id === keyframeId)))) {
      return { ok: false, code: 'AUTHORING_ID_COLLISION' };
    }
    const insertion = ruleTrack.keyframes.findIndex((keyframe) => keyframe.offset > offsetPpm / 1_000_000);
    const keyframe = { id: keyframeId, offset: offsetPpm / 1_000_000, value: formatCanonicalDecimal(value) };
    ruleTrack.keyframes.splice(insertion, 0, keyframe);
    const expanded = next.tracks.find((candidate) => candidate.id === track.id)!;
    expanded.keyframeIds.splice(insertion, 0, keyframeId);
    return { ok: true, document: next, inverse: { ...operation, kind: 'motion.keyframe.remove', keyframeId,
    } };
  }
  if (operation.kind === 'motion.keyframe.remove') {
    if (ruleTrack.keyframes.length <= 2) return { ok: false, code: 'AUTHORING_KEYFRAME_MINIMUM' };
    const index = ruleTrack.keyframes.findIndex((keyframe) => keyframe.id === operation.keyframeId);
    if (index < 0) return { ok: false, code: 'AUTHORING_KEYFRAME_NOT_FOUND' };
    const removed = ruleTrack.keyframes[index]!;
    ruleTrack.keyframes.splice(index, 1);
    next.tracks.find((candidate) => candidate.id === track.id)!.keyframeIds.splice(index, 1);
    return { ok: true, document: next, inverse: { schemaVersion: operation.schemaVersion,
      operationId: operation.operationId, documentId: operation.documentId,
      expectedRevision: operation.expectedRevision, kind: 'motion.internal.keyframe.restore',
      elementId: operation.elementId, trackId: track.id,
      keyframe: structuredClone(removed) } };
  }
  if (operation.kind === 'motion.slot-duration.set') {
    if (!Number.isSafeInteger(payload.durationMs) || (payload.durationMs as number) <= 0) {
      return { ok: false, code: 'AUTHORING_DURATION_INVALID' };
    }
    if (!projectionsValid(document, ruleTrack, binding.delayOverridesMs[slotIndex]!, payload.durationMs as number)) {
      return { ok: false, code: 'AUTHORING_PROJECTION_INVALID' };
    }
    const old = slot.durationMs; slot.durationMs = payload.durationMs as number;
    return { ok: true, document: next, inverse: { ...operation, payload: { durationMs: old } } };
  }
  if (operation.kind === 'motion.binding-delay.set') {
    if (!Number.isSafeInteger(payload.delayMs) || (payload.delayMs as number) < 0) {
      return { ok: false, code: 'AUTHORING_DELAY_INVALID' };
    }
    if (!projectionsValid(document, ruleTrack, payload.delayMs as number, slot.durationMs)) {
      return { ok: false, code: 'AUTHORING_PROJECTION_INVALID' };
    }
    const old = binding.delayOverridesMs[slotIndex]!;
    binding.delayOverridesMs[slotIndex] = payload.delayMs as number;
    slot.delayMs = payload.delayMs as number;
    return { ok: true, document: next, inverse: { ...operation, payload: { delayMs: old } } };
  }
  if (operation.kind === 'motion.slot-easing.set') {
    if (payload.easing !== 'linear' && payload.easing !== 'ease-in-out') {
      return { ok: false, code: 'AUTHORING_EASING_INVALID' };
    }
    const old = slot.timingFunction;
    slot.timingFunction = { kind: 'keyword', value: payload.easing };
    return { ok: true, document: next, inverse: { ...operation,
      payload: { easing: old.kind === 'keyword' && old.value === 'ease-in-out'
        ? 'ease-in-out' : 'linear' } } };
  }
  return { ok: false, code: 'AUTHORING_ENVELOPE_INVALID' };
}

function structuralId(prefix: string, seed: string): string {
  return `${prefix}_${sha256Hex(seed).slice(0, 16)}`;
}

function canonicalBundleBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(stableStringify(value));
}

function canonicalIdentitySet(document: MotionDocument): Set<string> {
  return new Set([
    ...document.elements.map((candidate) => candidate.id), ...document.cues.map((candidate) => candidate.id),
    ...(document.holds ?? []).map((candidate) => candidate.id),
    ...document.rules.map((rule) => rule.id), ...document.applications.map((app) => app.id),
    ...document.applications.flatMap((app) => app.slots.map((slot) => slot.id)),
    ...document.rules.flatMap((rule) => rule.tracks.flatMap((track) =>
      [track.id, ...track.keyframes.map((keyframe) => keyframe.id)])),
    ...document.tracks.map((track) => track.id),
  ]);
}

function derivedBundleIds(documentId: string, elementId: StructuralAuthoringElementId): {
  base: string; ruleId: string; applicationId: string; slotId: string;
  ruleTrackId: string; trackId: string; startId: string; endId: string;
} {
  const base = `${documentId}\0${elementId}\0opacity`;
  const ruleId = structuralId('rule', base);
  const slotId = structuralId('slot', `${base}\0${ruleId}`);
  return {
    base,
    ruleId,
    applicationId: structuralId('app', base),
    slotId,
    ruleTrackId: structuralId('rule_track', `${base}\0${ruleId}`),
    trackId: structuralId('track', `${base}\0${slotId}\0${ruleId}`),
    startId: structuralId('kf', `${base}\0${0}`),
    endId: structuralId('kf', `${base}\0${1_000_000}`),
  };
}

function resolveIsolatedOpacityBundle(document: MotionDocument, trackId: string):
  | { ok: true; rule: MotionDocument['rules'][number]; ruleTrack: RuleTrack;
    application: MotionDocument['applications'][number]; slotIndex: number;
    slot: MotionDocument['applications'][number]['slots'][number];
    binding: MotionDocument['applications'][number]['bindings'][number] }
  | { ok: false; code: string } {
  const expanded = document.tracks.find((track) => track.id === trackId);
  if (!expanded) return { ok: false, code: 'AUTHORING_TRACK_NOT_FOUND' };
  if (!STRUCTURAL_AUTHORING_ELEMENT_IDS.includes(expanded.elementId as StructuralAuthoringElementId)) {
    return { ok: false, code: 'AUTHORING_BUNDLE_MISMATCH' };
  }
  const elementId = expanded.elementId as StructuralAuthoringElementId;
  const ids = derivedBundleIds(document.documentId, elementId);
  if (expanded.id !== ids.trackId
    || expanded.property !== 'opacity' || expanded.ruleId !== ids.ruleId
    || expanded.slotId !== ids.slotId || expanded.interpolation !== 'continuous') {
    return { ok: false, code: 'AUTHORING_BUNDLE_MISMATCH' };
  }
  const rules = document.rules.filter((rule) => rule.id === expanded.ruleId);
  const owners = document.applications.filter((application) =>
    application.slots.some((slot) => slot.id === expanded.slotId));
  if (rules.length !== 1 || owners.length !== 1) {
    return { ok: false, code: 'AUTHORING_BUNDLE_REFERENCE_INVALID' };
  }
  const rule = rules[0]!;
  const application = owners[0]!;
  const slotIndex = application.slots.findIndex((slot) => slot.id === expanded.slotId);
  const slot = application.slots[slotIndex];
  const ruleTrack = rule.tracks.find((candidate) => candidate.property === 'opacity');
  const binding = application.bindings.find((candidate) =>
    candidate.elementId === elementId);
  const sourceName = `created_${sha256Hex(ids.base).slice(0, 16)}`;
  if (!slot || !ruleTrack || !binding || rule.id !== ids.ruleId || rule.sourceName !== sourceName
    || application.id !== ids.applicationId
    || slot.id !== ids.slotId || ruleTrack.id !== ids.ruleTrackId || slot.ruleId !== rule.id
    || rule.tracks.length !== 1 || application.slots.length !== 1 || application.bindings.length !== 1
    || binding.delayOverridesMs.length !== 1 || slot.delayMs !== binding.delayOverridesMs[0]
    || ruleTrack.keyframes.length < 2 || ruleTrack.keyframes[0]?.id !== ids.startId
    || ruleTrack.keyframes.at(-1)?.id !== ids.endId
    || ruleTrack.keyframes.some((keyframe) => {
      const offsetPpm = keyframe.offset * 1_000_000;
      return !Number.isSafeInteger(offsetPpm)
        || keyframe.id !== structuralId('kf', `${ids.base}\0${offsetPpm}`);
    })
    || expanded.keyframeIds.length !== ruleTrack.keyframes.length
    || expanded.keyframeIds.some((id, index) => id !== ruleTrack.keyframes[index]?.id)) {
    return { ok: false, code: 'AUTHORING_BUNDLE_MISMATCH' };
  }
  const ruleUsers = document.tracks.filter((candidate) => candidate.ruleId === rule.id);
  const slotUsers = document.tracks.filter((candidate) => candidate.slotId === slot.id);
  const ruleSlotUsers = document.applications.flatMap((candidate) => candidate.slots)
    .filter((candidate) => candidate.ruleId === rule.id);
  if (ruleUsers.length !== 1 || slotUsers.length !== 1 || ruleSlotUsers.length !== 1) {
    return { ok: false, code: 'AUTHORING_BUNDLE_SHARED' };
  }
  return { ok: true, rule, ruleTrack, application, slotIndex, slot, binding };
}

function projectionsValid(
  document: MotionDocument,
  ruleTrack: RuleTrack,
  delayMs: number,
  durationMs: number,
): boolean {
  if (!Number.isSafeInteger(delayMs) || delayMs < 0 || !Number.isSafeInteger(durationMs)
    || durationMs <= 0) return false;
  return ruleTrack.keyframes.every((keyframe) => {
    const offsetPpm = keyframe.offset * 1_000_000;
    if (!Number.isSafeInteger(offsetPpm)) return false;
    const numerator = offsetPpm * durationMs;
    if (!Number.isSafeInteger(numerator) || numerator % 1_000_000 !== 0) return false;
    const projected = delayMs + numerator / 1_000_000;
    return Number.isSafeInteger(projected) && projected >= 0 && projected <= document.durationMs;
  });
}

function refreshInventory(document: MotionDocument): void {
  document.inventory.ruleCount = document.rules.length;
  document.inventory.applicationCount = document.applications.length;
  document.inventory.slotCount = document.applications.reduce((count, application) => count + application.slots.length, 0);
  document.inventory.trackCount = document.tracks.length;
  document.inventory.supportedCount = document.inventory.ruleCount + document.inventory.applicationCount
    + document.inventory.slotCount + document.inventory.trackCount;
}

function applyEdit(
  document: MotionDocument,
  operation: KeyframeEditOperation,
): { ok: true; document: MotionDocument; inverse: EditOperation } | { ok: false; code: string } {
  const element = document.elements.find((candidate) => candidate.id === operation.elementId);
  if (!element) return { ok: false, code: 'AUTHORING_ELEMENT_NOT_FOUND' };
  const expandedTrack = document.tracks.find((candidate) => candidate.id === operation.trackId);
  if (!expandedTrack) return { ok: false, code: 'AUTHORING_TRACK_NOT_FOUND' };
  if (expandedTrack.elementId !== element.id) {
    return { ok: false, code: 'AUTHORING_TRACK_ELEMENT_MISMATCH' };
  }
  const keyframeExists = document.rules.some((rule) => rule.tracks.some((track) =>
    track.keyframes.some((keyframe) => keyframe.id === operation.keyframeId)));
  if (!keyframeExists) return { ok: false, code: 'AUTHORING_KEYFRAME_NOT_FOUND' };
  if (!expandedTrack.keyframeIds.includes(operation.keyframeId)) {
    return { ok: false, code: 'AUTHORING_KEYFRAME_TRACK_MISMATCH' };
  }
  const matchingExpanded = document.tracks.filter((candidate) =>
    candidate.ruleId === expandedTrack.ruleId && candidate.property === expandedTrack.property);
  if (matchingExpanded.length !== 1) {
    return { ok: false, code: 'AUTHORING_SHARED_RULE_UNSUPPORTED' };
  }
  if (expandedTrack.property !== 'opacity') {
    return { ok: false, code: 'AUTHORING_PROPERTY_UNSUPPORTED' };
  }
  const rule = document.rules.find((candidate) => candidate.id === expandedTrack.ruleId)!;
  const ruleTrack = rule.tracks.find((candidate) => candidate.property === expandedTrack.property)!;
  const keyframeIndex = ruleTrack.keyframes.findIndex((candidate) =>
    candidate.id === operation.keyframeId);
  const keyframe = ruleTrack.keyframes[keyframeIndex]!;

  let replacement: RuleTrack['keyframes'][number];
  let inverse: EditOperation;
  if (operation.kind === 'motion.keyframe-value.set') {
    const value = operation.payload.value;
    const scaled = value * 1_000_000;
    if (!Number.isFinite(value) || value < 0 || value > 1
      || !Number.isSafeInteger(scaled)) {
      return { ok: false, code: 'AUTHORING_VALUE_INVALID' };
    }
    replacement = { ...keyframe, value: formatCanonicalDecimal(value) };
    inverse = { ...operation, payload: { value: Number(keyframe.value) } };
  } else {
    const targetTime = operation.payload.timeMs;
    const application = document.applications.find((candidate) =>
      candidate.slots.some((slot) => slot.id === expandedTrack.slotId)
      && candidate.bindings.some((binding) => binding.elementId === expandedTrack.elementId));
    const slotIndex = application?.slots.findIndex((slot) => slot.id === expandedTrack.slotId) ?? -1;
    const slot = slotIndex >= 0 ? application!.slots[slotIndex] : undefined;
    const binding = application?.bindings.find((candidate) =>
      candidate.elementId === expandedTrack.elementId);
    const delayMs = binding?.delayOverridesMs[slotIndex];
    if (!slot || delayMs === undefined || slot.durationMs === 0 || slot.iterationCount !== 1) {
      return { ok: false, code: 'AUTHORING_TIME_UNSUPPORTED' };
    }
    if (!Number.isSafeInteger(targetTime)) {
      return { ok: false, code: 'AUTHORING_TIME_UNSUPPORTED' };
    }
    if (targetTime < delayMs || targetTime > delayMs + slot.durationMs) {
      return { ok: false, code: 'AUTHORING_TIME_OUT_OF_RANGE' };
    }
    const numerator = (targetTime - delayMs) * 1_000_000;
    if (!Number.isSafeInteger(numerator) || numerator % slot.durationMs !== 0) {
      return { ok: false, code: 'AUTHORING_TIME_PRECISION_UNREPRESENTABLE' };
    }
    const offset = (numerator / slot.durationMs) / 1_000_000;
    const previous = ruleTrack.keyframes[keyframeIndex - 1];
    const next = ruleTrack.keyframes[keyframeIndex + 1];
    if (previous?.offset === offset || next?.offset === offset) {
      return { ok: false, code: 'AUTHORING_TIME_COLLISION' };
    }
    if ((previous && offset < previous.offset) || (next && offset > next.offset)) {
      return { ok: false, code: 'AUTHORING_TIME_ORDER_INVALID' };
    }
    const currentTime = delayMs + keyframe.offset * slot.durationMs;
    if (!Number.isSafeInteger(currentTime)) {
      return { ok: false, code: 'AUTHORING_TIME_UNSUPPORTED' };
    }
    replacement = { ...keyframe, offset };
    inverse = { ...operation, payload: { timeMs: currentTime } };
  }

  const nextDocument = structuredClone(document);
  const nextRule = nextDocument.rules.find((candidate) => candidate.id === rule.id)!;
  const nextTrack = nextRule.tracks.find((candidate) => candidate.id === ruleTrack.id)!;
  nextTrack.keyframes[keyframeIndex] = replacement;
  return { ok: true, document: nextDocument, inverse };
}

function parseOperation(input: unknown): AuthoringOperation | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 'motion.operation.v1'
    || typeof value.operationId !== 'string'
    || !/^[A-Za-z0-9._:-]{1,128}$/.test(value.operationId)
    || typeof value.documentId !== 'string' || value.documentId.length === 0
    || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0
    || !['motion.keyframe-value.set', 'motion.keyframe-time.set', 'motion.track.create',
      'motion.keyframe.add', 'motion.keyframe.remove', 'motion.slot-duration.set',
      'motion.binding-delay.set', 'motion.slot-easing.set',
      'motion.hold.insert',
      'motion.history.undo', 'motion.history.redo'].includes(String(value.kind))) {
    return null;
  }
  const baseKeys = ['schemaVersion', 'operationId', 'documentId', 'expectedRevision', 'kind'];
  const base = value as unknown as AuthoringOperation;
  if (base.kind === 'motion.history.undo' || base.kind === 'motion.history.redo') {
    return hasExactObjectKeys(value, baseKeys) ? base : null;
  }
  if (base.kind === 'motion.hold.insert') {
    const payload = plainRecord(value.payload);
    return hasExactObjectKeys(value, [...baseKeys, 'payload']) && payload
      && hasExactObjectKeys(payload, ['cueId', 'durationMs'])
      && payload.cueId === 'cue_pair' && payload.durationMs === 600 ? base : null;
  }
  const fixedElement = STRUCTURAL_AUTHORING_ELEMENT_IDS.includes(value.elementId as StructuralAuthoringElementId);
  if (base.kind === 'motion.track.create') {
    const payload = plainRecord(value.payload);
    return fixedElement && hasExactObjectKeys(value, [...baseKeys, 'elementId', 'payload'])
      && payload && hasExactObjectKeys(payload,
        ['property', 'durationMs', 'delayMs', 'easing', 'startValue', 'endValue'])
      && payload.property === 'opacity' && payload.durationMs === 1000 && payload.delayMs === 610
      && payload.easing === 'linear' && payload.startValue === 0 && payload.endValue === 1 ? base : null;
  }
  if (base.kind === 'motion.keyframe.add') {
    const payload = plainRecord(value.payload);
    return fixedElement && typeof value.trackId === 'string'
      && hasExactObjectKeys(value, [...baseKeys, 'elementId', 'trackId', 'payload'])
      && payload && hasExactObjectKeys(payload, ['timeMs', 'value'])
      && typeof payload.timeMs === 'number' && typeof payload.value === 'number' ? base : null;
  }
  if (base.kind === 'motion.keyframe.remove') {
    return fixedElement && typeof value.trackId === 'string' && typeof value.keyframeId === 'string'
      && hasExactObjectKeys(value, [...baseKeys, 'elementId', 'trackId', 'keyframeId']) ? base : null;
  }
  if (base.kind === 'motion.slot-duration.set' || base.kind === 'motion.binding-delay.set'
    || base.kind === 'motion.slot-easing.set') {
    const payload = plainRecord(value.payload);
    const member = base.kind === 'motion.slot-duration.set' ? 'durationMs'
      : base.kind === 'motion.binding-delay.set' ? 'delayMs' : 'easing';
    return fixedElement && typeof value.trackId === 'string'
      && hasExactObjectKeys(value, [...baseKeys, 'elementId', 'trackId', 'payload'])
      && payload && hasExactObjectKeys(payload, [member])
      && (member === 'easing' ? typeof payload[member] === 'string'
        : typeof payload[member] === 'number') ? base : null;
  }
  if (typeof value.elementId !== 'string' || typeof value.trackId !== 'string'
    || typeof value.keyframeId !== 'string'
    || !hasExactObjectKeys(value, [...baseKeys, 'elementId', 'trackId', 'keyframeId', 'payload'])) return null;
  const payload = plainRecord(value.payload);
  if (!payload) return null;
  if (base.kind === 'motion.keyframe-value.set'
    && (!hasExactObjectKeys(payload, ['value']) || typeof payload.value !== 'number')) return null;
  if (base.kind === 'motion.keyframe-time.set'
    && (!hasExactObjectKeys(payload, ['timeMs']) || typeof payload.timeMs !== 'number')) return null;
  return base;
}

function plainRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function hasExactObjectKeys(value: Record<string, unknown>, expected: string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function formatCanonicalDecimal(value: number): string {
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function cloneRecord(record: EditRecord): EditRecord {
  return structuredClone(record);
}

function authoringFailure(state: AuthoringState, code: string): AuthoringResult {
  return {
    ok: false,
    state,
    diagnostic: {
      code,
      severity: 'error',
      summary: 'The authoring operation was rejected without changing state.',
    },
  };
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(',')}}`;
}

export function deriveElementId(
  structuralFingerprint: string,
  collisionOrdinal: number,
): string {
  return `el_${sha256Hex(`${structuralFingerprint}\0${collisionOrdinal}`).slice(0, 16)}`;
}

/** Deterministic browser-safe SHA-256 with byte-for-byte Node crypto parity. */
export function sha256Hex(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const bitLength = bytes.length * 8;
  const paddedLength = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x1_0000_0000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const k = SHA256_CONSTANTS;
  const w = new Uint32Array(64);
  for (let offset = 0; offset < paddedLength; offset += 64) {
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(offset + index * 4);
    for (let index = 16; index < 64; index += 1) {
      const x = w[index - 15]!;
      const y = w[index - 2]!;
      const s0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const s1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      w[index] = (w[index - 16]! + s0 + w[index - 7]! + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, hh] = h;
    for (let index = 0; index < 64; index += 1) {
      const s1 = rotateRight(e!, 6) ^ rotateRight(e!, 11) ^ rotateRight(e!, 25);
      const choice = (e! & f!) ^ (~e! & g!);
      const t1 = (hh! + s1 + choice + k[index]! + w[index]!) >>> 0;
      const s0 = rotateRight(a!, 2) ^ rotateRight(a!, 13) ^ rotateRight(a!, 22);
      const majority = (a! & b!) ^ (a! & c!) ^ (b! & c!);
      const t2 = (s0 + majority) >>> 0;
      hh = g; g = f; f = e; e = (d! + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    const values = [a!, b!, c!, d!, e!, f!, g!, hh!];
    for (let index = 0; index < 8; index += 1) h[index] = (h[index]! + values[index]!) >>> 0;
  }
  return [...h].map((value) => value.toString(16).padStart(8, '0')).join('');
}

function rotateRight(value: number, count: number): number {
  return (value >>> count) | (value << (32 - count));
}

const SHA256_CONSTANTS = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);
