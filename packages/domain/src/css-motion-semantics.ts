import { sha256Hex } from './sha256.js';

export const CSS_MOTION_SEMANTICS_VERSION = 'motion.css-motion-semantics.v1' as const;
export const CSS_KEYFRAME_PERCENTAGE_DECIMALS = 6 as const;

export type ReducedMotionDeclarationKind =
  | 'animation-none'
  | 'animation-duration'
  | 'animation-timing-function'
  | 'static';

export type CssTimingFunction =
  | { kind: 'keyword'; value: 'linear' | 'ease' | 'ease-in' | 'ease-out' | 'ease-in-out' }
  | { kind: 'steps'; count: number; position: 'start' | 'end' | 'jump-start' | 'jump-end' | 'jump-none' | 'jump-both' }
  | { kind: 'cubic-bezier'; x1: number; y1: number; x2: number; y2: number };

export type MotionPropertyClassification = 'continuous' | 'discrete';

const PROPERTY_REGISTRY = new Map<string, MotionPropertyClassification>([
  ['opacity', 'continuous'], ['transform', 'continuous'], ['scale', 'continuous'], ['color', 'continuous'],
  ['background-color', 'continuous'], ['background', 'continuous'],
  ['border-color', 'continuous'], ['outline-color', 'continuous'], ['box-shadow', 'continuous'],
  ['clip-path', 'continuous'], ['filter', 'continuous'], ['width', 'continuous'], ['height', 'continuous'],
  ['left', 'continuous'], ['right', 'continuous'], ['top', 'continuous'], ['bottom', 'continuous'],
  ['margin-left', 'continuous'], ['margin-right', 'continuous'], ['margin-top', 'continuous'],
  ['margin-bottom', 'continuous'], ['padding-left', 'continuous'], ['padding-right', 'continuous'],
  ['padding-top', 'continuous'], ['padding-bottom', 'continuous'], ['visibility', 'discrete'],
]);

const KEYWORDS = new Set(['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out']);
const STEP_POSITIONS: ReadonlyMap<string, Extract<CssTimingFunction, { kind: 'steps' }>['position']> = new Map([
  ['start', 'start'], ['jump-start', 'jump-start'], ['end', 'end'],
  ['jump-end', 'jump-end'], ['jump-none', 'jump-none'], ['jump-both', 'jump-both'],
]);

export function classifyAnimatedProperty(property: string): MotionPropertyClassification | null {
  return PROPERTY_REGISTRY.get(property.trim().toLowerCase()) ?? null;
}

export function registeredAnimatedProperties(): readonly string[] {
  return [...PROPERTY_REGISTRY.keys()].sort();
}

/**
 * Closed declaration grammar for a source-snapshot reduced-motion branch.
 * Structural concerns (the exact media query, ordinary selectors, and no
 * nested at-rules) remain the caller's responsibility because they require a
 * CSS AST. This function is deliberately usable by both import and compiler.
 */
export function classifyReducedMotionDeclaration(
  propertyInput: string,
  valueInput: string,
  important: boolean,
): ReducedMotionDeclarationKind | null {
  if (important) return null;
  const property = propertyInput.trim().toLowerCase();
  const value = valueInput.trim();
  const lowerValue = value.toLowerCase();
  if (!property || property.startsWith('--') || !value
    || /(?:var|env|url|local)\s*\(/i.test(value)) return null;
  if (property === 'animation') return lowerValue === 'none' ? 'animation-none' : null;
  if (property === 'animation-duration') {
    if (value.includes(',')) return null;
    const match = /^(?:(\d+(?:\.\d+)?|\.\d+))(ms|s)$/i.exec(value);
    if (!match || !Number.isFinite(Number(match[1]))) return null;
    return 'animation-duration';
  }
  if (property === 'animation-timing-function') {
    try { parseCssTimingFunction(value); } catch { return null; }
    return 'animation-timing-function';
  }
  if (property === 'transition' || property.startsWith('transition-')
    || property.startsWith('animation-')) return null;
  return 'static';
}

/** Byte-stable keyframe percentage formatting shared with the CSS compiler. */
export function formatCssKeyframePercentage(offset: number): string {
  if (!Number.isFinite(offset) || offset < 0 || offset > 1) {
    throw new Error('CSS_MOTION_KEYFRAME_UNSUPPORTED');
  }
  const percentage = offset * 100;
  const formatted = Number.isInteger(percentage)
    ? String(percentage)
    : percentage.toFixed(CSS_KEYFRAME_PERCENTAGE_DECIMALS).replace(/0+$/, '').replace(/\.$/, '');
  return `${formatted}%`;
}

/** Open half-step, in milliseconds, induced by the compiler's percentage quantization. */
export function cssKeyframeTimeQuantizationHalfStep(durationMs: number): number {
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) {
    throw new Error('CSS_MOTION_DURATION_INVALID');
  }
  return durationMs / (2 * 100 * (10 ** CSS_KEYFRAME_PERCENTAGE_DECIMALS));
}

