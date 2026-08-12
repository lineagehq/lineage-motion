# Phase 2 Bounded Target Selection

## Objective

Generalize the reviewed fixed cursor-opacity workflow only enough for a motion
author to choose one explicitly eligible existing neutral element and supported
property before creating a CSS animation track. Eligibility, selection,
creation, authoring, history, deterministic compilation, native preview, and
visual proof must remain one bounded canonical workflow.

## Original Request

Commit and integrate the reviewed track-creation slice, stop for architecture
review, and prepare—but do not yet implement—the next bounded Phase 2
capability: selecting an existing element and supported property before creating
a track.

## Intake Summary

- Input shape: `existing_plan`
- Audience: CSS animation authors and the Lineage Motion architecture owner
- Authority: `approved`
- Proof type: `demo`
- Completion proof: a visible installed-Chrome walkthrough plus controlled
  visual, domain, compiler, history, privacy, build, and diff evidence proves
  the selected eligible pair creates and authors one deterministic native CSS
  animation without generalized editing.
- Goal oracle: an author can understand which neutral targets/properties are
  available, make one selection, create a track, and complete the familiar
  authoring/history workflow without knowing selectors or internal topology.
- Likely misfire: build a generalized selector/property browser, arbitrary CSS
  editor, multi-track system, or persistence architecture instead of one bounded
  selection slice.
- Blind spots considered: canonical eligibility; unavailable reasons; existing
  track conflicts; stable selection through rerenders/history; deterministic IDs
  across targets; visual linkage; keyboard behavior; reduced motion; private
  leakage; and technical evidence overwhelming the authoring task.
- Existing plan facts: local `main` includes the reviewed track-creation slice at
  `749e973`; the next capability is bounded element/property selection; all
  typed-operation, compiler-native preview, deterministic history, accessibility,
  privacy, and adversarial proof invariants remain mandatory; no push or PR is
  authorized.

## Goal Oracle

The oracle for this goal is:

`In controlled and installed Chrome, a motion author sees a small understandable
set of eligible neutral element/property choices, selects one without using a
CSS selector or canonical ID, creates exactly one supported track through the
typed expected-revision reducer, reshapes and scrubs it through exact compiler
output and browser-created CSSAnimation objects, and reverses/restores the
workflow exactly. Unavailable choices explain why before action, and privacy,
determinism, and phase gates remain clean.`

