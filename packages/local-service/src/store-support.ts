import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { canonicalBytes, canonicalJson, sha256Hex, type AuthoringOperation, type MotionDocument } from '../../domain/src/index.ts';
import { MAIN_BRANCH_ID, type CommandFailure, type MotionCommand, type MotionDiagnostic } from '../../motion-protocol/src/index.ts';
import type { AuthContext } from '../../project-store/src/index.ts';
import { MIGRATIONS } from './migrations.ts';

export function isAuthoringKind(kind: string): kind is AuthoringOperation['kind'] {
  return ['motion.track.create', 'motion.keyframe-value.set', 'motion.keyframe-time.set', 'motion.keyframe.add',
    'motion.keyframe.remove', 'motion.slot-duration.set', 'motion.binding-delay.set', 'motion.slot-easing.set',
    'motion.hold.insert', 'motion.transform-pose.set', 'motion.transform-waypoints.translate',
    'motion.transform-waypoint.add', 'motion.transform-waypoint.remove',
    'motion.keyframe-group-time.set', 'motion.keyframe-group-easing.set', 'motion.settled-hold.set',
    'motion.cue.create', 'motion.cue.update', 'motion.cue.delete', 'motion.cue.detach',
    'motion.history.undo', 'motion.history.redo'].includes(kind);
}

export function actorId(auth: Pick<AuthContext, 'actor' | 'capability'>): string {
  return `actor_${sha256Hex(`${auth.actor}\0${auth.capability}`).slice(0, 24)}`;
}
export function affectedIds(command: MotionCommand): string[] {
  const operation = command.command as MotionCommand['command'] & { elementId?: string; trackId?: string; keyframeId?: string;
    payload?: { cueId?: string; claimId?: string; branchId?: string; targets?: Array<{ elementId: string; trackId: string; keyframeId: string }> } };
  const ids = [operation.elementId, operation.trackId, operation.keyframeId, operation.payload?.cueId,
    operation.payload?.claimId, operation.payload?.branchId,
    ...(operation.payload?.targets ?? []).flatMap((target) => [target.elementId, target.trackId, target.keyframeId])]
    .filter((value): value is string => Boolean(value));
  return [...new Set(ids)].sort();
}
export function failure(code: CommandFailure['code'], diagnosticCode: string, category: MotionDiagnostic['category'], retryable: boolean,
  extra: Pick<MotionDiagnostic, 'affectedIds' | 'currentRevision' | 'currentDigest'> = {}): CommandFailure {
  return { ok: false, code, diagnostic: { schemaVersion: 'motion.diagnostic.v1', code: diagnosticCode, category, retryable, ...extra } };
}
export function stale(currentRevision: number, currentDigest: string): CommandFailure { return { ...failure('STALE_REVISION',
  'STALE_REVISION', 'revision', true, { currentRevision, currentDigest }), currentRevision, currentDigest }; }
export function forbidden(): CommandFailure { return failure('UNAUTHORIZED_CLAIM', 'ACTOR_FORBIDDEN', 'authorization', false); }
export function claimFailure(code: string, retryable: boolean): CommandFailure {
  return failure('UNAUTHORIZED_CLAIM', code, 'authorization', retryable);
}
export function reducerFailure(code: string, extra: Pick<MotionDiagnostic, 'affectedIds'> = {}): CommandFailure {
  const category: MotionDiagnostic['category'] = /(?:NOT_FOUND|TARGET_MISSING|TARGET_INVALID)$/.test(code) ? 'target' : 'domain';
  return failure('VALIDATION', code, category, false, extra);
}

/** Synthetic migration fixture creation stays inside the sole SQLite adapter. */
export function createLegacyV1Database(path: string, seed: MotionDocument): void {
  const database = new DatabaseSync(path); try {
    database.exec('PRAGMA foreign_keys=ON;'); database.exec(MIGRATIONS[0].sql);
    database.prepare('INSERT INTO schema_migrations(version,checksum,applied_order) VALUES(1,?,1)').run(MIGRATIONS[0].checksum);
    const canonical = canonicalJson(seed); const digest = sha256Hex(canonicalBytes(seed));
    database.prepare('INSERT INTO documents(document_id,last_revision) VALUES(?,?)').run(seed.documentId, seed.revision);
    database.prepare('INSERT INTO revisions(document_id,revision,parent_revision,canonical_json,canonical_digest,creating_event_id) VALUES(?,?,?,?,?,NULL)')
      .run(seed.documentId, seed.revision, null, canonical, digest);
    database.prepare('INSERT INTO branches(document_id,branch_id,head_revision,base_revision) VALUES(?,?,?,?)')
      .run(seed.documentId, MAIN_BRANCH_ID, seed.revision, seed.revision);
  } finally { database.close(); chmodSync(path, 0o600); }
}

/** Synthetic failure fixtures remain inside the sole SQLite adapter. */
export function poisonLegacyV1Migration(path: string): void {
  const database = new DatabaseSync(path); try { database.exec('CREATE TABLE claims(blocker TEXT NOT NULL)'); } finally { database.close(); }
}
export function inspectMigrationFixture(path: string): { versions: number[]; mainOnlyConstraint: boolean } {
  const database = new DatabaseSync(path); try {
    const versions = (database.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as Array<{ version: number }>)
      .map((row) => row.version);
    const sql = (database.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='branches'").get() as { sql: string }).sql;
    return { versions, mainOnlyConstraint: sql.includes("CHECK(branch_id = 'main')") };
  } finally { database.close(); }
}
export function corruptStoredHead(path: string, mode: 'digest' | 'dangling'): void {
  const database = new DatabaseSync(path); try {
    if (mode === 'digest') database.prepare("UPDATE revisions SET canonical_digest=? WHERE revision=(SELECT head_revision FROM branches WHERE branch_id='main')")
      .run('0'.repeat(64));
    else database.prepare("UPDATE branches SET head_revision=999 WHERE branch_id='main'").run();
  } finally { database.close(); }
}
export function createCorruptDatabase(path: string): void { writeFileSync(path, 'not a sqlite database', { mode: 0o600 }); }
export function corruptMigrationChecksum(path: string, version: number): void {
  const database = new DatabaseSync(path); try { database.prepare('UPDATE schema_migrations SET checksum=? WHERE version=?')
    .run('synthetic-checksum-mismatch', version); } finally { database.close(); }
}
export function rawDatabaseDigest(path: string): string { return sha256Hex(readFileSync(path)); }
