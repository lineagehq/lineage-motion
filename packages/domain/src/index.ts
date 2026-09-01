import { z } from 'zod';

import {
  cssKeyframeTimeQuantizationHalfStep,
  classifyAnimatedProperty,
  normalizeCssTimingFunction,
  projectTrackInterpolation,
  type CssTimingFunction,
} from './css-motion-semantics.js';
export {
  CSS_KEYFRAME_PERCENTAGE_DECIMALS,
  classifyReducedMotionDeclaration,
  cssKeyframeTimeQuantizationHalfStep,
  formatCssKeyframePercentage,
} from './css-motion-semantics.js';
import { sha256Hex } from './sha256.js';
import {
  CUE_GENERATOR_ID, CUE_GENERATOR_VERSION, cueExpansionInput, cueFromExpansion,
  cueTargetSnapshots, expandCue, isAuthoringCue, replacementInputDigest,
  type AuthoringCue, type CueOwnership, type CueReplacementBundle, type CueSemantic,
  type CueTargetSnapshot,
} from './cue-authoring.js';

export type Diagnostic = {
  code: string;
  severity: 'error' | 'warning';
  summary: string;
  line?: number;
  column?: number;
};

export type TimingFunction = CssTimingFunction;

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
  captureNamespaceSha256?: string;
  admissionPackageSha256?: string;
};