The PM must compare every task receipt to this oracle. A select element, a new
dropdown, or a passing creation command alone is not completion. The final Judge
must map fresh evidence to the complete workflow and record
`full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

Complete one bounded target-selection vertical slice and stop for owner review.
T001 first validates the plan against the current canonical document and chooses
the exact small eligible target/property set and operation/UX/proof semantics.
T002 then owns the entire domain-to-browser slice. T999 audits the complete
outcome. Corrective tasks are allowed only for concrete defects within this
tranche.

## Grounded Acceptance Criteria

### Eligibility and selection

- T001 chooses the smallest useful explicit neutral target/property set already
  supported by the current document, domain, compiler, and synthetic fixture.
- Eligibility is derived from stable canonical element identity and typed
  supported properties. CSS selectors remain source bindings and are never
  presented or accepted as identity.
- Existing, conflicting, shared, unsupported, or otherwise unavailable pairs
  expose deterministic sanitized reasons before creation. They are never
  silently hidden, coerced, replaced, or discovered only through mutation.
- Selection is ephemeral editor state keyed by canonical IDs, not a new document
  mutation or parallel persistence model. It remains understandable across
  rerenders, authoring operations, undo/redo, and reduced-motion inspection.
- Human labels and preview linkage make the choice understandable without
  exposing private copy, selectors, or implementation topology.

### Creation and canonical safety

- The selected pair dispatches one exact schema-versioned typed operation with
  operation identity, document identity, and expected revision through the
  existing reducer boundary.
- Structural IDs are deterministic, selector-independent, collision-safe, and
  stable for the selected canonical pair. No random/time/index allocation,
  suffixing, rule cloning, or caller-supplied structural IDs.
- Creation preserves exact rule/application/binding/slot/track/keyframe
  references, inventory, provenance, cues, presentation, reduced motion, and
  unrelated tracks. Unsupported or stale actions reject atomically.
- Exactly one new track is created in the demonstrated workflow. The slice does
  not become arbitrary multi-track authoring or a general property grammar.

### Authoring, preview, and UX

- The chosen track participates in the existing bounded create/add/timing/easing/
  remove and undo/redo workflow through shared typed operations.
- Every success recompiles the canonical document and mounts exact compiler HTML
  in the sandboxed preview. Scrub/play/pause continue to control browser-created
  `CSSAnimation` objects with no JavaScript interpolation or per-frame style
  writes.
- The browser QA loop in `docs/browser-qa-loop.md` is executed visibly from a
  fresh state. Controls expose prerequisites, selection, current state, and
  validation in plain language without technical evidence dominating the task.
- Pointer and keyboard workflows, focus continuity, aria-invalid feedback,
  undo/redo availability, reduced-motion inspection, and selected-preview
  linkage are intentional and tested.

### Adversarial proof

- User-facing claim: “The editor can now aim the bounded CSS-animation creation
  workflow at an explicitly eligible neutral element/property pair while
  preserving canonical safety, native playback, deterministic export, and exact
  history.”
- Failure mode 1: eligibility or selection leaks selectors, becomes unstable, or
  permits a conflicting/shared target. Direct domain/editor evidence must prove
  the exact eligible set, unavailable reasons, stable canonical identity, and
  atomic rejection.
- Failure mode 2: selection becomes UI-only magic that bypasses the reducer or
  creates divergent preview behavior. Browser evidence must prove exact typed
  dispatch, compiler srcdoc, timeline projection, and native CSSAnimation control.
- Failure mode 3: target generalization creates nondeterministic IDs/history,
  visual spill, private leakage, or phase expansion. Repeated export/history/
  visual evidence, sensitive scans, and complete diff inspection must defeat it.
- Controlled proof waits for DOM, fonts, layout, semantic, and raster stability;
  blocks network; uses independent contexts; samples stable moments plus every
  affected exact/t±1 discrete or step boundary; and requires equivalent history
  states to match exactly.
- Sanitized evidence contains only versions, IDs/digests, aggregate counts,
  diagnostics, timings, convergence, and aggregate diff results—never private
  paths, source, selectors, branding, copy, screenshots, or credentials.

## Non-Negotiable Constraints

- Work only in `.worktrees/phase2-target-selection-slice` on
  `codex/phase2-target-selection-slice`.
- Use only neutral synthetic content. Private acceptance remains ignored, local,
  read-only, and absent from tracked evidence.
- Do not expand the importer, public fixture grammar, arbitrary CSS/property
  grammar, or compiler architecture.
- Do not build a general DOM tree, selector editor, multi-select, drag/drop,
  generalized multi-track creation, free-form values/easing, responsive/trigger/
  composition editing, or automatic rule cloning.
- No persistence, sole-writer service, CLI, MCP, claims, branches, annotations,
  collaboration, review workflow, Lineage adapter, landing work, video export,
  publication, release, push, or pull request.
- Preview renders compiler output and controls browser-created animations.
- Unsupported behavior fails visibly and atomically.
- Preserve unrelated changes and never use destructive Git commands.

## Stop Rule

Stop only when the final Judge proves the full oracle, disposes of the three
realistic failure modes with direct evidence, records
`full_outcome_complete: true`, and hands the result back for owner review. Do not
continue into generalized Phase 2 authoring or Phase 3.

Do not stop after architecture design, a selection control, or one successful
creation while the complete selection/create/author/history/Chrome workflow
remains safe to finish. If the final audit finds an in-scope defect, add the
smallest corrective Worker package and repeat the audit.

## Slice Sizing

One Worker owns the complete reversible vertical slice selected by T001:
eligibility, editor selection, typed creation, canonical history, minimal UX,
native preview, automated tests, controlled visual proof, installed-Chrome QA,
and sanitized evidence. Do not split controls and helpers into tiny tasks.

## Board Health

The PM owns board health. If the board looks stale or inconsistent, run:

```bash
node <goalbuddy-skill-path>/scripts/check-goal-state.mjs docs/goals/phase2-target-selection-slice
```

## Canonical Board

Machine truth lives at:

`docs/goals/phase2-target-selection-slice/state.yaml`

If this charter and `state.yaml` disagree, `state.yaml` wins for task status,
active task, receipts, verification freshness, and completion truth.

## Run Command

```text
Codex: /goal Follow docs/goals/phase2-target-selection-slice/goal.md.
Claude Code: /goalbuddy Follow docs/goals/phase2-target-selection-slice/goal.md.
```

## PM Loop

On every `/goal` continuation:

1. Read this charter, the GoalBuddy execution contract, and `state.yaml`.
2. Re-check the original outcome, oracle, constraints, existing-plan facts,
   likely misfire, and blind spots.
3. Work only on the active task through its exact GoalBuddy role.
4. Record a compact receipt and update the canonical board.
5. Continue through the next safe package unless a phase/risk/final review is due.
6. Before ending, run `check-can-stop.mjs`; finish only when its terminal gate
   passes with a receipt-backed final audit.