export function projectTrackInterpolation(property: string, timing: string | CssTimingFunction): 'continuous' | 'discrete' | 'step' {
  const classification = classifyAnimatedProperty(property);
  if (!classification) throw new Error('CSS_MOTION_PROPERTY_UNSUPPORTED');
  return normalizeCssTimingFunction(timing).kind === 'steps' ? 'step' : classification;
}

export function parseCssTimingFunction(input: string): CssTimingFunction {
  const value = input.trim().toLowerCase();
  if (KEYWORDS.has(value)) return { kind: 'keyword', value: value as Extract<CssTimingFunction, { kind: 'keyword' }>['value'] };
  const steps = /^steps\(\s*(\d+)\s*(?:,\s*([a-z-]+)\s*)?\)$/.exec(value);
  if (steps) {
    const count = Number(steps[1]);
    const position = STEP_POSITIONS.get(steps[2] ?? 'end');
    if (!Number.isSafeInteger(count) || count < 1 || !position || (position === 'jump-none' && count < 2)) throw new Error('CSS_MOTION_TIMING_UNSUPPORTED');
    return { kind: 'steps', count, position };
  }
  const bezier = /^cubic-bezier\(\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*,\s*(-?(?:\d+(?:\.\d+)?|\.\d+))\s*\)$/.exec(value);
  if (bezier) {
    const [x1, y1, x2, y2] = bezier.slice(1).map(Number) as [number, number, number, number];
    if (![x1, y1, x2, y2].every(Number.isFinite) || x1 < 0 || x1 > 1 || x2 < 0 || x2 > 1) throw new Error('CSS_MOTION_TIMING_UNSUPPORTED');
    return { kind: 'cubic-bezier', x1, y1, x2, y2 };
  }
  throw new Error('CSS_MOTION_TIMING_UNSUPPORTED');
}

export function normalizeCssTimingFunction(input: string | CssTimingFunction): CssTimingFunction {
  return typeof input === 'string' ? parseCssTimingFunction(input) : parseCssTimingFunction(serializeCssTimingFunction(input));
}

export function serializeCssTimingFunction(input: CssTimingFunction): string {
  if (input.kind === 'keyword') return input.value;
  if (input.kind === 'steps') return `steps(${input.count}, ${input.position})`;
  return `cubic-bezier(${formatNumber(input.x1)}, ${formatNumber(input.y1)}, ${formatNumber(input.x2)}, ${formatNumber(input.y2)})`;
}

/** Exact input fractions at which a CSS steps() function changes output. */
export function stepTransitionFractions(input: string | CssTimingFunction): number[] {
  const timing = normalizeCssTimingFunction(input);
  if (timing.kind !== 'steps') return [];
  const fractions = Array.from({ length: Math.max(0, timing.count - 1) }, (_, index) => (index + 1) / timing.count);
  if (timing.position === 'start' || timing.position === 'jump-start' || timing.position === 'jump-both') fractions.unshift(0);
  if (timing.position === 'end' || timing.position === 'jump-end' || timing.position === 'jump-both') fractions.push(1);
  return [...new Set(fractions)];
}

/** The normalized output progress defined by the registered CSS timing function. */
export function evaluateCssTimingProgress(input: string | CssTimingFunction, progress: number): number {
  const timing = normalizeCssTimingFunction(input);
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new Error('CSS_MOTION_PROGRESS_INVALID');
  if (timing.kind === 'steps') {
    const offset = timing.position === 'start' || timing.position === 'jump-start' || timing.position === 'jump-both' ? 1 : 0;
    const denominator = timing.position === 'jump-none' ? timing.count - 1 : timing.position === 'jump-both' ? timing.count + 1 : timing.count;
    return Math.max(0, Math.min(1, (Math.floor(progress * timing.count) + offset) / denominator));
  }
  const points = timing.kind === 'cubic-bezier' ? [timing.x1, timing.y1, timing.x2, timing.y2] as const
    : keywordBezier(timing.value);
  if (!points) return progress;
  let low = 0; let high = 1;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const mid = (low + high) / 2;
    if (cubic(mid, points[0], points[2]) < progress) low = mid; else high = mid;
  }
  return cubic((low + high) / 2, points[1], points[3]);
}

