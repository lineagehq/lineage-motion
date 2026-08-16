# Phase 4 coach-mark breadth architecture review

## Objective

Ground, write, and independently approve only the Phase 4 coach-mark breadth architecture. Inspect all five real scenes through a sanitized technical inventory; define cue-owned deterministic tracks, cursor-path and click-pulse editing, reusable click/type/select/drag/reveal/hold cues, revision-linked notes and comparison, sanitized handoff receipts, and a paired performance benchmark; then stop before product implementation.

## Original Request

Work out the Phase 4 architecture decisions before implementation, accept the recommended decisions, and proceed with the architecture review.

## Intake Summary

- Input shape: `existing_plan`
- Audience: motion editor owner
- Authority: `approved`
- Proof type: `decision`
- Completion proof: a final Judge approves a privacy-safe Phase 4 architecture, ordered implementation slices, exact gates, and a ready first vertical slice while explicitly stopping before implementation.
- Goal oracle: a sanitized five-scene capability inventory plus an approved architecture maps every planned Phase 4 feature and owner decision to canonical contracts, vertical slices, browser/visual proof, and a reproducible paired benchmark.
- Likely misfire: creating a second animation runtime, dual cue/track authority, silent semantic inference, or a generalized review product instead of simplifying CSS-animation creation and control.
- Blind spots considered: ownership and detachment, cursor geometry, discrete boundaries, import ambiguity, private leakage, benchmark gaming, annotation identity, handoff privacy, history, persistence, and Phase 5 scope creep.
- Existing plan facts: Phase 3 is merged and complete; Phase 4 owns all five coach-mark scenes and reusable cues; the owner chose cue-owned locked tracks, cursor-and-click first, a paired 2× benchmark, and revision-linked notes without workflow machinery.

## Goal Oracle

The oracle for this goal is:

`A final read-only Judge can trace every sanitized technical construct across all five private scenes to an explicit Phase 4 contract, show that cues deterministically own materialized tracks without becoming a runtime, show that review metadata stays outside animation/export identity, show that the three paired benchmark tasks have exact speed and safety calculations, approve ordered implementation slices with direct browser/visual/privacy gates, and record full_outcome_complete: true for architecture review only.`

Planning prose or a capability list alone is not completion. The architecture must be implementable, adversarially reviewed, and explicit about what remains unimplemented.

## Goal Kind

`existing_plan`

## Owner Decisions

1. **Cue authority.** A cue is the authoritative authoring object. It owns stable targets, named moments, meaningful parameters, generator version, generated track IDs, and an expansion digest. Generated tracks are materialized, inspectable, and locked to their cue. An explicit undoable “Detach to tracks” action converts them to ordinary independently editable tracks.
2. **First vertical slice.** Begin implementation later with the smallest scene that adds cursor travel, click press/release and pulse, plus one synchronized reveal. Select the actual scene from a sanitized technical inventory, not from visual appeal or private product content.
3. **Performance exit proof.** Run the same three materially different sequence-wide edits through raw CSS and Motion. Motion’s combined active time must be at most half the CSS total, and no individual Motion task may be slower.
4. **Safety exit proof.** Every Motion benchmark task avoids raw CSS percentage editing, changes no unintended region or unowned track, passes stable and discrete-boundary visual proof, repeats exports/receipts byte-identically, and restores exact starting canonical and export digests through undo.
5. **Review model.** Annotations reference an immutable revision, stable target or cue ID, and optional time range. Notes live outside the canonical motion document and export identity. Only open/resolved state is allowed; approvals, assignments, merge, and publishing workflows are excluded.

## Current Tranche

This tranche performs architecture review only:

1. inspect all five private scenes locally and emit only sanitized technical counts and aliases;
2. map merged Phase 3 capabilities and composable gaps;
3. define exact domain, import, compiler, preview, service, editor, annotation, receipt, benchmark, and visual-proof boundaries;
4. write one Phase 4 architecture decision with ordered largest-safe vertical slices; and
5. independently audit it, then stop before implementation.

