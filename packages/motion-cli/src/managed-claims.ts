import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { parseCommandResponse, type CommandResponse, type MotionCommand } from '../../motion-protocol/src/index.ts';
import type { Options } from './arguments.ts';
import { ensureDirectory, readOptional, immutable, digest } from './private-claim-files.ts';

export type Credential = { schemaVersion: 'motion.private-claim.v1'; fingerprint: string; documentId: string;
  origin?: 'shot-admit'; admissionDigest?: string;
  branchId: string; scope: 'document' | 'branch'; secret: string; acquireOperationId: string; acquireRevision: number };
type ControlRequest = { name: string; operationId: string; expectedRevision: number; leaseVersion?: number };
export type ManagedClaim = { assertIdentity(command: MotionCommand): void; observe(response: CommandResponse): void };
function fail(code: string): never { throw new Error(code); }
const required = (value: string | undefined) => value || fail('CLI_OPTION_REQUIRED');

/** Immutable credentials and operation records need no lock, including across process death.
 * The service's claim CAS/idempotency is the sole authority for authoring and leases. */
export function openManagedClaim(name: string, options: Options): ManagedClaim | undefined {
  if (!options.session) return undefined;
  const mutation = !['workspace', 'head', 'branches', 'claims', 'activity', 'history', 'export-proof',
    'project', 'shots', 'context', 'review-annotations', 'review-compare', 'review-handoff'].includes(name);
  if (!options.claim) { if (mutation) fail('CLI_CLAIM_REQUIRED'); return undefined; }
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(options.claim)) fail('CLI_CLAIM_HANDLE_INVALID');
  if (options.has('--claim-secret') || options.has('--claim-id')) fail('CLI_CONTEXT_CONFLICT');
  const directory = join(options.session.directory, 'agent-claims'); ensureDirectory(directory);
  const handleDirectory = join(directory, options.claim); ensureDirectory(handleDirectory);
  const credentialPath = join(handleDirectory, 'credential.json');
  let record = readOptional<Credential>(credentialPath);
  if ((name === 'claim-acquire' && options.has('--lease-version'))
    || ((name === 'claim-renew' || name === 'claim-release') && options.has('--scope'))) fail('CLI_OPTIONS_INVALID');
  const control = ['claim-acquire', 'claim-renew', 'claim-release'].includes(name);
  const request: ControlRequest | undefined = control ? { name, operationId: required(options.operationId),
    expectedRevision: options.expectedRevision ?? fail('CLI_REVISION_REQUIRED') } : undefined;
  if (name === 'claim-acquire') {
    const scope = options.read('--scope'); if (scope !== 'document' && scope !== 'branch') fail('CLI_SCOPE_INVALID');
    if (!record) record = immutable(credentialPath, { schemaVersion: 'motion.private-claim.v1',
      fingerprint: options.session.fingerprint, documentId: required(options.documentId), branchId: options.branchId,
      scope, secret: randomBytes(32).toString('base64url'), acquireOperationId: request!.operationId,
      acquireRevision: request!.expectedRevision } satisfies Credential);
  }
  if (!record) fail('CLI_CLAIM_NOT_FOUND');
  validateCredential(record);
  if (record.fingerprint !== options.session.fingerprint) fail('CLI_SESSION_CHANGED');
  if (record.documentId !== options.documentId || record.branchId !== options.branchId) fail('CLI_CLAIM_IDENTITY_MISMATCH');
  if (name === 'claim-acquire' && (record.origin || record.acquireOperationId !== request!.operationId
    || record.acquireRevision !== request!.expectedRevision || record.scope !== options.read('--scope')))
    fail('CLI_CLAIM_HANDLE_USED');
  const acquired = record.origin === 'shot-admit' ? admissionClaim(handleDirectory, record)
    : receipt(join(handleDirectory, 'acquired.json'), record, 'motion.claim.acquire');
  const released = receipt(join(handleDirectory, 'released.json'), record, 'motion.claim.release');
  if (released && (name !== 'claim-release' || !released.ok || released.operationId !== options.operationId))
    fail('CLI_CLAIM_INACTIVE');
  if (name !== 'claim-acquire' && (!acquired?.ok || !acquired.claimId)) fail('CLI_CLAIM_PENDING');
  if (name === 'claim-renew' || name === 'claim-release') {
    const raw = options.read('--lease-version');
    if (!raw || !/^[1-9]\d*$/.test(raw) || !Number.isSafeInteger(Number(raw))) fail('CLI_LEASE_VERSION_REQUIRED');
    request!.leaseVersion = Number(raw); options.set('--claim-id', acquired!.ok ? acquired!.claimId! : '');
  }
  if (request) {
    const existing = immutable(join(handleDirectory, `request-${digest(request.operationId)}.json`), request);
    if (JSON.stringify(existing) !== JSON.stringify(request)) fail('CLI_CLAIM_REQUEST_CONFLICT');
  }
  options.claimSecret = record.secret;
  return {
    assertIdentity(command) {
      if (command.documentId !== record.documentId || command.branchId !== record.branchId
        || (options.expectedRevision !== undefined && command.expectedRevision !== options.expectedRevision)
        || (options.operationId !== undefined && command.operationId !== options.operationId)) fail('CLI_COMMAND_IDENTITY_MISMATCH');
      if (command.command.kind.startsWith('motion.claim.') && command.command.kind !== `motion.${name.replace('-', '.')}`)
        fail('CLI_COMMAND_IDENTITY_MISMATCH');
    },
    observe(response) {
      if (!control || !response.ok) return;
      if (!response.claimId || !response.leaseVersion) fail('CLI_CLAIM_RESPONSE_INVALID');
      immutable(join(handleDirectory, `receipt-${digest(request!.operationId)}.json`), response);
      if (name === 'claim-acquire') immutable(join(handleDirectory, 'acquired.json'), response);
      if (name === 'claim-release') immutable(join(handleDirectory, 'released.json'), response);
    },
  };
}
function receipt(path: string, credential: Credential, kind: string): CommandResponse | undefined {
  const input = readOptional<unknown>(path); if (input === undefined) return undefined;
  try {
    const response = parseCommandResponse(input);
    if (!response.ok || response.documentId !== credential.documentId || response.branchId !== credential.branchId
      || !('kind' in response.receipt) || response.receipt.kind !== kind) fail('CLI_CLAIM_CONTEXT_INVALID');
    return response;
  } catch { fail('CLI_CLAIM_CONTEXT_INVALID'); }
}
export function validateCredential(value: Credential): void {
  if (!value || value.schemaVersion !== 'motion.private-claim.v1' || !/^[A-Za-z0-9_-]{43}$/.test(value.secret)
    || !/^[a-f0-9]{64}$/.test(value.fingerprint) || typeof value.documentId !== 'string'
    || typeof value.branchId !== 'string' || !['document', 'branch'].includes(value.scope)
    || (value.origin !== undefined && (value.origin !== 'shot-admit' || typeof value.admissionDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.admissionDigest)))
    || typeof value.acquireOperationId !== 'string' || !Number.isSafeInteger(value.acquireRevision)) fail('CLI_CLAIM_CONTEXT_INVALID');
}

function admissionClaim(directory: string, credential: Credential): { ok: true; claimId: string } | undefined {
  const receipt = readOptional<{ fingerprint: string; documentId: string; operationId: string; claimId: string; leaseVersion: number }>(join(directory, 'admitted.json'));
  if (!receipt) return undefined;
  if (receipt.fingerprint !== credential.fingerprint || receipt.documentId !== credential.documentId
    || receipt.operationId !== credential.acquireOperationId || !/^claim_[a-f0-9]{24}$/.test(receipt.claimId)
    || receipt.leaseVersion !== 1) fail('CLI_CLAIM_CONTEXT_INVALID');
  return { ok: true, claimId: receipt.claimId };
}
