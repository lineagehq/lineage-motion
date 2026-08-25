import { createHash } from 'node:crypto';

import { describe, expect, test } from 'vitest';

import {
  CSS_MOTION_SEMANTICS_VERSION, applicationInstanceId, classifyAnimatedProperty,
  deriveMotionEvidenceBoundaries, expandBoundarySamples, normalizeAnimationInstance,
  discreteTransitionFraction, evaluateCssTimingProgress, parseCssTimingFunction,
  discretePropertyTransitionFraction, serializeCssTimingFunction, splitCssTimingFunction, stepTransitionFractions,
} from './css-motion-semantics.js';
import { sha256Hex } from './sha256.js';

describe('motion.css-motion-semantics.v1', () => {
  test('normalizes only the registered timing grammar', () => {
    expect(CSS_MOTION_SEMANTICS_VERSION).toBe('motion.css-motion-semantics.v1');
    expect(parseCssTimingFunction('steps(2, jump-none)')).toEqual({ kind: 'steps', count: 2, position: 'jump-none' });
    expect(serializeCssTimingFunction(parseCssTimingFunction('cubic-bezier(.1, -2, .9, 3)'))).toBe('cubic-bezier(0.1, -2, 0.9, 3)');
    expect(() => parseCssTimingFunction('frames(3)')).toThrow('CSS_MOTION_TIMING_UNSUPPORTED');
    expect(() => parseCssTimingFunction('steps(1, jump-none)')).toThrow('CSS_MOTION_TIMING_UNSUPPORTED');
    expect(() => parseCssTimingFunction('cubic-bezier(-.1, 0, 1, 1)')).toThrow('CSS_MOTION_TIMING_UNSUPPORTED');
    expect(splitCssTimingFunction({ kind: 'keyword', value: 'linear' }, 0.25).progress).toBe(0.25);
  });

  test('is the exact authority for every supported step position and discrete switch', () => {
    expect(stepTransitionFractions('steps(3, jump-none)')).toEqual([1 / 3, 2 / 3]);
    expect(stepTransitionFractions('steps(2, jump-both)')).toEqual([0, 0.5, 1]);
    expect(evaluateCssTimingProgress('steps(2, jump-start)', 0)).toBe(0.5);
    expect(evaluateCssTimingProgress('steps(2, jump-end)', 0)).toBe(0);
    expect(evaluateCssTimingProgress('steps(3, jump-none)', 1 / 3)).toBe(0.5);
    expect(evaluateCssTimingProgress('steps(2, jump-both)', 0.5)).toBe(2 / 3);
    expect(discreteTransitionFraction('steps(3, jump-none)')).toBe(1 / 3);
    expect(discreteTransitionFraction('linear')).toBe(0.5);
    expect(discreteTransitionFraction('ease-in')).toBeGreaterThan(0.5);
  });

  test('uses a closed property registry and source-provenance application identity', () => {
    expect(classifyAnimatedProperty('opacity')).toBe('continuous');
    // Value-dependent discrete properties are deliberately outside the closed
    // registry until their endpoint semantics can be represented exactly.
    expect(classifyAnimatedProperty('visibility')).toBe('discrete');
    expect(classifyAnimatedProperty('display')).toBeNull();
    expect(classifyAnimatedProperty('content')).toBeNull();
    expect(discretePropertyTransitionFraction('visibility', 'hidden', 'visible', 'linear')).toBe(0);
    expect(discretePropertyTransitionFraction('visibility', 'visible', 'hidden', 'linear')).toBe(1);
    expect(discretePropertyTransitionFraction('visibility', 'hidden', 'collapse', 'linear')).toBe(0.5);
    expect(classifyAnimatedProperty('--private-motion')).toBeNull();
    expect(applicationInstanceId('node_a', 'rule_a', 'source_a')).toBe('application_79fd5504311ec2c13f9612f9');
    expect(applicationInstanceId('node_a', 'rule_a', 'source_a')).not.toBe(applicationInstanceId('node_a', 'rule_a', 'source_b'));
  });

  test.each(['', 'abc', 'Neutral motion \u2603'])('uses the browser-safe SHA-256 with Node parity', (value) => {
    expect(sha256Hex(value)).toBe(createHash('sha256').update(value).digest('hex'));
  });

  test('derives exact application, segment, discrete, iteration, and before/at/after evidence', () => {
    const instance = normalizeAnimationInstance({
      applicationId: applicationInstanceId('node_a', 'rule_a', 'source_a'), targetId: 'node_a', ruleId: 'rule_a',
      timeline: 'document', composition: 'replace', durationMs: 100, delayMs: 10, iterations: 1,
      direction: 'normal', fill: 'both', playState: 'running', easing: 'steps(2, end)',
      properties: ['opacity', 'visibility'], keyframes: [
        { offset: 0, easing: 'steps(2, jump-both)', properties: ['opacity', 'visibility'], values: { visibility: 'visible' } },
        { offset: 1, easing: 'linear', properties: ['opacity', 'visibility'], values: { visibility: 'hidden' } },
      ],
    });
    const boundaries = deriveMotionEvidenceBoundaries([instance], 120);
    expect(boundaries.some((boundary) => boundary.reasons.some((reason) => reason.endsWith(':segment-step')))).toBe(true);
    expect(boundaries.some((boundary) => boundary.reasons.some((reason) => reason.endsWith(':application-step')))).toBe(true);
    expect(boundaries.some((boundary) => boundary.reasons.some((reason) => reason.endsWith(':discrete:visibility')))).toBe(true);
    const samples = expandBoundarySamples(boundaries, 120, 1);
    expect(samples.some((sample) => sample.reasons.some((reason) => reason.endsWith(':before')))).toBe(true);
    expect(samples.some((sample) => sample.reasons.some((reason) => reason.endsWith(':at')))).toBe(true);
    expect(samples.some((sample) => sample.reasons.some((reason) => reason.endsWith(':after')))).toBe(true);
  });

  test('maps boundaries through direction, delay, and fractional iteration duration', () => {
    const make = (direction: 'normal' | 'reverse' | 'alternate' | 'alternate-reverse', iterations: number | 'infinite', delayMs = 0) => normalizeAnimationInstance({
      applicationId: `application_${direction.replace('-', '_')}`, targetId: 'node_a', ruleId: 'rule_a',
      timeline: 'document' as const, composition: 'replace' as const, durationMs: 1000, delayMs, iterations,
      direction, fill: 'both' as const, playState: 'running' as const, easing: 'steps(4, end)',
      properties: ['opacity'], keyframes: [
        { offset: 0, easing: 'steps(4, end)', properties: ['opacity'] },
        { offset: 1, easing: 'linear', properties: ['opacity'] },
      ],
    });
    const times = (direction: Parameters<typeof make>[0], iterations: number | 'infinite', duration: number, delay = 0) => deriveMotionEvidenceBoundaries([make(direction, iterations, delay)], duration)
      .filter((item) => item.reasons.some((reason) => reason.endsWith(':application-step')))
      .map((item) => item.timeMs);

    expect(times('normal', 1, 1000)).toEqual([250, 500, 750, 1000]);
    expect(times('reverse', 1, 1000)).toEqual([0, 250, 500, 750]);
    expect(times('alternate', 2, 2000)).toEqual([250, 500, 750, 1000, 1250, 1500, 1750]);
    expect(times('alternate-reverse', 2, 2000)).toEqual([0, 250, 500, 750, 1250, 1500, 1750, 2000]);
    expect(times('normal', 1.5, 2000, 100)).toEqual([350, 600, 850, 1100, 1350, 1600]);
    expect(times('reverse', 1.5, 2000, 100)).toEqual([100, 350, 600, 850, 1100, 1350, 1600]);
    expect(times('alternate', 'infinite', 2500, -1250)).toEqual([0, 250, 500, 1000, 1250, 1500, 1750, 2000, 2250, 2500]);
  });

  test('rejects non-document timelines, additive composition, incomplete endpoints, and unknown properties', () => {
    const base = {
      applicationId: 'application_a', targetId: 'node_a', ruleId: 'rule_a', timeline: 'document' as const,
      composition: 'replace' as const, durationMs: 100, delayMs: 0, iterations: 1, direction: 'normal' as const,
      fill: 'both' as const, playState: 'running' as const, easing: 'linear', properties: ['opacity'],
      keyframes: [{ offset: 0, easing: 'linear', properties: ['opacity'] }, { offset: 1, easing: 'linear', properties: ['opacity'] }],
    };
    expect(() => normalizeAnimationInstance({ ...base, timeline: 'scroll' as never })).toThrow('CSS_MOTION_INSTANCE_UNSUPPORTED');
    expect(() => normalizeAnimationInstance({ ...base, composition: 'add' as never })).toThrow('CSS_MOTION_INSTANCE_UNSUPPORTED');
    expect(() => normalizeAnimationInstance({ ...base, properties: ['unknown'] })).toThrow('CSS_MOTION_PROPERTY_UNSUPPORTED');
    expect(() => normalizeAnimationInstance({ ...base, properties: ['display'] })).toThrow('CSS_MOTION_PROPERTY_UNSUPPORTED');
    expect(() => normalizeAnimationInstance({ ...base, properties: ['visibility'], keyframes: base.keyframes.map((frame) => ({ ...frame, properties: ['visibility'] })) })).toThrow('CSS_MOTION_KEYFRAME_UNSUPPORTED');
    expect(() => normalizeAnimationInstance({ ...base, keyframes: base.keyframes.slice(1) })).toThrow('CSS_MOTION_KEYFRAME_UNSUPPORTED');
  });
});
