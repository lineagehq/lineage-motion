import { z } from 'zod';
import { canonicalJson } from './canonical.ts';
import { sha256Hex } from './sha256.ts';

export const sequenceIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
export const sequenceIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const sequenceNameSchema = z.string().trim().min(1).max(120);
export const sequenceDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const sequenceViewportSchema = z.object({
  widthCssPixels: z.number().int().min(1).max(8192),
  heightCssPixels: z.number().int().min(1).max(8192),
}).strict();
export const sequenceSourceSchema = z.object({ documentId: sequenceIdSchema,
  revision: sequenceIntegerSchema, canonicalDigest: sequenceDigestSchema,
  durationMs: sequenceIntegerSchema.refine(value => value > 0),
}).strict();
export const sequenceClipSchema = z.object({ clipId: sequenceIdSchema, name: sequenceNameSchema,
  source: sequenceSourceSchema, endHoldMs: sequenceIntegerSchema,
}).strict();
export const sequenceDocumentSchema = z.object({ schemaVersion: z.literal('motion.sequence.v1'),
  projectId: sequenceIdSchema, sequenceId: sequenceIdSchema, revision: sequenceIntegerSchema,
  name: sequenceNameSchema, viewport: sequenceViewportSchema,
  finalState: z.literal('last-shot-native-end'), reducedMotion: z.literal('source-snapshots-with-hard-cuts'),
  clips: z.array(sequenceClipSchema).max(100),
}).strict().superRefine((document, context) => {
  if (new Set(document.clips.map(clip => clip.clipId)).size !== document.clips.length)
    context.addIssue({ code: 'custom', message: 'SEQUENCE_DUPLICATE_CLIP_ID' });
  if (!Number.isSafeInteger(document.clips.reduce((sum, clip) => sum + clip.source.durationMs + clip.endHoldMs, 0)))
    context.addIssue({ code: 'custom', message: 'SEQUENCE_DURATION_OVERFLOW' });
});
export type SequenceDocument = z.infer<typeof sequenceDocumentSchema>;
export type SequenceClip = z.infer<typeof sequenceClipSchema>;
export type SequenceSource = z.infer<typeof sequenceSourceSchema>;
export type SequenceViewport = z.infer<typeof sequenceViewportSchema>;

export const sequenceEditSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('sequence.rename'), name: sequenceNameSchema }).strict(),
  z.object({ kind: z.literal('clip.add'), clip: sequenceClipSchema, index: sequenceIntegerSchema }).strict(),
  z.object({ kind: z.literal('clip.duplicate'), clipId: sequenceIdSchema,
    newClipId: sequenceIdSchema, name: sequenceNameSchema }).strict(),
  z.object({ kind: z.literal('clip.remove'), clipId: sequenceIdSchema }).strict(),
  z.object({ kind: z.literal('clip.move'), clipId: sequenceIdSchema, index: sequenceIntegerSchema }).strict(),
  z.object({ kind: z.literal('clip.rename'), clipId: sequenceIdSchema, name: sequenceNameSchema }).strict(),
  z.object({ kind: z.literal('clip.hold'), clipId: sequenceIdSchema, endHoldMs: sequenceIntegerSchema }).strict(),
  z.object({ kind: z.literal('clip.update-source'), clipId: sequenceIdSchema, source: sequenceSourceSchema }).strict(),
]);
export type SequenceEdit = z.infer<typeof sequenceEditSchema>;
export function sequenceDigest(document: SequenceDocument): string {
  return sha256Hex(canonicalJson(sequenceDocumentSchema.parse(document)));
}
export function sequenceDuration(document: SequenceDocument): number {
  return document.clips.reduce((sum, clip) => sum + clip.source.durationMs + clip.endHoldMs, 0);
}
/** Produces content only; revision assignment and durable history belong to the service. */
export function applySequenceEdit(document: SequenceDocument, input: SequenceEdit): SequenceDocument {
  const edit = sequenceEditSchema.parse(input);
  const next = structuredClone(sequenceDocumentSchema.parse(document));
  if (edit.kind === 'sequence.rename') next.name = edit.name;
  else if (edit.kind === 'clip.add') {
    if (edit.index > next.clips.length) throw new Error('SEQUENCE_INDEX_INVALID');
    next.clips.splice(edit.index, 0, edit.clip);
  } else {
    const index = next.clips.findIndex(clip => clip.clipId === edit.clipId);
    if (index < 0) throw new Error('SEQUENCE_CLIP_NOT_FOUND');
    const clip = next.clips[index]!;
    switch (edit.kind) {
      case 'clip.duplicate': next.clips.splice(index + 1, 0, { ...structuredClone(clip), clipId: edit.newClipId, name: edit.name }); break;
      case 'clip.remove': next.clips.splice(index, 1); break;
      case 'clip.move':
        if (edit.index >= next.clips.length) throw new Error('SEQUENCE_INDEX_INVALID');
        next.clips.splice(index, 1); next.clips.splice(edit.index, 0, clip); break;
      case 'clip.rename': clip.name = edit.name; break;
      case 'clip.hold': clip.endHoldMs = edit.endHoldMs; break;
      case 'clip.update-source': clip.source = edit.source; break;
    }
  }
  return sequenceDocumentSchema.parse(next);
}
