# Phase 3 persistence boundary

## Decision status

This document records the approved Phase 3 architecture. It authorizes no
implementation and is not evidence that the Phase 3 exit gate has passed.

The smallest credible design is one loopback-only local service that owns a
replaceable transactional store. The SQLite adapter stores immutable snapshots
and atomic events. Revisions are global to a document, branch heads advance by
compare-and-swap, the editor and CLI share one versioned protocol, CLI-agent
writes require the minimum document or branch claim, and live refresh carries
metadata only.

Branch heads and claims are included because the authoritative Phase 3 plan
requires them. This phase defines only their minimum persistence contracts. It
does not introduce merge, cherry-pick, review comparison, annotations, handoff
workflow, MCP, Lineage adapters, publication, video, CRDTs, remote services, or
remote collaboration.

## Service and process boundary

Exactly one local service process may own a store. It binds only to loopback,
owns the operating-system advisory lock and every SQLite connection, and is the
only component allowed to create, migrate, read, or write the database. A
second service targeting the same store must fail before listening.

The service hosts or same-origin proxies the editor API and SSE endpoint. The
CLI uses the same generated protocol client as the editor. The editor, CLI,
compiler, and preview never open the database. Database files, WAL files,
discovery data, and capability material remain in service-owned user data
outside the repository and have restrictive permissions.

Persistence is behind a `ProjectStore` interface with these capabilities:

- immutable head and revision reads;
- atomic compare-and-commit;
- committed-idempotency lookup;
- branch and claim control transactions;
- migration and health verification; and
- durable subscription replay.

No SQLite type crosses this interface. Business validation and canonical
reduction remain pure domain code. Every storage adapter must preserve the same
atomicity, durability, idempotency, and ordering semantics.

## Storage schema

The tool-specific database contains these logical records:

- `schema_migrations(version, checksum, applied_order)`;
- `documents(document_id, last_revision)`;
- `branches(document_id, branch_id, head_revision, base_revision)`;
- `revisions(document_id, revision, parent_revision, canonical_json,
  canonical_digest, creating_event_id)`, keyed by document and revision;
- `events(commit_seq, event_id, document_id, branch_id, kind, operation_id,
  expected_revision, resulting_revision, request_digest, private_payload_json,
  sanitized_receipt_json)`, with operation IDs unique per document; and
- `claims(claim_id, document_id, nullable branch_id, token_hash, holder_kind,
  lease_version, expires_at)`.

Foreign keys and uniqueness constraints bind heads, revisions, events, and
claims. Event payloads are protected local project data; they are never
evidence receipts.

## Revisions and branch heads

Canonical revisions are document-wide unsigned monotonic integers. An imported
seed owns its initial immutable revision. Each accepted authoring operation
allocates exactly `last_revision + 1` inside its transaction. A rollback
allocates nothing.

Each branch head points to one immutable document revision.
`expectedRevision` must equal the addressed branch head. Branch creation names
an existing source revision and the expected source head, then creates a new
head pointer. It neither clones mutable state nor allocates a canonical
revision. Phase 3 adds no merge or review semantics.

## Atomic persistent transactions

The SQLite adapter uses `BEGIN IMMEDIATE`, `foreign_keys=ON`,
`journal_mode=WAL`, and `synchronous=FULL` for every persistent command.

An authoring transaction performs the following ordered work:

1. Check committed idempotency.
2. Read the branch head and compare `expectedRevision`.
3. Validate the authenticated claim context.
4. Run the pure typed reducer.
5. Validate and canonically serialize the result, then compute its digest.
6. Insert the event and immutable revision.
7. Advance the branch head by compare-and-swap.
8. Update the document revision counter.
9. Commit.

Any error rolls back every row and emits no refresh notification. A
notification is published only after commit.

Branch creation, claim acquisition, claim renewal, claim release, and human
claim revocation use the same connection settings and serialized transaction
boundary. In that transaction the service checks committed idempotency,
validates the command's expected document or branch revision and any applicable
`leaseVersion`, validates authenticated authority, inserts a durable control
event together with the branch or claim state change, and commits. Only after
commit may it publish the control notification or return a success as durable.

