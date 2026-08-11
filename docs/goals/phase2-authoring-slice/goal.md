# Phase 2 Minimal Authoring Slice

## Objective

Prove that the read-only motion architecture can become a practical animation
authoring tool through one complete, deliberately narrow edit loop: select one
element/property track in a neutral synthetic scene, change one keyframe value
and one keyframe time, dispatch both changes through schema-versioned typed
domain operations, recompile the canonical document, and inspect the result in
the same browser-native preview. Include in-memory undo/redo, atomic stale-
revision rejection, deterministic export proof, and controlled Chrome QA.

## Original Request

Continue after the approved Phase 0/read-only Phase 1 architecture review with
the recommended smallest Phase 2 slice. Demonstrate that the setup enables
easier creation, control, and iteration of CSS animations while keeping the
existing phases and private-corpus boundaries intact.

## Intake Summary

- Input shape: `existing_plan`
- Audience: Lineage Motion architecture owner
- Authority: `approved`
- Proof type: `demo`
- Completion proof: a controlled Chrome walkthrough and fresh automated
  evidence prove the full select/edit/recompile/scrub/undo/redo loop, atomic
  stale-revision rejection, deterministic exports, and scope/privacy safety.
- Goal oracle: a user can adjust one value keyframe and one keyframe time in a
  neutral synthetic CSS animation, see compiler output update in the native
  preview, and return exactly to prior and forward states with undo/redo.
- Likely misfire: build editing controls that mutate UI-local state, bypass the
  canonical document or compiler, introduce a JavaScript interpolator, or
  expand into a generalized editor or persistence layer before the operation
  contract is proven.
- Blind spots considered: time representation and collision rules; operation
  identity and replay; stale writes; undo semantics; discrete timing; reduced
  motion; focus/keyboard behavior; intentional versus accidental visual
  differences; byte identity after undo/redo; private regression safety.
- Existing plan facts: Phase 0/read-only Phase 1 is complete at `de300e6`; the
  repository invariants require shared typed operations, expected revisions,
  selector-independent identity, compiler-output preview, browser-native CSS,
  deterministic exports, and inspectable reduced motion.

## Goal Oracle

The oracle for this goal is:

`In controlled Chrome, a neutral synthetic animation's selected canonical
track can receive one supported value edit and one supported timing edit through
the same typed expected-revision operation boundary used by the editor; the
compiler-rendered native preview reflects only those edits; undo and redo
restore byte-identical canonical and export states; a stale operation changes
nothing; and sanitized receipts plus repository checks prove determinism,
native-animation control, accessibility, and sensitive-content exclusion.`

