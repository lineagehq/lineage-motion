import { canonicalJson } from './canonical.js';
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
  CUE_GENERATOR_ID, CUE_GENERATOR_VERSION, REUSABLE_CUE_GENERATOR_ID, REUSABLE_CUE_GENERATOR_VERSION,
  cueExpansionInput, cueFromExpansion,
  cueTargetSnapshots, deriveCueId, expandCue, isAuthoringCue, replacementInputDigest,
  type AuthoringCue, type CueOwnership, type CueReplacementBundle, type CueSemantic,
  type CueTargetSnapshot,
} from './cue-authoring.js';
import type { OperationIntentPayload, OperationPreparation, OperationPreparationRequest,
  PreparedOperationIntent } from './operation-preparation.js';
export { DURABLE_OPERATION_KINDS, projectWorkspace,
  type DurableOperationKind, type WorkspaceProjection, type WritableValue } from './workspace-projection.js';
export { PREPARABLE_OPERATION_KINDS, type OperationIntentPayload, type OperationPreparation,
  type OperationPreparationRequest, type PreparableOperationKind, type PreparedOperationIntent,
  type ViewportIntent } from './operation-preparation.js';

import type { Diagnostic, MotionDocument, RuleTrack, TimingFunction, ValidationResult } from './model.js';
export * from './model.js';

const identifier = z.string().min(1);
export const timingFunctionSchema = z.discriminatedUnion('kind', [
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
      generatorId: z.union([z.literal(CUE_GENERATOR_ID), z.literal(REUSABLE_CUE_GENERATOR_ID)]),
      generatorVersion: z.union([z.literal(CUE_GENERATOR_VERSION), z.literal(REUSABLE_CUE_GENERATOR_VERSION)]),
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

export function validateAttachedCues(document: MotionDocument): string | null {
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

export function maximumCueMoment(semantic: CueSemantic): number {
  return semantic.kind === 'cursor-path' ? semantic.arriveMs
    : semantic.kind === 'click' ? semantic.pulseEndMs
      : semantic.kind === 'reveal' || semantic.kind === 'type' ? semantic.completeMs
        : semantic.kind === 'select' ? semantic.settleMs
          : semantic.kind === 'drag' ? semantic.releaseMs : semantic.exitMs;
}