A stale, unauthorized, conflicting, or faulted control command rolls back the
entire transaction. It leaves events, branch heads, claims, lease versions,
document revisions, operation IDs, and the notification stream unchanged.

## Shared typed protocol

The editor and CLI import one versioned schema and one generated client. Every
persistent service mutation uses one common command envelope:

```text
protocolVersion
operationId
documentId
branchId
expectedRevision
command = { schemaVersion, type, payload }
```

`command` is a discriminated union covering authoring, branch creation, claim
acquisition, claim renewal, claim release, and human claim revocation. Each
command carries a unique `operationId`. `expectedRevision` names the applicable
target or source branch head, or the document revision when the command is
document-scoped. A lease mutation additionally carries its current
`leaseVersion` compare-and-swap precondition. No persistent mutation omits its
applicable revision precondition.

Operation payloads reference canonical element, track, cue, and keyframe IDs.
CSS selectors are allowed only as import or source-binding metadata; they can
never address a mutation or serve as stable identity.

Authenticated request context establishes editor-human or CLI-agent capability
and supplies any claim proof. Client-asserted envelope fields cannot establish
identity or authority. Authoring and persistent control commands remain
separate variants of the common versioned union, not separate wire protocols.

### Responses and CLI behavior

An authoring success is canonical JSON containing the protocol version,
operation ID, document and branch IDs, expected and resulting revisions,
canonical digest, operation digest, and a sanitized deterministic revision
receipt. A persistent control success uses the same canonical response framing
and identifies its control kind, expected revision, resulting head or document
revision, and applicable claim ID and lease version. It contains a sanitized
control receipt but never the claim secret.

Errors use the stable codes `VALIDATION`, `STALE_REVISION`,
`UNAUTHORIZED_CLAIM`, `OPERATION_ID_CONFLICT`, `UNSUPPORTED_VERSION`, and
`STORAGE_FAILURE`. A stale response may expose the current revision and digest,
but never document content. The CLI prints the same JSON and maps success,
validation, stale, unauthorized, conflict, and service failure to documented,
distinct exit codes.

### Idempotency and rejection

A committed `operationId` retried with an identical normalized request digest
returns the byte-identical stored response, even after the branch or claim has
advanced. This applies equally to authoring, branch creation, claim acquisition,
renewal, release, and human revocation. Reusing a committed ID with a different
request returns `OPERATION_ID_CONFLICT`. A rejected authoring or control request
creates no event and does not consume its ID.

A stale, unauthorized, conflicting, or faulted write performs no revision
allocation, event insertion, head change, claim change, lease-version change,
notification, or document mutation.

## Minimum claim contract

Every CLI-agent authoring write presents an active capability for either the
exact branch or its document. Before acquisition, the client generates and
retains a high-entropy claim secret. The acquisition command sends it only
through protected authenticated request context, and the service persists only
its verifier or hash. The raw secret never appears in the database, a control
event, a digest-visible receipt, a deterministic response, or logs. Because the
client retains the original secret and acquisition is idempotent, retry after a
committed-but-lost response returns the stored response without creating a
stranded or duplicate claim. Later authenticated requests may present the
secret only through protected request context.

Claims are exclusive across overlapping document and branch scopes. They are
leased, explicitly renewable and releasable, and revocable through an
authenticated human-editor control action. Acquisition names the current
document or branch revision. Renewal and release use claim ID plus
`leaseVersion` compare-and-swap. Expired, revoked, wrong-scope, or wrong-token
claims fail before reduction. Human editor writes still require
`expectedRevision`, but human writers are not converted into agent claims.

