import { ExportServiceClient } from '../../motion-protocol/src/export.ts';
import { ProjectServiceClient } from '../../motion-protocol/src/project-client.ts';
import type { Options } from './arguments.ts';
import { sessionFetch } from './session-context.ts';
import { writeExportArtifact } from './export-artifact.ts';

export async function downloadShot(options: Options): Promise<unknown> {
  if (options.has('--validate') || options.has('--validate-only')) throw new Error('CLI_OPTIONS_INVALID');
  const output = options.read('--output');
  if (!output) throw new Error('CLI_EXPORT_OUTPUT_REQUIRED');
  if (!output.endsWith('.zip')) throw new Error('CLI_EXPORT_ZIP_REQUIRED');
  if (options.expectedRevision === undefined) throw new Error('CLI_REVISION_REQUIRED');
  if (!options.documentId) throw new Error('CLI_SHOT_NOT_FOUND');
  const auth = { actor: options.actor, capability: options.capability };
  const request = options.session ? sessionFetch : fetch;
  const catalog = await new ProjectServiceClient(options.service, auth, request).catalog();
  const projectId = options.read('--project-id') ?? options.session?.projectId ?? catalog.projectId;
  if (projectId !== catalog.projectId || (options.session && (options.session.projectId
    ? projectId !== options.session.projectId : catalog.name !== options.session.project))) throw new Error('CLI_PROJECT_MISMATCH');
  const result = await new ExportServiceClient(options.service, auth, request).shot({ schemaVersion: 'motion.export-request.v1',
    projectId, documentId: options.documentId, branchId: options.branchId, expectedRevision: options.expectedRevision });
  if (!result.ok) return result;
  try {
    const published = await writeExportArtifact(output, result);
    return { ok: true, schemaVersion: 'motion.cli-export.v1', receipt: result.receipt, ...published };
  } catch (error) {
    const allowed = ['EXPORT_OUTPUT_EXISTS', 'EXPORT_OUTPUT_UNAVAILABLE', 'EXPORT_OUTPUT_AND_CLEANUP_FAILED'];
    return { ok: false, code: error instanceof Error && allowed.includes(error.message) ? error.message : 'EXPORT_OUTPUT_UNAVAILABLE' };
  }
}
