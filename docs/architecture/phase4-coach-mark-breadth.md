# Phase 4 coach-mark breadth architecture

## Decision and scope

Phase 4 adds a deterministic authoring layer for coach-mark motion while
preserving the Phase 3 system boundary. A cue is a canonical, authoritative
authoring object that owns a materialized bundle of ordinary canonical tracks.
The compiler still consumes only those tracks, and the preview still displays
the compiler's browser-native output through browser-created animations. A cue
is not a runtime object, an interpolation engine, or an alternate compiler.

This decision covers five sanitized private-scene aliases, offline font
materialization, noncanonical import candidates, cursor path, click, reveal,
type, select, drag, hold, revision-linked annotations, read-only comparison,
sanitized handoff, and a paired performance gate. It authorizes architecture
only. It does not authorize product code, dependencies, schemas, migrations,
fixtures, private artifacts, publication, or implementation.

The four import ambiguities are resolved narrowly:

1. External resources may be satisfied only by owner-provided, digest-locked
   font stylesheets and font assets acquired out of band and used with zero
   network activity. This is not a generalized resource loader.
2. Scene C's transition remains unsupported unless the exact inert-transition
   proof below succeeds. That exception proves irrelevance; it does not add
   transition support.
3. Scene E participates through two explicit ledgers. Its pseudo-element
   motion remains a visible Phase 5 deferral rather than being dropped.
4. Import may emit ephemeral cue candidates, but only an explicit semantic cue
   operation can create canonical meaning.

The owner-facing claim is: Phase 4 can make the five-scene coach-mark breadth
ready for implementation as one deterministic CSS-animation authoring system,
with cues owning inspectable tracks, review data outside export identity, and
a reproducible safety-qualified two-times performance gate, without adding a
second runtime or silently weakening import fidelity.

## Five-scene grounded inventory

The aliases Scene A through Scene E are stable only for this sanitized
inventory. Counts, categories, timing constructs, and diagnostic codes are
observed facts. Candidate semantics are separate inferences and are never
canonical.

| Scene | Elements | Rules / offsets | Applications / slots / tracks | Animated property categories | Timing constructs | Current visible blockers | Sanitized candidates |
| --- | ---: | ---: | ---: | --- | --- | --- | --- |
| Scene A | 61 | 10 / 49 | 10 / 10 / 29 | position, opacity, transform, visibility, color/background | discrete visibility, infinite iteration | 1 unsupported; `IMPORT_EXTERNAL_RESOURCE` | cursor path, click pulse, select, drag |
| Scene B | 68 | 10 / 44 | 9 / 10 / 17 | position, opacity, width | multiple animation slots, infinite iteration | 1 unsupported and 1 missing; `IMPORT_EXTERNAL_RESOURCE`, `IMPORT_RULE_MISSING` | cursor path, reveal |
| Scene C | 47 | 11 / 52 | 11 / 11 / 27 | position, opacity, transform, color/background, font weight | negative delay, infinite iteration | 2 unsupported; `IMPORT_EXTERNAL_RESOURCE`, `IMPORT_TRANSITION_UNSUPPORTED` | cursor path, click pulse, select |
| Scene D | 44 | 9 / 53 | 8 / 9 / 20 | position, opacity, transform, width, color/background, border, shadow | steps timing, multiple animation slots, infinite iteration | 1 unsupported; `IMPORT_EXTERNAL_RESOURCE` | cursor path, click pulse, type, select, reveal, hold |
| Scene E | 52 | 9 / 41 | 8 / 8 / 22 | position, opacity, transform, color/background, border, shadow | infinite iteration | 2 unsupported; `IMPORT_EXTERNAL_RESOURCE`, `IMPORT_PSEUDO_ELEMENT_MOTION` | cursor path, click pulse, select, reveal |

Every untouched scene currently fails closed and produces no acceptable
canonical document. Scene D is the first implementation slice because it is
the smallest inventory and contains candidate evidence for cursor travel,
click pulse, and synchronized reveal while also pressuring steps and multiple
slots. That ranking does not confirm semantics: the implementation gate must
still establish explicit target identity, press and release boundaries,
reveal synchronization, and complete construct accounting in the browser.

