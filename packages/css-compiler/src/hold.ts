import { splitCssTimingFunction, type MotionDocument, type TimingFunction } from '../../domain/src/index.js';
import { canInterpolateHoldValues } from '../../domain/src/authoring-eligibility.js';
import { evaluateCssTimingProgress, stepTransitionFractions } from '../../domain/src/css-motion-semantics.js';
import { escapeCssString, formatOffset, formatTime, formatTimingFunction } from './format.js';

export function compileHoldProjection(document: MotionDocument): string[] {
  const hold = document.holds?.[0];
  if (!hold) return [];
  const output: string[] = [];
  const byElement = new Map<string, string[]>();
  let sequence = 0;
  for (const application of document.applications) {
    for (const binding of application.bindings) {
      const animations = byElement.get(binding.elementId) ?? [];
      for (const [slotIndex, slot] of application.slots.entries()) {
        const rule = document.rules.find((candidate) => candidate.id === slot.ruleId);
        const sourceDelay = binding.delayOverridesMs[slotIndex];
        if (!rule || sourceDelay === undefined) throw new Error('COMPILER_HOLD_RELATIONSHIP_INVALID');
        if (slot.iterationCount !== 1 || slot.durationMs <= 0 || slot.direction !== 'normal'
          || slot.playState !== 'running' || sourceDelay < 0) throw new Error('COMPILER_HOLD_TIMING_UNSUPPORTED');
        // Half-open active intervals preserve CSS fill at the end boundary.
        const activeAtBoundary = sourceDelay <= hold.sourceTimeMs && hold.sourceTimeMs < sourceDelay + slot.durationMs;
        const storyDelay = sourceDelay > hold.sourceTimeMs ? sourceDelay + hold.durationMs : sourceDelay;
        const storyDuration = slot.durationMs + (activeAtBoundary ? hold.durationMs : 0);
        // Split properties into separate animations: different source segments
        // require different split easing curves at the same generated offset.
        const groups = activeAtBoundary ? rule.tracks.map((track) => [track]) : [rule.tracks];
        for (const tracks of groups) {
          const generatedName = `motion_hold_${String(sequence++).padStart(4, '0')}`;
          animations.push([generatedName, formatTime(storyDuration),
            activeAtBoundary ? 'linear' : formatTimingFunction(slot.timingFunction), formatTime(storyDelay),
            String(slot.iterationCount), slot.direction, slot.fillMode, slot.playState].join(' '));
          output.push(activeAtBoundary ? compileWarpedKeyframes(
            generatedName, tracks, sourceDelay, slot.durationMs, storyDelay, storyDuration,
            slot.timingFunction, hold.sourceTimeMs, hold.durationMs,
          ) : compileUnwarpedKeyframes(generatedName, tracks));
        }
      }
      byElement.set(binding.elementId, animations);
    }
  }
  const bindings = [...byElement].map(([id, animations]) =>
    `[data-motion-id="${escapeCssString(id)}"] {\n  animation: ${animations.join(', ')};\n}`);
  return [...bindings, ...output];
}

function compileUnwarpedKeyframes(name: string, tracks: MotionDocument['rules'][number]['tracks']): string {
  const offsets = [...new Set(tracks.flatMap((track) => track.keyframes.map((frame) => frame.offset)))].sort((a, b) => a - b);
  const blocks = offsets.map((offset) => {
    const declarations: string[] = []; let easing: TimingFunction | undefined;
    for (const track of tracks) {
      const frame = track.keyframes.find((candidate) => candidate.offset === offset);
      if (!frame) continue;
      declarations.push(`    ${track.property}: ${frame.value};`); easing ??= frame.easing;
    }
    if (easing) declarations.push(`    animation-timing-function: ${formatTimingFunction(easing)};`);
    return `  ${formatOffset(offset)} {\n${declarations.join('\n')}\n  }`;
  });
  return `@keyframes ${name} {\n${blocks.join('\n')}\n}`;
}

type WarpedDeclaration = { property: string; value: string; easing?: TimingFunction };

