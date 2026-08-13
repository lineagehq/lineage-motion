# Phase 2 Track Creation and Timing Controls

## Objective

Extend the reviewed Phase 2 authoring loop with one complete structural creation
workflow in the neutral synthetic scene: add and remove a keyframe, edit one
animation slot's duration, delay, and easing, and create one new supported
property track. Every action must use schema-versioned typed expected-revision
operations, preserve stable identity and referential integrity, recompile through
the deterministic compiler, update the browser-native preview, participate in
undo/redo, and withstand controlled visual and privacy proof.

## Original Request

Continue after integrating the reviewed Phase 2 value/time editing checkpoint.
Prepare the next authoring slice: add/remove keyframes, edit duration, delay, and
easing, and create one new property track while preserving typed operations,
expected revisions, undo/redo, deterministic compilation, and native preview.

## Intake Summary

- Input shape: `existing_plan`
- Audience: Lineage Motion architecture owner and future motion authors
- Authority: `approved`
- Proof type: `demo`
- Completion proof: fresh automated, controlled-Chromium, installed-Chrome,
  private-regression, safety, type, build, and diff evidence proves the entire
  create/edit/remove/history loop and the explicit owner-review stop.
- Goal oracle: in Chrome, one neutral scene can gain a supported property track
  and keyframe, have its slot timing edited, then remove that keyframe; compiler
  output/native playback reflect each state and undo/redo exactly restore it.
- Likely misfire: ship generalized timeline controls or UI-local mutations that
  bypass canonical operations/compiler output, silently allocate unstable IDs,
  weaken visual proof, or cross into persistence and collaboration architecture.
- Blind spots considered: deterministic identity allocation; rule/application/
  slot/track referential integrity; minimum keyframe constraints; shared-rule
  effects; master-time reprojection after duration/delay edits; easing grammar;
  reduced motion; focus after structural rerenders; intentional visual-delta
  containment; private regression and sanitized evidence.
- Existing plan facts: local `main` includes the reviewed value/time authoring
  slice at `60a4cad`; the next slice adds/removes keyframes, edits duration,
  delay, and easing, and creates exactly one new supported property track; later
  Phase 2 platform breadth and all Phase 3 capabilities remain deferred.

## Goal Oracle

The oracle for this goal is:

`In controlled and installed Chrome, a user creates one supported property
track on a neutral element, adds a keyframe, edits the relevant slot's duration,
delay, and bounded easing, removes the added keyframe, and inspects every state
through the exact deterministic compiler output and browser-created CSSAnimation
objects. Every command uses the shared typed expected-revision reducer; rejected
commands are atomic; undo/redo restore revision-neutral canonical content,
export bytes, and corresponding visual states exactly; private acceptance and
repository-safety gates remain clean.`