Scene B stays `IMPORT_RULE_MISSING` until the owner supplies a private,
digest-locked correction. The system must never invent, reconstruct, or infer
the missing motion. Only sanitized evidence of the correction may leave the
private acceptance environment.

Scene C may replace `IMPORT_TRANSITION_UNSUPPORTED` with the warning
`IMPORT_TRANSITION_INERT` only when the importer has source-bound proof that no
reachable state activates the declaration and installed Chrome reports zero
transition animations plus exact rendered equality against a comparison with
the declaration removed. If reachability is unknown or either browser check
is absent or unequal, canonical output is null and import fails closed.

Scene E has two ledgers. The untouched-source ledger retains the exact pseudo
diagnostic and exact pseudo application count and remains a failure. A
deterministic private acceptance projection may remove only pseudo
applications, must retain all non-pseudo applications, and binds the original
source digest, projected-source digest, removed application count, and removed
diagnostic code. The projection may prove only non-pseudo breadth participation;
it never proves source fidelity or Phase 4 pseudo support.

## Import and candidate boundary

Offline resource materialization accepts only owner-provided, digest-locked
font stylesheet bytes and font asset bytes. Acquisition happens out of band;
import, compilation, preview, proof, and export perform zero network requests.
The lock record binds all of the following:

- original source digest and the exact resource-reference count;
- stylesheet bytes and stylesheet digest;
- for each font, a path-independent font ID, MIME type, byte count, and digest;
- an aggregate digest over the ordered font manifest; and
- the materialized-source digest.

The preprocessor rewrites only the locked font references into the closed
materialization. A missing or extra reference, byte or digest mismatch,
redirect, nested resource, executable resource, motion-bearing resource,
unsupported resource kind, or surviving live resource fails closed. No
fallback fetch, discovery, recursive loading, MIME guessing, or generalized
loader is permitted.

An import report may carry a candidate sidecar. The sidecar is ephemeral: it
is never canonical, persisted, exported, compiled, revisioned, or accepted as
an operation. It cannot affect document, compiler, export, revision, or receipt
digests. Candidate IDs are display handles only and can never address a
mutation.

Candidate confidence is exactly `low`, `medium`, or `high`:

- `low`: one observed evidence pattern;
- `medium`: at least two independent patterns, including timing evidence; and
- `high`: at least three independent patterns, including target proximity and
  a coincident boundary.

Evidence kinds are closed to `position-trajectory`, `transform-pulse`,
`progressive-reveal`, `stepped-text-progress`,
`discrete-visibility-boundary`, `stable-interval`, `target-proximity`,
`coincident-boundary`, and `multi-element-synchrony`. A candidate contains
only the source digest, opaque IDs when available, category, integer time
range, evidence-kind counts, and total evidence count. It contains no source
text, selector, copy, inferred product meaning, or geometry payload.

Acceptance requires a deliberate `motion.cue.create` operation that supplies
every semantic field required by the chosen cue kind. The operation uses
stable canonical target IDs and freshly derived cue identity, never a
candidate ID. Import candidates therefore shorten inspection without silently
assigning semantic truth.

## Canonical cue and generated-track contract

A versioned `CueExpansionInput` is the sole input to expansion. It contains the
cue schema version and stable cue ID; versioned cue kind; ordered semantic
role-to-target stable IDs; integer named moments; typed parameters; generator
ID and version; and an ordered snapshot of each referenced target's stable ID
plus the byte-canonical, expansion-relevant target state declared by that
generator version. A replacement-enabled input also contains the ordered
stable source track IDs and expected replacement-input digest described below.
This explicit target snapshot prevents ambient document lookup from changing
expansion. `CueExpansionInput` never contains candidate IDs, generated track or
keyframe IDs, the expansion-input digest, the expansion digest, ownership
metadata, or any other expansion output.