function compileWarpedKeyframes(
  name: string,
  tracks: MotionDocument['rules'][number]['tracks'],
  sourceDelay: number,
  sourceDuration: number,
  storyDelay: number,
  storyDuration: number,
  slotEasing: TimingFunction,
  boundary: number,
  holdDuration: number,
): string {
  const blocks = new Map<number, WarpedDeclaration[]>();
  const add = (storyTime: number, declaration: WarpedDeclaration): void => {
    const offset = (storyTime - storyDelay) / storyDuration;
    const declarations = blocks.get(offset) ?? [];
    declarations.push(declaration);
    blocks.set(offset, declarations);
  };
  for (const track of tracks) {
    if (track.keyframes[0]?.offset !== 0 || track.keyframes.at(-1)?.offset !== 1)
      throw new Error('COMPILER_HOLD_IMPLICIT_ENDPOINT_UNSUPPORTED');
    const sourceFrames = track.keyframes.map((keyframe) => ({
      ...keyframe, timeMs: sourceDelay + keyframe.offset * sourceDuration,
    }));
    if (slotEasing.kind === 'steps' && sourceFrames.length === 2 && sourceFrames.every((frame) => !frame.easing)) {
      const [first, last] = sourceFrames as [typeof sourceFrames[number], typeof sourceFrames[number]];
      const fractions = [0, ...stepTransitionFractions(slotEasing), 1];
      const times = new Set(fractions.map((fraction) => first.timeMs + (last.timeMs - first.timeMs) * fraction));
      if (boundary > first.timeMs && boundary < last.timeMs) times.add(boundary);
      for (const timeMs of [...times].sort((a, b) => a - b)) {
        const progress = (timeMs - first.timeMs) / (last.timeMs - first.timeMs);
        const stepped = evaluateCssTimingProgress(slotEasing, progress);
        const value = interpolateCssValue(track.property, first.value, last.value, Math.min(1, stepped));
        const storyTime = warpTime(timeMs, boundary, holdDuration);
        add(storyTime, { property: track.property, value,
          easing: { kind: 'steps', count: 1, position: 'end' } });
        if (timeMs === boundary) add(storyTime - holdDuration,
          { property: track.property, value, easing: { kind: 'keyword', value: 'linear' } });
      }
      continue;
    }
    for (const [index, frame] of sourceFrames.entries()) {
      const next = sourceFrames[index + 1];
      add(warpTime(frame.timeMs, boundary, holdDuration), {
        property: track.property, value: frame.value, easing: frame.easing ?? slotEasing,
      });
      if (frame.timeMs === boundary) add(boundary, {
        property: track.property, value: frame.value, easing: { kind: 'keyword', value: 'linear' },
      });
      if (!next || boundary <= frame.timeMs || boundary >= next.timeMs) continue;
      const fraction = (boundary - frame.timeMs) / (next.timeMs - frame.timeMs);
      const easing = frame.easing ?? slotEasing;
      if (track.interpolation === 'continuous') {
        const split = splitCssTimingFunction(easing, fraction);
        const value = interpolateCssValue(track.property, frame.value, next.value, split.progress);
        const startOffset = (warpTime(frame.timeMs, boundary, holdDuration) - storyDelay) / storyDuration;
        const prior = blocks.get(startOffset)?.find((candidate) => candidate.property === track.property);
        if (prior) prior.easing = split.before;
        add(boundary, { property: track.property, value,
          easing: { kind: 'keyword', value: 'linear' } });
        add(boundary + holdDuration, { property: track.property, value, easing: split.after });
      } else {
        if (frame.value !== next.value) throw new Error('COMPILER_HOLD_INTERPOLATION_UNSUPPORTED');
        const value = valueAtDiscreteBoundary(sourceFrames, boundary);
        add(boundary, { property: track.property, value,
          easing: { kind: 'keyword', value: 'linear' } });
        add(boundary + holdDuration, { property: track.property, value, easing });
      }
    }
  }
  const rendered = [...blocks.entries()].sort(([a], [b]) => a - b).map(([offset, declarations]) => {
    const lines = declarations.map((declaration) => [
      `    ${declaration.property}: ${declaration.value};`,
      declaration.easing
        ? `    animation-timing-function: ${formatTimingFunction(declaration.easing)};` : '',
    ].filter(Boolean).join('\n'));
    return `  ${formatOffset(offset)} {\n${lines.join('\n')}\n  }`;
  });
  return `@keyframes ${name} {\n${rendered.join('\n')}\n}`;
}

function warpTime(timeMs: number, boundary: number, duration: number): number {
  return timeMs >= boundary ? timeMs + duration : timeMs;
}

function valueAtDiscreteBoundary(
  frames: Array<{ timeMs: number; value: string }>,
  boundary: number,
): string {
  return [...frames].reverse().find((frame) => frame.timeMs <= boundary)?.value ?? frames[0]!.value;
}

function interpolateCssValue(property: string, from: string, to: string, progress: number): string {
  if (from === to || progress === 0) return from;
  if (progress === 1) return to;
  if (!canInterpolateHoldValues(property, from, to)) throw new Error('COMPILER_HOLD_INTERPOLATION_UNSUPPORTED');
  const numberPattern = /-?(?:\d+\.?\d*|\.\d+)/g;
  const fromNumbers = [...from.matchAll(numberPattern)].map((match) => Number(match[0]));
  const toNumbers = [...to.matchAll(numberPattern)].map((match) => Number(match[0]));
  const fromShape = from.replace(numberPattern, '#');
  const toShape = to.replace(numberPattern, '#');
  if (fromShape !== toShape || fromNumbers.length !== toNumbers.length) {
    if (progress === 0) return from;
    if (progress === 1) return to;
    throw new Error('COMPILER_HOLD_INTERPOLATION_UNSUPPORTED');
  }
  let index = 0;
  return from.replace(numberPattern, () => String(
    fromNumbers[index]! + (toNumbers[index]! - fromNumbers[index++]!) * progress,
  ));
}

