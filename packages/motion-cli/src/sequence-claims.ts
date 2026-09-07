import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import { canonicalJson } from '../../domain/src/canonical.ts';
import { sequenceCommandSchema, sequenceReceiptSchema, type SequenceCommand, type SequenceResponse } from '../../motion-protocol/src/sequence.ts';
import type { Options } from './arguments.ts';
import { ensureDirectory, immutable, readOptional, digest } from './private-claim-files.ts';

const credentialSchema = z.object({ schemaVersion: z.literal('motion.private-sequence-claim.v1'),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/), projectId: z.string(), sequenceId: z.string(),
  secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/), origin: z.enum(['sequence-create', 'sequence-claim-acquire']),
  operationId: z.string(), expectedRevision: z.number().int().nonnegative() }).strict();
type Intent = { name: string; options: Record<string, string[]> };
const storedRequestSchema = z.object({ intent: z.object({ name: z.string(), options: z.record(z.string(), z.array(z.string())) }).strict(),
  command: sequenceCommandSchema }).strict();
export type SequenceClaim = {
  prepare(intent: Intent, build: (claimId?: string) => Promise<SequenceCommand>): Promise<SequenceCommand>;
  observe(response: SequenceResponse): void;
};
const fail = (code: string): never => { throw new Error(code); };

/** Credentials precede network writes; immutable requests preserve resolved source pins on retries. */
export function openSequenceClaim(name: string, options: Options, projectId: string, sequenceId: string): SequenceClaim | undefined {
  if (!options.session) return undefined;
  const handle = options.claim ?? fail('CLI_SEQUENCE_CLAIM_REQUIRED');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(handle)) fail('CLI_CLAIM_HANDLE_INVALID');
  if (options.has('--claim-id') || options.has('--claim-secret')) fail('CLI_CONTEXT_CONFLICT');
  const root = join(options.session.directory, 'agent-sequence-claims'); ensureDirectory(root);
  const directory = join(root, handle); ensureDirectory(directory);
  const credentialPath = join(directory, 'credential.json');
  const origin = name === 'sequence-create' || name === 'sequence-claim-acquire';
  let input = readOptional<unknown>(credentialPath);
  if (!input && origin) input = immutable(credentialPath, { schemaVersion: 'motion.private-sequence-claim.v1',
    fingerprint: options.session.fingerprint, projectId, sequenceId, secret: randomBytes(32).toString('base64url'),
    origin: name, operationId: options.operationId, expectedRevision: options.expectedRevision });
  if (!input) fail('CLI_SEQUENCE_CLAIM_NOT_FOUND');
  const parsed = credentialSchema.safeParse(input); if (!parsed.success) fail('CLI_CLAIM_CONTEXT_INVALID');
  const credential = parsed.data!;
  if (credential.fingerprint !== options.session.fingerprint) fail('CLI_SESSION_CHANGED');
  if (credential.projectId !== projectId || credential.sequenceId !== sequenceId) fail('CLI_CLAIM_IDENTITY_MISMATCH');
  if (origin && (credential.origin !== name || credential.operationId !== options.operationId
    || credential.expectedRevision !== options.expectedRevision)) fail('CLI_CLAIM_HANDLE_USED');
  const readReceipt = (file: string) => {
    const value = readOptional<unknown>(join(directory, file)); if (value === undefined) return undefined;
    const result = sequenceReceiptSchema.safeParse(value);
    if (!result.success || result.data.projectId !== projectId || result.data.sequenceId !== sequenceId || !result.data.claim)
      fail('CLI_CLAIM_CONTEXT_INVALID');
    return result.data!;
  };
  const acquired = readReceipt('acquired.json'); const released = readReceipt('released.json');
  if (acquired && acquired.operationId !== credential.operationId) fail('CLI_CLAIM_CONTEXT_INVALID');
  options.claimSecret = credential.secret;
  let prepared: SequenceCommand | undefined;
  return {
    async prepare(intent, build) {
      const path = join(directory, `request-${digest(options.operationId!)}.json`);
      const saved = readOptional<unknown>(path);
      const validate = (value: unknown) => {
        const result = storedRequestSchema.safeParse(value);
        if (!result.success) fail('CLI_CLAIM_CONTEXT_INVALID');
        if (canonicalJson(result.data!.intent) !== canonicalJson(intent)) fail('CLI_CLAIM_REQUEST_CONFLICT');
        const command = result.data!.command;
        if (command.projectId !== projectId || command.sequenceId !== sequenceId
          || command.operationId !== options.operationId || command.expectedRevision !== options.expectedRevision)
          fail('CLI_COMMAND_IDENTITY_MISMATCH');
        return command;
      };
      if (saved !== undefined) { prepared = validate(saved); return prepared; }
      if (released) fail('CLI_CLAIM_INACTIVE');
      if (!origin && !acquired) fail('CLI_CLAIM_PENDING');
      const command = await build(acquired?.claim?.claimId);
      prepared = validate(immutable(path, { intent, command })); return prepared;
    },
    observe(response) {
      if (!response.ok) return;
      if (!prepared || response.operationId !== prepared.operationId || response.projectId !== projectId || response.sequenceId !== sequenceId)
        fail('CLI_CLAIM_RESPONSE_INVALID');
      immutable(join(directory, `receipt-${digest(response.operationId)}.json`), response);
      if (origin || name === 'sequence-claim-release' || name === 'sequence-claim-renew') {
        if (!response.claim) fail('CLI_CLAIM_RESPONSE_INVALID');
        if (origin) immutable(join(directory, 'acquired.json'), response);
        if (name === 'sequence-claim-release') immutable(join(directory, 'released.json'), response);
      }
    },
  };
}
