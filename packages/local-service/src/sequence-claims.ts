import type { DatabaseSync } from 'node:sqlite';
import { sha256Hex } from '../../domain/src/sha256.ts';
import type { SequenceCommand, SequenceFailure, SequenceReceipt } from '../../motion-protocol/src/sequence.ts';
import type { AuthContext } from '../../project-store/src/index.ts';
export type SequenceClaimRow = { claim_id: string; token_hash: string; actor_id: string; lease_version: number; expires_at: number; active: number };
export const sequenceFail = (code: SequenceFailure['code']): SequenceFailure => ({ ok: false, code });
const actorDigest = (auth: AuthContext) => sha256Hex(`${auth.actor}\0${auth.capability}`);
export function activeSequenceClaim(database: DatabaseSync, sequenceId: string, now: number): SequenceClaimRow | undefined {
  return database.prepare('SELECT * FROM sequence_claims WHERE sequence_id=? AND active=1 AND expires_at>?')
    .get(sequenceId, now) as SequenceClaimRow | undefined;
}
export function checkSequenceWriter(database: DatabaseSync, sequenceId: string, auth: AuthContext): SequenceFailure | null {
  const claim = activeSequenceClaim(database, sequenceId, auth.now);
  if (auth.actor === 'human') return claim ? sequenceFail('SEQUENCE_CLAIM_CONFLICT') : null;
  if (!claim) return sequenceFail('SEQUENCE_CLAIM_EXPIRED');
  return claim.actor_id === actorDigest(auth) && claim.token_hash === sha256Hex(auth.claimSecret ?? '')
    ? null : sequenceFail('SEQUENCE_UNAUTHORIZED');
}
export function acquireSequenceClaim(database: DatabaseSync, command: SequenceCommand, auth: AuthContext):
  { ok: true; claim: NonNullable<SequenceReceipt['claim']> } | SequenceFailure {
  if (auth.actor !== 'agent' || !auth.claimSecret || auth.claimSecret.length < 32)
    return sequenceFail('SEQUENCE_UNAUTHORIZED');
  if (activeSequenceClaim(database, command.sequenceId, auth.now)) return sequenceFail('SEQUENCE_CLAIM_CONFLICT');
  const expiresAt = auth.now + 60_000;
  if (!Number.isSafeInteger(expiresAt) || expiresAt < 0) return sequenceFail('SEQUENCE_INVALID');
  const claimId = `sqclaim_${sha256Hex(`${command.sequenceId}\0${command.operationId}\0${actorDigest(auth)}`).slice(0, 24)}`;
  database.prepare('INSERT INTO sequence_claims VALUES(?,?,?,?,?,?,1)').run(claimId, command.sequenceId,
    sha256Hex(auth.claimSecret), actorDigest(auth), 1, expiresAt);
  return { ok: true, claim: { claimId, leaseVersion: 1, expiresAt } };
}
export function controlSequenceClaim(database: DatabaseSync, command: SequenceCommand, auth: AuthContext):
  { ok: true; claim: NonNullable<SequenceReceipt['claim']> } | SequenceFailure {
  if (command.kind === 'sequence.claim.acquire') return acquireSequenceClaim(database, command, auth);
  if (!('claimId' in command)) return sequenceFail('SEQUENCE_INVALID');
  const claim = database.prepare('SELECT * FROM sequence_claims WHERE sequence_id=? AND claim_id=?')
    .get(command.sequenceId, command.claimId) as SequenceClaimRow | undefined;
  if (!claim) return sequenceFail('SEQUENCE_UNAUTHORIZED');
  if (command.kind === 'sequence.claim.revoke') {
    if (auth.actor !== 'human') return sequenceFail('SEQUENCE_UNAUTHORIZED');
  } else if (auth.actor !== 'agent' || claim.actor_id !== actorDigest(auth)
    || claim.token_hash !== sha256Hex(auth.claimSecret ?? '')) return sequenceFail('SEQUENCE_UNAUTHORIZED');
  if (!claim.active || claim.expires_at <= auth.now) return sequenceFail('SEQUENCE_CLAIM_EXPIRED');
  if (claim.lease_version !== command.expectedLeaseVersion) return sequenceFail('SEQUENCE_STALE_LEASE');
  const leaseVersion = claim.lease_version + 1;
  const expiresAt = command.kind === 'sequence.claim.renew' ? auth.now + 60_000 : claim.expires_at;
  if (!Number.isSafeInteger(leaseVersion) || !Number.isSafeInteger(expiresAt)) return sequenceFail('SEQUENCE_INVALID');
  database.prepare('UPDATE sequence_claims SET lease_version=?,expires_at=?,active=? WHERE claim_id=?')
    .run(leaseVersion, expiresAt, command.kind === 'sequence.claim.renew' ? 1 : 0, claim.claim_id);
  return { ok: true, claim: { claimId: claim.claim_id, leaseVersion, expiresAt } };
}