The PM must compare every task receipt to this oracle. Controls, schemas, or
passing unit tests alone are not completion. A final Judge must map fresh direct
evidence to the full loop and record `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Implement one coherent Phase 2 authoring vertical slice, then stop for owner
review. The first Judge validates the exact operation, timing, revision, and
undo contracts against the existing architecture. One Worker then implements
the complete domain-to-Chrome loop with a neutral synthetic example. A final
Judge adversarially audits the result. Corrective work may be added only when
the audit identifies a concrete gap inside this tranche.

## Grounded Acceptance Criteria

### Typed authoring boundary

- The editor dispatches schema-versioned typed domain operations; it does not
  directly mutate canonical objects or preview styles.
- The two supported edits target stable element, track, and keyframe identity,
  never a CSS selector: one existing supported property value and one existing
  keyframe time/offset.
- Each operation carries stable operation identity and an expected document
  revision. One valid operation applies atomically and advances the revision
  exactly once.
- A stale, invalid, missing-target, or unsupported-value operation returns a
  deterministic typed diagnostic and leaves canonical bytes, revision, history,
  compiled bytes, and preview state unchanged.
- Timing representation, range, ordering, and collision behavior are explicit,
  canonical, deterministic, and validated by T001 before implementation.
- This slice exposes a reusable domain-operation boundary suitable for a future
  CLI or adapter, but builds no CLI, MCP server, service, or adapter.

### Edit loop and history

- A minimal editor lets a keyboard and pointer user select one element/property
  track and one keyframe, edit its value, and move its time within the supported
  grammar.
- Controls identify the stable element/track/keyframe IDs and current revision;
  selector hints remain source bindings only.
- Undo and redo are local and in-memory. They use the validated domain boundary
  chosen by T001 and do not introduce persistence or a sole-writer service.
- Undo after both edits restores byte-identical revision-neutral canonical
  content and export bytes; redo restores the corresponding post-edit content
  and export bytes. Full document bytes remain revision-bearing because every
  successful history action advances the revision. A new edit after undo has
  deterministic redo-stack behavior.
- The UI provides visible success/error state and cannot claim an edit succeeded
  when the operation was rejected.

### Compiler and native preview

- Every successful edit recompiles from the canonical document through the
  existing deterministic compiler. The iframe renders those exact compiled
  bytes rather than a parallel UI representation.
- Scrubbing, play, and pause continue to control browser-created animations;
  no JavaScript interpolation engine or direct per-frame property writes are
  introduced.
- The edited value and edited time are inspectable at their relevant keyframe
  moments in Chrome, including both sides of a discrete/step boundary when the
  chosen track has one.
- Reduced-motion behavior remains intentional and inspectable after edits.
- Equal revisions produce byte-identical canonical serialization, HTML, CSS,
  export digests, and sanitized receipts across at least three runs.

### Adversarial proof

- The user-facing claim is: “This architecture now supports controlled,
  iterative CSS-animation authoring through canonical typed edits without
  sacrificing native playback, deterministic export, or safety.”
- The final audit must test the three leading failures: UI-only mutation or a
  second animation engine; nondeterministic/stale/history corruption; and
  leakage or unauthorized scope expansion.
- Automated evidence covers valid and invalid operations, exact revision
  behavior, stable identity, timing/value validation, undo/redo byte identity,
  deterministic repeated export, native browser animation ownership, and
  absence of direct interpolation.
- Controlled Chrome evidence records pre-edit and post-edit samples at the
  edited keyframe moments and both valid sides of any affected discrete
  boundary. It distinguishes the intended changed region/property from
  unexpected visual differences instead of demanding baseline equivalence for
  an intentional edit.
- Interactive Chrome QA exercises selection, value edit, time edit, scrub,
  play/pause, rejected stale edit, undo, redo, keyboard access, reduced motion,
  and console/network cleanliness.
- The existing private import/visual acceptance suite remains a read-only
  regression gate. No private source, screenshots, copy, branding, selectors,
  or absolute corpus paths enter tracked files or receipts.
- Focused tests, full unit/browser tests, type checking, production build,
  deterministic export checks, private acceptance, repository safety checks,
  and diff hygiene pass from exact recorded commands.

## Non-Negotiable Constraints

- Work only in the Phase 2 feature worktree and `codex/phase2-authoring-slice`.
- Use neutral synthetic content for the editable example. The private first
  scene remains ignored, local, read-only acceptance input.
- Do not expand the importer or recreate the public landing animation.
- Do not build a generalized multi-track editor, free-form CSS editor, easing
  editor, responsive authoring, triggers, composition, timelines, or ranges.
- No persistent database, local writer service, mutation CLI, MCP, claims,
  branches, annotations, review workflow, Lineage adapter, React/Tailwind
  round-trip, video export, package publication, release, push, or pull request.
- Preview must render compiler output and use browser-created animations.
- Unsupported edits fail visibly and atomically; no general-purpose escape
  hatch or silent coercion is allowed.
- Preserve unrelated user changes and never use destructive Git commands.

## Stop Rule

Stop only when the final Judge proves the full oracle, explicitly addresses the
three realistic failure modes, records `full_outcome_complete: true`, and hands
the result back for owner review. Do not proceed to a broader Phase 2 editor or
Phase 3.

Do not stop after contract design, controls, or isolated unit tests while the
approved end-to-end Chrome loop remains safe to complete. If the final audit
finds a concrete in-scope defect, add the smallest corrective Worker package and
repeat the final audit.

## Slice Sizing

The Worker owns the entire reversible vertical slice: typed operation through
canonical state, compiler, minimal UI, native preview, history, tests, and
Chrome proof. Do not split repeated controls or test files into tiny tasks.

## Board Health

The PM owns board health. If the board is stale or inconsistent, run:

```bash
node <goalbuddy-skill-path>/scripts/check-goal-state.mjs docs/goals/phase2-authoring-slice
```

## Canonical Board

Machine truth lives at:

`docs/goals/phase2-authoring-slice/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status,
active task, receipts, verification freshness, and completion truth.

## Run Command

```text
Codex: /goal Follow docs/goals/phase2-authoring-slice/goal.md.
Claude Code: /goalbuddy Follow docs/goals/phase2-authoring-slice/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter and the GoalBuddy execution contract.
2. Read `state.yaml` and run the bundled update checker.
3. Re-check the original outcome, constraints, oracle, likely misfire, and
   existing-plan facts.
4. Work only on the one active task using its assigned role.
5. Record a compact evidence receipt and update the canonical board.
6. Continue to the next safe package unless a phase/risk/final review is due.
7. Before ending, run `check-can-stop.mjs`; finish only when the terminal gate
   passes with a receipt-backed final audit.
