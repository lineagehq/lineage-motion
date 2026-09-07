import { canonicalJson } from '../../domain/src/canonical.ts';
import { sequenceDigest } from '../../domain/src/sequence.ts';
import { sequenceCatalogSchema, sequenceSnapshotSchema, sequenceReceiptSchema, sequenceFailureSchema,
  sequenceCommandSchema, sequenceSourcesSchema, type SequenceCommand, type SequenceResponse,
  type SequenceCatalog, type SequenceSnapshot, type SequenceSources } from './sequence.ts';
import type { RequestAuth } from './index.ts';

export class SequenceServiceClient {
  constructor(private readonly baseUrl: string, private readonly auth: RequestAuth,
    private readonly request: typeof fetch = (...args) => fetch(...args)) {}
  private async send(path: string, body?: unknown): Promise<{ status: number; value: unknown }> {
    const response = await this.request(`${this.baseUrl}/api/sequence/v1/${path}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error', cache: 'no-store',
      headers: { authorization: `Bearer ${this.auth.capability}`, 'x-motion-actor': this.auth.actor,
        ...(this.auth.claimSecret ? { 'x-motion-claim-secret': this.auth.claimSecret } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(body === undefined ? {} : { body: canonicalJson(body) }),
    });
    return { status: response.status, value: await response.json() };
  }
  async catalog(): Promise<SequenceCatalog> {
    const result = await this.send('catalog'); if (result.status !== 200) throw new Error('SEQUENCE_READ_FAILED');
    return sequenceCatalogSchema.parse(result.value);
  }
  async sources(): Promise<SequenceSources> {
    const result = await this.send('sources'); if (result.status !== 200) throw new Error('SEQUENCE_READ_FAILED');
    return sequenceSourcesSchema.parse(result.value);
  }
  async snapshot(sequenceId: string): Promise<SequenceSnapshot> {
    const result = await this.send(`sequences/${encodeURIComponent(sequenceId)}`);
    if (result.status !== 200) throw new Error('SEQUENCE_READ_FAILED');
    const snapshot = sequenceSnapshotSchema.parse(result.value);
    if (snapshot.sequence.sequenceId !== sequenceId || sequenceDigest(snapshot.sequence) !== snapshot.canonicalDigest)
      throw new Error('SEQUENCE_RESPONSE_MISMATCH');
    return snapshot;
  }
  async execute(input: SequenceCommand): Promise<SequenceResponse> {
    const command = sequenceCommandSchema.parse(input); const result = await this.send('commands', command);
    if (result.status !== 200) return sequenceFailureSchema.parse(result.value);
    const receipt = sequenceReceiptSchema.parse(result.value);
    const expected = command.kind === 'sequence.create' ? 0
      : ['sequence.edit', 'sequence.undo', 'sequence.redo'].includes(command.kind) ? command.expectedRevision + 1 : command.expectedRevision;
    if (receipt.operationId !== command.operationId || receipt.projectId !== command.projectId
      || receipt.sequenceId !== command.sequenceId || receipt.revision !== expected)
      throw new Error('SEQUENCE_RESPONSE_MISMATCH');
    return receipt;
  }
}
