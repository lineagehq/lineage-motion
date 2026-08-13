import { readFile } from 'node:fs/promises';
import { describe, expect, test } from 'vitest';

import { importMotionHtml } from '../../css-import/src/index.js';
import { createAuthoringState, dispatchAuthoringOperation } from '../../domain/src/index.js';
import { buildTimeline } from './index.js';

describe('read-only master timeline', () => {
  test('projects the approved hold while preserving source identities and exact later story times', async () => {
    const imported = importMotionHtml(await readFile(
      new URL('../../../fixtures/public-synthetic/preview.html', import.meta.url), 'utf8'));
    imported.document!.cues = [
      { schemaVersion: 'motion.cue.v1', id: 'cue_pair', label: 'Pair crosses', timeMs: 2870 },
      { schemaVersion: 'motion.cue.v1', id: 'cue_hold', label: 'Hold inspected', timeMs: 4310 },
      { schemaVersion: 'motion.cue.v1', id: 'cue_rest', label: 'Rest', timeMs: 4660 },
    ];
    const initial = createAuthoringState(imported.document!);
    const held = dispatchAuthoringOperation(initial, {
      schemaVersion: 'motion.operation.v1', operationId: 'timeline:hold',
      documentId: initial.document.documentId, expectedRevision: 0,
      kind: 'motion.hold.insert', payload: { cueId: 'cue_pair', durationMs: 600 },
    });
    expect(held.ok).toBe(true); if (!held.ok) throw new Error(held.diagnostic.code);
    const before = buildTimeline(initial.document);
    const after = buildTimeline(held.state.document);
    expect(after.durationMs).toBe(5260);
    expect(after.holds).toEqual(held.state.document.holds);
    expect(after.cues.map((cue) => cue.timeMs)).toEqual([3470, 4910, 5260]);
    expect(after.rows.map((row) => row.trackId)).toEqual(before.rows.map((row) => row.trackId));
    const reveal = after.rows.find((row) => row.property === 'opacity')!;
    expect(reveal.keyframes.at(-1)!.timeMs).toBe(2520);
    const crossingEnds = after.rows.filter((row) => row.keyframes.at(-1)!.timeMs > 2870)
      .map((row) => row.keyframes.at(-1)!.timeMs).sort((a, b) => a - b);
    expect(crossingEnds).toEqual([4320, 4810, 5260, 5260]);
  });

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

  test('projects the selected Orb opacity bundle without losing existing rows', async () => {
    const imported = importMotionHtml(await readFile(
      new URL('../../../fixtures/public-synthetic/preview.html', import.meta.url), 'utf8'));
    const initial = createAuthoringState(imported.document!);
    const created = dispatchAuthoringOperation(initial, {
      schemaVersion: 'motion.operation.v1', operationId: 'timeline:orb',
      documentId: initial.document.documentId, expectedRevision: 0,
      kind: 'motion.track.create', elementId: 'el_2dbee68b1ea318c8',
      payload: { property: 'opacity', durationMs: 1000, delayMs: 610,
        easing: 'linear', startValue: 0, endValue: 1 },
    });
    expect(created.ok).toBe(true); if (!created.ok) throw new Error(created.diagnostic.code);
    const before = buildTimeline(initial.document);
    const after = buildTimeline(created.state.document);
    expect(after.rows).toHaveLength(before.rows.length + 1);
    expect(after.rows.find((row) => row.elementId === 'el_2dbee68b1ea318c8'
      && row.property === 'opacity')).toMatchObject({ delayMs: 610,
      keyframes: [{ offset: 0, timeMs: 610 }, { offset: 1, timeMs: 1610 }] });
    expect(new Set(after.rows.slice(0, before.rows.length).map((row) => row.trackId)))
      .toEqual(new Set(before.rows.map((row) => row.trackId)));
  });
});
