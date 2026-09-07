import type { MotionDocument } from '../../domain/src/document.ts';
import { canonicalBytes } from '../../domain/src/canonical.ts';
import { sha256Hex } from '../../domain/src/sha256.ts';
import type { SequenceDocument } from '../../domain/src/sequence.ts';
import { compileSequence } from '../../css-compiler/src/sequence-compiler.ts';
import type { SequenceFailure } from '../../motion-protocol/src/sequence.ts';
import type { ProjectStore } from '../../project-store/src/index.ts';

export function resolveSequenceSources(store: Pick<ProjectStore, 'readRevision'>, sequence: SequenceDocument): MotionDocument[] {
  const sources: MotionDocument[] = [];
  for (const clip of sequence.clips) {
    const snapshot = store.readRevision(clip.source.documentId, clip.source.revision);
    if (!snapshot || snapshot.canonicalDigest !== clip.source.canonicalDigest
      || snapshot.document.durationMs !== clip.source.durationMs
      || sha256Hex(canonicalBytes(snapshot.document)) !== clip.source.canonicalDigest)
      throw new Error('SEQUENCE_SOURCE_MISMATCH');
    sources.push(snapshot.document);
  }
  return sources;
}
export function validateSequenceSources(store: Pick<ProjectStore, 'readRevision'>, sequence: SequenceDocument): SequenceFailure | null {
  if (!sequence.clips.length) return null;
  try { compileSequence(sequence, resolveSequenceSources(store, sequence)); return null; }
  catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message === 'SEQUENCE_SOURCE_MISMATCH') return { ok: false, code: 'SEQUENCE_SOURCE_MISMATCH' };
    if (message === 'SEQUENCE_VIEWPORT_MISMATCH') return { ok: false, code: 'SEQUENCE_VIEWPORT_MISMATCH' };
    return { ok: false, code: 'SEQUENCE_SOURCE_UNSUPPORTED',
      ...(/^SEQUENCE_[A-Z0-9_]{1,70}$/.test(message) ? { reasonCode: message } : {}) };
  }
}
