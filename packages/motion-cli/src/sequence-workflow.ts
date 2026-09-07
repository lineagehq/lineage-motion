import { ProjectServiceClient } from '../../motion-protocol/src/project-client.ts';
import { SequenceServiceClient } from '../../motion-protocol/src/sequence-client.ts';
import { fetchSequenceExport, createSequenceExportArchive } from '../../motion-protocol/src/sequence-export.ts';
import { sequenceCommandSchema, SEQUENCE_PROTOCOL_VERSION, type SequenceCommand } from '../../motion-protocol/src/sequence.ts';
import type { SequenceEdit, SequenceSource } from '../../domain/src/sequence.ts';
import type { Options } from './arguments.ts';
import { sessionFetch } from './session-context.ts';
import { openSequenceClaim } from './sequence-claims.ts';
import { sequenceOptions, sequenceReadNames } from './sequence-discovery.ts';
import { writeArchiveArtifact } from './export-artifact.ts';

const fail = (code: string): never => { throw new Error(code); };
const text = (options: Options, key: string) => options.read(key) ?? fail('CLI_OPTION_REQUIRED');
const integer = (options: Options, key: string) => {
  const raw = text(options, key);
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) fail('CLI_OPTIONS_INVALID');
  return Number(raw);
};
const extraCreate = ['--clip-id', '--source-document-id', '--source-revision', '--clip-name', '--end-hold-ms'];
const transport = ['--service', '--actor', '--capability', '--project', '--data-dir', '--project-id', '--sequence-id'];
const writes = ['--operation-id', '--expected-revision', '--claim', '--claim-secret'];
/** Reject ignored authoring flags rather than making a plausible but different operation. */
export function sequenceAllowedOptions(name: string): Set<string> {
  return new Set([...transport, ...sequenceOptions[name]!.map(value => value.split(' ')[0]!.replace('-seconds', '-ms')),
    ...sequenceReadNames.includes(name) ? [] : writes,
    ...name === 'sequence-create' ? extraCreate : [],
    ...['sequence-claim-renew', 'sequence-claim-release'].includes(name) ? ['--claim-id'] : [], ...name === 'sequence-clip-add' ? ['--end-hold-ms'] : []]);
}
export async function runSequence(name: string, options: Options, supplied: Map<string, string[]>): Promise<unknown> {
  const allowed = sequenceAllowedOptions(name);
  for (const key of supplied.keys()) if (!allowed.has(key)) fail('CLI_OPTIONS_INVALID');
  const request = options.session ? sessionFetch : fetch;
  const auth = { actor: options.actor, capability: options.capability };
  const client = new SequenceServiceClient(options.service, auth, request);
  const catalog = await client.catalog();
  const projectId = options.read('--project-id') ?? options.session?.projectId ?? catalog.projectId;
  if (projectId !== catalog.projectId || (options.session?.projectId && projectId !== options.session.projectId)) fail('CLI_PROJECT_MISMATCH');
  if (options.session && !options.session.projectId) {
    const project = await new ProjectServiceClient(options.service, auth, request).catalog();
    if (project.projectId !== projectId || project.name !== options.session.project) fail('CLI_PROJECT_MISMATCH');
  }
  if (name === 'sequences') return catalog;
  if (name === 'sequence-sources') {
    const sources = await client.sources(); if (sources.projectId !== projectId) fail('CLI_PROJECT_MISMATCH'); return sources;
  }
  const sequenceId = options.read('--sequence-id') ?? (name === 'sequence-create' ? fail('CLI_SEQUENCE_ID_REQUIRED')
    : catalog.sequences.length === 1 ? catalog.sequences[0]!.sequenceId
      : fail(catalog.sequences.length ? 'CLI_SEQUENCE_AMBIGUOUS' : 'CLI_SEQUENCE_NOT_FOUND'));
  if (name === 'sequence') {
    const snapshot = await client.snapshot(sequenceId);
    if (snapshot.sequence.projectId !== projectId) fail('CLI_PROJECT_MISMATCH'); return snapshot;
  }
  if (options.expectedRevision === undefined) fail('CLI_REVISION_REQUIRED');
  if (name === 'sequence-export') {
    const output = text(options, '--output'); if (!output.endsWith('.zip')) fail('CLI_EXPORT_ZIP_REQUIRED');
    const result = await fetchSequenceExport(options.service, auth, { projectId, sequenceId,
      expectedRevision: options.expectedRevision! }, request);
    if (!result.ok) return result;
    try {
      return { ok: true, schemaVersion: 'motion.cli-sequence-export.v1', receipt: result.receipt,
        ...await writeArchiveArtifact(output, createSequenceExportArchive(result)) };
    } catch (error) {
      const codes = ['EXPORT_OUTPUT_EXISTS', 'EXPORT_OUTPUT_UNAVAILABLE', 'EXPORT_OUTPUT_AND_CLEANUP_FAILED'];
      return { ok: false, code: error instanceof Error && codes.includes(error.message) ? error.message : 'EXPORT_OUTPUT_UNAVAILABLE' };
    }
  }
  if (!options.operationId) fail('CLI_OPERATION_ID_REQUIRED');
  if (name === 'sequence-claim-revoke' && options.actor !== 'human') fail('CLI_HUMAN_REQUIRED');
  const managed = openSequenceClaim(name, options, projectId, sequenceId);
  const source = async (): Promise<SequenceSource> => {
    const documentId = text(options, '--source-document-id'); const revision = integer(options, '--source-revision');
    const sources = await client.sources(); if (sources.projectId !== projectId) fail('CLI_PROJECT_MISMATCH');
    const shot = sources.shots.find(value => value.source.documentId === documentId);
    if (!shot) fail('CLI_SEQUENCE_SOURCE_NOT_FOUND');
    if (shot!.source.revision !== revision) fail('CLI_SEQUENCE_SOURCE_STALE');
    if (shot!.reasonCode || !shot!.viewport || shot!.source.durationMs <= 0) fail('CLI_SEQUENCE_SOURCE_UNSUPPORTED');
    return shot!.source;
  };
  const build = async (claimId?: string): Promise<SequenceCommand> => {
    const base = { protocolVersion: SEQUENCE_PROTOCOL_VERSION, operationId: options.operationId!,
      projectId, sequenceId, expectedRevision: options.expectedRevision! };
    const clip = async (create: boolean) => ({ clipId: text(options, '--clip-id'),
      name: text(options, create ? '--clip-name' : '--name'), source: await source(),
      endHoldMs: options.has('--end-hold-ms') ? integer(options, '--end-hold-ms') : 0 });
    if (name === 'sequence-create') return sequenceCommandSchema.parse({ ...base, kind: 'sequence.create',
      name: text(options, '--name'), viewport: { widthCssPixels: integer(options, '--viewport-width'), heightCssPixels: integer(options, '--viewport-height') },
      initialClip: extraCreate.some(key => options.has(key)) ? await clip(true) : null, claim: options.actor === 'agent' });
    if (name === 'sequence-undo' || name === 'sequence-redo') return { ...base, kind: name === 'sequence-undo' ? 'sequence.undo' : 'sequence.redo' };
    if (name === 'sequence-claim-acquire') return { ...base, kind: 'sequence.claim.acquire' };
    if (name.startsWith('sequence-claim-')) return sequenceCommandSchema.parse({ ...base,
      kind: name.replace('sequence-claim-', 'sequence.claim.'), claimId: claimId ?? text(options, '--claim-id'),
      expectedLeaseVersion: integer(options, '--lease-version') });
    let edit: SequenceEdit;
    if (name === 'sequence-rename') edit = { kind: 'sequence.rename', name: text(options, '--name') };
    else {
      const clipId = text(options, '--clip-id');
      switch (name) {
        case 'sequence-clip-add': edit = { kind: 'clip.add', clip: await clip(false), index: integer(options, '--index') }; break;
        case 'sequence-clip-duplicate': edit = { kind: 'clip.duplicate', clipId, newClipId: text(options, '--new-clip-id'), name: text(options, '--name') }; break;
        case 'sequence-clip-remove': edit = { kind: 'clip.remove', clipId }; break;
        case 'sequence-clip-move': edit = { kind: 'clip.move', clipId, index: integer(options, '--index') }; break;
        case 'sequence-clip-rename': edit = { kind: 'clip.rename', clipId, name: text(options, '--name') }; break;
        case 'sequence-clip-hold': edit = { kind: 'clip.hold', clipId, endHoldMs: integer(options, '--end-hold-ms') }; break;
        case 'sequence-clip-update-source': edit = { kind: 'clip.update-source', clipId, source: await source() }; break;
        default: return fail('CLI_OPTIONS_INVALID');
      }
    }
    return sequenceCommandSchema.parse({ ...base, kind: 'sequence.edit', edit });
  };
  const intent = { name, options: Object.fromEntries([...supplied].filter(([key]) => !transport.includes(key) && key !== '--claim').sort(([a], [b]) => a.localeCompare(b))) };
  const command = managed ? await managed.prepare(intent, build) : await build();
  const response = await new SequenceServiceClient(options.service, { ...auth, ...(options.claimSecret ? { claimSecret: options.claimSecret } : {}) }, request).execute(command);
  managed?.observe(response); return response;
}

export function sequenceExitCode(response: { ok?: boolean; code?: string }): number {
  if (response.ok !== false) return 0;
  if (response.code === 'SEQUENCE_STALE_REVISION' || response.code === 'SEQUENCE_STALE_LEASE') return 3;
  if (['SEQUENCE_UNAUTHORIZED', 'SEQUENCE_CLAIM_CONFLICT', 'SEQUENCE_CLAIM_EXPIRED'].includes(response.code ?? '')) return 4;
  if (response.code === 'SEQUENCE_OPERATION_CONFLICT') return 5;
  return response.code === 'SEQUENCE_STORAGE_FAILURE' ? 7 : 2;
}