/** Input fraction at which an ordinary discrete property switches values. */
export function discreteTransitionFraction(input: string | CssTimingFunction): number {
  const timing = normalizeCssTimingFunction(input);
  if (evaluateCssTimingProgress(timing, 0) >= 0.5) return 0;
  const transitions = stepTransitionFractions(timing);
  if (transitions.length > 0) return transitions.find((fraction) => evaluateCssTimingProgress(timing, fraction) >= 0.5) ?? 1;
  let low = 0; let high = 1;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const mid = (low + high) / 2;
    if (evaluateCssTimingProgress(timing, mid) < 0.5) low = mid; else high = mid;
  }
  return normalizeTime((low + high) / 2);
}

export type SemanticKeyframe = Readonly<{
  offset: number;
  easing: CssTimingFunction;
  properties: readonly string[];
  values: Readonly<Record<string, string>>;
}>;

export type SemanticAnimationInstance = Readonly<{
  applicationId: string;
  targetId: string;
  ruleId: string;
  timeline: 'document';
  composition: 'replace';
  durationMs: number;
  delayMs: number;
  iterations: number | 'infinite';
  direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse';
  fill: 'none' | 'forwards' | 'backwards' | 'both';
  playState: 'running' | 'paused';
  easing: CssTimingFunction;
  properties: readonly Readonly<{ name: string; classification: MotionPropertyClassification }>[];
  keyframes: readonly SemanticKeyframe[];
}>;

export function applicationInstanceId(targetId: string, ruleId: string, sourceProvenanceId: string): string {
  if (![targetId, ruleId, sourceProvenanceId].every((value) => /^[a-z][a-z0-9_-]{1,127}$/i.test(value))) throw new Error('CSS_MOTION_IDENTITY_INVALID');
  return `application_${sha256Hex(`${targetId}\0${ruleId}\0${sourceProvenanceId}`).slice(0, 24)}`;
}

export function normalizeAnimationInstance(input: Omit<SemanticAnimationInstance, 'properties' | 'keyframes' | 'easing'> & {
  easing: string | CssTimingFunction;
  properties: readonly string[];
  keyframes: readonly Readonly<{ offset: number; easing: string | CssTimingFunction; properties: readonly string[]; values?: Readonly<Record<string, string>> }>[];
}): SemanticAnimationInstance {
  if (input.timeline !== 'document' || input.composition !== 'replace' || !Number.isFinite(input.durationMs) || input.durationMs <= 0 || !Number.isFinite(input.delayMs) || (input.iterations !== 'infinite' && (!Number.isFinite(input.iterations) || input.iterations <= 0))) throw new Error('CSS_MOTION_INSTANCE_UNSUPPORTED');
  if (!['normal', 'reverse', 'alternate', 'alternate-reverse'].includes(input.direction) || !['none', 'forwards', 'backwards', 'both'].includes(input.fill) || !['running', 'paused'].includes(input.playState)) throw new Error('CSS_MOTION_INSTANCE_UNSUPPORTED');
  const properties = [...new Set(input.properties.map((property) => property.toLowerCase()))].sort().map((name) => {
    const classification = classifyAnimatedProperty(name);
    if (!classification) throw new Error('CSS_MOTION_PROPERTY_UNSUPPORTED');
    return { name, classification } as const;
  });
  if (properties.length === 0) throw new Error('CSS_MOTION_PROPERTY_UNSUPPORTED');
  const keyframes = input.keyframes.map((frame) => {
    if (!Number.isFinite(frame.offset) || frame.offset < 0 || frame.offset > 1) throw new Error('CSS_MOTION_KEYFRAME_UNSUPPORTED');
    const names = [...new Set(frame.properties.map((property) => property.toLowerCase()))].sort();
    if (names.some((name) => !properties.some((property) => property.name === name))) throw new Error('CSS_MOTION_KEYFRAME_UNSUPPORTED');
    const values = Object.fromEntries(Object.entries(frame.values ?? {}).map(([name, value]) => [name.toLowerCase(), value.trim().toLowerCase()]));
    if (names.some((name) => properties.find((property) => property.name === name)?.classification === 'discrete' && !values[name])) throw new Error('CSS_MOTION_KEYFRAME_UNSUPPORTED');
    return { offset: frame.offset, easing: normalizeCssTimingFunction(frame.easing), properties: names, values };
  });
  if (keyframes.length < 2 || keyframes[0]?.offset !== 0 || keyframes.at(-1)?.offset !== 1 || keyframes.some((frame, index) => index > 0 && frame.offset <= keyframes[index - 1]!.offset)) throw new Error('CSS_MOTION_KEYFRAME_UNSUPPORTED');
  return { ...input, easing: normalizeCssTimingFunction(input.easing), properties, keyframes };
}

