import { describe, expect, test } from 'vitest';

import { importMotionHtml } from '../../css-import/src/index.js';
import { buildTimeline } from './index.js';

describe('read-only master timeline', () => {
  test('accounts for every canonical track, keyframe, delay, simultaneous slot, step timing, and cue', () => {
    const imported = importMotionHtml(`<!doctype html><html><head><style>
      @keyframes reveal { from { opacity: 0; } to { opacity: 1; } }
      @keyframes travel { from { transform: translateX(0px); } to { transform: translateX(20px); } }
      .target { animation: reveal 1000ms steps(2, end) 250ms both, travel 1000ms linear 250ms both; }
    </style></head><body><div class="target"></div></body></html>`);
    expect(imported.document).not.toBeNull();

    imported.document!.cues = [
      { schemaVersion: 'motion.cue.v1', id: 'cue_start', label: 'Begin', timeMs: 0 },
      { schemaVersion: 'motion.cue.v1', id: 'cue_settle', label: 'Settle', timeMs: 1250 },
    ];
    imported.document!.reducedMotion.css = '.target { color: CanvasText; }';

    const timeline = buildTimeline(imported.document!);

    expect(timeline.schemaVersion).toBe('motion.timeline-projection.v1');
    expect(timeline.durationMs).toBe(1250);
    expect(timeline.rows).toHaveLength(2);
    expect(timeline.rows.map((row) => row.property).sort()).toEqual(['opacity', 'transform']);
    expect(timeline.rows.every((row) => row.delayMs === 250)).toBe(true);
    expect(timeline.rows.every((row) => row.orderedSlotIds.length === 2)).toBe(true);
    expect(timeline.rows.find((row) => row.property === 'opacity')?.timing).toEqual({
      kind: 'steps', count: 2, position: 'end',
    });
    const opacity = timeline.rows.find((row) => row.property === 'opacity')!;
    expect(opacity).toEqual(expect.objectContaining({
      ruleId: imported.document!.rules.find((rule) => rule.sourceName === 'reveal')!.id,
      activeSlotId: imported.document!.applications[0]!.slots[0]!.id,
      orderedSlotIds: imported.document!.applications[0]!.slots.map((slot) => slot.id),
      interpolation: 'step',
      delayMs: 250,
    }));
    expect(opacity.keyframes.map(({ offset, value, easing, timeMs }) => ({
      offset, value, easing, timeMs,
    }))).toEqual([
      { offset: 0, value: '0', easing: null, timeMs: 250 },
      { offset: 1, value: '1', easing: null, timeMs: 1250 },
    ]);
    expect(timeline.cues).toEqual([
      { schemaVersion: 'motion.cue.v1', id: 'cue_start', label: 'Begin', timeMs: 0 },
      { schemaVersion: 'motion.cue.v1', id: 'cue_settle', label: 'Settle', timeMs: 1250 },
    ]);
    expect(timeline.reducedMotion).toEqual({
      mode: 'source-snapshot', css: '.target { color: CanvasText; }',
    });
    expect(new Set(timeline.rows.map((row) => row.trackId))).toEqual(
      new Set(imported.document!.tracks.map((track) => track.id)),
    );
  });
});