The service evaluates expiry once at a transaction-scoped instant, queries for
every overlapping active document or branch claim, and performs the exclusivity
check and claim insert or update inside the same serialized transaction. A
simple uniqueness constraint cannot represent document-versus-branch overlap
or lease expiry and is not the exclusivity mechanism. Concurrent overlapping
acquisitions therefore have exactly one winner; the rejected transaction leaves
claim and event state unchanged and does not consume its operation ID.

## Live refresh

The service publishes post-commit metadata through SSE, ordered by durable,
monotonically increasing `commit_seq`. Each event contains only document ID,
branch ID, revision, digest, and event kind. It never contains canonical content
or private payloads.

On receipt, the editor fetches the immutable revision through the service and
recompiles it through the existing compiler-backed preview. A reconnect sends
the last sequence for durable replay. If replay is unavailable, the service
requires a full head refetch.

Selection reconciles by canonical IDs. Unsubmitted form drafts remain visibly
stale and are never silently replayed. Service-backed undo and redo dispatch
ordinary typed inverse or replay operations with a fresh operation ID and the
current expected revision.

## Startup, crash recovery, and migration

Before accepting clients, the service acquires the store lock, verifies SQLite
integrity and referential consistency, and applies checksummed,
one-version-at-a-time migrations. Every migration is transactional and
preceded by a SQLite-consistent backup outside the repository.

An unsupported newer schema, checksum mismatch, corruption, or migration
failure fails closed without listening for writes. No client reconstructs or
overwrites the store. WAL recovery exposes either the complete committed
transaction or the prior state. On restart, the service validates every branch
head's referenced revision and digest before enabling mutation.

## Receipts and private-data boundary

Persistent copies of canonical documents and private operation payloads may
exist only as local project data in the protected store. An authenticated
service response may carry the selected immutable revision, and the editor,
compiler, and preview may hold that revision ephemerally in memory for editing,
compilation, and rendering. Those clients may not create persistent copies.
Evidence and revision receipts use canonical key ordering and contain only
schema and protocol versions, opaque IDs, revisions, inventory counts,
operation/canonical/export digests, and stable error codes.

Deterministic artifact receipts exclude raw copy, HTML/CSS, selectors, paths,
URLs, credentials, capabilities and claim tokens, actor names, database
locations, timestamps, screenshots, and event payloads. Operational lease
responses may contain expiry data but are not deterministic artifact receipts.
Equal immutable document revisions must compile to byte-identical exports and
artifact receipts.

## Product-invariant trace

The Phase 3 implementation must preserve all ten repository product invariants:

1. **One operation language.** The human editor and CLI import the same
   versioned schema and generated client, and parity evidence compares their
   canonical documents, digests, compiled bytes, and receipts.
2. **Sole persistent writer.** One locked loopback service owns every database
   connection; process-lock and import-boundary tests reject a second writer.
3. **Atomic expected revisions.** Every persistent command names its applicable
   revision and executes its compare-and-change within one transaction; service
   concurrency and fault tests prove unchanged state on rejection.
4. **Claim-bounded agent writes.** Every CLI-agent authoring command presents an
   active exact-branch or document capability, with overlapping-scope,
   expiry, revocation, and wrong-scope evidence in service tests.
5. **Selectors are bindings, not identity.** Mutation schemas accept only
   canonical IDs. Schema and browser tests reject selector-addressed mutations
   and prove selection identity survives source-selector changes.
6. **Unsupported imports fail visibly.** Existing fail-closed import inventory
   and unsupported-feature tests remain mandatory in the aggregate Phase 3
   verification; persistence may not convert an unsupported feature into a
   dropped or accepted record.
7. **Equal revisions are byte-identical.** Determinism and parity evidence
   compares canonical/export digests, compiled bytes, and sanitized receipts
   for equal immutable revisions, including repeated serialization.
8. **Preview renders compiler output.** SSE refresh fetches an immutable
   revision and invokes the existing compiler-backed preview; browser evidence
   proves the refreshed view uses that output rather than another interpolator.
9. **Browser-native HTML/CSS remains production output.** Existing compiler
   determinism tests and Phase 3 parity evidence compare native HTML and CSS
   bytes. Persistence and protocol layers introduce no alternate render format.
