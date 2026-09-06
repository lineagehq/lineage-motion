import { describe, expect, test } from 'vitest';
import { importMotionHtml } from '../../css-import/src/index.js';
import { compileMotionDocument } from '../../css-compiler/src/index.js';
import { canonicalContentBytes, sha256Hex } from '../../domain/src/index.js';
import { runHoldRippleVisualProof } from './index.js';

const source = `<!doctype html><html><head><style>
html,body { margin:0; width:240px; height:180px; background:white; }
div { position:absolute; width:30px; height:30px; left:20px; }
.middle { top:20px; background:blue; animation:travel 2000ms linear both; }
.start { top:70px; background:red; animation:appear 1000ms linear 1000ms none; }
.end { top:120px; background:green; animation:leave 1000ms linear none; }
@keyframes travel { 0% { transform:translateX(0px); } 50% { transform:translateX(60px); } 100% { transform:translateX(120px); } }
@keyframes appear { from { opacity:0.25; } to { opacity:1; } }
@keyframes leave { from { opacity:1; } to { opacity:0.1; } }
</style></head><body><div class="middle"></div><div class="start"></div><div class="end"></div></body></html>`;

describe('hold at an exact CSS keyframe and active-interval boundary', () => {
  test.each([false, true])('preserves boundary/fill behavior and all bindings (shared element: %s)', async (sharedElement) => {
    const imported = importMotionHtml(source);
    expect(imported.document).not.toBeNull();
    expect(imported.inventory.unsupportedCount).toBe(0);
    expect(imported.inventory.missingCount).toBe(0);
    const document = imported.document!;
    if (sharedElement) {
      const movement = document.applications.find((application) => application.slots.some((slot) =>
        document.rules.find((rule) => rule.id === slot.ruleId)?.tracks.some((track) => track.property === 'transform')))!;
      const fade = document.applications.find((application) => application !== movement)!;
      // One element may be bound by distinct applications. Both animations must
      // survive compilation; a later animation declaration must not replace one.
      fade.bindings.push({ ...structuredClone(fade.bindings[0]!), elementId: movement.bindings[0]!.elementId });
      const expanded = document.tracks.filter((track) => fade.slots.some((slot) => slot.id === track.slotId));
      document.tracks.push(...expanded.map((track) => ({ ...structuredClone(track),
        id: `shared_${track.id}`, elementId: movement.bindings[0]!.elementId })));
      document.inventory.trackCount += expanded.length;
      document.inventory.supportedCount += expanded.length;
    }
    document.cues = [{ schemaVersion: 'motion.cue.v1', id: 'chosen-boundary', label: 'Pause here', timeMs: 1000 }];
    const baseline = compileMotionDocument(document);
    const heldDocument = structuredClone(document);
    heldDocument.revision = 1; heldDocument.durationMs += 500;
    heldDocument.cues[0] = { schemaVersion: 'motion.cue.v1', id: 'chosen-boundary', label: 'Pause here', timeMs: 1500 };
    heldDocument.holds = [{ schemaVersion: 'motion.hold.v1', id: 'boundary-hold', cueId: 'chosen-boundary', sourceTimeMs: 1000, durationMs: 500 }];
    const held = compileMotionDocument(heldDocument);
    const samples = [
      { label: 'before', sourceTimeMs: 500, storyTimeMs: 500 },
      { label: 'boundary-minus-1', sourceTimeMs: 999, storyTimeMs: 999 },
      { label: 'boundary', sourceTimeMs: 1000, storyTimeMs: 1000 },
      { label: 'hold-interior', sourceTimeMs: 1000, storyTimeMs: 1250 },
      { label: 'hold-end-minus-1', sourceTimeMs: 1000, storyTimeMs: 1499 },
      { label: 'hold-end', sourceTimeMs: 1000, storyTimeMs: 1500 },
      { label: 'hold-end-plus-1', sourceTimeMs: 1001, storyTimeMs: 1501 },
      { label: 'after', sourceTimeMs: 1500, storyTimeMs: 2000 },
      { label: 'final', sourceTimeMs: 2000, storyTimeMs: 2500 },
    ];
    const proof = await runHoldRippleVisualProof({ baselineHtml: baseline.html, heldHtml: held.html,
      samples, viewport: { width: 240, height: 180 } });
    expect(proof.samples.map(({ label, changedPixels }) => ({ label, changedPixels })))
      .toEqual(samples.map(({ label }) => ({ label, changedPixels: 0 })));
    expect(proof.passed).toBe(true);
    expect(proof.repeatedRunStable).toBe(true);
    const runs = [0, 1, 2].map(() => compileMotionDocument(heldDocument));
    expect(runs.map((run) => run.exportDigest)).toEqual(Array(3).fill(held.exportDigest));
    expect(held.receipt.sourceDigest).toBe(imported.inventory.sourceDigest);
    expect(sha256Hex(canonicalContentBytes(heldDocument))).not.toBe(sha256Hex(canonicalContentBytes(document)));
  }, 120_000);
});


test('a pause preserves independent easing for properties with different segment boundaries', async () => {
  const imported = importMotionHtml(`<!doctype html><html><head><style>
    html,body{margin:0;width:240px;height:180px;background:white}
    .box{width:30px;height:30px;background:blue;animation:a 2000ms ease-in-out both}
    @keyframes a{0%{transform:translateX(0px);opacity:0}50%{opacity:1}100%{transform:translateX(200px);opacity:0}}
    </style></head><body><div class="box"></div></body></html>`);
  expect(imported.inventory.unsupportedCount).toBe(0);
  expect(imported.inventory.missingCount).toBe(0);
  const baseline = imported.document!;
  baseline.cues = [{ schemaVersion: 'motion.cue.v1', id: 'pause', label: 'Pause', timeMs: 750 }];
  const held = structuredClone(baseline); held.revision = 1; held.durationMs += 500;
  held.cues[0]!.timeMs += 500;
  held.holds = [{ schemaVersion: 'motion.hold.v1', id: 'hold', cueId: 'pause', sourceTimeMs: 750, durationMs: 500 }];
  const samples = [0, 250, 500, 749, 750, 1000, 1249, 1250, 1251, 1500, 2000, 2500].map((storyTimeMs) => ({
    label: `story-${storyTimeMs}`, storyTimeMs,
    sourceTimeMs: storyTimeMs < 750 ? storyTimeMs : storyTimeMs <= 1250 ? 750 : storyTimeMs - 500,
  }));
  const proof = await runHoldRippleVisualProof({ baselineHtml: compileMotionDocument(baseline).html,
    heldHtml: compileMotionDocument(held).html, samples, viewport: { width: 240, height: 180 } });
  expect(proof.samples.map(({ changedPixels }) => changedPixels)).toEqual(samples.map(() => 0));
  expect(proof.passed).toBe(true); expect(proof.repeatedRunStable).toBe(true);
}, 120_000);