No Phase 4 product file, schema, migration, dependency, private fixture, screenshot, or corpus asset may be created or changed.

## Non-Negotiable Constraints

- Cues cannot become a separate production runtime or interpolation engine. Compiler and preview continue to consume canonical tracks and browser-created CSS animations.
- Cue-owned generated tracks have one authority. Direct low-level editing requires explicit detachment; the design may not attempt bidirectional cue/track synchronization.
- CSS import may report semantic cue candidates, confidence, and evidence, but cannot silently assign or persist cue meaning.
- Stable element, cue, track, keyframe, annotation, and revision identity remains independent from CSS selectors.
- Unsupported constructs remain visible and fail closed. Inventory omissions are architecture blockers, not permission to drop private-scene features.
- Private scene source, copy, branding, filenames, selectors, URLs, paths, screenshots, and payloads never enter tracked files or receipts. Use sanitized aliases, counts, categories, and digests only.
- Revision-linked notes and private note bodies remain outside canonical animation/export identity. Handoff receipts expose only allowlisted counts and digests.
- Preserve the sole writer, expected revisions, claims, deterministic artifacts, compiler-backed preview, native HTML/CSS, stable IDs, reduced motion, browser error/network assertions, and complete Phase 3 gate.
- The paired benchmark measures active edit time consistently, records raw CSS and Motion actions, and cannot use benchmark-specific hidden automation unavailable to normal users.
- No landing-scene implementation, pseudo-element breadth, responsive landing variants, triggers, MCP, Lineage integration, publication, release, push, or pull request without separate authority.

## Adversarial Proof Standard

Before handoff, state the owner-facing claim and challenge these top three realistic failures:

1. Cue metadata and generated tracks drift, create two sources of truth, require a runtime, or fail to detach/undo deterministically.
2. The importer silently guesses cue semantics, the five-scene inventory omits unsupported constructs, or private content leaks through architecture evidence, annotations, receipts, or visual proof.
3. The benchmark is gamed or irreproducible, reports speed without safety, or the review model expands into approvals/merge/project management instead of improving CSS-animation authoring.

Direct architecture evidence must map all five sanitized scenes; every planned cue type; cursor and click geometry/timing; generated ownership and detachment; canonical operations/history; import candidate diagnostics; service/revision/claim interaction; compiler/preview invariance; annotation/comparison/handoff privacy; all three paired tasks and the exact 2× calculation; stable/discrete visual samples; installed Chrome; performance instrumentation; repository scans; ordered vertical slices; stop conditions; and Phase 5 exclusions.

## Stop Rule

Stop only when a final Judge proves the architecture-review oracle or records an exact blocker. Architecture completion must not be represented as implemented Phase 4.

Stop before product implementation. The first implementation slice requires a separate approved goal and fresh worktree after this architecture is merged or otherwise accepted.

## Slice Sizing

Use one sanitized inventory Scout, one high-risk architecture Judge, one coherent architecture-writing Worker, and phase/final Judges. The architecture must propose largest-safe vertical implementation slices that each connect real user authoring through typed operations, persistence, compiler-native preview, visual proof, and Chrome QA. Do not split future work into isolated schema or helper tasks.

## Canonical Board

Machine truth lives at:

`docs/goals/phase4-architecture-review/state.yaml`

## Run Command

```text
Codex: /goal Follow docs/goals/phase4-architecture-review/goal.md.
Claude Code: /goalbuddy Follow docs/goals/phase4-architecture-review/goal.md.
```

## PM Loop

On every execution continuation, read this charter and the GoalBuddy execution contract, follow only the active task in `state.yaml`, require role-shaped receipts, keep exactly one active task, and run the GoalBuddy stop checker before ending. Final completion requires a Judge receipt with `full_outcome_complete: true` for this architecture-review tranche only.
