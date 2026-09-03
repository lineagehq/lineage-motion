import type { MotionDocument, RuleTrack, TimingFunction } from './index.js';
import { sha256Hex } from './sha256.js';

export const CUE_GENERATOR_ID = 'motion.cursor-click-reveal' as const;
export const CUE_GENERATOR_VERSION = 1 as const;
export const REUSABLE_CUE_GENERATOR_ID = 'motion.type-select-drag-hold' as const;
export const REUSABLE_CUE_GENERATOR_VERSION = 1 as const;
type CueGeneratorId = typeof CUE_GENERATOR_ID | typeof REUSABLE_CUE_GENERATOR_ID;
type CueGeneratorVersion = typeof CUE_GENERATOR_VERSION | typeof REUSABLE_CUE_GENERATOR_VERSION;

export type CueTargetSnapshot = {
  role: string;
  ordinal: number;
  elementId: string;
  structuralFingerprint: string;
  contentKind?: 'text';
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

export type TypeCueSemantic = { kind: 'type'; targetId: string; startMs: number; completeMs: number; stepCount: number };
export type SelectCueSemantic = { kind: 'select'; cursorTargetId: string; selectedTargetId: string;
  highlightTargetId?: string; approachMs: number; chooseMs: number; settleMs: number };
export type DragCueSemantic = { kind: 'drag'; cursorTargetId: string; draggedTargetId: string;
  approachMs: number; pressMs: number; moveStartMs: number; arriveMs: number; releaseMs: number;
  grabOffsetXPpm: number; grabOffsetYPpm: number; waypoints: Array<{ timeMs: number; xPpm: number; yPpm: number }> };
export type HoldCueSemantic = { kind: 'hold'; targetIds: string[]; enterMs: number; durationMs: number; exitMs: number };
export type CueSemantic = CursorPathCueSemantic | ClickCueSemantic | RevealCueSemantic | TypeCueSemantic
  | SelectCueSemantic | DragCueSemantic | HoldCueSemantic;

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
  generatorId: CueGeneratorId;
  generatorVersion: CueGeneratorVersion;
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
  generatorId: CueGeneratorId;
  generatorVersion: CueGeneratorVersion;
  targetRoleOrdinal: number;
  expansionDigest: string;
};

export type CueExpansionInput = {
  schemaVersion: 'motion.cue-expansion-input.v1';
  cueId: string;
  generatorId: CueGeneratorId;
  generatorVersion: CueGeneratorVersion;
  semantic: CueSemantic;
  targetSnapshots: CueTargetSnapshot[];
  replacementTrackIds: string[];
  replacementInputDigest: string | null;
  replacementBundle?: CueReplacementBundle | null;
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
    return { ...target, structuralFingerprint: element.structuralFingerprint,
      ...(semantic.kind === 'type' && element.editableText !== undefined ? { contentKind: 'text' as const } : {}) };
  });
}

export function cueExpansionInput(
  cueId: string,
  semantic: CueSemantic,
  targetSnapshots: CueTargetSnapshot[],
  replacement?: CueReplacementBundle,
): CueExpansionInput {
  const reusable = isReusableSemantic(semantic);
  const input: CueExpansionInput = {
    schemaVersion: 'motion.cue-expansion-input.v1', cueId,
    generatorId: reusable ? REUSABLE_CUE_GENERATOR_ID : CUE_GENERATOR_ID,
    generatorVersion: reusable ? REUSABLE_CUE_GENERATOR_VERSION : CUE_GENERATOR_VERSION,
    semantic: structuredClone(semantic), targetSnapshots: structuredClone(targetSnapshots),
    replacementTrackIds: replacement ? [...replacement.trackIds] : [],
    replacementInputDigest: replacement?.inputDigest ?? null,
  };
  if (reusable) input.replacementBundle = replacement ? structuredClone(replacement as CueReplacementBundle) : null;
  return input;
}