The expansion-input digest is the digest of the versioned byte-canonical
`CueExpansionInput`. The pure versioned generator derives every track and
keyframe ID from the input cue ID, generator ID and version, semantic target
role, property role, and explicit ordinal, then emits an ordered expansion
core. The expansion digest is the digest of that byte-canonical core, including
its derived IDs and content but excluding the expansion digest and attached
ownership metadata. Only after both digests exist does the reducer form the
canonical cue projection, which stores the input fields, ordered generated
track IDs, both digests, and attached ownership state, and annotate installed
tracks with owning cue ID, generator ID and version, target-role ordinal, and
expansion digest. Thus no digest, generated ID, or ownership output is an input
to its own derivation. IDs never derive from array position, a selector,
wall-clock data, randomness, or candidate identity.

Reading or mutating an attached cue always reconstructs `CueExpansionInput`
from its stored semantic fields and the explicitly referenced current target
state, recomputes both digests and all derived IDs and content, and compares
them byte for byte with the stored cue and owned bundle before proceeding. A
target-state change that affects expansion therefore requires an explicit cue
update; drift, a missing target, or any mismatch fails atomically rather than
silently regenerating ownership.

For hold and any deliberate conversion of existing imported motion, the create
payload must name a `replacedSourceBundle`. It contains ordered stable source
track IDs, the exact byte-canonical source tracks and keyframes in canonical
order, and an expected replacement-input digest over that ordered bundle. It
never accepts candidate IDs. Creation validates that every named ordinary
source record exists byte for byte at the expected digest, that the complete
replacement scope is accounted for, and that no source or generated property
scope overlaps any remaining ordinary or cue-owned track. In the same atomic
revision it removes the validated source bundle and installs the owned
replacement; source and replacement can never be simultaneously authoritative.

Creation, update, and deletion are typed operations:

- `motion.cue.create` validates the complete cue and any
  `replacedSourceBundle`, derives all IDs, expands the whole bundle, and
  atomically performs the source removal and cue-plus-owned-bundle install.
  Its exact inverse removes that installed cue and bundle and restores the
  complete source bundle at its original IDs, order, and bytes.
- `motion.cue.update` names the cue, its current expansion digest and
  replacement-input digest when present, and the new complete semantic state.
  For any cue with a `replacedSourceBundle`, update must preserve byte for byte
  the stored source tracks and keyframes, the same ordered stable source track
  IDs, and the same replacement-input digest. It may regenerate the owned
  bundle only from semantic fields whose change leaves that source boundary
  unchanged. Any desired source-scope change is not an update: a separately
  expected-revision `motion.cue.delete` must first restore the exact stored
  source bundle, followed by a separately expected-revision
  `motion.cue.create` that validates, removes, and captures the new complete
  source bundle. Each committed forward state therefore contains either the
  restored ordinary source or one replacement-owned generated bundle, never
  missing source records or simultaneous source and generated authority. The
  update inverse restores the exact prior cue and owned bundle against the
  unchanged stored boundary. No update may absorb, replace, discard, or widen
  an implicit or overlapping source scope.
- `motion.cue.delete` names the cue and expected expansion digest and, when
  present, replacement-input digest. It atomically removes the cue and its
  entire owned bundle. For a replacement-enabled cue it simultaneously
  restores the exact stored `replacedSourceBundle`; for a cue without one it
  installs no source. Its exact inverse removes that restored source when
  applicable and reinstalls the exact deleted cue, ownership, and bundle.

Each operation records an exact inverse containing all prior canonical records
and any source bundle needed by the lifecycle above. Undo and redo use that
inverse or its exact forward record through ordinary fresh expected-revision
operations; they revalidate all named records and digests and reproduce exact
cue, source, track, keyframe, compiler, and export bytes. They never rerun an
import candidate or infer replacement membership.

