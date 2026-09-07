import { expect, test } from 'vitest';
import { applySequenceEdit, sequenceDocumentSchema, sequenceDuration, type SequenceDocument } from './sequence.ts';
const initial: SequenceDocument = { schemaVersion: 'motion.sequence.v1', projectId: 'project', sequenceId: 'sequence',
  revision: 0, name: 'Animation', viewport: { widthCssPixels: 320, heightCssPixels: 180 },
  finalState: 'last-shot-native-end', reducedMotion: 'source-snapshots-with-hard-cuts', clips: [
    { clipId: 'a', name: 'Opening', endHoldMs: 0, source: { documentId: 'shot_a', revision: 2, canonicalDigest: 'a'.repeat(64), durationMs: 2000 } },
    { clipId: 'b', name: 'Ending', endHoldMs: 0, source: { documentId: 'shot_b', revision: 1, canonicalDigest: 'b'.repeat(64), durationMs: 3000 } },
  ] };
test('duplicate metadata and reference edits never change the original or reorder shot-local timing', () => {
  const before = structuredClone(initial);
  const copy = applySequenceEdit(initial, { kind: 'clip.duplicate', clipId: 'a', newClipId: 'copy', name: 'Alternate' });
  const held = applySequenceEdit(copy, { kind: 'clip.hold', clipId: 'copy', endHoldMs: 500 });
  const updated = applySequenceEdit(held, { kind: 'clip.update-source', clipId: 'copy',
    source: { ...initial.clips[1]!.source } });
  const reordered = applySequenceEdit(updated, { kind: 'clip.move', clipId: 'copy', index: 2 });
  expect(initial).toEqual(before);
  expect(reordered.clips.map(clip => clip.clipId)).toEqual(['a', 'b', 'copy']);
  expect(reordered.clips[0]).toEqual(before.clips[0]);
  expect(reordered.clips[2]).toMatchObject({ endHoldMs: 500, source: initial.clips[1]!.source });
  expect(sequenceDuration(reordered)).toBe(8500);
});
test('invalid IDs, out-of-range ordering and overflowing time cannot become sequence content', () => {
  expect(() => applySequenceEdit(initial, { kind: 'clip.duplicate', clipId: 'a', newClipId: 'b', name: 'Duplicate' })).toThrow();
  expect(() => applySequenceEdit(initial, { kind: 'clip.move', clipId: 'a', index: 2 })).toThrow('SEQUENCE_INDEX_INVALID');
  expect(() => applySequenceEdit(initial, { kind: 'clip.remove', clipId: 'missing' })).toThrow('SEQUENCE_CLIP_NOT_FOUND');
  expect(() => applySequenceEdit(initial, { kind: 'clip.hold', clipId: 'a', endHoldMs: Number.MAX_SAFE_INTEGER })).toThrow();
  expect(sequenceDocumentSchema.safeParse({ ...initial, clips: [{ ...initial.clips[0], source: { ...initial.clips[0]!.source, durationMs: 0 } }] }).success).toBe(false);
  expect(sequenceDocumentSchema.safeParse({ ...initial, viewport: { widthCssPixels: 320.5, heightCssPixels: 180 } }).success).toBe(false);
});
