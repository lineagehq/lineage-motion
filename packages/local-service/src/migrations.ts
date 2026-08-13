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
}] as const;