Attached generated tracks are inspectable but not independently editable.
Any direct track or keyframe operation that targets them rejects with
`CUE_TRACK_LOCKED`. Expansion rejects atomically on an ID collision, owned or
ordinary track overlap, missing target, unsupported property, invalid moment,
or input/expansion digest mismatch. It allocates nothing and publishes
nothing. Tracks outside the affected owned bundle remain byte-identical.

`motion.cue.detach` names a cue, expected expansion digest, and any expected
replacement-input digest. In one revision it removes the cue, its ownership
metadata, and its live `replacedSourceBundle` contract while preserving only
the generated records as ordinary tracks with the exact track IDs, keyframe
IDs, values, order, timing, and byte-identical immediate compiler and export
output. It does not restore the replaced source, because doing so would create
dual authority. The private exact inverse retains the complete cue, ownership,
and replaced-source contract; undo first verifies the detached ordinary bundle
is unchanged and then restores that exact attached state without changing its
bytes. Redo performs the recorded detach exactly. Both use fresh expected
revisions and reject atomically after intervening edits rather than infer a
reattachment, regenerate bytes, or create a new identity. There is no general
reattach operation and no bidirectional cue/track synchronization.

## Cue semantics

Every cue operates on existing stable elements. No cue creates runtime DOM,
runs production JavaScript, or depends on dynamic target discovery. Every
moment is a nonnegative integer millisecond, ordered according to its cue
contract, and within the document duration. Every duration is a positive
integer millisecond.

### Cursor path

`cursor-path` names the cursor target, stage-normalized integer parts-per-million
coordinates, ordered waypoints, `start` and `arrive` moments, and easing. An
optional stable target anchor may explain intent, but compilation always uses
stored coordinates. Re-anchoring is a separate explicit cue update that writes
new coordinates; target layout never silently changes the path.

### Click

`click` names cursor and pulse targets; ordered `arrive`, `press`, `release`,
and `pulse-end` moments; and integer scale, radius, and opacity parameters. It
may reference an explicit reveal cue ID, but that reference only validates and
coordinates named boundaries. It does not hide or synthesize the reveal.

### Reveal

`reveal` names an ordered target list and `start` and `complete` moments. It
materializes opacity and visibility tracks with both sides of every discrete
visibility boundary represented for proof.

### Type

`type` names one existing text target, `start` and `complete` moments, and a
positive integer step count. It changes reveal progress only; it cannot change
copy, create text, or use a runtime typing loop.

### Select

`select` names cursor and selected targets, an optional existing highlight
target, and ordered `approach`, `choose`, and `settle` moments. Selection is
visual choreography only and adds no application state.

### Drag

`drag` names cursor and dragged targets, stage-normalized integer geometry and
ordered waypoints, and ordered `approach`, `press`, `move-start`, `arrive`, and
`release` moments. Retargeting writes explicit endpoint geometry and target ID;
layout movement never silently changes the stored path.

### Hold

`hold` names `enter` and `exit`, a positive duration, and an ordered affected
scope of stable targets plus the ordered stable source track IDs in its
digest-checked `replacedSourceBundle`. It materializes replacement canonical
tracks for exactly that scope and shifts later affected timing without changing
earlier content. It may not coexist with the removed source or overlap any
unaccounted ordinary or owned track. This reusable expansion removes the
future need for the current fixture-specific compiler projection. Delete
restores the exact source bundle; detach instead leaves only the materialized
tracks as ordinary tracks with identical immediate compiled bytes, with exact
undo/redo governed by the lifecycle above.

## Compiler and preview invariance

The compiler accepts a validated `MotionDocument` containing materialized
canonical tracks. It never interprets, expands, schedules, or interpolates
cues. The preview renders the compiler's exact HTML and CSS bytes and observes
browser-created animations; it has no cue runtime or separate interpolator.
Production output remains browser-native HTML/CSS and uses only existing DOM.

Equal document revisions produce byte-identical canonical bytes, compiled HTML
and CSS, compiler receipts, export bytes, expansion receipts, and proof
manifests for equal proof inputs. Handoff identity additionally uses the
complete immutable tuple defined below. Candidate sidecars and annotations are
noninterfering: adding, removing, or resolving either cannot change canonical,
compiler, preview, export, expansion, proof, or revision identity.

