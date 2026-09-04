import type { CssTimingFunction } from './css-motion-semantics.js';
import type { AuthoringCue, CueOwnership } from './cue-authoring.js';

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