10. **Reduced motion stays inspectable and intentional.** Existing browser and
    reduced-motion verification remains in the aggregate Phase 3 gate, and the
    service transmits canonical revisions without silently rewriting their
    reduced-motion behavior.

## Rejected alternatives

- Editor- or CLI-owned SQLite connections, `localStorage` persistence, and
  shared database files are rejected because each creates a second writer.
- Separate editor and CLI reducers or wire formats are rejected because parity
  would be observational rather than contractual.
- Selector-addressed operations are rejected because ordinary source edits
  would change identity.
- Event-only replay is rejected because recovery would depend on replaying every
  historical reducer version. Snapshot-only storage is rejected because it
  cannot prove idempotency or atomic events. The selected design combines
  immutable per-revision snapshots with events.
- Filesystem watching or polling as the primary refresh mechanism is rejected
  because it lacks ordered post-commit semantics. The selected design uses
  durable service events followed by immutable refetch.
- Branch copies, mutable branch documents, CRDTs, merges, cherry-picks, and
  review workflows are rejected. Phase 3 needs only immutable revision pointers
  and branch-head advancement.
- SQLite triggers containing domain behavior or receipt generation are rejected
  because they couple the replaceable store to the domain model.
- Timestamps, payload excerpts, paths, selectors, and tokens are rejected from
  deterministic receipts.

## Ordered implementation slices

These are future implementation slices; this decision does not execute them.

1. **End-to-end durable authoring path.** Add the shared versioned envelope and
   generated client; one existing typed authoring operation; the locked
   loopback service; the `ProjectStore` contract and one SQLite migration; the
   atomic expected-revision event, immutable revision, and head commit; and a
   sanitized idempotent receipt. Invoke the operation through both the CLI and
   editor from identical fresh bases, publish one minimal post-commit SSE event,
   refetch the immutable revision into the compiler-backed preview, and prove
   focused byte parity and restart behavior plus Chrome QA. This slice does not
   implement branch creation or claims.
2. **Minimum branches and claims.** Add branch creation and head reads,
   CLI-agent document or branch leases, renewal, release, human revocation,
   client-retained claim secrets, idempotent control events, authorization
   failures, and atomic interaction with head revisions. Do not add merge or
   review behavior.
3. **Control recovery and refresh hardening.** Extend crash and lost-response
   injection across branch and claim controls; add SSE replay and refetch,
   stable-ID reconciliation, visible dirty-draft conflicts, crash injection,
   integrity checks, and migration failure behavior.
4. **Aggregate Phase 3 proof.** Complete private-data scanning, deterministic
   receipt repetition, invariant non-regression, full browser and Chrome
   evidence, and the aggregate Phase 3 gate. This proves the implementation; it
   does not add Phase 4+ behavior.

## Acceptance commands

The future implementation must expose these exact commands and evidence.

### `npm run test:phase3:service`

Prove second-service lock rejection and that no SQLite import exists outside the
service/store boundary. Prove one accepted compare-and-swap commit. With two
concurrent same-base writes, prove exactly one success and one
`STALE_REVISION`. Show that stale and invalid reducer requests leave all tables
and the head byte-for-byte unchanged. Prove exact idempotent retry, a
different-payload ID conflict, rejection of unauthorized, expired, revoked, and
wrong-scope claims, branch creation, and branch-local head advancement. Race
simultaneous document-versus-branch and same-branch claim acquisitions and show
exactly one winner. For every branch and claim control command, prove the common
expected-revision envelope, exact committed retry, conflicting-ID rejection,
atomic control event, and post-commit-only publish. Stale, unauthorized,
conflicting, and injected-fault controls must leave events, branches, claims,
lease versions, document revisions, consumed IDs, and the notification stream
byte-for-byte unchanged.

### `npm run test:phase3:recovery`

