import type { MotionDocument, RuleTrack, TimingFunction } from './index.js';
import { sha256Hex } from './sha256.js';

export const CUE_GENERATOR_ID = 'motion.cursor-click-reveal' as const;
export const CUE_GENERATOR_VERSION = 1 as const;

export type CueTargetSnapshot = {
  role: string;
  ordinal: number;
  elementId: string;
  structuralFingerprint: string;
};

export type CursorPathCueSemantic = {
  kind: 'cursor-path';
  cursorTargetId: string;
  startMs: number;
  arriveMs: number;
  easing: TimingFunction;
  waypoints: Array<{ timeMs: number; xPpm: number; yPpm: number }>;
};

export type ClickCueSemantic = {
  kind: 'click';
  cursorTargetId: string;
  pulseTargetId: string;
  arriveMs: number;
  pressMs: number;
  releaseMs: number;
  pulseEndMs: number;
  pressScalePpm: number;
  pulseRadiusPpm: number;
  pulseOpacityPpm: number;
  revealCueId?: string;
};

export type RevealCueSemantic = {
  kind: 'reveal';
  targetIds: string[];
  startMs: number;
  completeMs: number;
};

export type CueSemantic = CursorPathCueSemantic | ClickCueSemantic | RevealCueSemantic;

export type CueReplacementBundle = {
  schemaVersion: 'motion.cue-replacement.v1';
  trackIds: string[];
  inputDigest: string;
  rules: MotionDocument['rules'];
  applications: MotionDocument['applications'];
  tracks: MotionDocument['tracks'];
};

export type AuthoringCue = {
  schemaVersion: 'motion.authoring-cue.v1';
  id: string;
  label: string;
  timeMs: number;
  generatorId: typeof CUE_GENERATOR_ID;
  generatorVersion: typeof CUE_GENERATOR_VERSION;
  semantic: CueSemantic;
  targetSnapshots: CueTargetSnapshot[];
  expansionInputDigest: string;
  expansionDigest: string;
  generatedRuleIds: string[];
  generatedApplicationIds: string[];
  generatedTrackIds: string[];
  replacement?: CueReplacementBundle;
};

export type CueOwnership = {
  schemaVersion: 'motion.cue-ownership.v1';
  cueId: string;
  generatorId: typeof CUE_GENERATOR_ID;
  generatorVersion: typeof CUE_GENERATOR_VERSION;
  targetRoleOrdinal: number;
  expansionDigest: string;
};

export type CueExpansionInput = {
  schemaVersion: 'motion.cue-expansion-input.v1';
  cueId: string;
  generatorId: typeof CUE_GENERATOR_ID;
  generatorVersion: typeof CUE_GENERATOR_VERSION;
  semantic: CueSemantic;
  targetSnapshots: CueTargetSnapshot[];
  replacementTrackIds: string[];
  replacementInputDigest: string | null;
};

export type CueExpansion = {
  input: CueExpansionInput;
  inputDigest: string;
  expansionDigest: string;
  rules: MotionDocument['rules'];
  applications: MotionDocument['applications'];
  tracks: MotionDocument['tracks'];
};

export function deriveCueId(documentId: string, creationKey: string): string {
  if (!documentId || !/^[A-Za-z0-9._:-]{1,128}$/.test(creationKey)) throw new Error('CUE_IDENTITY_INVALID');
  return `cue_${sha256Hex(`${documentId}\0${creationKey}`).slice(0, 24)}`;
}

export function cueTargetSnapshots(document: MotionDocument, semantic: CueSemantic): CueTargetSnapshot[] {
  return semanticTargets(semantic).map((target) => {
    const element = document.elements.find((candidate) => candidate.id === target.elementId);
    if (!element) throw new Error('CUE_TARGET_MISSING');
    return { ...target, structuralFingerprint: element.structuralFingerprint };
  });
}