The PM must compare every task receipt to this oracle. Schemas, isolated domain
tests, controls, or one successful mutation are not completion. A final Judge
must map fresh direct evidence to the complete workflow and record
`full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Complete one bounded structural-authoring vertical slice and stop for owner
review. T001 first validates the exact existing canonical structures and chooses
one already-supported neutral target/property plus operation semantics. T002
then owns the complete domain-to-Chrome slice. T999 adversarially audits the
result. Corrective work may be added only for concrete defects inside this
tranche.

## Grounded Acceptance Criteria

### Typed structural operations and identity

- The editor and future adapters share one schema-versioned domain dispatch
  boundary; the UI never directly mutates canonical objects or preview CSS.
- T001 defines exact typed operations for keyframe add/remove, slot duration,
  slot/application delay, bounded easing, and track creation. Every operation
  includes caller-supplied operation identity, document identity, and expected
  revision.
- T001 chooses exactly one supported property and neutral target already
  expressible by the current domain/compiler. No importer or general CSS grammar
  expansion is allowed.
- New rule, application, slot, track, and keyframe identities—whichever the
  existing model actually requires—are deterministic, validated, independent
  from selectors, collision-safe, and stable across unrelated edits.
- Creation and deletion preserve all rule/application/slot/track/keyframe
  references. Missing, duplicate, mismatched, shared, or unsupported targets
  reject with deterministic sanitized diagnostics and no partial document.
- Keyframe ordering, offset/time representation, collision behavior, allowed
  insertion range, and minimum remaining keyframe count are explicit. There is
  no sorting, merging, clamping, silent ID replacement, or coercion.

### Duration, delay, and easing

- Duration and delay edit canonical typed timing fields rather than generated
  CSS text. Their integer-millisecond ranges and zero/negative behavior are
  explicit and validated.
- Master-time projection after duration or delay changes is deterministic and
  visible in the timeline; canonical normalized keyframe offsets remain stable
  unless the approved operation explicitly changes them.
- Easing is restricted to a T001-approved subset of the existing typed grammar.
  Invalid keywords, parameter counts/ranges, strings, or property values fail
  closed; there is no free-form CSS escape hatch.
- Shared rules/applications or multi-slot effects that could change more than
  the selected scope are rejected unless T001 proves the exact intended bounded
  semantics.

### History, compiler, preview, and accessibility

- Every successful create/edit/remove/undo/redo increments revision exactly
  once. Rejections change no document, revision, consumed-ID set, history,
  selection, compiler bytes, iframe, animation state, or success feedback.
- Undo/redo replay structural operations through the same validated reducer,
  not snapshot assignment or a parallel mutation path. A successful divergent
  edit clears redo; rejected edits preserve it.
- Corresponding history states have byte-identical revision-neutral canonical
  content and exports. Full document bytes remain revision-bearing.
- Every success recompiles through the existing deterministic compiler and
  mounts exact compiled HTML in the sandboxed preview. Scrub/play/pause continue
  to control browser-created CSSAnimation objects; no JavaScript interpolator or
  per-frame style writes are introduced.
- Minimal controls use native keyboard/pointer interactions, labeled inputs,
  visible and announced validation, correct disabled history states, focus
  continuity after structural rerender, and an inspectable reduced-motion view.
- The selected new track remains visually linked to its preview element without
  mutating compiler output.

### Adversarial proof

- User-facing claim: “The editor can now create and reshape a bounded CSS
  animation structure—not only edit existing values—while retaining canonical
  safety, native playback, deterministic export, and reversible history.”
- Leading failure mode 1: orphaned/unstable identity or hidden shared effects.
  Direct domain and compiler evidence must prove referential integrity, stable
  IDs, target isolation, and atomic rejection.
- Leading failure mode 2: UI-only mutation, timing reprojection drift, or a
  second animation engine. Browser evidence must prove exact compiler srcdoc,
  native CSSAnimation ownership/currentTime, projected timeline times, and no
  direct preview mutation.
- Leading failure mode 3: nondeterministic history/visual output, private
  leakage, or phase expansion. Repeated export, exact history-state captures,
  private regression, sensitive scans, and complete-diff inspection must defeat
  it.
- Controlled proof uses the pinned deterministic Chromium environment, waits
  for DOM/fonts/layout/semantic/raster stability, blocks network, and samples
  stable moments plus both valid sides of every new, moved, removed, discrete,
  or steps boundary affected by duration/delay/easing/track creation.
- Intentional before/after differences are confined to the chosen target region
  plus a declared antialias margin, with unchanged non-target properties and
  zero changed pixels outside the approved region. History-equivalent states
  require exact independently captured pixel equality.
- Equal states compile at least three times to byte-identical HTML, CSS, export
  digest, and compiler receipt. Sanitized evidence records only schema/tool
  versions, counts, IDs/digests, diagnostics, timings, convergence, and aggregate
  diff results—never private paths, content, selectors, branding, or screenshots.

## Non-Negotiable Constraints

- Work only in `.worktrees/phase2-track-creation-slice` on
  `codex/phase2-track-creation-slice`.
- Use only neutral synthetic content for authoring. Private acceptance inputs
  and outputs remain ignored, local, and read-only.
- Do not expand or change the CSS importer for this slice.
- Create exactly one property track; do not build generalized multi-track,
  drag/drop, free-form CSS, responsive, trigger, composition, timeline/range,
  or arbitrary-easing authoring.
- No persistent database, sole-writer service, CLI, MCP, claims, branches,
  annotations, review workflow, collaboration, Lineage adapter, React/Tailwind
  round-trip, landing-animation implementation, video export, publication,
  release, push, or pull request.
- Preview renders compiler output and controls browser-created animations.
- Unsupported behavior fails visibly and atomically.
- Preserve unrelated user changes and never use destructive Git commands.

## Stop Rule

Stop only when the final Judge proves the full oracle, explicitly disposes of
the three realistic failure modes, records `full_outcome_complete: true`, and
hands the result back for owner review. Do not proceed to broader Phase 2 or
Phase 3.

Do not stop after contract design, one operation, or isolated unit tests while
the approved end-to-end creation/history/Chrome workflow remains safe to finish.
If the final audit finds a concrete in-scope defect, add the smallest corrective
Worker package and repeat the final audit.

## Slice Sizing

One Worker owns the complete reversible vertical slice: typed structural
operations, canonical state/history, compiler support, minimal authoring UI,
native preview, automated tests, controlled visual proof, installed-Chrome QA,
and sanitized evidence. Do not split individual controls or operation helpers
into tiny tasks.

## Board Health

The PM owns board health. If the board is stale or inconsistent, run:

```bash
node <goalbuddy-skill-path>/scripts/check-goal-state.mjs docs/goals/phase2-track-creation-slice
```

## Canonical Board

Machine truth lives at:

`docs/goals/phase2-track-creation-slice/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status,
active task, receipts, verification freshness, and completion truth.

## Run Command

```text
Codex: /goal Follow docs/goals/phase2-track-creation-slice/goal.md.
Claude Code: /goalbuddy Follow docs/goals/phase2-track-creation-slice/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter, the execution contract, and `state.yaml`.
2. Run the GoalBuddy update checker and re-check the original outcome, oracle,
   constraints, existing-plan facts, likely misfire, and blind spots.
3. Work only on the one active task through its exact GoalBuddy role.
4. Record a compact evidence receipt and update the canonical board.
5. Continue through the next safe package unless a risk/final review is due.
6. Before ending, run `check-can-stop.mjs`; finish only when its terminal gate
   passes with a receipt-backed final audit.
