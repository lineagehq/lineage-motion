# Phase 2 UX Simplification

## Objective

Simplify the proven target-selection and bounded CSS-animation authoring workflow so a first-time motion author can understand and complete choose, create, shape, time, preview, validation, and history without coaching or implementation knowledge.

## Original Request

"We need to do a round of UX simplification" followed by approval to execute the recommended sequence.

## Intake Summary

- Input shape: `existing_plan`
- Audience: CSS animation authors who should not need to understand canonical IDs, selectors, or compiler topology
- Authority: `approved`
- Proof type: `demo`
- Completion proof: a fresh visible Chrome walkthrough completes the existing Orb workflow on the first attempt with the primary path obvious, preview prominent, validation understandable, and technical evidence subordinate, while all canonical, compiler-native, accessibility, determinism, visual, privacy, and repository gates remain clean.
- Goal oracle: a first-time author can independently recognize and perform `Choose target → Create track → Shape → Time → Preview`, recover from invalid input, and undo/redo without coaching.
- Likely misfire: cosmetic restyling, hiding necessary state, or adding new animation capabilities instead of reducing cognitive load in the workflow already proven.
- Blind spots considered: small viewport behavior; keyboard order and focus; draft versus applied values; preview visibility during editing; full-timeline discoverability; reduced-motion access; screen-reader clarity; stable test selectors; and technical evidence overwhelming the creative task.
- Existing plan facts: target selection is integrated at `1c7eb03`; Phase 2 still requires dragging, inline copy, insert-hold, and ripple-retime later; persistence and Phase 3 remain unauthorized in this tranche.

## Goal Oracle

The oracle is:

`In a fresh installed-Chrome session, an author completes the existing Orb opacity workflow without coaching: they understand the initial prerequisite, select and create the track, add a midpoint, change duration/delay/easing, scrub and inspect the preview, recover from invalid input, and use exact undo/redo. The screen prioritizes creative action and preview; canonical IDs, receipts, and complete track topology remain inspectable but do not dominate.`

Planning, a cleaner screenshot, or automated tests alone are insufficient. A final Judge must map visible browser observations and complete verification to the oracle and record `full_outcome_complete: true`.

## Goal Kind

`existing_plan`

## Current Tranche

One coherent UX-simplification vertical slice over the already-proven authoring workflow. Start with a read-only Judge audit of the current interface and browser walkthrough, implement the largest safe simplification package, run visible owner-style QA plus focused and complete regression proof, then stop for owner review.

## Non-Negotiable Constraints

- Work only in `.worktrees/phase2-ux-simplification` on `codex/phase2-ux-simplification`.
- Do not add new authoring operations, property grammar, arbitrary selectors, additional created tracks, importer/compiler behavior, or new canonical document fields.
- Keep preview exact compiler output and control browser-created `CSSAnimation` objects.
- Preserve target eligibility, typed reducer operations, revisions, history, deterministic IDs/export, visual proof, reduced motion, and accessibility.
- Technical IDs and the complete timeline may be collapsed or visually subordinated, never removed from inspectability.
- Use neutral synthetic content only. Private acceptance stays ignored and local; no private paths, copy, branding, selectors, or screenshots enter tracked files.
- No persistence, service, CLI/MCP, claims, branching model, collaboration, Lineage adapter, landing work, video, publication, push, or pull request.
- Do not begin insert-hold/ripple-retime in this tranche.

## Stop Rule

Stop only when a final adversarial audit proves the UX oracle and the full regression/safety suite. If visible QA finds material friction, create the smallest bounded corrective Worker package and repeat the walkthrough.

Do not continue into hold/ripple-retime or Phase 3 from this goal.

## Canonical Board

Machine truth lives at `docs/goals/phase2-ux-simplification/state.yaml`.
## Run Command

```text
Codex: /goal Follow docs/goals/phase2-ux-simplification/goal.md.
Claude Code: /goalbuddy Follow docs/goals/phase2-ux-simplification/goal.md.
```