export function cueExpansionInput(
  cueId: string,
  semantic: CueSemantic,
  targetSnapshots: CueTargetSnapshot[],
  replacement?: Pick<CueReplacementBundle, 'trackIds' | 'inputDigest'>,
): CueExpansionInput {
  return {
    schemaVersion: 'motion.cue-expansion-input.v1', cueId,
    generatorId: CUE_GENERATOR_ID, generatorVersion: CUE_GENERATOR_VERSION,
    semantic: structuredClone(semantic), targetSnapshots: structuredClone(targetSnapshots),
    replacementTrackIds: replacement ? [...replacement.trackIds] : [],
    replacementInputDigest: replacement?.inputDigest ?? null,
  };
}

export function expandCue(input: CueExpansionInput): CueExpansion {
  validateExpansionInput(input);
  const rules: MotionDocument['rules'] = [];
  const applications: MotionDocument['applications'] = [];
  const tracks: MotionDocument['tracks'] = [];
  const addBundle = (role: string, targetIds: string[], ruleTracks: RuleTrack[], durationMs: number,
    delayMs: number, timingFunction: TimingFunction): void => {
    const ruleId = derivedId('cue_rule', input.cueId, role);
    const slotId = derivedId('cue_slot', input.cueId, role);
    const applicationId = derivedId('cue_application', input.cueId, role);
    const normalizedTracks = ruleTracks.map((track) => ({ ...track,
      id: derivedId('cue_rule_track', input.cueId, `${role}\0${track.property}`),
      keyframes: track.keyframes.map((frame, ordinal) => ({ ...frame,
        id: derivedId('cue_kf', input.cueId, `${role}\0${track.property}\0${ordinal}`) })),
    }));
    rules.push({ id: ruleId, sourceName: `cue_${sha256Hex(`${input.cueId}\0${role}`).slice(0, 16)}`, tracks: normalizedTracks });
    applications.push({ id: applicationId, selectorHint: '', bindings: targetIds.map((elementId) => ({ elementId, delayOverridesMs: [delayMs] })),
      slots: [{ id: slotId, ruleId, durationMs, delayMs, iterationCount: 1, direction: 'normal', fillMode: 'both',
        playState: 'running', timingFunction }] });
    for (const [targetOrdinal, elementId] of targetIds.entries()) for (const track of normalizedTracks) tracks.push({
      id: derivedId('cue_track', input.cueId, `${role}\0${targetOrdinal}\0${track.property}`), elementId,
      ruleId, slotId, property: track.property, interpolation: track.interpolation,
      keyframeIds: track.keyframes.map((frame) => frame.id),
    });
  };

  if (input.semantic.kind === 'cursor-path') {
    const cue = input.semantic; const duration = cue.arriveMs - cue.startMs;
    addBundle('cursor-path', [cue.cursorTargetId], [
      { id: '', property: 'left', interpolation: 'continuous', keyframes: [
        { id: '', offset: 0, value: '0px' }, { id: '', offset: 1, value: '0px' },
      ] },
      { id: '', property: 'top', interpolation: 'continuous', keyframes: [
        { id: '', offset: 0, value: '0px' }, { id: '', offset: 1, value: '0px' },
      ] },
      { id: '', property: 'transform', interpolation: 'continuous',
        keyframes: cue.waypoints.map((point) => ({ id: '', offset: (point.timeMs - cue.startMs) / duration,
          value: `translate(${formatViewportPercent(point.xPpm)}vw, ${formatViewportPercent(point.yPpm)}vh)` })) },
      { id: '', property: 'opacity', interpolation: 'continuous', keyframes: [
        { id: '', offset: 0, value: '1' }, { id: '', offset: 1, value: '1' },
      ] },
    ], duration, cue.startMs, cue.easing);
  } else if (input.semantic.kind === 'click') {
    const cue = input.semantic; const duration = cue.pulseEndMs - cue.arriveMs;
    const offset = (time: number): number => (time - cue.arriveMs) / duration;
    addBundle('click-press', [cue.cursorTargetId], [{ id: '', property: 'scale', interpolation: 'continuous', keyframes: [
      { id: '', offset: 0, value: '1' }, { id: '', offset: offset(cue.pressMs), value: formatPpm(cue.pressScalePpm) },
      { id: '', offset: offset(cue.releaseMs), value: '1' }, { id: '', offset: 1, value: '1' },
    ] }], duration, cue.arriveMs, { kind: 'keyword', value: 'ease-out' });
    addBundle('click-pulse', [cue.pulseTargetId], [{ id: '', property: 'box-shadow', interpolation: 'continuous', keyframes: [
      { id: '', offset: 0, value: `0 0 0 0 rgb(0 0 0 / ${formatPpm(cue.pulseOpacityPpm)})` },
      { id: '', offset: offset(cue.pressMs), value: `0 0 0 ${formatPpm(Math.floor(cue.pulseRadiusPpm / 4))}px rgb(0 0 0 / ${formatPpm(cue.pulseOpacityPpm)})` },
      { id: '', offset: 1, value: `0 0 0 ${formatPpm(cue.pulseRadiusPpm)}px rgb(0 0 0 / 0)` },
    ] }], duration, cue.arriveMs, { kind: 'keyword', value: 'ease-out' });
  } else {
    const cue = input.semantic; const duration = cue.completeMs - cue.startMs;
    addBundle('reveal', cue.targetIds, [
      { id: '', property: 'opacity', interpolation: 'continuous', keyframes: [
        { id: '', offset: 0, value: '0' }, { id: '', offset: 1, value: '1' },
      ] },
      { id: '', property: 'visibility', interpolation: 'discrete', keyframes: [
        { id: '', offset: 0, value: 'hidden' }, { id: '', offset: 1, value: 'visible' },
      ] },
    ], duration, cue.startMs, { kind: 'keyword', value: 'linear' });
  }
  const inputDigest = sha256Hex(stableJson(input));
  const core = { schemaVersion: 'motion.cue-expansion-core.v1', rules, applications, tracks };
  const expansionDigest = sha256Hex(stableJson(core));
  return { input: structuredClone(input), inputDigest, expansionDigest, rules, applications,
    tracks: tracks.map((track, ordinal) => ({ ...track, cueOwnership: {
      schemaVersion: 'motion.cue-ownership.v1', cueId: input.cueId, generatorId: CUE_GENERATOR_ID,
      generatorVersion: CUE_GENERATOR_VERSION, targetRoleOrdinal: ordinal, expansionDigest,
    } })) };
}

