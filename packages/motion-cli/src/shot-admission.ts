import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProjectServiceClient } from '../../motion-protocol/src/project-client.ts';
import { PROJECT_PROTOCOL_VERSION, parseShotAdmissionCommand, type ShotAdmissionResponse } from '../../motion-protocol/src/project.ts';
import type { Options } from './arguments.ts';
import { sessionFetch } from './session-context.ts';
import { type Credential, validateCredential } from './managed-claims.ts';
import { digest, ensureDirectory, immutable, readOptional } from './private-claim-files.ts';
function fail(code: string): never { throw new Error(code); }
function required(value: string | undefined): string { return value || fail('CLI_OPTION_REQUIRED'); }

export async function admitShot(options: Options): Promise<ShotAdmissionResponse> {
  if (options.branchId !== 'main' || options.has('--shot') || options.has('--expected-revision')
    || options.has('--scope') || options.has('--lease-version') || options.has('--claim-id')
    || options.has('--validate') || options.has('--validate-only')) fail('CLI_OPTIONS_INVALID');
  const starter = options.read('--starter'); const htmlFile = options.read('--html-file');
  if ((!starter && !htmlFile) || (starter && htmlFile)) fail('CLI_SHOT_SOURCE_REQUIRED');
  let html: string | undefined;
  if (htmlFile) { try { html = readFileSync(htmlFile, 'utf8'); } catch { fail('CLI_SOURCE_FILE_INVALID'); } }
  const rawRevision = required(options.read('--expected-catalog-revision'));
  if (!/^\d+$/.test(rawRevision) || !Number.isSafeInteger(Number(rawRevision))) fail('CLI_CATALOG_REVISION_INVALID');
  let command;
  try {
    command = parseShotAdmissionCommand({ protocolVersion: PROJECT_PROTOCOL_VERSION, kind: 'motion.shot.admit',
      operationId: required(options.operationId), projectId: required(options.read('--project-id')),
      expectedCatalogRevision: Number(rawRevision), documentId: required(options.documentId), name: required(options.read('--name')),
      source: starter ? { kind: 'starter', starterId: starter } : { kind: 'html-css', html },
      claim: options.actor === 'agent' ? { scope: 'document', documentId: options.documentId } : null });
  } catch (error) { if (error instanceof Error && error.message.startsWith('CLI_')) throw error; fail('CLI_SHOT_INPUT_INVALID'); }
  let directory: string | undefined;
  if (options.session) {
    if (!options.claim) fail('CLI_CLAIM_REQUIRED');
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(options.claim)) fail('CLI_CLAIM_HANDLE_INVALID');
    const base = join(options.session.directory, 'agent-claims'); ensureDirectory(base);
    directory = join(base, options.claim); ensureDirectory(directory);
    const credentialPath = join(directory, 'credential.json');
    const admissionDigest = digest(JSON.stringify(command));
    const credential = readOptional<Credential>(credentialPath) ?? immutable(credentialPath, {
      schemaVersion: 'motion.private-claim.v1', origin: 'shot-admit', admissionDigest,
      fingerprint: options.session.fingerprint, documentId: command.documentId, branchId: 'main', scope: 'document',
      secret: randomBytes(32).toString('base64url'), acquireOperationId: command.operationId, acquireRevision: 0,
    } satisfies Credential);
    validateCredential(credential);
    if (credential.fingerprint !== options.session.fingerprint) fail('CLI_SESSION_CHANGED');
    if (credential.origin !== 'shot-admit' || credential.admissionDigest !== admissionDigest
      || credential.documentId !== command.documentId || credential.acquireOperationId !== command.operationId)
      fail('CLI_CLAIM_REQUEST_CONFLICT');
    if (readOptional(join(directory, 'released.json'))) fail('CLI_CLAIM_INACTIVE');
    options.claimSecret = credential.secret;
  }
  const response = await new ProjectServiceClient(options.service, { actor: options.actor, capability: options.capability },
    options.session ? sessionFetch : fetch).admit(command, options.claimSecret);
  if (response.ok && directory) {
    if (!response.claim || response.documentId !== command.documentId || response.operationId !== command.operationId
      || response.projectId !== command.projectId) fail('CLI_CLAIM_RESPONSE_INVALID');
    // Only claim metadata is cached; source bytes and product snapshots stay with the service.
    immutable(join(directory, 'admitted.json'), { fingerprint: options.session!.fingerprint,
      documentId: response.documentId, operationId: response.operationId, ...response.claim });
  }
  return response;
}
