export const sequenceMigration = {
  version: 6,
  checksum: 'sequence-pinned-shots-v6',
  sql: `
CREATE TABLE sequences(sequence_id TEXT PRIMARY KEY, head_revision INTEGER NOT NULL CHECK(head_revision>=0));
CREATE TABLE sequence_revisions(sequence_id TEXT NOT NULL REFERENCES sequences(sequence_id), revision INTEGER NOT NULL,
  canonical_json TEXT NOT NULL, canonical_digest TEXT NOT NULL, undo_json TEXT NOT NULL, redo_json TEXT NOT NULL,
  PRIMARY KEY(sequence_id,revision));
CREATE TABLE sequence_operations(sequence_id TEXT NOT NULL REFERENCES sequences(sequence_id), operation_id TEXT NOT NULL,
  request_digest TEXT NOT NULL, private_context_digest TEXT NOT NULL, receipt_json TEXT NOT NULL,
  PRIMARY KEY(sequence_id,operation_id));
CREATE TABLE sequence_claims(claim_id TEXT PRIMARY KEY, sequence_id TEXT NOT NULL REFERENCES sequences(sequence_id),
  token_hash TEXT NOT NULL, actor_id TEXT NOT NULL, lease_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)));
CREATE INDEX sequence_claim_scope ON sequence_claims(sequence_id,active,expires_at);
`,
} as const;