export function cueFromExpansion(expansion: CueExpansion, replacement?: CueReplacementBundle): AuthoringCue {
  return { schemaVersion: 'motion.authoring-cue.v1', id: expansion.input.cueId,
    label: expansion.input.semantic.kind === 'cursor-path' ? 'Cursor path'
      : expansion.input.semantic.kind === 'click' ? 'Click' : 'Reveal',
    timeMs: expansion.input.semantic.kind === 'cursor-path' ? expansion.input.semantic.startMs
      : expansion.input.semantic.kind === 'click' ? expansion.input.semantic.arriveMs : expansion.input.semantic.startMs,
    generatorId: CUE_GENERATOR_ID, generatorVersion: CUE_GENERATOR_VERSION,
    semantic: structuredClone(expansion.input.semantic), targetSnapshots: structuredClone(expansion.input.targetSnapshots),
    expansionInputDigest: expansion.inputDigest, expansionDigest: expansion.expansionDigest,
    generatedRuleIds: expansion.rules.map((rule) => rule.id),
    generatedApplicationIds: expansion.applications.map((application) => application.id),
    generatedTrackIds: expansion.tracks.map((track) => track.id), ...(replacement ? { replacement: structuredClone(replacement) } : {}) };
}

export function isAuthoringCue(cue: unknown): cue is AuthoringCue {
  return Boolean(cue && typeof cue === 'object' && (cue as { schemaVersion?: unknown }).schemaVersion === 'motion.authoring-cue.v1');
}

