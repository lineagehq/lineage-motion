# Standalone Incubation Plan

## Decision

Build Lineage Motion as a separate experimental product first. It owns its app
surface, motion document, local service, persistence, CLI, importer, compiler,
preview, and visual-proof harness.

Do not place it in the current Lineage Canvas and do not share Lineage's SQLite
database or runtime profiles. Revisit integration only after the standalone
tool proves the complete workflow against real synchronized product demos.

## Smallest credible slice

The first slice imports one self-contained HTML/CSS coach-mark scene with a
seven-second master animation. The scene pressures the model with:

- nine keyframe rules and eight animation applications;
- shared rules applied to multiple elements with staggered delays;
- multiple simultaneous animations on one element;
- step timing, discrete visibility, typing simulation, cursor travel, click
  feedback, and editable DOM copy.

The slice must:

1. inventory every animation application and fail closed on unsupported input;
2. create a schema-versioned canonical motion document;
3. display every element/property track on one master timeline;
4. scrub, play, and pause the exact compiled CSS in a sandboxed live DOM;
5. export deterministic pure HTML/CSS without a production runtime; and
6. prove visual equivalence at stable frames and around discrete transitions.

## Phases

### Phase 0: Corpus contract and proof harness

Deliver:

- a local private-corpus manifest containing paths, hashes, and technical
  inventories only;
- synthetic public fixtures for continuous tracks, steps, delays, multiple
  animations, discrete states, cursor movement, copy, and holds;
- a browser capture harness with font and layout readiness;
- declared pixel-diff and semantic-inventory thresholds.

Exit gate: replay the original first-slice scene three times with equal frame
hashes in the controlled environment.

### Phase 1: Import, canonical document, scrub, and export

Deliver:

- fail-closed HTML/CSS inventory;
- canonical motion document;
- deterministic compiler;
- minimal read-only master timeline and live scrubber;
- pure HTML/CSS export and compiler receipt.

Exit gate: every expected rule, application, delay, simultaneous animation, and
step-timed track is represented, and exported frames pass visual proof.

### Phase 2: One complete human edit

Deliver stable selection, keyframe/cue dragging, value and easing editing,
inline copy editing, insert-hold and ripple-retime operations, undo/redo through
operation replay, and a reduced-motion snapshot.

Exit gate: a human extends the typing/reveal beat by 600 ms and preserves later
story order without editing CSS.

### Phase 3: Shared service, revisions, branches, and CLI

Deliver the sole-writer local service, tool-specific SQLite store, operation
envelopes, expected revisions, atomic events, branch heads, document/branch
claims, structured CLI parity, and live editor refresh after CLI writes.

Exit gate: UI and CLI produce the same canonical digest from the same base;
stale or unauthorized writes fail without partial changes.

### Phase 4: Coach-mark breadth

Import all five real coach-mark scenes. Add cursor path and click-pulse editing,
reusable click/type/select/drag/reveal/hold cues, annotations, review comparison,
handoff receipts, and performance instrumentation.

Exit gate: three materially different sequence-wide edits are faster and safer
than manually coordinating CSS percentages.

### Phase 5: Landing stress test

Import a 14-second landing animation with roughly 36 synchronized rules. Add
pseudo-element tracks, desktop/mobile variants, copy overrides, live cursor
targets, pause/resume/restart/in-view triggers, and authored reduced motion.

Exit gate: mobile choreography can diverge, a one-second hold can be inserted
before download, and everything after a cue can move by 8% without breaking
visual or interaction equivalence.

### Phase 6: Integration decision

Choose from evidence:

1. keep Motion standalone and let Lineage link to projects and exports;
2. import Motion receipts into Lineage as reviewable creative artifacts;
3. embed Motion as a first-party project workspace while preserving service and
   persistence boundaries;
4. share stable domain packages only after versioned contracts exist; or
5. stop or narrow the product if the source model does not survive the stress
   test.

## Immediate work package

Complete only Phase 0 and the read-only portion of Phase 1:

1. establish repository safety and private-corpus rules;
2. create domain/import/compiler/proof package boundaries;
3. inventory the first scene into a canonical document;
4. render and scrub compiled CSS in a sandboxed preview;
5. export deterministic pure CSS;
6. capture an evidence receipt and stop for architecture review.

Do not add persistence, claims, branching, CLI mutation, MCP, publication, or
Lineage integration until import/export fidelity passes.

## Failure modes

Stop or narrow the design if:

- the canonical model becomes a second general-purpose CSS language;
- editor gestures cannot be represented as clear structured operations;
- browser scrubbing or visual proof remains nondeterministic;
- stable element identity cannot survive ordinary source edits;
- the landing scene requires corpus-specific special cases instead of
  composable features; or
- standalone and Lineage databases, releases, or UI internals begin to couple
  before the adapter decision.