Acceptance captures exact preview bytes and the browser animation inventory.
Installed-Chrome proof samples stable intervals and both sides of every
discrete boundary for click, reveal, select, drag, type, and hold. It also
proves intentional reduced-motion output, exact repeated bytes, zero console
or page errors, zero failed requests, and zero unexpected network activity.

## Service, revision, claim, and history contract

The editor and CLI dispatch the same strict versioned cue operations through
the shared protocol. The loopback local service remains the sole persistent
writer. Every authoring command names document, branch, operation ID, expected
branch revision, and typed payload; a CLI-agent command additionally presents
an active document or branch claim through authenticated context.

For a valid cue create, update, delete, detach, undo, or redo, one transaction
performs validation and pure reduction, inserts one private event and one
immutable revision, advances one branch head, and stores one sanitized receipt.
Only after commit may it publish one refresh notification. Invalid, stale,
unauthorized, conflicting, or faulted requests allocate and publish nothing:
no event, revision, head advance, consumed operation ID, ownership change, or
notification.

An identical retry of a committed normalized request returns the byte-identical
stored response. Reusing the operation ID with a different request rejects.
Undo and redo are private inverse/replay operations with fresh operation IDs
and current expected revisions; they do not rewind heads or mutate history.
Private event payloads may hold the exact inverse, but sanitized receipts never
expose semantic payloads or private evidence.

## Annotations, comparison, and handoff

Annotations live in a service-owned store outside `MotionDocument`, canonical
serialization, compilation, preview bytes, export, and canonical revision
allocation. An annotation has a stable annotation ID, document ID, immutable
document revision, stable element or cue anchor, optional integer time range,
private body, `open` or `resolved` state, and annotation version.

The local service is their sole writer. The shared editor/CLI protocol requires
authenticated authority, an applicable expected annotation version and
document/branch revision, and an agent claim for agent writes. Compare-and-swap,
idempotent private events, and atomic rejection follow the Phase 3 transaction
rules, but successful annotation mutations do not allocate a canonical motion
revision. Allowed actions are exactly create, edit, resolve, reopen, and
delete. There are no approvals, assignments, merge/apply actions, publishing,
status taxonomies, notifications, or project-management workflow.

Comparison is a read-only view of two immutable revisions. It may display only
sanitized operation kinds, stable IDs, cue timing, track/compiler/export
digests, and sample hashes. It cannot merge, apply, mutate, accept, or promote
either side.

The deterministic handoff receipt uses a versioned sanitized schema and an
allowlist. It may contain scene alias, opaque document/branch/revision/element/
cue/track IDs, counts, stable diagnostic codes, canonical/compiler/export/
expansion/proof digests, and open/resolved annotation counts. It excludes note
bodies, source-derived proof payloads, benchmark private details, source copy,
branding, selectors, filenames, filesystem locations, resource locations, and
screenshots.

A versioned `HandoffIdentityInput` is the complete immutable identity for those
bytes. It binds the handoff schema and serializer versions; opaque document and
branch IDs; the immutable document revision ID and canonical document digest;
an immutable annotation snapshot version and digest; and ordered, versioned
identity records for every comparison, proof, or benchmark item actually
included. A comparison identity record binds both immutable revision IDs and
canonical digests plus every included compiler, export, and sample digest. A
proof identity record binds its proof schema, input/manifest digest, browser
environment digest, and every included result digest. A benchmark identity
record binds its record schema, locked-baseline, allowlist, environment, task,
repetition, input, and output digests. An absent category is represented by an
explicit empty ordered list, so omission cannot alias a different input.