export type MotionEvidenceBoundary = Readonly<{ timeMs: number; reasons: readonly string[] }>;

export function deriveMotionEvidenceBoundaries(instances: readonly SemanticAnimationInstance[], durationMs: number): MotionEvidenceBoundary[] {
  if (!Number.isFinite(durationMs) || durationMs < 0) throw new Error('CSS_MOTION_SCHEDULE_INVALID');
  const boundaries = new Map<number, Set<string>>();
  const add = (timeMs: number, reason: string): void => {
    const time = normalizeTime(timeMs);
    if (time < 0 || time > durationMs) return;
    const reasons = boundaries.get(time) ?? new Set<string>(); reasons.add(reason); boundaries.set(time, reasons);
  };
  for (const instance of instances) {
    const finiteIterations = instance.iterations === 'infinite' ? null : instance.iterations;
    const firstIteration = Math.max(0, Math.floor(Math.max(0, -instance.delayMs) / instance.durationMs) - 1);
    const lastIteration = finiteIterations === null
      ? Math.max(firstIteration, Math.ceil(Math.max(0, durationMs - instance.delayMs) / instance.durationMs))
      : Math.ceil(finiteIterations);
    for (let iteration = firstIteration; iteration < lastIteration; iteration += 1) {
      const start = instance.delayMs + iteration * instance.durationMs;
      const iterationFraction = finiteIterations === null ? 1 : Math.min(1, finiteIterations - iteration);
      if (iterationFraction <= 0) continue;
      const end = start + iterationFraction * instance.durationMs;
      if (end < 0 || start > durationMs) continue;
      const forwards = iterationRunsForwards(instance.direction, iteration);
      const atProgress = (progress: number): number => start + (forwards ? progress : 1 - progress) * instance.durationMs;
      add(start, `${instance.applicationId}:iteration-start`);
      add(end, `${instance.applicationId}:iteration-end`);
      for (const [index, frame] of instance.keyframes.entries()) {
        const frameTime = atProgress(frame.offset);
        if (frameTime >= start && frameTime <= end) add(frameTime, `${instance.applicationId}:keyframe`);
        const next = instance.keyframes[index + 1];
        if (!next) continue;
        for (const fraction of stepTransitionFractions(frame.easing)) {
          const time = atProgress(frame.offset + (next.offset - frame.offset) * fraction);
          if (time >= start && time <= end) add(time, `${instance.applicationId}:segment-step`);
        }
        for (const property of instance.properties.filter((candidate) => candidate.classification === 'discrete' && frame.properties.includes(candidate.name) && next.properties.includes(candidate.name))) {
          if (frame.values[property.name] === next.values[property.name]) continue;
          const fraction = discretePropertyTransitionFraction(property.name, frame.values[property.name]!, next.values[property.name]!, frame.easing);
          const time = atProgress(frame.offset + (next.offset - frame.offset) * fraction);
          if (time >= start && time <= end) add(time, `${instance.applicationId}:discrete:${property.name}`);
        }
      }
      for (const fraction of stepTransitionFractions(instance.easing)) {
        const time = atProgress(fraction);
        if (time >= start && time <= end) add(time, `${instance.applicationId}:application-step`);
      }
    }
  }
  return [...boundaries].sort(([a], [b]) => a - b).map(([timeMs, reasons]) => ({ timeMs, reasons: [...reasons].sort() }));
}

export function discretePropertyTransitionFraction(property: string, fromValue: string, toValue: string, timing: string | CssTimingFunction): number {
  if (classifyAnimatedProperty(property) !== 'discrete' || !fromValue.trim() || !toValue.trim()) throw new Error('CSS_MOTION_PROPERTY_UNSUPPORTED');
  const from = fromValue.trim().toLowerCase(); const to = toValue.trim().toLowerCase();
  if (from === to) return 1;
  // CSS visibility interpolation keeps `visible` for the whole interval when
  // it is either endpoint: entering visible switches at the start; leaving it
  // switches at the end. Non-visible pairs use ordinary discrete timing.
  if (property.trim().toLowerCase() === 'visibility') {
    if (to === 'visible') return 0;
    if (from === 'visible') return 1;
  }
  return discreteTransitionFraction(timing);
}

