import { createHash } from 'node:crypto';
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

export type MotionDocument = {
  schemaVersion: 'motion.document.v1';
  documentId: string;
  revision: 0;
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
const motionDocumentSchema = z.object({
  schemaVersion: z.literal('motion.document.v1'),
  documentId: identifier,
  revision: z.literal(0),
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
  ];
  if (idGroups.some(hasDuplicates)
    || hasDuplicates(document.rules.map((rule) => rule.sourceName))
    || hasDuplicates(document.elements.map((element) => element.structuralFingerprint))) {
    return domainFailure('DOMAIN_DUPLICATE_ID', 'Canonical identities must be unique.');
  }
  if (document.cues.some((cue) => cue.timeMs > document.durationMs)) {
    return domainFailure('DOMAIN_CUE_TIME_INVALID', 'A cue falls outside the document duration.');
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
  return `el_${createHash('sha256')
    .update(`${structuralFingerprint}\0${collisionOrdinal}`)
    .digest('hex')
    .slice(0, 16)}`;
}