export type TimelineCue = {
  schemaVersion: 'motion.cue.v1';
  id: string;
  label: string;
  timeMs: number;
};
export type MotionCue = TimelineCue | AuthoringCue;

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
    cueOwnership?: CueOwnership;
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
    cueOwnership: z.object({
      schemaVersion: z.literal('motion.cue-ownership.v1'),
      cueId: identifier,
      generatorId: z.literal(CUE_GENERATOR_ID),
      generatorVersion: z.literal(CUE_GENERATOR_VERSION),
      targetRoleOrdinal: z.number().int().nonnegative(),
      expansionDigest: z.string().regex(/^[a-f0-9]{64}$/),
    }).optional(),
  })),
  cues: z.array(z.union([cueSchema, z.custom<AuthoringCue>(isAuthoringCue)])),
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
    captureNamespaceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    admissionPackageSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
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
  if (document.cues.some((cue) => cue.schemaVersion === 'motion.cue.v1' && cue.timeMs > document.durationMs)) {
    return domainFailure('DOMAIN_CUE_TIME_INVALID', 'A cue falls outside the document duration.');
  }
  const holds = document.holds ?? [];
  if (holds.length > 0) {
    const hold = holds[0]!;
    const cue = document.cues.find((candidate) => candidate.id === hold.cueId);
    if (!cue || cue.schemaVersion !== 'motion.cue.v1' || cue.timeMs !== hold.sourceTimeMs + hold.durationMs) {
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
      const classification = classifyAnimatedProperty(track.property);
      if (!classification || (classification !== track.interpolation && track.interpolation !== 'step')) {
        return domainFailure('DOMAIN_MOTION_PROPERTY_UNSUPPORTED', 'A track property is not registered by motion.css-motion-semantics.v1.');
      }
      try {
        track.keyframes.forEach((keyframe) => { if (keyframe.easing) normalizeCssTimingFunction(keyframe.easing); });
      } catch {
        return domainFailure('DOMAIN_MOTION_TIMING_UNSUPPORTED', 'A keyframe timing function is not registered by motion.css-motion-semantics.v1.');
      }
      const offsets = track.keyframes.map((keyframe) => keyframe.offset);
      if (hasDuplicates(offsets) || offsets.some((offset, index) =>
        index > 0 && offset <= offsets[index - 1]!,
      )) {
        return domainFailure('DOMAIN_TRACK_RELATIONSHIP_INVALID', 'Rule keyframes must be uniquely ordered.');
      }
    }
  }

  for (const application of document.applications) {
    try { application.slots.forEach((slot) => normalizeCssTimingFunction(slot.timingFunction)); } catch {
      return domainFailure('DOMAIN_MOTION_TIMING_UNSUPPORTED', 'An application timing function is not registered by motion.css-motion-semantics.v1.');
    }
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
      || track.interpolation !== projectTrackInterpolation(ruleTrack.property, owner.slot.timingFunction)) {
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

  const cueValidation = validateAttachedCues(document);
  if (cueValidation) return domainFailure(cueValidation, 'Canonical cue ownership or expansion has drifted.');

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

function validateAttachedCues(document: MotionDocument): string | null {
  const authoringCues = document.cues.filter(isAuthoringCue);
  const ownedTracks = document.tracks.filter((track) => track.cueOwnership);
  if (ownedTracks.some((track) => !authoringCues.some((cue) => cue.id === track.cueOwnership!.cueId))) {
    return 'DOMAIN_CUE_OWNERSHIP_INVALID';
  }
  for (const cue of authoringCues) {
    try {
      const currentSnapshots = cueTargetSnapshots(document, cue.semantic);
      if (canonicalJson(currentSnapshots) !== canonicalJson(cue.targetSnapshots)) return 'DOMAIN_CUE_TARGET_DRIFT';
      if (maximumCueMoment(cue.semantic) > document.durationMs) return 'DOMAIN_CUE_TIME_INVALID';
      const expansion = expandCue(cueExpansionInput(cue.id, cue.semantic, cue.targetSnapshots, cue.replacement));
      if (canonicalJson(cueFromExpansion(expansion, cue.replacement)) !== canonicalJson(cue)) {
        return 'DOMAIN_CUE_EXPANSION_DRIFT';
      }
      if (expansion.inputDigest !== cue.expansionInputDigest || expansion.expansionDigest !== cue.expansionDigest
        || canonicalJson(expansion.rules.map((rule) => rule.id)) !== canonicalJson(cue.generatedRuleIds)
        || canonicalJson(expansion.applications.map((application) => application.id)) !== canonicalJson(cue.generatedApplicationIds)
        || canonicalJson(expansion.tracks.map((track) => track.id)) !== canonicalJson(cue.generatedTrackIds)) {
        return 'DOMAIN_CUE_EXPANSION_DRIFT';
      }
      const installedRules = cue.generatedRuleIds.map((id) => document.rules.find((rule) => rule.id === id));
      const installedApplications = cue.generatedApplicationIds.map((id) => document.applications.find((application) => application.id === id));
      const installedTracks = cue.generatedTrackIds.map((id) => document.tracks.find((track) => track.id === id));
      if (installedRules.some((item) => !item) || installedApplications.some((item) => !item) || installedTracks.some((item) => !item)
        || canonicalJson(installedRules) !== canonicalJson(expansion.rules)
        || canonicalJson(installedApplications) !== canonicalJson(expansion.applications)
        || canonicalJson(installedTracks) !== canonicalJson(expansion.tracks)) return 'DOMAIN_CUE_BUNDLE_DRIFT';
      if (cue.replacement && (replacementInputDigest(cue.replacement) !== cue.replacement.inputDigest
        || cue.replacement.trackIds.some((id) => document.tracks.some((track) => track.id === id)))) return 'DOMAIN_CUE_REPLACEMENT_DRIFT';
      if (cue.semantic.kind === 'click' && cue.semantic.revealCueId) {
        const revealCueId = cue.semantic.revealCueId;
        const reveal = authoringCues.find((candidate) => candidate.id === revealCueId);
        if (!reveal || reveal.semantic.kind !== 'reveal' || reveal.semantic.startMs !== cue.semantic.pressMs) return 'DOMAIN_CUE_SYNC_INVALID';
      }
    } catch { return 'DOMAIN_CUE_EXPANSION_INVALID'; }
  }
  return null;
}

function maximumCueMoment(semantic: CueSemantic): number {
  return semantic.kind === 'cursor-path' ? semantic.arriveMs
    : semantic.kind === 'click' ? semantic.pulseEndMs : semantic.completeMs;
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
export type TransformPose = {
  translateXMicrounits: number;
  translateYMicrounits: number;
  scalePpm: number;
  rotateMicrodegrees: number;
};
export type StageProjection = {
  stageDigest: string;
  widthMicrounits: number;
  heightMicrounits: number;
};
export type TrajectoryTarget = EditTarget & { expectedTransform: string };
export type TransformPoseSetOperation = OperationEnvelope & TrajectoryTarget & {
  kind: 'motion.transform-pose.set';
  payload: { pose: TransformPose; stage: StageProjection };
};
export type TransformWaypointsTranslateOperation = OperationEnvelope & {
  kind: 'motion.transform-waypoints.translate';
  payload: { targets: TrajectoryTarget[]; deltaXPpm: number; deltaYPpm: number; stage: StageProjection };
};
export type KeyframeGroupTimeSetOperation = OperationEnvelope & {
  kind: 'motion.keyframe-group-time.set';
  payload: { targets: TrajectoryTarget[]; sourceTimeMs: number; targetTimeMs: number; landingTimeMs: number; settledTimeMs: number };
};
export type KeyframeGroupEasingSetOperation = OperationEnvelope & {
  kind: 'motion.keyframe-group-easing.set';
  payload: { targets: TrajectoryTarget[]; expectedEasing: TimingFunction; easing: TimingFunction };
};
export type SettledHoldSetOperation = OperationEnvelope & {
  kind: 'motion.settled-hold.set';
  payload: { targets: TrajectoryTarget[]; sourceTimeMs: number; settledTimeMs: number; landingTimeMs: number; boundaryTimeMs: 2100 };
};
export type CueCreateOperation = OperationEnvelope & {
  kind: 'motion.cue.create';
  payload: { cueId: string; semantic: CueSemantic; targetSnapshots: CueTargetSnapshot[];
    replacementTrackIds: string[]; replacementInputDigest: string | null };
};
export type CueUpdateOperation = OperationEnvelope & {
  kind: 'motion.cue.update';
  payload: { cueId: string; expectedExpansionDigest: string; semantic: CueSemantic;
    targetSnapshots: CueTargetSnapshot[] };
};
export type CueDeleteOperation = OperationEnvelope & {
  kind: 'motion.cue.delete'; payload: { cueId: string; expectedExpansionDigest: string;
    expectedReplacementInputDigest: string | null };
};
export type CueDetachOperation = OperationEnvelope & {
  kind: 'motion.cue.detach'; payload: { cueId: string; expectedExpansionDigest: string;
    expectedReplacementInputDigest: string | null };
};
export type CueAuthoringOperation = CueCreateOperation | CueUpdateOperation | CueDeleteOperation | CueDetachOperation;
export type TrajectoryAuthoringOperation = TransformPoseSetOperation | TransformWaypointsTranslateOperation
  | KeyframeGroupTimeSetOperation | KeyframeGroupEasingSetOperation | SettledHoldSetOperation;
export type StructuralAuthoringOperation = TrackCreateOperation | KeyframeAddOperation
  | KeyframeRemoveOperation | SlotDurationSetOperation | BindingDelaySetOperation
  | SlotEasingSetOperation | HoldInsertOperation;
export type AuthoringOperation = KeyframeValueOperation | KeyframeTimeOperation
  | StructuralAuthoringOperation | TrajectoryAuthoringOperation | CueAuthoringOperation | HistoryOperation;
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
type InternalTrajectoryRestoreOperation = OperationEnvelope & {
  kind: 'motion.internal.trajectory.restore';
  payload: { expectedContentDigest: string; restore: MotionDocument };
};
type ReducerOperation = EditOperation | InternalTrackDeleteOperation | InternalKeyframeRestoreOperation
  | InternalHoldRemoveOperation | InternalTrajectoryRestoreOperation;

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
  allocatedRevision = state.document.revision + 1,
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
  if (!Number.isSafeInteger(allocatedRevision) || allocatedRevision <= state.document.revision) {
    return authoringFailure(state, 'AUTHORING_REVISION_EXHAUSTED');
  }

  if (operation.kind === 'motion.history.undo' || operation.kind === 'motion.history.redo') {
    const source = operation.kind === 'motion.history.undo' ? state.undo : state.redo;
    if (source.length === 0) return authoringFailure(state, 'AUTHORING_HISTORY_EMPTY');
    const record = source.at(-1)!;
    const replay = operation.kind === 'motion.history.undo' ? record.inverse : record.forward;
    const applied = applyOperation(state.document, replay);
    if (!applied.ok) return authoringFailure(state, 'AUTHORING_HISTORY_REPLAY_INVALID');
    const revision = allocatedRevision;
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

  if (!operation.kind.startsWith('motion.cue.') && targetsCueOwnedTrack(state.document, operation)) {
    return authoringFailure(state, 'CUE_TRACK_LOCKED');
  }

  if ((state.document.holds ?? []).length > 0 && operation.kind !== 'motion.hold.insert') {
    return authoringFailure(state, 'AUTHORING_HOLD_LOCKED');
  }

  const editOperation = operation as EditOperation;
  const applied = applyOperation(state.document, editOperation);
  if (!applied.ok) return authoringFailure(state, applied.code);
  const candidateValidation = validateMotionDocument({ ...applied.document, revision: allocatedRevision });
  if (!candidateValidation.ok) return authoringFailure(state, 'AUTHORING_CANDIDATE_INVALID');
  return {
    ok: true,
    state: {
      document: { ...applied.document, revision: allocatedRevision },
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
  if (operation.kind.startsWith('motion.cue.')) {
    return applyCueOperation(document, operation as CueAuthoringOperation);
  }
  if (operation.kind === 'motion.hold.insert' || operation.kind === 'motion.internal.hold.remove') {
    return applyHold(document, operation);
  }
  if (operation.kind === 'motion.internal.trajectory.restore') {
    if (sha256Hex(canonicalContentBytes(document)) !== operation.payload.expectedContentDigest
      || !validateMotionDocument(operation.payload.restore).ok) {
      return { ok: false, code: 'AUTHORING_HISTORY_REPLAY_INVALID' };
    }
    const restored = structuredClone(operation.payload.restore);
    const inverse: InternalTrajectoryRestoreOperation = {
      schemaVersion: operation.schemaVersion, operationId: operation.operationId,
      documentId: operation.documentId, expectedRevision: operation.expectedRevision,
      kind: 'motion.internal.trajectory.restore',
      payload: { expectedContentDigest: sha256Hex(canonicalContentBytes(restored)), restore: structuredClone(document) },
    };
    return { ok: true, document: restored, inverse };
  }
  if (operation.kind.startsWith('motion.transform-') || operation.kind.startsWith('motion.keyframe-group-')
    || operation.kind === 'motion.settled-hold.set') {
    return applyTrajectoryOperation(document, operation as TrajectoryAuthoringOperation);
  }
  return applyStructural(document, operation as Exclude<StructuralAuthoringOperation, HoldInsertOperation>
    | InternalTrackDeleteOperation | InternalKeyframeRestoreOperation);
}

function applyCueOperation(
  document: MotionDocument,
  operation: CueAuthoringOperation,
): { ok: true; document: MotionDocument; inverse: ReducerOperation } | { ok: false; code: string } {
  const before = structuredClone(document);
  const fail = (code: string): { ok: false; code: string } => ({ ok: false, code });
  const cues = document.cues.filter(isAuthoringCue);
  if (operation.kind === 'motion.cue.create') {
    if (cues.some((cue) => cue.id === operation.payload.cueId)
      || canonicalIdentitySet(document).has(operation.payload.cueId)
      || maximumCueMoment(operation.payload.semantic) > document.durationMs) return fail('CUE_CREATE_INVALID');
    let snapshots: CueTargetSnapshot[];
    try { snapshots = cueTargetSnapshots(document, operation.payload.semantic); } catch { return fail('CUE_TARGET_MISSING'); }
    if (canonicalJson(snapshots) !== canonicalJson(operation.payload.targetSnapshots)) return fail('CUE_TARGET_DRIFT');
    const replacement = collectReplacementBundle(document, operation.payload.replacementTrackIds);
    if (!replacement.ok) return replacement;
    if ((replacement.bundle?.inputDigest ?? null) !== operation.payload.replacementInputDigest) return fail('CUE_REPLACEMENT_STALE');
    let expansion;
    try { expansion = expandCue(cueExpansionInput(operation.payload.cueId, operation.payload.semantic,
      operation.payload.targetSnapshots, replacement.bundle)); } catch { return fail('CUE_CREATE_INVALID'); }
    const next = structuredClone(document);
    if (replacement.bundle) removeStructuralBundle(next, replacement.bundle);
    if (hasCueCollision(next, expansion.rules, expansion.applications, expansion.tracks)) return fail('CUE_ID_COLLISION');
    if (hasPropertyOverlap(next, expansion.tracks)) return fail('CUE_PROPERTY_OVERLAP');
    const cue = cueFromExpansion(expansion, replacement.bundle);
    next.rules.push(...structuredClone(expansion.rules));
    next.applications.push(...structuredClone(expansion.applications));
    next.tracks.push(...structuredClone(expansion.tracks));
    next.cues.push(cue);
    refreshInventory(next);
    if (cue.semantic.kind === 'click' && cue.semantic.revealCueId) {
      const revealCueId = cue.semantic.revealCueId;
      const reveal = next.cues.find((candidate) => isAuthoringCue(candidate) && candidate.id === revealCueId);
      if (!reveal || !isAuthoringCue(reveal) || reveal.semantic.kind !== 'reveal'
        || reveal.semantic.startMs !== cue.semantic.pressMs) return fail('CUE_SYNC_INVALID');
    }
    return cueResult(before, next, operation);
  }

  const cue = cues.find((candidate) => candidate.id === operation.payload.cueId);
  if (!cue || cue.expansionDigest !== operation.payload.expectedExpansionDigest) return fail('CUE_EXPANSION_STALE');
  const replacementDigest = cue.replacement?.inputDigest ?? null;
  if ('expectedReplacementInputDigest' in operation.payload
    && operation.payload.expectedReplacementInputDigest !== replacementDigest) return fail('CUE_REPLACEMENT_STALE');
  if (validateAttachedCues(document)) return fail('CUE_EXPANSION_DRIFT');
  const next = structuredClone(document);
  const nextCue = next.cues.find((candidate) => candidate.id === cue.id)! as AuthoringCue;

  if (operation.kind === 'motion.cue.update') {
    if (maximumCueMoment(operation.payload.semantic) > document.durationMs) return fail('CUE_UPDATE_INVALID');
    let snapshots: CueTargetSnapshot[];
    try { snapshots = cueTargetSnapshots(document, operation.payload.semantic); } catch { return fail('CUE_TARGET_MISSING'); }
    if (canonicalJson(snapshots) !== canonicalJson(operation.payload.targetSnapshots)) return fail('CUE_TARGET_DRIFT');
    if (cue.replacement && (operation.payload.semantic.kind !== cue.semantic.kind
      || canonicalJson(snapshots.map(({ role, ordinal, elementId }) => ({ role, ordinal, elementId })))
        !== canonicalJson(cue.targetSnapshots.map(({ role, ordinal, elementId }) => ({ role, ordinal, elementId }))))) {
      return fail('CUE_REPLACEMENT_SCOPE_CHANGE');
    }
    let expansion;
    try { expansion = expandCue(cueExpansionInput(cue.id, operation.payload.semantic,
      operation.payload.targetSnapshots, cue.replacement)); } catch { return fail('CUE_UPDATE_INVALID'); }
    removeGeneratedBundle(next, cue);
    if (hasCueCollision(next, expansion.rules, expansion.applications, expansion.tracks)) return fail('CUE_ID_COLLISION');
    if (hasPropertyOverlap(next, expansion.tracks)) return fail('CUE_PROPERTY_OVERLAP');
    Object.assign(nextCue, cueFromExpansion(expansion, cue.replacement));
    next.rules.push(...structuredClone(expansion.rules)); next.applications.push(...structuredClone(expansion.applications));
    next.tracks.push(...structuredClone(expansion.tracks)); refreshInventory(next);
    if (nextCue.semantic.kind === 'click' && nextCue.semantic.revealCueId) {
      const revealCueId = nextCue.semantic.revealCueId;
      const reveal = next.cues.find((candidate) => isAuthoringCue(candidate) && candidate.id === revealCueId);
      if (!reveal || !isAuthoringCue(reveal) || reveal.semantic.kind !== 'reveal'
        || reveal.semantic.startMs !== nextCue.semantic.pressMs) return fail('CUE_SYNC_INVALID');
    }
    return cueResult(before, next, operation);
  }

  removeGeneratedBundle(next, cue);
  next.cues = next.cues.filter((candidate) => candidate.id !== cue.id);
  if (operation.kind === 'motion.cue.delete' && cue.replacement) {
    if (hasCueCollision(next, cue.replacement.rules, cue.replacement.applications, cue.replacement.tracks)) return fail('CUE_RESTORE_COLLISION');
    if (hasPropertyOverlap(next, cue.replacement.tracks)) return fail('CUE_RESTORE_OVERLAP');
    next.rules.push(...structuredClone(cue.replacement.rules));
    next.applications.push(...structuredClone(cue.replacement.applications));
    next.tracks.push(...structuredClone(cue.replacement.tracks));
  } else if (operation.kind === 'motion.cue.detach') {
    next.rules.push(...cue.generatedRuleIds.map((id) => structuredClone(document.rules.find((rule) => rule.id === id)!)));
    next.applications.push(...cue.generatedApplicationIds.map((id) => structuredClone(document.applications.find((application) => application.id === id)!)));
    next.tracks.push(...cue.generatedTrackIds.map((id) => document.tracks.find((track) => track.id === id)!)
      .map((track) => { const detached = structuredClone(track); delete detached.cueOwnership; return detached; }));
  }
  refreshInventory(next);
  return cueResult(before, next, operation);
}

function cueResult(before: MotionDocument, next: MotionDocument, operation: CueAuthoringOperation) {
  const inverse: InternalTrajectoryRestoreOperation = { schemaVersion: operation.schemaVersion,
    operationId: operation.operationId, documentId: operation.documentId, expectedRevision: operation.expectedRevision,
    kind: 'motion.internal.trajectory.restore', payload: {
      expectedContentDigest: sha256Hex(canonicalContentBytes(next)), restore: before,
    } };
  return { ok: true as const, document: next, inverse };
}

function collectReplacementBundle(document: MotionDocument, trackIds: string[]):
  { ok: true; bundle?: CueReplacementBundle } | { ok: false; code: string } {
  if (trackIds.length === 0) return { ok: true };
  const requested = document.tracks.filter((track) => trackIds.includes(track.id));
  if (requested.length !== trackIds.length || requested.some((track) => track.cueOwnership)
    || canonicalJson(requested.map((track) => track.id)) !== canonicalJson(trackIds)) return { ok: false, code: 'CUE_REPLACEMENT_INVALID' };
  const closure = closedReplacementTrackIds(document, trackIds);
  const applicationIds = closure.applicationIds; const ruleIds = closure.ruleIds;
  const applications = document.applications.filter((application) => applicationIds.has(application.id));
  const rules = document.rules.filter((rule) => ruleIds.has(rule.id));
  const slotIds = new Set(applications.flatMap((application) => application.slots.map((slot) => slot.id)));
  const tracks = document.tracks.filter((track) => slotIds.has(track.slotId) || ruleIds.has(track.ruleId));
  if (canonicalJson(tracks.map((track) => track.id)) !== canonicalJson(trackIds)) return { ok: false, code: 'CUE_REPLACEMENT_SCOPE_INCOMPLETE' };
  const partial = { schemaVersion: 'motion.cue-replacement.v1' as const, trackIds: [...trackIds], rules: structuredClone(rules),
    applications: structuredClone(applications), tracks: structuredClone(tracks) };
  return { ok: true, bundle: { ...partial, inputDigest: replacementInputDigest(partial) } };
}

export function projectCueReplacement(document: MotionDocument, cueId: string, semantic: CueSemantic):
  { ok: true; trackIds: string[]; inputDigest: string | null } | { ok: false; code: string } {
  try {
    const expansion = expandCue(cueExpansionInput(cueId, semantic, cueTargetSnapshots(document, semantic)));
    const initial = document.tracks.filter((track) => expansion.tracks.some((generated) =>
      generated.elementId === track.elementId && generated.property === track.property)).map((track) => track.id);
    const projected = collectReplacementBundle(document, closedReplacementTrackIds(document, initial).trackIds);
    if (!projected.ok) return projected;
    return { ok: true, trackIds: projected.bundle?.trackIds ?? [], inputDigest: projected.bundle?.inputDigest ?? null };
  } catch { return { ok: false, code: 'CUE_REPLACEMENT_INVALID' }; }
}

function closedReplacementTrackIds(document: MotionDocument, initialTrackIds: string[]): {
  trackIds: string[]; applicationIds: Set<string>; ruleIds: Set<string> } {
  const initial = document.tracks.filter((track) => initialTrackIds.includes(track.id));
  const applicationIds = new Set(document.applications.filter((application) => application.slots.some((slot) =>
    initial.some((track) => track.slotId === slot.id))).map((application) => application.id));
  const ruleIds = new Set<string>(); let changed = true;
  while (changed) {
    changed = false;
    for (const application of document.applications.filter((candidate) => applicationIds.has(candidate.id))) {
      for (const slot of application.slots) if (!ruleIds.has(slot.ruleId)) { ruleIds.add(slot.ruleId); changed = true; }
    }
    for (const application of document.applications) if (!applicationIds.has(application.id)
      && application.slots.some((slot) => ruleIds.has(slot.ruleId))) { applicationIds.add(application.id); changed = true; }
  }
  const slotIds = new Set(document.applications.filter((application) => applicationIds.has(application.id))
    .flatMap((application) => application.slots.map((slot) => slot.id)));
  return { applicationIds, ruleIds, trackIds: document.tracks.filter((track) =>
    slotIds.has(track.slotId) || ruleIds.has(track.ruleId)).map((track) => track.id) };
}

function removeStructuralBundle(document: MotionDocument, bundle: CueReplacementBundle): void {
  const ruleIds = new Set(bundle.rules.map((rule) => rule.id)); const appIds = new Set(bundle.applications.map((application) => application.id));
  const trackIds = new Set(bundle.tracks.map((track) => track.id));
  document.rules = document.rules.filter((rule) => !ruleIds.has(rule.id));
  document.applications = document.applications.filter((application) => !appIds.has(application.id));
  document.tracks = document.tracks.filter((track) => !trackIds.has(track.id));
}

function removeGeneratedBundle(document: MotionDocument, cue: AuthoringCue): void {
  document.rules = document.rules.filter((rule) => !cue.generatedRuleIds.includes(rule.id));
  document.applications = document.applications.filter((application) => !cue.generatedApplicationIds.includes(application.id));
  document.tracks = document.tracks.filter((track) => !cue.generatedTrackIds.includes(track.id));
}

function hasCueCollision(document: MotionDocument, rules: MotionDocument['rules'], applications: MotionDocument['applications'],
  tracks: MotionDocument['tracks']): boolean {
  const ids = canonicalIdentitySet(document); return [...rules, ...applications, ...tracks].some((record) => ids.has(record.id))
    || rules.some((rule) => document.rules.some((existing) => existing.sourceName === rule.sourceName));
}

function hasPropertyOverlap(document: MotionDocument, tracks: MotionDocument['tracks']): boolean {
  return tracks.some((track) => document.tracks.some((existing) => existing.elementId === track.elementId
    && existing.property === track.property));
}

function targetsCueOwnedTrack(document: MotionDocument, operation: AuthoringOperation): boolean {
  const owned = new Set(document.tracks.filter((track) => track.cueOwnership).map((track) => track.id));
  if ('trackId' in operation && typeof operation.trackId === 'string' && owned.has(operation.trackId)) return true;
  if ('payload' in operation && operation.payload && typeof operation.payload === 'object' && 'targets' in operation.payload
    && Array.isArray(operation.payload.targets)) return operation.payload.targets.some((target) => target && typeof target === 'object'
      && 'trackId' in target && owned.has(String(target.trackId)));
  return false;
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
    if (!cue || cue.schemaVersion !== 'motion.cue.v1' || cue.timeMs !== 2870 || document.durationMs !== 4660) {
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
    next.cues = next.cues.map((candidate) => candidate.schemaVersion === 'motion.cue.v1' && candidate.timeMs >= 2870
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
  next.cues = next.cues.map((candidate) => candidate.schemaVersion === 'motion.cue.v1'
    && candidate.timeMs >= hold.sourceTimeMs + hold.durationMs
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

export type TransformTrajectoryWaypoint = {
  keyframeId: string;
  timeMs: number;
  transformBytes: string;
  pose: TransformPose;
};
export type TransformTrajectoryProjection = {
  eligible: true;
  elementId: string;
  trackId: string;
  ruleId: string;
  slotId: string;
  waypoints: TransformTrajectoryWaypoint[];
} | { eligible: false; elementId: string; code: string };

export type ShotWorkspaceConfig = {
  startMs: number;
  landedMs: number;
  settledMs: number;
  targetElementIds: string[];
};

export function parseTransformPose(value: string): TransformPose | null {
  const source = value.trim();
  if (source === 'none') return { translateXMicrounits: 0, translateYMicrounits: 0, scalePpm: 1_000_000, rotateMicrodegrees: 0 };
  const functions = [...source.matchAll(/([a-zA-Z0-9]+)\(([^()]*)\)/g)];
  if (functions.length === 0 || functions.map((item) => item[0]).join(' ') !== source.replace(/\s+/g, ' ')) return null;
  const pose: TransformPose = { translateXMicrounits: 0, translateYMicrounits: 0, scalePpm: 1_000_000, rotateMicrodegrees: 0 };
  const seen = new Set<string>();
  const decimal = (raw: string): number | null => /^-?(?:\d+|\d*\.\d+)$/.test(raw.trim()) ? Number(raw) : null;
  for (const [, rawName, rawArgs] of functions) {
    const name = rawName!.toLowerCase();
    if (seen.has(name)) return null;
    seen.add(name);
    const args = rawArgs!.split(/\s*,\s*|\s+/).filter(Boolean);
    if (name === 'translate' || name === 'translate3d') {
      if ((name === 'translate' && (args.length < 1 || args.length > 2)) || (name === 'translate3d' && args.length !== 3)) return null;
      if (name === 'translate3d' && !/^0(?:px)?$/.test(args[2]!)) return null;
      const x = parseTranslateLength(args[0]!);
      const y = parseTranslateLength(args[1] ?? '0px');
      if (x === null || y === null) return null;
      pose.translateXMicrounits = x;
      pose.translateYMicrounits = y;
    } else if (name === 'translatex' || name === 'translatey') {
      if (args.length !== 1) return null;
      const length = parseTranslateLength(args[0]!); if (length === null) return null;
      pose[name === 'translatex' ? 'translateXMicrounits' : 'translateYMicrounits'] = length;
    } else if (name === 'scale') {
      if (args.length < 1 || args.length > 2) return null;
      const first = decimal(args[0]!); const second = args[1] ? decimal(args[1]) : first;
      if (first === null || second === null || first !== second) return null;
      pose.scalePpm = Math.round(first * 1_000_000);
    } else if (name === 'rotate') {
      if (args.length !== 1) return null;
      const match = /^(-?(?:\d+|\d*\.\d+))deg$/.exec(args[0]!); if (!match) return null;
      pose.rotateMicrodegrees = Math.round(Number(match[1]) * 1_000_000);
    } else return null;
  }
  return validPose(pose) ? pose : null;
}

export function serializeTransformPose(pose: TransformPose): string {
  if (!validPose(pose)) throw new Error('TRAJECTORY_POSE_INVALID');
  const unit = (value: number, scale: number) => formatCanonicalDecimal(value / scale);
  return `translate(${unit(pose.translateXMicrounits, 1_000_000)}px, ${unit(pose.translateYMicrounits, 1_000_000)}px) scale(${unit(pose.scalePpm, 1_000_000)}) rotate(${unit(pose.rotateMicrodegrees, 1_000_000)}deg)`;
}

export function projectTransformTrajectory(document: MotionDocument, elementId: string): TransformTrajectoryProjection {
  if (!validateMotionDocument(document).ok) return { eligible: false, elementId, code: 'TRAJECTORY_DOCUMENT_INVALID' };
  const tracks = document.tracks.filter((track) => track.elementId === elementId && track.property === 'transform');
  if (tracks.length !== 1) return { eligible: false, elementId, code: tracks.length ? 'TRAJECTORY_TRACK_AMBIGUOUS' : 'TRAJECTORY_TRACK_MISSING' };
  const track = tracks[0]!;
  const rule = document.rules.find((candidate) => candidate.id === track.ruleId);
  const ruleTrack = rule?.tracks.find((candidate) => candidate.property === 'transform');
  const application = document.applications.find((candidate) => candidate.slots.some((slot) => slot.id === track.slotId));
  const slotIndex = application?.slots.findIndex((slot) => slot.id === track.slotId) ?? -1;
  const slot = application?.slots[slotIndex];
  const binding = application?.bindings.find((candidate) => candidate.elementId === elementId);
  if (!rule || !ruleTrack || !application || !slot || !binding || slotIndex < 0) return { eligible: false, elementId, code: 'TRAJECTORY_RELATIONSHIP_INVALID' };
  if (document.tracks.filter((candidate) => candidate.ruleId === rule.id && candidate.property === 'transform').length !== 1) {
    return { eligible: false, elementId, code: 'TRAJECTORY_SHARED_RULE_AMBIGUOUS' };
  }
  const delay = binding.delayOverridesMs[slotIndex]; if (delay === undefined || slot.iterationCount !== 1 || slot.direction !== 'normal') return { eligible: false, elementId, code: 'TRAJECTORY_TIMING_UNSUPPORTED' };
  const projectedTimes = projectTrajectoryKeyframeTimes(ruleTrack, delay, slot.durationMs, document.durationMs);
  if (!projectedTimes) return { eligible: false, elementId, code: 'TRAJECTORY_TIME_UNREPRESENTABLE' };
  const waypoints: TransformTrajectoryWaypoint[] = [];
  for (const keyframe of ruleTrack.keyframes) {
    const timeMs = projectedTimes.get(keyframe.id)!;
    const pose = parseTransformPose(keyframe.value);
    if (!pose) return { eligible: false, elementId, code: 'TRAJECTORY_TRANSFORM_UNSUPPORTED' };
    waypoints.push({ keyframeId: keyframe.id, timeMs, transformBytes: keyframe.value, pose });
  }
  return { eligible: true, elementId, trackId: track.id, ruleId: rule.id, slotId: slot.id, waypoints };
}

export function projectShotWorkspace(document: MotionDocument, config: ShotWorkspaceConfig): {
  eligible: boolean; code: string | null; startMs: number; landedMs: number; settledMs: number;
  trajectories: TransformTrajectoryProjection[]; continuityTimesMs: number[];
} {
  if (!exactShotConfig(config) || config.startMs !== 0 || config.landedMs !== 700 || config.settledMs !== 2100
    || config.targetElementIds.length !== 2 || new Set(config.targetElementIds).size !== 2) {
    return { eligible: false, code: 'SHOT_CONFIG_INVALID', startMs: config.startMs, landedMs: config.landedMs, settledMs: config.settledMs, trajectories: [], continuityTimesMs: [] };
  }
  const trajectories = config.targetElementIds.map((id) => projectTransformTrajectory(document, id));
  if (trajectories.some((item) => !item.eligible)) return { eligible: false, code: 'SHOT_TARGET_INELIGIBLE', ...config, trajectories, continuityTimesMs: [] };
  if (trajectories.some((item) => item.eligible && ![0, 700, 2100].every((time) => item.waypoints.some((point) => point.timeMs === time)))) {
    return { eligible: false, code: 'SHOT_BOUNDARY_KEYFRAME_MISSING', ...config, trajectories, continuityTimesMs: [] };
  }
  return { eligible: true, code: null, ...config, trajectories,
    continuityTimesMs: [...new Set(document.cues.filter((cue): cue is TimelineCue => cue.schemaVersion === 'motion.cue.v1')
      .map((cue) => cue.timeMs).filter((time) => time > 2100).concat(document.durationMs > 2100 ? [2101] : []))].sort((a, b) => a - b) };
}

export function projectTrajectorySelection(document: MotionDocument, orderedElementIds: string[], momentMs: number): {
  eligible: boolean; code: string | null; targets: TrajectoryTarget[];
} {
  if (!Number.isSafeInteger(momentMs) || orderedElementIds.length === 0 || new Set(orderedElementIds).size !== orderedElementIds.length) return { eligible: false, code: 'TRAJECTORY_SELECTION_INVALID', targets: [] };
  const targets: TrajectoryTarget[] = [];
  for (const elementId of orderedElementIds) {
    const projected = projectTransformTrajectory(document, elementId);
    if (!projected.eligible) return { eligible: false, code: projected.code, targets: [] };
    const waypoint = projected.waypoints.find((item) => item.timeMs === momentMs);
    if (!waypoint) return { eligible: false, code: 'TRAJECTORY_MOMENT_MISSING', targets: [] };
    targets.push({ elementId, trackId: projected.trackId, keyframeId: waypoint.keyframeId, expectedTransform: waypoint.transformBytes });
  }
  targets.sort((left, right) => `${left.elementId}\0${left.trackId}\0${left.keyframeId}`
    .localeCompare(`${right.elementId}\0${right.trackId}\0${right.keyframeId}`));
  return { eligible: true, code: null, targets };
}

function applyTrajectoryOperation(document: MotionDocument, operation: TrajectoryAuthoringOperation): { ok: true; document: MotionDocument; inverse: ReducerOperation } | { ok: false; code: string } {
  const before = structuredClone(document);
  const next = structuredClone(document);
  const targets = operation.kind === 'motion.transform-pose.set' ? [{ elementId: operation.elementId, trackId: operation.trackId, keyframeId: operation.keyframeId, expectedTransform: operation.expectedTransform }] : operation.payload.targets;
  if (!validTrajectoryTargets(targets)) return { ok: false, code: 'AUTHORING_TRAJECTORY_BUNDLE_INVALID' };
  const resolved = targets.map((target) => resolveTrajectoryTarget(next, target));
  if (resolved.some((item) => !item)) return { ok: false, code: 'AUTHORING_TRAJECTORY_TARGET_INVALID' };
  const entries = resolved as NonNullable<ReturnType<typeof resolveTrajectoryTarget>>[];
  if (operation.kind === 'motion.transform-pose.set') {
    if (!validStage(operation.payload.stage) || !validPose(operation.payload.pose)) return { ok: false, code: 'AUTHORING_TRAJECTORY_PAYLOAD_INVALID' };
    const value = serializeTransformPose(operation.payload.pose);
    if (value === entries[0]!.keyframe.value) return { ok: false, code: 'AUTHORING_ZERO_CHANGE' };
    entries[0]!.keyframe.value = value;
  } else if (operation.kind === 'motion.transform-waypoints.translate') {
    const { deltaXPpm, deltaYPpm, stage } = operation.payload;
    if (!validStage(stage) || !Number.isSafeInteger(deltaXPpm) || !Number.isSafeInteger(deltaYPpm)
      || (deltaXPpm === 0 && deltaYPpm === 0) || Math.abs(deltaXPpm) > 1_000_000 || Math.abs(deltaYPpm) > 1_000_000) return { ok: false, code: 'AUTHORING_TRAJECTORY_PAYLOAD_INVALID' };
    const dx = stage.widthMicrounits * deltaXPpm / 1_000_000; const dy = stage.heightMicrounits * deltaYPpm / 1_000_000;
    if (!Number.isSafeInteger(dx) || !Number.isSafeInteger(dy)) return { ok: false, code: 'AUTHORING_TRAJECTORY_PRECISION_INVALID' };
    for (const entry of entries) { const pose = parseTransformPose(entry.keyframe.value)!;
      entry.keyframe.value = serializeTransformPose({ ...pose, translateXMicrounits: pose.translateXMicrounits + dx, translateYMicrounits: pose.translateYMicrounits + dy }); }
  } else if (operation.kind === 'motion.keyframe-group-time.set') {
    const { sourceTimeMs, targetTimeMs, landingTimeMs, settledTimeMs } = operation.payload;
    if (![sourceTimeMs, targetTimeMs, landingTimeMs, settledTimeMs].every(Number.isSafeInteger)
      || targetTimeMs < 1 || targetTimeMs > 2100 || landingTimeMs < 1 || landingTimeMs >= settledTimeMs || settledTimeMs > 2100
      || sourceTimeMs === targetTimeMs) return { ok: false, code: 'AUTHORING_TRAJECTORY_TIME_INVALID' };
    if (!completeTrajectoryMomentBundle(next, entries, sourceTimeMs)) return { ok: false, code: 'AUTHORING_TRAJECTORY_BUNDLE_INCOMPLETE' };
    for (const entry of uniqueRuleEntries(entries)) { if (entry.timeMs !== sourceTimeMs) return { ok: false, code: 'AUTHORING_TRAJECTORY_TIME_STALE' };
      const offset = (targetTimeMs - entry.delayMs) / entry.slot.durationMs;
      if (!Number.isFinite(offset) || offset < 0 || offset > 1 || !Number.isSafeInteger(offset * 1_000_000)
        || entry.ruleTrack.keyframes.some((frame) => frame.id !== entry.keyframe.id && frame.offset === offset)) return { ok: false, code: 'AUTHORING_TRAJECTORY_TIME_COLLISION' };
      entry.keyframe.offset = offset; entry.ruleTrack.keyframes.sort((a, b) => a.offset - b.offset);
      entry.track.keyframeIds = entry.ruleTrack.keyframes.map((frame) => frame.id); }
  } else if (operation.kind === 'motion.keyframe-group-easing.set') {
    let expected: TimingFunction; let easing: TimingFunction;
    try { expected = normalizeCssTimingFunction(operation.payload.expectedEasing); easing = normalizeCssTimingFunction(operation.payload.easing); } catch { return { ok: false, code: 'AUTHORING_TRAJECTORY_EASING_INVALID' }; }
    if (canonicalJson(expected) === canonicalJson(easing)) return { ok: false, code: 'AUTHORING_ZERO_CHANGE' };
    for (const entry of uniqueRuleEntries(entries)) { if (canonicalJson(entry.keyframe.easing ?? entry.slot.timingFunction) !== canonicalJson(expected)) return { ok: false, code: 'AUTHORING_TRAJECTORY_EASING_STALE' }; entry.keyframe.easing = easing; }
  } else {
    const { sourceTimeMs, settledTimeMs, landingTimeMs, boundaryTimeMs } = operation.payload;
    if (boundaryTimeMs !== 2100 || !Number.isSafeInteger(settledTimeMs) || settledTimeMs <= landingTimeMs || settledTimeMs >= 2100 || sourceTimeMs !== 2100
      || !completeTrajectoryMomentBundle(next, entries, sourceTimeMs)) return { ok: false, code: 'AUTHORING_TRAJECTORY_HOLD_INVALID' };
    for (const entry of uniqueRuleEntries(entries)) {
      const projectedTimes = projectTrajectoryKeyframeTimes(entry.ruleTrack, entry.delayMs,
        entry.slot.durationMs, next.durationMs);
      if (!projectedTimes || entry.timeMs !== sourceTimeMs
        || entry.ruleTrack.keyframes.some((frame) => { const time = projectedTimes.get(frame.id)!;
          return time > settledTimeMs && time < 2100; })) return { ok: false, code: 'AUTHORING_TRAJECTORY_HOLD_COLLISION' };
      const settledOffset = trajectoryOffsetForTime(settledTimeMs, entry.delayMs, entry.slot.durationMs);
      const boundaryOffset = trajectoryOffsetForTime(boundaryTimeMs, entry.delayMs, entry.slot.durationMs);
      if (settledOffset === null || boundaryOffset === null || settledOffset <= 0 || settledOffset >= 1) {
        return { ok: false, code: 'AUTHORING_TRAJECTORY_TIME_UNREPRESENTABLE' };
      }
      const holdKeyframeId = structuralId('hold_kf', `${entry.track.id}\0${boundaryTimeMs}`);
      if (entry.ruleTrack.keyframes.some((frame) => frame.id === holdKeyframeId)) {
        return { ok: false, code: 'AUTHORING_TRAJECTORY_HOLD_COLLISION' };
      }
      const candidate = structuredClone(entry.ruleTrack);
      const sourceKeyframe = candidate.keyframes.find((frame) => frame.id === entry.keyframe.id)!;
      sourceKeyframe.offset = settledOffset;
      candidate.keyframes.push({ id: holdKeyframeId, offset: boundaryOffset, value: entry.keyframe.value });
      candidate.keyframes.sort((a, b) => a.offset - b.offset);
      const candidateTimes = projectTrajectoryKeyframeTimes(candidate, entry.delayMs,
        entry.slot.durationMs, next.durationMs);
      if (!candidateTimes || candidateTimes.get(sourceKeyframe.id) !== settledTimeMs
        || candidateTimes.get(holdKeyframeId) !== boundaryTimeMs) {
        return { ok: false, code: 'AUTHORING_TRAJECTORY_TIME_UNREPRESENTABLE' };
      }
      entry.ruleTrack.keyframes = candidate.keyframes;
      entry.track.keyframeIds = entry.ruleTrack.keyframes.map((frame) => frame.id);
    }
  }
  if (sha256Hex(canonicalContentBytes(before)) === sha256Hex(canonicalContentBytes(next))) return { ok: false, code: 'AUTHORING_ZERO_CHANGE' };
  const inverse: InternalTrajectoryRestoreOperation = { schemaVersion: operation.schemaVersion, operationId: operation.operationId,
    documentId: operation.documentId, expectedRevision: operation.expectedRevision, kind: 'motion.internal.trajectory.restore',
    payload: { expectedContentDigest: sha256Hex(canonicalContentBytes(next)), restore: before } };
  return { ok: true, document: next, inverse };
}

function resolveTrajectoryTarget(document: MotionDocument, target: TrajectoryTarget) {
  const track = document.tracks.find((item) => item.id === target.trackId && item.elementId === target.elementId && item.property === 'transform');
  const rule = track && document.rules.find((item) => item.id === track.ruleId); const ruleTrack = rule?.tracks.find((item) => item.property === 'transform');
  const application = track && document.applications.find((item) => item.slots.some((slot) => slot.id === track.slotId));
  const slotIndex = application?.slots.findIndex((slot) => slot.id === track?.slotId) ?? -1; const slot = application?.slots[slotIndex];
  const binding = application?.bindings.find((item) => item.elementId === target.elementId); const delayMs = binding?.delayOverridesMs[slotIndex];
  const keyframe = ruleTrack?.keyframes.find((item) => item.id === target.keyframeId);
  if (!track || !ruleTrack || !application || !slot || delayMs === undefined || !keyframe || keyframe.value !== target.expectedTransform || !parseTransformPose(keyframe.value)) return null;
  const projectedTimes = projectTrajectoryKeyframeTimes(ruleTrack, delayMs, slot.durationMs, document.durationMs);
  if (!projectedTimes) return null;
  const timeMs = projectedTimes.get(keyframe.id); if (timeMs === undefined) return null;
  return { track, ruleTrack, application, slot, delayMs, keyframe, timeMs };
}
function uniqueRuleEntries<T extends { ruleTrack: RuleTrack }>(entries: T[]): T[] { return entries.filter((entry, index) => entries.findIndex((candidate) => candidate.ruleTrack.id === entry.ruleTrack.id) === index); }
function completeTrajectoryMomentBundle(document: MotionDocument, entries: NonNullable<ReturnType<typeof resolveTrajectoryTarget>>[], timeMs: number): boolean {
  const expected: string[] = [];
  for (const track of document.tracks.filter((candidate) => candidate.property === 'transform')) {
    const projection = projectTransformTrajectory(document, track.elementId); if (!projection.eligible) return false;
    const point = projection.waypoints.find((item) => item.timeMs === timeMs);
    if (point) expected.push(`${track.id}\0${point.keyframeId}`);
  }
  expected.sort();
  const actual = entries.map((entry) => `${entry.track.id}\0${entry.keyframe.id}`).sort(); return canonicalJson(expected) === canonicalJson(actual);
}
function projectTrajectoryKeyframeTimes(ruleTrack: RuleTrack, delayMs: number, durationMs: number,
  maximumTimeMs: number): Map<string, number> | null {
  const maximumDeltaMilliseconds = cssKeyframeTimeQuantizationHalfStep(durationMs);
  if (![delayMs, durationMs, maximumTimeMs].every(Number.isSafeInteger)
    || delayMs < 0 || durationMs <= 0 || maximumTimeMs < 0
    || new Set(ruleTrack.keyframes.map((keyframe) => keyframe.id)).size !== ruleTrack.keyframes.length) return null;
  const projected = new Map<string, number>(); const occupied = new Set<number>();
  for (const keyframe of ruleTrack.keyframes) {
    if (!Number.isFinite(keyframe.offset) || keyframe.offset < 0 || keyframe.offset > 1) return null;
    const sourceTimeMs = delayMs + keyframe.offset * durationMs;
    const integerTimeMs = Math.round(sourceTimeMs);
    const lowerBoundaryMs = integerTimeMs - maximumDeltaMilliseconds;
    const upperBoundaryMs = integerTimeMs + maximumDeltaMilliseconds;
    if (!Number.isFinite(sourceTimeMs) || !Number.isSafeInteger(integerTimeMs)
      || sourceTimeMs < 0 || sourceTimeMs > maximumTimeMs
      || !(sourceTimeMs > lowerBoundaryMs && sourceTimeMs < upperBoundaryMs)
      || occupied.has(integerTimeMs)) return null;
    occupied.add(integerTimeMs); projected.set(keyframe.id, integerTimeMs);
  }
  return projected;
}
function trajectoryOffsetForTime(timeMs: number, delayMs: number, durationMs: number): number | null {
  if (![timeMs, delayMs, durationMs].every(Number.isSafeInteger) || delayMs < 0 || durationMs <= 0) return null;
  const offset = (timeMs - delayMs) / durationMs;
  return Number.isFinite(offset) && offset >= 0 && offset <= 1 ? offset : null;
}
function parseTranslateLength(raw: string): number | null {
  const source = raw.trim();
  if (/^[+-]?(?:0+(?:\.0*)?|\.0+)(?:e[+-]?\d+)?$/i.test(source)) return 0;
  const px = /^(-?(?:\d+|\d*\.\d+))px$/.exec(source);
  if (!px) return null;
  const [, sign = '', whole = '', fraction = ''] = /^(-?)(\d*)(?:\.(\d+))?$/.exec(px[1]!)!;
  if (fraction.length > 6 && /[1-9]/.test(fraction.slice(6))) return null;
  const magnitude = BigInt(whole || '0') * 1_000_000n + BigInt(fraction.slice(0, 6).padEnd(6, '0') || '0');
  const microunits = sign === '-' ? -magnitude : magnitude;
  if (microunits < BigInt(Number.MIN_SAFE_INTEGER) || microunits > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(microunits);
}
function validTrajectoryTargets(value: TrajectoryTarget[]): boolean { return value.length > 0 && value.every((target) => target && typeof target.elementId === 'string' && typeof target.trackId === 'string' && typeof target.keyframeId === 'string' && typeof target.expectedTransform === 'string') && new Set(value.map((target) => `${target.elementId}\0${target.trackId}\0${target.keyframeId}`)).size === value.length && value.every((target, index) => index === 0 || `${value[index - 1]!.elementId}\0${value[index - 1]!.trackId}` < `${target.elementId}\0${target.trackId}`); }
function validPose(pose: TransformPose): boolean { return [pose.translateXMicrounits, pose.translateYMicrounits, pose.scalePpm, pose.rotateMicrodegrees].every(Number.isSafeInteger) && pose.scalePpm > 0 && pose.scalePpm <= 10_000_000; }
function validStage(stage: StageProjection): boolean { return /^[a-f0-9]{64}$/.test(stage.stageDigest) && Number.isSafeInteger(stage.widthMicrounits) && stage.widthMicrounits > 0 && Number.isSafeInteger(stage.heightMicrounits) && stage.heightMicrounits > 0; }
function exactShotConfig(config: ShotWorkspaceConfig): boolean { return config && Object.keys(config).sort().join(',') === 'landedMs,settledMs,startMs,targetElementIds' && [config.startMs, config.landedMs, config.settledMs].every(Number.isSafeInteger) && Array.isArray(config.targetElementIds) && config.targetElementIds.every((id) => typeof id === 'string'); }

export function isValidAuthoringOperationId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value);
}

function parseOperation(input: unknown): AuthoringOperation | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (value.schemaVersion !== 'motion.operation.v1'
    || !isValidAuthoringOperationId(value.operationId)
    || typeof value.documentId !== 'string' || value.documentId.length === 0
    || !Number.isSafeInteger(value.expectedRevision) || (value.expectedRevision as number) < 0
    || !['motion.keyframe-value.set', 'motion.keyframe-time.set', 'motion.track.create',
      'motion.keyframe.add', 'motion.keyframe.remove', 'motion.slot-duration.set',
      'motion.binding-delay.set', 'motion.slot-easing.set',
      'motion.hold.insert',
      'motion.cue.create', 'motion.cue.update', 'motion.cue.delete', 'motion.cue.detach',
      'motion.transform-pose.set', 'motion.transform-waypoints.translate',
      'motion.keyframe-group-time.set', 'motion.keyframe-group-easing.set', 'motion.settled-hold.set',
      'motion.history.undo', 'motion.history.redo'].includes(String(value.kind))) {
    return null;
  }
  const baseKeys = ['schemaVersion', 'operationId', 'documentId', 'expectedRevision', 'kind'];
  const base = value as unknown as AuthoringOperation;
  if (base.kind === 'motion.history.undo' || base.kind === 'motion.history.redo') {
    return hasExactObjectKeys(value, baseKeys) ? base : null;
  }
  if (base.kind === 'motion.cue.create' || base.kind === 'motion.cue.update'
    || base.kind === 'motion.cue.delete' || base.kind === 'motion.cue.detach') {
    const payload = plainRecord(value.payload);
    if (!payload || !hasExactObjectKeys(value, [...baseKeys, 'payload'])
      || typeof payload.cueId !== 'string' || !/^cue_[a-f0-9]{24}$/.test(payload.cueId)) return null;
    if (base.kind === 'motion.cue.create') {
      return hasExactObjectKeys(payload, ['cueId', 'semantic', 'targetSnapshots', 'replacementTrackIds', 'replacementInputDigest'])
        && validCueSemanticRecord(payload.semantic) && validCueTargetSnapshotRecords(payload.targetSnapshots)
        && Array.isArray(payload.replacementTrackIds) && payload.replacementTrackIds.every((id) => typeof id === 'string')
        && (payload.replacementInputDigest === null || isDigest(payload.replacementInputDigest)) ? base : null;
    }
    if (base.kind === 'motion.cue.update') {
      return hasExactObjectKeys(payload, ['cueId', 'expectedExpansionDigest', 'semantic', 'targetSnapshots'])
        && isDigest(payload.expectedExpansionDigest) && validCueSemanticRecord(payload.semantic)
        && validCueTargetSnapshotRecords(payload.targetSnapshots) ? base : null;
    }
    return hasExactObjectKeys(payload, ['cueId', 'expectedExpansionDigest', 'expectedReplacementInputDigest'])
      && isDigest(payload.expectedExpansionDigest)
      && (payload.expectedReplacementInputDigest === null || isDigest(payload.expectedReplacementInputDigest)) ? base : null;
  }
  if (base.kind === 'motion.hold.insert') {
    const payload = plainRecord(value.payload);
    return hasExactObjectKeys(value, [...baseKeys, 'payload']) && payload
      && hasExactObjectKeys(payload, ['cueId', 'durationMs'])
      && payload.cueId === 'cue_pair' && payload.durationMs === 600 ? base : null;
  }
  if (base.kind === 'motion.transform-pose.set') {
    const payload = plainRecord(value.payload); const pose = plainRecord(payload?.pose); const stage = plainRecord(payload?.stage);
    return typeof value.elementId === 'string' && typeof value.trackId === 'string' && typeof value.keyframeId === 'string'
      && typeof value.expectedTransform === 'string' && hasExactObjectKeys(value, [...baseKeys, 'elementId', 'trackId', 'keyframeId', 'expectedTransform', 'payload'])
      && payload && hasExactObjectKeys(payload, ['pose', 'stage']) && pose && parsePoseRecord(pose) && stage && parseStageRecord(stage) ? base : null;
  }
  if (base.kind === 'motion.transform-waypoints.translate' || base.kind === 'motion.keyframe-group-time.set'
    || base.kind === 'motion.keyframe-group-easing.set' || base.kind === 'motion.settled-hold.set') {
    const payload = plainRecord(value.payload); if (!payload || !hasExactObjectKeys(value, [...baseKeys, 'payload'])) return null;
    const targets = payload.targets; if (!Array.isArray(targets) || !targets.every((target) => {
      const item = plainRecord(target); return item && hasExactObjectKeys(item, ['elementId', 'trackId', 'keyframeId', 'expectedTransform'])
        && ['elementId', 'trackId', 'keyframeId', 'expectedTransform'].every((key) => typeof item[key] === 'string');
    }) || !validTrajectoryTargets(targets as TrajectoryTarget[])) return null;
    if (base.kind === 'motion.transform-waypoints.translate') {
      const stage = plainRecord(payload.stage); return hasExactObjectKeys(payload, ['targets', 'deltaXPpm', 'deltaYPpm', 'stage'])
        && Number.isSafeInteger(payload.deltaXPpm) && Number.isSafeInteger(payload.deltaYPpm) && stage && parseStageRecord(stage) ? base : null;
    }
    if (base.kind === 'motion.keyframe-group-time.set') return hasExactObjectKeys(payload, ['targets', 'sourceTimeMs', 'targetTimeMs', 'landingTimeMs', 'settledTimeMs'])
      && ['sourceTimeMs', 'targetTimeMs', 'landingTimeMs', 'settledTimeMs'].every((key) => Number.isSafeInteger(payload[key])) ? base : null;
    if (base.kind === 'motion.keyframe-group-easing.set') return hasExactObjectKeys(payload, ['targets', 'expectedEasing', 'easing'])
      && timingFunctionSchema.safeParse(payload.expectedEasing).success && timingFunctionSchema.safeParse(payload.easing).success ? base : null;
    return hasExactObjectKeys(payload, ['targets', 'sourceTimeMs', 'settledTimeMs', 'landingTimeMs', 'boundaryTimeMs'])
      && ['sourceTimeMs', 'settledTimeMs', 'landingTimeMs', 'boundaryTimeMs'].every((key) => Number.isSafeInteger(payload[key])) && payload.boundaryTimeMs === 2100 ? base : null;
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

export function parseAuthoringOperation(input: unknown): AuthoringOperation | null { return parseOperation(input); }

function validCueSemanticRecord(value: unknown): value is CueSemantic {
  const semantic = plainRecord(value); if (!semantic || typeof semantic.kind !== 'string') return false;
  const allInteger = (keys: string[]): boolean => keys.every((key) => Number.isSafeInteger(semantic[key]));
  if (semantic.kind === 'cursor-path') {
    return hasExactObjectKeys(semantic, ['kind', 'cursorTargetId', 'startMs', 'arriveMs', 'easing', 'waypoints'])
      && typeof semantic.cursorTargetId === 'string' && allInteger(['startMs', 'arriveMs'])
      && timingFunctionSchema.safeParse(semantic.easing).success && Array.isArray(semantic.waypoints)
      && semantic.waypoints.every((point) => { const record = plainRecord(point); return record
        && hasExactObjectKeys(record, ['timeMs', 'xPpm', 'yPpm']) && Object.values(record).every(Number.isSafeInteger); });
  }
  if (semantic.kind === 'click') {
    const expected = ['kind', 'cursorTargetId', 'pulseTargetId', 'arriveMs', 'pressMs', 'releaseMs', 'pulseEndMs',
      'pressScalePpm', 'pulseRadiusPpm', 'pulseOpacityPpm'];
    if ('revealCueId' in semantic) expected.push('revealCueId');
    return hasExactObjectKeys(semantic, expected) && typeof semantic.cursorTargetId === 'string'
      && typeof semantic.pulseTargetId === 'string' && (!('revealCueId' in semantic) || typeof semantic.revealCueId === 'string')
      && allInteger(['arriveMs', 'pressMs', 'releaseMs', 'pulseEndMs', 'pressScalePpm', 'pulseRadiusPpm', 'pulseOpacityPpm']);
  }
  return semantic.kind === 'reveal' && hasExactObjectKeys(semantic, ['kind', 'targetIds', 'startMs', 'completeMs'])
    && Array.isArray(semantic.targetIds) && semantic.targetIds.every((id) => typeof id === 'string')
    && allInteger(['startMs', 'completeMs']);
}

function validCueTargetSnapshotRecords(value: unknown): value is CueTargetSnapshot[] {
  return Array.isArray(value) && value.every((snapshot) => { const record = plainRecord(snapshot); return record
    && hasExactObjectKeys(record, ['role', 'ordinal', 'elementId', 'structuralFingerprint'])
    && typeof record.role === 'string' && Number.isSafeInteger(record.ordinal) && typeof record.elementId === 'string'
    && typeof record.structuralFingerprint === 'string'; });
}

function isDigest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }

function parsePoseRecord(value: Record<string, unknown>): boolean { return hasExactObjectKeys(value, ['translateXMicrounits', 'translateYMicrounits', 'scalePpm', 'rotateMicrodegrees']) && Object.values(value).every(Number.isSafeInteger) && validPose(value as TransformPose); }
function parseStageRecord(value: Record<string, unknown>): boolean { return hasExactObjectKeys(value, ['stageDigest', 'widthMicrounits', 'heightMicrounits']) && validStage(value as StageProjection); }

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

export * from './css-motion-semantics.js';
export * from './cue-authoring.js';
export { sha256Hex } from './sha256.js';
