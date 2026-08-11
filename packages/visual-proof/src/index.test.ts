import { describe, expect, test } from 'vitest';

import { importMotionHtml } from '../../css-import/src/index.js';
import {
  assessBaselineStability,
  compareRgba,
  deriveSamplePlan,
} from './index.js';

describe('controlled visual proof primitives', () => {
  test('derives stable samples and both valid sides of every discrete/steps boundary', () => {
    const imported = importMotionHtml(`<!doctype html><html><head><style>
      @keyframes snap { 0% { visibility: hidden; } 50% { visibility: visible; } 100% { visibility: hidden; } }
      .target { animation: snap 100ms steps(2, end) 0ms both; }
    </style></head><body><div class="target"></div></body></html>`);
    expect(imported.document).not.toBeNull();

    const plan = deriveSamplePlan(imported.document!, [0, 25, 100]);

    expect(plan.boundaries.map((boundary) => boundary.timeMs)).toEqual([0, 25, 50, 75, 100]);
    expect(plan.sampleTimesMs).toEqual([0, 1, 24, 25, 26, 49, 51, 74, 76, 99, 100]);
    expect(plan.endpointHandling).toEqual([
      {
        boundaryTimeMs: 0,
        before: { status: 'out-of-range' },
        after: { status: 'sampled', timeMs: 1 },
      },
      {
        boundaryTimeMs: 25,
        before: { status: 'sampled', timeMs: 24 },
        after: { status: 'sampled', timeMs: 26 },
      },
      {
        boundaryTimeMs: 50,
        before: { status: 'sampled', timeMs: 49 },
        after: { status: 'sampled', timeMs: 51 },
      },
      {
        boundaryTimeMs: 75,
        before: { status: 'sampled', timeMs: 74 },
        after: { status: 'sampled', timeMs: 76 },
      },
      {
        boundaryTimeMs: 100,
        before: { status: 'sampled', timeMs: 99 },
        after: { status: 'out-of-range' },
      },
    ]);
  });

  test.each([
    ['end', [0, 25, 50, 75, 100]],
    ['jump-end', [0, 25, 50, 75, 100]],
    ['start', [0, 25, 50, 75, 100]],
    ['jump-start', [0, 25, 50, 75, 100]],
    ['jump-none', [0, 25, 50, 75, 100]],
    ['jump-both', [0, 25, 50, 75, 100]],
  ])('samples the %s step jumps and keyframe interval endpoints independently', (position, expected) => {
    const imported = importMotionHtml(`<!doctype html><html><head><style>
      @keyframes phased { 0% { opacity: 0; } 50% { opacity: .5; } 100% { opacity: 1; } }
      .target { animation: phased 100ms steps(2, ${position}) 0ms both; }
    </style></head><body><div class="target"></div></body></html>`);
    expect(imported.document).not.toBeNull();

    expect(deriveSamplePlan(imported.document!, []).boundaries.map((boundary) =>
      boundary.timeMs)).toEqual(expected);
  });

  test('counts exact changed pixels and maximum channel delta', () => {
    const baseline = Uint8Array.from([10, 20, 30, 255, 50, 60, 70, 255]);
    const candidate = Uint8Array.from([10, 20, 30, 255, 50, 80, 70, 255]);

    expect(compareRgba(baseline, candidate, 2, 1)).toEqual({
      width: 2,
      height: 1,
      changedPixels: 1,
      changedPixelRatio: 0.5,
      maximumChannelDelta: 20,
    });
  });

  test('requires equal corresponding hashes across all three baseline replays', () => {
    expect(assessBaselineStability([
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
      ['a', 'b', 'c'],
    ])).toEqual({ replayCount: 3, sampleCount: 3, correspondingHashesEqual: true });
    expect(assessBaselineStability([
      ['a', 'b', 'c'],
      ['a', 'changed', 'c'],
      ['a', 'b', 'c'],
    ]).correspondingHashesEqual).toBe(false);
  });
});
