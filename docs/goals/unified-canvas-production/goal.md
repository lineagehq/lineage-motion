# Unified Canvas Production

## Objective

Implement the owner-approved unified-canvas reference in the real Shot 1 editor while preserving typed operations, compiler output, browser-created animations, deterministic export, stable identity, exact history, reduced motion, and fail-closed behavior.

## Original Request

Continue from the approved unified-canvas reference into a production implementation. Replace the confusing separate Pose/Path experience with one canvas-first workflow where high-level visual controls are on or around the canvas and exact technical controls are tucked into Advanced.

## Intake Summary

- Input shape: `existing_plan`
- Audience: human visual authors dogfooding CSS-animation creation
- Authority: `approved`
- Proof type: `demo`
- Completion proof: the production editor passes the complete no-Advanced workflow in desktop and narrow Chrome and the owner explicitly approves it
- Goal oracle: select either Shot 1 object, select a moment, move/rotate/scale directly, reveal and edit its three-point path, optionally translate both, preview browser-native compiled CSS, Undo, and Redo without opening Advanced
- Likely misfire: cosmetically reproduce the mockup while preserving separate mental models, bypassing typed operations, adding a second interpolation system, weakening deterministic output/history, or mixing work into the dirty dogfood workspace
- Blind spots considered: safe fresh-worktree formation; provenance of current uncommitted Shot 1 behavior; screen-space transform handles; pointer/keyboard parity; translation-only grouping; responsive coordinate parity; playback hold and no-drift settling; reduced motion; service-backed revision/history behavior; private/sensitive exclusion
- Existing plan facts: the approved three-file interaction reference and its final GoalBuddy receipts are authoritative for UX intent but explicitly non-authoritative for production behavior

## Goal Oracle

The oracle is:

`In the real editor at desktop and narrow widths, the owner can select Object 1 or Object 2, choose Start/700 ms/Settled, move, uniformly scale, rotate, show and edit the three-point trajectory, optionally translate both objects, Play/Pause through the configured Settled hold, and Undo/Redo exact committed changes without opening Advanced; all preview pixels come from compiler HTML/CSS and browser-created animations, and the owner explicitly approves the result.`

Automated checks must prove the workflow before owner review. A visually similar layout, a mockup-only interaction, or a narrow passing test does not satisfy this oracle.

## Goal Kind

`existing_plan`

## Current Tranche

Complete the production Shot 1 unified-canvas workflow, including the fresh worktree boundary, implementation, responsive and accessibility behavior, native preview integration, exact history/revision behavior, regression proof, and owner Chrome approval.

The largest intended production package includes:

- one visually dominant canvas and one coordinate model;
- contextual object selection, moment selection, Path overlay, translation-only Move together, Play/Pause, Undo/Redo, and Advanced disclosure;
- direct body translation, screen-space uniform scale handles, and rotation handle for the selected object/moment;
- selected trajectory emphasis with the inactive trajectory dimmed and exactly three authored waypoints;
- exact pointer release without flicker, snapback, or endpoint error;
- keyboard transform and waypoint alternatives with truthful accessible values and announcements;
- a collapsed Advanced surface containing current exact transform, timing, easing, hold, identity, revision, and diagnostics that are genuinely available in production;
- browser-native compiled preview playback, exact seeking, configured Settled hold, and no post-end drift;
- responsive spatial parity at 1440×900 and 768×900;
- preservation of current service-backed typed operation, expected-revision, Undo/Redo, deterministic export, reduced-motion, and fail-closed behavior.

## Non-Negotiable Constraints

- Form and use a fresh bounded feature worktree before production edits; do not overwrite, stash, reset, commit, or otherwise mutate the existing dirty dogfood worktree without a separately recorded owner authorization.
- Preserve the approved reference and its final receipts as the UX handoff.
- Dispatch existing typed operations: `motion.transform-pose.set` for single-object move/scale/rotation and `motion.transform-waypoints.translate` for waypoint or Move together translation.
- Move together remains translation-only. Do not add or imply grouped scale, grouped rotation, Bézier editing, freeform paths, or multi-shot generalization.
- Preview must render compiler output and control browser-created animations; do not add JavaScript interpolation.
- CSS selectors remain bindings, not stable identity.
- Preserve deterministic equal-revision exports and receipts, service expected-revision semantics, exact Undo/Redo, reduced-motion inspection, and fail-closed diagnostics.
- Keep exact/technical controls in Advanced but do not hide truthful rejection, revision, identity, or reduced-motion state.
- Use only synthetic tracked fixtures and evidence; never commit private source, screenshots, copy, branding, absolute corpus paths, databases, or credentials.
- Do not implement unrelated phase architecture, new persistence concepts, branches/claims changes, CLI expansion, Lineage integration, publication, release, push, or PR without explicit authorization.

## Adversarial Proof Standard

Before owner review, state the user-facing claim and directly test at least these realistic failures:

1. the interface looks unified but still requires a hidden second mode, Advanced, or duplicate controls for the primary workflow;
2. direct transforms, paths, grouped translation, responsive scaling, service reconciliation, or history cause flicker, snapback, coordinate drift, wrong endpoints, or false accessible values;
3. the layout works while bypassing typed operations, compiler/native preview, deterministic export, reduced motion, diagnostics, or sensitive-content boundaries.

Evidence must include installed Chrome at 1440×900 and 768×900, the complete existing repository oracle relevant to Shot 1, repeated deterministic export, compiler/native animation equality, exact Undo/Redo, service-backed revision behavior, zero console/network failures, private-ignore and sensitive scans, full diff inspection, and explicit owner approval.

## Stop Rule

Continue through discovery, architecture validation, safe worktree formation, implementation, correction, and proof until the complete production oracle is satisfied. Stop only for a genuine phase/risk boundary, an exact owner approval wait after all safe local proof, or a repeated hard blocker.

The goal does not complete at the reference, worktree, plan, first implementation package, or green focused test. It completes only after a final Judge maps the production behavior and owner approval to the full oracle.

## Slice Sizing

Prefer one coherent vertical production package over component-by-component styling tasks. Use Scout to map the dirty baseline, Judge to lock the safe worktree and implementation contract, Worker to implement a complete canvas workflow, and Judge at architecture, rejected-verification, owner-review, and final boundaries.

## Board Health

Machine truth lives in `state.yaml`. If the board looks stale or inconsistent, run:

```bash
node <goalbuddy-skill-path>/scripts/check-goal-state.mjs docs/goals/unified-canvas-production
```

## Canonical Board

Machine truth lives at `docs/goals/unified-canvas-production/state.yaml`.

## Run Command

```text
Codex: /goal Follow docs/goals/unified-canvas-production/goal.md.
Claude Code: /goalbuddy Follow docs/goals/unified-canvas-production/goal.md.
```

## PM Loop

1. Read this charter, the execution contract, and `state.yaml`.
2. Work only on the active task.
3. Preserve and fingerprint the dirty dogfood workspace before any fresh-worktree action.
4. Keep reference intent separate from production authority.
5. Record receipts and continue through the complete production oracle.
6. Do not publish, push, or open a PR without explicit owner authorization.
