import { canonicalBytes, canonicalJson, sha256Hex, type MotionDocument } from '../../domain/src/index.js';
import { sequenceDocumentSchema, sequenceDigest, sequenceDuration, type SequenceDocument, type SequenceSource } from '../../domain/src/sequence.js';
import { compileMotionDocument } from './index.js';
import { certifySequenceViewport } from './sequence-viewport.js';
import { sequenceImageAssets } from './sequence-runtime-assets.js';
import { SEQUENCE_RUNTIME } from './sequence-runtime.js';

export type SequenceCompilerReceipt = {
  schemaVersion: 'motion.sequence-compiler-receipt.v1'; compilerVersion: 'sequence-compiler.v1';
  projectId: string; sequenceId: string; revision: number; canonicalDigest: string; exportDigest: string;
  durationMs: number; viewport: SequenceDocument['viewport']; deterministic: true;
  sources: Array<{ clipId: string; source: SequenceSource; sourceDigest: string;
    compilerVersion: string; exportDigest: string; htmlDigest: string; cssDigest: string }>;
};
export type SequenceCompilerResult = { html: string; css: string; exportDigest: string; receipt: SequenceCompilerReceipt };
function attribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function safeTiming(document: MotionDocument): void {
  if (!Number.isSafeInteger(document.durationMs) || document.durationMs <= 0) throw new Error('SEQUENCE_SOURCE_DURATION_INVALID');
  for (const application of document.applications) for (const [index, slot] of application.slots.entries()) {
    if (slot.playState === 'paused') throw new Error('SEQUENCE_SOURCE_PAUSED_UNSUPPORTED');
    if (slot.iterationCount === 'infinite') throw new Error('SEQUENCE_SOURCE_INFINITE');
    if (!Number.isSafeInteger(slot.durationMs) || slot.durationMs < 0 || !Number.isSafeInteger(slot.delayMs)
      || !Number.isFinite(slot.iterationCount) || slot.iterationCount <= 0
      || !Number.isSafeInteger(slot.durationMs * slot.iterationCount)) throw new Error('SEQUENCE_SOURCE_TIMING_UNSAFE');
    for (const binding of application.bindings) {
      const delay = binding.delayOverridesMs[index];
      if (!Number.isSafeInteger(delay) || !Number.isSafeInteger(slot.durationMs * slot.iterationCount + delay!))
        throw new Error('SEQUENCE_SOURCE_TIMING_UNSAFE');
    }
  }
}
/** Pinned snapshots are inputs, never reads of mutable shot heads. No authored text enters the receipt. */
export function compileSequence(input: SequenceDocument, sources: MotionDocument[]): SequenceCompilerResult {
  const parsed = sequenceDocumentSchema.safeParse(input);
  if (!parsed.success) throw new Error('SEQUENCE_DOCUMENT_INVALID');
  const sequence = parsed.data;
  if (!sequence.clips.length) throw new Error('SEQUENCE_EMPTY');
  const receiptSources: SequenceCompilerReceipt['sources'] = [];
  const frames: string[] = [];
  const schedule: Array<{ clipId: string; startMs: number; endMs: number; durationMs: number; imageAssets: string[] }> = [];
  let offset = 0;
  for (const clip of sequence.clips) {
    const matches = sources.filter(source => source.documentId === clip.source.documentId && source.revision === clip.source.revision);
    if (!matches.length) throw new Error('SEQUENCE_SOURCE_MISSING');
    if (matches.some(source => sha256Hex(canonicalBytes(source)) !== clip.source.canonicalDigest)) throw new Error('SEQUENCE_SOURCE_DIGEST_MISMATCH');
    const source = matches[0]!;
    if (source.inventory.unsupportedCount !== 0 || source.inventory.missingCount !== 0)
      throw new Error('SEQUENCE_SOURCE_INVENTORY_INCOMPLETE');
    if (source.durationMs !== clip.source.durationMs) throw new Error('SEQUENCE_SOURCE_DURATION_MISMATCH');
    let compiled: ReturnType<typeof compileMotionDocument>;
    try { compiled = compileMotionDocument(source); }
    catch { throw new Error('SEQUENCE_SOURCE_UNSUPPORTED'); }
    safeTiming(source);
    const viewport = certifySequenceViewport(source);
    if (viewport.widthCssPixels !== sequence.viewport.widthCssPixels || viewport.heightCssPixels !== sequence.viewport.heightCssPixels)
      throw new Error('SEQUENCE_VIEWPORT_MISMATCH');
    schedule.push({ clipId: clip.clipId, startMs: offset, endMs: offset + source.durationMs + clip.endHoldMs, durationMs: source.durationMs, imageAssets: sequenceImageAssets(source.presentation.html, compiled.css) });
    offset += source.durationMs + clip.endHoldMs;
    frames.push(`<iframe data-sequence-clip="${attribute(clip.clipId)}" title="${attribute(clip.name)}" sandbox="allow-same-origin" aria-hidden="true" inert srcdoc="${attribute(compiled.html)}"></iframe>`);
    receiptSources.push({ clipId: clip.clipId, source: { ...clip.source }, sourceDigest: compiled.receipt.sourceDigest,
      compilerVersion: compiled.receipt.compilerVersion, exportDigest: compiled.exportDigest,
      htmlDigest: sha256Hex(compiled.html), cssDigest: sha256Hex(compiled.css) });
  }
  const { widthCssPixels: width, heightCssPixels: height } = sequence.viewport;
  const css = `html,body{margin:0;padding:0;width:${width}px;height:${height}px;overflow:hidden}\n.sequence-stage{position:relative;width:${width}px;height:${height}px;overflow:hidden}\niframe[data-sequence-clip]{position:absolute;inset:0;border:0;width:${width}px;height:${height}px;visibility:hidden}\n#sequence-error{position:absolute;inset:0;pointer-events:none}\n`;
  const config = canonicalJson({ durationMs: sequenceDuration(sequence), clips: schedule }).replace(/</g, '\\u003c');
  const html = `<!doctype html>\n<html><head><meta charset="utf-8"><title>${attribute(sequence.name)}</title><style>${css}</style></head><body><main class="sequence-stage" aria-label="${attribute(sequence.name)}">\n${frames.join('\n')}\n<output id="sequence-error" role="alert"></output></main><script type="application/json" id="sequence-config">${config}</script><script>${SEQUENCE_RUNTIME}</script></body></html>\n`;
  const exportDigest = sha256Hex(`${html}\0${css}`);
  return { html, css, exportDigest, receipt: { schemaVersion: 'motion.sequence-compiler-receipt.v1', compilerVersion: 'sequence-compiler.v1',
    projectId: sequence.projectId, sequenceId: sequence.sequenceId, revision: sequence.revision, canonicalDigest: sequenceDigest(sequence), exportDigest,
    durationMs: sequenceDuration(sequence), viewport: { ...sequence.viewport }, deterministic: true, sources: receiptSources } };
}