export function replacementInputDigest(bundle: Pick<CueReplacementBundle, 'rules' | 'applications' | 'tracks'>): string {
  return sha256Hex(stableJson({ schemaVersion: 'motion.cue-replacement-input.v1', rules: bundle.rules,
    applications: bundle.applications, tracks: bundle.tracks }));
}

function validateExpansionInput(input: CueExpansionInput): void {
  if (input.schemaVersion !== 'motion.cue-expansion-input.v1' || input.generatorId !== CUE_GENERATOR_ID
    || input.generatorVersion !== CUE_GENERATOR_VERSION || !/^cue_[a-f0-9]{24}$/.test(input.cueId)) throw new Error('CUE_INPUT_INVALID');
  const expectedTargets = semanticTargets(input.semantic);
  if (stableJson(expectedTargets) !== stableJson(input.targetSnapshots.map(({ structuralFingerprint: _fingerprint, ...target }) => target))
    || input.targetSnapshots.some((target) => !target.structuralFingerprint)) throw new Error('CUE_TARGET_SNAPSHOT_INVALID');
  const integers = (values: number[]): boolean => values.every(Number.isSafeInteger);
  if (input.semantic.kind === 'cursor-path') {
    const cue = input.semantic;
    if (!integers([cue.startMs, cue.arriveMs, ...cue.waypoints.flatMap((point) => [point.timeMs, point.xPpm, point.yPpm])])
      || cue.startMs < 0 || cue.arriveMs <= cue.startMs || cue.waypoints.length < 2
      || cue.waypoints[0]?.timeMs !== cue.startMs || cue.waypoints.at(-1)?.timeMs !== cue.arriveMs
      || cue.waypoints.some((point, index) => index > 0 && point.timeMs <= cue.waypoints[index - 1]!.timeMs)) throw new Error('CUE_MOMENT_INVALID');
  } else if (input.semantic.kind === 'click') {
    const cue = input.semantic;
    if (!integers([cue.arriveMs, cue.pressMs, cue.releaseMs, cue.pulseEndMs, cue.pressScalePpm, cue.pulseRadiusPpm, cue.pulseOpacityPpm])
      || cue.arriveMs < 0 || !(cue.arriveMs < cue.pressMs && cue.pressMs < cue.releaseMs && cue.releaseMs < cue.pulseEndMs)
      || cue.pressScalePpm <= 0 || cue.pulseRadiusPpm <= 0 || cue.pulseOpacityPpm <= 0 || cue.pulseOpacityPpm > 1_000_000) throw new Error('CUE_MOMENT_INVALID');
  } else {
    const cue = input.semantic;
    if (!integers([cue.startMs, cue.completeMs]) || cue.startMs < 0 || cue.completeMs <= cue.startMs
      || cue.targetIds.length === 0 || new Set(cue.targetIds).size !== cue.targetIds.length) throw new Error('CUE_MOMENT_INVALID');
  }
}

function semanticTargets(semantic: CueSemantic): Array<{ role: string; ordinal: number; elementId: string }> {
  if (semantic.kind === 'cursor-path') return [{ role: 'cursor', ordinal: 0, elementId: semantic.cursorTargetId }];
  if (semantic.kind === 'click') return [
    { role: 'cursor', ordinal: 0, elementId: semantic.cursorTargetId },
    { role: 'pulse', ordinal: 0, elementId: semantic.pulseTargetId },
  ];
  return semantic.targetIds.map((elementId, ordinal) => ({ role: 'reveal', ordinal, elementId }));
}

function derivedId(prefix: string, cueId: string, role: string): string {
  return `${prefix}_${sha256Hex(`${cueId}\0${CUE_GENERATOR_ID}\0${CUE_GENERATOR_VERSION}\0${role}`).slice(0, 24)}`;
}

function formatPpm(value: number): string {
  return String(Math.round(value) / 1_000_000);
}

function formatViewportPercent(value: number): string {
  return String(Math.round(value) / 10_000);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
}