The annotation snapshot is allocated immutably by the sole writer from an
exact ordered annotation-version set at the bound document revision. Its
digest covers the private canonical snapshot, while the handoff exposes only
allowlisted counts and never bodies. Receipt bytes and the handoff digest are a
pure byte-canonical derivation of the complete `HandoffIdentityInput` and its
allowlisted projection. Equal complete tuples produce byte-identical handoff
bytes; document revision equality alone makes no handoff-identity claim.
Creating, editing, resolving, reopening, or deleting an annotation allocates a
new annotation snapshot identity when requested for handoff, but never changes
the canonical document revision, compiler/export bytes, or their identities.

## Paired benchmark contract

Every run starts from the same byte-identical locked baseline and uses the same
installed Chrome version, machine, viewport, digest-locked fonts, written task
instructions, trained operator, validation commands, and proof thresholds.
The exact paired tasks are:

1. **Scene D:** delay click press by 400 ms while preserving press/release and
   pulse intervals and the synchronized reveal relationship.
2. **Scene A:** retarget the drag endpoint to the second explicit target and
   extend the drag by 300 ms while rippling all later beats.
3. **Hold:** insert a 600 ms hold at reveal-complete and shift every later
   affected track without changing any earlier track.

Each method/task pair runs three repetitions. Method order alternates CSS first
and Motion first across repetitions and tasks according to a precommitted
allowlist schedule; no run is discarded. The task result is the median of its
three active times. Phase 4 passes only if, for every task,
`median(Motion) <= median(CSS)`, and
`sum(task Motion medians) <= 0.50 * sum(task CSS medians)`.

Active time begins at the first editing input and ends only after successful
validation and export. Diagnosis, correction, and rework remain active.
Identical automated proof waits may be paused for both methods only; every
pause and duration is recorded. Setup before the first editing input is fixed
by the locked baseline and written instructions.

The CSS method is manual text editing only: no macros, scripts, prepared search
and replace, or generated patches. The Motion method uses only the shipped
editor or CLI available to ordinary users: no feature flags, benchmark
automation, direct database access, raw CSS percentage editing, or hidden
commands. Both methods must reach the same allowlisted expected output.

The sanitized benchmark record contains method, task alias, repetition,
alternating order, ordered action kinds, action counts, active duration, paused
proof duration, input/output digests, allowlist digest, and environment digest.
It includes no source excerpt, private identifier, operator identity, or path.

Every Motion run must prove all of the following before its time is eligible:

- zero change outside the intended region and byte-identical unowned tracks;
- stable-interval and both-sides discrete-boundary visual proof;
- byte-identical canonical, compiler, export, expansion, and handoff output on
  repetition;
- zero installed-Chrome errors and zero network requests; and
- one undo that restores the exact baseline canonical and export digests.

A failed safety proof fails the benchmark; it is never converted into a slower
or excluded observation. All repetitions remain recorded.

## Ordered implementation slices

These are future slices and this document does not authorize them. Their order
is exact:

1. **Scene D cursor-click-reveal.** Close its authorized offline font blocker;
   explicitly author cursor-path, click, and reveal cues; exercise shared
   editor/CLI operations, sole-writer expected revisions and claims, atomic
   ownership and detachment, compiler-backed preview, installed-Chrome stable
   and discrete proof, reduced motion, determinism, and privacy receipts.
2. **Reusable type-select-drag-hold.** Add the remaining reusable semantics and
   their complete owned bundles, including replacement-track hold expansion,
   through the same protocol, persistence, compiler preview, browser proof,
   history, privacy, and rejection paths. This is not a helper-only schema
   slice.
3. **Five-scene import closure and explicit deferrals.** Exercise all five
   aliases end to end; apply only locked offline fonts and an owner-supplied
   Scene B correction; prove or reject Scene C inertness; retain both Scene E
   ledgers; and prove candidates noncanonical across service, compiler,
   preview, browser, receipt, and privacy boundaries.
4. **Revision-linked review and handoff.** Implement annotation create/edit/
   resolve/reopen/delete, immutable comparison, and sanitized deterministic
   handoff through the sole writer, authorization, expected versions/revisions,
   claims, compiler/export noninterference, browser proof, and private-body
   scans.