Inject process termination after begin, after event/revision insertion, before
commit, and after commit but before response. On restart, expose only the
complete pre-state or complete post-state. Prove that committed retry returns
the stored receipt, WAL recovery and head/digest checks pass, migration from N
to N+1 preserves canonical and export digests, an injected migration failure
leaves the old schema usable, and unsupported newer schemas and corruption
refuse writes. Apply the same fault matrix to branch creation and each claim
control, including termination after control-event/state insertion, before
commit, and after commit but before response. Simulate a lost claim-acquisition
response, retry with the same operation ID and client-retained secret, and prove
one claim plus the byte-identical stored response. After every rejected or
rolled-back control, prove all relevant tables and the notification stream are
unchanged.

### `npm run test:phase3:parity`

From two byte-identical synthetic fresh stores, submit the same typed operation
through the editor client and CLI client. Prove equal canonical documents,
canonical digests, compiled HTML/CSS bytes, export digests, and deterministic
revision receipts. Schema rejection, stale details, and structured error codes
must also match.

### `npm run test:phase3:browser`

Prove that a CLI commit emits one post-commit SSE event and that an open editor
fetches the committed immutable revision and renders compiler output. Prove
selection survives by canonical ID, selector changes do not change identity,
dirty drafts are marked stale and never auto-applied, and disconnect/reconnect
either replays from `commit_seq` or performs an explicit head refetch.

The future implementation must also run `npm run qa:chrome` against the real
post-persistence editor. Chrome QA must inspect a CLI-triggered live refresh;
visible dirty-draft staleness without silent replay; disconnect and reconnect
using ordered replay or explicit head refetch; exact compiler output with
browser-native CSS animations; selection retained by canonical ID; zero console
errors, uncaught exceptions, failed requests, or unexpected network activity;
and intentional, inspectable reduced-motion behavior.

### `npm run verify:phase3`

Run service, recovery, parity, browser, `npm run qa:chrome`, existing
unit/determinism/browser verification, typecheck, and build. Repeat
deterministic export and receipt serialization. Scan receipts and logs for raw
content, selectors, URLs, absolute paths, credentials, tokens, and database
locations. The aggregate gate may not pass without the post-persistence Chrome
QA scenarios above.

### `npm run check:sensitive && npm run check:private-ignore && git diff --check && git status --short`

Prove that no SQLite, WAL, backup, or discovery files; private fixtures; corpus
paths; screenshots; credentials; or payload-bearing receipts are tracked or
present in the implementation diff.

## Top failure modes and direct proof

1. **A hidden second writer or non-atomic compare-and-swap permits two
   same-base operations, a partial event, or a head without its revision.** A
   process-lock test, import-boundary inspection, two-client concurrency
   barrier, transaction fault injection, and before/after full-table snapshots
   must show one commit and one unchanged stale rejection.
2. **A crash, lost response, or interrupted migration duplicates an operation
   or leaves the event, revision, branch head, and receipt inconsistent.** A
   kill-point matrix covering authoring, branch, and claim control commits,
   followed by restart, integrity and head-digest verification, an identical
   committed-retry response, lost-response claim-acquisition retry,
   transactional migration failure testing, and unsupported-schema refusal
   provides the direct proof.
3. **Editor/CLI protocol drift or refresh reconciliation produces a different
   canonical result, overwrites a dirty draft, addresses by selector, or
   exposes private payload data.** Use an independent-store UI/CLI byte-parity
   test, real-browser CLI-write refresh with a dirty draft and stable-ID
   selection, schema rejection of selector-addressed mutations, deterministic
   receipt comparison, and sensitive-content scans.

## Phase 3 handoff claim

This architecture is ready for adversarial documentation review and, if that
review approves it, implementation planning in the four slices above. It does
not claim that persistence, CLI parity, branch claims, recovery, or live refresh
exists today. The three highest-risk claims remain sole-writer atomicity,
crash-safe idempotent recovery, and editor/CLI parity with safe refresh; each
must be established by the direct evidence named above before Phase 3 can pass.
