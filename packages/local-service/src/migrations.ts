export const MIGRATIONS = [{
  version: 1,
  checksum: 'phase3-fixed-main-v1',
  sql: `
CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, applied_order INTEGER NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS documents(document_id TEXT PRIMARY KEY, last_revision INTEGER NOT NULL CHECK(last_revision >= 0));
CREATE TABLE IF NOT EXISTS branches(document_id TEXT NOT NULL, branch_id TEXT NOT NULL CHECK(branch_id = 'main'), head_revision INTEGER NOT NULL,
  base_revision INTEGER NOT NULL, PRIMARY KEY(document_id, branch_id),
  FOREIGN KEY(document_id) REFERENCES documents(document_id));
CREATE TABLE IF NOT EXISTS revisions(document_id TEXT NOT NULL, revision INTEGER NOT NULL, parent_revision INTEGER,
  canonical_json TEXT NOT NULL, canonical_digest TEXT NOT NULL, creating_event_id TEXT,
  PRIMARY KEY(document_id, revision), FOREIGN KEY(document_id) REFERENCES documents(document_id));
CREATE TABLE IF NOT EXISTS events(commit_seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
  document_id TEXT NOT NULL, branch_id TEXT NOT NULL CHECK(branch_id = 'main'), kind TEXT NOT NULL,
  operation_id TEXT NOT NULL, expected_revision INTEGER NOT NULL, resulting_revision INTEGER NOT NULL,
  request_digest TEXT NOT NULL, private_payload_json TEXT NOT NULL, sanitized_receipt_json TEXT NOT NULL,
  UNIQUE(document_id, operation_id), FOREIGN KEY(document_id) REFERENCES documents(document_id));
CREATE INDEX IF NOT EXISTS revisions_digest ON revisions(document_id, canonical_digest);
`,
}, {
  version: 2,
  checksum: 'phase3-branches-claims-v2',
  sql: `
ALTER TABLE branches RENAME TO branches_v1;
CREATE TABLE branches(document_id TEXT NOT NULL, branch_id TEXT NOT NULL, head_revision INTEGER NOT NULL,
  base_revision INTEGER NOT NULL, PRIMARY KEY(document_id, branch_id),
  FOREIGN KEY(document_id) REFERENCES documents(document_id));
INSERT INTO branches SELECT document_id,branch_id,head_revision,base_revision FROM branches_v1;
DROP TABLE branches_v1;
ALTER TABLE events RENAME TO events_v1;
CREATE TABLE events(commit_seq INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
  document_id TEXT NOT NULL, branch_id TEXT NOT NULL, kind TEXT NOT NULL,
  operation_id TEXT NOT NULL, expected_revision INTEGER NOT NULL, resulting_revision INTEGER NOT NULL,
  request_digest TEXT NOT NULL, private_context_digest TEXT NOT NULL DEFAULT '', private_payload_json TEXT NOT NULL,
  sanitized_receipt_json TEXT NOT NULL, UNIQUE(document_id, operation_id),
  FOREIGN KEY(document_id) REFERENCES documents(document_id));
INSERT INTO events(commit_seq,event_id,document_id,branch_id,kind,operation_id,expected_revision,resulting_revision,
  request_digest,private_context_digest,private_payload_json,sanitized_receipt_json)
SELECT commit_seq,event_id,document_id,branch_id,kind,operation_id,expected_revision,resulting_revision,
  request_digest,'',private_payload_json,sanitized_receipt_json FROM events_v1;
DROP TABLE events_v1;
CREATE TABLE claims(claim_id TEXT PRIMARY KEY, document_id TEXT NOT NULL, branch_id TEXT,
  token_hash TEXT NOT NULL, holder_kind TEXT NOT NULL CHECK(holder_kind='agent'), lease_version INTEGER NOT NULL,
  expires_at INTEGER NOT NULL, active INTEGER NOT NULL CHECK(active IN (0,1)),
  FOREIGN KEY(document_id) REFERENCES documents(document_id));
CREATE INDEX claims_scope ON claims(document_id,branch_id,active,expires_at);
`,
}, {
  version: 3,
  checksum: 'durable-read-actors-v3',
  sql: `
ALTER TABLE events ADD COLUMN actor_kind TEXT CHECK(actor_kind IN ('human','agent'));
ALTER TABLE events ADD COLUMN actor_id TEXT;
ALTER TABLE events ADD COLUMN affected_ids_json TEXT;
ALTER TABLE claims ADD COLUMN actor_id TEXT;
`,
}] as const;
