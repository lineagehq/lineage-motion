import { z } from 'zod';
import { canonicalJson, sha256Hex } from '../../domain/src/index.ts';
import type { RequestAuth } from './index.ts';

const identity = z.string().min(1).max(128);
const revision = z.number().int().nonnegative().safe();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const exportRequestSchema = z.object({ schemaVersion: z.literal('motion.export-request.v1'),
  projectId: identity, documentId: identity, branchId: identity, expectedRevision: revision }).strict();
export type ExportRequest = z.infer<typeof exportRequestSchema>;
const receiptSchema = z.object({ schemaVersion: z.literal('motion.export-receipt.v1'),
  projectId: identity, documentId: identity, branchId: identity, revision,
  canonicalDigest: digest, sourceDigest: digest, exportDigest: digest,
  htmlDigest: digest, cssDigest: digest, reducedMotionDigest: digest,
  inventory: z.object({ ruleCount: revision, applicationCount: revision, slotCount: revision,
    trackCount: revision, supportedCount: revision, unsupportedCount: z.literal(0), missingCount: z.literal(0) }).strict(),
}).strict();
export type ExportReceipt = z.infer<typeof receiptSchema>;
const successSchema = z.object({ ok: z.literal(true), schemaVersion: z.literal('motion.export-bundle.v1'),
  receipt: receiptSchema, files: z.object({ 'animation.html': z.string(), 'animation.css': z.string(),
    'receipt.json': z.string() }).strict() }).strict();
const failureSchema = z.object({ ok: z.literal(false), code: z.enum(['EXPORT_REQUEST_INVALID', 'EXPORT_UNAUTHORIZED',
  'EXPORT_PROJECT_MISMATCH', 'EXPORT_SHOT_NOT_FOUND', 'EXPORT_STALE_REVISION', 'EXPORT_UNSUPPORTED', 'EXPORT_FAILED']),
  currentRevision: revision.optional() }).strict();
export type ExportBundle = z.infer<typeof successSchema>;
export type ExportFailure = z.infer<typeof failureSchema>;
export type ExportResponse = ExportBundle | ExportFailure;

/** Artifact bytes are authored content; only the separate receipt is suitable for logs. */
export function parseExportResponse(value: unknown, request: ExportRequest): ExportResponse {
  const result = z.discriminatedUnion('ok', [successSchema, failureSchema]).parse(value);
  if (!result.ok) return result;
  const { receipt, files } = result;
  if (receipt.projectId !== request.projectId || receipt.documentId !== request.documentId
    || receipt.branchId !== request.branchId || receipt.revision !== request.expectedRevision
    || sha256Hex(files['animation.html']) !== receipt.htmlDigest
    || sha256Hex(files['animation.css']) !== receipt.cssDigest
    || sha256Hex(`${files['animation.html']}\0${files['animation.css']}`) !== receipt.exportDigest
    || canonicalJson(receipt) !== files['receipt.json']) throw new Error('EXPORT_RESPONSE_MISMATCH');
  return result;
}

export class ExportServiceClient {
  constructor(private readonly baseUrl: string, private readonly auth: RequestAuth,
    private readonly request: typeof fetch = (...args) => fetch(...args)) {}
  async shot(input: ExportRequest): Promise<ExportResponse> {
    const command = exportRequestSchema.parse(input);
    const response = await this.request(`${this.baseUrl}/api/export/v1/shot`, { method: 'POST', redirect: 'error',
      headers: { 'content-type': 'application/json', 'x-motion-actor': this.auth.actor,
        authorization: `Bearer ${this.auth.capability}` }, body: canonicalJson(command) });
    try {
      const result = parseExportResponse(await response.json(), command);
      if (response.ok !== result.ok) throw new Error('EXPORT_STATUS_MISMATCH');
      return result;
    } catch { throw new Error('EXPORT_RESPONSE_INVALID'); }
  }
}