function iterationRunsForwards(direction: SemanticAnimationInstance['direction'], iteration: number): boolean {
  if (direction === 'normal') return true;
  if (direction === 'reverse') return false;
  const even = iteration % 2 === 0;
  return direction === 'alternate' ? even : !even;
}

export function expandBoundarySamples(boundaries: readonly MotionEvidenceBoundary[], durationMs: number, epsilonMs = 1): MotionEvidenceBoundary[] {
  if (!Number.isFinite(epsilonMs) || epsilonMs <= 0) throw new Error('CSS_MOTION_SCHEDULE_INVALID');
  const samples = new Map<number, Set<string>>();
  for (const boundary of boundaries) for (const [delta, suffix] of [[-epsilonMs, 'before'], [0, 'at'], [epsilonMs, 'after']] as const) {
    const time = normalizeTime(boundary.timeMs + delta);
    if (time < 0 || time > durationMs) continue;
    const reasons = samples.get(time) ?? new Set<string>();
    boundary.reasons.forEach((reason) => reasons.add(`${reason}:${suffix}`)); samples.set(time, reasons);
  }
  return [...samples].sort(([a], [b]) => a - b).map(([timeMs, reasons]) => ({ timeMs, reasons: [...reasons].sort() }));
}

export function splitCssTimingFunction(timingInput: CssTimingFunction, timeFraction: number): { progress: number; before: CssTimingFunction; after: CssTimingFunction } {
  const timing = normalizeCssTimingFunction(timingInput);
  if (!Number.isFinite(timeFraction) || timeFraction <= 0 || timeFraction >= 1) throw new Error('CSS_MOTION_SPLIT_INVALID');
  if (timing.kind === 'keyword' && timing.value === 'linear') return { progress: timeFraction, before: timing, after: timing };
  const points = timing.kind === 'cubic-bezier' ? [timing.x1, timing.y1, timing.x2, timing.y2] as const
    : timing.kind === 'keyword' && timing.value === 'ease-in-out' ? [0.42, 0, 0.58, 1] as const : null;
  if (!points) throw new Error('CSS_MOTION_SPLIT_UNSUPPORTED');
  let low = 0; let high = 1;
  for (let iteration = 0; iteration < 60; iteration += 1) {
    const mid = (low + high) / 2; const inverse = 1 - mid;
    const value = 3 * inverse * inverse * mid * points[0] + 3 * inverse * mid * mid * points[2] + mid * mid * mid;
    if (value < timeFraction) low = mid; else high = mid;
  }
  const parameter = (low + high) / 2; const lerp = (from: number, to: number): number => from + (to - from) * parameter;
  const [x1, y1, x2, y2] = points;
  const ax = lerp(0, x1); const ay = lerp(0, y1); const bx = lerp(x1, x2); const by = lerp(y1, y2);
  const cx = lerp(x2, 1); const cy = lerp(y2, 1); const dx = lerp(ax, bx); const dy = lerp(ay, by);
  const ex = lerp(bx, cx); const ey = lerp(by, cy); const splitX = lerp(dx, ex); const splitY = lerp(dy, ey);
  return {
    progress: splitY,
    before: { kind: 'cubic-bezier', x1: ax / splitX, y1: ay / splitY, x2: dx / splitX, y2: dy / splitY },
    after: { kind: 'cubic-bezier', x1: (ex - splitX) / (1 - splitX), y1: (ey - splitY) / (1 - splitY), x2: (cx - splitX) / (1 - splitX), y2: (cy - splitY) / (1 - splitY) },
  };
}

function keywordBezier(value: Extract<CssTimingFunction, { kind: 'keyword' }>['value']): readonly [number, number, number, number] | null {
  if (value === 'linear') return null;
  if (value === 'ease') return [0.25, 0.1, 0.25, 1];
  if (value === 'ease-in') return [0.42, 0, 1, 1];
  if (value === 'ease-out') return [0, 0, 0.58, 1];
  return [0.42, 0, 0.58, 1];
}

function cubic(parameter: number, first: number, second: number): number {
  const inverse = 1 - parameter;
  return 3 * inverse * inverse * parameter * first + 3 * inverse * parameter * parameter * second + parameter * parameter * parameter;
}

function normalizeTime(value: number): number { return Math.round(value * 1_000_000) / 1_000_000; }
function formatNumber(value: number): string { return Object.is(value, -0) ? '0' : String(value); }