export function expandCue(input: CueExpansionInput): CueExpansion {
  validateExpansionInput(input);
  const rules: MotionDocument['rules'] = [];
  const applications: MotionDocument['applications'] = [];
  const tracks: MotionDocument['tracks'] = [];
  const addBundle = (role: string, targetIds: string[], ruleTracks: RuleTrack[], durationMs: number,
    delayMs: number, timingFunction: TimingFunction, playback?: Partial<MotionDocument['applications'][number]['slots'][number]>
      & { bindingDelayMs?: number }): void => {
    const ruleId = derivedId('cue_rule', input.cueId, role, input.generatorId, input.generatorVersion);
    const slotId = derivedId('cue_slot', input.cueId, role, input.generatorId, input.generatorVersion);
    const applicationId = derivedId('cue_application', input.cueId, role, input.generatorId, input.generatorVersion);
    const normalizedTracks = ruleTracks.map((track) => ({ ...track,
      id: derivedId('cue_rule_track', input.cueId, `${role}\0${track.property}`, input.generatorId, input.generatorVersion),
      keyframes: track.keyframes.map((frame, ordinal) => ({ ...frame,
        id: derivedId('cue_kf', input.cueId, `${role}\0${track.property}\0${ordinal}`, input.generatorId, input.generatorVersion) })),
    }));
    rules.push({ id: ruleId, sourceName: `cue_${sha256Hex(`${input.cueId}\0${role}`).slice(0, 16)}`, tracks: normalizedTracks });
    applications.push({ id: applicationId, selectorHint: '', bindings: targetIds.map((elementId) => ({ elementId,
      delayOverridesMs: [playback?.bindingDelayMs ?? delayMs] })), slots: [{ id: slotId, ruleId, durationMs,
      delayMs: playback?.delayMs ?? delayMs, iterationCount: playback?.iterationCount ?? 1,
      direction: playback?.direction ?? 'normal', fillMode: playback?.fillMode ?? 'both',
      playState: playback?.playState ?? 'running', timingFunction: playback?.timingFunction ?? timingFunction }] });
    for (const [targetOrdinal, elementId] of targetIds.entries()) for (const track of normalizedTracks) tracks.push({
      id: derivedId('cue_track', input.cueId, `${role}\0${targetOrdinal}\0${track.property}`, input.generatorId, input.generatorVersion), elementId,
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
  } else if (input.semantic.kind === 'reveal') {
    const cue = input.semantic; const duration = cue.completeMs - cue.startMs;
    addBundle('reveal', cue.targetIds, [
      { id: '', property: 'opacity', interpolation: 'continuous', keyframes: [
        { id: '', offset: 0, value: '0' }, { id: '', offset: 1, value: '1' },
      ] },
      { id: '', property: 'visibility', interpolation: 'discrete', keyframes: [
        { id: '', offset: 0, value: 'hidden' }, { id: '', offset: 1, value: 'visible' },
      ] },
    ], duration, cue.startMs, { kind: 'keyword', value: 'linear' });
  } else if (input.semantic.kind === 'type') {
    const cue = input.semantic;
    addBundle('type', [cue.targetId], [{ id: '', property: 'clip-path', interpolation: 'step', keyframes: [
      { id: '', offset: 0, value: 'inset(0 100% 0 0)' }, { id: '', offset: 1, value: 'inset(0 0% 0 0)' },
    ] }], cue.completeMs - cue.startMs, cue.startMs, { kind: 'steps', count: cue.stepCount, position: 'end' });
  } else if (input.semantic.kind === 'select') {
    const cue = input.semantic; const duration = cue.settleMs - cue.approachMs;
    const chooseOffset = (cue.chooseMs - cue.approachMs) / duration;
    addBundle('select-cursor', [cue.cursorTargetId], [{ id: '', property: 'scale', interpolation: 'continuous', keyframes: [
      { id: '', offset: 0, value: '1' }, { id: '', offset: chooseOffset, value: '0.86' }, { id: '', offset: 1, value: '1' },
    ] }], duration, cue.approachMs, { kind: 'keyword', value: 'ease-out' });
    if (cue.highlightTargetId) addBundle('select-highlight', [cue.highlightTargetId], [
      { id: '', property: 'opacity', interpolation: 'continuous', keyframes: [
        { id: '', offset: 0, value: '0' }, { id: '', offset: chooseOffset, value: '1' }, { id: '', offset: 1, value: '1' },
      ] },
      { id: '', property: 'visibility', interpolation: 'discrete', keyframes: [
        { id: '', offset: 0, value: 'hidden' }, { id: '', offset: chooseOffset, value: 'visible' }, { id: '', offset: 1, value: 'visible' },
      ] },
    ], duration, cue.approachMs, { kind: 'keyword', value: 'linear' });
    else addBundle('select-target', [cue.selectedTargetId], [{ id: '', property: 'box-shadow', interpolation: 'continuous', keyframes: [
      { id: '', offset: 0, value: '0 0 0 0 rgb(0 0 0 / 0)' },
      { id: '', offset: chooseOffset, value: '0 0 0 4px rgb(76 130 121 / 0.8)' },
      { id: '', offset: 1, value: '0 0 0 2px rgb(76 130 121 / 0.5)' },
    ] }], duration, cue.approachMs, { kind: 'keyword', value: 'ease-out' });
  } else if (input.semantic.kind === 'drag') {
    const cue = input.semantic; const cursorDuration = cue.releaseMs - cue.approachMs;
    const cursorPoint = (point: { xPpm: number; yPpm: number }) =>
      `translate(${formatViewportPercent(point.xPpm + cue.grabOffsetXPpm)}vw, ${formatViewportPercent(point.yPpm + cue.grabOffsetYPpm)}vh)`;
    const first = cue.waypoints[0]!; const last = cue.waypoints.at(-1)!;
    addBundle('drag-cursor', [cue.cursorTargetId], [
      { id: '', property: 'left', interpolation: 'continuous', keyframes: [{ id: '', offset: 0, value: '0px' }, { id: '', offset: 1, value: '0px' }] },
      { id: '', property: 'top', interpolation: 'continuous', keyframes: [{ id: '', offset: 0, value: '0px' }, { id: '', offset: 1, value: '0px' }] },
      { id: '', property: 'transform', interpolation: 'continuous', keyframes: [
      { id: '', offset: 0, value: cursorPoint(first) },
      { id: '', offset: (cue.pressMs - cue.approachMs) / cursorDuration, value: cursorPoint(first) },
      ...cue.waypoints.map((point) => ({ id: '', offset: (point.timeMs - cue.approachMs) / cursorDuration, value: cursorPoint(point) })),
      { id: '', offset: 1, value: cursorPoint(last) },
    ] }], cursorDuration, cue.approachMs, { kind: 'keyword', value: 'linear' });
    const objectDuration = cue.releaseMs - cue.moveStartMs;
    addBundle('drag-target', [cue.draggedTargetId], [
      { id: '', property: 'left', interpolation: 'continuous', keyframes: [{ id: '', offset: 0, value: '0px' }, { id: '', offset: 1, value: '0px' }] },
      { id: '', property: 'top', interpolation: 'continuous', keyframes: [{ id: '', offset: 0, value: '0px' }, { id: '', offset: 1, value: '0px' }] },
      { id: '', property: 'transform', interpolation: 'continuous', keyframes: [
      ...cue.waypoints.map((point) => ({ id: '', offset: (point.timeMs - cue.moveStartMs) / objectDuration,
        value: `translate(${formatViewportPercent(point.xPpm)}vw, ${formatViewportPercent(point.yPpm)}vh)` })),
      { id: '', offset: 1, value: `translate(${formatViewportPercent(last.xPpm)}vw, ${formatViewportPercent(last.yPpm)}vh)` },
    ] }], objectDuration, cue.moveStartMs, { kind: 'keyword', value: 'linear' });
  } else {
    expandHold(input, addBundle);
  }
  const inputDigest = sha256Hex(stableJson(input));
  const core = { schemaVersion: 'motion.cue-expansion-core.v1', rules, applications, tracks };
  const expansionDigest = sha256Hex(stableJson(core));
  return { input: structuredClone(input), inputDigest, expansionDigest, rules, applications,
    tracks: tracks.map((track, ordinal) => ({ ...track, cueOwnership: {
      schemaVersion: 'motion.cue-ownership.v1', cueId: input.cueId, generatorId: input.generatorId,
      generatorVersion: input.generatorVersion, targetRoleOrdinal: ordinal, expansionDigest,
    } })) };
}

export function cueFromExpansion(expansion: CueExpansion, replacement?: CueReplacementBundle): AuthoringCue {
  return { schemaVersion: 'motion.authoring-cue.v1', id: expansion.input.cueId,
    label: expansion.input.semantic.kind === 'cursor-path' ? 'Cursor path'
      : expansion.input.semantic.kind === 'click' ? 'Click'
        : expansion.input.semantic.kind === 'reveal' ? 'Reveal'
          : expansion.input.semantic.kind[0]!.toUpperCase() + expansion.input.semantic.kind.slice(1),
    timeMs: expansion.input.semantic.kind === 'cursor-path' ? expansion.input.semantic.startMs
      : expansion.input.semantic.kind === 'click' ? expansion.input.semantic.arriveMs
        : expansion.input.semantic.kind === 'reveal' || expansion.input.semantic.kind === 'type' ? expansion.input.semantic.startMs
          : expansion.input.semantic.kind === 'select' ? expansion.input.semantic.approachMs
            : expansion.input.semantic.kind === 'drag' ? expansion.input.semantic.approachMs : expansion.input.semantic.enterMs,
    generatorId: expansion.input.generatorId, generatorVersion: expansion.input.generatorVersion,
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
  const legacyGenerator = input.generatorId === CUE_GENERATOR_ID && input.generatorVersion === CUE_GENERATOR_VERSION;
  const reusableGenerator = input.generatorId === REUSABLE_CUE_GENERATOR_ID
    && input.generatorVersion === REUSABLE_CUE_GENERATOR_VERSION;
  if (input.schemaVersion !== 'motion.cue-expansion-input.v1' || (!legacyGenerator && !reusableGenerator)
    || legacyGenerator === isReusableSemantic(input.semantic) || !/^cue_[a-f0-9]{24}$/.test(input.cueId)) throw new Error('CUE_INPUT_INVALID');
  const expectedTargets = semanticTargets(input.semantic);
  if (stableJson(expectedTargets) !== stableJson(input.targetSnapshots.map(
    ({ structuralFingerprint: _fingerprint, contentKind: _contentKind, ...target }) => target))
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
  } else if (input.semantic.kind === 'reveal') {
    const cue = input.semantic;
    if (!integers([cue.startMs, cue.completeMs]) || cue.startMs < 0 || cue.completeMs <= cue.startMs
      || cue.targetIds.length === 0 || new Set(cue.targetIds).size !== cue.targetIds.length) throw new Error('CUE_MOMENT_INVALID');
  } else if (input.semantic.kind === 'type') {
    const cue = input.semantic;
    if (!integers([cue.startMs, cue.completeMs, cue.stepCount]) || cue.startMs < 0 || cue.completeMs <= cue.startMs
      || cue.stepCount <= 0 || input.targetSnapshots[0]?.contentKind !== 'text') throw new Error('CUE_MOMENT_INVALID');
  } else if (input.semantic.kind === 'select') {
    const cue = input.semantic;
    if (!integers([cue.approachMs, cue.chooseMs, cue.settleMs]) || cue.approachMs < 0
      || !(cue.approachMs < cue.chooseMs && cue.chooseMs < cue.settleMs)
      || new Set([cue.cursorTargetId, cue.selectedTargetId, ...(cue.highlightTargetId ? [cue.highlightTargetId] : [])]).size
        !== (cue.highlightTargetId ? 3 : 2)) throw new Error('CUE_MOMENT_INVALID');
  } else if (input.semantic.kind === 'drag') {
    const cue = input.semantic;
    if (!integers([cue.approachMs, cue.pressMs, cue.moveStartMs, cue.arriveMs, cue.releaseMs,
      cue.grabOffsetXPpm, cue.grabOffsetYPpm, ...cue.waypoints.flatMap((point) => [point.timeMs, point.xPpm, point.yPpm])])
      || cue.approachMs < 0 || !(cue.approachMs < cue.pressMs && cue.pressMs <= cue.moveStartMs
        && cue.moveStartMs < cue.arriveMs && cue.arriveMs < cue.releaseMs) || cue.waypoints.length < 2
      || cue.cursorTargetId === cue.draggedTargetId
      || cue.waypoints[0]?.timeMs !== cue.moveStartMs || cue.waypoints.at(-1)?.timeMs !== cue.arriveMs
      || cue.waypoints.some((point, index) => index > 0 && point.timeMs <= cue.waypoints[index - 1]!.timeMs)) throw new Error('CUE_MOMENT_INVALID');
  } else {
    const cue = input.semantic;
    if (!integers([cue.enterMs, cue.durationMs, cue.exitMs]) || cue.enterMs < 0 || cue.durationMs <= 0
      || cue.exitMs !== cue.enterMs + cue.durationMs || cue.targetIds.length === 0
      || new Set(cue.targetIds).size !== cue.targetIds.length || !input.replacementBundle
      || input.replacementBundle.inputDigest !== input.replacementInputDigest) throw new Error('CUE_MOMENT_INVALID');
  }
}

function semanticTargets(semantic: CueSemantic): Array<{ role: string; ordinal: number; elementId: string }> {
  if (semantic.kind === 'cursor-path') return [{ role: 'cursor', ordinal: 0, elementId: semantic.cursorTargetId }];
  if (semantic.kind === 'click') return [
    { role: 'cursor', ordinal: 0, elementId: semantic.cursorTargetId },
    { role: 'pulse', ordinal: 0, elementId: semantic.pulseTargetId },
  ];
  if (semantic.kind === 'reveal') return semantic.targetIds.map((elementId, ordinal) => ({ role: 'reveal', ordinal, elementId }));
  if (semantic.kind === 'type') return [{ role: 'type', ordinal: 0, elementId: semantic.targetId }];
  if (semantic.kind === 'select') return [
    { role: 'cursor', ordinal: 0, elementId: semantic.cursorTargetId },
    { role: 'selected', ordinal: 0, elementId: semantic.selectedTargetId },
    ...(semantic.highlightTargetId ? [{ role: 'highlight', ordinal: 0, elementId: semantic.highlightTargetId }] : []),
  ];
  if (semantic.kind === 'drag') return [
    { role: 'cursor', ordinal: 0, elementId: semantic.cursorTargetId },
    { role: 'dragged', ordinal: 0, elementId: semantic.draggedTargetId },
  ];
  return semantic.targetIds.map((elementId, ordinal) => ({ role: 'hold', ordinal, elementId }));
}

function derivedId(prefix: string, cueId: string, role: string, generatorId: CueGeneratorId, generatorVersion: CueGeneratorVersion): string {
  return `${prefix}_${sha256Hex(`${cueId}\0${generatorId}\0${generatorVersion}\0${role}`).slice(0, 24)}`;
}

function isReusableSemantic(semantic: CueSemantic): semantic is TypeCueSemantic | SelectCueSemantic | DragCueSemantic | HoldCueSemantic {
  return ['type', 'select', 'drag', 'hold'].includes(semantic.kind);
}

function expandHold(input: CueExpansionInput, addBundle: (role: string, targetIds: string[], tracks: RuleTrack[],
  durationMs: number, delayMs: number, timingFunction: TimingFunction,
  playback?: Partial<MotionDocument['applications'][number]['slots'][number]> & { bindingDelayMs?: number }) => void): void {
  if (input.semantic.kind !== 'hold' || !input.replacementBundle) throw new Error('CUE_HOLD_INVALID');
  const cue = input.semantic; const bundle = input.replacementBundle;
  for (const [ordinal, sourceTrack] of bundle.tracks.entries()) {
    const application = bundle.applications.find((candidate) => candidate.slots.some((slot) => slot.id === sourceTrack.slotId));
    const slotIndex = application?.slots.findIndex((slot) => slot.id === sourceTrack.slotId) ?? -1;
    const slot = application?.slots[slotIndex]; const binding = application?.bindings.find((candidate) => candidate.elementId === sourceTrack.elementId);
    const ruleTrack = bundle.rules.find((rule) => rule.id === sourceTrack.ruleId)?.tracks.find((track) => track.property === sourceTrack.property);
    if (!application || !slot || !binding || !ruleTrack || !cue.targetIds.includes(sourceTrack.elementId)) throw new Error('CUE_HOLD_INVALID');
    const delayMs = binding.delayOverridesMs[slotIndex]!; const boundary = ruleTrack.keyframes.find((frame) =>
      delayMs + frame.offset * slot.durationMs === cue.enterMs);
    if (!boundary) throw new Error('CUE_HOLD_ENTER_BOUNDARY_MISSING');
    const durationMs = slot.durationMs + cue.durationMs;
    const keyframes = ruleTrack.keyframes.flatMap((frame) => {
      const sourceTime = delayMs + frame.offset * slot.durationMs;
      const shiftedTime = sourceTime > cue.enterMs ? sourceTime + cue.durationMs : sourceTime;
      const output = [{ ...frame, id: '', offset: (shiftedTime - delayMs) / durationMs }];
      if (sourceTime === cue.enterMs) output.push({ ...frame, id: '', offset: (cue.exitMs - delayMs) / durationMs });
      return output;
    });
    addBundle(`hold-${ordinal}`, [sourceTrack.elementId], [{ ...ruleTrack, id: '', keyframes }], durationMs, delayMs,
      slot.timingFunction, { delayMs: slot.delayMs, bindingDelayMs: delayMs, iterationCount: slot.iterationCount,
        direction: slot.direction, fillMode: slot.fillMode, playState: slot.playState, timingFunction: slot.timingFunction });
  }
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