5. **Paired performance and aggregate gate.** Run the exact benchmark and the
   complete five-scene aggregate proof, including protocol parity, sole-writer
   atomicity, compiler-native preview, installed Chrome, privacy, determinism,
   undo restoration, per-task safety, and the aggregate two-times formula.

Each slice is an end-to-end user-visible vertical slice. None may land as only
a schema, reducer, generator helper, importer helper, service endpoint, UI
control, or proof utility disconnected from the full protocol-to-browser path.

## Proof, privacy, exclusions, and failure modes

The proof and privacy digest map is closed and path-independent:

| Boundary | Required digests | Direct non-digest evidence |
| --- | --- | --- |
| Import | original source, font stylesheet, each font, aggregate font manifest, materialized source, canonical document | imported/unsupported/missing inventories, reference counts, diagnostic codes, zero network |
| Scene C inertness | bound source and declaration-removed comparison | reachability certificate, zero Chrome transition animations, exact rendered equality |
| Scene E projection | original source and deterministic projected source | exact pseudo diagnostic/count, removed count/code, complete non-pseudo inventory |
| Cue expansion | expansion input and expansion output | ordered owned IDs, generator/version, collision and lock rejection |
| Compiler and preview | canonical, compiled HTML, compiled CSS, compiler receipt, export | exact preview bytes, animation inventory, stable and discrete samples, reduced motion |
| Service and history | normalized operation, canonical revision, sanitized revision receipt | one event/revision/head advance, unchanged rejection, idempotent response, exact undo/redo |
| Review and handoff | compared revisions, compiler/export/sample outputs, handoff receipt | opaque IDs, counts/codes, open/resolved counts, no private bodies |
| Benchmark | baseline, allowlist, environment, each input/output | ordered actions, counts, durations, pauses, repetition/order, all safety assertions |

Evidence files and receipts may contain only sanitized aliases, opaque stable
IDs, integer counts and ranges, closed diagnostic/evidence/action kinds, and
full cryptographic digests. They exclude private source, copy, branding,
selectors, filenames, filesystem locations, resource locations, screenshots,
payloads, credentials, private annotation bodies, and digest fragments.
Private acceptance inputs remain outside the repository.

Rejected alternatives are:

- live fetching, fallback fetching, a generalized resource loader, invented
  Scene B rules, unproven transition dropping, silent pseudo omission, and
  Phase 4 pseudo-element implementation;
- persisted or canonical cue candidates, candidate-addressed mutations,
  automatic semantic cue inference, cue-time compilation, a runtime cue
  interpolator, direct editing of attached tracks, nondeterministic IDs,
  reattach inference, or bidirectional cue/track synchronization;
- annotations inside the motion document or export, mutable comparison,
  approval/assignment/merge/publish workflow, and payload-bearing handoff; and
- benchmark-only automation, inconsistent tools or environments, discarded
  runs, unrecorded proof pauses, and a speed claim without every safety gate.

The top three realistic failure modes and required falsification are:

1. **Cue and track authority diverge or detach/history changes output.** Prove
   pure expansion, stable derivation, locked direct edits, atomic collision and
   digest rejection, byte-identical unaffected bundles, identical bytes across
   detach, and exact undo/redo restoration through service receipts and
   compiler comparison.
2. **Import/review shortcuts omit behavior or leak private material.** Prove
   full five-scene inventories; font-lock failures; Scene B owner correction;
   Scene C reachability and Chrome equality; both Scene E ledgers; candidate and
   annotation noninterference; zero network; and allowlist privacy scans.
3. **The performance claim is gamed, noisy, or unsafe.** Prove the locked
   environment, alternating three-run schedule with no discards, manual CSS
   and shipped Motion tooling, recorded active-time rules, per-task medians,
   aggregate formula, every per-run safety assertion, and exact undo digests.

Stop after architecture review. A separate accepted goal and fresh worktree
must authorize implementation. Phase 5 pseudo-element breadth, landing-scene
stress work, responsive variants, live cursor targets, triggers, MCP, Lineage
integration, release, publication, and deployment remain explicitly excluded.
