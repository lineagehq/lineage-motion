# Phase 4 reusable cue breadth

## Objective

Implement and prove the second ordered Phase 4 vertical slice: reusable Type,
Select, Drag, and Hold cues that a person can author through the existing
canvas-first Shot workspace and an agent can author through the shared typed
CLI boundary. Preserve cue-owned deterministic tracks, explicit detach-to-tracks,
sole-writer persistence, native compiled HTML/CSS preview, and simple default UX.

## Original Request

Proceed with the recommended next Phase 4 slice in a fresh worktree: add Type,
Select, Drag, and Hold cues with canvas-first controls, editor/CLI parity, undo,
detachment, deterministic native CSS, Chrome QA, visual-boundary proof, and
privacy checks; stop before the five-scene closure or Phase 5.

## Intake Summary

- Input shape: `existing_plan`
- Audience: motion editor owner and agent collaborators
- Authority: `approved`
- Proof type: `demo`
- Completion proof: a named-subdomain installed-Chrome walkthrough demonstrates all four cue families from authoring through durable reload and compiler-native playback, backed by parity, history, rejection, determinism, visual-boundary, reduced-motion, and privacy receipts.
- Goal oracle: a user can create or adjust Type, Select, Drag, and Hold behavior without editing CSS percentages or leaving the unified canvas, and the same intents issued by the CLI yield byte-identical canonical documents and exports.
- Likely misfire: adding cue schemas or technical panels that pass unit tests but do not produce a simple, durable, browser-native end-to-end authoring workflow.
- Blind spots considered: cue/track dual authority; ambiguous Type and Select semantics; drag target geometry; multiple arrival points; inserted-hold ripple; stale revisions and claims; detachment and exact undo; discrete-boundary sampling; reduced motion; private corpus leakage; responsive overlap; keyboard access; benchmark scope creep; and a second JavaScript animation runtime.
- Existing plan facts: the merged Phase 4 architecture fixes this as Slice 2 after cursor-click-reveal; cue-owned generated tracks stay locked until explicit detach; the editor and CLI share typed durable operations; preview renders compiler output and browser-created animations; the canvas-first UX keeps technical detail under Advanced; Slice 3 owns five-scene closure; Slice 5 owns the aggregate two-times benchmark; Phase 5 remains unauthorized.

## Goal Oracle

The oracle for this goal is:

`At a named localhost subdomain in installed Chrome, the owner or an adversarial tester can create and adjust one Type, one Select, one Drag with an intermediate arrival, and one Hold cue from the unified canvas; observe the compiled native CSS result; reload without losing it; reproduce the same canonical and export digests through the CLI; detach and undo exactly; and inspect clean stable/discrete visual proof and sanitized receipts.`

Planning, schema-only support, reducer-only support, isolated helpers, or a demo
that bypasses the local service does not satisfy the oracle. Final completion
requires a Judge receipt with `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Validate the merged baseline and exact existing-plan dependency, create a fresh
worktree from current `origin/main`, then complete the largest safe end-to-end
implementation package for all four remaining reusable cue families. Correct
only evidence-backed defects found during adversarial review. Finish with a
named-subdomain Chrome walkthrough and aggregate proof for this slice.

## Non-Negotiable Constraints

- Work from a fresh `codex/` worktree based on current `origin/main`; preserve the dirty main checkout and every unrelated local artifact.
- Type, Select, Drag, and Hold are authoritative cues that deterministically materialize inspectable locked canonical tracks. Direct track editing requires explicit, undoable detachment.
- Human editor and CLI dispatch the same typed domain operations through the local sole-writer service with expected revisions, claims, atomic failure, durable reload, and visible diagnostics.
- Preview and scrubbing use compiler output and browser-created animations. Do not create a JavaScript interpolation or alternate preview engine.
- Default UX is canvas-first and plain-language. High-resolution values and IDs stay in the closed-by-default Advanced surface; cue creation must not require raw CSS percentages.
- Drag supports a meaningful intermediate arrival through the established moment model. Hold visibly shifts the intended later choreography without touching unowned tracks.
- Unsupported or ambiguous semantics fail visibly. Import candidates remain noncanonical until explicitly authored.
- Preserve stable identity independently from CSS selectors and preserve inspectable reduced-motion behavior.
- Use only synthetic public fixtures. Private acceptance files remain external and ignored; no private source, copy, branding, selectors, filenames, screenshots, paths, URLs, or digest fragments enter tracked files or sanitized receipts.
- Run the app only on a named localhost subdomain for manual/browser QA.
- Do not implement the five-scene closure, annotations/review/handoff, final performance benchmark, landing-scene features, MCP, Lineage integration, publication, release, push, or pull request without separate authority.

## Adversarial Proof Standard

The final audit must state the user-facing claim and challenge these three
realistic failure modes with direct evidence:

1. Cue metadata and generated tracks drift, editor and CLI diverge, or detach/undo/reload changes the canonical or export result.
2. The simplified canvas hides missing functionality, drag/hold timing affects the wrong region, or preview/scrubbing differs from compiled browser-native CSS around discrete boundaries.
3. Private acceptance material leaks, unsupported semantics are silently guessed, or a green synthetic test masks Chrome, reduced-motion, responsive, keyboard, console, or network failures.

Evidence must include focused domain/protocol/service/CLI/editor tests; exact
revision/claim/rejection/history receipts; repeated canonical/export digests;
installed-Chrome native-animation and durable-reload traces; stable frames and
both sides of each discrete transition; responsive and keyboard inspection;
reduced-motion intent; repository/diff/privacy scans; and a sanitized aggregate
receipt. Record useful task timing instrumentation for the later benchmark, but
do not claim the Phase 4 two-times exit gate in this slice.

## Stop Rule

Stop only when the final Judge proves this Slice 2 oracle or records an exact
blocker. Do not stop after planning, schema work, or a partial cue family while
safe in-scope work remains. Stop before Slice 3 and Phase 5.

## Slice Sizing

Keep the four cue families in one coherent user-visible vertical tranche.
Ground first, then let a Judge define the largest safe Worker package across
the shared domain/protocol/service/CLI/editor/compiler/proof spine. Review at
the contract and final gates; add a corrective Worker only for concrete defects.

## Board Health

Run:

```bash
node <goalbuddy-skill-root>/scripts/check-goal-state.mjs docs/goals/phase4-reusable-cue-breadth
```

## Canonical Board

Machine truth lives at:

`docs/goals/phase4-reusable-cue-breadth/state.yaml`

## Run Command

```text
Codex: /goal Follow docs/goals/phase4-reusable-cue-breadth/goal.md.
Claude Code: /goalbuddy Follow docs/goals/phase4-reusable-cue-breadth/goal.md.
```

## PM Loop

On every execution continuation, read this charter and the GoalBuddy execution
contract, follow only the active task in `state.yaml`, require role-shaped
receipts, keep exactly one active task, and run the GoalBuddy stop checker before
ending. Final completion requires a Judge receipt with
`full_outcome_complete: true` for this slice only.
