import { z } from 'zod';
import { zipSync, strToU8 } from 'fflate';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { sha256Hex } from '../../domain/src/sha256.ts';
import { sequenceDigestSchema as digest, sequenceIdSchema as id, sequenceIntegerSchema as integer,
  sequenceSourceSchema, sequenceViewportSchema } from '../../domain/src/sequence.ts';
import { sequenceFailureSchema, sequenceReadRequestSchema, type SequenceFailure, type SequenceReadRequest } from './sequence.ts';
import type { RequestAuth } from './index.ts';

const receiptSchema = z.object({ schemaVersion: z.literal('motion.sequence-compiler-receipt.v1'),
  compilerVersion: z.literal('sequence-compiler.v1'), projectId: id, sequenceId: id, revision: integer,
  canonicalDigest: digest, exportDigest: digest, durationMs: integer.refine(value => value > 0),
  viewport: sequenceViewportSchema, deterministic: z.literal(true),
  sources: z.array(z.object({ clipId: id, source: sequenceSourceSchema, sourceDigest: digest,
    compilerVersion: z.string().min(1), exportDigest: digest, htmlDigest: digest, cssDigest: digest }).strict()).min(1),
}).strict();
const exportSchema = z.object({ ok: z.literal(true), schemaVersion: z.literal('motion.sequence-export.v1'),
  html: z.string().min(1), css: z.string().min(1), exportDigest: digest, receipt: receiptSchema }).strict();
export type SequenceExportBundle = z.infer<typeof exportSchema>;
export function validateSequenceExport(input: unknown): SequenceExportBundle {
  const bundle = exportSchema.parse(input);
  if (sha256Hex(`${bundle.html}\0${bundle.css}`) !== bundle.exportDigest || bundle.receipt.exportDigest !== bundle.exportDigest)
    throw new Error('SEQUENCE_EXPORT_DIGEST_MISMATCH');
  if (new Set(bundle.receipt.sources.map(source => source.clipId)).size !== bundle.receipt.sources.length)
    throw new Error('SEQUENCE_EXPORT_SOURCE_MISMATCH');
  return bundle;
}
export async function fetchSequenceExport(baseUrl: string, auth: RequestAuth, input: SequenceReadRequest,
  request: typeof fetch = fetch): Promise<SequenceExportBundle | SequenceFailure> {
  const command = sequenceReadRequestSchema.parse(input);
  const response = await request(`${baseUrl}/api/sequence/v1/export`, { method: 'POST', redirect: 'error', cache: 'no-store',
    headers: { authorization: `Bearer ${auth.capability}`, 'x-motion-actor': auth.actor, 'content-type': 'application/json' },
    body: canonicalJson(command) });
  const value: unknown = await response.json();
  if (response.status !== 200) return sequenceFailureSchema.parse(value);
  const bundle = validateSequenceExport(value);
  if (bundle.receipt.projectId !== command.projectId || bundle.receipt.sequenceId !== command.sequenceId
    || bundle.receipt.revision !== command.expectedRevision) throw new Error('SEQUENCE_EXPORT_IDENTITY_MISMATCH');
  return bundle;
}
/** Artifact bytes use explicit UTF-8 and fixed archive metadata across clients and machines. */
export function createSequenceExportArchive(input: SequenceExportBundle): Uint8Array {
  const bundle = validateSequenceExport(input);
  const html = `\uFEFF${bundle.html}`; const css = `\uFEFF${bundle.css}`;
  const receipt = { ...bundle.receipt, encoding: 'utf-8-bom', htmlDigest: sha256Hex(html), cssDigest: sha256Hex(css) };
  const options = { level: 0 as const, mtime: new Date(1980, 0, 1), os: 0, attrs: 0 };
  return zipSync({ 'animation.html': [strToU8(html), options], 'animation.css': [strToU8(css), options],
    'receipt.json': [strToU8(canonicalJson(receipt)), options] }, options);
}
